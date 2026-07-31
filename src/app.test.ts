import { describe, expect, test } from "bun:test";

import { app } from "./app";
import worker from "./worker";

describe("app (Hono)", () => {
  test("GET /api/health returns service status", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "mrcha-crm", hyperdrive: false });
  });

  test("unknown route returns 404 not found", async () => {
    const res = await app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  test("보호 라우트는 토큰 없으면 401", async () => {
    const res = await app.request("/api/catalog/brands");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "인증이 필요합니다." });
  });

  // Workers 엔트리(2026-07-31 Pages 폐기): 모듈 워커가 app 자체를 default export 해야
  // ExecutionContext가 fetch 3번째 인자로 자동 전달된다(구 Pages 엔트리의 수동 전달 누락 →
  // SSE 데드락 함정은 이 구조로 소멸 — 2026-07-03 prod 524 사고 배경은 db.test.ts 참조).
  // 별도 래퍼 객체로 바꾸면 그 보장이 다시 코드 책임이 되므로 동일성 자체를 잠근다.
  test("Workers 엔트리는 Hono app 자체를 default export 한다", () => {
    expect(worker).toBe(app);
  });
});
