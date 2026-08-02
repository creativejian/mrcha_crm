import { expect, test } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { currentMonthKey } from "../lib/report-month";

// ── 경영 리포트 role 게이트 + month 파라미터 계약 ────────────────────────────
// admin 단독(읽기 포함). 경영 지표는 조직 전체의 실적·유입이라 manager도 막는다 — 인박스(admin·manager)와
// 다른 어휘이니 "관리자급이면 통과"로 넓히지 말 것. 넓힌다면 그건 이사님 결정 사항이다.

async function reqFor(role: "admin" | "manager" | "staff" | "dealer", path: string) {
  const { token, keyResolver, issuer } = await makeTestAuth(role, crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  return app.request(path, { headers: { Authorization: `Bearer ${token}` } });
}

test("GET /api/reports/admin — admin 200", async () => {
  const res = await reqFor("admin", "/api/reports/admin");
  expect(res.status).toBe(200);
});

test("GET /api/reports/admin — manager·staff·dealer 403 (fail-closed)", async () => {
  expect((await reqFor("manager", "/api/reports/admin")).status).toBe(403);
  expect((await reqFor("staff", "/api/reports/admin")).status).toBe(403);
  expect((await reqFor("dealer", "/api/reports/admin")).status).toBe(403);
});

test("month 생략 = KST 현재 월", async () => {
  const res = await reqFor("admin", "/api/reports/admin");
  const body = (await res.json()) as { month: string; prevMonth: string };
  expect(body.month).toBe(currentMonthKey());
  expect(body.prevMonth).not.toBe(body.month);
});

test("month 지정이 응답에 그대로 반영된다", async () => {
  const res = await reqFor("admin", "/api/reports/admin?month=2026-07");
  const body = (await res.json()) as { month: string; prevMonth: string };
  expect(body.month).toBe("2026-07");
  expect(body.prevMonth).toBe("2026-06");
});

test("형식 이탈 month는 400 — 조용히 현재 월로 폴백하지 않는다", async () => {
  // 폴백하면 오타난 월의 숫자를 "그 달 실적"으로 읽게 된다(spec §3).
  for (const bad of ["2026-13", "202607", "2026-7", "july"]) {
    expect((await reqFor("admin", `/api/reports/admin?month=${bad}`)).status).toBe(400);
  }
});
