// 옵션 관계 표식(읽기 전용): 배타 그룹 색 점 + ⇄/⇒ 설명. 편집은 Phase 2.
// 그룹 계산(excludeGroups)·대칭 상대(excludePartners)는 견적 로직(option-selection)을 재사용.
import { type OptionRelation, excludePartners } from "@/lib/option-selection";

// 배타 그룹 색(앱 8색): 같은 색 = 중복 선택 불가.
export const EXCLUDE_PALETTE = [
  "#dc2626",
  "#2563eb",
  "#16a34a",
  "#ea580c",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#92400e",
];

// "A, B와 중복 선택 불가" (배타). 없으면 null. 최대 3개 + 외 N개.
export function excludesText(relations: OptionRelation[], optionId: number, nameById: Map<number, string>): string | null {
  const ids = excludePartners(relations, optionId);
  if (ids.length === 0) return null;
  const names = ids.map((id) => nameById.get(id) ?? `#${id}`);
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` 외 ${names.length - 3}개` : "";
  return `${shown}${more}와 중복 선택 불가`;
}

// "X, Y 자동 선택" (포함, 단방향). 없으면 null.
export function includesText(relations: OptionRelation[], optionId: number, nameById: Map<number, string>): string | null {
  const names = relations
    .filter((r) => r.type === "includes" && r.optionId === optionId)
    .map((r) => nameById.get(r.relatedOptionId) ?? `#${r.relatedOptionId}`);
  if (names.length === 0) return null;
  return `${names.join(", ")} 자동 선택`;
}
