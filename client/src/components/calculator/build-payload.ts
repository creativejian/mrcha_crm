// 계산기 payload 순수 계층(배치 7 A#15 후속) — CalculatorModal 컴포넌트 클로저 3종
// (buildPayload·취득세 자동 공식·resolveDealerSelection)을 명시 인자 순수 함수로 추출.
// DOM/React 비의존 — calc-guards·query-fingerprint 선례 미러, 워크벤치 몫은 #264가
// buildSolutionQuoteInput(@/lib/solution-quote)으로 순수화한 것과 대칭.
// 행위 무변경: 본문은 클로저 원문 그대로 옮겼고(제프 1:1 이식 표면 — 로직 개선 금지),
// 컴포넌트는 파생값을 인자로 넘겨 호출만 한다. build-payload.test.ts가 산술·생략 계약을 잠근다.
import type { MasterBrand, MasterTrim } from '@/components/vehicle-pickers/catalog-types'
import { feeRateFraction } from './calc-guards'
import type { ScenarioState, TaxReductionMode, ToggleIncluded } from './types'
import type { AcquisitionTaxMode, AnnualMileage, LeaseTerm, QuotePayload } from './quote-types'

// lenderCode/dealerName은 여기서 만들지 않는다 — useMultiQuote.calculateAll이 dealerSelection으로
// lenderCode 일치 금융사에만 동봉한다(타사 유입 = 견적 무음 오염, useMultiQuote 주석 참조).
export type ScenarioPayload = Omit<QuotePayload, 'lenderCode' | 'dealerName'>

// 3 시나리오가 공유하는 차량/할인/취득원가 파생값(CalculatorModal 상단 파생 블록 산출물).
// 콤마 파싱·할인 환산(discountLineWon)·included/excluded 금액 합산은 컴포넌트 몫 그대로 —
// 이 계층은 "이미 파생된 숫자"만 받아 payload 모양으로 조립한다.
export type SharedQuoteInputs = {
  totalQuotedPrice: number
  finalVehiclePrice: number
  discountKrw: number
  taxAmountNum: number
  bondIncluded: ToggleIncluded
  bondAmountNum: number
  deliveryIncluded: ToggleIncluded
  deliveryAmountNum: number
  extraIncluded: ToggleIncluded
  extraAmountNum: number
}

// 시나리오별 페이로드 빌드(원문 = CalculatorModal buildPayload 클로저).
export function buildScenarioPayload(
  s: ScenarioState,
  trim: Pick<MasterTrim, 'mcCode' | 'name' | 'trimName' | 'canonicalName'> | null,
  brand: Pick<MasterBrand, 'name'> | null,
  shared: SharedQuoteInputs,
): ScenarioPayload | null {
  if (!trim || !brand) return null
  const resolvedBrand = brand.name
  const resolvedModelName = trim.canonicalName ?? trim.trimName ?? trim.name
  const resolvedMasterMcCode = trim.mcCode

  // 선수금/보증금 절대값 계산 — % 환산 기준은 finalVehiclePrice(할인 후)
  const computeAbs = (mode: ScenarioState['downPaymentType'], v: string): number => {
    if (mode === 'none') return 0
    const n = Number(v.replace(/,/g, '')) || 0
    if (mode === 'amount') return n
    return Math.round(shared.finalVehiclePrice * n / 100)
  }
  const upfrontPayment = computeAbs(s.downPaymentType, s.downPayment)
  const depositAmount = computeAbs(s.depositType, s.deposit)

  // 잔존가치: max → high, amount/percent → standard + override
  const residualMode: 'high' | 'standard' = s.residualValueType === 'max' ? 'high' : 'standard'
  const residualNum = Number(s.residualValue.replace(/,/g, '')) || 0
  // CRM 이탈 1건: percent 0 입력이면 필드 자체를 생략 — 파트너 스키마가 0을 거부한다
  // (selectedResidualRateOverride만 positive(), T1 실측). 제프 원형은 0을 그대로 보내 400.
  const selectedResidualRateOverride =
    s.residualValueType === 'percent' && residualNum > 0 ? residualNum / 100 : undefined
  const residualAmountOverride =
    s.residualValueType === 'amount' ? residualNum : undefined

  // 취득세 모드 매핑
  const acquisitionTaxMode: AcquisitionTaxMode = 'amount'

  const isRent = s.activeTab === 'rent'
  return {
    productType: isRent ? 'long_term_rental' : 'operating_lease',
    // 렌트 출고방식 (대리점/금융사 특판) → 엔진 releaseMethod. 리스는 미전송.
    releaseMethod: isRent ? s.deliveryType : undefined,
    // 렌트 정비 등급 (Basic/VIP) → 엔진 maintenanceGrade. 리스는 미전송.
    maintenanceGrade: isRent ? s.maintenanceGrade : undefined,
    brand: resolvedBrand,
    modelName: resolvedModelName,
    masterMcCode: resolvedMasterMcCode,
    affiliateType: '비제휴사',
    directModelEntry: false,
    ownershipType: 'company',
    leaseTermMonths: parseInt(s.period, 10) as LeaseTerm,
    // 'unlimited'는 NaN(현 계약 그대로) — 상류 distanceGuardReason(calc-guards)이 조회 자체를 차단한다.
    annualMileageKm: parseInt(s.annualDistance, 10) as AnnualMileage,
    upfrontPayment,
    depositAmount,
    quotedVehiclePrice: shared.totalQuotedPrice,
    discountAmount: shared.discountKrw,
    acquisitionTaxMode,
    acquisitionTaxAmountOverride: shared.taxAmountNum,
    includePublicBondCost: shared.bondIncluded === 'included',
    publicBondCost: shared.bondIncluded === 'included' ? shared.bondAmountNum : undefined,
    includeDeliveryFeeAmount: shared.deliveryIncluded === 'included',
    deliveryFeeAmount: shared.deliveryIncluded === 'included' ? shared.deliveryAmountNum : undefined,
    includeMiscFeeAmount: shared.extraIncluded === 'included',
    miscFeeAmount: shared.extraIncluded === 'included' ? shared.extraAmountNum : undefined,
    residualMode,
    selectedResidualRateOverride,
    residualAmountOverride,
    // 배치 7 A#8(제프 대비 의도적 이탈): parseFloat → parsePercentInput SSOT(feeRateFraction).
    // 제프 원형은 '.' 입력이 NaN → JSON.stringify가 null 직렬화 → 릴레이 zod 400 전사가
    // 무사유로 은닉됐다(워크벤치 buildSolutionQuoteInput은 이미 같은 SSOT — 비대칭 해소).
    // 100 초과는 조회 시작 전 percentGuardReason(ConditionCards)이 차단한다.
    cmFeeRate: feeRateFraction(s.cmFeePercent),
    agFeeRate: feeRateFraction(s.agFeePercent),
    evSubsidyAmount:
      s.subsidy === 'applicable'
        ? Number(s.subsidyAmount.replace(/,/g, '')) || 0
        : undefined,
    insuranceYearlyAmount: 0,
    lossDamageAmount: 0,
  }
}

// 취득세 자동 계산(원문 = CalculatorModal 자동 재계산 effect 본문) — null = "덮지 않는다"
// (manual 직접 입력 모드는 자동 재계산이 값을 덮지 않고, 차량가 0 이하는 직전 입력값 유지).
// - none: finalVehiclePrice/1.1 × 7% (10원 절사)
// - hybrid: 위 값 − 400,000원
// - electric: 위 값 − 1,400,000원 (감면 초과 시 0 하한 클램프)
export function autoAcquisitionTax(
  finalVehiclePrice: number,
  taxReduction: TaxReductionMode,
): number | null {
  if (taxReduction === 'manual') return null
  if (finalVehiclePrice <= 0) return null
  const base = Math.floor((finalVehiclePrice / 1.1) * 0.07 / 10) * 10
  const reduction =
    taxReduction === 'hybrid' ? 400_000 :
    taxReduction === 'electric' ? 1_400_000 : 0
  return Math.max(0, base - reduction)
}

/**
 * 선택된 딜러를 `{lenderCode, dealerName}`로 푼다(제프 QuoteRevolutionV2.tsx:276-293 미러).
 *
 * 드롭다운 option value는 `lenderCode::dealerName` 합성값이다 — 사별 union이라
 * 딜러명만으로는 어느 lender 것인지 알 수 없고, 딜러명이 겹치는 경우도 있다
 * (예: "모터원"은 우리·메리츠 양쪽에 존재).
 */
export function resolveDealerSelection(
  s: Pick<ScenarioState, 'dealerType' | 'dealer'>,
): { lenderCode: string; dealerName: string } | null {
  if (s.dealerType !== 'input' || !s.dealer) return null
  const sep = s.dealer.indexOf('::')
  if (sep < 0) return null
  return { lenderCode: s.dealer.slice(0, sep), dealerName: s.dealer.slice(sep + 2) }
}
