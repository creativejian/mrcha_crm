// client/src/lib/solution-ranking.ts
// 금융사 랭킹 모달(스펙 개정 2 R4)의 순수 계산 계층 — 제프 솔루션 랭킹 UI의 계산·표시 규칙 미러.
// 원본 = dolim-solution `client/src/components/results/sortQuotes.ts`·`redesign/ConditionCards.tsx`·
// `hooks/useMultiQuote.ts`(NOT_AVAILABLE_PATTERNS). 부작용 0 — 파트너 응답 → 행 데이터 변환까지 순수.

import { type SolutionLenderCode, type SolutionProductType, type SolutionQuoteParsed } from "./solution-quote";

export type RankingSortType = "monthlyPayment" | "interestRate" | "residualValue" | "totalCost";

export const RANKING_SORT_OPTIONS: { value: RankingSortType; label: string }[] = [
  { value: "monthlyPayment", label: "월 납입 순" },
  { value: "interestRate", label: "금리 순" },
  { value: "residualValue", label: "잔존가치 순" },
  { value: "totalCost", label: "총 비용 순" },
];

// 월납입 표시값(제프 ConditionCards 미러): 렌트는 VAT 기포함 최종값이라 그대로, 운용리스만 100원 올림.
// 행 클릭 시 카드에도 이 표시값을 채운다(모달↔카드 일치 — 원값은 solution_raw 스냅샷이 보존, 개정 2 R4).
export function solutionMonthlyDisplay(productType: SolutionProductType, monthlyPayment: number): number {
  return productType === "long_term_rental" ? monthlyPayment : Math.ceil(monthlyPayment / 100) * 100;
}

// 표시 금리(제프 QuoteResultCard/sortQuotes 규칙 미러): 우리카드는 잔가보장수수료 lump-sum 때문에
// 유효금리가 메인, 그 외는 표면금리. 랭킹 모달(buildRankingEntry)·계산기(ConditionCards) 공유 —
// 배치 7 A#11(표시 규칙 복제 통합).
export function solutionDisplayRatePct(
  lenderCode: SolutionLenderCode,
  rates: { annualRatePct: number; effectiveAnnualRatePct: number },
): number {
  return lenderCode === "woori-card" ? rates.effectiveAnnualRatePct : rates.annualRatePct;
}

// 총비용 = 표시 월납입 × 기간 + 잔가 금액(제프 미러 — 표시 라운딩 적용값 기준). 공유처 위와 동일(A#11).
export function solutionTotalCost(monthlyDisplay: number, termMonths: number, residualAmount: number): number {
  return monthlyDisplay * termMonths + residualAmount;
}

export type SolutionRankingEntry = {
  lenderCode: SolutionLenderCode;
  label: string;
  monthlyDisplay: number; // 표시 라운딩 적용값(정렬·총 비용·카드 채움의 기준)
  ratePct: number; // 우리카드 = 유효금리, 그 외 = 표면금리(제프 sortQuotes 미러)
  residualAmount: number;
  residualPct: number;
  totalCost: number; // 표시 월납입 × 기간 + 잔가 금액
  warnings: string[];
  raw: unknown; // 행 선택 시 스냅샷(solution_raw)으로 영속할 파트너 원 응답
};

export function buildRankingEntry(
  lenderCode: SolutionLenderCode,
  label: string,
  parsed: SolutionQuoteParsed,
  raw: unknown,
  productType: SolutionProductType,
  termMonths: number,
): SolutionRankingEntry {
  const monthlyDisplay = solutionMonthlyDisplay(productType, parsed.monthlyPayment);
  return {
    lenderCode,
    label,
    monthlyDisplay,
    ratePct: solutionDisplayRatePct(lenderCode, parsed),
    residualAmount: parsed.residualAmount,
    residualPct: parsed.residualRatePct,
    totalCost: solutionTotalCost(monthlyDisplay, termMonths, parsed.residualAmount),
    warnings: parsed.warnings,
    raw,
  };
}

// 정렬 4종(제프 sortQuotes 미러). copy sort — Array.prototype.sort는 stable(동률 = 입력 순서
// = SOLUTION_LENDERS 순서 유지).
export function sortRankingEntries(entries: SolutionRankingEntry[], sortType: RankingSortType): SolutionRankingEntry[] {
  const arr = [...entries];
  switch (sortType) {
    case "monthlyPayment":
      return arr.sort((a, b) => a.monthlyDisplay - b.monthlyDisplay);
    case "interestRate":
      return arr.sort((a, b) => a.ratePct - b.ratePct);
    case "residualValue":
      return arr.sort((a, b) => b.residualAmount - a.residualAmount);
    case "totalCost":
      return arr.sort((a, b) => a.totalCost - b.totalCost);
  }
}

export type RankingStats = {
  lowestMonthly: number;
  lowestRate: number;
  highestResidual: number;
  lowestTotal: number;
};

export function computeRankingStats(entries: SolutionRankingEntry[]): RankingStats | null {
  if (entries.length === 0) return null;
  return {
    lowestMonthly: Math.min(...entries.map((e) => e.monthlyDisplay)),
    lowestRate: Math.min(...entries.map((e) => e.ratePct)),
    highestResidual: Math.max(...entries.map((e) => e.residualAmount)),
    lowestTotal: Math.min(...entries.map((e) => e.totalCost)),
  };
}

// 카테고리 뱃지 = 집합 전체 min/max 대비 strict 동치(동률이면 복수 행에 부여 — 제프 미러).
export function rankingBadgeFlags(entry: SolutionRankingEntry, stats: RankingStats): {
  lowestMonthly: boolean;
  lowestRate: boolean;
  highestResidual: boolean;
  lowestTotal: boolean;
} {
  return {
    lowestMonthly: entry.monthlyDisplay === stats.lowestMonthly,
    lowestRate: entry.ratePct === stats.lowestRate,
    highestResidual: entry.residualAmount === stats.highestResidual,
    lowestTotal: entry.totalCost === stats.lowestTotal,
  };
}

// 1위 대비 +차액 — 월 납입 순 정렬일 때만, 1위(idx 0) 제외 행에 표시(제프 미러).
export function monthlyDelta(entry: SolutionRankingEntry, stats: RankingStats, sortType: RankingSortType, idx: number): number {
  return sortType === "monthlyPayment" && idx > 0 ? entry.monthlyDisplay - stats.lowestMonthly : 0;
}

// 미취급 판별(제프 useMultiQuote NOT_AVAILABLE_PATTERNS 미러) — 릴레이가 파트너 400 문구를 {error}로
// 패스스루하므로 HttpError.message에 매칭. 매칭 = 미취급(조용히 제외), 미매칭 = 일반 실패(관측 로그 대상).
const NOT_AVAILABLE_PATTERNS = [
  /not found/i,
  /찾지 못/,
  /없습니다/,
  /미취급/,
  /no matching/i,
  /vehicle.*not/i,
  /잔가사 데이터가 없어/,
  /잔존가치를 입력/,
  /잔가율 데이터가 입력되지/,
];

export function isLenderNotAvailableMessage(msg: string): boolean {
  return NOT_AVAILABLE_PATTERNS.some((p) => p.test(msg));
}
