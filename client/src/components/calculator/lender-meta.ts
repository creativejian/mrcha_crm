// 제프(dolim-solution) components/results/sortQuotes.ts 대체 모듈 — 계산기(T3b QuoteResultRow·
// ConditionCards)가 소비하는 표면을 같은 이름으로 제공한다.
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md — 배선 교체 표)
//
// CRM 배선(어휘 SSOT — 로컬 재정의 금지):
//   금융사 코드/표시명 = @/lib/solution-quote SOLUTION_LENDERS 파생(제프 SUPPORTED_LENDER_CODES ·
//   LENDER_DISPLAY_NAMES와 코드·순서 일치 실측).
//   정렬 어휘 = @/lib/solution-ranking RANKING_SORT_OPTIONS 재수출(제프 SORT_OPTIONS과 값·라벨 동일).
//   로고 = @/assets/lenders (SolutionLenderRankingModal.tsx와 같은 소스 — 제프 assets/lenders 복사본).
// sortQuotes·computeStats는 QuoteEntryForRow(제프 결과 행 모양) 전용이라 제프 1:1 이식 —
//   solution-ranking.ts의 동종 함수는 SolutionRankingEntry(랭킹 모달 모양) 전용으로 별개.

import mgLogo from '@/assets/lenders/mg.jpg'
import bnkLogo from '@/assets/lenders/bnk.jpg'
import meritzLogo from '@/assets/lenders/meritz.jpg'
import wooriLogo from '@/assets/lenders/woori.jpg'
import shinhanLogo from '@/assets/lenders/shinhan.jpg'
import kdbcLogo from '@/assets/lenders/kdbc.png'
import imLogo from '@/assets/lenders/im.png'
import nhcapLogo from '@/assets/lenders/nhcap.svg'

import { SOLUTION_LENDERS, type SolutionLenderCode } from '@/lib/solution-quote'
import { RANKING_SORT_OPTIONS, type RankingSortType } from '@/lib/solution-ranking'

// 제프 SupportedLenderCode = CRM SolutionLenderCode (동일 8사 코드 집합).
export type SupportedLenderCode = SolutionLenderCode

export type SortType = RankingSortType

export const SORT_OPTIONS: Array<{ value: SortType; label: string }> = RANKING_SORT_OPTIONS

export const getSortLabel = (sortType: SortType): string =>
  SORT_OPTIONS.find((o) => o.value === sortType)?.label ?? '월 납입 순'

const LENDER_LOGOS: Record<SupportedLenderCode, string> = {
  'mg-capital': mgLogo,
  'bnk-capital': bnkLogo,
  'meritz-capital': meritzLogo,
  'woori-card': wooriLogo,
  'shinhan-card': shinhanLogo,
  'kdbc-capital': kdbcLogo,
  'im-capital': imLogo,
  'nh-capital': nhcapLogo,
}

// QuoteResultRow 소비 표면 = { name, logo } (실측 — meta.logo·meta.name만 읽는다).
export const LENDER_META: Record<SupportedLenderCode, { name: string; logo: string }> =
  Object.fromEntries(
    SOLUTION_LENDERS.map((l) => [l.code, { name: l.label, logo: LENDER_LOGOS[l.code] }]),
  ) as Record<SupportedLenderCode, { name: string; logo: string }>

export interface QuoteEntryForRow {
  lenderCode: SupportedLenderCode
  monthlyPayment: number
  interestRate: number
  residualAmount: number
  residualPercent: number
  totalCost: number
  warnings: string[]
}

export function sortQuotes(
  entries: QuoteEntryForRow[],
  sortType: SortType,
): QuoteEntryForRow[] {
  const arr = [...entries]
  switch (sortType) {
    case 'monthlyPayment':
      return arr.sort((a, b) => a.monthlyPayment - b.monthlyPayment)
    case 'interestRate':
      return arr.sort((a, b) => a.interestRate - b.interestRate)
    case 'residualValue':
      return arr.sort((a, b) => b.residualAmount - a.residualAmount)
    case 'totalCost':
      return arr.sort((a, b) => a.totalCost - b.totalCost)
  }
}

export interface QuoteStats {
  lowestMonthlyPayment: number
  lowestInterestRate: number
  highestResidualValue: number
  lowestTotalCost: number
}

export function computeStats(entries: QuoteEntryForRow[]): QuoteStats | null {
  if (entries.length === 0) return null
  return {
    lowestMonthlyPayment: Math.min(...entries.map((e) => e.monthlyPayment)),
    lowestInterestRate: Math.min(...entries.map((e) => e.interestRate)),
    highestResidualValue: Math.max(...entries.map((e) => e.residualAmount)),
    lowestTotalCost: Math.min(...entries.map((e) => e.totalCost)),
  }
}
