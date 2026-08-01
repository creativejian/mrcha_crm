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

  // Workers 엔트리(2026-07-31 Pages 폐기 → 2026-08-01 탈퇴 크론 scheduled 추가로 핸들러 객체 전환):
  // fetch는 반드시 **app.fetch 참조 그대로**여야 한다 — 손으로 쓴 래퍼
  // (`fetch: (req, env) => app.fetch(req, env)`)는 ExecutionContext 3번째 인자를 빠뜨릴 수 있고,
  // 그 누락이 2026-07-03 prod 524(SSE 데드락)의 배경이다(상세 db.test.ts). 모듈 워커 런타임은
  // 등록된 fetch에 (request, env, ctx) 3인자를 직접 넘기므로, 참조 동일성만 잠그면 인자 유실
  // 래퍼의 재도입이 기계로 걸린다. (app.fetch는 Hono가 생성 시점에 바인딩한 프로퍼티라 참조 전달 안전.)
  test("Workers 엔트리 fetch는 app.fetch 참조 그대로(인자 유실 래퍼 금지) + 탈퇴 크론 scheduled 존재", () => {
    expect(worker.fetch).toBe(app.fetch);
    expect(typeof worker.scheduled).toBe("function");
  });
});
