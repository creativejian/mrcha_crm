// 트림 canonical_name 파생 — 구 앱 caller(mr-cha-app: show_add_panel.dart, 2026-06-18 read-only
// 전환으로 삭제)와 동일 규칙. 국산: "{brand} {model} {trimName}", 수입: "{brand} {model}
// {modelYear} {fuelType} {trimName}". 다중 공백을 1칸으로 접고 앞뒤 공백 제거(빈 brand/model 방어).
// modelYear/fuelType null은 그 부분 생략 — 구 앱도 `?.toString() ?? ''`로 빈칸 처리했다(DB 컬럼이
// nullable이라 수정·이동 재계산 경로는 null을 만날 수 있다).
export function buildCanonicalName(input: {
  brand: string;
  model: string;
  isDomestic: boolean;
  modelYear: number | null;
  fuelType: string | null;
  trimName: string;
}): string {
  const parts = input.isDomestic
    ? [input.brand, input.model, input.trimName]
    : [input.brand, input.model, input.modelYear?.toString() ?? "", input.fuelType ?? "", input.trimName];
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// ── trim_name 빈 행 정책 SSOT (2026-08-08 유슨생 결정 ⓐ) ──────────────────────
// trim_name이 비면(NULL·공백) **canonical을 재계산하지 않는다** — 조립하면 등급이 빠진 이름
// ("BMW 5시리즈 2026 가솔린")이 되고, 그건 앱 검색 3열 OR의 1급 컬럼이라 그 행의 검색 정확도가
// 떨어진다. 게다가 백필이 같은 행을 계속 건너뛰므로 **자동 복구 경로가 없다**(한 번 덮으면 끝).
//
// ⚠️ 폴백으로 `trims.name`을 쓰지 않는다 — notNull이라 후보로 보이지만 **트림명이 아니다**:
// 실측(2026-08-08, 1902행 중 331행) `name = "[2026년형 가솔린 2.5 하이브리드 개별소비세 인하]
// XLE(A/T) (2,487cc)"` vs `trim_name = "XLE"`. 재료로 쓰면 canonical이 레거시 장문 라벨로 오염된다.
// (계산기·워크벤치의 modelName 체인이 name을 최종 tier로 쓰는 것과는 별개다 — 그쪽은 조립이 아니라
//  "표시할 게 아무것도 없을 때의 최후 폴백"이라 성격이 다르다.)
//
// 라이브 경로(updateTrim·moveTrims)와 백필이 이 한 벌을 공유한다 — 한쪽만 고치면 정책이 갈린다.
export function canonicalTrimName(trimName: string | null | undefined): string | null {
  const trimmed = trimName?.trim();
  return trimmed ? trimmed : null;
}

// ── 드리프트 판정(순수) ──────────────────────────────────────────────────────
// "현행 조립 규칙으로 다시 만든 값 ≠ 저장된 canonical_name"인 행을 뽑는다.
// `bun run backfill:canonical`(갱신 대상 산출)과 실 DB 트립와이어(전수 0 단언)가 이 한 벌을 공유한다
// — 판정이 두 벌이면 "백필은 깨끗하다는데 테스트는 빨간" 상태가 생긴다.
export type CanonicalDriftRow = {
  id: number;
  trimName: string | null;
  modelYear: number | null;
  fuelType: string | null;
  canonicalName: string | null;
  model: string;
  brand: string;
  isDomestic: boolean;
};

export type CanonicalDrift = {
  /** 재계산이 필요한 행(저장값 → 기대값). */
  mismatched: Array<{ id: number; from: string | null; to: string }>;
  /** trim_name이 비어 판정 대상에서 빠진 행 — 정책상 손대지 않고 **보고만** 한다(위 주석). */
  skipped: number[];
};

export function detectCanonicalDrift(rows: readonly CanonicalDriftRow[]): CanonicalDrift {
  const mismatched: CanonicalDrift["mismatched"] = [];
  const skipped: number[] = [];
  for (const r of rows) {
    const trimName = canonicalTrimName(r.trimName);
    if (!trimName) {
      skipped.push(r.id);
      continue;
    }
    const expected = buildCanonicalName({
      brand: r.brand,
      model: r.model,
      isDomestic: r.isDomestic,
      modelYear: r.modelYear,
      fuelType: r.fuelType,
      trimName,
    });
    if (expected !== r.canonicalName) mismatched.push({ id: r.id, from: r.canonicalName, to: expected });
  }
  return { mismatched, skipped };
}
