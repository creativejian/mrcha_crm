import { test, expect } from "bun:test";
import { eq, gt, inArray } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { ConflictError } from "../lib/errors";
import { createCustomerFromRequest, getQuoteRequestDetail, linkRequestToCustomer, listQuoteRequests, listQuoteRequestsByUser } from "../db/queries/quote-requests";
import { createQuote } from "../db/queries/customer-quotes";
import { quoteRequests as quoteRequestsTable, quoteRequestOptions as quoteRequestOptionsTable } from "../db/public-app";
import { customers, quotes } from "../db/schema";

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
      // 같은 앱 계정이 이미 다른 고객에 연결돼 있으면 가드가 막으므로 기존 연결 해제(롤백됨).
      await tx.update(customers).set({ appUserId: null }).where(eq(customers.appUserId, req.userId));
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

test("linkRequestToCustomer: 같은 앱 계정이 이미 다른 고객에 연결 → ConflictError (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id, userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  const two = await db.select({ id: customers.id }).from(customers).limit(2);
  expect(two.length).toBe(2);
  await expect(
    db.transaction(async (tx) => {
      await tx.update(customers).set({ appUserId: null }).where(eq(customers.appUserId, req.userId));
      const linked = await linkRequestToCustomer(req.id, two[0].id, tx);
      expect(linked?.id).toBe(two[0].id);
      // 두 번째 고객으로 재연결 시도 — app_user_id 중복 고객 생성 경로를 fail-closed로 차단.
      await expect(linkRequestToCustomer(req.id, two[1].id, tx)).rejects.toThrow(ConflictError);
      throw new Error("ROLLBACK"); // 부작용 롤백 — 실 DB에 변경 안 남김
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

test("listQuoteRequests: source가 붙은 견적이 있으면 promotedQuoteCount 증가 (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [cust] = await db.select({ id: customers.id }).from(customers).limit(1);
  const [req] = await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      const before = (await listQuoteRequests(tx)).find((r) => r.id === req.id);
      await createQuote(cust.id, { sourceQuoteRequestId: req.id }, tx);
      const after = (await listQuoteRequests(tx)).find((r) => r.id === req.id);
      expect(after?.promotedQuoteCount).toBe((before?.promotedQuoteCount ?? 0) + 1);
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
});

test("listQuoteRequestsByUser: 해당 user 요청만 반환(id 집합 일치)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  const userReqIds = (
    await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).where(eq(quoteRequestsTable.userId, req.userId))
  ).map((r) => r.id);
  const result = await listQuoteRequestsByUser(req.userId);
  expect(result.length).toBe(userReqIds.length);
  const idSet = new Set(userReqIds);
  for (const r of result) expect(idSet.has(r.id)).toBe(true);
});

test("listQuoteRequestsByUser: 없는 user → 빈 배열", async () => {
  const result = await listQuoteRequestsByUser("00000000-0000-0000-0000-000000000000");
  expect(result).toEqual([]);
});

test("GET /api/quote-requests/:id → deposit_ratio>0 실데이터로 period/depositType/depositRatio/rentalDeposit 왕복", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const db = getDefaultDb();
  const [row] = await db
    .select({
      id: quoteRequestsTable.id,
      period: quoteRequestsTable.period,
      depositType: quoteRequestsTable.depositType,
      depositRatio: quoteRequestsTable.depositRatio,
      rentalDeposit: quoteRequestsTable.rentalDeposit,
    })
    .from(quoteRequestsTable)
    .where(gt(quoteRequestsTable.depositRatio, 0))
    .limit(1);
  // 스펙 실측(2026-07-04, deposit_ratio>0 61건) 기준 실데이터에 존재해야 함 — 없으면 테스트 전제 붕괴.
  expect(row).toBeDefined();
  const res = await app.request(`/api/quote-requests/${row.id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    period: number | null;
    depositType: string | null;
    depositRatio: number | null;
    rentalDeposit: number | null;
  };
  expect(body.period).toBe(row.period);
  expect(body.depositType).toBe(row.depositType);
  expect(body.depositRatio).toBe(row.depositRatio);
  expect(body.rentalDeposit).toBe(row.rentalDeposit);
});

test("GET /api/quote-requests → 승격 견적 2건 생성 시 promotedQuoteIds 최신순(desc) + promotedQuoteCount +2 (실 insert, finally 삭제)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const db = getDefaultDb();
  const [cust] = await db.select({ id: customers.id }).from(customers).limit(1);
  const [req] = await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1);

  const beforeRes = await app.request("/api/quote-requests", { headers: { Authorization: `Bearer ${token}` } });
  const beforeBody = (await beforeRes.json()) as Array<{ id: string; promotedQuoteCount: number }>;
  const beforeCount = beforeBody.find((r) => r.id === req.id)?.promotedQuoteCount ?? 0;

  const first = await createQuote(cust.id, { sourceQuoteRequestId: req.id, status: "작성중" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = await createQuote(cust.id, { sourceQuoteRequestId: req.id, status: "작성중" });

  try {
    const res = await app.request("/api/quote-requests", { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as Array<{ id: string; promotedQuoteIds: string[]; promotedQuoteCount: number }>;
    const target = body.find((r) => r.id === req.id);
    // 공유 master라 뽑힌 요청에 기존 승격 견적이 있어도 안전(최신 2건 선두+총 길이만 단언 — desc 정렬 보장과 동치).
    expect(target?.promotedQuoteIds.slice(0, 2)).toEqual([second.id, first.id]);
    expect(target?.promotedQuoteIds.length).toBe(beforeCount + 2);
    expect(target?.promotedQuoteCount).toBe(beforeCount + 2);
  } finally {
    await db.delete(quotes).where(inArray(quotes.id, [first.id, second.id]));
  }
});

test("listQuoteRequests(전체) 길이 ≥ listQuoteRequestsByUser(부분) — 추출 회귀 가드", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  const all = await listQuoteRequests();
  const sub = await listQuoteRequestsByUser(req.userId);
  expect(all.length).toBeGreaterThanOrEqual(sub.length);
  for (const r of all) {
    expect(typeof r.optionCount).toBe("number");
    expect(["app_user", "phone", "none"]).toContain(r.matchType);
  }
});
