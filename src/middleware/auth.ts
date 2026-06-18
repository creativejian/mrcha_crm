import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import type { MiddlewareHandler } from "hono";

import { type AuthedUser, verifyAndGate } from "../auth/verify";

export type AuthVariables = { user: AuthedUser };

// 주입형: 기본은 원격 JWKS(c.env/process.env의 SUPABASE_URL), 테스트는 keyResolver+issuer 주입.
export function createAuthMiddleware(opts?: {
  keyResolver?: JWTVerifyGetKey;
  issuer?: string;
}): MiddlewareHandler<{ Variables: AuthVariables }> {
  // issuer별 원격 JWKS 캐시(주입 없을 때만).
  let cache: { issuer: string; jwks: JWTVerifyGetKey } | null = null;

  return async (c, next) => {
    // 토큰 없으면 즉시 401 — SUPABASE_URL 체크나 원격 JWKS fetch 불필요.
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return c.json({ error: "인증이 필요합니다." }, 401);

    let issuer = opts?.issuer;
    let keyResolver = opts?.keyResolver;
    if (!keyResolver) {
      const url = (c.env as { SUPABASE_URL?: string } | undefined)?.SUPABASE_URL ?? process.env.SUPABASE_URL;
      if (!url) throw new Error("SUPABASE_URL is not set (see .env.local / Cloudflare vars)");
      issuer = `${url}/auth/v1`;
      if (!cache || cache.issuer !== issuer) {
        cache = { issuer, jwks: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) };
      }
      keyResolver = cache.jwks;
    }

    const result = await verifyAndGate(token, keyResolver, { issuer: issuer!, audience: "authenticated" });
    if (!result.ok) return c.json({ error: result.error }, result.status);

    c.set("user", result.user);
    await next();
  };
}
