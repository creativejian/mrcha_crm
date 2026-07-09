import { expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

// public.advisor_quotes는 AFTER INSERT OR UPDATE 트리거(on_advisor_quote_sent)가 고객 FCM 푸시를
// 낸다 — 모든 쓰기를 withNotifyGuard 트랜잭션(app.skip_notify) 안에서 한다.
import { withNotifyGuard } from "../../test-utils/notify-gate";

import { getDefaultDb } from "../client";
import { advisorQuotes, profiles, quoteRequests } from "../public-app";
import {
  completeQuoteRequest,
  deleteAdvisorQuoteByCrmQuoteId,
  listAdvisorViewedAt,
  upsertAdvisorQuote,
  type AdvisorQuoteUpsert,
} from "./advisor-quotes";

const db = getDefaultDb();

// 공유 master 실DB — user_id FK(profiles) 때문에 실존 profile id가 필요하다(읽기만, 수정 금지).
async function anyProfileId(): Promise<string> {
  const [row] = await db.select({ id: profiles.id }).from(profiles).limit(1);
  if (!row) throw new Error("profiles가 비어 있어 테스트 불가(실 master DB 전제)");
  return row.id;
}

// upsert 입력 픽스처. crmQuoteId는 매 테스트 randomUUID로 충돌 방지.
function makeUpsert(userId: string, crmQuoteId: string, overrides: Partial<AdvisorQuoteUpsert> = {}): AdvisorQuoteUpsert {
  return {
    userId,
    quoteRequestId: null,
    crmQuoteId,
    quoteCode: "QT-TEST-0001",
    revision: 1,
    vehicleLabel: "테스트 브랜드 테스트 모델",
    monthlyPayment: 1_234_567,
    payload: { schemaVersion: 1, marker: "advisor-quotes-test" },
    sentAt: "2026-07-05T01:02:03.000Z",
    validUntil: "2026-07-12T01:02:03.000Z",
    ...overrides,
  };
}

// timestamptz는 드라이버 반환 포맷("2026-07-05 01:02:03+00")이 입력 ISO와 달라 epoch로 비교한다.
function epoch(value: string | null): number | null {
  return value == null ? null : new Date(value).getTime();
}

test("upsertAdvisorQuote: 신규 insert — 모든 컬럼 왕복, viewed_at null, id/created_at DB 생성", async () => {
  const userId = await anyProfileId();
  const crmQuoteId = crypto.randomUUID();
  try {
    await withNotifyGuard(db, (tx) => upsertAdvisorQuote(makeUpsert(userId, crmQuoteId), tx));
    const [row] = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, crmQuoteId));
    expect(row).toBeDefined();
    expect(row.id).toBeString();
    expect(row.userId).toBe(userId);
    expect(row.quoteRequestId).toBeNull();
    expect(row.quoteCode).toBe("QT-TEST-0001");
    expect(row.revision).toBe(1);
    expect(row.vehicleLabel).toBe("테스트 브랜드 테스트 모델");
    expect(row.monthlyPayment).toBe(1_234_567);
    expect(row.payload).toEqual({ schemaVersion: 1, marker: "advisor-quotes-test" });
    expect(epoch(row.sentAt)).toBe(Date.parse("2026-07-05T01:02:03.000Z"));
    expect(epoch(row.validUntil)).toBe(Date.parse("2026-07-12T01:02:03.000Z"));
    expect(row.viewedAt).toBeNull();
    expect(row.createdAt).toBeString();
  } finally {
    await db.delete(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, crmQuoteId));
  }
});

test("upsertAdvisorQuote: 같은 crm_quote_id 재-upsert — 전체 교체 + viewed_at null 리셋", async () => {
  const userId = await anyProfileId();
  const crmQuoteId = crypto.randomUUID();
  try {
    await withNotifyGuard(db, (tx) => upsertAdvisorQuote(makeUpsert(userId, crmQuoteId), tx));
    // 앱 사용자가 열람한 상태를 재현(재발송 전 viewed_at 세팅).
    await withNotifyGuard(db, (tx) => tx
      .update(advisorQuotes)
      .set({ viewedAt: "2026-07-06T00:00:00.000Z" })
      .where(eq(advisorQuotes.crmQuoteId, crmQuoteId)));

    await withNotifyGuard(db, (tx) => upsertAdvisorQuote(
      makeUpsert(userId, crmQuoteId, {
        revision: 2,
        payload: { schemaVersion: 1, marker: "resent" },
        monthlyPayment: 2_000_000,
        sentAt: "2026-07-07T00:00:00.000Z",
        validUntil: null,
      }),
      tx,
    ));

    const rows = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, crmQuoteId));
    expect(rows).toHaveLength(1); // conflict update지 신규 행 추가가 아님
    const row = rows[0];
    expect(row.revision).toBe(2);
    expect(row.payload).toEqual({ schemaVersion: 1, marker: "resent" });
    expect(row.monthlyPayment).toBe(2_000_000);
    expect(epoch(row.sentAt)).toBe(Date.parse("2026-07-07T00:00:00.000Z"));
    expect(row.validUntil).toBeNull();
    expect(row.viewedAt).toBeNull(); // 재발송 = 새 카드 = 다시 미확인
  } finally {
    await db.delete(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, crmQuoteId));
  }
});

test("deleteAdvisorQuoteByCrmQuoteId: 행 소멸 + 없는 id 재호출 no-op", async () => {
  const userId = await anyProfileId();
  const crmQuoteId = crypto.randomUUID();
  try {
    await withNotifyGuard(db, (tx) => upsertAdvisorQuote(makeUpsert(userId, crmQuoteId), tx));
    await deleteAdvisorQuoteByCrmQuoteId(crmQuoteId, db);
    const rows = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, crmQuoteId));
    expect(rows).toHaveLength(0);
    // 이미 지운(없는) id로 다시 호출해도 에러 없이 완료돼야 한다(회수 멱등).
    await deleteAdvisorQuoteByCrmQuoteId(crmQuoteId, db);
    await deleteAdvisorQuoteByCrmQuoteId(crypto.randomUUID(), db);
  } finally {
    await db.delete(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, crmQuoteId));
  }
});

test("completeQuoteRequest: status open→completed 전이(멱등)", async () => {
  const userId = await anyProfileId();
  const requestId = crypto.randomUUID();
  try {
    // 기존 실데이터 quote_requests는 건드리지 않는다 — 테스트 전용 행을 직접 INSERT.
    await db.insert(quoteRequests).values({
      id: requestId,
      userId,
      trimId: null,
      status: "open",
      createdAt: new Date().toISOString(),
    });

    await completeQuoteRequest(requestId, db);
    const [after] = await db.select({ status: quoteRequests.status }).from(quoteRequests).where(eq(quoteRequests.id, requestId));
    expect(after.status).toBe("completed");

    // 멱등: 이미 completed인 행에 재호출해도 에러 없이 completed 유지.
    await completeQuoteRequest(requestId, db);
    const [again] = await db.select({ status: quoteRequests.status }).from(quoteRequests).where(eq(quoteRequests.id, requestId));
    expect(again.status).toBe("completed");
  } finally {
    await db.delete(quoteRequests).where(eq(quoteRequests.id, requestId));
  }
});

test("listAdvisorViewedAt: crmQuoteId→viewed_at Map(없는 id 미포함), 빈 배열은 빈 Map", async () => {
  const userId = await anyProfileId();
  const idViewed = crypto.randomUUID();
  const idUnviewed = crypto.randomUUID();
  try {
    await withNotifyGuard(db, (tx) => upsertAdvisorQuote(makeUpsert(userId, idViewed, { quoteCode: "QT-TEST-0002" }), tx));
    await withNotifyGuard(db, (tx) => upsertAdvisorQuote(makeUpsert(userId, idUnviewed, { quoteCode: "QT-TEST-0003" }), tx));
    await withNotifyGuard(db, (tx) => tx
      .update(advisorQuotes)
      .set({ viewedAt: "2026-07-06T12:00:00.000Z" })
      .where(eq(advisorQuotes.crmQuoteId, idViewed)));

    const map = await listAdvisorViewedAt([idViewed, idUnviewed, crypto.randomUUID()], db);
    expect(map.size).toBe(2); // 행 없는 id는 미포함
    expect(epoch(map.get(idViewed) ?? null)).toBe(Date.parse("2026-07-06T12:00:00.000Z"));
    expect(map.get(idUnviewed)).toBeNull();

    const empty = await listAdvisorViewedAt([], db);
    expect(empty.size).toBe(0);
  } finally {
    await db.delete(advisorQuotes).where(inArray(advisorQuotes.crmQuoteId, [idViewed, idUnviewed]));
  }
});
