import { updateCustomer, type CustomerWritePatch } from "./customers";

export type BulkAdvisorTarget = { id?: string; name: string };
export type BulkAdvisorResult = {
  changedIds: string[];
  failed: { name: string; reason: string }[];
};

// 일괄 담당자 변경 오케스트레이션 — customer-bulk-delete.ts 미러(건별 독립·순차).
// 서버 변경 0: 배정 규칙(실변경 시만 assignedAt 스탬프·advisorId 동봉·self 알림 skip·
// 동일 담당자 재배정 no-op)은 개별 PATCH가 이미 처리한다(spec 확정 결정 1).
// 알림은 고객당 1건 = 개별 배정 N번과 동일 의미론(spec 확정 결정 2 — 묶음 알림은 follow-up).
export async function changeAdvisorBulk(
  targets: readonly BulkAdvisorTarget[],
  advisor: { id: string; name: string },
  updateOne: (id: string, patch: CustomerWritePatch) => Promise<void> = updateCustomer,
): Promise<BulkAdvisorResult> {
  const changedIds: string[] = [];
  const failed: { name: string; reason: string }[] = [];

  for (const target of targets) {
    if (!target.id) {
      failed.push({ name: target.name, reason: "저장되지 않은 행이라 변경할 수 없습니다." });
      continue;
    }
    try {
      // advisorId 동봉 필수 — 이름만 보내면 서버 방어선이 id를 비워 역할 scope가 깨진다(#176).
      await updateOne(target.id, { advisorName: advisor.name, advisorId: advisor.id });
      changedIds.push(target.id);
    } catch (e) {
      failed.push({ name: target.name, reason: e instanceof Error ? e.message : "변경에 실패했습니다." });
    }
  }
  return { changedIds, failed };
}
