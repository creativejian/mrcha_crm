import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { brandsInCatalog, modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb } from "../client";
import { detectCanonicalDrift } from "./canonical-name";

// 실 catalog 전수 드리프트 트립와이어(2026-08-08 — 배치 16 후속 "그물 없음" 해소).
//
// 왜 필요한가: canonical_name은 DB 자동 계산이 없어 **쓰는 쪽이 매번 재계산해야** 유지된다.
// 현행 뮤테이터 3곳(createTrim·updateTrim·moveTrims)은 커버돼 있지만, 재계산을 빠뜨린 새 경로가
// 생기거나(예고된 것만 셋 — Phase 2 브랜드 편집·모델 개명 봉인 해제·차기 벌크 임포트) psql
// 직접 쓰기가 있으면 **무증상으로 다시 쌓인다**(2026-08-06 실측 103행이 그렇게 쌓였다).
// 이 테스트는 원인을 가리지 않고 **결과(데이터)**를 본다 — 어느 경로로 생겼든 걸린다.
//
// ⚠️ 읽기 전용이다(SELECT만 · 픽스처 0). 실 데이터를 대상으로 해야 의미가 있어 hermetic으로
// 옮기지 않는다 — db-bound registry에 등재해 로컬 test:server에서만 돈다.
// 빨개지면 고치는 법: `bun run backfill:canonical`로 대상을 확인하고 `-- --yes`로 갱신한다.
// 판정은 백필과 **같은 순수 함수**를 쓴다(detectCanonicalDrift) — 두 벌이면 "백필은 깨끗한데
// 테스트만 빨간" 상태가 생긴다.

test("실 catalog.trims: canonical_name이 현행 조립 규칙과 전부 일치한다", async () => {
  const rows = await getDefaultDb()
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

  // 카탈로그가 통째로 비면 이 단언은 아무것도 검사하지 않는다 — 조용한 통과를 막는다.
  expect(rows.length).toBeGreaterThan(0);

  const { mismatched, skipped } = detectCanonicalDrift(rows);
  // 실패 시 id만 보이면 원인을 못 좁힌다 — 앞 5건은 from→to를 그대로 띄운다.
  const sample = mismatched.slice(0, 5).map((m) => `#${m.id}: ${JSON.stringify(m.from)} → ${JSON.stringify(m.to)}`);
  expect(`${mismatched.length}건${sample.length ? `\n${sample.join("\n")}` : ""}`).toBe("0건");

  // trim_name 빈 행은 정책상 스킵 대상이지만(canonical-name.ts), 생겼다는 사실 자체는 알아야 한다
  // — API는 zod min(1)로 막고 있으므로 0이 아니면 DB 직접 쓰기·벌크 임포트가 있었다는 신호다.
  expect(skipped).toEqual([]);
});
