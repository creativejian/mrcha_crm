export type RoleTab = "최고관리자" | "팀장" | "상담사" | "딜러";

export const roleAccountMeta: Record<RoleTab, { name: string; title: string }> = {
  최고관리자: { name: "지안", title: "최고관리자" },
  팀장: { name: "선생님", title: "팀장" },
  상담사: { name: "제프", title: "상담사" },
  딜러: { name: "권지현", title: "BMW 한독/서초" },
};

// JWT user_role claim(DB user_role enum) → 화면 권한 RoleTab. customer/미지정/미상은 null = 접근 거부.
const ROLE_CLAIM_TO_TAB: Record<string, RoleTab> = {
  admin: "최고관리자",
  manager: "팀장",
  staff: "상담사",
  dealer: "딜러",
};

export function roleTabFromClaim(userRole: string | null | undefined): RoleTab | null {
  return userRole ? (ROLE_CLAIM_TO_TAB[userRole] ?? null) : null;
}
