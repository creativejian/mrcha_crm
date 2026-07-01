import { jwtVerify, type JWTVerifyGetKey } from "jose";

// CRM 접근 허용 역할(customer 제외) — src/auth/verify.ts CRM_ROLES와 동일 SSOT(복제).
const CRM_ROLES = new Set(["staff", "manager", "admin", "dealer"]);

export type StaffGate =
  | { ok: true; userId: string; role: string }
  | { ok: false; status: 401 | 403; error: string };

// src/auth/verify.ts verifyAndGate의 Deno 재현. user_role은 Custom Access Token Hook이 넣는 top-level claim.
export async function verifyStaff(
  token: string,
  keyResolver: JWTVerifyGetKey,
  opts: { issuer: string; audience: string },
): Promise<StaffGate> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, keyResolver, {
      issuer: opts.issuer,
      audience: opts.audience,
    }));
  } catch {
    return { ok: false, status: 401, error: "인증 토큰이 유효하지 않습니다." };
  }
  const userId = typeof payload.sub === "string" ? payload.sub : null;
  const role = typeof payload.user_role === "string" ? payload.user_role : null;
  if (!userId || !role || !CRM_ROLES.has(role)) {
    return { ok: false, status: 403, error: "접근 권한이 없습니다." };
  }
  return { ok: true, userId, role };
}
