import { and, inArray } from "drizzle-orm";

import { CHANCE_OPTIONS, customerStatusGroups } from "../client/src/data/customers";
import { getDefaultDb } from "../src/db/client";
import { lookupValues } from "../src/db/schema";

// 진행상태 어휘를 lookup_values로 시드한다(멱등).
// 입력 = client 상수 customerStatusGroups(현행 진실원본). value=현행 text 그대로.
async function main() {
  const db = getDefaultDb();

  const rows: (typeof lookupValues.$inferInsert)[] = [];
  let groupOrder = 0;
  for (const [group, statuses] of Object.entries(customerStatusGroups)) {
    rows.push({ category: "status_group", value: group, parentValue: null, sortOrder: groupOrder });
    groupOrder += 1;
    statuses.forEach((status, i) => {
      // 같은 status 문자열이 여러 그룹에 중복 존재(예: "추후재컨택")할 수 있다.
      // (category,value) unique라 status는 그룹 간 1행만 살아남는다 — 종속 검증은
      // "그 status가 유효한 2차 값인가" + "둘 다 보낼 때 일치" 수준이라 허용 가능.
      // 정밀 종속(같은 status가 그룹마다 별개)은 후속에서 복합키로 승격.
      rows.push({ category: "status", value: status, parentValue: group, sortOrder: i });
    });
  }

  // 계약 가능성(chance) — 종속 없는 닫힌 집합(CHANCE_OPTIONS).
  CHANCE_OPTIONS.forEach((value, i) => {
    rows.push({ category: "chance", value, parentValue: null, sortOrder: i });
  });

  // 멱등: 이 카테고리들을 지우고 재삽입.
  await db.delete(lookupValues).where(and(inArray(lookupValues.category, ["status_group", "status", "chance"])));
  // 중복 (category,value) 제거 후 삽입(중복 status는 첫 그룹만).
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const k = `${r.category}:${r.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  await db.insert(lookupValues).values(deduped);

  console.log(`seeded lookup_values: ${deduped.length} rows (status_group/status/chance)`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
