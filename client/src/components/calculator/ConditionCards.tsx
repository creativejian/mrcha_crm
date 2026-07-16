// 제프(dolim-solution) components/redesign/ConditionCards.tsx 이식.
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md — 배선 교체 표)
//
// 의도적 변경(spec D2) 단 하나: 판매사 행(dealerType '비제휴 계산'/'판매사 입력' 토글 + BNK 딜러
// select)과 bnkDealers prop 체인을 제거 — /api/catalog/bnk-dealers는 제프 내부 전용이라 v1 미이식.
// ScenarioState의 dealerType/dealer 필드 자체는 types.ts에 잔존(기본값 nonAffiliated 고정).
// 그 외 마크업·로직(조건 복사·재입력·fingerprint·수수료 미리보기·결과 행·선택 토글) 전부 1:1.
// 약정거리 controlled select는 CRM Safari 규칙에 따라 bindSelect(onChange+onInput 병행) 적용.
import { useState, useEffect, useRef, type ReactNode } from 'react'
import { ChevronDown, Check, Loader2 } from 'lucide-react'
import type { ScenarioState } from './types'
import { QuoteResultRow } from './QuoteResultRow'
import {
  type SortType,
  type SupportedLenderCode,
  SORT_OPTIONS,
  getSortLabel,
  sortQuotes,
  computeStats,
  type QuoteEntryForRow,
} from './lender-meta'
import { roundUpToNearestHundred } from './calc-format'
import type { QuoteResult } from './quote-types'
import { useMultiQuote } from './hooks/useMultiQuote'
import { bindSelect } from '@/lib/select-bind'

/**
 * 견적비교 1·2·3 카드 그룹.
 *
 * 디자인은 Figma Make export 의 ConditionCards 를 그대로 따르고,
 * 상태/액션은 부모(QuoteRevolutionV2)가 소유합니다.
 * 각 카드의 [견적 조회] 클릭 시 해당 시나리오의 useMultiQuote 인스턴스가
 * 4-lender 계산을 병렬 실행합니다.
 *
 * 렌트 탭은 시각적으로 노출하지만 현 백엔드는 운용리스만 지원하므로
 * 비활성 안내(disabled badge) 처리합니다.
 */
interface CardProps {
  cardNumber: 1 | 2 | 3
  state: ScenarioState
  setState: (s: ScenarioState) => void
  onCalculate: () => void
  onCopy?: () => void
  copyLabel?: string
  isLoading: boolean
  isVehicleReady: boolean
  basePriceForFeePreview: number   // CM/AG 수수료 미리보기용 (기본가격)
  topLevelFingerprint: string      // 차량/취득원가 변경 감지용 (페이지 레벨)
  results: Array<{
    lenderCode: SupportedLenderCode
    result: QuoteResult | null
    loading: boolean
    notAvailable: boolean
  }>
  leaseTermMonths: number
  selectedQuotes: SupportedLenderCode[]
  onToggleSelect: (lenderCode: SupportedLenderCode) => void
  showMaxWarning: boolean
}

const onlyDigits = (s: string) => s.replace(/[^0-9]/g, '')
const onlyDecimal = (s: string) => s.replace(/[^0-9.]/g, '')

function ConditionCard({
  cardNumber,
  state,
  setState,
  onCalculate,
  onCopy,
  copyLabel,
  isLoading,
  isVehicleReady,
  basePriceForFeePreview,
  topLevelFingerprint,
  results,
  leaseTermMonths,
  selectedQuotes,
  onToggleSelect,
  showMaxWarning,
}: CardProps) {
  const set = <K extends keyof ScenarioState>(key: K, value: ScenarioState[K]) =>
    setState({ ...state, [key]: value })

  const isLease = state.activeTab === 'lease'
  const isRent = state.activeTab === 'rent'

  const distanceOptions = isRent
    ? ['10000', '15000', '20000', '25000', '30000', '35000', '40000', 'unlimited']
    : ['10000', '15000', '20000', '25000', '30000', '35000', '40000']

  const handleTabChange = (tab: 'lease' | 'rent') => {
    if (tab === 'lease' && state.annualDistance === 'unlimited') {
      setState({ ...state, activeTab: tab, annualDistance: '20000', annualDistanceMode: 'default' })
    } else {
      set('activeTab', tab)
    }
  }

  const cmFeeAmount = state.cmFeePercent
    ? Math.round(basePriceForFeePreview * (parseFloat(state.cmFeePercent) / 100))
    : 0
  const agFeeAmount = state.agFeePercent
    ? Math.round(basePriceForFeePreview * (parseFloat(state.agFeePercent) / 100))
    : 0

  const warningDistances = ['15000', '25000', '35000', '40000', 'unlimited']
  const showDistanceWarning = warningDistances.includes(state.annualDistance)

  const calcDisabled = isLoading || !isVehicleReady

  // ── sort dropdown + dirty-state detection ──
  const [sortType, setSortType] = useState<SortType>('monthlyPayment')
  const [showSortDropdown, setShowSortDropdown] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [querySnapshot, setQuerySnapshot] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  const currentQueryFingerprint = JSON.stringify({
    period: state.period,
    downPaymentType: state.downPaymentType,
    downPayment: state.downPayment,
    depositType: state.depositType,
    deposit: state.deposit,
    residualValueType: state.residualValueType,
    residualValue: state.residualValue,
    annualDistance: state.annualDistance,
    carTax: state.carTax,
    subsidy: state.subsidy,
    subsidyAmount: state.subsidyAmount,
    cmFeePercent: state.cmFeePercent,
    agFeePercent: state.agFeePercent,
    topLevel: topLevelFingerprint,
  })
  const hasChanges = showResults && querySnapshot !== null && querySnapshot !== currentQueryFingerprint

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowSortDropdown(false)
      }
    }
    if (showSortDropdown) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSortDropdown])

  const handleQueryClick = () => {
    if (!showResults || hasChanges) {
      setQuerySnapshot(currentQueryFingerprint)
      setShowResults(true)
      onCalculate()
    } else {
      setShowSortDropdown((v) => !v)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      <div className="px-6 py-2 bg-slate-700 flex items-center justify-between">
        <h3 className="text-[14px]/[20px] text-white">
          견적비교 {['1️⃣', '2️⃣', '3️⃣'][cardNumber - 1]}
        </h3>
        <div className="flex items-center gap-2">
          {onCopy && copyLabel && (
            <button
              onClick={onCopy}
              className="px-3 py-1 text-[12px]/[16px] bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              {copyLabel}
            </button>
          )}
          <button
            onClick={() => setState({ ...state, ...resetFields })}
            className="px-3 py-1 text-[12px]/[16px] bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            재입력
          </button>
        </div>
      </div>

      <div className="p-6">
        {/* 리스 / 렌트 탭 */}
        <div className="flex gap-1 mb-4 bg-gray-200 rounded p-0.5 border border-gray-300">
          <button
            onClick={() => handleTabChange('lease')}
            className={`flex-1 px-4 py-1.5 text-[12px]/[16px] transition-all ${
              isLease ? 'bg-white text-gray-900 font-semibold rounded shadow-sm' : 'bg-transparent text-gray-600'
            }`}
          >
            리스
          </button>
          <button
            onClick={() => handleTabChange('rent')}
            className={`flex-1 px-4 py-1.5 text-[12px]/[16px] transition-all ${
              isRent ? 'bg-white text-gray-900 font-semibold rounded shadow-sm' : 'bg-transparent text-gray-600'
            }`}
            title="장기렌터카 (MG캐피탈)"
          >
            렌트
          </button>
        </div>

        <div className="space-y-0">
          {/* 출고방식 (렌트 전용) */}
          {isRent && (
            <Row label="출고방식">
              <Segmented value={state.deliveryType}
                options={[{ value: 'dealer', label: '대리점' }, { value: 'special', label: '금융사 특판' }]}
                onChange={(v) => set('deliveryType', v as ScenarioState['deliveryType'])} />
            </Row>
          )}

          {/* 정비 등급 (렌트 전용) */}
          {isRent && (
            <Row label="정비">
              <Segmented value={state.maintenanceGrade}
                options={[{ value: 'basic', label: 'Basic' }, { value: 'vip', label: 'VIP' }]}
                onChange={(v) => set('maintenanceGrade', v as ScenarioState['maintenanceGrade'])} />
            </Row>
          )}

          {/* 기간 */}
          <Row label="기간">
            <Segmented value={state.period}
              options={[
                { value: '24', label: '24개월' },
                { value: '36', label: '36개월' },
                { value: '48', label: '48개월' },
                { value: '60', label: '60개월' },
              ]}
              onChange={(v) => set('period', v)} />
          </Row>

          {/* 선수금 */}
          <Row label="선수금">
            <Segmented value={state.downPaymentType}
              options={[
                { value: 'none', label: '없음' },
                { value: 'amount', label: '금액' },
                { value: 'percent', label: '%' },
              ]}
              onChange={(v) => set('downPaymentType', v as ScenarioState['downPaymentType'])} />
            <ValueInput
              className="ml-auto w-28"
              value={state.downPayment}
              disabled={state.downPaymentType === 'none'}
              suffix={state.downPaymentType === 'amount' ? '원' : state.downPaymentType === 'percent' ? '%' : ''}
              onChange={(v) => set('downPayment', v)}
              integer
            />
          </Row>

          {/* 보증금 */}
          <Row label="보증금">
            <Segmented value={state.depositType}
              options={[
                { value: 'none', label: '없음' },
                { value: 'amount', label: '금액' },
                { value: 'percent', label: '%' },
              ]}
              onChange={(v) => set('depositType', v as ScenarioState['depositType'])} />
            <ValueInput
              className="ml-auto w-28"
              value={state.deposit}
              disabled={state.depositType === 'none'}
              suffix={state.depositType === 'amount' ? '원' : state.depositType === 'percent' ? '%' : ''}
              onChange={(v) => set('deposit', v)}
              integer
            />
          </Row>

          {/* 잔존가치 */}
          <Row label="잔존가치">
            <Segmented value={state.residualValueType}
              options={[
                { value: 'max', label: '최대' },
                { value: 'amount', label: '금액' },
                { value: 'percent', label: '%' },
              ]}
              onChange={(v) => set('residualValueType', v as ScenarioState['residualValueType'])} />
            <ValueInput
              className="ml-auto w-28"
              value={state.residualValue}
              disabled={state.residualValueType === 'max'}
              suffix={state.residualValueType === 'amount' ? '원' : state.residualValueType === 'percent' ? '%' : ''}
              onChange={(v) => set('residualValue', v)}
              integer
            />
          </Row>

          {/* 약정거리 */}
          <div className={`flex items-center gap-4 py-2 ${showDistanceWarning ? '' : 'border-b border-gray-200'}`}>
            <label className="text-[12px]/[16px] text-gray-500 w-16 flex-shrink-0">약정거리</label>
            <Segmented value={state.annualDistanceMode}
              options={[{ value: 'default', label: '기본' }, { value: 'custom', label: '변경' }]}
              onChange={(v) => {
                if (v === 'default') {
                  setState({ ...state, annualDistanceMode: 'default', annualDistance: '20000' })
                } else {
                  set('annualDistanceMode', 'custom')
                }
              }} />
            <div className="relative ml-auto flex-shrink-0">
              <select
                {...bindSelect(state.annualDistance, (next) =>
                  setState({
                    ...state,
                    annualDistance: next,
                    annualDistanceMode: next === '20000' ? 'default' : 'custom',
                  }),
                )}
                className={`w-36 py-1 pl-2 pr-6 border border-gray-200 rounded text-[12px]/[16px] appearance-none focus:outline-none font-mono tabular-nums font-normal ${
                  state.annualDistanceMode === 'default'
                    ? 'bg-gray-50 text-gray-500'
                    : 'bg-white text-gray-900 focus:border-slate-400'
                }`}
              >
                {distanceOptions.map((v) =>
                  v === 'unlimited'
                    ? <option key="unlimited" value="unlimited">무제한</option>
                    : <option key={v} value={v}>{Number(v).toLocaleString()}km / 년</option>
                )}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
            </div>
          </div>
          {showDistanceWarning && (
            <div className="pb-2 border-b border-gray-200">
              <p className="text-[12px]/[16px] text-red-500 text-right">
                해당 약정거리를 지원하지 않는 금융사는 조회 불가능
              </p>
            </div>
          )}

          {/* 자동차세 (리스 전용) */}
          {isLease && (
            <Row label="자동차세">
              <Segmented value={state.carTax}
                options={[{ value: 'excluded', label: '불포함' }, { value: 'included', label: '리스료에 포함' }]}
                onChange={(v) => set('carTax', v as ScenarioState['carTax'])} />
            </Row>
          )}

          {/* 운전연령 (렌트 전용) */}
          {isRent && (
            <Row label="운전연령">
              <Segmented value={state.driverAge}
                options={[{ value: '21', label: '만 21세 이상' }, { value: '26', label: '만 26세 이상' }]}
                onChange={(v) => set('driverAge', v as ScenarioState['driverAge'])} />
            </Row>
          )}

          {/* 대물한도 (렌트 전용) */}
          {isRent && (
            <Row label="대물한도">
              <Segmented value={state.liabilityLimit}
                options={[
                  { value: '100', label: '1억' },
                  { value: '200', label: '2억' },
                  { value: '300', label: '3억' },
                  { value: '500', label: '5억' },
                ]}
                onChange={(v) => set('liabilityLimit', v as ScenarioState['liabilityLimit'])} />
            </Row>
          )}

          {/* 보조금 */}
          <Row label="보조금">
            <Segmented value={state.subsidy}
              options={[{ value: 'none', label: '비해당' }, { value: 'applicable', label: '해당' }]}
              onChange={(v) => set('subsidy', v as ScenarioState['subsidy'])} />
            <ValueInput
              className="ml-auto w-28"
              value={state.subsidyAmount}
              disabled={state.subsidy === 'none'}
              suffix={state.subsidy === 'applicable' ? '원' : ''}
              onChange={(v) => set('subsidyAmount', v)}
              integer
            />
          </Row>

          {/* 판매사 행(BNK 딜러 입력)은 CRM v1 미이식 — spec D2. 필요 시 제프 원본에서 복원. */}

          {/* CM 수수료 */}
          <Row label="CM수수료">
            <ValueInput
              className="w-20"
              value={state.cmFeePercent}
              suffix="%"
              onChange={(v) => set('cmFeePercent', v)}
              decimal
            />
            <ReadonlyAmount className="ml-auto w-28" value={cmFeeAmount} />
          </Row>

          {/* AG 수수료 */}
          <Row label="AG수수료">
            <ValueInput
              className="w-20"
              value={state.agFeePercent}
              suffix="%"
              onChange={(v) => set('agFeePercent', v)}
              decimal
            />
            <ReadonlyAmount className="ml-auto w-28" value={agFeeAmount} />
          </Row>

          {/* 견적 조회 버튼 + 정렬 드롭다운 */}
          <div className="pt-4 relative" ref={dropdownRef}>
            <button
              onClick={handleQueryClick}
              disabled={isLoading || (!showResults && calcDisabled)}
              className={`w-full px-4 py-2 text-[12px]/[16px] rounded transition-colors flex items-center justify-center gap-2 ${
                isLoading
                  ? 'bg-blue-400 text-white cursor-not-allowed'
                  : !showResults
                    ? 'bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-300 disabled:cursor-not-allowed'
                    : hasChanges
                      ? 'bg-orange-500 hover:bg-orange-600 text-white'
                      : 'bg-gray-400 hover:bg-gray-500 text-white cursor-pointer'
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  견적 조회 중...
                </>
              ) : (
                <>
                  {!showResults
                    ? '견적 조회'
                    : hasChanges
                      ? '변경된 조건으로 다시 조회하기'
                      : `${getSortLabel(sortType)}으로 조회 완료`}
                  {showResults && !hasChanges && <ChevronDown className="w-3 h-3" />}
                </>
              )}
            </button>

            {showSortDropdown && showResults && !hasChanges && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg z-10">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setSortType(option.value)
                      setShowSortDropdown(false)
                    }}
                    className={`w-full px-4 py-2 text-[12px]/[16px] text-left hover:bg-gray-50 transition-colors flex items-center justify-between ${
                      sortType === option.value ? 'bg-gray-100' : ''
                    }`}
                  >
                    <span className="text-gray-700">{option.label}</span>
                    {sortType === option.value && <Check className="w-3 h-3 text-blue-500" />}
                  </button>
                ))}
              </div>
            )}

            {!isVehicleReady && (
              <p className="text-[11px] text-gray-400 text-center mt-2">차량을 먼저 선택하세요</p>
            )}
          </div>
        </div>

        {/* 결과 영역 */}
        {showResults && (
          <div className="mt-4">
            {showMaxWarning && (
              <div className="mb-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-[11px] text-yellow-700 text-center animate-pulse">
                견적 작성은 최대 3개 조건까지 가능합니다
              </div>
            )}
            <div className="space-y-2">
              {(() => {
                const entries: QuoteEntryForRow[] = results
                  .filter((r) => !r.notAvailable && r.result !== null && !r.loading)
                  .map((r) => {
                    const result = r.result!
                    const isWoori = r.lenderCode === 'woori-card'
                    const rate = isWoori
                      ? result.rates.effectiveAnnualRateDecimal
                      : result.rates.annualRateDecimal
                    // 렌트(long_term_rental) 월대여료는 이미 VAT 포함 최종값(CW25) →
                    // 100원 올림 금지. 운용리스만 floor(PMT) → 100원 올림 표시.
                    const monthlyDisplay =
                      result.productType === 'long_term_rental'
                        ? result.monthlyPayment
                        : roundUpToNearestHundred(result.monthlyPayment)
                    return {
                      lenderCode: r.lenderCode,
                      monthlyPayment: monthlyDisplay,
                      interestRate: rate * 100,
                      residualAmount: result.residual.amount,
                      residualPercent: result.residual.rateDecimal * 100,
                      totalCost: monthlyDisplay * leaseTermMonths + result.residual.amount,
                      warnings: result.warnings ?? [],
                    }
                  })
                const sorted = sortQuotes(entries, sortType)
                const stats = computeStats(entries)
                if (!stats || sorted.length === 0) {
                  if (isLoading) return null
                  return (
                    <div className="text-center text-xs text-gray-500 py-4">조회 결과가 없습니다</div>
                  )
                }
                return sorted.map((e, idx) => {
                  const priceDifference =
                    sortType === 'monthlyPayment' && idx > 0
                      ? e.monthlyPayment - stats.lowestMonthlyPayment
                      : 0
                  return (
                    <QuoteResultRow
                      key={e.lenderCode}
                      rank={idx + 1}
                      lenderCode={e.lenderCode}
                      monthlyPayment={e.monthlyPayment}
                      interestRate={e.interestRate}
                      residualAmount={e.residualAmount}
                      residualPercent={e.residualPercent}
                      totalCost={e.totalCost}
                      warnings={e.warnings}
                      isSelected={selectedQuotes.includes(e.lenderCode)}
                      isLowestMonthly={e.monthlyPayment === stats.lowestMonthlyPayment}
                      isLowestRate={e.interestRate === stats.lowestInterestRate}
                      isHighestResidual={e.residualAmount === stats.highestResidualValue}
                      isLowestTotal={e.totalCost === stats.lowestTotalCost}
                      priceDifference={priceDifference}
                      onClick={() => onToggleSelect(e.lenderCode)}
                    />
                  )
                })
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const resetFields: Partial<ScenarioState> = {
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
  subsidy: 'none',
  subsidyAmount: '0',
  cmFeePercent: '',
  agFeePercent: '',
}

/* ─────────── primitives ─────────── */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-2 border-b border-gray-200">
      <label className="text-[12px]/[16px] text-gray-500 w-16 flex-shrink-0">{label}</label>
      {children}
    </div>
  )
}

function Segmented({
  value, options, onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center rounded overflow-hidden border border-gray-200 flex-shrink-0">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 text-[12px]/[16px] font-medium transition-colors ${
            value === opt.value
              ? 'bg-slate-700 text-white'
              : 'bg-gray-50 text-gray-400 hover:text-gray-600'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function ValueInput({
  value, onChange, suffix = '', disabled = false, className = '', integer = false, decimal = false,
}: {
  value: string
  onChange: (v: string) => void
  suffix?: string
  disabled?: boolean
  className?: string
  integer?: boolean
  decimal?: boolean
}) {
  const display = disabled ? '' : integer ? Number(value || 0).toLocaleString() : value
  return (
    <div className={`relative flex-shrink-0 ${className}`}>
      <input
        type="text"
        value={display}
        onChange={(e) => {
          if (decimal) onChange(onlyDecimal(e.target.value))
          else onChange(onlyDigits(e.target.value))
        }}
        disabled={disabled}
        placeholder="0"
        className={`w-full py-1 pl-2 pr-6 border border-gray-200 rounded text-[12px]/[16px] text-right focus:outline-none
                   font-mono tabular-nums font-normal ${
          disabled
            ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
            : 'bg-white text-gray-900 focus:border-slate-400'
        }`}
      />
      {!disabled && suffix && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px]/[16px] text-gray-400 pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  )
}

function ReadonlyAmount({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`relative flex-shrink-0 ${className}`}>
      <input
        type="text"
        value={value.toLocaleString()}
        readOnly
        className="w-full py-1 pl-2 pr-6 border border-gray-200 rounded text-[12px]/[16px] text-gray-500 text-right
                   bg-gray-50 cursor-default focus:outline-none font-mono tabular-nums font-normal"
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px]/[16px] text-gray-400 pointer-events-none">원</span>
    </div>
  )
}

/* ─────────── public API: ConditionCards 그룹 ─────────── */

interface GroupProps {
  scenarios: [ScenarioState, ScenarioState, ScenarioState]
  setScenarios: (
    updater: (prev: [ScenarioState, ScenarioState, ScenarioState]) => [ScenarioState, ScenarioState, ScenarioState],
  ) => void
  onCalculate: (idx: 0 | 1 | 2) => void
  loadings: [boolean, boolean, boolean]
  isVehicleReady: boolean
  basePriceForFeePreview: number
  topLevelFingerprint: string
  quotes: [
    ReturnType<typeof useMultiQuote>,
    ReturnType<typeof useMultiQuote>,
    ReturnType<typeof useMultiQuote>,
  ]
  leaseTermMonths: [number, number, number]
  selectedQuotesByScenario: [SupportedLenderCode[], SupportedLenderCode[], SupportedLenderCode[]]
  onToggleSelect: (scenarioIdx: 0 | 1 | 2, lenderCode: SupportedLenderCode) => void
  showMaxWarningByScenario: [boolean, boolean, boolean]
}

export function ConditionCards({
  scenarios, setScenarios, onCalculate, loadings, isVehicleReady, basePriceForFeePreview,
  topLevelFingerprint,
  quotes, leaseTermMonths, selectedQuotesByScenario, onToggleSelect, showMaxWarningByScenario,
}: GroupProps) {
  const updateAt = (idx: 0 | 1 | 2) => (s: ScenarioState) =>
    setScenarios((prev) => prev.map((c, i) => (i === idx ? s : c)) as [ScenarioState, ScenarioState, ScenarioState])

  const toResults = (q: ReturnType<typeof useMultiQuote>) =>
    q.entries.map((e) => ({
      lenderCode: e.lenderCode as SupportedLenderCode,
      result: e.result,
      loading: e.loading,
      notAvailable: e.notAvailable,
    }))

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <ConditionCard
        cardNumber={1}
        state={scenarios[0]}
        setState={updateAt(0)}
        onCalculate={() => onCalculate(0)}
        isLoading={loadings[0]}
        isVehicleReady={isVehicleReady}
        basePriceForFeePreview={basePriceForFeePreview}
        topLevelFingerprint={topLevelFingerprint}
        results={toResults(quotes[0])}
        leaseTermMonths={leaseTermMonths[0]}
        selectedQuotes={selectedQuotesByScenario[0]}
        onToggleSelect={(code) => onToggleSelect(0, code)}
        showMaxWarning={showMaxWarningByScenario[0]}
      />
      <ConditionCard
        cardNumber={2}
        state={scenarios[1]}
        setState={updateAt(1)}
        onCalculate={() => onCalculate(1)}
        isLoading={loadings[1]}
        isVehicleReady={isVehicleReady}
        basePriceForFeePreview={basePriceForFeePreview}
        topLevelFingerprint={topLevelFingerprint}
        results={toResults(quotes[1])}
        leaseTermMonths={leaseTermMonths[1]}
        selectedQuotes={selectedQuotesByScenario[1]}
        onToggleSelect={(code) => onToggleSelect(1, code)}
        showMaxWarning={showMaxWarningByScenario[1]}
        onCopy={() => setScenarios((prev) => [prev[0], { ...prev[0] }, prev[2]])}
        copyLabel="1번 조건 복사"
      />
      <ConditionCard
        cardNumber={3}
        state={scenarios[2]}
        setState={updateAt(2)}
        onCalculate={() => onCalculate(2)}
        isLoading={loadings[2]}
        isVehicleReady={isVehicleReady}
        basePriceForFeePreview={basePriceForFeePreview}
        topLevelFingerprint={topLevelFingerprint}
        results={toResults(quotes[2])}
        leaseTermMonths={leaseTermMonths[2]}
        selectedQuotes={selectedQuotesByScenario[2]}
        onToggleSelect={(code) => onToggleSelect(2, code)}
        showMaxWarning={showMaxWarningByScenario[2]}
        onCopy={() => setScenarios((prev) => [prev[0], prev[1], { ...prev[1] }])}
        copyLabel="2번 조건 복사"
      />
    </div>
  )
}
