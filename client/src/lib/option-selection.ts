// 옵션 선택 관계 강제(includes/excludes) + 합산. 순수 함수 — 단위 테스트 가능.
// 규칙: ref/specs/2026-06-15-quote-option-selection-design.md

export type OptionRelation = { optionId: number; relatedOptionId: number; type: "includes" | "excludes" };
export type OptionLite = { id: number; type: "basic" | "tuning"; price: number | null };

// toggledId를 on(true)/off(false)로 바꿨을 때 관계를 적용한 새 선택 집합을 반환(원본 불변).
export function resolveSelection(
  relations: OptionRelation[],
  selected: ReadonlySet<number>,
  toggledId: number,
  on: boolean,
): Set<number> {
  const next = new Set(selected);
  if (!on) {
    next.delete(toggledId);
    return next;
  }
  next.add(toggledId);
  // includes: 단방향, 한 단계만 추가 (excludes는 UI 비활성화로 처리)
  for (const rel of relations) {
    if (rel.type === "includes" && rel.optionId === toggledId) next.add(rel.relatedOptionId);
  }
  return next;
}

// 선택된 옵션의 price 합(basic/tuning 모두 유료 옵션, price null → 0).
export function optionTotal(options: OptionLite[], selectedIds: ReadonlySet<number>): number {
  return options
    .filter((o) => selectedIds.has(o.id))
    .reduce((sum, o) => sum + (o.price ?? 0), 0);
}

// 선택된 옵션과 excludes 관계인(아직 선택 안 된) 옵션 = 비활성화 대상. 대칭.
export function disabledOptionIds(relations: OptionRelation[], selectedIds: ReadonlySet<number>): Set<number> {
  const disabled = new Set<number>();
  for (const rel of relations) {
    if (rel.type !== "excludes") continue;
    if (selectedIds.has(rel.optionId) && !selectedIds.has(rel.relatedOptionId)) disabled.add(rel.relatedOptionId);
    if (selectedIds.has(rel.relatedOptionId) && !selectedIds.has(rel.optionId)) disabled.add(rel.optionId);
  }
  return disabled;
}

// excludes를 무방향 그래프로 보고 connected component로 묶어 optionId→그룹번호.
// 그룹번호는 options 순서 기준 0,1,2… 안정 부여. excludes 미참여 옵션은 맵에 없음.
export function excludeGroups(options: OptionLite[], relations: OptionRelation[]): Map<number, number> {
  const parent = new Map<number, number>();
  function find(x: number): number {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  }
  for (const rel of relations) {
    if (rel.type !== "excludes") continue;
    if (!parent.has(rel.optionId)) parent.set(rel.optionId, rel.optionId);
    if (!parent.has(rel.relatedOptionId)) parent.set(rel.relatedOptionId, rel.relatedOptionId);
    parent.set(find(rel.optionId), find(rel.relatedOptionId));
  }
  const rootToIdx = new Map<number, number>();
  const result = new Map<number, number>();
  for (const o of options) {
    if (!parent.has(o.id)) continue;
    const root = find(o.id);
    if (!rootToIdx.has(root)) rootToIdx.set(root, rootToIdx.size);
    result.set(o.id, rootToIdx.get(root)!);
  }
  return result;
}

// optionId와 excludes 관계인 상대 id들(대칭, 중복 제거).
export function excludePartners(relations: OptionRelation[], optionId: number): number[] {
  const partners = new Set<number>();
  for (const rel of relations) {
    if (rel.type !== "excludes") continue;
    if (rel.optionId === optionId) partners.add(rel.relatedOptionId);
    else if (rel.relatedOptionId === optionId) partners.add(rel.optionId);
  }
  return [...partners];
}
