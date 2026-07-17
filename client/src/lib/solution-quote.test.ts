// client/src/lib/solution-quote.test.ts
import { describe, expect, test } from "vitest";

import {
  SOLUTION_LENDERS,
  buildSolutionQuoteInput,
  parseSolutionQuoteResult,
  solutionLenderOptions,
  solutionProductTypeOf,
} from "./solution-quote";

const BASE_ARGS = {
  lenderLabel: "신한카드",
  purchaseMethod: "운용리스",
  termMonths: 60,
  depositMode: "none" as const,
  depositRaw: "",
  downPaymentMode: "none" as const,
  downPaymentRaw: "",
  residualMode: "max" as const,
  residualRaw: "",
  mileageValue: "20,000km / 년",
  subsidyApplicable: false,
  subsidyRaw: "",
  cmFeeRaw: "",
  agFeeRaw: "",
  dealerName: null,
  vehicle: { brand: "BMW", model: "3 Series", mcCode: "MC-TEST-001" },
  pricing: { baseAndOption: 59_000_000, discount: 6_500_000 },
};

describe("어휘 SSOT", () => {
  test("운용리스 = 8사, 장기렌트 = 3사(MG·메리츠·iM), 그 외 = 빈 배열", () => {
    expect(SOLUTION_LENDERS).toHaveLength(8);
    expect(solutionLenderOptions("운용리스")).toHaveLength(8);
    expect(solutionLenderOptions("장기렌트").map((l) => l.code)).toEqual([
      "mg-capital", "meritz-capital", "im-capital",
    ]);
    expect(solutionLenderOptions("할부")).toEqual([]);
  });

  test("productType 매핑: 운용리스/장기렌트만, 그 외 null", () => {
    expect(solutionProductTypeOf("운용리스")).toBe("operating_lease");
    expect(solutionProductTypeOf("장기렌트")).toBe("long_term_rental");
    expect(solutionProductTypeOf("할부")).toBeNull();
    expect(solutionProductTypeOf("일시불")).toBeNull();
  });
});

describe("buildSolutionQuoteInput", () => {
  test("기본 케이스(없음·최대·기본거리): 0원·high·20000km, ownershipType company 고정", () => {
    const r = buildSolutionQuoteInput(BASE_ARGS);
    if (!r.ok) throw new Error(r.reason);
    expect(r.input).toEqual({
      lenderCode: "shinhan-card",
      productType: "operating_lease",
      brand: "BMW",
      modelName: "3 Series",
      masterMcCode: "MC-TEST-001",
      ownershipType: "company",
      leaseTermMonths: 60,
      annualMileageKm: 20000,
      depositAmount: 0,
      upfrontPayment: 0,
      quotedVehiclePrice: 59_000_000,
      discountAmount: 6_500_000,
      // CM/AG(계산기 패리티) — 빈 칸도 분율 0 상시 전송(계산기 payload 미러)
      cmFeeRate: 0,
      agFeeRate: 0,
      residualMode: "high",
    });
  });

  test("% 모드는 할인 전 차량가 기준 원 환산(반올림)", () => {
    const r = buildSolutionQuoteInput({
      ...BASE_ARGS,
      depositMode: "percent", depositRaw: "10",
      downPaymentMode: "amount", downPaymentRaw: "1,180,000",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.depositAmount).toBe(5_900_000); // 59,000,000의 10%
    expect(r.input.upfrontPayment).toBe(1_180_000); // 콤마 파싱
  });

  test("잔존 3모드: 최대=high / %=standard+ratio(분율) / 금액=standard+amountOverride", () => {
    const pct = buildSolutionQuoteInput({ ...BASE_ARGS, residualMode: "percent", residualRaw: "45" });
    if (!pct.ok) throw new Error(pct.reason);
    expect(pct.input.residualMode).toBe("standard");
    expect(pct.input.residualValueRatio).toBeCloseTo(0.45);
    expect(pct.input.residualAmountOverride).toBeUndefined();

    const amt = buildSolutionQuoteInput({ ...BASE_ARGS, residualMode: "amount", residualRaw: "30,000,000" });
    if (!amt.ok) throw new Error(amt.reason);
    expect(amt.input.residualMode).toBe("standard");
    expect(amt.input.residualAmountOverride).toBe(30_000_000);
  });

  test("보조금 해당 시 evSubsidyAmount, 비해당 시 미전송", () => {
    const on = buildSolutionQuoteInput({ ...BASE_ARGS, subsidyApplicable: true, subsidyRaw: "5,700,000" });
    if (!on.ok) throw new Error(on.reason);
    expect(on.input.evSubsidyAmount).toBe(5_700_000);
    const off = buildSolutionQuoteInput(BASE_ARGS);
    if (!off.ok) throw new Error(off.reason);
    expect(off.input.evSubsidyAmount).toBeUndefined();
  });

  test("실패 사유: 금융사 미선택/미지원 어휘/차량 미선택/mcCode 부재/약정거리 이탈", () => {
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, lenderLabel: "미선택" }).ok).toBe(false);
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, lenderLabel: "하나캐피탈" }).ok).toBe(false); // 구 어휘
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, vehicle: { brand: null, model: null, mcCode: null } }).ok).toBe(false);
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, vehicle: { ...BASE_ARGS.vehicle, mcCode: null } }).ok).toBe(false);
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, mileageValue: "13,000km / 년" }).ok).toBe(false);
  });

  test("장기렌트 × 운용리스 전용 금융사(신한카드) = 실패(미취급 선차단)", () => {
    const r = buildSolutionQuoteInput({ ...BASE_ARGS, purchaseMethod: "장기렌트" });
    expect(r.ok).toBe(false);
  });

  test("% 100 초과 = 실패(콤마 오입력 차단 — parseInterestRate 선례 미러)", () => {
    // "10,5"(10.5% 의도)가 콤마 제거로 105%가 되는 오입력 — 무음 전송 대신 fail-loud
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, depositMode: "percent", depositRaw: "10,5" }).ok).toBe(false);
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, residualMode: "percent", residualRaw: "45,5" }).ok).toBe(false);
  });

  test("소수 %는 정상 환산(10.5% → 반올림 원 환산)", () => {
    const r = buildSolutionQuoteInput({ ...BASE_ARGS, depositMode: "percent", depositRaw: "10.5" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.depositAmount).toBe(6_195_000); // 59,000,000의 10.5%
  });

  test("다중 소수점 % 오입력은 흡수(parsePercentInput SSOT 통일) — 콤마(>100 차단)와 별개 축, 파생과 일치", () => {
    // 구현 이전: Number("4.5.5")=NaN → 실패. 통일 후: parsePercentInput이 "4.55" 흡수.
    const r = buildSolutionQuoteInput({ ...BASE_ARGS, depositMode: "percent", depositRaw: "4.5.5" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.depositAmount).toBe(2_684_500); // 59,000,000의 4.55%
  });

  test("기간 이탈(72개월) = 실패", () => {
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, termMonths: 72 }).ok).toBe(false);
  });

  test("CM/AG 수수료 % → 분율 전송(빈 칸 = 0 상시 전송 — 계산기 payload 미러), 100 초과 = 실패", () => {
    const empty = buildSolutionQuoteInput(BASE_ARGS);
    if (!empty.ok) throw new Error(empty.reason);
    expect(empty.input.cmFeeRate).toBe(0);
    expect(empty.input.agFeeRate).toBe(0);
    const filled = buildSolutionQuoteInput({ ...BASE_ARGS, cmFeeRaw: "1.5", agFeeRaw: "2" });
    if (!filled.ok) throw new Error(filled.reason);
    expect(filled.input.cmFeeRate).toBeCloseTo(0.015);
    expect(filled.input.agFeeRate).toBeCloseTo(0.02);
    // "1,5"(1.5% 의도) 콤마 오입력 → 15%가 아니라 105류 상한 검사… parsePercentInput은 콤마 제거 "15" — 100 이하라 통과.
    // fail-loud 상한은 진짜 비현실값(>100)만 차단(보증금 % 미러): "10,5" → 105% → 실패.
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, cmFeeRaw: "10,5" }).ok).toBe(false);
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, agFeeRaw: "10,5" }).ok).toBe(false);
  });

  test("차량가 미입력(0원) = 실패", () => {
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, pricing: { baseAndOption: 0, discount: 0 } }).ok).toBe(false);
  });

  test("판매사(T2): dealerName passthrough — null(비제휴/미선택)은 미전송, 값은 그대로 동봉", () => {
    const off = buildSolutionQuoteInput(BASE_ARGS); // BASE_ARGS.dealerName = null
    if (!off.ok) throw new Error(off.reason);
    expect(off.input.dealerName).toBeUndefined(); // 파트너 zod min(1) optional — 빈/무선택은 키 자체 미전송
    const on = buildSolutionQuoteInput({ ...BASE_ARGS, dealerName: "도이치모터스" });
    if (!on.ok) throw new Error(on.reason);
    expect(on.input.dealerName).toBe("도이치모터스");
  });
});

describe("parseSolutionQuoteResult", () => {
  const RAW = {
    ok: true,
    quote: {
      lenderCode: "shinhan-card",
      workbookImport: { id: "w1", versionLabel: "2607" },
      monthlyPayment: 1_750_000,
      rates: { annualRateDecimal: 0.0532, effectiveAnnualRateDecimal: 0.0561, monthlyRateDecimal: 0.0044 },
      residual: { rateDecimal: 0.45, amount: 26_550_000, source: "residual-matrix", matrixGroup: null },
      warnings: ["잔가 후보 2개 중 최대값 적용"],
    },
  };

  test("정상 응답: 필수 필드 + 확장 3필드 optional(null)", () => {
    const p = parseSolutionQuoteResult(RAW);
    if (!p) throw new Error("parse 실패");
    expect(p.monthlyPayment).toBe(1_750_000);
    expect(p.annualRatePct).toBeCloseTo(5.32);
    expect(p.effectiveAnnualRatePct).toBeCloseTo(5.61);
    expect(p.residualAmount).toBe(26_550_000);
    expect(p.workbookVersion).toBe("2607");
    expect(p.warnings).toEqual(["잔가 후보 2개 중 최대값 적용"]);
    expect(p.totalReturnCost).toBeNull(); // 제프 확장 전 — 파생 조립 금지(스펙 결정 3)
    expect(p.totalTakeoverCost).toBeNull();
    expect(p.dueAtDelivery).toBeNull();
  });

  test("확장 3필드가 오면 그대로 노출(제프 응답 확장 선반영)", () => {
    const p = parseSolutionQuoteResult({
      ...RAW,
      quote: { ...RAW.quote, totalReturnCost: 110_000_000, totalTakeoverCost: 140_000_000, dueAtDelivery: 15_000_000 },
    });
    if (!p) throw new Error("parse 실패");
    expect(p.totalReturnCost).toBe(110_000_000);
    expect(p.totalTakeoverCost).toBe(140_000_000);
    expect(p.dueAtDelivery).toBe(15_000_000);
  });

  test("필수 누락(monthlyPayment 없음/ok:false/비객체)은 null", () => {
    expect(parseSolutionQuoteResult({ ok: false, error: "미취급" })).toBeNull();
    expect(parseSolutionQuoteResult({ ok: true, quote: { rates: {} } })).toBeNull();
    expect(parseSolutionQuoteResult("garbage")).toBeNull();
  });

  test("rates가 primitive여도 크래시 없이 null(방어 파싱)", () => {
    expect(
      parseSolutionQuoteResult({ ok: true, quote: { monthlyPayment: 1, rates: "x", residual: { amount: 1 } } }),
    ).toBeNull();
  });

  // (solutionDisplayRatePct 케이스는 개정 1로 제거 — 카드 금리는 lease-rate.ts 실질 금리 파생이 담당.)
});
