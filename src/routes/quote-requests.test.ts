import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { createCustomerFromRequest, getQuoteRequestDetail, linkRequestToCustomer } from "../db/queries/quote-requests";
import { quoteRequests as quoteRequestsTable, quoteRequestOptions as quoteRequestOptionsTable } from "../db/public-app";
import { customers } from "../db/schema";

test("GET /api/quote-requests → 200, 배열", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/quote-requests", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

test("GET /api/quote-requests 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/quote-requests");
  expect(res.status).toBe(401);
});

test("GET /api/quote-requests → 행 형태(차량명/옵션수/매칭)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/quote-requests", { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as Array<{
    id: string; createdAt: string; optionCount: number;
    matchType: string; brandName: string | null; status: string | null;
  }>;
  expect(body.length).toBeGreaterThan(0);
  for (const r of body) {
    expect(typeof r.id).toBe("string");
    expect(typeof r.optionCount).toBe("number");
    expect(["app_user", "phone", "none"]).toContain(r.matchType);
    expect(r.brandName === null || typeof r.brandName === "string").toBe(true);
  }
});

test("linkRequestToCustomer: 고객 app_user_id에 요청 user_id를 set (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id, userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  const [cust] = await db.select({ id: customers.id }).from(customers).limit(1);
  await expect(
    db.transaction(async (tx) => {
      const linked = await linkRequestToCustomer(req.id, cust.id, tx);
      expect(linked?.id).toBe(cust.id);
      const [c] = await tx.select({ appUserId: customers.appUserId }).from(customers).where(eq(customers.id, cust.id));
      expect(c.appUserId).toBe(req.userId);
      throw new Error("ROLLBACK"); // 부작용 롤백 — 실 DB에 변경 안 남김
    }),
  ).rejects.toThrow("ROLLBACK");
});

test("createCustomerFromRequest: 신규 고객 생성 + CU 코드 + app_user_id (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id, userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      const created = await createCustomerFromRequest(req.id, tx);
      expect(created?.customerCode).toMatch(/^CU-\d{4}-\d{4}$/);
      const [c] = await tx.select({ appUserId: customers.appUserId }).from(customers).where(eq(customers.id, created!.id));
      expect(c.appUserId).toBe(req.userId);
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
});

test("createCustomerFromRequest: 같은 user 중복 호출은 기존 고객 반환 (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      const first = await createCustomerFromRequest(req.id, tx);
      const second = await createCustomerFromRequest(req.id, tx);
      expect(second?.id).toBe(first?.id); // 두 번째는 기존 반환(중복 생성 없음)
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
});

test("linkRequestToCustomer: 없는 요청 → null", async () => {
  const db = getDefaultDb();
  const [cust] = await db.select({ id: customers.id }).from(customers).limit(1);
  const r = await linkRequestToCustomer("00000000-0000-0000-0000-000000000000", cust.id);
  expect(r).toBeNull();
});

test("getQuoteRequestDetail: 요청의 trimId·paymentMethod·optionIds 반환", async () => {
  const db = getDefaultDb();
  // 옵션이 있는 요청을 하나 고른다(없으면 첫 요청).
  const [opt] = await db.select({ reqId: quoteRequestOptionsTable.quoteRequestId, optId: quoteRequestOptionsTable.trimOptionId }).from(quoteRequestOptionsTable).limit(1);
  const targetId = opt?.reqId
    ?? (await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1))[0].id;
  const detail = await getQuoteRequestDetail(targetId);
  expect(detail).not.toBeNull();
  expect(detail!.id).toBe(targetId);
  expect(Array.isArray(detail!.optionIds)).toBe(true);
  // 옵션 있는 요청을 골랐다면 실제로 채워지는지 검증(빈 배열 false positive 방지). opt 폴백 시엔 옵션 0개 가능.
  if (opt) expect(detail!.optionIds.length).toBeGreaterThan(0);
  // trimId는 number 또는 null
  expect(detail!.trimId === null || typeof detail!.trimId === "number").toBe(true);
});

test("getQuoteRequestDetail: 없는 요청 → null", async () => {
  const detail = await getQuoteRequestDetail("00000000-0000-0000-0000-000000000000");
  expect(detail).toBeNull();
});

test("GET /api/quote-requests/:id → 200 + detail 형태", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const [req] = await getDefaultDb().select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1);
  const res = await app.request(`/api/quote-requests/${req.id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: string; trimId: number | null; paymentMethod: string | null; optionIds: number[] };
  expect(body.id).toBe(req.id);
  expect(Array.isArray(body.optionIds)).toBe(true);
});
