import { expect, test } from "bun:test";

import { buildCanonicalName, canonicalTrimName, detectCanonicalDrift } from "./canonical-name";

test("국산: brand model trimName", () => {
  expect(
    buildCanonicalName({
      brand: "현대",
      model: "그랜저",
      isDomestic: true,
      modelYear: 2026,
      fuelType: "가솔린",
      trimName: "프리미엄 - 익스클루시브",
    }),
  ).toBe("현대 그랜저 프리미엄 - 익스클루시브");
});

test("수입: brand model year fuel trimName", () => {
  expect(
    buildCanonicalName({
      brand: "BMW",
      model: "5 Series",
      isDomestic: false,
      modelYear: 2026,
      fuelType: "가솔린",
      trimName: "520i",
    }),
  ).toBe("BMW 5 Series 2026 가솔린 520i");
});

test("앞뒤 공백 trim + 빈 brand/model 허용", () => {
  expect(
    buildCanonicalName({
      brand: "",
      model: "",
      isDomestic: false,
      modelYear: 2026,
      fuelType: "가솔린",
      trimName: "X",
    }),
  ).toBe("2026 가솔린 X");
});

test("수입: modelYear/fuelType null이면 그 부분 생략(구 앱 규칙 parity)", () => {
  expect(
    buildCanonicalName({
      brand: "BMW",
      model: "5 Series",
      isDomestic: false,
      modelYear: null,
      fuelType: null,
      trimName: "520i",
    }),
  ).toBe("BMW 5 Series 520i");
});

// ── trim_name 빈 행 정책(2026-08-08 유슨생 결정 ⓐ) ────────────────────────────
// 이 판정이 라이브 경로(updateTrim·moveTrims)와 백필의 **공유 SSOT**다 — 여기가 무너지면
// 한쪽만 스킵하는 상태로 돌아간다(= 등급 빠진 canonical로 덮어쓰고 백필은 복구를 건너뛴다).

test("canonicalTrimName: null·빈 문자열·공백만은 전부 '재계산 안 함'(null)", () => {
  expect(canonicalTrimName(null)).toBeNull();
  expect(canonicalTrimName(undefined)).toBeNull();
  expect(canonicalTrimName("")).toBeNull();
  expect(canonicalTrimName("   ")).toBeNull();
});

test("canonicalTrimName: 값이 있으면 앞뒤 공백만 털어 돌려준다", () => {
  expect(canonicalTrimName("520i")).toBe("520i");
  expect(canonicalTrimName("  520i M Sport  ")).toBe("520i M Sport");
});

const ROW = {
  id: 1,
  trimName: "520i",
  modelYear: 2026,
  fuelType: "가솔린",
  canonicalName: "BMW 5 Series 2026 가솔린 520i",
  model: "5 Series",
  brand: "BMW",
  isDomestic: false,
};

test("detectCanonicalDrift: 규칙과 일치하면 불일치 0", () => {
  expect(detectCanonicalDrift([ROW])).toEqual({ mismatched: [], skipped: [] });
});

test("detectCanonicalDrift: 저장값이 낡았으면 from→to로 잡는다", () => {
  const stale = { ...ROW, canonicalName: "BMW 5 Series 2025 가솔린 구트림" };
  expect(detectCanonicalDrift([stale])).toEqual({
    mismatched: [{ id: 1, from: "BMW 5 Series 2025 가솔린 구트림", to: "BMW 5 Series 2026 가솔린 520i" }],
    skipped: [],
  });
});

test("detectCanonicalDrift: canonical이 아예 NULL인 행도 불일치다(미생성 = 드리프트)", () => {
  expect(detectCanonicalDrift([{ ...ROW, canonicalName: null }]).mismatched).toHaveLength(1);
});

test("detectCanonicalDrift: trim_name 빈 행은 불일치가 아니라 skipped — 손대지 않고 보고만", () => {
  // 저장값이 규칙과 어긋나 있어도(트림 부분 없음) 재계산 대상이 아니다. 여기서 mismatched로
  // 새면 백필이 그 행을 갱신해 등급 없는 이름을 박제한다.
  const blank = { ...ROW, trimName: "  ", canonicalName: "BMW 5 Series 2026 가솔린 520i" };
  expect(detectCanonicalDrift([blank])).toEqual({ mismatched: [], skipped: [1] });
});
