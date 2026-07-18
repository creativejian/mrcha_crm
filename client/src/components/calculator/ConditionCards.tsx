// 제프(dolim-solution) components/redesign/ConditionCards.tsx 이식 → 견적 조건 UI SSOT로 워크벤치
// 문법 수렴(spec: ref/specs/2026-07-16-crm-quote-ui-ssot-design.md — 통합 디자인 기준 = 워크벤치).
//
// 카드 셸·조건 행 = quote-fields 공유 프리미티브(kim-manual-compare-card/body 문법 — 라벨 80px 고정
// 칸 그리드·세그먼트 칸·값 칸 전 행 좌우 정렬). 상태/파생/fingerprint/payload는 제프 원형 그대로
// (controlled ScenarioState — 행위 변경 0, spec D6). 계산기 전용 슬롯(spec D5) = 리스/렌트 탭·렌트
// 전용 4행(행 문법만 공유)·견적 조회 버튼/정렬 드롭다운/결과 리스트.
// 판매사 행 = 실동작(T1, 2026-07-17 — 구 spec D2 "미이식" 해제): 제프 ConditionCards.tsx:383-419 미러,
// 사별 union 목록(dealers prop)에서 `lenderCode::dealerName` 합성값 선택.
import { useState, useEffect, useRef } from 'react'
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
import { distanceGuardReason, failureNoteFromEntries, feePreviewWon, percentGuardReason } from './calc-guards'
import type { QuoteResult } from './quote-types'
import type { DealerOption } from '@/lib/solution-dealers'
// 판매사 세그먼트 어휘·빈 목록 placeholder — 워크벤치와 물리 1벌(quote-workbench-meta 순수 상수, discountLineWon 선례).
import { DEALER_MODE_SEGMENT_OPTIONS, dealerSelectPlaceholder } from '@/components/customer-detail/quote-workbench-meta'
import { scenarioQueryFingerprint } from './query-fingerprint'
import { useMultiQuote } from './hooks/useMultiQuote'
import { bindSelect } from '@/lib/select-bind'
import { CondCombo, CondRow, FeeCombo, MoneyField, SegmentGroup, ValueSelect, type MoneyInputProps } from '@/components/quote-fields/QuoteFields'
import { SOLUTION_LEASE_TERMS } from '@/lib/solution-quote'
// 결과 행 표시 규칙 3종(월납입 라운딩·우리카드 유효금리·총비용)은 랭킹 모달과 공유 SSOT(배치 7 A#11).
import { solutionDisplayRatePct, solutionMonthlyDisplay, solutionTotalCost } from '@/lib/solution-ranking'

/**
 * 견적비교 1·2·3 카드 그룹.
 *
 * 상태/액션은 부모(CalculatorModal)가 소유하고, 각 카드의 [견적 조회] 클릭 시 해당 시나리오의
 * useMultiQuote 인스턴스가 전 금융사 계산을 병렬 실행한다(제프 원형 로직 그대로).
 * 렌트 탭 = 장기렌터카(long_term_rental) dispatch.
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
  dealers: DealerOption[]          // 판매사 사별 union 목록(CalculatorModal fetch — 브랜드 변경 시 갱신)
  // 배치 8 A#2: 전 사 조회 실패(사별 부분 실패는 union 축소로 허용 — CalculatorModal 판별).
  // placeholder가 데이터-부재 어휘("등록 딜러 없음") 대신 실패를 표면화하는 근거.
  dealersFailed: boolean
  results: Array<{
    lenderCode: SupportedLenderCode
    result: QuoteResult | null
    loading: boolean
    notAvailable: boolean
    // 배치 7 A#1(제프 대비 의도적 이탈): useMultiQuote가 저장한 에러성 실패 사유(미취급이면 null).
    // 종전 매핑이 이 필드를 버려 전사 실패가 무사유 "조회 결과가 없습니다"로 위장됐다.
    error: string | null
  }>
  leaseTermMonths: number
  selectedQuotes: SupportedLenderCode[]
  onToggleSelect: (lenderCode: SupportedLenderCode) => void
  showMaxWarning: boolean
}

const onlyDigits = (s: string) => s.replace(/[^0-9]/g, '')
const onlyDecimal = (s: string) => s.replace(/[^0-9.]/g, '')

// 기간 어휘 = SOLUTION_LEASE_TERMS 파생(워크벤치와 같은 소스 — 값 타입만 ScenarioState.period 계약(string)).
const leaseTermSegmentOptions = SOLUTION_LEASE_TERMS.map((m) => ({ value: String(m), label: `${m}개월` }))

// controlled 금액 바인딩(제프 ValueInput 의미론 보존): integer = 콤마 표시 + 숫자만, decimal = 소수 허용
// 원문 표시. disabled여도 값은 상태에 남고 표시만 비운다(구 ValueInput 동작).
function moneyBinding(
  value: string,
  onChange: (v: string) => void,
  { disabled = false, decimal = false, ariaLabel }: { disabled?: boolean; decimal?: boolean; ariaLabel?: string } = {},
): MoneyInputProps {
  return {
    'aria-label': ariaLabel,
    value: disabled ? '' : decimal ? value : Number(value || 0).toLocaleString(),
    onChange: (e) => onChange(decimal ? onlyDecimal(e.currentTarget.value) : onlyDigits(e.currentTarget.value)),
    disabled,
    placeholder: '0',
  }
}

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
  dealers,
  dealersFailed,
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

  // 배치 7 A#8(제프 대비 의도적 이탈): parseFloat → parsePercentInput SSOT(feePreviewWon).
  // 제프 원형은 '.' 입력이 NaN → 미리보기 "NaN원"으로 샜다(onlyDecimal이 '.'·'1.2.3'을 통과시킴).
  const cmFeeAmount = feePreviewWon(basePriceForFeePreview, state.cmFeePercent)
  const agFeeAmount = feePreviewWon(basePriceForFeePreview, state.agFeePercent)

  const warningDistances = ['15000', '25000', '35000', '40000', 'unlimited']
  const showDistanceWarning = warningDistances.includes(state.annualDistance)

  const calcDisabled = isLoading || !isVehicleReady

  // ── sort dropdown + dirty-state detection ──
  const [sortType, setSortType] = useState<SortType>('monthlyPayment')
  const [showSortDropdown, setShowSortDropdown] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [querySnapshot, setQuerySnapshot] = useState<string | null>(null)
  // 배치 7 A#8(제프 대비 의도적 이탈): 조회 시작 % 검증(percentGuardReason) 실패 사유.
  // 워크벤치는 같은 입력이 빌드 실패(reason)로 차단되는데 계산기는 무캡 전송이던 비대칭 해소 —
  // 표면화는 A#1 빈 상태와 같은 문구 문법("조회에 실패했습니다 — {사유}")으로, 신규 UI 채널 없음.
  const [blockReason, setBlockReason] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  // 배치 7 A#3(제프 대비 의도적 이탈): 인라인 조립 → 순수 헬퍼. 제프 원형은 activeTab/
  // deliveryType/maintenanceGrade 누락 — 리스 결과가 렌트 탭 아래 "조회 완료"로 오표시됐다.
  // 편입 키 원칙("payload 키 ⊆ fingerprint 키")·잠금 테스트는 query-fingerprint.ts 참조.
  const currentQueryFingerprint = scenarioQueryFingerprint(state, topLevelFingerprint)
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
      // A#8 % 상한 + A#2 렌트 무제한 — 위반이면 조회를 시작하지 않는다(전 금융사 400 전사 낭비 + 무사유 은닉 차단).
      const guardReason = distanceGuardReason(state) ?? percentGuardReason(state)
      if (guardReason) {
        setBlockReason(guardReason)
        return
      }
      setBlockReason(null)
      setQuerySnapshot(currentQueryFingerprint)
      setShowResults(true)
      onCalculate()
    } else {
      setBlockReason(null) // 조건이 스냅샷과 일치(원복)하면 차단 사유도 소거
      setShowSortDropdown((v) => !v)
    }
  }

  return (
    <section className="kim-manual-compare-card">
      <header>
        <strong>견적비교 <span>{cardNumber}</span></strong>
        <div>
          {/* 재입력/조건 복사 = 입력 통째 교체 — 잔존 차단 사유(A#8 blockReason)도 함께 소거 */}
          {onCopy && copyLabel && (
            <button className="copy" onClick={() => { setBlockReason(null); onCopy() }} type="button">{copyLabel}</button>
          )}
          <button className="edit" onClick={() => { setBlockReason(null); setState({ ...state, ...resetFields }) }} type="button">재입력</button>
        </div>
      </header>

      <div className="kim-manual-compare-body">
        {/* 리스 / 렌트 탭 — 계산기 전용 축(spec D5 선확정 1: SSOT 무관, productType 전환) */}
        <div className="flex gap-1 my-3 bg-gray-200 rounded p-0.5 border border-gray-300">
          <button
            onClick={() => handleTabChange('lease')}
            type="button"
            className={`flex-1 px-4 py-1.5 text-[12px]/[16px] transition-all ${
              isLease ? 'bg-white text-gray-900 font-semibold rounded shadow-sm' : 'bg-transparent text-gray-600'
            }`}
          >
            리스
          </button>
          <button
            onClick={() => handleTabChange('rent')}
            type="button"
            className={`flex-1 px-4 py-1.5 text-[12px]/[16px] transition-all ${
              isRent ? 'bg-white text-gray-900 font-semibold rounded shadow-sm' : 'bg-transparent text-gray-600'
            }`}
            title="장기렌터카 (MG캐피탈)"
          >
            렌트
          </button>
        </div>

        {/* 출고방식 (렌트 전용) */}
        {isRent && (
          <CondRow label="출고방식">
            <SegmentGroup value={state.deliveryType}
              options={[{ value: 'dealer', label: '대리점' }, { value: 'special', label: '금융사 특판' }]}
              onSelect={(v) => set('deliveryType', v)} />
          </CondRow>
        )}

        {/* 정비 등급 (렌트 전용) */}
        {isRent && (
          <CondRow label="정비">
            <SegmentGroup value={state.maintenanceGrade}
              options={[{ value: 'basic', label: 'Basic' }, { value: 'vip', label: 'VIP' }]}
              onSelect={(v) => set('maintenanceGrade', v)} />
          </CondRow>
        )}

        {/* 기간 — 워크벤치와 동일 어휘(SOLUTION_LEASE_TERMS)·동일 wide 세그먼트 문법 */}
        <CondRow label="기간">
          <SegmentGroup wide value={state.period} options={leaseTermSegmentOptions} onSelect={(v) => set('period', v)} />
        </CondRow>

        {/* 선수금 */}
        <CondRow label="선수금">
          <CondCombo>
            <SegmentGroup value={state.downPaymentType}
              options={[{ value: 'none', label: '없음' }, { value: 'amount', label: '금액' }, { value: 'percent', label: '%' }]}
              onSelect={(v) => set('downPaymentType', v)} />
            <MoneyField
              fixed={state.downPaymentType === 'none'}
              suffix={state.downPaymentType === 'percent' ? '%' : '원'}
              inputProps={moneyBinding(state.downPayment, (v) => set('downPayment', v), { disabled: state.downPaymentType === 'none', ariaLabel: '선수금' })}
            />
          </CondCombo>
        </CondRow>

        {/* 보증금 */}
        <CondRow label="보증금">
          <CondCombo>
            <SegmentGroup value={state.depositType}
              options={[{ value: 'none', label: '없음' }, { value: 'amount', label: '금액' }, { value: 'percent', label: '%' }]}
              onSelect={(v) => set('depositType', v)} />
            <MoneyField
              fixed={state.depositType === 'none'}
              suffix={state.depositType === 'percent' ? '%' : '원'}
              inputProps={moneyBinding(state.deposit, (v) => set('deposit', v), { disabled: state.depositType === 'none', ariaLabel: '보증금' })}
            />
          </CondCombo>
        </CondRow>

        {/* 잔존가치 */}
        <CondRow label="잔존가치">
          <CondCombo>
            <SegmentGroup value={state.residualValueType}
              options={[{ value: 'max', label: '최대' }, { value: 'amount', label: '금액' }, { value: 'percent', label: '%' }]}
              onSelect={(v) => set('residualValueType', v)} />
            <MoneyField
              fixed={state.residualValueType === 'max'}
              suffix={state.residualValueType === 'amount' ? '원' : state.residualValueType === 'percent' ? '%' : '원'}
              inputProps={moneyBinding(state.residualValue, (v) => set('residualValue', v), { disabled: state.residualValueType === 'max', ariaLabel: '잔존가치' })}
            />
          </CondCombo>
        </CondRow>

        {/* 약정거리 — 계산기는 기본 모드에서도 select 직접 변경 허용(현행 행위 보존 — spec D6 미시 이탈 1) */}
        <CondRow label="약정거리">
          <CondCombo>
            <SegmentGroup value={state.annualDistanceMode}
              options={[{ value: 'default', label: '기본' }, { value: 'custom', label: '변경' }]}
              onSelect={(v) => {
                if (v === 'default') {
                  setState({ ...state, annualDistanceMode: 'default', annualDistance: '20000' })
                } else {
                  set('annualDistanceMode', 'custom')
                }
              }} />
            <ValueSelect
              selectProps={{
                'aria-label': '약정거리',
                ...bindSelect(state.annualDistance, (next) =>
                  setState({
                    ...state,
                    annualDistance: next,
                    annualDistanceMode: next === '20000' ? 'default' : 'custom',
                  }),
                ),
              }}
            >
              {distanceOptions.map((v) =>
                v === 'unlimited'
                  ? <option key="unlimited" value="unlimited">무제한</option>
                  : <option key={v} value={v}>{Number(v).toLocaleString()}km / 년</option>
              )}
            </ValueSelect>
          </CondCombo>
        </CondRow>
        {showDistanceWarning && (
          <p className="py-1 text-[11px]/[15px] text-red-500 text-right">
            해당 약정거리를 지원하지 않는 금융사는 조회 불가능
          </p>
        )}

        {/* 자동차세 (리스 전용) — 라벨 = 워크벤치 어휘(불포함/포함, 유슨생 2026-07-16). 의미는 제프 원형
            "리스료에 포함" 그대로(value 계약 불변) — 짧은 어휘라 40% 폭 트랙에 들어와 전 행 너비 통일. */}
        {isLease && (
          <CondRow label="자동차세">
            <SegmentGroup value={state.carTax}
              options={[{ value: 'excluded', label: '불포함' }, { value: 'included', label: '포함' }]}
              onSelect={(v) => set('carTax', v)} />
          </CondRow>
        )}

        {/* 운전연령 (렌트 전용) */}
        {isRent && (
          <CondRow label="운전연령">
            <SegmentGroup value={state.driverAge}
              options={[{ value: '21', label: '만 21세 이상' }, { value: '26', label: '만 26세 이상' }]}
              onSelect={(v) => set('driverAge', v)} />
          </CondRow>
        )}

        {/* 대물한도 (렌트 전용) */}
        {isRent && (
          <CondRow label="대물한도">
            <SegmentGroup value={state.liabilityLimit}
              options={[
                { value: '100', label: '1억' },
                { value: '200', label: '2억' },
                { value: '300', label: '3억' },
                { value: '500', label: '5억' },
              ]}
              onSelect={(v) => set('liabilityLimit', v)} />
          </CondRow>
        )}

        {/* 보조금 */}
        <CondRow label="보조금">
          <CondCombo>
            <SegmentGroup value={state.subsidy}
              options={[{ value: 'none', label: '비해당' }, { value: 'applicable', label: '해당' }]}
              onSelect={(v) => set('subsidy', v)} />
            <MoneyField
              fixed={state.subsidy === 'none'}
              suffix="원"
              inputProps={moneyBinding(state.subsidyAmount, (v) => set('subsidyAmount', v), { disabled: state.subsidy === 'none', ariaLabel: '보조금 금액' })}
            />
          </CondCombo>
        </CondRow>

        {/* 판매사(제프 ConditionCards.tsx:383-419 미러 — T1 실동작화). 세그먼트 어휘·폭 = 표준 행과 통일
            (DEALER_MODE_SEGMENT_OPTIONS 공용 1벌 — 제프 원문 자연폭은 #265 고정 칸 그리드를 깨서 폐기, T2 픽스).
            select 는 값 트랙(40%)이라 위아래 "0 원" 입력과 라인 일치. */}
        <CondRow label="판매사">
          <CondCombo>
            <SegmentGroup value={state.dealerType}
              options={DEALER_MODE_SEGMENT_OPTIONS}
              onSelect={(v) => set('dealerType', v)} />
            {/*
              사별 union 이라 어느 lender 의 딜러인지 라벨에 반드시 표시한다.
              value 는 `lenderCode::dealerName` 합성 — 딜러명이 사 간 겹칠 수
              있어(예: "모터원") 이름만으로는 식별이 안 된다.
              ⚠ 옆의 % 는 **의미가 사별로 다르다** (BNK=기준 IRR /
              우리=합산 수수료율 / 메리츠=딜러 fee 율).
            */}
            <ValueSelect
              fixed={state.dealerType === 'nonAffiliated'}
              selectProps={{
                'aria-label': '판매사',
                disabled: state.dealerType === 'nonAffiliated',
                ...bindSelect(state.dealer, (next) => set('dealer', next)),
              }}
            >
              {/* 빈 목록 placeholder = 이유 표면화(워크벤치 파리티 — 제프 원문 "선택" 고정 대비 의도 이탈).
                  계산기는 전사 union이라 금융사 단계가 없음 → lenderReady 상수 true.
                  loadFailed = 전 사 실패(A#2 — 부분 실패는 union 축소로 허용, 어휘는 SSOT 문구). */}
              <option value="">{dealerSelectPlaceholder({ hasChoices: dealers.length > 0, vehicleReady: isVehicleReady, lenderReady: true, loadFailed: dealersFailed })}</option>
              {dealers.map((d) => (
                <option
                  key={`${d.lenderCode}::${d.dealerName}`}
                  value={`${d.lenderCode}::${d.dealerName}`}
                >
                  {d.lenderName} · {d.dealerName} ({(d.baseIrrRate * 100).toFixed(2)}%)
                </option>
              ))}
            </ValueSelect>
          </CondCombo>
        </CondRow>

        {/* CM/AG 수수료 — % 입력 + 기본가격 기준 원 미리보기(워크벤치 fee 콤보 문법) */}
        <CondRow label="CM수수료">
          <FeeCombo>
            <MoneyField suffix="%" inputProps={moneyBinding(state.cmFeePercent, (v) => set('cmFeePercent', v), { decimal: true, ariaLabel: 'CM수수료 퍼센트' })} />
            <MoneyField fixed suffix="원" inputProps={{ 'aria-label': 'CM수수료 환산 금액', value: cmFeeAmount.toLocaleString(), readOnly: true }} />
          </FeeCombo>
        </CondRow>

        <CondRow label="AG수수료">
          <FeeCombo>
            <MoneyField suffix="%" inputProps={moneyBinding(state.agFeePercent, (v) => set('agFeePercent', v), { decimal: true, ariaLabel: 'AG수수료 퍼센트' })} />
            <MoneyField fixed suffix="원" inputProps={{ 'aria-label': 'AG수수료 환산 금액', value: agFeeAmount.toLocaleString(), readOnly: true }} />
          </FeeCombo>
        </CondRow>

        {/* 견적 조회 버튼 + 정렬 드롭다운 — 계산기 전용 슬롯(spec D5) */}
        <div className="pt-4 pb-5 relative" ref={dropdownRef}>
          <button
            onClick={handleQueryClick}
            type="button"
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
                  type="button"
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

        {/* A#8 — 조회 차단 사유(% 상한 위반). A#1 빈 상태와 같은 문구 문법으로 표면화. */}
        {blockReason && (
          <div className="pb-5">
            <div className="text-center text-xs text-gray-500 py-4">조회에 실패했습니다 — {blockReason}</div>
          </div>
        )}

        {/* 결과 영역 — 계산기 전용 슬롯(spec D5) */}
        {showResults && (
          <div className="pb-5">
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
                    // 표시 규칙 3종 = solution-ranking SSOT(배치 7 A#11 — 랭킹 모달과 공유):
                    // 월납입(렌트 VAT 기포함 그대로·운용리스 100원 올림)·우리카드 유효금리 우선·
                    // 총비용(표시 월납입 × 기간 + 잔가).
                    const monthlyDisplay = solutionMonthlyDisplay(result.productType, result.monthlyPayment)
                    return {
                      lenderCode: r.lenderCode,
                      monthlyPayment: monthlyDisplay,
                      interestRate: solutionDisplayRatePct(r.lenderCode, {
                        annualRatePct: result.rates.annualRateDecimal * 100,
                        effectiveAnnualRatePct: result.rates.effectiveAnnualRateDecimal * 100,
                      }),
                      residualAmount: result.residual.amount,
                      residualPercent: result.residual.rateDecimal * 100,
                      totalCost: solutionTotalCost(monthlyDisplay, leaseTermMonths, result.residual.amount),
                      warnings: result.warnings ?? [],
                    }
                  })
                const sorted = sortQuotes(entries, sortType)
                const stats = computeStats(entries)
                if (!stats || sorted.length === 0) {
                  if (isLoading) return null
                  // 배치 7 A#1(제프 대비 의도적 이탈): 전멸 + 에러성 실패(릴레이 503/502/504 등 —
                  // 미취급 아님)면 첫 사유를 표면화 — 미취급 전멸("조회 결과가 없습니다")과 구분.
                  // SolutionLenderRankingModal 빈 상태(#241 fail-loud) 미러. 일부 성공 시 현행 유지.
                  const failureNote = failureNoteFromEntries(results)
                  return (
                    <div className="text-center text-xs text-gray-500 py-4">
                      {failureNote ? `조회에 실패했습니다 — ${failureNote}` : '조회 결과가 없습니다'}
                    </div>
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
    </section>
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
  dealerType: 'nonAffiliated',
  dealer: '',
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
  dealers: DealerOption[]
  dealersFailed: boolean // A#2 — 전 사 실패 표면화(CardProps 주석 참조)
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
  topLevelFingerprint, dealers, dealersFailed,
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
      error: e.error, // A#1 — 에러성 실패 사유 통과(종전엔 여기서 유실돼 전사 실패가 은닉)
    }))

  return (
    <div className="kim-manual-compare-grid">
      <ConditionCard
        cardNumber={1}
        state={scenarios[0]}
        setState={updateAt(0)}
        onCalculate={() => onCalculate(0)}
        isLoading={loadings[0]}
        isVehicleReady={isVehicleReady}
        basePriceForFeePreview={basePriceForFeePreview}
        topLevelFingerprint={topLevelFingerprint}
        dealers={dealers}
        dealersFailed={dealersFailed}
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
        dealers={dealers}
        dealersFailed={dealersFailed}
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
        dealers={dealers}
        dealersFailed={dealersFailed}
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
