import { describe, expect, it } from "vitest";

import { brandIdFromSearch, mcMasterPath } from "./mc-master-route";

describe("brandIdFromSearch", () => {
  it("?brand= 숫자를 파싱한다", () => {
    expect(brandIdFromSearch("?brand=17")).toBe(17);
  });

  it("brand가 없으면 null", () => {
    expect(brandIdFromSearch("")).toBeNull();
    expect(brandIdFromSearch("?view=all")).toBeNull();
  });

  it("숫자가 아니거나 양수가 아니면 null (조작된 URL 방어)", () => {
    expect(brandIdFromSearch("?brand=abc")).toBeNull();
    expect(brandIdFromSearch("?brand=")).toBeNull();
    expect(brandIdFromSearch("?brand=0")).toBeNull();
    expect(brandIdFromSearch("?brand=-3")).toBeNull();
    expect(brandIdFromSearch("?brand=1.5")).toBeNull();
  });
});

describe("mcMasterPath", () => {
  it("모델 목록 뷰 — brand 쿼리를 얹는다", () => {
    expect(mcMasterPath(17)).toBe("/mc-master?brand=17");
  });

  it("트림 뷰 — modelId path에도 brand를 물고 간다", () => {
    expect(mcMasterPath(17, 402)).toBe("/mc-master/402?brand=17");
  });

  it("brandId가 없으면 쿼리 없이", () => {
    expect(mcMasterPath(null)).toBe("/mc-master");
    expect(mcMasterPath(null, 402)).toBe("/mc-master/402");
  });
});
