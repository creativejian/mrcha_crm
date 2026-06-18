import { describe, expect, it } from "bun:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";

import { verifyAndGate } from "./verify";

const ISSUER = "https://proj.supabase.co/auth/v1";
const AUD = "authenticated";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  const kid = "test-key";
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid, alg: "ES256", use: "sig" }] });
  const sign = (claims: Record<string, unknown>, opts?: { sub?: string; expSec?: number }) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid })
      .setIssuer(ISSUER)
      .setAudience(AUD)
      .setSubject(opts?.sub ?? "user-uuid")
      .setExpirationTime(opts?.expSec ?? "1h")
      .sign(privateKey);
  return { jwks, sign };
}

describe("verifyAndGate", () => {
  it("staff/manager/admin/dealer는 통과한다", async () => {
    const { jwks, sign } = await setup();
    for (const role of ["staff", "manager", "admin", "dealer"]) {
      const token = await sign({ user_role: role });
      const r = await verifyAndGate(token, jwks, { issuer: ISSUER, audience: AUD });
      expect(r).toEqual({ ok: true, user: { id: "user-uuid", role } });
    }
  });

  it("customer는 403으로 차단한다", async () => {
    const { jwks, sign } = await setup();
    const token = await sign({ user_role: "customer" });
    const r = await verifyAndGate(token, jwks, { issuer: ISSUER, audience: AUD });
    expect(r).toEqual({ ok: false, status: 403, error: "접근 권한이 없습니다." });
  });

  it("user_role claim이 없으면 403", async () => {
    const { jwks, sign } = await setup();
    const token = await sign({});
    const r = await verifyAndGate(token, jwks, { issuer: ISSUER, audience: AUD });
    expect(r).toEqual({ ok: false, status: 403, error: "접근 권한이 없습니다." });
  });

  it("sub claim이 없으면 403", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(publicKey);
    const kid = "test-key";
    const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid, alg: "ES256", use: "sig" }] });
    const token = await new SignJWT({ user_role: "staff" })
      .setProtectedHeader({ alg: "ES256", kid })
      .setIssuer(ISSUER)
      .setAudience(AUD)
      .setExpirationTime("1h")
      .sign(privateKey);
    const r = await verifyAndGate(token, jwks, { issuer: ISSUER, audience: AUD });
    expect(r).toEqual({ ok: false, status: 403, error: "접근 권한이 없습니다." });
  });

  it("만료된 토큰은 401", async () => {
    const { jwks, sign } = await setup();
    const token = await sign({ user_role: "staff" }, { expSec: Math.floor(Date.now() / 1000) - 60 });
    const r = await verifyAndGate(token, jwks, { issuer: ISSUER, audience: AUD });
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("다른 키로 서명된 토큰은 401", async () => {
    const a = await setup();
    const b = await setup();
    const token = await b.sign({ user_role: "admin" });
    const r = await verifyAndGate(token, a.jwks, { issuer: ISSUER, audience: AUD });
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("issuer 불일치는 401", async () => {
    const { jwks, sign } = await setup();
    const token = await sign({ user_role: "admin" });
    const r = await verifyAndGate(token, jwks, { issuer: "https://other/auth/v1", audience: AUD });
    expect(r).toMatchObject({ ok: false, status: 401 });
  });
});
