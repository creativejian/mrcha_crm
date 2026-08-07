// catalog.trims.canonical_name 백필 — 현행 조립 규칙(buildCanonicalName)과 다른 행을 재계산해 갱신.
//
// 드리프트 기원(배치 16 C1 + 2026-08-06 조사): ①수정·이동 시 재계산 부재(이 PR의 updateTrim·
// moveTrims 수정으로 경로는 막혔다 — 이 스크립트는 그 전에 쌓인 잔재 담당) ②앱 시절 모델
// 개명 유산(The New 911→911 등 — CRM은 모델 개명이 봉인돼 백필로만 해소) ③2025-12-25 벌크
// 임포트의 후행 공백 잔재. 실측 2026-08-06: 원문 불일치 103행(내용 71 · 공백만 30 · 기타 2).
//
//   bun run backfill:canonical           # 조회만(대상 수·샘플 표시) — 기본값
//   bun run backfill:canonical -- --yes  # 실제 갱신
//
// 안전: canonical_name 단일 컬럼 UPDATE다. auto_mc_code 트리거는 mc_code 기존재 또는
// trim_code/model_year null이면 즉시 반환하고 "trim_code 有·mc_code 無" 행이 0이라(2026-08-06
// 함수 본문·데이터 실측) mc_code 우발 발급이 없다. updated_at은 트리거가 올린다(canonical이
// 실질 변경 감지 대상 — 의도된 동작). canonical은 앱 검색 3열 OR의 1급 컬럼이라 이 백필은
// 앱 검색 정확도에도 순영향이다.
import { eq } from "drizzle-orm";

import { brandsInCatalog, modelsInCatalog, trimsInCatalog } from "../db/catalog";
import { getDefaultDb } from "../db/client";
import { buildCanonicalName } from "../db/queries/canonical-name";

const db = getDefaultDb();
const confirmed = process.argv.includes("--yes");

const rows = await db
  .select({
    id: trimsInCatalog.id,
    trimName: trimsInCatalog.trimName,
    modelYear: trimsInCatalog.modelYear,
    fuelType: trimsInCatalog.fuelType,
    canonicalName: trimsInCatalog.canonicalName,
    model: modelsInCatalog.name,
    brand: brandsInCatalog.name,
    isDomestic: brandsInCatalog.isDomestic,
  })
  .from(trimsInCatalog)
  .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
  .innerJoin(brandsInCatalog, eq(brandsInCatalog.id, modelsInCatalog.brandId));

const skipped: number[] = [];
const targets: Array<{ id: number; from: string | null; to: string }> = [];
for (const r of rows) {
  if (!r.trimName?.trim()) {
    skipped.push(r.id); // trim_name 없이 조립하면 트림 부분이 빠진 canonical이 된다 — 손대지 않고 보고만.
    continue;
  }
  const expected = buildCanonicalName({
    brand: r.brand,
    model: r.model,
    isDomestic: r.isDomestic,
    modelYear: r.modelYear,
    fuelType: r.fuelType,
    trimName: r.trimName,
  });
  if (expected !== r.canonicalName) targets.push({ id: r.id, from: r.canonicalName, to: expected });
}

console.log(`[backfill:canonical] 전체 ${rows.length}행 중 불일치 ${targets.length}행`);
if (skipped.length > 0) console.log(`[backfill:canonical] ⚠️ trim_name 빈 행 ${skipped.length}건 스킵: ${skipped.join(", ")}`);
for (const t of targets.slice(0, 5)) {
  console.log(`  id ${t.id}: ${JSON.stringify(t.from)} → ${JSON.stringify(t.to)}`);
}
if (targets.length > 5) console.log(`  … 외 ${targets.length - 5}행`);

if (targets.length === 0) {
  console.log("[backfill:canonical] 할 일 없음");
  process.exit(0);
}
if (!confirmed) {
  console.log("[backfill:canonical] 조회만 했다(갱신하려면 `--yes`).");
  process.exit(0);
}

await db.transaction(async (tx) => {
  for (const t of targets) {
    await tx.update(trimsInCatalog).set({ canonicalName: t.to }).where(eq(trimsInCatalog.id, t.id));
  }
});
console.log(`[backfill:canonical] ✅ ${targets.length}행 갱신 완료`);
// 위 조회 전용 두 분기와 같이 명시 종료한다 — `db/client.ts`의 postgres 클라이언트에 idle_timeout이
// 없어 커넥션이 이벤트 루프를 잡고, 이 줄이 없으면 갱신을 마치고도 프로세스가 안 죽는다
// (운영자에겐 "트랜잭션이 걸린 것"으로 보여 강제 kill을 부른다 — 실제로 일을 하는 유일한 분기다).
process.exit(0);
