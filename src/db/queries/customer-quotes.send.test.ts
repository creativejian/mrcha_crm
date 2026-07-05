import { test, expect } from "bun:test";
import { eq, isNotNull } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { trimsInCatalog } from "../catalog";
import { advisorQuotes, profiles, quoteRequests } from "../public-app";
import { customers, quotes } from "../schema";
import { createQuote, deleteQuote, updateQuote, type QuoteCreateBody } from "./customer-quotes";
import { getCustomer } from "./customers";

const db = getDefaultDb();

// ── 발송 훅(Task 4) 통합 테스트 — 실 master DB, 생성물 전부 try/finally 원복 ──
// updateQuote(appStatus:"sent")가 같은 트랜잭션 흐름에서 public.advisor_quotes upsert +
// quote_requests completed 전이를 수행하고, deleteQuote가 보낸 카드를 회수하는지 검증한다.

// user_id FK(profiles) 때문에 실존 profile id 필요(읽기만, 수정 금지) — advisor-quotes.test.ts 관례.
async function anyProfileId(): Promise<string> {
  const [row] = await db.select({ id: profiles.id }).from(profiles).limit(1);
  if (!row) throw new Error("profiles가 비어 있어 테스트 불가(실 master DB 전제)");
  return row.id;
}

// modelYear 조인 검증용 — model_year가 채워진 실존 trim 1건(읽기만).
async function anyTrimWithModelYear(): Promise<{ id: number; modelYear: number }> {
  const [row] = await db
    .select({ id: trimsInCatalog.id, modelYear: trimsInCatalog.modelYear })
    .from(trimsInCatalog)
    .where(isNotNull(trimsInCatalog.modelYear))
    .limit(1);
  if (!row || row.modelYear == null) throw new Error("model_year 있는 trim이 없어 테스트 불가(실 master catalog 전제)");
  return { id: row.id, modelYear: row.modelYear };
}

// 테스트 고객 — customerCode는 UNIQUE라 랜덤 suffix로 충돌 방지.
async function makeCustomer(appUserId: string | null): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({ customerCode: `CU-SEND-${crypto.randomUUID().slice(0, 8)}`, name: "발송훅테스트", appUserId })
    .returning({ id: customers.id });
  return row.id;
}

// 발송 payload 조립에 쓰이는 최소 견적 본문(운용리스 시나리오 1건 동봉).
function baseQuoteBody(overrides: Partial<QuoteCreateBody> = {}): QuoteCreateBody {
  return {
    brandName: "테스트브랜드",
    modelName: "테스트모델",
    trimName: "테스트트림",
    basePrice: "50000000",
    optionTotal: "2000000",
    finalDiscount: "1000000",
    scenarios: [{ scenarioNo: 1, purchaseMethod: "운용리스", termMonths: 48, monthlyPayment: "1234567" }],
    ...overrides,
  };
}

// 생성물 일괄 원복 — advisor 행 → quote(시나리오 CASCADE) → 고객 → 테스트 quote_requests 순.
async function cleanup(ids: { quoteId?: string; customerId?: string; requestId?: string }): Promise<void> {
  if (ids.quoteId) {
    await db.delete(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, ids.quoteId));
    await db.delete(quotes).where(eq(quotes.id, ids.quoteId));
  }
  if (ids.customerId) await db.delete(customers).where(eq(customers.id, ids.customerId));
  if (ids.requestId) await db.delete(quoteRequests).where(eq(quoteRequests.id, ids.requestId));
}

test("발송: advisor_quotes 행 생성 — 정규 컬럼·스탬프 정합 + payload 라벨 완성본", async () => {
  const userId = await anyProfileId();
  const ids: { quoteId?: string; customerId?: string } = {};
  try {
    ids.customerId = await makeCustomer(userId);
    const created = await createQuote(ids.customerId, baseQuoteBody(), db);
    ids.quoteId = created.id;

    const res = await updateQuote(ids.customerId, created.id, { appStatus: "sent" }, db);
    expect(res?.id).toBe(created.id);

    // 서버 스탬프(sent_at/valid_until=+7일)와 advisor 행의 시각이 epoch로 일치해야 한다.
    const [sent] = await db.select().from(quotes).where(eq(quotes.id, created.id));
    expect(sent.sentAt).not.toBeNull();
    const sentEpoch = sent.sentAt!.getTime();

    const rows = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, created.id));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.userId).toBe(userId);
    expect(row.quoteRequestId).toBeNull();
    expect(row.quoteCode).toBe(created.quoteCode);
    expect(row.revision).toBe(0);
    expect(row.vehicleLabel).toBe("테스트브랜드 테스트모델 테스트트림");
    expect(row.monthlyPayment).toBe(1_234_567);
    expect(new Date(row.sentAt).getTime()).toBe(sentEpoch);
    expect(row.validUntil).not.toBeNull();
    expect(new Date(row.validUntil!).getTime()).toBe(sentEpoch + 7 * 86_400_000);
    expect(row.viewedAt).toBeNull();

    // payload = 라벨 완성본 스냅샷. 시간 종속 2필드(statusLabel/ddayLabel)는 스냅샷 금지(스펙 결정 2).
    const payload = row.payload as Record<string, unknown>;
    expect(payload.payloadVersion).toBe(1);
    expect(payload.monthlyLabel).toBe("1,234,567원");
    expect(payload.finalVehiclePriceLabel).toBe("51,000,000");
    expect(payload.hasScenario).toBe(true);
    expect("statusLabel" in payload).toBe(false);
    expect("ddayLabel" in payload).toBe(false);
  } finally {
    await cleanup(ids);
  }
});

test("재발송(워크벤치 결합 patch): 행 1개 유지·viewed_at 리셋·시나리오 교체 후 값 스냅샷·revision 반영", async () => {
  const userId = await anyProfileId();
  const ids: { quoteId?: string; customerId?: string } = {};
  try {
    ids.customerId = await makeCustomer(userId);
    const created = await createQuote(ids.customerId, baseQuoteBody(), db);
    ids.quoteId = created.id;

    await updateQuote(ids.customerId, created.id, { appStatus: "sent" }, db);
    // 앱 사용자가 열람한 상태 재현 — 재발송이 이걸 NULL로 리셋해야 한다.
    await db
      .update(advisorQuotes)
      .set({ viewedAt: new Date().toISOString() })
      .where(eq(advisorQuotes.crmQuoteId, created.id));

    // 워크벤치 발송 실경로: scenarios 전체 교체 + bumpRevision + appStatus:"sent"가 한 PATCH에 동봉.
    // 스냅샷이 "교체 후" fresh 상태여야 함(할부/2,000,000이 advisor 행에 반영되는지가 순서 증명).
    await updateQuote(
      ids.customerId,
      created.id,
      {
        appStatus: "sent",
        bumpRevision: true,
        scenarios: [{ scenarioNo: 1, purchaseMethod: "할부", termMonths: 60, monthlyPayment: "2000000" }],
      },
      db,
    );

    const rows = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, created.id));
    expect(rows).toHaveLength(1); // upsert 교체 — 구버전 행이 쌓이지 않는다
    const row = rows[0];
    expect(row.viewedAt).toBeNull(); // 새 카드 = 다시 미확인
    expect(row.revision).toBe(1); // bumpRevision 반영(fresh read가 UPDATE 이후임을 증명)
    expect(row.monthlyPayment).toBe(2_000_000);
    const payload = row.payload as Record<string, unknown>;
    expect(payload.purchaseMethod).toBe("할부");
    expect(payload.downPaymentRowLabel).toBe("선납금"); // 할부 도메인 규칙까지 payload에 반영
  } finally {
    await cleanup(ids);
  }
});

test("앱 미연결 고객(app_user_id null): 내부 스탬프 발송은 유지, advisor_quotes 기록 생략", async () => {
  const ids: { quoteId?: string; customerId?: string } = {};
  try {
    ids.customerId = await makeCustomer(null);
    const created = await createQuote(ids.customerId, baseQuoteBody(), db);
    ids.quoteId = created.id;

    const res = await updateQuote(ids.customerId, created.id, { appStatus: "sent" }, db);
    expect(res?.id).toBe(created.id);

    // 기존 내부 발송 동작 불변(스펙 확정 결정 5) — 스탬프는 찍히되 앱 write는 없다.
    const [sent] = await db.select().from(quotes).where(eq(quotes.id, created.id));
    expect(sent.appStatus).toBe("sent");
    expect(sent.sentAt).not.toBeNull();
    const rows = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, created.id));
    expect(rows).toHaveLength(0);
  } finally {
    await cleanup(ids);
  }
});

test("견적요청 연결 견적 발송: quote_requests open→completed 전이 + advisor 행에 요청 id 기록", async () => {
  const userId = await anyProfileId();
  const ids: { quoteId?: string; customerId?: string; requestId?: string } = {};
  try {
    // 기존 실데이터 quote_requests 불가침 — 테스트 전용 행을 직접 INSERT.
    ids.requestId = crypto.randomUUID();
    await db.insert(quoteRequests).values({
      id: ids.requestId,
      userId,
      trimId: null,
      status: "open",
      createdAt: new Date().toISOString(),
    });
    ids.customerId = await makeCustomer(userId);
    const created = await createQuote(ids.customerId, baseQuoteBody({ sourceQuoteRequestId: ids.requestId }), db);
    ids.quoteId = created.id;

    await updateQuote(ids.customerId, created.id, { appStatus: "sent" }, db);

    const [req] = await db.select({ status: quoteRequests.status }).from(quoteRequests).where(eq(quoteRequests.id, ids.requestId));
    expect(req.status).toBe("completed"); // 스펙 확정 결정 6
    const [row] = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, created.id));
    expect(row.quoteRequestId).toBe(ids.requestId);
  } finally {
    await cleanup(ids);
  }
});

test("원 요청 삭제된 견적(dangling sourceQuoteRequestId) 발송: FK 차단 없이 성공 — quote_request_id null 강등", async () => {
  const userId = await anyProfileId();
  const ids: { quoteId?: string; customerId?: string } = {};
  try {
    ids.customerId = await makeCustomer(userId);
    // 승격 후 앱 측에서 원 요청이 삭제된 상황 재현 — crm 쪽은 loose id(FK 없음)라 dangling 참조가 남는다.
    // 이걸 그대로 advisor_quotes(엄격 FK)에 upsert하면 위반→롤백→그 견적은 발송 영구 차단(통합 리뷰 I-1).
    const created = await createQuote(ids.customerId, baseQuoteBody({ sourceQuoteRequestId: crypto.randomUUID() }), db);
    ids.quoteId = created.id;

    // ① 에러 없이 발송 성공
    const res = await updateQuote(ids.customerId, created.id, { appStatus: "sent" }, db);
    expect(res?.id).toBe(created.id);

    // ③ 내부 스탬프 정상
    const [sent] = await db.select().from(quotes).where(eq(quotes.id, created.id));
    expect(sent.appStatus).toBe("sent");
    expect(sent.sentAt).not.toBeNull();

    // ② advisor 행 생성 + quote_request_id는 "요청 무관 제안 견적"(스펙 확정 결정 1 어휘)으로 null 강등
    const rows = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].quoteRequestId).toBeNull();
  } finally {
    await cleanup(ids);
  }
});

test("deleteQuote: 발송된 견적 삭제 시 advisor_quotes 행도 회수(보낸 카드 소멸)", async () => {
  const userId = await anyProfileId();
  const ids: { quoteId?: string; customerId?: string } = {};
  try {
    ids.customerId = await makeCustomer(userId);
    const created = await createQuote(ids.customerId, baseQuoteBody(), db);
    ids.quoteId = created.id;

    await updateQuote(ids.customerId, created.id, { appStatus: "sent" }, db);
    const before = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, created.id));
    expect(before).toHaveLength(1);

    const res = await deleteQuote(ids.customerId, created.id, db);
    expect(res?.id).toBe(created.id);

    const after = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, created.id));
    expect(after).toHaveLength(0); // 스펙 확정 결정 7 — loose id라 CASCADE 없음, 훅이 직접 회수
  } finally {
    await cleanup(ids);
  }
});

test("read-through(Task 5): 앱 열람 시각이 getCustomer quotes[].viewedAt에 병합된다", async () => {
  const userId = await anyProfileId();
  const ids: { quoteId?: string; customerId?: string } = {};
  try {
    ids.customerId = await makeCustomer(userId);
    const created = await createQuote(ids.customerId, baseQuoteBody(), db);
    ids.quoteId = created.id;
    await updateQuote(ids.customerId, created.id, { appStatus: "sent" }, db);

    // 앱 열람 시뮬레이션 — 앱이 advisor_quotes.viewed_at을 직접 스탬프한다(열람 SSOT, 스펙 결정 8).
    const viewed = new Date();
    await db.update(advisorQuotes).set({ viewedAt: viewed.toISOString() }).where(eq(advisorQuotes.crmQuoteId, created.id));

    const detail = await getCustomer(ids.customerId, db);
    const quote = detail?.quotes.find((q) => q.id === created.id);
    expect(quote).toBeDefined();
    // crm.quotes.viewed_at은 아무도 write하지 않아 항상 null — 응답 값은 advisor 병합본이어야 한다.
    expect(quote!.viewedAt).not.toBeNull();
    expect(quote!.viewedAt!.getTime()).toBe(viewed.getTime());
  } finally {
    await cleanup(ids);
  }
});

test("read-through(Task 5): 미열람(advisor viewed_at null)이면 viewedAt null 유지", async () => {
  const userId = await anyProfileId();
  const ids: { quoteId?: string; customerId?: string } = {};
  try {
    ids.customerId = await makeCustomer(userId);
    const created = await createQuote(ids.customerId, baseQuoteBody(), db);
    ids.quoteId = created.id;
    await updateQuote(ids.customerId, created.id, { appStatus: "sent" }, db);
    // 발송 직후 = advisor 행 존재·viewed_at null(전달·미열람).

    const detail = await getCustomer(ids.customerId, db);
    const quote = detail?.quotes.find((q) => q.id === created.id);
    expect(quote).toBeDefined();
    expect(quote!.viewedAt).toBeNull();
  } finally {
    await cleanup(ids);
  }
});

test("trimId 있는 견적 발송: catalog.trims 조인으로 sublineLabel 년식 조달", async () => {
  const userId = await anyProfileId();
  const trim = await anyTrimWithModelYear();
  const ids: { quoteId?: string; customerId?: string } = {};
  try {
    ids.customerId = await makeCustomer(userId);
    const created = await createQuote(ids.customerId, baseQuoteBody({ trimId: trim.id }), db);
    ids.quoteId = created.id;

    await updateQuote(ids.customerId, created.id, { appStatus: "sent" }, db);

    const [row] = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, created.id));
    const payload = row.payload as Record<string, unknown>;
    // crm.quotes에 model_year 없음 — 발송 훅이 trimId→catalog.trims 조인으로 조달(편차 노트).
    expect(String(payload.sublineLabel)).toStartWith(`${trim.modelYear}년식 ㅣ `);
  } finally {
    await cleanup(ids);
  }
});
