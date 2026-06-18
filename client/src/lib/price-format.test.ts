import { describe, expect, it } from "vitest";

import { formatPriceRangeKorean } from "./price-format";

// 앱 formatPriceRangeKorean(price_format.dart) 패리티: 만원 절삭(floor), 1억↑은 'N억 M만', min==max 단일가.
describe("formatPriceRangeKorean", () => {
  it("범위를 만원 단위로 표시한다(~ 앞뒤 공백)", () => {
    expect(formatPriceRangeKorean(45_060_000, 62_240_000)).toBe("4,506만 ~ 6,224만원");
    expect(formatPriceRangeKorean(68_360_000, 76_760_000)).toBe("6,836만 ~ 7,676만원");
  });

  it("min==max면 단일가로 표시한다", () => {
    expect(formatPriceRangeKorean(89_190_000, 89_190_000)).toBe("8,919만원");
    expect(formatPriceRangeKorean(98_000_000, 98_000_000)).toBe("9,800만원");
  });

  it("1억 이상은 'N억 M만'으로 표시한다", () => {
    expect(formatPriceRangeKorean(97_600_000, 179_100_000)).toBe("9,760만 ~ 1억 7,910만원");
    expect(formatPriceRangeKorean(68_950_000, 101_900_000)).toBe("6,895만 ~ 1억 190만원");
    expect(formatPriceRangeKorean(81_400_000, 105_300_000)).toBe("8,140만 ~ 1억 530만원");
  });

  it("억 단위가 딱 떨어지면 만 부분을 생략한다", () => {
    expect(formatPriceRangeKorean(100_000_000, 100_000_000)).toBe("1억원");
    expect(formatPriceRangeKorean(98_000_000, 200_000_000)).toBe("9,800만 ~ 2억원");
  });

  it("만원 미만은 절삭한다(floor)", () => {
    expect(formatPriceRangeKorean(14_609_000, 14_609_000)).toBe("1,460만원");
  });

  it("min 미정(null·0 이하)이면 emptyText를 반환한다", () => {
    expect(formatPriceRangeKorean(null, 50_000_000)).toBe("—");
    expect(formatPriceRangeKorean(0, 50_000_000)).toBe("—");
    expect(formatPriceRangeKorean(null, null, "")).toBe("");
  });

  it("max가 null이면 단일가로 처리한다", () => {
    expect(formatPriceRangeKorean(50_000_000, null)).toBe("5,000만원");
  });
});
