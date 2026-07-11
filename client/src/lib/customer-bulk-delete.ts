import { deleteCustomer } from "./customers";

export type BulkDeleteTarget = { id?: string; name: string };
export type BulkDeleteResult = {
  deletedIds: string[];
  failed: { name: string; reason: string }[];
};

// 다건 고객 삭제 오케스트레이션(2026-07-10 이사님 결정: 건별 독립 트랜잭션).
//
// 한 건의 실패가 나머지를 되돌리지 않는다 — 20명 중 1명이 앱 카드 때문에 409로 막혔다고
// 19명을 살려두는 건 실무에서 더 나쁘다. 서버는 고객당 한 트랜잭션이고, 여기서는 순차 호출한다.
//
// 반환된 deletedIds만 목록에서 제거할 것. 낙관적 제거(먼저 지우고 실패하면 되돌리기)는 금지 —
// 되돌릴 수 없는 조작이라 "지워진 것처럼 보였는데 살아 있음"이 최악의 상태다(리로딩하면 되살아나는 현행 버그).
const NAME_PREVIEW_LIMIT = 5;

// 확인창에 "누구를" 조작하는지 보여준다 — 일괄 삭제·일괄 배정 공용. 선택(selected)은
// 페이지·필터를 넘어 유지되므로 "고객 5명"만 뜨면 화면에 안 보이는 대상이 섞여 있어도 알 수 없다.
export function formatBulkTargetNames(names: readonly string[]): string {
  if (names.length === 0) return "";
  const labels = names.map((name) => name.trim() || "이름 없음");
  if (labels.length <= NAME_PREVIEW_LIMIT) return labels.join(", ");
  return `${labels.slice(0, NAME_PREVIEW_LIMIT).join(", ")} 외 ${labels.length - NAME_PREVIEW_LIMIT}명`;
}

export async function deleteCustomersBulk(
  targets: readonly BulkDeleteTarget[],
  deleteOne: (id: string) => Promise<void> = deleteCustomer,
): Promise<BulkDeleteResult> {
  const deletedIds: string[] = [];
  const failed: { name: string; reason: string }[] = [];

  for (const target of targets) {
    if (!target.id) {
      // 목업/미저장 행 — 서버에 존재하지 않으므로 호출 자체를 하지 않는다.
      failed.push({ name: target.name, reason: "저장되지 않은 행이라 삭제할 수 없습니다." });
      continue;
    }
    try {
      await deleteOne(target.id);
      deletedIds.push(target.id);
    } catch (e) {
      // 서버가 보낸 한글 사유(403 권한 / 409 앱 발송 견적 / 404)를 그대로 노출한다(httpError가 body.error를 싣는다).
      failed.push({ name: target.name, reason: e instanceof Error ? e.message : "삭제에 실패했습니다." });
    }
  }
  return { deletedIds, failed };
}
