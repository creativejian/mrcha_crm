// 계산기 payload 순수 계층 잠금(배치 7 A#15 후속 — CalculatorModal 클로저 추출).
// - buildScenarioPayload: % 환산 기준(finalVehiclePrice)·잔가 3모드 매핑·percent-0 생략 가드·
//   CM/AG feeRateFraction 결합·annualMileageKm parseInt 현 계약(unlimited→NaN, 가드가 상류 차단).
// - autoAcquisitionTax: 감면 3모드 공식 + manual/차량가 0 이하 = null("덮지 않는다").
// - resolveDealerSelection: `lenderCode::dealerName` 합성 해석(첫 '::' 기준 — 딜러명 사 간 중복 실존).
// 무변경 증명: 대표 시나리오 payload 전체 비교(스냅샷형 toEqual) — 클로저 원문 산술을 그대로 잠근다.
import { describe, expect, it } from "vitest";

import {
  autoAcquisitionTax,
  buildScenarioPayload,
  resetScenarioDealers,
  resolveDealerSelection,
  type SharedQuoteInputs,
} from "./build-payload";
import { defaultScenario, type ScenarioState } from "./types";

const TRIM = {
  mcCode: "MC-001",
  name: "320i",
  trimName: "320i M Sport",
  canonicalName: "BMW 3시리즈 320i M Sport",
};
const BRAND = { name: "BMW" };

const shared = (patch: Partial<SharedQuoteInputs> = {}): SharedQuoteInputs => ({
  totalQuotedPrice: 50_000_000,
  finalVehiclePrice: 47_000_000,
  discountKrw: 3_000_000,
  taxAmountNum: 2_990_900,
  bondIncluded: "included",
  bondAmountNum: 500_000,
  deliveryIncluded: "excluded",
  deliveryAmountNum: 300_000,
  extraIncluded: "excluded",
  extraAmountNum: 100_000,
  ...patch,
});

const scenario = (patch: Partial<ScenarioState> = {}): ScenarioState => ({
  ...defaultScenario(),
  ...patch,
});

describe("buildScenarioPayload — 무변경 스냅샷(대표 시나리오 payload 전체 비교)", () => {
  it("렌트 전 필드 시나리오: 클로저 원문과 동일한 payload 전체를 조립한다", () => {
    const payload = buildScenarioPayload(
      scenario({
        activeTab: "rent",
        period: "48",
        downPaymentType: "percent",
        downPayment: "10",
        depositType: "amount",
        deposit: "5,000,000",
        residualValueType: "percent",
        residualValue: "40",
        annualDistance: "30000",
        deliveryType: "special",
        maintenanceGrade: "vip",
        subsidy: "applicable",
        subsidyAmount: "1,000,000",
        cmFeePercent: "1.5",
        agFeePercent: "2",
      }),
      TRIM,
      BRAND,
      shared({ deliveryIncluded: "included" }),
    );
    expect(payload).toEqual({
      productType: "long_term_rental",
      releaseMethod: "special",
      maintenanceGrade: "vip",
      brand: "BMW",
      modelName: "BMW 3시리즈 320i M Sport",
      masterMcCode: "MC-001",
      affiliateType: "비제휴사",
      directModelEntry: false,
      ownershipType: "company",
      leaseTermMonths: 48,
      annualMileageKm: 30_000,
      upfrontPayment: 4_700_000, // Math.round(47,000,000 × 10 / 100) — 기준 = finalVehiclePrice
      depositAmount: 5_000_000, // amount 모드 = 콤마 제거 절대값 그대로
      quotedVehiclePrice: 50_000_000,
      discountAmount: 3_000_000,
      acquisitionTaxMode: "amount",
      acquisitionTaxAmountOverride: 2_990_900,
      includePublicBondCost: true,
      publicBondCost: 500_000,
      includeDeliveryFeeAmount: true,
      deliveryFeeAmount: 300_000,
      includeMiscFeeAmount: false,
      miscFeeAmount: undefined,
      residualMode: "standard",
      selectedResidualRateOverride: 0.4,
      residualAmountOverride: undefined,
      cmFeeRate: 0.015,
      agFeeRate: 0.02,
      evSubsidyAmount: 1_000_000,
      insuranceYearlyAmount: 0,
      lossDamageAmount: 0,
    });
  });

  it("리스 기본 시나리오: 렌트 전용 필드(releaseMethod/maintenanceGrade)는 undefined 미전송", () => {
    const payload = buildScenarioPayload(scenario(), TRIM, BRAND, shared());
    expect(payload).toEqual({
      productType: "operating_lease",
      releaseMethod: undefined,
      maintenanceGrade: undefined,
      brand: "BMW",
      modelName: "BMW 3시리즈 320i M Sport",
      masterMcCode: "MC-001",
      affiliateType: "비제휴사",
      directModelEntry: false,
      ownershipType: "company",
      leaseTermMonths: 60,
      annualMileageKm: 20_000,
      upfrontPayment: 0, // downPaymentType 'none' = 무조건 0
      depositAmount: 0,
      quotedVehiclePrice: 50_000_000,
      discountAmount: 3_000_000,
      acquisitionTaxMode: "amount",
      acquisitionTaxAmountOverride: 2_990_900,
      includePublicBondCost: true,
      publicBondCost: 500_000,
      includeDeliveryFeeAmount: false,
      deliveryFeeAmount: undefined,
      includeMiscFeeAmount: false,
      miscFeeAmount: undefined,
      residualMode: "high", // 기본 'max' → high, override 없음
      selectedResidualRateOverride: undefined,
      residualAmountOverride: undefined,
      cmFeeRate: 0, // 빈 % 칸 = 0 (워크벤치 계약)
      agFeeRate: 0,
      evSubsidyAmount: undefined, // subsidy 'none' = 미전송
      insuranceYearlyAmount: 0,
      lossDamageAmount: 0,
    });
  });

  it("트림 또는 브랜드 미선택이면 null", () => {
    expect(buildScenarioPayload(scenario(), null, BRAND, shared())).toBeNull();
    expect(buildScenarioPayload(scenario(), TRIM, null, shared())).toBeNull();
  });

  it("modelName 해석은 canonicalName ?? trimName ?? name 순", () => {
    const byTrimName = buildScenarioPayload(
      scenario(),
      { ...TRIM, canonicalName: null },
      BRAND,
      shared(),
    );
    expect(byTrimName?.modelName).toBe("320i M Sport");
    const byName = buildScenarioPayload(
      scenario(),
      { ...TRIM, canonicalName: null, trimName: null },
      BRAND,
      shared(),
    );
    expect(byName?.modelName).toBe("320i");
  });
});

describe("buildScenarioPayload — 잔가 3모드 매핑", () => {
  it("max → residualMode 'high', override 둘 다 undefined", () => {
    const p = buildScenarioPayload(
      scenario({ residualValueType: "max", residualValue: "9,999" }),
      TRIM,
      BRAND,
      shared(),
    );
    expect(p?.residualMode).toBe("high");
    expect(p?.selectedResidualRateOverride).toBeUndefined();
    expect(p?.residualAmountOverride).toBeUndefined();
  });

  it("percent → 'standard' + rate 분율(40 → 0.4), amount override는 undefined", () => {
    const p = buildScenarioPayload(
      scenario({ residualValueType: "percent", residualValue: "40" }),
      TRIM,
      BRAND,
      shared(),
    );
    expect(p?.residualMode).toBe("standard");
    expect(p?.selectedResidualRateOverride).toBe(0.4);
    expect(p?.residualAmountOverride).toBeUndefined();
  });

  it("amount → 'standard' + 금액 override(콤마 제거), rate override는 undefined", () => {
    const p = buildScenarioPayload(
      scenario({ residualValueType: "amount", residualValue: "18,000,000" }),
      TRIM,
      BRAND,
      shared(),
    );
    expect(p?.residualMode).toBe("standard");
    expect(p?.residualAmountOverride).toBe(18_000_000);
    expect(p?.selectedResidualRateOverride).toBeUndefined();
  });

  it("percent-0 생략 가드(CRM 이탈 1건): 0 입력이면 필드 자체 생략 — 파트너 스키마 positive() 400 차단", () => {
    const p = buildScenarioPayload(
      scenario({ residualValueType: "percent", residualValue: "0" }),
      TRIM,
      BRAND,
      shared(),
    );
    expect(p?.residualMode).toBe("standard");
    expect(p?.selectedResidualRateOverride).toBeUndefined();
    // 진짜 계약 = JSON 직렬화에서 키 부재(undefined 프로퍼티는 릴레이 body에 실리지 않는다)
    expect(JSON.parse(JSON.stringify(p))).not.toHaveProperty("selectedResidualRateOverride");
  });

  it("amount 모드 0은 생략 아님 — 0원 override 그대로(현 계약 잠금)", () => {
    const p = buildScenarioPayload(
      scenario({ residualValueType: "amount", residualValue: "0" }),
      TRIM,
      BRAND,
      shared(),
    );
    expect(p?.residualAmountOverride).toBe(0);
  });
});

describe("buildScenarioPayload — 선수금/보증금 % 환산 기준", () => {
  it("percent 모드 환산 기준은 finalVehiclePrice(할인 후) — totalQuotedPrice가 아니다", () => {
    const p = buildScenarioPayload(
      scenario({ downPaymentType: "percent", downPayment: "30", depositType: "percent", deposit: "20" }),
      TRIM,
      BRAND,
      shared({ totalQuotedPrice: 50_000_000, finalVehiclePrice: 47_000_000 }),
    );
    expect(p?.upfrontPayment).toBe(14_100_000); // round(47,000,000 × 30%)
    expect(p?.depositAmount).toBe(9_400_000); // round(47,000,000 × 20%)
  });

  it("none 모드는 입력값 무관 0", () => {
    const p = buildScenarioPayload(
      scenario({ downPaymentType: "none", downPayment: "5,000,000", depositType: "none", deposit: "30" }),
      TRIM,
      BRAND,
      shared(),
    );
    expect(p?.upfrontPayment).toBe(0);
    expect(p?.depositAmount).toBe(0);
  });

  it("비숫자 입력은 0 폴백(`Number(...) || 0` 원문 산술)", () => {
    const p = buildScenarioPayload(
      scenario({ downPaymentType: "amount", downPayment: "abc" }),
      TRIM,
      BRAND,
      shared(),
    );
    expect(p?.upfrontPayment).toBe(0);
  });
});

describe("buildScenarioPayload — CM/AG 수수료(feeRateFraction 결합)", () => {
  it("'.' 입력은 NaN이 아니라 0 — 제프 원형 parseFloat NaN→JSON null→릴레이 400 차단(calc-guards SSOT)", () => {
    const p = buildScenarioPayload(
      scenario({ cmFeePercent: ".", agFeePercent: "." }),
      TRIM,
      BRAND,
      shared(),
    );
    expect(p?.cmFeeRate).toBe(0);
    expect(p?.agFeeRate).toBe(0);
  });

  it("정상 % 입력은 분율(1.5 → 0.015, 2 → 0.02)", () => {
    const p = buildScenarioPayload(
      scenario({ cmFeePercent: "1.5", agFeePercent: "2" }),
      TRIM,
      BRAND,
      shared(),
    );
    expect(p?.cmFeeRate).toBe(0.015);
    expect(p?.agFeeRate).toBe(0.02);
  });
});

describe("buildScenarioPayload — annualMileageKm parseInt 현 계약", () => {
  it("숫자 어휘는 정수 변환('30000' → 30000)", () => {
    const p = buildScenarioPayload(scenario({ annualDistance: "30000" }), TRIM, BRAND, shared());
    expect(p?.annualMileageKm).toBe(30_000);
  });

  it("'unlimited'는 NaN(현 계약 그대로 — 상류 distanceGuardReason이 조회 자체를 차단한다)", () => {
    const p = buildScenarioPayload(scenario({ annualDistance: "unlimited" }), TRIM, BRAND, shared());
    expect(Number.isNaN(p?.annualMileageKm)).toBe(true);
  });
});

describe("buildScenarioPayload — 공채/탁송/부대비용 included 분기", () => {
  it("excluded면 include 플래그 false + 금액 필드 undefined(공채는 0이 아니라 생략)", () => {
    const p = buildScenarioPayload(
      scenario(),
      TRIM,
      BRAND,
      shared({ bondIncluded: "excluded", deliveryIncluded: "excluded", extraIncluded: "excluded" }),
    );
    expect(p?.includePublicBondCost).toBe(false);
    expect(p?.publicBondCost).toBeUndefined();
    expect(p?.includeDeliveryFeeAmount).toBe(false);
    expect(p?.deliveryFeeAmount).toBeUndefined();
    expect(p?.includeMiscFeeAmount).toBe(false);
    expect(p?.miscFeeAmount).toBeUndefined();
  });

  it("included면 include 플래그 true + 금액 동봉", () => {
    const p = buildScenarioPayload(
      scenario(),
      TRIM,
      BRAND,
      shared({ bondIncluded: "included", deliveryIncluded: "included", extraIncluded: "included" }),
    );
    expect(p?.publicBondCost).toBe(500_000);
    expect(p?.deliveryFeeAmount).toBe(300_000);
    expect(p?.miscFeeAmount).toBe(100_000);
  });
});

describe("autoAcquisitionTax — 감면 3모드 + manual(배치 판단 원문 = 자동 재계산 effect)", () => {
  it("none: floor(가격/1.1×7%/10)×10 — 55,000,000 → 3,500,000", () => {
    expect(autoAcquisitionTax(55_000_000, "none")).toBe(3_500_000);
  });

  it("hybrid: 기본식 − 400,000 → 3,100,000", () => {
    expect(autoAcquisitionTax(55_000_000, "hybrid")).toBe(3_100_000);
  });

  it("electric: 기본식 − 1,400,000 → 2,100,000", () => {
    expect(autoAcquisitionTax(55_000_000, "electric")).toBe(2_100_000);
  });

  it("10원 절사 실측 잠금: 10,000,000 → 636,360(부동소수 floor 경로 그대로)", () => {
    expect(autoAcquisitionTax(10_000_000, "none")).toBe(636_360);
  });

  it("감면이 기본식을 초과하면 0 하한 클램프(10,000,000 electric → 0)", () => {
    expect(autoAcquisitionTax(10_000_000, "electric")).toBe(0);
  });

  it("manual은 null — 직접 입력을 자동 재계산이 덮지 않는다(워크벤치 패리티)", () => {
    expect(autoAcquisitionTax(55_000_000, "manual")).toBeNull();
  });

  it("차량가 0 이하도 null — 직전 입력값 유지(원문 effect early return)", () => {
    expect(autoAcquisitionTax(0, "none")).toBeNull();
    expect(autoAcquisitionTax(-1, "electric")).toBeNull();
  });
});

describe("resolveDealerSelection — `lenderCode::dealerName` 합성 해석", () => {
  it("input 모드 + 합성값이면 {lenderCode, dealerName}으로 푼다", () => {
    expect(resolveDealerSelection({ dealerType: "input", dealer: "bnk-capital::모터원" })).toEqual({
      lenderCode: "bnk-capital",
      dealerName: "모터원",
    });
  });

  it("비제휴(nonAffiliated) 모드는 딜러값이 있어도 null", () => {
    expect(resolveDealerSelection({ dealerType: "nonAffiliated", dealer: "bnk-capital::모터원" })).toBeNull();
  });

  it("input 모드라도 빈 값이면 null", () => {
    expect(resolveDealerSelection({ dealerType: "input", dealer: "" })).toBeNull();
  });

  it("구분자 '::' 부재(합성 계약 위반)면 null — 어느 lender 것인지 알 수 없다", () => {
    expect(resolveDealerSelection({ dealerType: "input", dealer: "모터원" })).toBeNull();
  });

  it("첫 '::' 기준 분해 — dealerName에 '::'가 남아도 그대로 보존(indexOf 원문 계약)", () => {
    expect(resolveDealerSelection({ dealerType: "input", dealer: "meritz::모터::원" })).toEqual({
      lenderCode: "meritz",
      dealerName: "모터::원",
    });
  });
});

// 배치 8 A#1 — 브랜드 전환 시 3 시나리오 딜러 선택 리셋(워크벤치 resetCardDealer 미러).
// 딜러는 (lender, brand) 귀속이라 구 브랜드 딜러 잔존은 재조회 payload 무음 동봉
// (BNK 브랜드 스코프 미매칭 → 하드 폴백 무음 오계산). 값(dealer)만 리셋, dealerType 모드는 유지.
describe("resetScenarioDealers — 브랜드 전환 딜러 리셋(값만·모드 유지)", () => {
  it("딜러 선택이 있는 시나리오는 dealer만 ''로 리셋하고 dealerType('input')·다른 필드는 유지한다", () => {
    const withDealer = scenario({ dealerType: "input", dealer: "bnk-capital::모터원", period: "36", cmFeePercent: "1.5" });
    const [first] = resetScenarioDealers([withDealer, scenario(), scenario()]);
    expect(first).toEqual({ ...withDealer, dealer: "" });
    expect(first.dealerType).toBe("input"); // 모드 유지 — 비제휴로 강등하지 않는다
  });

  it("딜러가 빈 시나리오는 같은 참조를 그대로 반환한다(불필요 객체 교체 없음)", () => {
    const untouched = scenario({ dealerType: "input", dealer: "" });
    const withDealer = scenario({ dealerType: "input", dealer: "meritz::모터원" });
    const result = resetScenarioDealers([untouched, withDealer, scenario()]);
    expect(result[0]).toBe(untouched);
    expect(result[2].dealer).toBe("");
    expect(result[1]).toEqual({ ...withDealer, dealer: "" });
  });

  it("전 시나리오가 빈 딜러면 입력 튜플 참조를 그대로 반환한다(no-op — 리렌더 회피)", () => {
    const tuple: [ScenarioState, ScenarioState, ScenarioState] = [scenario(), scenario(), scenario()];
    expect(resetScenarioDealers(tuple)).toBe(tuple);
  });
});
