// 제프(dolim-solution) components/redesign/TopSelectionCards.tsx 1:1 이식 — UI/마크업/인터랙션 원형 유지.
// CRM 배선 = import 경로만: @/hooks/useMasterCatalog → ./hooks/useMasterCatalog ·
//   @/components/vehicle/* · @/types/catalog → @/components/vehicle-pickers/* (계산기·워크벤치 공용 SSOT —
//   plan: ref/plans/2026-07-16-crm-workbench-picker-dialog-unify.md. ./types는 동일).
// 제프 원형과의 차이 1건: 미사용 로컬 DropdownRow(제프에서도 참조 0인 데드 코드 — 아래 primitives 주석 참조)는
//   CRM lint(@typescript-eslint/no-unused-vars error)가 막아 제거했다. 렌더 출력 무영향.
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md — T3a)
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import { bindSelect } from '@/lib/select-bind'
// 추가 할인 항목명 어휘 = 워크벤치와 공유(순수 상수 — SSOT 통합 전 어휘 정합).
import { discountLabelOptions } from '@/components/customer-detail/quote-workbench-meta'
import type { MasterCatalogState, MasterCatalogActions } from './hooks/useMasterCatalog'
import { BrandPickerDialog, brandLogoUrl } from '@/components/vehicle-pickers/BrandPickerDialog'
import { ModelPickerDialog } from '@/components/vehicle-pickers/ModelPickerDialog'
import { TrimPickerDialog } from '@/components/vehicle-pickers/TrimPickerDialog'
import { OptionPickerDialog } from '@/components/vehicle-pickers/OptionPickerDialog'
import { ColorPickerDialog } from '@/components/vehicle-pickers/ColorPickerDialog'
import type { TrimColor, TrimOption, TrimOptionRelation } from '@/components/vehicle-pickers/catalog-types'
import type { CalcDiscountLine, TaxReductionMode, ToggleIncluded, DiscountUnit } from './types'

/**
 * 비교견적 페이지 상단의 통합 패널 — 차량선택 / 옵션·컬러 / 할인 / 가격 / 취득원가.
 *
 * 디자인은 Figma Make export 의 TopSelectionCards 를 그대로 따르고,
 * 상태는 부모(QuoteRevolutionV2)가 소유하는 controlled 컴포넌트로 변환했습니다.
 *
 * 차량선택은 우리 master catalog 훅(brand→model→trim 3-tier) 에 배선되어
 * 있고, 옵션·컬러 항목은 현 백엔드에 데이터 소스가 없어 placeholder 드롭다운
 * 으로 렌더링합니다. 추후 backend 가 갖춰지면 같은 자리에서 wiring.
 */
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
  options: { basic: TrimOption[]; tuning: TrimOption[]; relations: TrimOptionRelation[]; noOptions: boolean; loading: boolean; loaded: boolean }
  selectedOptionIds: Set<number>
  setSelectedOptionIds: (ids: Set<number>) => void

  colors: { exterior: TrimColor[]; interior: TrimColor[]; loading: boolean; loaded: boolean }
  selectedExteriorId: number | null
  setSelectedExteriorId: (id: number | null) => void
  selectedInteriorId: number | null
  setSelectedInteriorId: (id: number | null) => void
}

const onlyDigits = (raw: string) => raw.replace(/[^0-9]/g, '')

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
  const optionPlaceholder = !c.selectedTrim
    ? '트림 먼저 선택'
    : p.options.loading
    ? '불러오는 중…'
    : p.options.noOptions
    ? '옵션 없음'
    : p.options.loaded && p.options.basic.length === 0 && p.options.tuning.length === 0
    ? '옵션 정보 미제공'
    : '선택 없음'

  const exteriorDisabled = !c.selectedTrim || p.colors.loading || (p.colors.loaded && p.colors.exterior.length === 0)
  const interiorDisabled = !c.selectedTrim || p.colors.loading || (p.colors.loaded && p.colors.interior.length === 0)

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-6">
      {/* ── 상단 3 컬럼: 차량 선택 / 옵션·컬러 / 할인 ── */}
      <div className="grid grid-cols-1 md:grid-cols-3">
        {/* 차량 선택 */}
        <div className="flex flex-col border-r-2 border-gray-200">
          <div className="px-6 py-2 bg-slate-700">
            <h3 className="text-[14px]/[20px] text-white">🚘 차량 선택</h3>
          </div>
          <div className="px-6 flex-1 flex flex-col">
            <div className="space-y-0">
              <PickerRow
                label="제조사"
                hasBorderBelow
                disabled={c.brandsLoading}
                onClick={() => setBrandPickerOpen(true)}
                placeholder={c.brandsLoading ? '불러오는 중…' : '선택 없음'}
              >
                {c.selectedBrand && (
                  <>
                    {brandLogo && (
                      <img
                        src={brandLogo}
                        alt={c.selectedBrand.name}
                        className="w-4 h-4 object-contain shrink-0"
                      />
                    )}
                    <span className="flex-1 truncate text-gray-900">{c.selectedBrand.name}</span>
                  </>
                )}
              </PickerRow>

              <PickerRow
                label="모델"
                hasBorderBelow
                disabled={!c.selectedBrand || c.modelsLoading}
                onClick={() => setModelPickerOpen(true)}
                placeholder={c.modelsLoading ? '불러오는 중…' : '선택 없음'}
              >
                {c.selectedModel && (
                  <>
                    {c.selectedModel.imageUrl && (
                      <img
                        src={c.selectedModel.imageUrl}
                        alt={c.selectedModel.name}
                        className="w-6 h-4 object-contain shrink-0"
                        loading="lazy"
                      />
                    )}
                    <span className="flex-1 truncate text-gray-900">{c.selectedModel.name}</span>
                  </>
                )}
              </PickerRow>

              <PickerRow
                label="트림"
                disabled={!c.selectedModel || c.trimsLoading}
                onClick={() => setTrimPickerOpen(true)}
                placeholder={c.trimsLoading ? '불러오는 중…' : '선택 없음'}
              >
                {c.selectedTrim && (
                  <span className="flex-1 truncate text-gray-900">
                    {c.selectedTrim.trimName ?? c.selectedTrim.name}
                  </span>
                )}
              </PickerRow>
            </div>
          </div>
        </div>

        {/* 옵션 / 컬러 */}
        <div className="flex flex-col border-r-2 border-gray-200">
          <div className="px-6 py-2 bg-slate-700">
            <h3 className="text-[14px]/[20px] text-white">🎨 옵션 / 컬러</h3>
          </div>
          <div className="px-6 flex-1 flex flex-col">
            <div className="space-y-0">
              <PickerRow
                label="옵션"
                disabled={optionDisabled}
                onClick={() => setOptionPickerOpen(true)}
                placeholder={optionPlaceholder}
                hasBorderBelow
              >
                {selectedOptionsCount > 0 && (
                  <span className="flex-1 truncate text-gray-900">
                    {selectedOptionsCount}개 · <span className="font-mono tabular-nums">+{selectedOptionsTotal.toLocaleString('ko-KR')}원</span>
                  </span>
                )}
              </PickerRow>
              <PickerRow
                label="외장"
                disabled={exteriorDisabled}
                onClick={() => setExteriorPickerOpen(true)}
                placeholder={!c.selectedTrim ? '트림 먼저 선택' : p.colors.loading ? '불러오는 중…' : p.colors.loaded && p.colors.exterior.length === 0 ? '외장 색상 정보 미제공' : '선택 없음'}
                hasBorderBelow
              >
                {selectedExterior && (
                  <span className="flex-1 flex items-center gap-2 truncate text-gray-900">
                    <span
                      className="w-4 h-4 rounded-full border border-gray-300 shrink-0"
                      style={{ backgroundColor: selectedExterior.hexValue ?? '#E5E7EB' }}
                    />
                    <span className="truncate">{selectedExterior.name}</span>
                  </span>
                )}
              </PickerRow>
              <PickerRow
                label="내장"
                disabled={interiorDisabled}
                onClick={() => setInteriorPickerOpen(true)}
                placeholder={!c.selectedTrim ? '트림 먼저 선택' : p.colors.loading ? '불러오는 중…' : p.colors.loaded && p.colors.interior.length === 0 ? '내장 색상 정보 미제공' : '선택 없음'}
              >
                {selectedInterior && (
                  <span className="flex-1 flex items-center gap-2 truncate text-gray-900">
                    <span
                      className="w-4 h-4 rounded-full border border-gray-300 shrink-0"
                      style={{ backgroundColor: selectedInterior.hexValue ?? '#E5E7EB' }}
                    />
                    <span className="truncate">{selectedInterior.name}</span>
                  </span>
                )}
              </PickerRow>
            </div>
          </div>
        </div>

        {/* 할인 — 기본 할인 + 추가 할인 행(워크벤치 패리티: [+] 추가·항목명 select·삭제) */}
        <div className="flex flex-col">
          <div className="px-6 py-2 bg-slate-700">
            <h3 className="text-[14px]/[20px] text-white">💰 할인</h3>
          </div>
          <div className="px-6 flex-1 flex flex-col">
            <div className="space-y-0">
              <div className="flex items-center gap-4 py-2 border-b border-gray-200">
                <label className="text-[12px]/[16px] text-gray-500 w-20 flex-shrink-0">기본 할인</label>
                <SegmentedToggle
                  value={p.discountUnit}
                  options={[{ value: 'amount', label: '금액' }, { value: 'percent', label: '%' }]}
                  onChange={(v) => p.setDiscountUnit(v as DiscountUnit)}
                />
                <NumberInput
                  className="ml-auto w-36"
                  value={p.discount}
                  suffix={p.discountUnit === 'amount' ? '원' : '%'}
                  onChange={p.setDiscount}
                />
                <button
                  type="button"
                  aria-label="할인 항목 추가"
                  onClick={p.onAddDiscountLine}
                  className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 flex-shrink-0 text-[14px]/[16px]"
                >
                  +
                </button>
              </div>
              {p.discountLines.map((line) => (
                <div key={line.id} className="flex items-center gap-2 py-2 border-b border-gray-200">
                  <label className="text-[12px]/[16px] text-gray-500 w-14 flex-shrink-0">추가 할인</label>
                  <div className="relative flex-shrink-0">
                    {/* controlled select — Safari 규칙(bindSelect: onChange+onInput 병행) */}
                    <select
                      aria-label="할인 항목명"
                      {...bindSelect(line.label, (v) => p.onPatchDiscountLine(line.id, { label: v }))}
                      className="w-28 py-1 pl-2 pr-6 border border-gray-200 rounded text-[12px]/[16px] bg-white text-gray-900 appearance-none focus:outline-none focus:border-slate-400"
                    >
                      {discountLabelOptions.map((option) => <option key={option}>{option}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                  </div>
                  <SegmentedToggle
                    value={line.unit}
                    options={[{ value: 'amount', label: '금액' }, { value: 'percent', label: '%' }]}
                    onChange={(v) => p.onPatchDiscountLine(line.id, { unit: v as DiscountUnit, amount: '0' })}
                  />
                  <NumberInput
                    className="ml-auto w-28"
                    value={line.amount}
                    suffix={line.unit === 'amount' ? '원' : '%'}
                    onChange={(v) => p.onPatchDiscountLine(line.id, { amount: v })}
                  />
                  <button
                    type="button"
                    aria-label="할인 항목 삭제"
                    onClick={() => p.onRemoveDiscountLine(line.id)}
                    className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 flex-shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── 가격 row: 기본가격 / 옵션 금액 / 최종 할인 ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 border-t border-gray-100 bg-gray-200">
        <PriceCell label="기본 가격"     value={p.basePrice}     onChange={p.setBasePrice} />
        <PriceCell label="(+) 옵션 금액" value={p.optionPrice}   onChange={p.setOptionPrice} />
        {/* 최종 할인 = 기본+추가 행 환산 합 파생(워크벤치 syncDiscountTotalFromRows 미러 — 행 도입으로 표시 전용) */}
        <PriceCell label="(-) 최종 할인" value={String(p.finalDiscountKrw)} onChange={() => {}} last readOnly />
      </div>

      {/* ── 취득원가 설정 + 최종 가격 (2-col grid, 행 공유) ── */}
      <div className="border-t-2 border-white grid grid-cols-2">
        {/* 헤더 */}
        <div className="px-6 py-2 bg-slate-700 border-r-2 border-white">
          <h3 className="text-[14px]/[20px] text-white">⚙️ 취득원가 설정</h3>
        </div>
        <div className="px-6 py-2 bg-slate-700">
          <h3 className="text-[14px]/[20px] text-white">📋 최종 가격</h3>
        </div>

        {/* 취득세 / 최종 차량가 — 직접 입력(manual)만 편집 가능, 나머지 모드는 자동계산 표시(워크벤치 패리티) */}
        <div className="px-6 border-r-2 border-r-white">
          <div className="py-2 flex items-center gap-4 border-b border-gray-200">
            <label className="text-[12px]/[16px] text-gray-500 w-20 flex-shrink-0">취득세</label>
            <SegmentedToggle
              value={p.taxReduction}
              options={[
                { value: 'none',     label: '일반' },
                { value: 'hybrid',   label: '하이브리드 감면' },
                { value: 'electric', label: '전기차 감면' },
                { value: 'manual',   label: '직접 입력' },
              ]}
              onChange={(v) => p.setTaxReduction(v as TaxReductionMode)}
            />
            <NumberInput className="ml-auto w-36" value={p.taxAmount} onChange={p.setTaxAmount} suffix="원" readOnly={p.taxReduction !== 'manual'} />
          </div>
        </div>
        <SummaryCell label="최종 차량가(계산서 발행금액)" value={p.finalVehiclePrice} />

        {/* 공채 / 등록비용 */}
        <div className="px-6 border-r-2 border-r-white">
          <div className="py-2 flex items-center gap-4 border-b border-gray-200">
            <label className="text-[12px]/[16px] text-gray-500 w-20 flex-shrink-0">공채</label>
            <SegmentedToggle
              value={p.bondIncluded}
              options={[{ value: 'included', label: '포함' }, { value: 'excluded', label: '불포함' }]}
              onChange={(v) => p.setBondIncluded(v as ToggleIncluded)}
            />
            <NumberInput className="ml-auto w-36" value={p.bondAmount} onChange={p.setBondAmount} suffix="원" />
          </div>
        </div>
        <SummaryCell label="등록비용(취득원가 포함)" value={p.registrationCost} />

        {/* 탁송료 / 기타비용 */}
        <div className="px-6 border-r-2 border-r-white">
          <div className="py-2 flex items-center gap-4 border-b border-gray-200">
            <label className="text-[12px]/[16px] text-gray-500 w-20 flex-shrink-0">탁송료</label>
            <SegmentedToggle
              value={p.deliveryIncluded}
              options={[{ value: 'included', label: '포함' }, { value: 'excluded', label: '불포함' }]}
              onChange={(v) => p.setDeliveryIncluded(v as ToggleIncluded)}
            />
            <NumberInput className="ml-auto w-36" value={p.deliveryAmount} onChange={p.setDeliveryAmount} suffix="원" />
          </div>
        </div>
        <SummaryCell label="기타비용(취득원가 불포함, 고객 부담)" value={p.miscCost} />

        {/* 부대비용 / 취득원가 */}
        <div className="px-6 border-r-2 border-r-white">
          <div className="py-2 flex items-center gap-4">
            <label className="text-[12px]/[16px] text-gray-500 w-20 flex-shrink-0">부대비용</label>
            <SegmentedToggle
              value={p.extraIncluded}
              options={[{ value: 'included', label: '포함' }, { value: 'excluded', label: '불포함' }]}
              onChange={(v) => p.setExtraIncluded(v as ToggleIncluded)}
            />
            <NumberInput className="ml-auto w-36" value={p.extraAmount} onChange={p.setExtraAmount} suffix="원" />
          </div>
        </div>
        <SummaryCell label="취득원가" value={p.acquisitionCost} emphasized />
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
    </div>
  )
}

/* ─────────── primitives ───────────
   제프 원형에는 여기 native select 기반 DropdownRow가 있었으나 참조 0인 데드 코드였다(픽커 전환 후 잔재).
   CRM lint(no-unused-vars)가 error라 이식에서 제거 — 되살릴 일이 생기면 controlled select이므로
   @/lib/select-bind bindSelect 병행 바인딩 필수(Safari 규칙). */

function SegmentedToggle<T extends string>({
  value, options, onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
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

function NumberInput({
  value, onChange, className = '', suffix = '원', readOnly = false,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  suffix?: string
  readOnly?: boolean
}) {
  return (
    <div className={`relative flex-shrink-0 ${className}`}>
      <input
        type="text"
        value={Number(value || 0).toLocaleString()}
        onChange={(e) => onChange(onlyDigits(e.target.value))}
        readOnly={readOnly}
        className={`w-full py-1 pl-2 pr-6 border border-gray-200 rounded text-[12px]/[16px] text-right
                   focus:outline-none font-mono tabular-nums font-normal ${
          readOnly ? 'bg-gray-50 text-gray-500 cursor-default' : 'bg-white text-gray-900 focus:border-slate-400'
        }`}
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px]/[16px] text-gray-400 pointer-events-none">
        {suffix}
      </span>
    </div>
  )
}

function PriceCell({
  label, value, onChange, last, unit = '원', readOnly = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  last?: boolean
  unit?: string
  readOnly?: boolean
}) {
  return (
    <div className={`px-6 py-2 ${last ? '' : 'border-r-2 border-white'}`}>
      <div className="flex justify-between items-center gap-4">
        <span className="text-[12px]/[16px] text-gray-900 font-bold flex-shrink-0">{label}</span>
        <NumberInput value={value} onChange={onChange} className="w-36" suffix={unit} readOnly={readOnly} />
      </div>
    </div>
  )
}

function SummaryCell({
  label, value, emphasized,
}: {
  label: string
  value: number
  emphasized?: boolean
}) {
  return (
    <div className="px-6 bg-gray-200 flex flex-col">
      <div className="flex-1 flex items-center justify-between border-b border-white">
        <span className="text-[12px]/[16px] font-bold text-gray-800">{label}</span>
        <span className={`font-mono tabular-nums font-normal ${emphasized ? 'text-[16px]/[24px] text-slate-700 font-semibold' : 'text-[14px]/[20px] text-gray-900 font-semibold'}`}>
          {value.toLocaleString()} 원
        </span>
      </div>
    </div>
  )
}

/**
 * 차량 선택 row — 라벨 + 클릭하면 picker 모달 열리는 버튼.
 * (DropdownRow 와 같은 시각 패턴이지만 native select 대신 모달 기반)
 */
function PickerRow({
  label,
  hasBorderBelow,
  disabled,
  onClick,
  placeholder,
  children,
}: {
  label: string
  hasBorderBelow?: boolean
  disabled?: boolean
  onClick: () => void
  placeholder: string
  children?: ReactNode
}) {
  const hasContent = Boolean(children)
  return (
    <div className={`flex items-center gap-4 py-2 ${hasBorderBelow ? 'border-b border-gray-200' : ''}`}>
      <label className="text-[12px]/[16px] text-gray-500 w-20 flex-shrink-0">{label}</label>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="relative flex-1 flex items-center gap-2 py-1 text-[12px]/[16px] text-left
                   disabled:cursor-not-allowed disabled:opacity-60"
      >
        {hasContent ? (
          children
        ) : (
          <span className="flex-1 text-gray-400">{placeholder}</span>
        )}
        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
      </button>
    </div>
  )
}
