export type StatusSelection = { statusGroup?: string | null; status?: string | null };

// 진행상태 1차(group)/2차(status) 종속 검증(순수, DB 미접근).
// - group이 오면 active group 집합에 있어야 한다.
// - status가 오면 유효한 2차 값이어야 한다.
// - 둘 다 오면 status의 부모가 group과 일치해야 한다(종속).
// 단독 전송(한쪽만)은 그 값의 유효성만 검증하고 종속은 건너뛴다(기존 PATCH 경로 보존).
// 위반 시 사람이 읽는 에러 메시지, OK면 null.
export function checkStatusSelection(
  activeGroups: ReadonlySet<string>,
  statusParent: ReadonlyMap<string, string>,
  sel: StatusSelection,
): string | null {
  const group = sel.statusGroup;
  const status = sel.status;

  if (group != null && !activeGroups.has(group)) {
    return `유효하지 않은 진행 1차 상태입니다: ${group}`;
  }
  if (status != null) {
    const parent = statusParent.get(status);
    if (parent === undefined) return `유효하지 않은 진행 2차 상태입니다: ${status}`;
    if (group != null && parent !== group) {
      return `진행 2차 상태 "${status}"는 1차 "${group}"에 속하지 않습니다.`;
    }
  }
  return null;
}
