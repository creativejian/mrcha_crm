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
// 차단은 어떤 변이도 남기지 않아야 한다(행 불변 단언 동반).
//
// ⚠️ 기대값 개정(2026-07-21 role scope spec S-7): 같은 날 도입된 customerScopeGate(화면 role
// scope)가 /:id 하위 전체에서 staff 타 담당·미배정을 **404(존재 비노출)로 선행 차단**한다.
// 그래서 아래 staff 거부 케이스의 기대는 403이 아니라 404다. quoteWriteGate의 403은 안쪽
// 그물로 잔존 — 스코프 게이트가 회귀(제거)되면 응답이 403으로 바뀌어 이 테스트가 여전히 잡는다.

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

test("staff 타 담당 고객 — PATCH 404(스코프 선행·존재 비노출) + 행 불변(변이 없음)", async () => {
  const cid = await seedCustomer(STAFF_A);
  const qid = await seedQuote(cid);
  const { app, h } = await appFor("staff", STAFF_B);
  const res = await app.request(`/api/customers/${cid}/quotes/${qid}`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify({ decisionStatus: "considering" }),
  });
  expect(res.status).toBe(404);
  const [row] = await db.select({ decisionStatus: quotes.decisionStatus }).from(quotes).where(eq(quotes.id, qid));
  expect(row.decisionStatus).not.toBe("considering");
});

test("staff 타 담당 고객 — DELETE 404(스코프 선행) + 행 생존", async () => {
  const cid = await seedCustomer(STAFF_A);
  const qid = await seedQuote(cid);
  const { app, h } = await appFor("staff", STAFF_B);
  const res = await app.request(`/api/customers/${cid}/quotes/${qid}`, { method: "DELETE", headers: h });
  expect(res.status).toBe(404);
  const rows = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, qid));
  expect(rows.length).toBe(1);
});

test("staff 타 담당 고객 — POST 생성 404(스코프 선행) + 견적 0건", async () => {
  const cid = await seedCustomer(STAFF_A);
  const { app, h } = await appFor("staff", STAFF_B);
  const res = await app.request(`/api/customers/${cid}/quotes`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(baseQuote),
  });
  expect(res.status).toBe(404);
  const rows = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.customerId, cid));
  expect(rows.length).toBe(0);
});

test("staff 타 담당 고객 — 원본 삭제도 404(게이트가 원본 존재 확인보다 먼저)", async () => {
  const cid = await seedCustomer(STAFF_A);
  const qid = await seedQuote(cid);
  const { app, h } = await appFor("staff", STAFF_B);
  const res = await app.request(`/api/customers/${cid}/quotes/${qid}/original`, { method: "DELETE", headers: h });
  expect(res.status).toBe(404);
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

test("미배정 고객 — staff 생성 404(D-3 ① — 본인 배정부터·스코프 선행), admin 생성 201", async () => {
  const cid = await seedCustomer(null);
  const staff = await appFor("staff", STAFF_A);
  const denied = await staff.app.request(`/api/customers/${cid}/quotes`, {
    method: "POST",
    headers: staff.h,
    body: JSON.stringify(baseQuote),
  });
  expect(denied.status).toBe(404);
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

// ── 게이트 "배선" 잠금 — 5라우트 전부 (배치 12 A#6) ─────────────────
// staff 거부 축은 customerScopeGate(404)가 선행해 quoteWriteGate 제거 변이가 무증상이었다
// (V1 실변이: PATCH만 RED — 그마저 위 미존재 문구 단언 하나). admin + 미존재 고객은 스코프
// 게이트를 "all"로 통과해 quoteWriteGate의 404("고객")가 유일 산출자 — 게이트를 떼면 각 라우트의
// 후속 처리(견적 404·FK·파일 400)로 응답이 갈라져 라우트별로 정확히 RED가 된다.
for (const [label, makeReq] of [
  ["POST 생성", (cid: string) => ({ path: `/api/customers/${cid}/quotes`, init: { method: "POST", body: JSON.stringify(baseQuote) } })],
  ["DELETE 삭제", (cid: string) => ({ path: `/api/customers/${cid}/quotes/${crypto.randomUUID()}`, init: { method: "DELETE" } })],
  ["POST 원본 첨부", (cid: string) => ({ path: `/api/customers/${cid}/quotes/${crypto.randomUUID()}/original`, init: { method: "POST" } })],
  ["DELETE 원본 삭제", (cid: string) => ({ path: `/api/customers/${cid}/quotes/${crypto.randomUUID()}/original`, init: { method: "DELETE" } })],
] as const) {
  test(`게이트 배선 — ${label}: admin + 미존재 고객 → 404 '고객'`, async () => {
    const { app, h } = await appFor("admin", STAFF_A);
    const { path, init } = makeReq(crypto.randomUUID());
    const res = await app.request(path, { ...init, headers: h });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("고객");
  });
}
