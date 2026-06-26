export type StatusSelection = { statusGroup?: string | null; status?: string | null };

// customerStatusGroups(코드 SSOT) → 검증용 맵. 같은 2차값이 여러 1차에 속할 수 있어 Set<group>.
export function buildStatusMaps(groups: Record<string, string[]>): {
  activeGroups: ReadonlySet<string>;
  statusParents: ReadonlyMap<string, ReadonlySet<string>>;
} {
  const activeGroups = new Set(Object.keys(groups));
  const statusParents = new Map<string, Set<string>>();
  for (const [group, statuses] of Object.entries(groups)) {
    for (const s of statuses) {
      const set = statusParents.get(s) ?? new Set<string>();
      set.add(group);
      statusParents.set(s, set);
    }
  }
  return { activeGroups, statusParents };
}

// 진행상태 1차(group)/2차(status) 종속 검증(순수, DB 미접근).
// 단독 전송(한쪽만)은 그 값의 유효성만 검증하고 종속은 건너뛴다(기존 PATCH 경로 보존).
// 둘 다 오면 status의 부모 집합에 group이 포함되는지(다부모 종속). 위반 시 사람이 읽는 메시지, OK면 null.
export function checkStatusSelection(
  activeGroups: ReadonlySet<string>,
  statusParents: ReadonlyMap<string, ReadonlySet<string>>,
  sel: StatusSelection,
): string | null {
  const group = sel.statusGroup;
  const status = sel.status;

  if (group != null && !activeGroups.has(group)) {
    return `유효하지 않은 진행 1차 상태입니다: ${group}`;
  }
  if (status != null) {
    const parents = statusParents.get(status);
    if (parents === undefined) return `유효하지 않은 진행 2차 상태입니다: ${status}`;
    if (group != null && !parents.has(group)) {
      return `진행 2차 상태 "${status}"는 1차 "${group}"에 속하지 않습니다.`;
    }
  }
  return null;
}
