import { describe, expect, test } from "bun:test";

import { app } from "./app";

describe("app (Hono)", () => {
  test("GET /api/health returns service status", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "mrcha-crm" });
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
});
