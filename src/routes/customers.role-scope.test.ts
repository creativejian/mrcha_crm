import { afterEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { customerMemos, customers } from "../db/schema";

// ── 고객 목록/상세 화면 role scope 게이트 ───────────────────────────
// 2026-07-21 이사님 A-3 원칙의 나머지 반쪽(spec 2026-07-21-crm-customer-role-scope):
// admin·manager = 전체 / staff = 본인 담당(advisor_id 일치)만 / 미배정·dealer 등 = fail-closed.
// 차단은 403이 아니라 **404 + 미존재와 byte-동일 문구**(존재 비노출 — AI #176 "조회 결과 없음" 미러).
// 목록은 listCustomers scope WHERE, 상세+자식은 /:id 하위 전 라우트를 미들웨어 한 겹이 커버한다.

const db = getDefaultDb();

const STAFF_A = "31111111-1111-4111-8111-111111111111"; // 담당 상담사
const STAFF_B = "32222222-2222-4222-8222-222222222222"; // 타 상담사
const DEALER_X = "33333333-3333-4333-8333-333333333333"; // 딜러(담당 고객 개념 없음)

const seeded: string[] = [];
const seededCodes: string[] = [];

async function seedCustomer(advisorId: string | null): Promise<{ id: string; code: string }> {
  const code = `CU-RSCOPE-${crypto.randomUUID().slice(0, 8)}`;
  const [c] = await db
    .insert(customers)
    .values({
      customerCode: code,
      name: "롤스코프테스트",
      advisorId,
      advisorName: advisorId ? "스코프테스트담당" : null,
    })
    .returning({ id: customers.id });
  seeded.push(c.id);
  seededCodes.push(code);
  return { id: c.id, code };
}

afterEach(async () => {
  for (const id of seeded.splice(0)) {
    await db.delete(customerMemos).where(eq(customerMemos.customerId, id));
    await db.delete(customers).where(eq(customers.id, id));
  }
  seededCodes.splice(0);
});

async function appFor(role: "admin" | "manager" | "staff" | "dealer", sub: string) {
  const { token, keyResolver, issuer } = await makeTestAuth(role, sub);
  return {
    app: createApp({ keyResolver, issuer }),
    h: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };
}

type ListRow = { id: string; customerCode: string; advisorId: string | null };

test("목록 — staff는 본인 담당만(타 담당·미배정 제외), 전 행 advisor_id 일치", async () => {
  const mine = await seedCustomer(STAFF_A);
  const other = await seedCustomer(STAFF_B);
  const unassigned = await seedCustomer(null);
  const { app, h } = await appFor("staff", STAFF_A);
  const res = await app.request("/api/customers", { headers: h });
  expect(res.status).toBe(200);
  const rows = (await res.json()) as ListRow[];
  const codes = rows.map((r) => r.customerCode);
  expect(codes).toContain(mine.code);
  expect(codes).not.toContain(other.code);
  expect(codes).not.toContain(unassigned.code);
  // 픽스처 밖 실 고객까지 포함해 전 행이 본인 담당이어야 한다(WHERE 누수 0).
  expect(rows.every((r) => r.advisorId === STAFF_A)).toBe(true);
});

test("목록 — admin은 전체(픽스처 3종 전부 포함)", async () => {
  const a = await seedCustomer(STAFF_A);
  const b = await seedCustomer(STAFF_B);
  const u = await seedCustomer(null);
  const { app, h } = await appFor("admin", STAFF_A);
  const res = await app.request("/api/customers", { headers: h });
  const codes = ((await res.json()) as ListRow[]).map((r) => r.customerCode);
  expect(codes).toContain(a.code);
  expect(codes).toContain(b.code);
  expect(codes).toContain(u.code);
});

test("목록 — dealer는 빈 목록(fail-closed, #220 쓰기 차단의 읽기 확장)", async () => {
  await seedCustomer(STAFF_A);
  const { app, h } = await appFor("dealer", DEALER_X);
  const res = await app.request("/api/customers", { headers: h });
  expect(res.status).toBe(200);
  expect(((await res.json()) as ListRow[]).length).toBe(0);
});

test("상세 — staff 타 담당 404, 문구는 미존재 404와 byte-동일(존재 비노출)", async () => {
  const other = await seedCustomer(STAFF_B);
  const { app, h } = await appFor("staff", STAFF_A);
  const denied = await app.request(`/api/customers/${other.id}`, { headers: h });
  expect(denied.status).toBe(404);
  const missing = await app.request(`/api/customers/${crypto.randomUUID()}`, { headers: h });
  expect(missing.status).toBe(404);
  const deniedBody = (await denied.json()) as { error: string };
  const missingBody = (await missing.json()) as { error: string };
  expect(deniedBody.error).toBe(missingBody.error);
});

test("상세 — staff 본인 담당 200 / manager 타 담당 200", async () => {
  const mine = await seedCustomer(STAFF_A);
  const staff = await appFor("staff", STAFF_A);
  expect((await staff.app.request(`/api/customers/${mine.id}`, { headers: staff.h })).status).toBe(200);
  const manager = await appFor("manager", STAFF_B);
  expect((await manager.app.request(`/api/customers/${mine.id}`, { headers: manager.h })).status).toBe(200);
});

test("상세 — 미배정 고객은 staff 404, admin 200 (D-3① 미러)", async () => {
  const u = await seedCustomer(null);
  const staff = await appFor("staff", STAFF_A);
  expect((await staff.app.request(`/api/customers/${u.id}`, { headers: staff.h })).status).toBe(404);
  const admin = await appFor("admin", STAFF_A);
  expect((await admin.app.request(`/api/customers/${u.id}`, { headers: admin.h })).status).toBe(200);
});

test("자식 쓰기 — staff 타 담당 메모 POST 404 + 행 0(변이 없음)", async () => {
  const other = await seedCustomer(STAFF_B);
  const { app, h } = await appFor("staff", STAFF_A);
  const res = await app.request(`/api/customers/${other.id}/memos`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ body: "스코프 침범 시도" }),
  });
  expect(res.status).toBe(404);
  const rows = await db.select({ id: customerMemos.id }).from(customerMemos).where(eq(customerMemos.customerId, other.id));
  expect(rows.length).toBe(0);
});

test("자식 쓰기 — staff 본인 담당 메모 POST 201(과차단 없음)", async () => {
  const mine = await seedCustomer(STAFF_A);
  const { app, h } = await appFor("staff", STAFF_A);
  const res = await app.request(`/api/customers/${mine.id}/memos`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ body: "본인 담당 메모" }),
  });
  expect(res.status).toBe(201);
});

test("자식 읽기 — staff 타 담당 quote-requests GET도 404(읽기 포함 전면 차단)", async () => {
  const other = await seedCustomer(STAFF_B);
  const { app, h } = await appFor("staff", STAFF_A);
  const res = await app.request(`/api/customers/${other.id}/quote-requests`, { headers: h });
  expect(res.status).toBe(404);
});

test("비-uuid id — 게이트가 조회 없이 통과, 기존 zValidator 400 유지(500 아님)", async () => {
  const { app, h } = await appFor("staff", STAFF_A);
  const res = await app.request("/api/customers/not-a-uuid", { headers: h });
  expect(res.status).toBe(400);
});

// ── 담당자 재배정 게이트(2026-07-21 staff 실기 감사 발견) ──────────────
// staff는 본인 담당만 보므로, 담당자를 남으로 바꾸면 그 고객이 즉시 목록에서 사라지고 상세도
// 404가 되어 **스스로 되돌릴 수 없다**(admin 개입 필요). 되돌릴 수 없는 조작이라는 점에서
// 고객 하드 삭제(#212 admin 전용)와 같은 성격 → admin·manager만 허용(유슨생 결정).
// ⚠️ advisor 외 필드(진행 상태·메모 등) PATCH는 staff에게 그대로 열려 있어야 한다 — 이 게이트는
// 필드 단위이지 라우트 단위가 아니다.

test("staff는 담당자 재배정 PATCH가 403 — 본인 담당 고객이어도", async () => {
  const { id } = await seedCustomer(STAFF_A);
  const { app, h } = await appFor("staff", STAFF_A);

  const res = await app.request(`/api/customers/${id}`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify({ advisorName: "타상담사", advisorId: STAFF_B }),
  });
  expect(res.status).toBe(403);

  // DB가 실제로 안 바뀌었는지 — 403만 보고 넘기면 "응답만 막고 저장은 된" 회귀를 놓친다.
  const [row] = await db.select({ advisorId: customers.advisorId }).from(customers).where(eq(customers.id, id));
  expect(row.advisorId).toBe(STAFF_A);
});

test("staff는 담당자 해제(null)도 403 — 스스로 목록에서 지우는 경로", async () => {
  const { id } = await seedCustomer(STAFF_A);
  const { app, h } = await appFor("staff", STAFF_A);

  const res = await app.request(`/api/customers/${id}`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify({ advisorName: null, advisorId: null }),
  });
  expect(res.status).toBe(403);
});

test("staff는 team 변경도 403 — 배정 축 전체가 관리자 몫", async () => {
  const { id } = await seedCustomer(STAFF_A);
  const { app, h } = await appFor("staff", STAFF_A);

  const res = await app.request(`/api/customers/${id}`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify({ team: "견적팀" }),
  });
  expect(res.status).toBe(403);
});

test("staff의 advisor 외 필드 PATCH는 그대로 허용 — 필드 단위 게이트(라우트 봉쇄 아님)", async () => {
  const { id } = await seedCustomer(STAFF_A);
  const { app, h } = await appFor("staff", STAFF_A);

  const res = await app.request(`/api/customers/${id}`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify({ residence: "인천 남동구" }),
  });
  expect(res.status).toBe(200);
});

test("admin·manager는 담당자 재배정 200 — 배정은 관리자·팀장 몫", async () => {
  for (const role of ["admin", "manager"] as const) {
    const { id } = await seedCustomer(STAFF_A);
    const { app, h } = await appFor(role, "34444444-4444-4444-8444-444444444444");

    const res = await app.request(`/api/customers/${id}`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ advisorName: "타상담사", advisorId: STAFF_B }),
    });
    expect(res.status).toBe(200);

    const [row] = await db.select({ advisorId: customers.advisorId }).from(customers).where(eq(customers.id, id));
    expect(row.advisorId).toBe(STAFF_B);
  }
});
