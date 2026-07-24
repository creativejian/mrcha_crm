import { describe, expect, it } from "vitest";

import { annualMileageTextOf, contractTermTextOf, deriveNeedsFromRequest, initialCostTextOf } from "./quote-request-needs";

describe("contractTermTextOf", () => {
  it("개월 수를 CRM 어휘로 바꾼다", () => {
    expect(contractTermTextOf(60)).toBe("60개월");
    expect(contractTermTextOf(36)).toBe("36개월");
  });

  it("값이 없으면 null", () => {
    expect(contractTermTextOf(null)).toBeNull();
  });
});

describe("annualMileageTextOf", () => {
  it("km 정수를 CRM 어휘로 바꾼다", () => {
    expect(annualMileageTextOf(20000)).toBe("20,000km");
    expect(annualMileageTextOf(30000)).toBe("30,000km");
  });

  it("값이 없으면 null", () => {
    expect(annualMileageTextOf(null)).toBeNull();
  });

  // CHECK 방어: 앱이 제출 전 검증하지만(chat_quote_flow.dart:379) 어휘 밖 값이 오면 컬럼 CHECK가
  // UPDATE를 통째로 거부한다. 그 필드만 버리고 나머지 파생은 살린다.
  it("CRM 어휘에 없는 값은 null로 버린다", () => {
    expect(annualMileageTextOf(12000)).toBeNull();
  });
});

describe("initialCostTextOf", () => {
  it("무보증", () => {
    expect(initialCostTextOf("none", null, null)).toBe("무보증");
  });

  it("비율이 있으면 비율 우선", () => {
    expect(initialCostTextOf("deposit", 30, 11800000)).toBe("보증금 30%");
    expect(initialCostTextOf("advance", 20, null)).toBe("선수금 20%");
  });

  it("비율이 0이고 금액만 있으면 금액", () => {
    expect(initialCostTextOf("deposit", 0, 11800000)).toBe("보증금 1,180만원");
  });

  // 실측: 레거시 요청(V2 이전)은 ratio·amount가 둘 다 0인 행이 많다(김지안 4건 전부).
  it("비율·금액이 모두 0이면 유형명만", () => {
    expect(initialCostTextOf("deposit", 0, 0)).toBe("보증금");
  });

  it("유형이 없으면 null", () => {
    expect(initialCostTextOf(null, 30, 100)).toBeNull();
  });
});

describe("deriveNeedsFromRequest", () => {
  it("V2 요청에서 5필드를 파생한다", () => {
    expect(
      deriveNeedsFromRequest({
        paymentMethod: "lease",
        period: 60,
        depositType: "none",
        depositRatio: null,
        rentalDeposit: 0,
        annualMileageKm: 20000,
        deliveryTimingMode: "within_three_months",
        deliveryTimingReferenceMonth: "2026-07",
        deliveryTargetMonth: null,
      }),
    ).toEqual({
      needMethod: "운용리스",
      needContractTerm: "60개월",
      needInitialCost: "무보증",
      needAnnualMileage: "20,000km",
      needTiming: "2026년 10월까지",
    });
  });

  // 실측: 2026-07-24 15:24 아반떼 N 요청이 구매방식·기간·보증금 전부 null이었다. 빈 칸은 정상 상태다.
  it("앱이 건너뛴 필드는 null로 남긴다", () => {
    expect(
      deriveNeedsFromRequest({
        paymentMethod: null,
        period: null,
        depositType: null,
        depositRatio: null,
        rentalDeposit: null,
        annualMileageKm: null,
        deliveryTimingMode: "within_three_months",
        deliveryTimingReferenceMonth: "2026-07",
        deliveryTargetMonth: null,
      }),
    ).toEqual({
      needMethod: null,
      needContractTerm: null,
      needInitialCost: null,
      needAnnualMileage: null,
      needTiming: "2026년 10월까지",
    });
  });

  // 레거시(V2 이전) 요청 — 출고 3필드가 없어 need_timing만 비고 나머지는 채워진다.
  it("레거시 요청도 있는 값만 파생한다", () => {
    expect(
      deriveNeedsFromRequest({
        paymentMethod: "rent",
        period: 48,
        depositType: "deposit",
        depositRatio: 10,
        rentalDeposit: 9890000,
        annualMileageKm: null,
        deliveryTimingMode: null,
        deliveryTimingReferenceMonth: null,
        deliveryTargetMonth: null,
      }),
    ).toEqual({
      needMethod: "장기렌트",
      needContractTerm: "48개월",
      needInitialCost: "보증금 10%",
      needAnnualMileage: null,
      needTiming: null,
    });
  });
});
