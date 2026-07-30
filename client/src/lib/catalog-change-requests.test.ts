import { describe, expect, it } from "vitest";

import { buildChangeDiff, changeRequestDest } from "./catalog-change-requests";

describe("buildChangeDiff", () => {
  it("trim.update — 변경 필드만 전→후 표시(천단위 콤마)", () => {
    expect(
      buildChangeDiff({
        kind: "trim.update",
        payload: { price: 50000000 },
        snapshot: { price: 45000000 },
      }),
    ).toEqual([{ label: "가격", before: "45,000,000", after: "50,000,000" }]);
  });

  it("null→값 — before는 null, after는 값", () => {
    expect(
      buildChangeDiff({
        kind: "trim.update",
        payload: { driveSystem: "AWD" },
        snapshot: { driveSystem: null },
      }),
    ).toEqual([{ label: "구동방식", before: null, after: "AWD" }]);
  });

  it("model.create — 부모 id(brandId) 제외 + create는 before 전부 null, 빈 값은 —", () => {
    expect(
      buildChangeDiff({
        kind: "model.create",
        payload: { brandId: 3, name: "테스트모델", category: null },
        snapshot: {},
      }),
    ).toEqual([
      { label: "이름", before: null, after: "테스트모델" },
      { label: "카테고리", before: null, after: "—" },
    ]);
  });

  it("trim.no-option.set/unset — 빈 배열(kind 라벨이 전부)", () => {
    expect(buildChangeDiff({ kind: "trim.no-option.set", payload: {}, snapshot: {} })).toEqual([]);
    expect(buildChangeDiff({ kind: "trim.no-option.unset", payload: {}, snapshot: {} })).toEqual([]);
  });

  it("modelYear — 콤마 없이 표기(2,024는 오표기)", () => {
    expect(
      buildChangeDiff({
        kind: "trim.update",
        payload: { modelYear: 2027 },
        snapshot: { modelYear: 2026 },
      }),
    ).toEqual([{ label: "연식", before: "2026", after: "2027" }]);
  });

  it("알 수 없는 키 — 라벨 폴백(키 그대로)", () => {
    expect(
      buildChangeDiff({
        kind: "trim.update",
        payload: { unknownField: "값" },
        snapshot: { unknownField: "이전값" },
      }),
    ).toEqual([{ label: "unknownField", before: "이전값", after: "값" }]);
  });

  // TrimEditPanel은 13필드 전체를 매번 PATCH한다 — 그중 실제로 바뀐 필드만 diff에 남아야
  // 승인자가 눈으로 바뀐 줄을 찾을 수 있다(미필터 시 "45,000,000 → 45,000,000" 도배).
  const TRIM_UPDATE_COMMON = {
    trimName: "520i",
    price: 50000000,
    modelYear: 2026,
    fuelType: "가솔린",
    driveSystem: "FWD",
    displacementCc: 1998,
    transmissionType: "A/T",
    bodyStyle: "세단",
    seatingCapacity: 5,
    status: "판매중",
    financialDiscountAmount: 1000000,
    partnerDiscountAmount: null,
    cashDiscountAmount: null,
  };

  it("trim.update — 13필드 payload에서 1필드만 다름 → 미변경 줄은 걸러지고 diff 1줄만 남는다", () => {
    expect(
      buildChangeDiff({
        kind: "trim.update",
        payload: { ...TRIM_UPDATE_COMMON, price: 55000000 },
        snapshot: TRIM_UPDATE_COMMON,
      }),
    ).toEqual([{ label: "가격", before: "50,000,000", after: "55,000,000" }]);
  });

  it("trim.update — 13필드 전부 동일(null 필드 포함) → 빈 배열", () => {
    expect(
      buildChangeDiff({
        kind: "trim.update",
        payload: TRIM_UPDATE_COMMON,
        snapshot: TRIM_UPDATE_COMMON,
      }),
    ).toEqual([]);
  });

  it("option.update — type 값은 화면 라벨(기본 옵션/튜닝 옵션)로 표시", () => {
    expect(
      buildChangeDiff({
        kind: "option.update",
        payload: { type: "tuning" },
        snapshot: { type: "basic" },
      }),
    ).toEqual([{ label: "종류", before: "기본 옵션", after: "튜닝 옵션" }]);
  });
});

// 착지 경로 SSOT — 두 팝오버(대기열·내 요청)가 공유하는 URL 계약(brand 쿼리 필수·트림 hl 플래시).
describe("changeRequestDest", () => {
  it("브랜드 좌표가 없으면 null(삭제된 대상 — 갈 곳 없음)", () => {
    expect(changeRequestDest({ targetBrandId: null, targetModelId: 30, targetTrimId: 300 })).toBeNull();
  });

  it("모델이 없으면(model.create) 브랜드의 모델 목록으로", () => {
    expect(changeRequestDest({ targetBrandId: 3, targetModelId: null, targetTrimId: null })).toBe("/mc-master?brand=3");
  });

  it("트림까지 있으면 모델 뷰 + hl 플래시", () => {
    expect(changeRequestDest({ targetBrandId: 3, targetModelId: 30, targetTrimId: 300 })).toBe(
      "/mc-master/30?brand=3&hl=300",
    );
  });
});
