import type { AuthedUser } from "../auth/verify";

// 사용자가 볼 수 있는 고객 범위(이사님 요구 2026-07-06: 관리자=전체, 직원=본인 것만 AI 확인).
// "all" = 전체 코퍼스. { advisorId } = crm.customers.advisor_id가 본인인 담당 고객만 —
// 소비처(searchEmbeddings·runAssistantTool)가 customer 단위 필터로 해석한다(견적·일정·서류 등
// 모든 코퍼스가 customer_id에 달려 있어 고객 scope 하나로 전부 걸러진다).
// 2026-07-21부터 화면 라우트도 같은 판정을 소비한다(routes/customers.ts customerScopeGate·
// listCustomers scope — role scope spec). AI와 화면의 고객 집합이 이 함수 하나로 정합된다.
export type CustomerScope = "all" | { advisorId: string };

// admin·manager(팀장)=전체 — 팀 개념 없음(2026-07-03 확인), 팀장은 권한 레벨만 상이.
// staff=본인 담당. dealer 등 그 외 CRM 역할은 담당 고객 개념이 없어 staff와 동일 규칙으로
// fail-closed(매칭 0건 = 사실상 차단, 딜러 화면 설계 전 안전 기본값).
export function resolveCustomerScope(user: AuthedUser): CustomerScope {
  return user.role === "admin" || user.role === "manager" ? "all" : { advisorId: user.id };
}
