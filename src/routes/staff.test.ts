import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { setLiveReceiving } from "../db/queries/staff-settings";
import { staffSettings } from "../db/schema";
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
