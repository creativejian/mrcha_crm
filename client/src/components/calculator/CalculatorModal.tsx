// 전역 계산기 모달 — 제프(dolim-solution) pages/QuoteRevolutionV2.tsx 본체의 모달 어댑터.
// 원형과의 차이는 둘뿐: ①모달 셸(fixed inset·헤더 X·Esc 닫기 — spec D1, backdrop 닫기 없음)
// ②useTrimOptions/useTrimColors(mcCode 키) 2훅 → useTrimExtras(trimId 키) 1훅(T2 매핑).
// (구 차이 "판매사 상태·effect 제거(spec D2)"는 판매사 실동작화 T1(2026-07-17)로 해제 — 제프가
// 판매사를 일반화해 external dealers API를 열었고, union fetch·선택 해석을 원형대로 미러한다.)
// spec: ref/specs/2026-07-16-crm-calculator-modal-design.md
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useMasterCatalog } from './hooks/useMasterCatalog'
import { useMultiQuote } from './hooks/useMultiQuote'
import { useTrimExtras } from './hooks/useTrimExtras'
import { TopSelectionCards } from './TopSelectionCards'
import { ConditionCards } from './ConditionCards'
import { feeRateFraction } from './calc-guards'
import { QuoteBottomBar } from './QuoteBottomBar'
import type { SupportedLenderCode } from './lender-meta'
import {
  defaultScenario,
  type CalcDiscountLine,
  type ScenarioState,
  type TaxReductionMode,
  type ToggleIncluded,
  type DiscountUnit,
} from './types'
// 할인 행 환산 산술·항목명 어휘는 워크벤치와 공유(quote-workbench-meta 순수 상수/함수 — SSOT 통합 전 어휘 정합).
import { discountLineWon } from '@/components/customer-detail/quote-workbench-meta'
import { SOLUTION_LENDERS } from '@/lib/solution-quote'
import { fetchSolutionDealers, type DealerOption } from '@/lib/solution-dealers'
import type {
  AcquisitionTaxMode,
  AnnualMileage,
  LeaseTerm,
  QuotePayload,
} from './quote-types'

type CalculatorModalProps = { onClose: () => void }

// 판매사 union fetch의 금융사 셋 — SOLUTION_LENDERS 파생(제프의 q1.entries 대응 — CRM은 fetchLenders
// 내부 API 대신 고정 어휘 SSOT라 모듈 상수로 충분, useMultiQuote LENDERS와 같은 소스).
const DEALER_LENDERS = SOLUTION_LENDERS.map((l) => ({ lenderCode: l.code, lenderName: l.label }))

/**
 * 비교견적 V2 (이사님 디자인 기반) — 제프 원형 주석 승계.
 *
 * - 차량/할인/취득원가는 3 시나리오가 공유.
 * - 견적비교 1·2·3 카드는 각자의 ScenarioState 와 useMultiQuote 인스턴스를 가짐.
 * - 각 카드 [견적 조회] → 그 시나리오의 전 금융사 병렬 계산 → 그 시나리오의
 *   결과만 자체 result row 에 렌더.
 * - 렌트 탭 = 장기렌터카(long_term_rental) dispatch. 미지원 금융사는 파트너 가드의
 *   "미취급" 문구로 숨김(isLenderNotAvailableMessage).
 */
export function CalculatorModal({ onClose }: CalculatorModalProps) {
  const masterCatalog = useMasterCatalog()

  // ── 공유 입력 (차량/할인/취득원가) ──
  const [basePrice, setBasePrice] = useState('')
  const [optionPrice, setOptionPrice] = useState('0')
  const [selectedOptionIds, setSelectedOptionIds] = useState<Set<number>>(new Set())
  const [selectedExteriorId, setSelectedExteriorId] = useState<number | null>(null)
  const [selectedInteriorId, setSelectedInteriorId] = useState<number | null>(null)

  // 제프는 mcCode 키 2훅 — CRM은 trimId 키 1훅(fetchWorkbench 1콜, 반환 계약은 제프 원형 분리 유지).
  const trimId = masterCatalog.selectedTrim?.trimId ?? null
  const mcCode = masterCatalog.selectedTrim?.mcCode ?? null
  const { options: optionsState, colors: colorsState } = useTrimExtras(trimId)

  const [discount, setDiscount] = useState('0')
  const [discountUnit, setDiscountUnit] = useState<DiscountUnit>('amount')
  // 추가 할인 행(워크벤치 패리티) — 기본 할인(discount)과 별개 행, 최종 할인 = 기본+행 환산 합.
  const [discountLines, setDiscountLines] = useState<CalcDiscountLine[]>([])

  const [taxReduction, setTaxReduction] = useState<TaxReductionMode>('none')
  const [taxAmount, setTaxAmount] = useState('0')
  const [bondIncluded, setBondIncluded] = useState<ToggleIncluded>('included')
  const [bondAmount, setBondAmount] = useState('0')
  const [deliveryIncluded, setDeliveryIncluded] = useState<ToggleIncluded>('excluded')
  const [deliveryAmount, setDeliveryAmount] = useState('0')
  const [extraIncluded, setExtraIncluded] = useState<ToggleIncluded>('excluded')
  const [extraAmount, setExtraAmount] = useState('0')

  // ── 3 시나리오 입력 ──
  const [scenarios, setScenarios] = useState<[ScenarioState, ScenarioState, ScenarioState]>([
    defaultScenario(),
    defaultScenario(),
    defaultScenario(),
  ])

  // ── 3 시나리오 결과 (각자 multi-lender) ──
  const q1 = useMultiQuote()
  const q2 = useMultiQuote()
  const q3 = useMultiQuote()
  const quotes = [q1, q2, q3] as const

  // ── 판매사(딜러) 목록 — 사별 조회 union (브랜드 변경 시 갱신, 제프 QuoteRevolutionV2.tsx:82-107 미러) ──
  // 금융사 셋(DEALER_LENDERS)에서 그대로 돌린다(하드코딩 없음). 딜러가 없는/미지원 사는 빈 목록을
  // 주므로(업스트림 200 빈 목록), 신한처럼 나중에 딜러가 붙어도 여기 고칠 게 없다. 개별 실패도
  // 빈 목록(catch) — 한 사의 장애가 union 전체를 죽이지 않는다.
  const [dealers, setDealers] = useState<DealerOption[]>([])

  useEffect(() => {
    const brandForDealers = masterCatalog.selectedBrand?.name ?? ''
    if (!brandForDealers) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 제프 원형 미러: 브랜드 해제 시 union 목록 클리어
      setDealers([])
      return
    }
    let cancelled = false
    void Promise.all(
      DEALER_LENDERS.map((l) =>
        fetchSolutionDealers(l.lenderCode, brandForDealers)
          .then((list) =>
            list.map((d) => ({ ...d, lenderCode: l.lenderCode, lenderName: l.lenderName })),
          )
          .catch(() => [] as DealerOption[]),
      ),
    ).then((lists) => {
      if (!cancelled) setDealers(lists.flat()) // cancelled 가드 — 늦은 응답이 새 브랜드 목록을 덮지 않게
    })
    return () => {
      cancelled = true
    }
  }, [masterCatalog.selectedBrand?.brandCode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 모달 셸: Esc 닫기(spec D1 — backdrop 닫기 없음, 입력 유실 방지) ──
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 배치 7 A#4(제프 대비 의도적 이탈): 픽커 다이얼로그가 열려 있으면 Esc를 무시한다.
      // 픽커 5종(vehicle-pickers — 이 PR 불가침)은 keydown 핸들러가 없어, 종전엔 Esc가
      // 계산기 모달 전체를 닫아 입력이 전소실됐다. 판별자 = `.jeff-ui` 존재 프로브
      // (픽커는 open일 때만 .jeff-ui 루트를 렌더 — 워크벤치 스크롤 잠금 CSS
      // `.kim-quote-solution-modal:has(.jeff-ui)`와 같은 판별자의 JS 대칭).
      // "Esc가 픽커만 닫아주는" UX 개선은 픽커 몫이라 범위 밖(PR 본문 follow-up).
      if (document.querySelector('.jeff-ui')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 전체화면 모달이 열려 있는 동안 배경 문서 스크롤 잠금(닫힘/unmount 시 원복).
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // "견적서 보기" 준비 중 안내 — 제프 원형도 alert 준비중(spec D6). App 전역 .toast는
  // z-index가 모달보다 낮아 모달 내부 로컬 배너로 표시.
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
  }, [])
  const showNotice = (message: string) => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 2400)
  }

  // 브랜드 목록 로드는 useMasterCatalog 훅의 마운트 자동 로드가 SSOT(배치 7 A#12 — 종전 여기 명시
  // 호출과 이중 fetch였다).

  // 트림 선택 시 기본가격 자동 채움
  useEffect(() => {
    const trim = masterCatalog.selectedTrim
    if (!trim) return
    if (trim.price > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 제프 원형 미러: 트림 선택(외부 카탈로그) → 기본가격 입력 시드
      setBasePrice(String(trim.price))
    } else {
      // 배치 7 A#9(제프 대비 의도적 이탈): 출시예정(가격 미정) 트림 — price≤0인데 mc_code가 있어
      // 선택 가능한 트림(실 DB 2건)을 고르면 종전엔 basePrice가 직전 트림 가격으로 잔존해
      // "새 트림 mcCode + 옛 가격" payload로 샜다. 첫 선택과 동일한 빈 상태로 리셋 — 수기 입력
      // 가능, 미입력 조회는 기존 가드(릴레이 zod quotedVehiclePrice min(1))가 차단한다.
      setBasePrice('')
    }
  }, [masterCatalog.selectedTrim?.mcCode]) // eslint-disable-line react-hooks/exhaustive-deps

  // 트림 변경 시 옵션/색상 선택 초기화 + optionPrice 0 리셋 (제프는 mcCode dep — 동일 의미)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 제프 원형 미러: 트림 전환 시 하위 선택 일괄 리셋
    setSelectedOptionIds(new Set())
    setSelectedExteriorId(null)
    setSelectedInteriorId(null)
    setOptionPrice('0')
  }, [trimId])

  // 옵션 선택 → optionPrice 자동 합산. 0개 선택 시 수동 입력 유지.
  useEffect(() => {
    if (selectedOptionIds.size === 0) return
    let sum = 0
    for (const o of [...optionsState.basic, ...optionsState.tuning]) {
      if (selectedOptionIds.has(o.id)) sum += o.price ?? 0
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 제프 원형 미러: 옵션 선택 → 옵션 금액 자동 합산(0개면 수동 입력 유지라 파생 불가)
    setOptionPrice(String(sum))
  }, [selectedOptionIds, optionsState.basic, optionsState.tuning])

  // 배치 7 A#7(제프 대비 의도적 이탈): 옵션 픽커 [적용]으로 전체 해제하면 옵션 금액을 0으로 리셋.
  // 위 합산 effect의 `size === 0` early return은 수동 타이핑 보존용이라 유지 — 그 유지 때문에
  // 픽커 경유 전체 해제만은 여기(onApply 수신 지점)서 0을 써 준다. 그러지 않으면 직전 옵션 금액이
  // 잔존해 차량가·취득세·payload가 오염된다. 수동 입력 경로(선택 0개에서 금액만 타이핑)는
  // "현재 세트 non-empty" 조건에 안 걸려 불변.
  const applyPickedOptionIds = (next: Set<number>) => {
    if (next.size === 0 && selectedOptionIds.size > 0) setOptionPrice('0')
    setSelectedOptionIds(next)
  }

  // ── 파생값 ──
  const rawBase = Number(basePrice.replace(/,/g, '')) || 0
  const rawOption = Number(optionPrice.replace(/,/g, '')) || 0
  const rawDiscountInput = Number(discount.replace(/,/g, '')) || 0
  const totalQuotedPrice = rawBase + rawOption
  // 최종 할인 = 기본 할인 환산 + Σ추가 행 환산(discountLineWon — 워크벤치 syncDiscountTotalFromRows와
  // 동일 산술·동일 basis(base+option)). 행이 없으면 종전(기본 할인 단독)과 동일 값.
  const rawDiscountKrw =
    discountLineWon(discountUnit, rawDiscountInput, totalQuotedPrice) +
    discountLines.reduce(
      (sum, line) => sum + discountLineWon(line.unit, Number(line.amount.replace(/,/g, '')) || 0, totalQuotedPrice),
      0,
    )
  const finalVehiclePrice = Math.max(0, totalQuotedPrice - rawDiscountKrw)

  // 취득세 자동 계산 — manual(직접 입력, 워크벤치 패리티)은 자동 재계산이 덮지 않는다.
  // - none: finalVehiclePrice/1.1 × 7% (10원 절사)
  // - hybrid: 위 값 − 400,000원
  // - electric: 위 값 − 1,400,000원
  useEffect(() => {
    if (taxReduction === 'manual') return
    if (finalVehiclePrice <= 0) return
    const base = Math.floor((finalVehiclePrice / 1.1) * 0.07 / 10) * 10
    const reduction =
      taxReduction === 'hybrid' ? 400_000 :
      taxReduction === 'electric' ? 1_400_000 : 0
    const auto = Math.max(0, base - reduction)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 제프 원형 미러: 차량가 변경 → 취득세 자동 재계산(수동 수정 가능한 입력이라 파생 불가)
    setTaxAmount(String(auto))
  }, [finalVehiclePrice, taxReduction])

  const taxAmountNum = Number(taxAmount.replace(/,/g, '')) || 0
  const bondAmountNum = Number(bondAmount.replace(/,/g, '')) || 0
  const deliveryAmountNum = Number(deliveryAmount.replace(/,/g, '')) || 0
  const extraAmountNum = Number(extraAmount.replace(/,/g, '')) || 0

  const registrationCost =
    taxAmountNum + (bondIncluded === 'included' ? bondAmountNum : 0)
  const miscCost =
    (deliveryIncluded === 'excluded' ? deliveryAmountNum : 0) +
    (extraIncluded === 'excluded' ? extraAmountNum : 0)
  const acquisitionCost =
    finalVehiclePrice +
    registrationCost +
    (deliveryIncluded === 'included' ? deliveryAmountNum : 0) +
    (extraIncluded === 'included' ? extraAmountNum : 0)

  const isVehicleReady = masterCatalog.selectedTrim != null

  // 차량 + 취득원가 변경도 다시 조회 트리거. ConditionCards 의 currentQueryFingerprint
  // 와 합쳐 하나라도 다르면 "다시 조회하기" 로 전환됨.
  const topLevelFingerprint = JSON.stringify({
    mcCode,
    basePrice, optionPrice, discount, discountUnit, discountLines,
    taxReduction, taxAmount,
    bondIncluded, bondAmount,
    deliveryIncluded, deliveryAmount,
    extraIncluded, extraAmount,
  })

  // ── 추가 할인 행 액션(워크벤치 addDiscountLine/removeDiscountLine/setDiscountLine* 미러) ──
  const addDiscountLine = () =>
    setDiscountLines((prev) => [...prev, { id: `discount-${Date.now()}-${prev.length}`, label: '재구매 할인', unit: 'amount' as DiscountUnit, amount: '0' }])
  const removeDiscountLine = (id: string) =>
    setDiscountLines((prev) => prev.filter((line) => line.id !== id))
  const patchDiscountLine = (id: string, patch: Partial<CalcDiscountLine>) =>
    setDiscountLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)))

  // ── 시나리오별 페이로드 빌드 ──
  // dealerName은 여기서 만들지 않는다 — useMultiQuote.calculateAll이 dealerSelection으로
  // lenderCode 일치 금융사에만 동봉한다(타사 유입 = 견적 무음 오염, useMultiQuote 주석 참조).
  function buildPayload(idx: 0 | 1 | 2): Omit<QuotePayload, 'lenderCode' | 'dealerName'> | null {
    const trim = masterCatalog.selectedTrim
    const mb = masterCatalog.selectedBrand
    if (!trim || !mb) return null
    const resolvedBrand = mb.name
    const resolvedModelName = trim.canonicalName ?? trim.trimName ?? trim.name
    const resolvedMasterMcCode = trim.mcCode
    const s = scenarios[idx]

    // 선수금/보증금 절대값 계산
    const computeAbs = (mode: ScenarioState['downPaymentType'], v: string): number => {
      if (mode === 'none') return 0
      const n = Number(v.replace(/,/g, '')) || 0
      if (mode === 'amount') return n
      return Math.round(finalVehiclePrice * n / 100)
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
      annualMileageKm: parseInt(s.annualDistance, 10) as AnnualMileage,
      upfrontPayment,
      depositAmount,
      quotedVehiclePrice: totalQuotedPrice,
      discountAmount: rawDiscountKrw,
      acquisitionTaxMode,
      acquisitionTaxAmountOverride: taxAmountNum,
      includePublicBondCost: bondIncluded === 'included',
      publicBondCost: bondIncluded === 'included' ? bondAmountNum : undefined,
      includeDeliveryFeeAmount: deliveryIncluded === 'included',
      deliveryFeeAmount: deliveryIncluded === 'included' ? deliveryAmountNum : undefined,
      includeMiscFeeAmount: extraIncluded === 'included',
      miscFeeAmount: extraIncluded === 'included' ? extraAmountNum : undefined,
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

  /**
   * 선택된 딜러를 `{lenderCode, dealerName}`로 푼다(제프 QuoteRevolutionV2.tsx:276-293 미러).
   *
   * 드롭다운 option value는 `lenderCode::dealerName` 합성값이다 — 사별 union이라
   * 딜러명만으로는 어느 lender 것인지 알 수 없고, 딜러명이 겹치는 경우도 있다
   * (예: "모터원"은 우리·메리츠 양쪽에 존재).
   */
  function resolveDealerSelection(idx: 0 | 1 | 2): { lenderCode: string; dealerName: string } | null {
    const s = scenarios[idx]
    if (s.dealerType !== 'input' || !s.dealer) return null
    const sep = s.dealer.indexOf('::')
    if (sep < 0) return null
    return { lenderCode: s.dealer.slice(0, sep), dealerName: s.dealer.slice(sep + 2) }
  }

  const loadings = [q1.isAnyLoading, q2.isAnyLoading, q3.isAnyLoading] as [boolean, boolean, boolean]

  const [selectedQuotesByScenario, setSelectedQuotesByScenario] = useState<
    [SupportedLenderCode[], SupportedLenderCode[], SupportedLenderCode[]]
  >([[], [], []])
  const [showMaxWarningByScenario, setShowMaxWarningByScenario] = useState<
    [boolean, boolean, boolean]
  >([false, false, false])

  const handleCalculate = (idx: 0 | 1 | 2) => {
    const payload = buildPayload(idx)
    if (!payload) return
    // 배치 7 A#14(제프 대비 의도적 이탈): 재조회로 결과 집합이 바뀌면 직전 결과에서 고른 금융사가
    // 새 결과에 없어도 선택이 유령으로 남아 3개 상한·하단 "견적서 보기 (N)" 카운트를 오염했다 —
    // 재조회 시작 시 해당 시나리오의 선택만 클리어한다(다른 시나리오 선택 불변).
    setSelectedQuotesByScenario((prev) => {
      if (prev[idx].length === 0) return prev
      const next = [...prev] as [SupportedLenderCode[], SupportedLenderCode[], SupportedLenderCode[]]
      next[idx] = []
      return next
    })
    void quotes[idx].calculateAll(payload, resolveDealerSelection(idx))
  }

  const totalSelectedCount =
    selectedQuotesByScenario[0].length +
    selectedQuotesByScenario[1].length +
    selectedQuotesByScenario[2].length

  const toggleSelect = (scenarioIdx: 0 | 1 | 2, lenderCode: SupportedLenderCode) => {
    const current = selectedQuotesByScenario[scenarioIdx]
    const isAlreadySelected = current.includes(lenderCode)
    if (!isAlreadySelected && totalSelectedCount >= 3) {
      setShowMaxWarningByScenario((prev) => {
        const next = [...prev] as [boolean, boolean, boolean]
        next[scenarioIdx] = true
        return next
      })
      setTimeout(() => {
        setShowMaxWarningByScenario((prev) => {
          const next = [...prev] as [boolean, boolean, boolean]
          next[scenarioIdx] = false
          return next
        })
      }, 3000)
      return
    }
    setSelectedQuotesByScenario((prev) => {
      const next = [...prev] as [SupportedLenderCode[], SupportedLenderCode[], SupportedLenderCode[]]
      next[scenarioIdx] = isAlreadySelected
        ? current.filter((c) => c !== lenderCode)
        : [...current, lenderCode]
      return next
    })
  }

  // 배치 7 A#5(제프 대비 의도적 이탈): 초기화 리마운트 epoch — ConditionCards key에 편입해
  // 조건 카드 로컬 상태(showResults/querySnapshot/sortType)까지 fresh 마운트로 리셋한다(신규
  // 상태 채널 0 — 가장 값싼 구현). 종전엔 resetAll이 시나리오·결과만 비워 "○○으로 조회 완료"
  // 라벨과 빈 결과가 모순 표시됐고, 기본 조건 그대로는 fingerprint가 스냅샷과 같아 재조회도
  // 불가능했다.
  const [resetEpoch, setResetEpoch] = useState(0)

  const resetAll = () => {
    setScenarios([defaultScenario(), defaultScenario(), defaultScenario()])
    q1.reset()
    q2.reset()
    q3.reset()
    setResetEpoch((n) => n + 1) // A#5 — 카드 로컬 상태 리마운트 리셋
  }

  return (
    <div
      aria-label="비교견적 계산기"
      aria-modal="true"
      role="dialog"
      className="calculator-modal fixed inset-0 z-[400] overflow-y-auto bg-[#f8f9fa] [--radius:0.625rem]
                 font-[ui-sans-serif,_system-ui,_-apple-system,_BlinkMacSystemFont,_'Apple_SD_Gothic_Neo',_sans-serif]
                 [&_label]:font-medium [&_h3]:font-medium [&_button]:font-medium
                 [-webkit-font-smoothing:subpixel-antialiased] [-moz-osx-font-smoothing:auto]"
    >
      {/* Page header — 제프 V2 헤더 미러("검수 페이지" 캡션 대신 닫기 버튼) */}
      <header className="bg-white border-b border-gray-200 px-8 py-5">
        <div className="flex items-center gap-3">
          <h2 className="text-[18px]/[28px] font-semibold text-gray-900">비교견적</h2>
          <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-md text-[12px]/[16px] font-medium">
            리스/렌트
          </span>
          <button
            aria-label="계산기 닫기"
            className="ml-auto flex items-center justify-center w-8 h-8 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            onClick={onClose}
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* kim-jeff-quote-body = 워크벤치 문법 스코프(토큰 --jeff-navy·베이스 입력 스타일 — spec D4).
          패딩은 calculator.css 브릿지가 페이지 여백(32px)으로 오버라이드(unlayered kim 16px가
          Tailwind 유틸을 layer 무관하게 이기므로 명시 규칙 필수). 자식 간 22px 리듬은 kim 소관. */}
      <div className="kim-jeff-quote-body">
        <TopSelectionCards
          catalog={masterCatalog}
          basePrice={basePrice}
          setBasePrice={setBasePrice}
          optionPrice={optionPrice}
          setOptionPrice={setOptionPrice}
          discount={discount}
          setDiscount={setDiscount}
          discountUnit={discountUnit}
          setDiscountUnit={setDiscountUnit}
          discountLines={discountLines}
          onAddDiscountLine={addDiscountLine}
          onRemoveDiscountLine={removeDiscountLine}
          onPatchDiscountLine={patchDiscountLine}
          finalDiscountKrw={rawDiscountKrw}
          taxReduction={taxReduction}
          setTaxReduction={setTaxReduction}
          taxAmount={taxAmount}
          setTaxAmount={setTaxAmount}
          bondIncluded={bondIncluded}
          setBondIncluded={setBondIncluded}
          bondAmount={bondAmount}
          setBondAmount={setBondAmount}
          deliveryIncluded={deliveryIncluded}
          setDeliveryIncluded={setDeliveryIncluded}
          deliveryAmount={deliveryAmount}
          setDeliveryAmount={setDeliveryAmount}
          extraIncluded={extraIncluded}
          setExtraIncluded={setExtraIncluded}
          extraAmount={extraAmount}
          setExtraAmount={setExtraAmount}
          finalVehiclePrice={finalVehiclePrice}
          registrationCost={registrationCost}
          miscCost={miscCost}
          acquisitionCost={acquisitionCost}
          options={{
            basic: optionsState.basic,
            tuning: optionsState.tuning,
            relations: optionsState.relations,
            noOptions: optionsState.noOptions,
            loading: optionsState.loading,
            loaded: optionsState.loaded,
            // 배치 7 A#1(제프 대비 의도적 이탈): fetch 실패 사유 배선 — 종전엔 여기서 유실돼
            // 네트워크 실패가 '옵션 정보 미제공'(데이터 부재 어휘)으로 오표기됐다.
            error: optionsState.error,
          }}
          selectedOptionIds={selectedOptionIds}
          // A#7 — 픽커 [적용] 전체 해제 시 옵션 금액 0 리셋(수신 지점 래퍼)
          setSelectedOptionIds={applyPickedOptionIds}
          colors={{
            exterior: colorsState.exterior,
            interior: colorsState.interior,
            loading: colorsState.loading,
            loaded: colorsState.loaded,
            error: colorsState.error, // A#1 — 옵션과 동일(색상 '…정보 미제공' 오표기 방지)
          }}
          selectedExteriorId={selectedExteriorId}
          setSelectedExteriorId={setSelectedExteriorId}
          selectedInteriorId={selectedInteriorId}
          setSelectedInteriorId={setSelectedInteriorId}
        />

        <ConditionCards
          key={resetEpoch} // A#5 — 초기화 시 카드 로컬 상태(showResults 등) 리마운트 리셋
          scenarios={scenarios}
          setScenarios={setScenarios}
          onCalculate={handleCalculate}
          loadings={loadings}
          isVehicleReady={isVehicleReady}
          basePriceForFeePreview={finalVehiclePrice}
          topLevelFingerprint={topLevelFingerprint}
          dealers={dealers}
          quotes={[q1, q2, q3]}
          leaseTermMonths={[
            parseInt(scenarios[0].period, 10),
            parseInt(scenarios[1].period, 10),
            parseInt(scenarios[2].period, 10),
          ]}
          selectedQuotesByScenario={selectedQuotesByScenario}
          onToggleSelect={toggleSelect}
          showMaxWarningByScenario={showMaxWarningByScenario}
        />
      </div>

      <QuoteBottomBar
        selectedCount={totalSelectedCount}
        onReset={() => {
          resetAll()
          setSelectedQuotesByScenario([[], [], []])
          setShowMaxWarningByScenario([false, false, false])
        }}
        onCheckout={() => showNotice('견적서 PDF 출력은 준비 중입니다')}
      />

      {notice ? (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[410] px-4 py-2 rounded-lg bg-gray-900 text-white text-[13px]/[20px] shadow-lg"
          role="status"
        >
          {notice}
        </div>
      ) : null}
    </div>
  )
}
