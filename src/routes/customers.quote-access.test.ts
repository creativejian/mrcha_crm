import { afterEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { createQuote } from "../db/queries/customer-quotes";
import { customers, quotes } from "../db/schema";

// ── 견적 쓰기 권한 게이트(담당자 스코프) ─────────────────────────────
// 2026-07-21 이사님 결정(D-1①/D-2①/D-3①/D-4②, spec 2026-07-21-crm-quote-write-access):
// admin·manager = 전체 / staff = 본인 담당(advisor_id 일치)만 / 미배정 고객 = admin·manager만.
// 적용 = 견적 쓰기 전반(생성·수정·삭제·원본). 서버가 진짜 게이트다 — UI 숨김은 UX 보조.
// 403은 어떤 변이도 남기지 않아야 한다(행 불변 단언 동반).

const db = getDefaultDb();

const STAFF_A = "11111111-1111-4111-8111-111111111111"; // 담당 상담사
const STAFF_B = "22222222-2222-4222-8222-222222222222"; // 타 상담사

const seeded: string[] = [];

async function seedCustomer(advisorId: string | null): Promise<string> {
  const [c] = await db
    .insert(customers)
    .values({
      customerCode: `CU-QWACC-${crypto.randomUUID().slice(0, 8)}`,
      name: "견적권한테스트",
      advisorId,
      advisorName: advisorId ? "권한테스트담당" : null,
    })
    .returning({ id: customers.id });
  seeded.push(c.id);
  return c.id;
}

const baseQuote = {
  brandName: "테스트브랜드",
  modelName: "테스트모델",
  trimName: "테스트트림",
  scenarios: [{ scenarioNo: 1, purchaseMethod: "운용리스" as const, termMonths: 48, monthlyPayment: "1000000" }],
};

async function seedQuote(customerId: string): Promise<string> {
  const row = await db.transaction((tx) => createQuote(customerId, baseQuote, tx));
  return row.id;
}

afterEach(async () => {
  for (const id of seeded.splice(0)) {
    await db.delete(quotes).where(eq(quotes.customerId, id));
    await db.delete(customers).where(eq(customers.id, id));
  }
});

async function appFor(role: "admin" | "manager" | "staff", sub: string) {
  const { token, keyResolver, issuer } = await makeTestAuth(role, sub);
  return {
    app: createApp({ keyResolver, issuer }),
    h: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };
}

test("staff 타 담당 고객 — PATCH 403 + 행 불변(변이 없음)", async () => {
  const cid = await seedCustomer(STAFF_A);
  const qid = await seedQuote(cid);
  const { app, h } = await appFor("staff", STAFF_B);
  const res = await app.request(`/api/customers/${cid}/quotes/${qid}`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify({ decisionStatus: "considering" }),
  });
  expect(res.status).toBe(403);
  const [row] = await db.select({ decisionStatus: quotes.decisionStatus }).from(quotes).where(eq(quotes.id, qid));
  expect(row.decisionStatus).not.toBe("considering");
});

test("staff 타 담당 고객 — DELETE 403 + 행 생존", async () => {
  const cid = await seedCustomer(STAFF_A);
  const qid = await seedQuote(cid);
  const { app, h } = await appFor("staff", STAFF_B);
  const res = await app.request(`/api/customers/${cid}/quotes/${qid}`, { method: "DELETE", headers: h });
  expect(res.status).toBe(403);
  const rows = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, qid));
  expect(rows.length).toBe(1);
});

test("staff 타 담당 고객 — POST 생성 403 + 견적 0건", async () => {
  const cid = await seedCustomer(STAFF_A);
  const { app, h } = await appFor("staff", STAFF_B);
  const res = await app.request(`/api/customers/${cid}/quotes`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(baseQuote),
  });
  expect(res.status).toBe(403);
  const rows = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.customerId, cid));
  expect(rows.length).toBe(0);
});

test("staff 타 담당 고객 — 원본 삭제도 403(게이트가 원본 404보다 먼저)", async () => {
  const cid = await seedCustomer(STAFF_A);
  const qid = await seedQuote(cid);
  const { app, h } = await appFor("staff", STAFF_B);
  const res = await app.request(`/api/customers/${cid}/quotes/${qid}/original`, { method: "DELETE", headers: h });
  expect(res.status).toBe(403);
});

test("staff 본인 담당 고객 — 생성 201 → 수정 200 → 삭제 200 (발송완료 구분 없음 = D-1 ①)", async () => {
  const cid = await seedCustomer(STAFF_A);
  const { app, h } = await appFor("staff", STAFF_A);
  const created = await app.request(`/api/customers/${cid}/quotes`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(baseQuote),
  });
  expect(created.status).toBe(201);
  const { id: qid } = (await created.json()) as { id: string };
  const patched = await app.request(`/api/customers/${cid}/quotes/${qid}`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify({ decisionStatus: "considering" }),
  });
  expect(patched.status).toBe(200);
  const deleted = await app.request(`/api/customers/${cid}/quotes/${qid}`, { method: "DELETE", headers: h });
  expect(deleted.status).toBe(200);
});

test("미배정 고객 — staff 생성 403(D-3 ① — 본인 배정부터), admin 생성 201", async () => {
  const cid = await seedCustomer(null);
  const staff = await appFor("staff", STAFF_A);
  const denied = await staff.app.request(`/api/customers/${cid}/quotes`, {
    method: "POST",
    headers: staff.h,
    body: JSON.stringify(baseQuote),
  });
  expect(denied.status).toBe(403);
  const admin = await appFor("admin", STAFF_B);
  const allowed = await admin.app.request(`/api/customers/${cid}/quotes`, {
    method: "POST",
    headers: admin.h,
    body: JSON.stringify(baseQuote),
  });
  expect(allowed.status).toBe(201);
});

test("manager — 타 담당 고객 PATCH 200(D-2 ① — admin 동급)", async () => {
  const cid = await seedCustomer(STAFF_A);
  const qid = await seedQuote(cid);
  const { app, h } = await appFor("manager", STAFF_B);
  const res = await app.request(`/api/customers/${cid}/quotes/${qid}`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify({ decisionStatus: "considering" }),
  });
  expect(res.status).toBe(200);
});

test("미존재 고객 — 게이트가 404를 먼저 준다(권한 판정 전 존재 확인)", async () => {
  const { app, h } = await appFor("admin", STAFF_A);
  const res = await app.request(`/api/customers/${crypto.randomUUID()}/quotes/${crypto.randomUUID()}`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify({ decisionStatus: "considering" }),
  });
  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("고객");
});
