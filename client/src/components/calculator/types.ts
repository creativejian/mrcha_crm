// 제프(dolim-solution) components/redesign/types.ts 1:1 이식 — 계산기 모달 시나리오 상태 SSOT.
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md)
//
// 견적비교 1·2·3 카드 각 슬롯의 입력 상태.
// 디자인 시안(Figma Make export)의 ConditionCards.tsx 와 동일한 필드 구조.
// 페이로드 미전송 필드는 운전연령(driverAge)·대물한도(liabilityLimit) 둘뿐이다(UI 표시만).
// 렌트 탭(activeTab=rent → long_term_rental dispatch)·출고방식(deliveryType)·정비(maintenanceGrade)는
// 실제로 전송된다(배치 7 A#13 — 구 "렌트/출고방식 무시" 서술은 렌트 미지원 시절 제프 원문 잔재).
// 판매사(dealerType/dealer)도 실전송(판매사 실동작화 T1, 2026-07-17 — 구 spec D2 해제): 제프가
// 판매사를 일반화해 external dealers API를 열어, 선택 딜러가 해당 lender 요청에만 dealerName으로 실린다.
export interface ScenarioState {
  activeTab: 'lease' | 'rent'
  period: string                       // '12' | '24' | '36' | '48' | '60' (SOLUTION_LEASE_TERMS — 워크벤치 패리티)
  downPaymentType: 'none' | 'amount' | 'percent'
  downPayment: string
  depositType: 'none' | 'amount' | 'percent'
  deposit: string
  residualValueType: 'max' | 'amount' | 'percent'
  residualValue: string
  annualDistanceMode: 'default' | 'custom'
  annualDistance: string               // '10000' ~ '40000' | 'unlimited'(렌트만)
  carTax: 'excluded' | 'included'
  deliveryType: 'dealer' | 'special'   // 렌트 전용
  maintenanceGrade: 'basic' | 'vip'    // 렌트 전용 (정비 등급)
  driverAge: '21' | '26'               // 렌트 전용
  liabilityLimit: '100' | '200' | '300' | '500'  // 렌트 전용
  subsidy: 'none' | 'applicable'
  subsidyAmount: string
  cmFeePercent: string
  agFeePercent: string
  // 판매사(딜러) — 실동작(T1, 구 spec D2 해제). dealer는 `lenderCode::dealerName` 합성값(사별 union이라
  // 딜러명만으로는 lender 식별 불가·딜러명 사 간 중복 실존 — 예: "모터원"). 해석은 CalculatorModal
  // resolveDealerSelection(제프 QuoteRevolutionV2.tsx:276-293 미러).
  dealerType: 'nonAffiliated' | 'input'
  dealer: string                       // `lenderCode::dealerName` (dealerType='input' 시만 사용)
}

export const defaultScenario = (): ScenarioState => ({
  activeTab: 'lease',
  period: '60',
  downPaymentType: 'none',
  downPayment: '0',
  depositType: 'none',
  deposit: '0',
  residualValueType: 'max',
  residualValue: '0',
  annualDistanceMode: 'default',
  annualDistance: '20000',
  carTax: 'excluded',
  deliveryType: 'dealer',
  maintenanceGrade: 'basic',
  driverAge: '26',
  liabilityLimit: '100',
  subsidy: 'none',
  subsidyAmount: '0',
  cmFeePercent: '',
  agFeePercent: '',
  dealerType: 'nonAffiliated',
  dealer: '',
})

// TopSelectionCards 의 공유 입력값 (3 시나리오가 같이 쓰는 차량/할인/취득원가).
// manual = 직접 입력(워크벤치 취득세 4모드 패리티) — 자동 재계산이 값을 덮지 않고 입력이 활성화된다.
export type TaxReductionMode = 'none' | 'electric' | 'hybrid' | 'manual'
export type ToggleIncluded = 'included' | 'excluded'
export type DiscountUnit = 'amount' | 'percent'

// 할인 행(기본 할인 + 추가 행 — 워크벤치 DiscountLine 패리티, SSOT 통합 전 계산기 로컬 모양).
// amount는 controlled 문자열(숫자만) — 워크벤치의 uncontrolled DOM 스냅샷과 달리 계산기는 state가 원본.
export type CalcDiscountLine = { id: string; label: string; unit: DiscountUnit; amount: string }
