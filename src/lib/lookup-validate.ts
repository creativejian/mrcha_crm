import {
  CHANCE_OPTIONS,
  SOURCE_OPTIONS,
  DOC_TYPE_OPTIONS,
  TASK_CATEGORY_OPTIONS,
  SCHEDULE_TYPE_OPTIONS,
  customerStatusGroups,
} from "../../client/src/data/customers";
import { buildStatusMaps, checkStatusSelection, type StatusSelection } from "./status-lookup";

// 종속 없는 닫힌 도메인 — 코드 상수 SSOT의 in-memory Set(DB 왕복 0).
const LOOKUP_SETS: Record<string, ReadonlySet<string>> = {
  chance: new Set(CHANCE_OPTIONS),
  source: new Set(SOURCE_OPTIONS),
  doc_type: new Set(DOC_TYPE_OPTIONS),
  task_category: new Set(TASK_CATEGORY_OPTIONS),
  schedule_type: new Set(SCHEDULE_TYPE_OPTIONS),
};

// value null → 통과. 알 수 없는 category → 통과(방어). 사전 밖 → 400 메시지.
export function validateLookupValue(category: string, value: string | null | undefined): string | null {
  if (value == null) return null;
  const set = LOOKUP_SETS[category];
  if (!set) return null;
  return set.has(value) ? null : `유효하지 않은 ${category} 값입니다: ${value}`;
}

const statusMaps = buildStatusMaps(customerStatusGroups);

// 진행상태 종속 검증. 단독 전송=유효성만, 둘 다=종속까지(다부모).
export function validateStatusSelection(sel: StatusSelection): string | null {
  return checkStatusSelection(statusMaps.activeGroups, statusMaps.statusParents, sel);
}
