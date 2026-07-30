import { describe, expect, it } from "vitest";

import { buildChangeDiff } from "./catalog-change-requests";

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

  it("알 수 없는 키 — 라벨 폴백(키 그대로)", () => {
    expect(
      buildChangeDiff({
        kind: "trim.update",
        payload: { unknownField: "값" },
        snapshot: { unknownField: "이전값" },
      }),
    ).toEqual([{ label: "unknownField", before: "이전값", after: "값" }]);
  });
});
