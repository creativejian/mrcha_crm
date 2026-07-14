// client/src/lib/lease-rate.test.ts
import { describe, expect, test } from "vitest";

import { calculateRate, deriveCardResults, residualAmountOf } from "./lease-rate";

describe("calculateRate (앱 리스계산기 RATE 솔버 이식)", () => {
  test("앱 검증 벡터: n=60·월납입 1,200,000·취득원가 75,000,000·잔가 35,000,000·선수금 10,000,000 → 연 16.0840%", () => {
    // 앱 calculateLeaseDetails 관례 미러: PV = -(취득원가 - 선수금), guess 0.0001, 연이율 = 월이율 × 1200.
    const monthlyRate = calculateRate(60, 1_200_000, -(75_000_000 - 10_000_000), 35_000_000, 0, 0.0001);
    expect(monthlyRate * 1200).toBeCloseTo(16.084, 3);
  });
});

describe("deriveCardResults (개정 1 R3 산식)", () => {
  const BASE = {
    monthly: 1_200_000,
    termMonths: 60,
    downPayment: 10_000_000,
    deposit: 5_000_000,
    residualAmount: 35_000_000 as number | null,
    otherCost: 300_000,
    acquisitionCost: 75_000_000,
  };

  test("산식 3종: 반납 = 월납입×기간+선수금 / 인수 = +잔가 / 출고 전 = 보증금+선수금+기타비용", () => {
    const r = deriveCardResults(BASE);
    expect(r.totalReturn).toBe(82_000_000); // 1,200,000×60 + 10,000,000
    expect(r.totalTakeover).toBe(117_000_000); // + 잔가 35,000,000
    expect(r.dueAtDelivery).toBe(15_300_000); // 5,000,000 + 10,000,000 + 300,000
  });

  test("금리 = RATE 역산 연이율(소수 2자리 반올림) — 앱 검증 벡터 입력이면 16.08", () => {
    expect(deriveCardResults(BASE).ratePct).toBe(16.08);
  });

  test("잔가 미정(null): 인수 총비용·금리만 공란, 반납·출고 전은 계산된다", () => {
    const r = deriveCardResults({ ...BASE, residualAmount: null });
    expect(r.totalReturn).toBe(82_000_000);
    expect(r.dueAtDelivery).toBe(15_300_000);
    expect(r.totalTakeover).toBeNull();
    expect(r.ratePct).toBeNull();
  });

  test("월납입 0 이하 = 전 필드 공란(월 납입금이 결정되면 채워지는 계약 — 균일 게이트)", () => {
    expect(deriveCardResults({ ...BASE, monthly: 0 })).toEqual({
      totalReturn: null, totalTakeover: null, dueAtDelivery: null, ratePct: null,
    });
  });

  test("취득원가 0이면 금리만 공란(나머지 산식은 취득원가 비의존)", () => {
    const r = deriveCardResults({ ...BASE, acquisitionCost: 0 });
    expect(r.ratePct).toBeNull();
    expect(r.totalReturn).toBe(82_000_000);
  });
});

describe("residualAmountOf (잔존가치 금액 해석 3모드)", () => {
  test("금액 모드: 콤마 파싱, 0/빈값은 null", () => {
    expect(residualAmountOf("amount", "35,000,000", 59_000_000)).toBe(35_000_000);
    expect(residualAmountOf("amount", "0", 59_000_000)).toBeNull();
    expect(residualAmountOf("amount", "", 59_000_000)).toBeNull();
  });

  test("% 모드: 할인 전 차량가(base+option) 기준 반올림 환산 — 0·NaN·100 초과는 null(빌더 fail-loud 상한 미러)", () => {
    expect(residualAmountOf("percent", "45", 59_000_000)).toBe(26_550_000);
    expect(residualAmountOf("percent", "45.5", 10_000)).toBe(4_550);
    expect(residualAmountOf("percent", "0", 59_000_000)).toBeNull();
    expect(residualAmountOf("percent", "45,5", 59_000_000)).toBeNull(); // 콤마 오입력 → 455%
  });

  test("다중 소수점 오입력은 여분 점 흡수(parsePercentInput SSOT 통일) — 파생·전송이 같은 값을 본다", () => {
    // 구현 이전: Number(\"4.5.5\")=NaN → null. 통일 후: parsePercentInput이 \"4.55\" 흡수(콤마 fail-loud와 별개 축).
    expect(residualAmountOf("percent", "4.5.5", 10_000)).toBe(455); // 4.55% × 10,000 = 455
  });

  test("최대 모드: 조회가 채운 실채택 잔가 금액, 조회 전(\"-\"/0)은 null(미정)", () => {
    expect(residualAmountOf("max", "26,550,000", 59_000_000)).toBe(26_550_000);
    expect(residualAmountOf("max", "-", 59_000_000)).toBeNull();
  });
});
