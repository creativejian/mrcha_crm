import { expect, test } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";

// ── 인박스 role 게이트(상담 신청 DB·앱 견적요청 = admin·manager 전용) ─────────
// 2026-07-21 유슨생 결정(이사님 사후 공유 — pending 항목 16, role scope spec §4 상호작용):
// 인박스는 "미배정 신규 유입 큐"라 미배정 고객을 볼 수 있는 role(admin·manager, #301 D-3① 미러)
// 전용이다. staff가 열면 ①전 앱 유저 요청·전화번호 열람 ②상담 인박스 클라 매칭이 스코프된
// 고객 목록으로 "신규" 오판 → [고객 생성] 중복 고객 위험. dealer 포함 그 외 role = fail-closed 403.
// 읽기(GET)까지 포함한 라우터 전체 차단 — 승격(link/create-customer)만 막으면 열람이 남는다.

async function reqFor(role: "admin" | "manager" | "staff" | "dealer", path: string, init?: RequestInit) {
  const { token, keyResolver, issuer } = await makeTestAuth(role, crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  return app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

for (const path of ["/api/consultations", "/api/quote-requests"] as const) {
  test(`GET ${path} — staff 403 (읽기 포함 전면 차단)`, async () => {
    const res = await reqFor("staff", path);
    expect(res.status).toBe(403);
  });

  test(`GET ${path} — dealer 403 (fail-closed)`, async () => {
    const res = await reqFor("dealer", path);
    expect(res.status).toBe(403);
  });

  test(`GET ${path} — admin 200 / manager 200`, async () => {
    expect((await reqFor("admin", path)).status).toBe(200);
    expect((await reqFor("manager", path)).status).toBe(200);
  });
}

test("승격 경로도 staff 403 — link·create-customer (게이트가 zod·본 처리보다 앞)", async () => {
  const id = crypto.randomUUID();
  expect((await reqFor("staff", `/api/consultations/${id}/link`, { method: "POST", body: "{}" })).status).toBe(403);
  expect((await reqFor("staff", `/api/quote-requests/${id}/create-customer`, { method: "POST" })).status).toBe(403);
});
