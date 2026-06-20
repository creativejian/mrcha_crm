// 테스트 전용. 로컬 키쌍으로 지정 role 토큰 + 같은 키의 JWKS + issuer를 만든다.
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";

const TEST_ISSUER = "https://test.supabase.co/auth/v1";

export async function makeTestAuth(
  role = "staff",
  sub = "test-user",
): Promise<{
  token: string;
  keyResolver: JWTVerifyGetKey;
  issuer: string;
}> {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  const kid = "test-key";
  const keyResolver = createLocalJWKSet({ keys: [{ ...jwk, kid, alg: "ES256", use: "sig" }] });
  const token = await new SignJWT({ user_role: role })
    .setProtectedHeader({ alg: "ES256", kid })
    .setIssuer(TEST_ISSUER)
    .setAudience("authenticated")
    .setSubject(sub)
    .setExpirationTime("1h")
    .sign(privateKey);
  return { token, keyResolver, issuer: TEST_ISSUER };
}
