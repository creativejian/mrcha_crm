import { afterAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { customerDeliveries, customers, quotes } from "../db/schema";

const db = getDefaultDb();
const suffix = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const ids: string[] = [];

// 정리 순서: quotes.customer_id FK는 cascade가 아니라 견적 먼저(customer-delivery.test.ts와 동일).
afterAll(async () => {
  for (const id of ids.splice(0)) {
    await db.delete(quotes).where(eq(quotes.customerId, id));
    await db.delete(customers).where(eq(customers.id, id));
  }
});

async function seedCustomer(): Promise<string> {
  const [row] = await db.insert(customers).values({ customerCode: `CU-DLVI-${suffix()}`, name: "출고정보파생검증" }).returning({ id: customers.id });
  ids.push(row.id);
  return row.id;
}

// admin 고정 — 이 파일의 관심사는 delivery upsert 의미론이지 role이 아니다. staff(랜덤 sub)는
// customerScopeGate(role scope 2026-07-21)가 미배정 픽스처를 404로 선차단해 전 테스트가 죽는다.
// staff 스코프 자체는 customers.role-scope.test.ts가 /:id 하위 공통으로 잠근다.
async function put(customerId: string, body: unknown, role = "admin"): Promise<Response> {
  const { token, keyResolver, issuer } = await makeTestAuth(role, crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  return app.request(`/api/customers/${customerId}/delivery`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FULL = { contractVehicle: "BMW 520i", contractDate: "2026-07-15", lender: "iM캐피탈", deliveredDate: null, deliveryMemo: "탁송 조율", sourceQuoteId: null };

test("PUT /delivery — 생성 → 갱신 왕복(고객당 1행 upsert) + DB 대조 + updated_at 스탬프", async () => {
  const cid = await seedCustomer();
  const created = await put(cid, FULL);
  expect(created.status).toBe(200);
  // 생성 직후: 두 스탬프가 같은 statement의 now()라 동일 — 아래 "갱신 후 전진"의 대조군.
  const [createdStamp] = await db
    .select({ same: sql<boolean>`${customerDeliveries.updatedAt} = ${customerDeliveries.createdAt}` })
    .from(customerDeliveries)
    .where(eq(customerDeliveries.customerId, cid));
  expect(createdStamp.same).toBe(true);
  const updated = await put(cid, { ...FULL, deliveredDate: "2026-07-20", deliveryMemo: null });
  expect(updated.status).toBe(200);
  const rows = await db.select().from(customerDeliveries).where(eq(customerDeliveries.customerId, cid));
  expect(rows).toHaveLength(1); // upsert — 2행이 아니라 1행
  expect(rows[0].deliveredDate).toBe("2026-07-20");
  expect(rows[0].deliveryMemo).toBeNull();
  expect(rows[0].contractVehicle).toBe("BMW 520i");
  // 배치 11 A#5① — 갱신 스탬프 잠금(A#1 활동 파생 편입으로 updated_at이 load-bearing).
  // ⚠️ **비교는 DB 안에서 한다**(2026-07-23 정정). JS Date로 꺼내 비교하던 구 단언은 두 실패
  // 모드 사이에 끼어 있었다 — `>`는 앱↔DB 시계 스큐가 크면 깨지고(그래서 `not.toBe`로 완화됐다),
  // `not.toBe`는 스큐가 ~0일 때 두 호출이 같은 ms에 떨어지면 깨진다(JS Date는 ms 절삭 — 전체
  // 실행에서만 실패하던 정체가 이것이다). **즉 통과하는 쪽이 오히려 시계가 더 틀어진 상태였다.**
  // DB의 timestamptz는 마이크로초 해상도라 이 비교는 두 축 모두에 무관하다.
  const [stamp] = await db
    .select({ bumped: sql<boolean>`${customerDeliveries.updatedAt} > ${customerDeliveries.createdAt}` })
    .from(customerDeliveries)
    .where(eq(customerDeliveries.customerId, cid));
  expect(stamp.bumped).toBe(true);
});

test("PUT /delivery — 빈 문자열은 null로 정규화(값 지우기 경로)", async () => {
  const cid = await seedCustomer();
  const res = await put(cid, { ...FULL, contractVehicle: "  ", lender: "" });
  expect(res.status).toBe(200);
  const [row] = await db.select().from(customerDeliveries).where(eq(customerDeliveries.customerId, cid));
  expect(row.contractVehicle).toBeNull();
  expect(row.lender).toBeNull();
});

test("PUT /delivery — 날짜 포맷 위반은 400(로케일 오배치 무경고 해석 차단 — scheduleBody 미러)", async () => {
  const cid = await seedCustomer();
  expect((await put(cid, { ...FULL, contractDate: "07/15/2026" })).status).toBe(400);
  expect((await put(cid, { ...FULL, deliveredDate: "2026-7-5" })).status).toBe(400);
});

test("PUT /delivery — 타 고객 견적을 sourceQuoteId로 보내면 400(provenance 오염 차단)", async () => {
  const cid = await seedCustomer();
  const other = await seedCustomer();
  const [q] = await db.insert(quotes).values({ customerId: other, quoteCode: `QT-DLVI-${suffix()}`, decisionStatus: "contracting" }).returning({ id: quotes.id });
  const res = await put(cid, { ...FULL, sourceQuoteId: q.id });
  expect(res.status).toBe(400);
});

test("PUT /delivery — 본인 견적 sourceQuoteId는 저장된다", async () => {
  const cid = await seedCustomer();
  const [q] = await db.insert(quotes).values({ customerId: cid, quoteCode: `QT-DLVI-${suffix()}`, decisionStatus: "contracting" }).returning({ id: quotes.id });
  const res = await put(cid, { ...FULL, sourceQuoteId: q.id });
  expect(res.status).toBe(200);
  const [row] = await db.select().from(customerDeliveries).where(eq(customerDeliveries.customerId, cid));
  expect(row.sourceQuoteId).toBe(q.id);
});

test("PUT /delivery — 미존재 견적 id sourceQuoteId도 400(배치 11 A#5② — 가드 제거 변이 시 FK 500 강등 차단)", async () => {
  const cid = await seedCustomer();
  const res = await put(cid, { ...FULL, sourceQuoteId: crypto.randomUUID() });
  expect(res.status).toBe(400);
});

test("PUT /delivery — 달력 비실존 날짜(2026-02-31)는 SQL 원문이 아니라 한글 사유(배치 11 A#2)", async () => {
  const cid = await seedCustomer();
  const res = await put(cid, { ...FULL, contractDate: "2026-02-31" });
  expect(res.status).toBe(500); // zod regex(자릿수)는 통과 — DB 캐스트 실패를 dbErrorMessage가 매핑
  const body = (await res.json()) as { error: string };
  expect(body.error).toBe("허용되지 않는 날짜입니다.");
});

test("PUT /delivery — 미존재 고객 404 · dealer 403(전역 게이트)", async () => {
  expect((await put(crypto.randomUUID(), FULL)).status).toBe(404);
  const cid = await seedCustomer();
  expect((await put(cid, FULL, "dealer")).status).toBe(403);
});
