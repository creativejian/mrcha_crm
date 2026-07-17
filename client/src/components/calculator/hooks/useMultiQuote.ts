// 제프(dolim-solution) hooks/useMultiQuote.ts 이식 — 반환 계약({entries, calculateAll, reset,
// isAnyLoading, hasAnyResult})·상태 구조(LenderQuoteState) 원형 유지, 배선만 CRM으로 교체.
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md — 배선 교체 표)
//
// CRM 배선(어휘 SSOT — 로컬 재정의 금지):
//   금융사 목록 = SOLUTION_LENDERS 고정(제프 fetchLenders 내부 API 제거 — spec D3).
//   계산 호출  = sendJson("/api/solution/calculate", …)(기존 릴레이 — 응답 {ok, quote} 패스스루).
//   미취급 판별 = isLenderNotAvailableMessage(@/lib/solution-ranking — 제프 NOT_AVAILABLE_PATTERNS 미러).
//     릴레이가 파트너 400 문구를 {error}로 패스스루 → HttpError.message에 매칭.
import { useCallback, useRef, useState } from 'react'
import { sendJson } from '@/lib/http'
import { SOLUTION_LENDERS } from '@/lib/solution-quote'
import { isLenderNotAvailableMessage } from '@/lib/solution-ranking'
import type { QuotePayload, QuoteResult } from '../quote-types'

export type LenderQuoteState = {
  lenderName: string
  result: QuoteResult | null
  loading: boolean
  error: string | null
  notAvailable: boolean // true when lender doesn't carry this vehicle — hide entirely
}

// 제프 LenderInfo(fetchLenders 응답) 대체 — SOLUTION_LENDERS 파생 고정 목록.
const LENDERS = SOLUTION_LENDERS.map((l) => ({ lenderCode: l.code, lenderName: l.label }))

const initialStates = (): Record<string, LenderQuoteState> =>
  Object.fromEntries(
    LENDERS.map((l) => [
      l.lenderCode,
      { lenderName: l.lenderName, result: null, loading: false, error: null, notAvailable: false },
    ]),
  )

export function useMultiQuote() {
  const [states, setStates] = useState<Record<string, LenderQuoteState>>(initialStates)
  // 배치 7 A#6(제프 대비 의도적 이탈): 조회 세대 토큰. 제프 원형은 in-flight 취소 개념이 없어
  // 조회 중 reset()을 눌러도 늦게 도착한 응답이 리셋을 덮고 결과를 부활시켰다(랭킹 모달
  // SolutionLenderRankingModal의 cancelled 가드와 같은 부류). reset()/calculateAll() 시작마다
  // 세대를 올리고, 응답(성공·실패·미취급 전부)은 기록 직전 세대가 같을 때만 반영한다.
  const generationRef = useRef(0)

  const calculateAll = useCallback(async (basePayload: Omit<QuotePayload, 'lenderCode'>) => {
    const generation = ++generationRef.current // 직전 조회의 잔여 in-flight 응답도 무효화
    // Set all to loading
    setStates(
      Object.fromEntries(
        LENDERS.map((l) => [
          l.lenderCode,
          { lenderName: l.lenderName, result: null, loading: true, error: null, notAvailable: false },
        ]),
      ),
    )

    // Fire all in parallel
    await Promise.allSettled(
      LENDERS.map(async (l) => {
        try {
          // 릴레이 성공 응답 = 파트너 {ok, quote} 패스스루(src/routes/solution.ts). 형태 이탈은
          // 성공으로 둔갑시키지 않는다(미취급 패턴에 안 걸리는 문구라 일반 실패 error로 분기).
          const data = await sendJson<{ ok?: unknown; quote?: QuoteResult }>(
            '/api/solution/calculate',
            'POST',
            { ...basePayload, lenderCode: l.lenderCode },
          )
          if (data?.ok !== true || data.quote == null) throw new Error('계산 응답을 해석하지 못했습니다')
          const result = data.quote
          if (generation !== generationRef.current) return // stale — reset()/재조회가 앞섬(A#6)
          setStates((prev) => ({
            ...prev,
            [l.lenderCode]: { lenderName: l.lenderName, result, loading: false, error: null, notAvailable: false },
          }))
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          // Vehicle not carried by this lender → hide silently instead of error
          const isNotAvailable = isLenderNotAvailableMessage(msg)
          if (generation !== generationRef.current) return // stale — reset()/재조회가 앞섬(A#6)
          // 배치 7 A#1(제프 대비 의도적 이탈): 에러성 실패(미취급 아님)는 관측 로그 — 전사 실패가
          // "조회 결과가 없습니다"로 위장될 때 장애/미취급을 콘솔에서 구분(SolutionLenderRankingModal 미러).
          if (!isNotAvailable) console.warn(`[calculator] 견적 조회 실패 lender=${l.lenderCode}: ${msg}`)
          setStates((prev) => ({
            ...prev,
            [l.lenderCode]: {
              lenderName: l.lenderName,
              result: null,
              loading: false,
              error: isNotAvailable ? null : msg,
              notAvailable: isNotAvailable,
            },
          }))
        }
      }),
    )
  }, [])

  const reset = useCallback(() => {
    generationRef.current++ // in-flight 응답 무효화(A#6 — 위 세대 토큰 주석 참조)
    setStates((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([code, s]) => [
          code,
          { ...s, result: null, error: null, loading: false, notAvailable: false },
        ]),
      ),
    )
  }, [])

  const entries = LENDERS.map((l) => ({
    lenderCode: l.lenderCode,
    ...(states[l.lenderCode] ??
      { lenderName: l.lenderName, result: null, loading: false, error: null, notAvailable: false }),
  }))

  const isAnyLoading = entries.some((e) => e.loading)
  const hasAnyResult = entries.some((e) => e.result != null)

  return { entries, calculateAll, reset, isAnyLoading, hasAnyResult }
}
