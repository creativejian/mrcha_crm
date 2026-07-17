// 계산기 fail-loud 순수 헬퍼 (배치 7 A#1·A#8 — 제프 대비 의도적 이탈, DOM/React 비의존).
//
// - failureNoteFromEntries(A#1): 에러성 전사 실패(릴레이 503/502/504 등 — 미취급 아님)가 무사유
//   "조회 결과가 없습니다"(미취급 전멸 어휘)로 위장되지 않게 첫 사유를 반환한다.
//   SolutionLenderRankingModal failureNote(#241 fail-loud) 미러 — 그쪽 entry는 성공분만 수집하는
//   모양(SolutionRankingEntry)이라 물리 공유는 무리, 판정 술어만 이 헬퍼로 잠근다.
// - percentGuardReason(A#8): 조회 시작 전 % 상한 검증 — 워크벤치 buildSolutionQuoteInput
//   (client/src/lib/solution-quote.ts) reason 문구·검증 순서 미러(비대칭 해소).
// - feeRateFraction/feePreviewWon(A#8): CM/AG % 파생 — 제프 원형 parseFloat는 '.'→NaN이
//   미리보기 "NaN원"·payload NaN(→JSON null→릴레이 zod 400 전사)으로 샜다.
//   parsePercentInput SSOT(quote-pricing — 워크벤치와 동일 파싱 의미론) 재사용으로 차단.
import { parsePercentInput, percentToWon } from '@/lib/quote-pricing'
import type { ScenarioState } from './types'

export type LenderFailureCheckEntry = {
  result: unknown // null = 결과 없음(성공 결과 객체면 non-null)
  loading: boolean
  notAvailable: boolean
  error: string | null
}

// 표시 가능한 행(ConditionCards 결과 필터와 동일 술어: !notAvailable && result !== null && !loading)이
// 하나도 없을 때만 첫 error 사유를 반환 — 일부 성공 시는 null(부분 실패 조용 = 현행 유지).
export function failureNoteFromEntries(entries: LenderFailureCheckEntry[]): string | null {
  const anyDisplayable = entries.some((e) => !e.notAvailable && e.result !== null && !e.loading)
  if (anyDisplayable) return null
  return entries.find((e) => e.error != null)?.error ?? null
}

// 조회 차단 사유(없으면 null). % 모드 100 초과 = 콤마 오입력("10,5"→105%)류 fail-loud —
// 워크벤치는 같은 입력이 빌드 실패(reason)로 차단되는데 계산기는 무캡 전송이던 비대칭 해소.
export function percentGuardReason(
  s: Pick<
    ScenarioState,
    'downPaymentType' | 'downPayment' | 'depositType' | 'deposit' | 'cmFeePercent' | 'agFeePercent'
  >,
): string | null {
  const over = (raw: string) => parsePercentInput(raw) > 100
  if ((s.downPaymentType === 'percent' && over(s.downPayment)) || (s.depositType === 'percent' && over(s.deposit)))
    return '보증금·선수금 %는 100 이하로 입력해 주세요'
  if (over(s.cmFeePercent) || over(s.agFeePercent))
    return 'CM/AG 수수료 %는 100 이하로 입력해 주세요'
  return null
}

// CM/AG % → 분율(payload cmFeeRate/agFeeRate). 빈 칸·'.'·비유한 = 0(빈 % 칸은 0 의미 — 워크벤치 계약).
export function feeRateFraction(raw: string): number {
  return parsePercentInput(raw) / 100
}

// CM/AG % → 원 미리보기(기준가 대비 환산 — percentToWon 코어 산술 SSOT 공유).
export function feePreviewWon(basis: number, raw: string): number {
  return percentToWon(basis, parsePercentInput(raw))
}
