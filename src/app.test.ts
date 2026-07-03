import { describe, expect, test } from "bun:test";

import { onRequest } from "../functions/[[path]]";
import { app } from "./app";

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

  // 2026-07-03 prod 524 사고 회귀 테스트: Pages 엔트리가 context를 ExecutionContext로 전달하지
  // 않으면 waitUntil 로직이 전부 폴백 강등된다(dbMiddleware 데드락 — db.test.ts 참조).
  test("Pages onRequest는 /api 요청에 context를 ExecutionContext로 전달한다", async () => {
    const captured: unknown[] = [];
    const origFetch = app.fetch;
    (app as { fetch: typeof app.fetch }).fetch = ((req: Request, env?: unknown, ctx?: unknown) => {
      captured.push(ctx);
      return origFetch(req, env as never, ctx as never);
    }) as typeof app.fetch;
    try {
      const context = {
        request: new Request("http://local.test/api/health"),
        env: {},
        next: () => Promise.resolve(new Response("static")),
        waitUntil: () => {},
        passThroughOnException: () => {},
      };
      const res = await onRequest(context);
      expect(res.status).toBe(200);
      expect(captured[0]).toBe(context);
    } finally {
      (app as { fetch: typeof app.fetch }).fetch = origFetch;
    }
  });

  test("Pages onRequest는 /api 밖 요청을 next(정적 자산)로 위임한다", async () => {
    const res = await onRequest({
      request: new Request("http://local.test/"),
      env: {},
      next: () => Promise.resolve(new Response("static")),
      waitUntil: () => {},
      passThroughOnException: () => {},
    });
    expect(await res.text()).toBe("static");
  });
});
