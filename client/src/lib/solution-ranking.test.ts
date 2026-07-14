// client/src/lib/solution-ranking.test.ts
import { describe, expect, test } from "vitest";

import {
  buildRankingEntry,
  computeRankingStats,
  isLenderNotAvailableMessage,
  monthlyDelta,
  rankingBadgeFlags,
  solutionMonthlyDisplay,
  sortRankingEntries,
  type SolutionRankingEntry,
} from "./solution-ranking";
import { type SolutionQuoteParsed } from "./solution-quote";

function parsedFixture(over: Partial<SolutionQuoteParsed> = {}): SolutionQuoteParsed {
  return {
    monthlyPayment: 860_820,
    annualRatePct: 5.32,
    effectiveAnnualRatePct: 5.61,
    residualRatePct: 45,
    residualAmount: 26_550_000,
    workbookVersion: "2607",
    warnings: [],
    totalReturnCost: null,
    totalTakeoverCost: null,
    dueAtDelivery: null,
    ...over,
  };
}

function entryFixture(over: Partial<SolutionRankingEntry> = {}): SolutionRankingEntry {
  return {
    lenderCode: "shinhan-card",
    label: "신한카드",
    monthlyDisplay: 900_000,
    ratePct: 5.32,
    residualAmount: 26_550_000,
    residualPct: 45,
    totalCost: 900_000 * 60 + 26_550_000,
    warnings: [],
    raw: { ok: true },
    ...over,
  };
}

describe("solutionMonthlyDisplay (제프 표시 라운딩 미러)", () => {
  test("운용리스 = 100원 올림(860,820 → 860,900), 장기렌트 = raw 그대로(VAT 기포함)", () => {
    expect(solutionMonthlyDisplay("operating_lease", 860_820)).toBe(860_900);
    expect(solutionMonthlyDisplay("operating_lease", 860_900)).toBe(860_900); // 이미 100원 단위면 불변
    expect(solutionMonthlyDisplay("long_term_rental", 860_820)).toBe(860_820);
  });
});

describe("buildRankingEntry", () => {
  test("표시 라운딩·총 비용(표시 월납입 × 기간 + 잔가)·잔가 % 조립", () => {
    const e = buildRankingEntry("shinhan-card", "신한카드", parsedFixture(), { ok: true }, "operating_lease", 60);
    expect(e.monthlyDisplay).toBe(860_900);
    expect(e.ratePct).toBe(5.32); // 일반 금융사 = 표면금리
    expect(e.residualAmount).toBe(26_550_000);
    expect(e.residualPct).toBe(45);
    expect(e.totalCost).toBe(860_900 * 60 + 26_550_000);
    expect(e.label).toBe("신한카드");
  });

  test("우리카드만 유효금리(제프 sortQuotes 미러 — 잔가보장수수료 lump-sum)", () => {
    const woori = buildRankingEntry("woori-card", "우리카드", parsedFixture(), {}, "operating_lease", 60);
    expect(woori.ratePct).toBe(5.61);
    const other = buildRankingEntry("im-capital", "iM캐피탈", parsedFixture(), {}, "operating_lease", 60);
    expect(other.ratePct).toBe(5.32);
  });
});

describe("sortRankingEntries (4종·stable)", () => {
  const a = entryFixture({ lenderCode: "mg-capital", label: "MG캐피탈", monthlyDisplay: 900_000, ratePct: 6, residualAmount: 30_000_000, totalCost: 84_000_000 });
  const b = entryFixture({ lenderCode: "im-capital", label: "iM캐피탈", monthlyDisplay: 880_000, ratePct: 5, residualAmount: 25_000_000, totalCost: 77_800_000 });
  const c = entryFixture({ lenderCode: "shinhan-card", label: "신한카드", monthlyDisplay: 920_000, ratePct: 4.8, residualAmount: 28_000_000, totalCost: 83_200_000 });

  test("월 납입 순(기본, asc) / 금리 순(asc) / 잔존가치 순(desc) / 총 비용 순(asc)", () => {
    expect(sortRankingEntries([a, b, c], "monthlyPayment").map((e) => e.lenderCode)).toEqual(["im-capital", "mg-capital", "shinhan-card"]);
    expect(sortRankingEntries([a, b, c], "interestRate").map((e) => e.lenderCode)).toEqual(["shinhan-card", "im-capital", "mg-capital"]);
    expect(sortRankingEntries([a, b, c], "residualValue").map((e) => e.lenderCode)).toEqual(["mg-capital", "shinhan-card", "im-capital"]);
    expect(sortRankingEntries([a, b, c], "totalCost").map((e) => e.lenderCode)).toEqual(["im-capital", "shinhan-card", "mg-capital"]);
  });

  test("동률은 입력 순서 유지(stable — SOLUTION_LENDERS 순서 보존) + 원본 배열 불변", () => {
    const tie1 = entryFixture({ lenderCode: "mg-capital", monthlyDisplay: 900_000 });
    const tie2 = entryFixture({ lenderCode: "bnk-capital", monthlyDisplay: 900_000 });
    const input = [tie1, tie2];
    const sorted = sortRankingEntries(input, "monthlyPayment");
    expect(sorted.map((e) => e.lenderCode)).toEqual(["mg-capital", "bnk-capital"]);
    expect(input.map((e) => e.lenderCode)).toEqual(["mg-capital", "bnk-capital"]); // copy sort
  });
});

describe("computeRankingStats + rankingBadgeFlags + monthlyDelta", () => {
  const low = entryFixture({ lenderCode: "im-capital", monthlyDisplay: 880_000, ratePct: 5, residualAmount: 25_000_000, totalCost: 77_800_000 });
  const high = entryFixture({ lenderCode: "mg-capital", monthlyDisplay: 900_000, ratePct: 6, residualAmount: 30_000_000, totalCost: 84_000_000 });

  test("빈 배열 stats = null", () => {
    expect(computeRankingStats([])).toBeNull();
  });

  test("뱃지 = 집합 min/max strict 동치(동률이면 복수 부여)", () => {
    const stats = computeRankingStats([low, high])!;
    expect(rankingBadgeFlags(low, stats)).toEqual({ lowestMonthly: true, lowestRate: true, highestResidual: false, lowestTotal: true });
    expect(rankingBadgeFlags(high, stats)).toEqual({ lowestMonthly: false, lowestRate: false, highestResidual: true, lowestTotal: false });
    // 동률 복수 부여
    const twin = entryFixture({ lenderCode: "bnk-capital", monthlyDisplay: 880_000, ratePct: 5, residualAmount: 25_000_000, totalCost: 77_800_000 });
    const tieStats = computeRankingStats([low, twin])!;
    expect(rankingBadgeFlags(low, tieStats).lowestMonthly).toBe(true);
    expect(rankingBadgeFlags(twin, tieStats).lowestMonthly).toBe(true);
  });

  test("+차액 = 월 납입 순 정렬 + 1위 제외 행만(그 외 정렬·1위 = 0)", () => {
    const stats = computeRankingStats([low, high])!;
    expect(monthlyDelta(high, stats, "monthlyPayment", 1)).toBe(20_000);
    expect(monthlyDelta(low, stats, "monthlyPayment", 0)).toBe(0); // 1위
    expect(monthlyDelta(high, stats, "interestRate", 1)).toBe(0); // 다른 정렬
  });
});

describe("isLenderNotAvailableMessage (제프 NOT_AVAILABLE_PATTERNS 미러)", () => {
  test("미취급 문구 매칭 — 대표 패턴", () => {
    expect(isLenderNotAvailableMessage("해당 차량을 찾지 못했습니다")).toBe(true);
    expect(isLenderNotAvailableMessage("잔가율 데이터가 입력되지 않았습니다")).toBe(true);
    expect(isLenderNotAvailableMessage("Vehicle model not found")).toBe(true);
    expect(isLenderNotAvailableMessage("미취급 차량")).toBe(true);
  });

  test("일반 실패(네트워크·서버)는 미매칭", () => {
    expect(isLenderNotAvailableMessage("계산 서버에 연결하지 못했습니다")).toBe(false);
    expect(isLenderNotAvailableMessage("Internal Server Error")).toBe(false);
  });
});
