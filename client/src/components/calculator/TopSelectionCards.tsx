// 제프(dolim-solution) components/redesign/TopSelectionCards.tsx 이식 → 견적 조건 UI SSOT로 워크벤치
// 문법 수렴(spec: ref/specs/2026-07-16-crm-quote-ui-ssot-design.md — 통합 디자인 기준 = 워크벤치).
//
// 패널 구조 = 워크벤치 상단 패널 그대로: kim-jeff-top-panel > top-grid(차량 선택/옵션·컬러/할인) +
// price-grid + cost-grid(cost-section/summary-section). 행 = quote-fields 공유 프리미티브.
// 카탈로그 배선(useMasterCatalog 캐스케이드)·픽커 다이얼로그 5종·controlled 상태는 원형 그대로
// (행위 변경 0, spec D6). 트리거 행 콘텐츠(브랜드 로고·모델 썸네일·컬러 스와치)는 계산기 쪽이
// 더 풍부한 채로 유지 — 셸 문법(PickerTriggerRow)만 공유(spec D4).
import { useEffect, useMemo, useState } from 'react'
import {
  DiscountLineRow,
  FormRow,
  MoneyField,
  PickerTriggerRow,
  PriceCell,
  SegmentGroup,
  SummaryRow,
  type MoneyInputProps,
} from '@/components/quote-fields/QuoteFields'
import { ACQUISITION_TAX_MODE_LABELS } from '@/components/customer-detail/quote-workbench-meta'
import type { MasterCatalogState, MasterCatalogActions } from './hooks/useMasterCatalog'
import { BrandPickerDialog, brandLogoUrl } from '@/components/vehicle-pickers/BrandPickerDialog'
import { ModelPickerDialog } from '@/components/vehicle-pickers/ModelPickerDialog'
import { TrimPickerDialog } from '@/components/vehicle-pickers/TrimPickerDialog'
import { OptionPickerDialog } from '@/components/vehicle-pickers/OptionPickerDialog'
import { ColorPickerDialog } from '@/components/vehicle-pickers/ColorPickerDialog'
import type { TrimColor, TrimOption, TrimOptionRelation } from '@/components/vehicle-pickers/catalog-types'
import type { CalcDiscountLine, TaxReductionMode, ToggleIncluded, DiscountUnit } from './types'

interface Props {
  catalog: MasterCatalogState & MasterCatalogActions

  // 가격
  basePrice: string
  setBasePrice: (v: string) => void
  optionPrice: string
  setOptionPrice: (v: string) => void
  discount: string
  setDiscount: (v: string) => void
  discountUnit: DiscountUnit
  setDiscountUnit: (v: DiscountUnit) => void
  // 추가 할인 행(워크벤치 패리티) — 최종 할인은 부모 파생(finalDiscountKrw) 표시 전용.
  discountLines: CalcDiscountLine[]
  onAddDiscountLine: () => void
  onRemoveDiscountLine: (id: string) => void
  onPatchDiscountLine: (id: string, patch: Partial<CalcDiscountLine>) => void
  finalDiscountKrw: number

  // 취득원가 입력
  taxReduction: TaxReductionMode
  setTaxReduction: (v: TaxReductionMode) => void
  taxAmount: string
  setTaxAmount: (v: string) => void
  bondIncluded: ToggleIncluded
  setBondIncluded: (v: ToggleIncluded) => void
  bondAmount: string
  setBondAmount: (v: string) => void
  deliveryIncluded: ToggleIncluded
  setDeliveryIncluded: (v: ToggleIncluded) => void
  deliveryAmount: string
  setDeliveryAmount: (v: string) => void
  extraIncluded: ToggleIncluded
  setExtraIncluded: (v: ToggleIncluded) => void
  extraAmount: string
  setExtraAmount: (v: string) => void

  // 계산된 파생값 (parent 가 계산해서 내려줌)
  finalVehiclePrice: number          // 최종 차량가 = base + option - discount
  registrationCost: number           // 등록비용 = 취득세 + 공채(포함시)
  miscCost: number                   // 기타비용 = 탁송료(불포함) + 부대비용(불포함)
  acquisitionCost: number            // 취득원가 = 최종차량가 + 등록비용 + 포함된 비용들

  // 옵션/색상 (Phase 1 — Mr.Cha mirror 통합)
  // error: 배치 7 A#1(제프 대비 의도적 이탈) — useTrimExtras fetch 실패 사유. 종전엔 미배선이라
  // 네트워크 실패가 '옵션 정보 미제공'/'…색상 정보 미제공'(데이터 부재 어휘)으로 오표기됐다.
  options: { basic: TrimOption[]; tuning: TrimOption[]; relations: TrimOptionRelation[]; noOptions: boolean; loading: boolean; loaded: boolean; error: string | null }
  selectedOptionIds: Set<number>
  setSelectedOptionIds: (ids: Set<number>) => void

  colors: { exterior: TrimColor[]; interior: TrimColor[]; loading: boolean; loaded: boolean; error: string | null }
  selectedExteriorId: number | null
  setSelectedExteriorId: (id: number | null) => void
  selectedInteriorId: number | null
  setSelectedInteriorId: (id: number | null) => void
}

const onlyDigits = (raw: string) => raw.replace(/[^0-9]/g, '')

// 취득세 모드 = 계산기 상태 계약(none/hybrid/electric/manual) × 라벨 SSOT zip(워크벤치는 normal/... — spec D2).
const taxModeOptions = (['none', 'hybrid', 'electric', 'manual'] as const).map((value, i) => ({ value, label: ACQUISITION_TAX_MODE_LABELS[i] }))
const includedOptions = [{ value: 'included' as ToggleIncluded, label: '포함' }, { value: 'excluded' as ToggleIncluded, label: '불포함' }]

// controlled 정수 금액 바인딩(제프 NumberInput 의미론 보존 — 콤마 표시 + 숫자만 수용).
function numBinding(value: string, onChange: (v: string) => void): MoneyInputProps {
  return {
    value: Number(value || 0).toLocaleString(),
    onChange: (e) => onChange(onlyDigits(e.currentTarget.value)),
  }
}

export function TopSelectionCards(p: Props) {
  const c = p.catalog

  // ── 차량 선택 모달 picker 상태 ──
  const [brandPickerOpen, setBrandPickerOpen] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [trimPickerOpen, setTrimPickerOpen] = useState(false)
  const [optionPickerOpen, setOptionPickerOpen] = useState(false)
  const [exteriorPickerOpen, setExteriorPickerOpen] = useState(false)
  const [interiorPickerOpen, setInteriorPickerOpen] = useState(false)
  // Cascade tracking — 브랜드 픽 → 모델 로드 → 모델 picker 자동 오픈, 동일 패턴 모델→트림.
  const [brandJustChanged, setBrandJustChanged] = useState(false)
  const [modelJustChanged, setModelJustChanged] = useState(false)

  useEffect(() => {
    if (!brandJustChanged) return
    if (!c.selectedBrand || c.modelsLoading) return
    if (c.models.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브랜드 픽 → 모델 로드 완료 시 모델 픽커 자동 오픈 + 캐스케이드 플래그 소진(제프 원형 미러)
    setModelPickerOpen(true)
    setBrandJustChanged(false)
  }, [brandJustChanged, c.selectedBrand, c.models, c.modelsLoading])

  useEffect(() => {
    if (!modelJustChanged) return
    if (!c.selectedModel || c.trimsLoading) return
    if (c.trims.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 모델 픽 → 트림 로드 완료 시 트림 픽커 자동 오픈 + 캐스케이드 플래그 소진(제프 원형 미러)
    setTrimPickerOpen(true)
    setModelJustChanged(false)
  }, [modelJustChanged, c.selectedModel, c.trims, c.trimsLoading])

  const brandLogo = c.selectedBrand ? brandLogoUrl(c.selectedBrand.name) : null

  const optionMap = useMemo(() => {
    const m = new Map<number, TrimOption>()
    for (const o of [...p.options.basic, ...p.options.tuning]) m.set(o.id, o)
    return m
  }, [p.options.basic, p.options.tuning])

  const selectedOptionsCount = p.selectedOptionIds.size
  const selectedOptionsTotal = useMemo(() => {
    let s = 0
    for (const id of p.selectedOptionIds) s += optionMap.get(id)?.price ?? 0
    return s
  }, [p.selectedOptionIds, optionMap])

  const selectedExterior = p.selectedExteriorId == null
    ? null
    : p.colors.exterior.find((col) => col.id === p.selectedExteriorId) ?? null
  const selectedInterior = p.selectedInteriorId == null
    ? null
    : p.colors.interior.find((col) => col.id === p.selectedInteriorId) ?? null

  const trimDisplayName = c.selectedTrim
    ? `${c.selectedBrand?.name ?? ''} ${c.selectedModel?.name ?? ''} ${c.selectedTrim.trimName ?? c.selectedTrim.name}`.trim()
    : ''

  const optionDisabled = !c.selectedTrim || p.options.loading || (p.options.loaded && (p.options.noOptions || (p.options.basic.length === 0 && p.options.tuning.length === 0)))
  // 배치 7 A#1(제프 대비 의도적 이탈): fetch 실패(error)는 데이터 부재 어휘('옵션 정보 미제공')와
  // 구분해 실패 어휘로 표기 — 미제공/실패가 같은 문구면 장애가 카탈로그 공백으로 위장된다.
  const optionPlaceholder = !c.selectedTrim
    ? '트림 먼저 선택'
    : p.options.loading
    ? '불러오는 중…'
    : p.options.error
    ? '옵션을 불러오지 못했습니다'
    : p.options.noOptions
    ? '옵션 없음'
    : p.options.loaded && p.options.basic.length === 0 && p.options.tuning.length === 0
    ? '옵션 정보 미제공'
    : '선택 없음'

  const exteriorDisabled = !c.selectedTrim || p.colors.loading || (p.colors.loaded && p.colors.exterior.length === 0)
  const interiorDisabled = !c.selectedTrim || p.colors.loading || (p.colors.loaded && p.colors.interior.length === 0)

  return (
    <section className="kim-jeff-top-panel">
      {/* ── 상단 3 컬럼: 차량 선택 / 옵션·컬러 / 할인 ── */}
      <div className="kim-jeff-top-grid">
        {/* 차량 선택 */}
        <div className="kim-jeff-section">
          <h4>🚘 차량 선택</h4>
          <PickerTriggerRow
            label="제조사"
            disabled={c.brandsLoading}
            onClick={() => setBrandPickerOpen(true)}
            bClassName={c.selectedBrand ? '' : 'muted'}
          >
            {c.selectedBrand ? (
              <>
                {brandLogo && (
                  <img src={brandLogo} alt={c.selectedBrand.name} className="inline-block w-4 h-4 object-contain align-[-3px] mr-1.5" />
                )}
                {c.selectedBrand.name}
              </>
            ) : (c.brandsLoading
              ? '불러오는 중…'
              // A#1 — useMasterCatalog.error 소비(종전 소비처 0): 목록 실패를 '선택 없음'과 구분.
              // error는 브랜드/모델/트림 공유 필드라 "해당 목록이 비어 있음"을 함께 확인해 오표기 방지.
              : c.error && c.brands.length === 0
              ? '불러오지 못했습니다'
              : '선택 없음')}
          </PickerTriggerRow>

          <PickerTriggerRow
            label="모델"
            disabled={!c.selectedBrand || c.modelsLoading}
            onClick={() => setModelPickerOpen(true)}
            bClassName={c.selectedModel ? '' : 'muted'}
          >
            {c.selectedModel ? (
              <>
                {c.selectedModel.imageUrl && (
                  <img src={c.selectedModel.imageUrl} alt={c.selectedModel.name} className="inline-block w-6 h-4 object-contain align-[-3px] mr-1.5" loading="lazy" />
                )}
                {c.selectedModel.name}
              </>
            ) : (c.modelsLoading
              ? '불러오는 중…'
              : c.error && c.selectedBrand && c.models.length === 0 // A#1 — 제조사 행과 동일
              ? '불러오지 못했습니다'
              : '선택 없음')}
          </PickerTriggerRow>

          <PickerTriggerRow
            label="트림"
            disabled={!c.selectedModel || c.trimsLoading}
            onClick={() => setTrimPickerOpen(true)}
            bClassName={c.selectedTrim ? '' : 'muted'}
          >
            {c.selectedTrim
              ? (c.selectedTrim.trimName ?? c.selectedTrim.name)
              : (c.trimsLoading
                ? '불러오는 중…'
                : c.error && c.selectedModel && c.trims.length === 0 // A#1 — 제조사 행과 동일
                ? '불러오지 못했습니다'
                : '선택 없음')}
          </PickerTriggerRow>
        </div>

        {/* 옵션 / 컬러 */}
        <div className="kim-jeff-section">
          <h4>🎨 옵션 / 컬러</h4>
          <PickerTriggerRow
            label="옵션"
            disabled={optionDisabled}
            onClick={() => setOptionPickerOpen(true)}
            bClassName={selectedOptionsCount > 0 ? '' : 'muted'}
          >
            {selectedOptionsCount > 0
              ? `${selectedOptionsCount}개 · +${selectedOptionsTotal.toLocaleString('ko-KR')}원`
              : optionPlaceholder}
          </PickerTriggerRow>
          <PickerTriggerRow
            label="외장"
            disabled={exteriorDisabled}
            onClick={() => setExteriorPickerOpen(true)}
            bClassName={selectedExterior ? 'kim-color-picker-value' : 'muted'}
          >
            {selectedExterior ? (
              <>
                <span className="kim-color-picker-swatch" style={{ background: selectedExterior.hexValue ?? '#E5E7EB' }} />
                {selectedExterior.name}
              </>
            ) : (!c.selectedTrim ? '트림 먼저 선택' : p.colors.loading ? '불러오는 중…' : p.colors.error ? '색상을 불러오지 못했습니다' : p.colors.loaded && p.colors.exterior.length === 0 ? '외장 색상 정보 미제공' : '선택 없음')}
          </PickerTriggerRow>
          <PickerTriggerRow
            label="내장"
            disabled={interiorDisabled}
            onClick={() => setInteriorPickerOpen(true)}
            bClassName={selectedInterior ? 'kim-color-picker-value' : 'muted'}
          >
            {selectedInterior ? (
              <>
                <span className="kim-color-picker-swatch" style={{ background: selectedInterior.hexValue ?? '#E5E7EB' }} />
                {selectedInterior.name}
              </>
            ) : (!c.selectedTrim ? '트림 먼저 선택' : p.colors.loading ? '불러오는 중…' : p.colors.error ? '색상을 불러오지 못했습니다' : p.colors.loaded && p.colors.interior.length === 0 ? '내장 색상 정보 미제공' : '선택 없음')}
          </PickerTriggerRow>
        </div>

        {/* 할인 — 기본 할인 + 추가 할인 행(워크벤치와 같은 DiscountLineRow) */}
        <div className="kim-jeff-section">
          <h4>💰 할인</h4>
          {/* 배치 7 C#4 각주 — 단위 전환 의미론(의도 박제, 코드 변경 없음):
              기본 할인 = 값 유지(단위 재해석: 500 원 ↔ 500 %) — 제프 원형 byte-일치 보존 의도.
              워크벤치 convertDiscountInputUnit의 등가 환산과 다르다(D1 — 표현 계층만 공유). */}
          <DiscountLineRow
            label="기본 할인"
            unit={p.discountUnit}
            onUnitChange={p.setDiscountUnit}
            inputProps={numBinding(p.discount, p.setDiscount)}
            action={{ kind: 'add', onClick: p.onAddDiscountLine }}
          />
          {p.discountLines.map((line) => (
            <DiscountLineRow
              key={line.id}
              label="추가 할인"
              labelSelect={{ value: line.label, onSelect: (v) => p.onPatchDiscountLine(line.id, { label: v }) }}
              unit={line.unit}
              // C#4 각주 ② — 추가 행 = {unit, amount:'0'} 리셋: 제프(값 유지)와도 다른 CRM 선택(단위
              // 재해석 오폭 방지 — 예. 5,000,000원 → % 전환 시 500만%로 읽히는 사고 차단).
              onUnitChange={(unit) => p.onPatchDiscountLine(line.id, { unit, amount: '0' })}
              inputProps={numBinding(line.amount, (v) => p.onPatchDiscountLine(line.id, { amount: v }))}
              action={{ kind: 'remove', onClick: () => p.onRemoveDiscountLine(line.id) }}
            />
          ))}
        </div>
      </div>

      {/* ── 가격 row: 기본가격 / 옵션 금액 / 최종 할인 ── */}
      <div className="kim-jeff-price-grid">
        <PriceCell label="기본 가격" inputProps={numBinding(p.basePrice, p.setBasePrice)} />
        <PriceCell label="(+) 옵션 금액" inputProps={numBinding(p.optionPrice, p.setOptionPrice)} />
        {/* 최종 할인 = 기본+추가 행 환산 합 파생(워크벤치 syncDiscountTotalFromRows 미러 — 표시 전용) */}
        <PriceCell label="(-) 최종 할인" inputProps={{ value: p.finalDiscountKrw.toLocaleString(), readOnly: true }} />
      </div>

      {/* ── 취득원가 설정 + 최종 가격 ── */}
      <div className="kim-jeff-cost-grid">
        <div className="kim-jeff-section kim-jeff-cost-section">
          <h4>⚙️ 취득원가 설정</h4>
          {/* 취득세 — 직접 입력(manual)만 편집, 나머지 모드는 자동계산 표시(워크벤치 패리티 #264) */}
          <FormRow label="취득세" className="kim-jeff-acquisition-tax-row">
            <SegmentGroup value={p.taxReduction} options={taxModeOptions} onSelect={p.setTaxReduction} />
            <MoneyField suffix="원" inputProps={{ ...numBinding(p.taxAmount, p.setTaxAmount), readOnly: p.taxReduction !== 'manual' }} />
          </FormRow>
          <FormRow label="공채" className="kim-jeff-cost-toggle-row">
            <SegmentGroup value={p.bondIncluded} options={includedOptions} onSelect={p.setBondIncluded} />
            <MoneyField suffix="원" inputProps={numBinding(p.bondAmount, p.setBondAmount)} />
          </FormRow>
          <FormRow label="탁송료" className="kim-jeff-cost-toggle-row">
            <SegmentGroup value={p.deliveryIncluded} options={includedOptions} onSelect={p.setDeliveryIncluded} />
            <MoneyField suffix="원" inputProps={numBinding(p.deliveryAmount, p.setDeliveryAmount)} />
          </FormRow>
          <FormRow label="부대비용" className="kim-jeff-cost-toggle-row">
            <SegmentGroup value={p.extraIncluded} options={includedOptions} onSelect={p.setExtraIncluded} />
            <MoneyField suffix="원" inputProps={numBinding(p.extraAmount, p.setExtraAmount)} />
          </FormRow>
        </div>
        <div className="kim-jeff-section kim-jeff-summary-section">
          <h4>📋 최종 가격</h4>
          <SummaryRow label="최종 차량가(계산서 발행금액)" value={p.finalVehiclePrice.toLocaleString()} />
          <SummaryRow label="등록비용(취득원가 포함)" value={p.registrationCost.toLocaleString()} />
          <SummaryRow label="기타비용(취득원가 불포함, 고객 부담)" value={p.miscCost.toLocaleString()} className="no-divider" />
          <SummaryRow label="취득원가" value={p.acquisitionCost.toLocaleString()} className="emphasized" />
        </div>
      </div>

      {/* ── 차량선택 모달 picker (master 카탈로그 전용, 기존 페이지와 동일) ── */}
      <BrandPickerDialog
        open={brandPickerOpen}
        brands={c.brands}
        selectedBrandCode={c.selectedBrand?.brandCode ?? null}
        onSelect={(code) => {
          void c.selectBrand(code)
          setBrandJustChanged(true)
          setBrandPickerOpen(false)
        }}
        onClose={() => setBrandPickerOpen(false)}
      />
      <ModelPickerDialog
        open={modelPickerOpen}
        models={c.models}
        selectedModelCode={c.selectedModel?.modelCode ?? null}
        loading={c.modelsLoading}
        brandName={c.selectedBrand?.name ?? null}
        onSelect={(code) => {
          void c.selectModel(code)
          setModelJustChanged(true)
          setModelPickerOpen(false)
        }}
        onClose={() => setModelPickerOpen(false)}
      />
      <TrimPickerDialog
        open={trimPickerOpen}
        trims={c.trims}
        selectedMcCode={c.selectedTrim?.mcCode ?? null}
        loading={c.trimsLoading}
        brandName={c.selectedBrand?.name ?? null}
        modelName={c.selectedModel?.name ?? null}
        accordion={false}
        onSelect={(mc) => {
          c.selectTrim(mc)
          setTrimPickerOpen(false)
        }}
        onClose={() => setTrimPickerOpen(false)}
      />
      <OptionPickerDialog
        open={optionPickerOpen}
        onClose={() => setOptionPickerOpen(false)}
        basic={p.options.basic}
        tuning={p.options.tuning}
        relations={p.options.relations}
        selectedIds={p.selectedOptionIds}
        onApply={p.setSelectedOptionIds}
        trimDisplayName={trimDisplayName}
      />
      <ColorPickerDialog
        open={exteriorPickerOpen}
        onClose={() => setExteriorPickerOpen(false)}
        title="외장 색상 선택"
        colors={p.colors.exterior}
        selectedId={p.selectedExteriorId}
        onApply={(id) => {
          p.setSelectedExteriorId(id)
          setExteriorPickerOpen(false)
        }}
      />
      <ColorPickerDialog
        open={interiorPickerOpen}
        onClose={() => setInteriorPickerOpen(false)}
        title="내장 색상 선택"
        colors={p.colors.interior}
        selectedId={p.selectedInteriorId}
        onApply={(id) => {
          p.setSelectedInteriorId(id)
          setInteriorPickerOpen(false)
        }}
      />
    </section>
  )
}
