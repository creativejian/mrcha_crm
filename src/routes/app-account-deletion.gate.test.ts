import { afterAll, expect, test } from "bun:test";

import { createApp } from "../app";

// 시크릿 게이트(503 fail-closed·401·400)만 떼어낸 **순수 테스트** — 전부 DB에 도달하기 전에
// 끝나는 경로라 CI(test:pure)에서 돈다. 본체(app-account-deletion.test.ts)는 실 DB라 db-bound
// (로컬 전용)인데, 게이트 케이스가 거기 묶여 있던 탓에 크로스팀 프리즈 계약(X-App-Deletion-Secret
// 헤더명·미설정 503·malformed 400)의 회귀가 CI green으로 머지될 수 있었다(2026-08-02 감사).
// HYPERDRIVE 가짜 연결문자열 = dbMiddleware가 lazy client만 만들고, 이 경로들엔 쿼리가 없어
// 실제 연결을 열지 않는다(postgres.js는 첫 쿼리 전까지 소켓을 열지 않는다).

const app = createApp();
const GATE_SECRET = "pure-gate-secret";
const FAKE_HYPERDRIVE = { connectionString: "postgresql://pure:pure@127.0.0.1:9/pure" };
const FAKE_ENV = { HYPERDRIVE: FAKE_HYPERDRIVE, APP_DELETION_SECRET: GATE_SECRET };

// process.env 폴백 차단 — 셸·.env.local에 실값이 있어도 CI와 같은 판정이 나오게.
const saved = process.env.APP_DELETION_SECRET;
delete process.env.APP_DELETION_SECRET;
afterAll(() => {
  if (saved !== undefined) process.env.APP_DELETION_SECRET = saved;
});

const post = (env: Record<string, unknown>, headers: Record<string, string>, body: string) =>
  app.request(
    "/api/app/account-deletion",
    { method: "POST", headers: { "content-type": "application/json", ...headers }, body },
    env,
  );

test("시크릿 미설정 → 503 fail-closed(배선 전 엔드포인트 개방 금지)", async () => {
  const res = await post({ HYPERDRIVE: FAKE_HYPERDRIVE }, { "x-app-deletion-secret": "anything" }, JSON.stringify({ appUserId: crypto.randomUUID() }));
  expect(res.status).toBe(503);
});

test("헤더 없음/불일치 → 401(X-App-Deletion-Secret — 앱과 프리즈된 헤더명)", async () => {
  expect((await post(FAKE_ENV, {}, JSON.stringify({ appUserId: crypto.randomUUID() }))).status).toBe(401);
  expect((await post(FAKE_ENV, { "x-app-deletion-secret": "wrong" }, JSON.stringify({ appUserId: crypto.randomUUID() }))).status).toBe(401);
});

test("본문 오류 → 400(uuid 아님·JSON 깨짐 — DB 도달 전 종료)", async () => {
  expect((await post(FAKE_ENV, { "x-app-deletion-secret": GATE_SECRET }, JSON.stringify({ appUserId: "not-a-uuid" }))).status).toBe(400);
  expect((await post(FAKE_ENV, { "x-app-deletion-secret": GATE_SECRET }, "{broken")).status).toBe(400);
});

test("GET /status도 같은 게이트를 탄다 — 무헤더 401", async () => {
  const res = await app.request(`/api/app/account-deletion/status?appUserId=${crypto.randomUUID()}`, { method: "GET" }, FAKE_ENV);
  expect(res.status).toBe(401);
});
