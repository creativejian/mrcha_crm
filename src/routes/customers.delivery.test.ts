import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

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

async function put(customerId: string, body: unknown, role = "staff"): Promise<Response> {
  const { token, keyResolver, issuer } = await makeTestAuth(role, crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  return app.request(`/api/customers/${customerId}/delivery`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FULL = { contractVehicle: "BMW 520i", contractDate: "2026-07-15", lender: "iM캐피탈", deliveredDate: null, deliveryMemo: "탁송 조율", sourceQuoteId: null };

test("PUT /delivery — 생성 → 갱신 왕복(고객당 1행 upsert) + DB 대조", async () => {
  const cid = await seedCustomer();
  const created = await put(cid, FULL);
  expect(created.status).toBe(200);
  const updated = await put(cid, { ...FULL, deliveredDate: "2026-07-20", deliveryMemo: null });
  expect(updated.status).toBe(200);
  const rows = await db.select().from(customerDeliveries).where(eq(customerDeliveries.customerId, cid));
  expect(rows).toHaveLength(1); // upsert — 2행이 아니라 1행
  expect(rows[0].deliveredDate).toBe("2026-07-20");
  expect(rows[0].deliveryMemo).toBeNull();
  expect(rows[0].contractVehicle).toBe("BMW 520i");
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

test("PUT /delivery — 미존재 고객 404 · dealer 403(전역 게이트)", async () => {
  expect((await put(crypto.randomUUID(), FULL)).status).toBe(404);
  const cid = await seedCustomer();
  expect((await put(cid, FULL, "dealer")).status).toBe(403);
});
