import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { getTestDb } from "../../test-utils/hermetic-db";
import { profiles, quoteRequests } from "../public-app";
import { customers, quotes } from "../schema";
import { createQuote } from "./customer-quotes";
import { confirmQuoteRequest, markQuoteRequestReadyForSend } from "./quote-requests";

// 담당자 확인 전이(앱 진행 2단계) — 멱등의 근거가 SQL 조건절(`confirmed_at IS NULL`)이라
// 실 DB로만 검증된다. 운영 고객을 임의 선택하지 않고 전용 "상담사테스트" profile만 읽어(수정 금지),
// 임시 CRM 고객·quote_requests를 만든 뒤 finally에서 전부 지운다.
// ⚠️ quote_requests는 알림 트리거 4테이블(consultations·advisor_quotes·chat_messages·chat_sessions)에
//    없어 withNotifyGuard가 필요 없다 — 이 INSERT/UPDATE는 어떤 알림도 발사하지 않는다.
// dual-mode(hermetic-db.ts): 로컬 test:server = 실 master(기존 그대로), CI test:pure = PGlite.
const db = await getTestDb();

async function dedicatedTestProfileId(): Promise<string> {
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.fullName, "상담사테스트"))
    .limit(2);
  if (rows.length !== 1) {
    throw new Error(`전용 상담사테스트 profile이 정확히 1개여야 함(현재 ${rows.length}개)`);
  }
  return rows[0].id;
}

// 소유권 검증용 임시 연결 고객. 운영 고객을 읽거나 갱신하지 않는다.
async function linkedPair(): Promise<{ customerId: string; userId: string }> {
  const userId = await dedicatedTestProfileId();
  const [row] = await db
    .insert(customers)
    .values({
      customerCode: `PUSH-TEST-${crypto.randomUUID().slice(0, 12)}`,
      name: "발송준비통합테스트",
      appUserId: userId,
    })
    .returning({ id: customers.id });
  return { customerId: row.id, userId };
}

test("confirmQuoteRequest: 최초 1회만 firstConfirm=true(재호출은 false, confirmed_at 불변)", async () => {
  const { customerId, userId } = await linkedPair();
  const requestId = crypto.randomUUID();
  try {
    await db.insert(quoteRequests).values({
      id: requestId,
      userId,
      trimId: null,
      status: "open",
      createdAt: new Date().toISOString(),
    });

    const first = await confirmQuoteRequest(requestId, customerId, db);
    expect(first?.firstConfirm).toBe(true);
    expect(first?.appUserId).toBe(userId);

    const [after] = await db
      .select({ confirmedAt: quoteRequests.confirmedAt })
      .from(quoteRequests)
      .where(eq(quoteRequests.id, requestId));
    expect(after.confirmedAt).not.toBeNull();

    // 재호출("추가 작성"·워크벤치 재진입) — 전이 없음 + 스탬프 불변(단조 계약).
    const second = await confirmQuoteRequest(requestId, customerId, db);
    expect(second?.firstConfirm).toBe(false);
    const [again] = await db
      .select({ confirmedAt: quoteRequests.confirmedAt })
      .from(quoteRequests)
      .where(eq(quoteRequests.id, requestId));
    expect(again.confirmedAt).toBe(after.confirmedAt);
  } finally {
    await db.delete(quoteRequests).where(eq(quoteRequests.id, requestId));
    await db.delete(customers).where(eq(customers.id, customerId));
  }
});

test("confirmQuoteRequest: 소유권 불일치·미존재는 null(전이도 푸시도 없음)", async () => {
  const userId = await dedicatedTestProfileId();
  const [manual] = await db
    .insert(customers)
    .values({
      customerCode: `PUSH-TEST-${crypto.randomUUID().slice(0, 12)}`,
      name: "발송준비불일치테스트",
    })
    .returning({ id: customers.id });
  const requestId = crypto.randomUUID();
  try {
    await db.insert(quoteRequests).values({
      id: requestId,
      userId,
      trimId: null,
      status: "open",
      createdAt: new Date().toISOString(),
    });

    // 그 요청의 user_id와 무관한 임시 수기 고객(app_user_id null)은 반드시 불일치.
    expect(await confirmQuoteRequest(requestId, manual.id, db)).toBeNull();
    // 거부됐으면 스탬프가 찍히지 않아야 한다.
    const [row] = await db
      .select({ confirmedAt: quoteRequests.confirmedAt })
      .from(quoteRequests)
      .where(eq(quoteRequests.id, requestId));
    expect(row.confirmedAt).toBeNull();

    // 존재하지 않는 요청
    expect(await confirmQuoteRequest(crypto.randomUUID(), manual.id, db)).toBeNull();
  } finally {
    await db.delete(quoteRequests).where(eq(quoteRequests.id, requestId));
    await db.delete(customers).where(eq(customers.id, manual.id));
  }
});

test("markQuoteRequestReadyForSend: 작성 완료 최초 1회만 전이하고 재시도는 스탬프를 보존한다", async () => {
  const { customerId, userId } = await linkedPair();
  const requestId = crypto.randomUUID();
  let quoteId: string | null = null;
  try {
    await db.insert(quoteRequests).values({
      id: requestId,
      userId,
      trimId: null,
      status: "open",
      createdAt: new Date().toISOString(),
    });
    const quote = await createQuote(customerId, { sourceQuoteRequestId: requestId, status: "작성중" }, db);
    quoteId = quote.id;

    const first = await markQuoteRequestReadyForSend(quote.id, customerId, db);
    expect(first).toEqual({ firstReadyForSend: true, appUserId: userId });
    const [after] = await db
      .select({ readyForSendAt: quoteRequests.readyForSendAt })
      .from(quoteRequests)
      .where(eq(quoteRequests.id, requestId));
    expect(after.readyForSendAt).not.toBeNull();

    const second = await markQuoteRequestReadyForSend(quote.id, customerId, db);
    expect(second).toEqual({ firstReadyForSend: false, appUserId: userId });
    const [again] = await db
      .select({ readyForSendAt: quoteRequests.readyForSendAt })
      .from(quoteRequests)
      .where(eq(quoteRequests.id, requestId));
    expect(again.readyForSendAt).toBe(after.readyForSendAt);
  } finally {
    if (quoteId) await db.delete(quotes).where(eq(quotes.id, quoteId));
    await db.delete(quoteRequests).where(eq(quoteRequests.id, requestId));
    await db.delete(customers).where(eq(customers.id, customerId));
  }
});

test("markQuoteRequestReadyForSend: 견적 저장 트랜잭션이 롤백되면 준비 전이도 함께 롤백된다", async () => {
  const { customerId, userId } = await linkedPair();
  const requestId = crypto.randomUUID();
  try {
    await db.insert(quoteRequests).values({
      id: requestId,
      userId,
      trimId: null,
      status: "open",
      createdAt: new Date().toISOString(),
    });

    await expect(
      db.transaction(async (tx) => {
        const quote = await createQuote(customerId, { sourceQuoteRequestId: requestId, status: "작성중" }, tx);
        expect((await markQuoteRequestReadyForSend(quote.id, customerId, tx))?.firstReadyForSend).toBe(true);
        throw new Error("ROLLBACK_READY_FOR_SEND_TEST");
      }),
    ).rejects.toThrow("ROLLBACK_READY_FOR_SEND_TEST");

    const [after] = await db
      .select({ readyForSendAt: quoteRequests.readyForSendAt })
      .from(quoteRequests)
      .where(eq(quoteRequests.id, requestId));
    expect(after.readyForSendAt).toBeNull();
  } finally {
    await db.delete(quoteRequests).where(eq(quoteRequests.id, requestId));
    await db.delete(customers).where(eq(customers.id, customerId));
  }
});

// 계약(회신 문서 §CRM 구현 경계)이 "출처 요청이 없는 일반 CRM 견적과 소유권이 어긋난 loose id는
// no-op"이라고 앱 팀에 약속한 부분. 반환이 null이면 라우트가 푸시를 걸지 않는다 —
// 이 술어들이 지워지면 남의 요청 스탬프를 올리고 **다른 고객 기기로 푸시가 간다.**
test("markQuoteRequestReadyForSend: 출처 없음·타 고객 견적·소유권 불일치는 전부 null(전이도 푸시도 없음)", async () => {
  const { customerId, userId } = await linkedPair();
  const [manual] = await db
    .insert(customers)
    .values({
      customerCode: `PUSH-TEST-${crypto.randomUUID().slice(0, 12)}`,
      name: "발송준비소유권테스트",
    })
    .returning({ id: customers.id });
  const requestId = crypto.randomUUID();
  const quoteIds: string[] = [];
  try {
    await db.insert(quoteRequests).values({
      id: requestId,
      userId,
      trimId: null,
      status: "open",
      createdAt: new Date().toISOString(),
    });

    // ① 출처 요청이 없는 일반 CRM 견적 — source_quote_request_id가 null이라 올릴 요청 자체가 없다.
    const plain = await createQuote(customerId, { status: "작성중" }, db);
    quoteIds.push(plain.id);
    expect(await markQuoteRequestReadyForSend(plain.id, customerId, db)).toBeNull();

    // ② 견적은 연결 고객 것인데 다른 고객 id로 호출 — quotes.customer_id 결합에서 걸러진다.
    const linked = await createQuote(customerId, { sourceQuoteRequestId: requestId, status: "작성중" }, db);
    quoteIds.push(linked.id);
    expect(await markQuoteRequestReadyForSend(linked.id, manual.id, db)).toBeNull();

    // ③ loose id 소유권 불일치 — 수기 고객(app_user_id null)의 견적이 남의 요청을 가리키는 경우.
    const crossed = await createQuote(manual.id, { sourceQuoteRequestId: requestId, status: "작성중" }, db);
    quoteIds.push(crossed.id);
    expect(await markQuoteRequestReadyForSend(crossed.id, manual.id, db)).toBeNull();

    // ④ 죽은 loose id — 존재하지 않는 요청을 가리키는 견적.
    const dangling = await createQuote(customerId, { sourceQuoteRequestId: crypto.randomUUID(), status: "작성중" }, db);
    quoteIds.push(dangling.id);
    expect(await markQuoteRequestReadyForSend(dangling.id, customerId, db)).toBeNull();

    // 네 경로 어디서도 스탬프가 찍히지 않아야 한다.
    const [row] = await db
      .select({ readyForSendAt: quoteRequests.readyForSendAt })
      .from(quoteRequests)
      .where(eq(quoteRequests.id, requestId));
    expect(row.readyForSendAt).toBeNull();
  } finally {
    for (const id of quoteIds) await db.delete(quotes).where(eq(quotes.id, id));
    await db.delete(quoteRequests).where(eq(quoteRequests.id, requestId));
    await db.delete(customers).where(eq(customers.id, manual.id));
    await db.delete(customers).where(eq(customers.id, customerId));
  }
});

// 진행 역행 방지: `작성 후 발송`은 command를 싣지 않아 ready_for_send_at이 NULL로 남는다. 그 견적을
// 고치려고 다시 열어 `작성완료`를 누르면 IS NULL 술어만으로는 통과해 4단계 뒤에 3단계가 찍히고,
// 이미 견적을 받은 고객에게 "곧 견적서를 보내드릴게요"가 나간다.
test("markQuoteRequestReadyForSend: 이미 견적이 나간 요청(status=completed)은 전이하지 않는다", async () => {
  const { customerId, userId } = await linkedPair();
  const requestId = crypto.randomUUID();
  let quoteId: string | null = null;
  try {
    await db.insert(quoteRequests).values({
      id: requestId,
      userId,
      trimId: null,
      status: "completed", // 상담사 견적 발송이 끝난 상태(advisor-quotes.ts가 찍는 값)
      createdAt: new Date().toISOString(),
    });
    const quote = await createQuote(customerId, { sourceQuoteRequestId: requestId, status: "작성중" }, db);
    quoteId = quote.id;

    // 소유권은 정상이라 null이 아니라 "전이 없음"으로 떨어진다 → 라우트가 푸시를 걸지 않는다.
    expect(await markQuoteRequestReadyForSend(quote.id, customerId, db)).toEqual({
      firstReadyForSend: false,
      appUserId: userId,
    });
    const [row] = await db
      .select({ readyForSendAt: quoteRequests.readyForSendAt })
      .from(quoteRequests)
      .where(eq(quoteRequests.id, requestId));
    expect(row.readyForSendAt).toBeNull();
  } finally {
    if (quoteId) await db.delete(quotes).where(eq(quotes.id, quoteId));
    await db.delete(quoteRequests).where(eq(quoteRequests.id, requestId));
    await db.delete(customers).where(eq(customers.id, customerId));
  }
});
