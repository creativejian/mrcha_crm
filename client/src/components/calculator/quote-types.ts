// 제프(dolim-solution) types/quote.ts 이식(사용분: QuotePayload·QuoteResult 트리·enum 별칭).
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md)
//
// 제프 원본은 @shared/contracts/quote.constants 리터럴에서 enum 타입을 파생한다.
// CRM 배선: 4종 전부 CRM SSOT(@/lib/solution-quote — 제프 상수와 값 일치 실측:
// LEASE_TERMS=[12,24,36,48,60]·ANNUAL_MILEAGES=[10000..40000]·AFFILIATE_TYPES·
// ACQUISITION_TAX_MODES)에서 파생해 어휘 이중화를 막는다(배치 7 A#10 — 구 서술 "CRM SSOT가
// 없는 AffiliateType·AcquisitionTaxMode만 인라인 미러"는 거짓: SOLUTION_AFFILIATE_TYPES·
// SOLUTION_ACQUISITION_TAX_MODES가 릴레이 zod 파생용으로 이미 존재했다).
import type {
  SOLUTION_ACQUISITION_TAX_MODES,
  SOLUTION_AFFILIATE_TYPES,
  SOLUTION_LEASE_TERMS,
  SOLUTION_MILEAGES,
} from '@/lib/solution-quote'

export type LeaseTerm = (typeof SOLUTION_LEASE_TERMS)[number]
export type AnnualMileage = (typeof SOLUTION_MILEAGES)[number]
// v1은 '비제휴사'만 전송(spec D2).
type AffiliateType = (typeof SOLUTION_AFFILIATE_TYPES)[number]
export type AcquisitionTaxMode = (typeof SOLUTION_ACQUISITION_TAX_MODES)[number]

export interface QuotePayload {
  lenderCode: string
  productType: 'operating_lease' | 'long_term_rental'
  brand: string
  modelName: string
  // Phase 4/5 — when supplied, the API resolves the canonical lender tuple
  // from the master catalog before invoking the lender engines.
  masterMcCode?: string
  affiliateType: AffiliateType
  directModelEntry: false
  ownershipType: 'company' | 'customer'
  leaseTermMonths: LeaseTerm
  annualMileageKm: AnnualMileage
  upfrontPayment: number
  depositAmount: number
  quotedVehiclePrice?: number
  discountAmount?: number
  includePublicBondCost?: boolean
  publicBondCost?: number
  includeMiscFeeAmount?: boolean
  miscFeeAmount?: number
  includeDeliveryFeeAmount?: boolean
  deliveryFeeAmount?: number
  annualIrrRateOverride?: number
  annualEffectiveRateOverride?: number
  paymentRateOverride?: number
  residualMode?: 'high' | 'standard'
  selectedResidualRateOverride?: number
  residualAmountOverride?: number
  acquisitionTaxMode?: AcquisitionTaxMode
  acquisitionTaxRateOverride?: number
  acquisitionTaxRatioInput?: number
  acquisitionTaxReduction?: number
  acquisitionTaxAmountOverride?: number
  evSubsidyAmount?: number
  stampDuty?: number
  agFeeRate?: number
  cmFeeRate?: number
  insuranceYearlyAmount?: number
  lossDamageAmount?: number
  manualVehicleClass?: string
  manualEngineDisplacementCc?: number
  // ⚠️ CRM v1 미전송(spec D2 — 판매사 입력 숨김). 필드는 제프 계약 모양 보존용으로만 잔존.
  bnkDealerName?: string
  kcbScorePct?: number
  // 렌트(long_term_rental) 전용
  releaseMethod?: 'dealer' | 'special'
  maintenanceGrade?: 'basic' | 'vip'
}

interface QuoteResidual {
  matrixGroup: string | null
  rateDecimal: number
  amount: number
  maxRateDecimal?: number
}

interface QuoteMajorInputs {
  leaseTermMonths: LeaseTerm
  ownershipType: 'company' | 'customer'
  vehiclePrice: number
  discountedVehiclePrice: number
  upfrontPayment: number
  depositAmount: number
  financedPrincipal: number
}

interface QuoteRates {
  annualRateDecimal: number
  effectiveAnnualRateDecimal: number
  monthlyRateDecimal: number
}

export interface QuoteResult {
  productType: 'operating_lease' | 'long_term_rental'
  monthlyPayment: number
  rates: QuoteRates
  residual: QuoteResidual
  majorInputs: QuoteMajorInputs
  warnings: string[]
}
