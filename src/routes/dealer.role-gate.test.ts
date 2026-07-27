import { expect, test } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";

// ── /api/dealer/profiles role 게이트(admin 전용) ──────────────────────────────
// 딜러 브랜드 매칭은 조직 운영 정보다 — 조직 화면(GET /api/staff/org)과 같은 게이트를 쓴다.
// **dealer 본인도 못 바꾼다**: 자기 브랜드를 스스로 바꿀 수 있으면 브랜드 소유권 검증
// (trims→models.brand_id 대조, 슬라이스 B)이 무의미해진다 — 아무 브랜드로 갈아타면 그만이다.
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §6.3
async function reqFor(role: "admin" | "manager" | "staff" | "dealer", path: string, init?: RequestInit) {
  const { token, keyResolver, issuer } = await makeTestAuth(role, crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  return app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

const BODY = JSON.stringify({ brandId: 1, note: "동성모터스" });

for (const role of ["manager", "staff", "dealer"] as const) {
  test(`GET /api/dealer/profiles — ${role} 403`, async () => {
    expect((await reqFor(role, "/api/dealer/profiles")).status).toBe(403);
  });

  test(`PUT /api/dealer/profiles/:userId — ${role} 403 (게이트가 zod·본 처리보다 앞)`, async () => {
    const res = await reqFor(role, `/api/dealer/profiles/${crypto.randomUUID()}`, { method: "PUT", body: BODY });
    expect(res.status).toBe(403);
  });
}

test("GET /api/dealer/profiles — admin 200", async () => {
  expect((await reqFor("admin", "/api/dealer/profiles")).status).toBe(200);
});
