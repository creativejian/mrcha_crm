import { test, expect } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { createApp } from "../app";
import { CRM_ROLES } from "../auth/verify";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { setLiveReceiving } from "../db/queries/staff-settings";
import { customers, staffSettings } from "../db/schema";
import { ADVISOR_ROLES } from "./staff";

test("GET /api/staff 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  expect((await app.request("/api/staff")).status).toBe(401);
});

test("GET /api/staff → 배정 후보 역할 profiles만(id·name·role, 이름 없는 계정 제외) — 실 DB", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/staff", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const rows = (await res.json()) as { id: string; name: string; role: string }[];
  expect(rows.length).toBeGreaterThan(0); // master에 admin 계정 상존(자메스관리자 등)
  for (const r of rows) {
    expect(typeof r.id).toBe("string");
    expect(r.name.trim().length).toBeGreaterThan(0);
    // customer는 물론 dealer도 미노출 — 배정 후보는 ADVISOR_ROLES(CRM_ROLES보다 좁은 어휘)만.
    expect((ADVISOR_ROLES as readonly string[]).includes(r.role)).toBe(true);
  }
  // 순서 결정성(서버 orderBy fullName, id) — DB 컬레이션에 결합되지 않게 재조회 동일성으로 잠근다.
  const res2 = await app.request("/api/staff", { headers: { Authorization: `Bearer ${token}` } });
  expect(await res2.json()).toEqual(rows);
});

test("GET /api/staff → liveReceiving 포함(설정 없으면 true, Off 계정은 false) — 실 DB", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });

  const first = (await (await app.request("/api/staff", { headers: { Authorization: `Bearer ${token}` } })).json()) as { id: string; liveReceiving: boolean }[];
  expect(first.length).toBeGreaterThan(0);
  for (const r of first) expect(typeof r.liveReceiving).toBe("boolean");

  // 첫 후보를 Off로 만들고 반영 확인 → 원복. 원복 정확성을 위해 기존 행 존재/원값을 직접 확인.
  const target = first[0].id;
  const db = getDefaultDb();
  const [existing] = await db
    .select({ v: staffSettings.liveReceiving })
    .from(staffSettings)
    .where(eq(staffSettings.staffUserId, target));
  try {
    await setLiveReceiving(target, false, db);
    const after = (await (await app.request("/api/staff", { headers: { Authorization: `Bearer ${token}` } })).json()) as { id: string; liveReceiving: boolean }[];
    expect(after.find((r) => r.id === target)?.liveReceiving).toBe(false);
  } finally {
    if (existing) await setLiveReceiving(target, existing.v, db); // 원값 복원
    else await db.delete(staffSettings).where(eq(staffSettings.staffUserId, target)); // 이 테스트가 만든 행 제거
  }
});

// ── GET /api/staff/org — 조직 화면(대표 전용) 구성원 디렉토리 ───────────────────────
// 위 GET /api/staff(배정 후보)와 **의도적으로 다른 어휘**를 낸다: 여기는 dealer를 포함한
// CRM_ROLES 전부. 두 API가 갈리는 지점이라 각각을 따로 잠근다.

test("GET /api/staff/org 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  expect((await app.request("/api/staff/org")).status).toBe(401);
});

test("GET /api/staff/org → admin 외 역할은 403(화면 '대표 전용'과 같은 게이트)", async () => {
  for (const role of ["manager", "staff", "dealer"]) {
    const { token, keyResolver, issuer } = await makeTestAuth(role);
    const app = createApp({ keyResolver, issuer });
    const res = await app.request("/api/staff/org", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
  }
});

test("GET /api/staff/org → CRM_ROLES 전부(dealer 포함)·customer 제외 — 실 DB", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/staff/org", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const rows = (await res.json()) as { id: string; name: string; role: string; assignedCustomers: number; liveReceiving: boolean }[];
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    expect(CRM_ROLES.has(r.role)).toBe(true); // customer는 절대 섞이지 않는다
    expect(r.name.trim().length).toBeGreaterThan(0);
    expect(Number.isInteger(r.assignedCustomers)).toBe(true);
    expect(r.assignedCustomers).toBeGreaterThanOrEqual(0);
    expect(typeof r.liveReceiving).toBe("boolean");
  }
  // 순서 결정성(역할 우선순위 → 이름) — 재조회 동일성으로 잠근다.
  const res2 = await app.request("/api/staff/org", { headers: { Authorization: `Bearer ${token}` } });
  expect(await res2.json()).toEqual(rows);
});

test("GET /api/staff/org → 배정 후보 API(/api/staff)보다 넓다: dealer가 여기에만 있다 — 실 DB", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const org = (await (await app.request("/api/staff/org", { headers: { Authorization: `Bearer ${token}` } })).json()) as { id: string; role: string }[];
  const directory = (await (await app.request("/api/staff", { headers: { Authorization: `Bearer ${token}` } })).json()) as { id: string; role: string }[];
  // 배정 후보는 조직 목록의 부분집합이어야 한다(어휘가 좁으므로).
  for (const d of directory) expect(org.some((o) => o.id === d.id)).toBe(true);
  // dealer가 실제로 있다면 조직에만 보인다(없으면 이 단언은 자동 성립 — 계정 유무에 결합하지 않는다).
  for (const o of org.filter((r) => r.role === "dealer")) {
    expect(directory.some((d) => d.id === o.id)).toBe(false);
  }
});

test("GET /api/staff/org → assignedCustomers는 advisor_id 실카운트와 일치 — 실 DB", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const rows = (await (await app.request("/api/staff/org", { headers: { Authorization: `Bearer ${token}` } })).json()) as { id: string; assignedCustomers: number }[];
  const db = getDefaultDb();
  for (const r of rows) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .where(eq(customers.advisorId, r.id));
    expect(r.assignedCustomers).toBe(n);
  }
});
