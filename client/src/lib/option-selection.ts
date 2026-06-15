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
  // excludes: 대칭으로 배타 옵션 제거
  for (const rel of relations) {
    if (rel.type !== "excludes") continue;
    if (rel.optionId === toggledId) next.delete(rel.relatedOptionId);
    else if (rel.relatedOptionId === toggledId) next.delete(rel.optionId);
  }
  // includes: 단방향, 한 단계만 추가 (excludes 뒤에 적용해 우선)
  for (const rel of relations) {
    if (rel.type === "includes" && rel.optionId === toggledId) next.add(rel.relatedOptionId);
  }
  return next;
}

// 선택된 옵션 중 tuning의 price 합(basic 제외, price null → 0).
export function optionTotal(options: OptionLite[], selectedIds: ReadonlySet<number>): number {
  return options
    .filter((o) => o.type === "tuning" && selectedIds.has(o.id))
    .reduce((sum, o) => sum + (o.price ?? 0), 0);
}
