// 옵션 합산 + excludes 그룹 유틸. 순수 함수 — 단위 테스트 가능.
// 규칙: ref/specs/2026-06-15-quote-option-selection-design.md
// (구 OptionPicker 전용이던 resolveSelection·disabledOptionIds는 픽커 다이얼로그 통일로 폐기 —
//  선택 강제/비활성화는 vehicle-pickers/OptionPickerDialog가 자체 처리한다.)

export type OptionRelation = { optionId: number; relatedOptionId: number; type: "includes" | "excludes" };
export type OptionLite = { id: number; type: "basic" | "tuning"; price: number | null };

// 선택된 옵션의 price 합(basic/tuning 모두 유료 옵션, price null → 0).
export function optionTotal(options: OptionLite[], selectedIds: ReadonlySet<number>): number {
  return options
    .filter((o) => selectedIds.has(o.id))
    .reduce((sum, o) => sum + (o.price ?? 0), 0);
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
