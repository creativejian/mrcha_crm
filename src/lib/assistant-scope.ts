import type { AuthedUser } from "../auth/verify";

// 사용자가 볼 수 있는 고객 범위. "all" = 전체 코퍼스, string[] = 허용 customer_id 목록.
// v1: 전부 "all"(admin 수준). manager(자기 팀)·staff(본인) per-팀 필터는 후속 crm.staff/팀
// 파운데이션 슬라이스가 이 함수 본문만 교체한다(호출부 불변). 설계: ref/specs/2026-07-02-crm-work-ai-chat-design.md
export function resolveCustomerScope(_user: AuthedUser): "all" | string[] {
  return "all";
}
