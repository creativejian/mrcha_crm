import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";

import { createAuthMiddleware } from "./middleware/auth";
import { catalog } from "./routes/catalog";
import { vehicles } from "./routes/vehicles";

// 테스트는 authOpts(로컬 keyResolver+issuer)를 주입해 보호 라우트를 통과 검증한다.
export function createApp(authOpts?: { keyResolver: JWTVerifyGetKey; issuer: string }) {
  const app = new Hono();
  const auth = createAuthMiddleware(authOpts);

  app.get("/api/health", (c) => c.json({ ok: true, service: "mrcha-crm" }));

  // 보호 라우트: 카카오 로그인(Supabase JWT) + role 게이트.
  app.use("/api/vehicles/*", auth);
  app.use("/api/catalog/*", auth);

  app.route("/api/vehicles", vehicles);
  app.route("/api/catalog", catalog);

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  // GET 라우트는 try/catch가 없어 throw 시 기본 "Internal Server Error"만 나간다.
  // 실제 원인(DB 연결/쿼리 에러)을 로그(CF 실시간 로그)와 응답에 드러내 진단/운영을 돕는다.
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err instanceof Error ? err.message : "Internal Server Error" }, 500);
  });
  return app;
}

export const app = createApp();
