import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SignJWT, generateKeyPair } from "jose";
import { verifyStaff } from "./auth.ts";

const ISSUER = "https://example.supabase.co/auth/v1";
const AUD = "authenticated";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  // jose JWTVerifyGetKey 시그니처에 맞춘 로컬 resolver — publicKey를 그대로 돌려준다.
  const keyResolver = () => Promise.resolve(publicKey);
  return { privateKey, keyResolver };
}

function sign(privateKey: CryptoKey, claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(ISSUER)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("1h")
    .setSubject("user-123")
    .sign(privateKey);
}

Deno.test("staff role은 통과", async () => {
  const { privateKey, keyResolver } = await setup();
  const token = await sign(privateKey, { user_role: "staff" });
  const r = await verifyStaff(token, keyResolver, { issuer: ISSUER, audience: AUD });
  assert(r.ok);
  if (r.ok) assertEquals(r.role, "staff");
});

Deno.test("customer role은 403", async () => {
  const { privateKey, keyResolver } = await setup();
  const token = await sign(privateKey, { user_role: "customer" });
  const r = await verifyStaff(token, keyResolver, { issuer: ISSUER, audience: AUD });
  assert(!r.ok);
  if (!r.ok) assertEquals(r.status, 403);
});

Deno.test("role 없으면 403", async () => {
  const { privateKey, keyResolver } = await setup();
  const token = await sign(privateKey, {});
  const r = await verifyStaff(token, keyResolver, { issuer: ISSUER, audience: AUD });
  assert(!r.ok);
  if (!r.ok) assertEquals(r.status, 403);
});

Deno.test("서명 불일치는 401", async () => {
  const { keyResolver } = await setup();
  const { privateKey: otherKey } = await setup(); // 다른 키로 서명
  const token = await sign(otherKey, { user_role: "staff" });
  const r = await verifyStaff(token, keyResolver, { issuer: ISSUER, audience: AUD });
  assert(!r.ok);
  if (!r.ok) assertEquals(r.status, 401);
});
