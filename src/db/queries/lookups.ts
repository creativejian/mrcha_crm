import { and, asc, eq, inArray } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { lookupValues } from "../schema";
import { checkStatusSelection, type StatusSelection } from "../../lib/status-lookup";

// 한 카테고리의 active 값 목록(sortOrder 순). 후속 슬라이스의 프론트 소비/관리 UI용.
export async function listLookup(category: string, executor: Executor = getDefaultDb()) {
  return executor
    .select()
    .from(lookupValues)
    .where(and(eq(lookupValues.category, category), eq(lookupValues.active, true)))
    .orderBy(asc(lookupValues.sortOrder));
}

// 진행상태 PATCH 종속 검증. status 관련 값이 없으면 DB 왕복 없이 통과(null).
// 있으면 active 값을 1쿼리로 읽어 순수 함수에 위임. 위반 시 에러 메시지(400 본문), OK면 null.
export async function validateStatusSelection(
  sel: StatusSelection,
  executor: Executor = getDefaultDb(),
): Promise<string | null> {
  if (sel.statusGroup == null && sel.status == null) return null;
  const rows = await executor
    .select({
      category: lookupValues.category,
      value: lookupValues.value,
      parentValue: lookupValues.parentValue,
    })
    .from(lookupValues)
    .where(and(inArray(lookupValues.category, ["status_group", "status"]), eq(lookupValues.active, true)));
  const activeGroups = new Set(rows.filter((r) => r.category === "status_group").map((r) => r.value));
  const statusParent = new Map(
    rows.filter((r) => r.category === "status").map((r) => [r.value, r.parentValue ?? ""] as const),
  );
  return checkStatusSelection(activeGroups, statusParent, sel);
}
