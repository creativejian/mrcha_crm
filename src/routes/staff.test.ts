import { test, expect } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { CRM_ROLES } from "../auth/verify";

test("GET /api/staff 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  expect((await app.request("/api/staff")).status).toBe(401);
});

test("GET /api/staff → CRM 역할 profiles만(id·name·role, 이름 없는 계정 제외) — 실 DB", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/staff", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const rows = (await res.json()) as { id: string; name: string; role: string }[];
  expect(rows.length).toBeGreaterThan(0); // master에 admin 계정 상존(자메스관리자 등)
  for (const r of rows) {
    expect(typeof r.id).toBe("string");
    expect(r.name.trim().length).toBeGreaterThan(0);
    expect(CRM_ROLES.has(r.role)).toBe(true); // customer 등 비 CRM 역할 미노출
  }
});
