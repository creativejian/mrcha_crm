import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";

import { createAuthMiddleware } from "./middleware/auth";
import { catalog } from "./routes/catalog";
import { vehicles } from "./routes/vehicles";

// 테스트는 authOpts(로컬 keyResolver+issuer)를 주입해 보호 라우트를 통과 검증한다.
export function createApp(authOpts?: { keyResolver?: JWTVerifyGetKey; issuer?: string }) {
  const app = new Hono();
  const auth = createAuthMiddleware(authOpts);

  app.get("/api/health", (c) => c.json({ ok: true, service: "mrcha-crm" }));

  // 보호 라우트: 카카오 로그인(Supabase JWT) + role 게이트.
  app.use("/api/vehicles/*", auth);
  app.use("/api/catalog/*", auth);

  app.route("/api/vehicles", vehicles);
  app.route("/api/catalog", catalog);

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  return app;
}

export const app = createApp();
