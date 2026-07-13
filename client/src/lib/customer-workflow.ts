import type { Customer, CustomerChanceOption, CustomerManageStatus } from "@/data/customers";
import type { CustomerWritePatch } from "./customers";

// App.updateCustomerWorkflow의 순수 코어. 낙관 row 반영과 PATCH 구성이 한 쌍으로 유닛 테스트되도록
// 분리했다(0713 감사 — patch 구성·롤백 경로가 무테스트였다).
export type WorkflowNext = {
  statusGroup?: string;
  status?: string;
  chance?: CustomerChanceOption;
  manageStatus?: CustomerManageStatus;
};

// PATCH payload 구성. 계약완료면 chance는 무조건 "확정"(Option A — 어디서 비확정으로 바꾸려 해도 차단),
// statusGroup 변경으로 계약완료를 이탈하면 기존 "확정"은 null로 해제한다.
export function buildWorkflowPatch(next: WorkflowNext, opts: { contracted: boolean; wasConfirmed: boolean }): CustomerWritePatch {
  const patch: CustomerWritePatch = {};
  if (next.statusGroup) patch.statusGroup = next.statusGroup;
  if (next.status) patch.status = next.status;
  if (next.manageStatus) patch.manageStatus = next.manageStatus;
  if (opts.contracted) patch.chance = "확정";
  else if (next.statusGroup && opts.wasConfirmed) patch.chance = null;
  else if (next.chance) patch.chance = next.chance;
  return patch;
}

// 낙관 row 반영 — 수동 관리 상태의 단일 소스는 row(manageStatus/manageStatusAt)다(#228 이중 소스 폐기,
// 구 manageStatusOverrides는 삭제 경로가 없어 서버 스누즈 만료를 F5까지 가리던 결함 — 0713 감사).
// 서버 updateCustomer는 어떤 PATCH든 updated_at을 bump(→ staffActivityAt·스누즈 만료 판정 입력)하므로,
// PATCH가 나가는 변경은 lastActivityAt도 같은 now로 낙관 갱신해 유효/만료 판정을 서버와 동치로 유지한다.
// manageStatusAt=lastActivityAt 동일 스탬프는 서버의 "manage_status_at=updated_at 동일 now 계약" 미러.
export function applyWorkflowRowUpdate(customer: Customer, next: WorkflowNext, opts: { nowIso: string; willPatch: boolean }): Customer {
  const updated = { ...customer };
  if (next.statusGroup || next.status) {
    updated.statusGroup = next.statusGroup ?? customer.statusGroup;
    updated.status = next.status ?? customer.status;
    updated.date = "방금 전";
  }
  if (next.manageStatus) {
    updated.manageStatus = next.manageStatus;
    updated.manageStatusAt = opts.nowIso;
  }
  if (opts.willPatch) {
    updated.lastActivityAt = opts.nowIso;
    updated.date = "방금 전";
  }
  return updated;
}
