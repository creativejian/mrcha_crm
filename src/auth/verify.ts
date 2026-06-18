import { jwtVerify, type JWTVerifyGetKey } from "jose";

export type AuthedUser = { id: string; role: string };
export type GateResult =
  | { ok: true; user: AuthedUser }
  | { ok: false; status: 401 | 403; error: string };

// CRM 접근 허용 역할(customer 제외). dealer는 user_role enum에 추가 예정(선행 의존).
export const CRM_ROLES = new Set(["staff", "manager", "admin", "dealer"]);

// 순수 검증+게이트. keyResolver를 주입받아 테스트는 로컬 JWKS, prod는 원격 JWKS를 쓴다.
// role은 Custom Access Token Hook이 넣는 top-level user_role claim에서 읽는다.
export async function verifyAndGate(
  token: string,
  keyResolver: JWTVerifyGetKey,
  opts: { issuer: string; audience: string },
): Promise<GateResult> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, keyResolver, {
      issuer: opts.issuer,
      audience: opts.audience,
    }));
  } catch {
    return { ok: false, status: 401, error: "인증 토큰이 유효하지 않습니다." };
  }
  const id = typeof payload.sub === "string" ? payload.sub : null;
  const role = typeof payload.user_role === "string" ? payload.user_role : null;
  if (!id || !role || !CRM_ROLES.has(role)) {
    return { ok: false, status: 403, error: "접근 권한이 없습니다." };
  }
  return { ok: true, user: { id, role } };
}
