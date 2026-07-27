export type RoleTab = "최고관리자" | "팀장" | "상담사" | "딜러";

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

// role claim → 한글 라벨(조직 화면 표시용). 위 ROLE_CLAIM_TO_TAB과 같은 어휘이고 서버
// CRM_ROLE_LABELS(src/lib/assistant-tools.ts — 업무 AI 사용자 컨텍스트)와도 값이 일치한다.
export function roleLabelOf(userRole: string): string {
  return ROLE_CLAIM_TO_TAB[userRole] ?? userRole;
}

// 역할별 접근 범위 요약 — 조직 화면 표시 전용 문구다. 지어낸 값이 아니라 **실제 코드 게이트에서
// 유도**한다: 견적 쓰기 `canWriteQuote`(lib/quote-write-access.ts) · 담당자 배정 `canAssignAdvisor`
// (lib/advisor-assign-access.ts) · 고객 목록 scope(#301 — staff는 본인 담당만) · dealer 전역 쓰기
// 차단(`dealerWriteGate`, src/middleware/role-gate.ts).
// ⚠️ 그 규칙 중 하나라도 바뀌면 이 문구도 함께 고칠 것 — 표시 전용이라 타입·테스트가 못 잡는다.
export const ROLE_ACCESS_SUMMARY: Record<string, string> = {
  admin: "전체 고객 · 견적 · 담당자 배정 · 조직/AI 설정",
  manager: "전체 고객 · 견적 · 담당자 배정",
  staff: "본인 담당 고객 · 견적 (배정 불가)",
  dealer: "읽기 전용 (쓰기 전역 차단)",
};
