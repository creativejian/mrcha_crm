// 조회 fingerprint 조립(순수) — ConditionCards "다시 조회하기" 더티 판정의 SSOT.
//
// 원칙: payload(CalculatorModal buildPayload)에 실리는 ScenarioState 키 ⊆ SCENARIO_QUERY_KEYS.
// 키가 빠지면 그 조건만 바꿔도 fingerprint가 안 바뀌어 "조회 완료" 오표시 + 재조회 불가가 된다.
// 배치 7 A#3(제프 대비 의도적 이탈): 제프 원형 인라인 조립은 activeTab/deliveryType/
// maintenanceGrade 3필드 누락 — 리스 결과가 렌트 탭 아래 "조회 완료"로 오표시됐다.
// 탭별 조건 분기 없이 무조건 편입 — 과잉 더티는 안전한 방향(재조회 한 번 더일 뿐).
// buildPayload가 읽는 시나리오 필드가 늘면 여기에도 추가한다(query-fingerprint.test.ts가 잠금).
import type { ScenarioState } from './types'

export const SCENARIO_QUERY_KEYS = [
  // 배치 7 A#3 편입 3필드 — payload의 productType/releaseMethod/maintenanceGrade 원천
  'activeTab',
  'deliveryType',
  'maintenanceGrade',
  // 종전(제프 원형) 편입분
  'period',
  'downPaymentType',
  'downPayment',
  'depositType',
  'deposit',
  'residualValueType',
  'residualValue',
  'annualDistance',
  'carTax',
  'subsidy',
  'subsidyAmount',
  'cmFeePercent',
  'agFeePercent',
  // 판매사 실동작화(T1, 2026-07-17) — payload dealerName의 원천(resolveDealerSelection이 읽는 2필드).
  // 판매사만 바꿔도 "다시 조회하기"로 전환돼야 한다(제프 원형 fingerprint도 두 키 편입).
  'dealerType',
  'dealer',
] as const satisfies readonly (keyof ScenarioState)[]

export function scenarioQueryFingerprint(state: ScenarioState, topLevelFingerprint: string): string {
  return JSON.stringify({
    ...Object.fromEntries(SCENARIO_QUERY_KEYS.map((key) => [key, state[key]])),
    topLevel: topLevelFingerprint,
  })
}
