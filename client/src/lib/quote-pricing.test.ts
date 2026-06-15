import { describe, expect, it } from "vitest";

import { computePricing, formatMoney, parseMoney } from "./quote-pricing";

describe("parseMoney", () => {
  it("콤마/원 기호를 제거하고 숫자로 변환", () => {
    expect(parseMoney("243,000,000")).toBe(243000000);
    expect(parseMoney("6,500,000원")).toBe(6500000);
  });
  it("빈값·비숫자는 0", () => {
    expect(parseMoney("")).toBe(0);
    expect(parseMoney("미선택")).toBe(0);
  });
});

describe("formatMoney", () => {
  it("천단위 콤마", () => {
    expect(formatMoney(243000000)).toBe("243,000,000");
    expect(formatMoney(0)).toBe("0");
  });
});

describe("computePricing", () => {
  it("현재 mock 시나리오와 일치", () => {
    expect(
      computePricing({
        basePrice: 243000000,
        optionPrice: 0,
        discount: 6500000,
        acquisitionTax: 13531000,
        bond: 0,
        delivery: 0,
        incidental: 0,
      }),
    ).toEqual({
      finalVehiclePrice: 236500000,
      registrationCost: 13531000,
      otherCost: 0,
      acquisitionCost: 250031000,
    });
  });
  it("할인·취득세·기타비용 변동 반영", () => {
    const r = computePricing({
      basePrice: 100000000,
      optionPrice: 5000000,
      discount: 3000000,
      acquisitionTax: 7000000,
      bond: 500000,
      delivery: 300000,
      incidental: 200000,
    });
    expect(r.finalVehiclePrice).toBe(102000000);
    expect(r.registrationCost).toBe(7500000);
    expect(r.otherCost).toBe(500000);
    expect(r.acquisitionCost).toBe(109500000);
  });
});
