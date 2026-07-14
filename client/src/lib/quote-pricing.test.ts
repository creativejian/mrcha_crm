import { describe, expect, it } from "vitest";

import { computePricing, formatMoney, parseMoney, parsePercentInput, percentToWon } from "./quote-pricing";

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

describe("percentToWon", () => {
  it("퍼센트를 기준액 대비 원화로 환산(반올림)", () => {
    expect(percentToWon(10000000, 10)).toBe(1000000);
    expect(percentToWon(243000000, 4.55)).toBe(Math.round(243000000 * 4.55 / 100));
  });
  it("반올림 방향은 Math.round(0.5 올림)", () => {
    expect(percentToWon(3, 33.333333)).toBe(1); // 0.9999… → 1
    expect(percentToWon(100, 0.5)).toBe(1); // 0.5 → 1
  });
  it("0%·0 기준액은 0", () => {
    expect(percentToWon(10000000, 0)).toBe(0);
    expect(percentToWon(0, 50)).toBe(0);
  });
  it("기존 discountLineWon percent 분기와 동일 코어", () => {
    // discountLineWon("percent", value, basis) === Math.round(basis*value/100) === percentToWon(basis, value)
    for (const [basis, pct] of [[243000000, 3], [105000000, 45.5], [50000000, 100]] as const) {
      expect(percentToWon(basis, pct)).toBe(Math.round(basis * pct / 100));
    }
  });
});

describe("parsePercentInput", () => {
  it("정상 퍼센트 입력", () => {
    expect(parsePercentInput("10.5")).toBe(10.5);
    expect(parsePercentInput("45")).toBe(45);
    expect(parsePercentInput("")).toBe(0);
  });
  it("콤마 오입력은 숫자로 붙어 >100이 되어(상한 소비처가 fail-loud로 차단) — 파서는 105 반환", () => {
    expect(parsePercentInput("10,5")).toBe(105); // 콤마 제거 → "105"
    expect(parsePercentInput("45,5")).toBe(455);
  });
  it("다중 소수점 오입력은 여분 점을 흡수(관대) — 파생·전송이 같은 값을 본다", () => {
    expect(parsePercentInput("4.5.5")).toBe(4.55);
  });
  it("비유한/비숫자는 0(할인 payload NaN 오염 차단)", () => {
    expect(parsePercentInput("abc")).toBe(0);
    expect(parsePercentInput(".")).toBe(0);
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
