// 견적 워크벤치 차량/옵션/컬러 트리거 행 + 공용 픽커 다이얼로그(vehicle-pickers/) 배선.
// 구 인라인 드롭다운 3종(VehiclePicker·OptionPicker·ColorPicker)을 계산기(#262)와 같은 모달
// 다이얼로그 방식으로 교체한 것 — 트리거 행 마크업(kim-jeff-picker-row 계열)·부모 상태 계약은
// 구 컴포넌트 그대로 보존한다(plan: ref/plans/2026-07-16-crm-workbench-picker-dialog-unify.md).
//
// onChange 의미론(구 VehiclePicker 계약 유지 — applyTrimToPricing이 이 전제로 짜여 있다):
//   드롭다운/다이얼로그 직접 선택은 trimDetail을 동봉하지 않는다 → 소비자가 fetchTrimDetail 폴백.
//   번들 trimDetail 동봉은 수정 진입(initialTrimId) 마운트 복원 경로만.
import { useEffect, useMemo, useState } from "react";

import { PickerTriggerRow } from "@/components/quote-fields/QuoteFields";
import { BrandPickerDialog } from "@/components/vehicle-pickers/BrandPickerDialog";
import { ModelPickerDialog } from "@/components/vehicle-pickers/ModelPickerDialog";
import { TrimPickerDialog } from "@/components/vehicle-pickers/TrimPickerDialog";
import { OptionPickerDialog } from "@/components/vehicle-pickers/OptionPickerDialog";
import { ColorPickerDialog } from "@/components/vehicle-pickers/ColorPickerDialog";
import { toMasterBrand, toMasterModel, toMasterTrim, trimMcCodeKey } from "@/components/vehicle-pickers/catalog-adapters";
import { optionTotal } from "@/lib/option-selection";
import { formatMoney } from "@/lib/quote-pricing";
import { fetchBrands, fetchModels, fetchTrims, type Brand, type Model, type Trim, type TrimColor, type TrimDetail, type TrimOption, type TrimOptionRelation } from "@/lib/vehicles";
import { fetchWorkbenchVehicleCached } from "@/lib/vehicles-cache";

export type VehicleSelection = { brand?: Brand; model?: Model; trim?: Trim; trimDetail?: TrimDetail };

type Level = "brand" | "model" | "trim";

export function WorkbenchVehiclePicker({ initialTrimId, onChange }: { initialTrimId?: number; onChange?: (selection: VehicleSelection) => void }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [trims, setTrims] = useState<Trim[]>([]);
  const [brand, setBrand] = useState<Brand>();
  const [model, setModel] = useState<Model>();
  const [trim, setTrim] = useState<Trim>();
  const [openDialog, setOpenDialog] = useState<Level | null>(null);
  // 초기값을 "brand"로 둬서 마운트 effect 안에서 동기 setState(set-state-in-effect)를 피한다.
  const [loading, setLoading] = useState<Level | null>("brand");

  useEffect(() => {
    let cancelled = false;
    // 신규: 브랜드 목록만 로드.
    if (initialTrimId == null) {
      fetchBrands()
        .then((data) => { if (!cancelled) setBrands(data); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(null); });
      return () => { cancelled = true; };
    }
    // 수정모드: trimId → trim 상세(ancestry)로 brand/model/trim과 목록을 복원.
    // loading 초기값이 이미 "brand"라 동기 setState 없이 로딩 표시가 유지된다(set-state-in-effect 회피).
    (async () => {
      try {
        const { brands: brandList, models: modelList, trims: trimList, trimDetail } = await fetchWorkbenchVehicleCached(initialTrimId);
        if (cancelled) return;
        setBrands(brandList);
        setModels(modelList);
        setTrims(trimList);
        const b = brandList.find((x) => x.id === trimDetail.brandId);
        const m = modelList.find((x) => x.id === trimDetail.modelId);
        const t = trimList.find((x) => x.id === trimDetail.id);
        if (b) setBrand(b);
        if (m) setModel(m);
        if (t) setTrim(t);
        if (b && m && t) onChange?.({ brand: b, model: m, trim: t, trimDetail });
      } catch {
        // 복원 실패 시 빈 픽커 유지 — 행 클릭으로 처음부터 선택 가능(구 VehiclePicker의 에러 메뉴 대응).
      } finally {
        if (!cancelled) setLoading(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트/initialTrimId 변경 시 1회 복원. onChange는 의도적 제외(부모 재생성 시 재실행 방지).
  }, [initialTrimId]);

  function selectBrand(next: Brand) {
    setBrand(next);
    setModel(undefined);
    setTrim(undefined);
    setModels([]);
    setTrims([]);
    setOpenDialog(null);
    onChange?.({ brand: next });
    setLoading("model");
    fetchModels(next.id)
      .then((data) => {
        setModels(data);
        // 계산기 캐스케이드 미러: 모델 로드 완료 시 모델 다이얼로그 자동 오픈(0건이면 열지 않음).
        if (data.length > 0) setOpenDialog("model");
      })
      .catch(() => {})
      .finally(() => setLoading(null));
  }

  function selectModel(next: Model) {
    setModel(next);
    setTrim(undefined);
    setTrims([]);
    setOpenDialog(null);
    onChange?.({ brand, model: next });
    setLoading("trim");
    fetchTrims(next.id)
      .then((data) => {
        setTrims(data);
        if (data.length > 0) setOpenDialog("trim");
      })
      .catch(() => {})
      .finally(() => setLoading(null));
  }

  function selectTrim(next: Trim) {
    setTrim(next);
    setOpenDialog(null);
    // 다이얼로그 직접 선택(신규·수정 모드 공통)은 trimDetail을 동봉하지 않는다 → 소비자가 fetchTrimDetail로 폴백(applyTrimToPricing). 번들 trimDetail 동봉은 수정 진입 마운트 경로만.
    onChange?.({ brand, model, trim: next });
  }

  const masterBrands = useMemo(() => brands.map(toMasterBrand), [brands]);
  const masterModels = useMemo(() => models.map(toMasterModel), [models]);
  // 워크벤치는 mcCode 없는 트림도 수기 견적 대상이라 선택을 막지 않는다(quotable 오버라이드 —
  // 계산기의 "잔가 데이터 없음" disabled 게이트는 솔루션 계산 전제. plan 함정 7, 구 VehiclePicker 행위 보존).
  const masterTrims = useMemo(() => trims.map((t) => ({ ...toMasterTrim(t), quotable: true })), [trims]);

  const editLoading = initialTrimId != null && loading != null && !brand;

  return (
    <div className="kim-vehicle-picker">
      <div className="kim-vehicle-picker-anchor">
        <PickerTriggerRow label="제조사" onClick={() => setOpenDialog("brand")} bClassName={brand ? "" : "muted"}>
          {editLoading ? <span className="kim-vehicle-skeleton" /> : (brand?.name ?? "선택")}
        </PickerTriggerRow>
      </div>

      <div className="kim-vehicle-picker-anchor">
        <PickerTriggerRow label="모델" disabled={!brand} onClick={() => setOpenDialog("model")} bClassName={model ? "" : "muted"}>
          {editLoading ? <span className="kim-vehicle-skeleton" /> : (model?.name ?? "선택")}
        </PickerTriggerRow>
      </div>

      <div className="kim-vehicle-picker-anchor">
        <PickerTriggerRow label="트림" disabled={!model} onClick={() => setOpenDialog("trim")} bClassName={trim ? "" : "muted"}>
          {editLoading ? <span className="kim-vehicle-skeleton" /> : (trim ? trim.trimName ?? trim.name : "선택")}
        </PickerTriggerRow>
      </div>

      <BrandPickerDialog
        open={openDialog === "brand"}
        brands={masterBrands}
        selectedBrandCode={brand?.id ?? null}
        onSelect={(code) => {
          const picked = brands.find((b) => b.id === code);
          if (picked) selectBrand(picked);
        }}
        onClose={() => setOpenDialog(null)}
      />
      <ModelPickerDialog
        open={openDialog === "model"}
        models={masterModels}
        selectedModelCode={model?.id ?? null}
        loading={loading === "model"}
        brandName={brand?.name ?? null}
        onSelect={(code) => {
          const picked = models.find((m) => m.id === code);
          if (picked) selectModel(picked);
        }}
        onClose={() => setOpenDialog(null)}
      />
      <TrimPickerDialog
        open={openDialog === "trim"}
        trims={masterTrims}
        selectedMcCode={trim ? trimMcCodeKey(trim) : null}
        loading={loading === "trim"}
        brandName={brand?.name ?? null}
        modelName={model?.name ?? null}
        accordion={false}
        onSelect={(mcCode) => {
          const picked = trims.find((t) => trimMcCodeKey(t) === mcCode);
          if (picked) selectTrim(picked);
        }}
        onClose={() => setOpenDialog(null)}
      />
    </div>
  );
}

type WorkbenchOptionPickerProps = {
  options: TrimOption[];
  relations: TrimOptionRelation[];
  // 구 OptionPicker(initialSelectedIds + 내부 state)와 달리 controlled — 다이얼로그가 열림 시점에
  // 부모 선택값을 로컬 시드하고 [적용]에서만 onChange가 발화한다(취소 시 부모 불변).
  selectedIds: number[];
  trimLabel: string;
  onChange?: (next: { selectedIds: number[]; total: number }) => void;
};

export function WorkbenchOptionPicker({ options, relations, selectedIds, trimLabel, onChange }: WorkbenchOptionPickerProps) {
  const [open, setOpen] = useState(false);

  const total = optionTotal(options, new Set(selectedIds));
  const selectedCount = options.filter((o) => selectedIds.includes(o.id)).length;

  return (
    <div className="kim-option-picker">
      <PickerTriggerRow label="옵션" disabled={!options.length} onClick={() => setOpen(true)} bClassName={selectedCount ? "" : "muted"}>
        {selectedCount ? `${selectedCount}개 선택` : "선택"}
        {total > 0 ? ` · +${formatMoney(total)}원` : ""}
      </PickerTriggerRow>
      <OptionPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        basic={options.filter((o) => o.type === "basic")}
        tuning={options.filter((o) => o.type === "tuning")}
        relations={relations}
        selectedIds={new Set(selectedIds)}
        onApply={(ids) => onChange?.({ selectedIds: [...ids], total: optionTotal(options, ids) })}
        trimDisplayName={trimLabel}
      />
    </div>
  );
}

type WorkbenchColorPickerProps = {
  colorType: "exterior" | "interior";
  colors: TrimColor[];
  value: TrimColor | null;
  // null = 해제(다이얼로그에서 선택된 색상 재클릭 — 구 ColorPicker에 없던 토글 의미론, 계산기 UX 미러).
  onChange?: (color: TrimColor | null) => void;
};

export function WorkbenchColorPicker({ colorType, colors, value, onChange }: WorkbenchColorPickerProps) {
  const [open, setOpen] = useState(false);

  const items = useMemo(
    () => colors.filter((c) => c.colorType === colorType).sort((a, b) => a.sortOrder - b.sortOrder),
    [colors, colorType],
  );
  const label = colorType === "exterior" ? "외장" : "내장";

  return (
    <div className="kim-color-picker">
      <PickerTriggerRow label={label} disabled={!items.length} onClick={() => setOpen(true)} bClassName={value ? "kim-color-picker-value" : "muted"}>
        {value ? (
          <>
            <span className="kim-color-picker-swatch" style={{ background: value.hexValue ?? "transparent" }} />
            {value.name}
          </>
        ) : (
          "미선택"
        )}
      </PickerTriggerRow>
      <ColorPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`${label} 색상 선택`}
        colors={items}
        selectedId={value?.id ?? null}
        onApply={(id) => {
          onChange?.(id == null ? null : items.find((c) => c.id === id) ?? null);
          setOpen(false);
        }}
      />
    </div>
  );
}
