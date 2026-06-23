import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useOutsideClick } from "@/lib/useOutsideClick";
import { fetchBrands, fetchModels, fetchTrims, fetchTrimDetail, type Brand, type Model, type Trim } from "@/lib/vehicles";

export type VehicleSelection = { brand?: Brand; model?: Model; trim?: Trim };

type Level = "brand" | "model" | "trim";

export function VehiclePicker({ initialTrimId, onChange }: { initialTrimId?: number; onChange?: (selection: VehicleSelection) => void }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [trims, setTrims] = useState<Trim[]>([]);
  const [brand, setBrand] = useState<Brand>();
  const [model, setModel] = useState<Model>();
  const [trim, setTrim] = useState<Trim>();
  const [open, setOpen] = useState<Level | null>(null);
  // 초기값을 "brand"로 둬서 마운트 effect 안에서 동기 setState(set-state-in-effect)를 피한다.
  const [loading, setLoading] = useState<Level | null>("brand");
  const [errored, setErrored] = useState<Level | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // 신규: 브랜드 목록만 로드.
    if (initialTrimId == null) {
      fetchBrands()
        .then((data) => { if (!cancelled) setBrands(data); })
        .catch(() => { if (!cancelled) setErrored("brand"); })
        .finally(() => { if (!cancelled) setLoading(null); });
      return () => { cancelled = true; };
    }
    // 수정모드: trimId → trim 상세(ancestry)로 brand/model/trim과 목록을 복원.
    // loading 초기값이 이미 "brand"라 동기 setState 없이 로딩 표시가 유지된다(set-state-in-effect 회피).
    (async () => {
      try {
        const detail = await fetchTrimDetail(initialTrimId);
        const [brandList, modelList, trimList] = await Promise.all([
          fetchBrands(),
          fetchModels(detail.brandId),
          fetchTrims(detail.modelId),
        ]);
        if (cancelled) return;
        setBrands(brandList);
        setModels(modelList);
        setTrims(trimList);
        const b = brandList.find((x) => x.id === detail.brandId);
        const m = modelList.find((x) => x.id === detail.modelId);
        const t = trimList.find((x) => x.id === detail.id);
        if (b) setBrand(b);
        if (m) setModel(m);
        if (t) setTrim(t);
        if (b && m && t) onChange?.({ brand: b, model: m, trim: t });
      } catch {
        if (!cancelled) setErrored("brand");
      } finally {
        if (!cancelled) setLoading(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트/initialTrimId 변경 시 1회 복원. onChange는 의도적 제외(부모 재생성 시 재실행 방지).
  }, [initialTrimId]);

  useOutsideClick(rootRef, open !== null, () => setOpen(null));

  function selectBrand(next: Brand) {
    setBrand(next);
    setModel(undefined);
    setTrim(undefined);
    setModels([]);
    setTrims([]);
    setOpen(null);
    setErrored(null);
    onChange?.({ brand: next });
    setLoading("model");
    fetchModels(next.id)
      .then((data) => setModels(data))
      .catch(() => setErrored("model"))
      .finally(() => setLoading(null));
  }

  function selectModel(next: Model) {
    setModel(next);
    setTrim(undefined);
    setTrims([]);
    setOpen(null);
    setErrored(null);
    onChange?.({ brand, model: next });
    setLoading("trim");
    fetchTrims(next.id)
      .then((data) => setTrims(data))
      .catch(() => setErrored("trim"))
      .finally(() => setLoading(null));
  }

  function selectTrim(next: Trim) {
    setTrim(next);
    setOpen(null);
    onChange?.({ brand, model, trim: next });
  }

  function renderMenu(level: Level, items: { id: number; label: string }[], onPick: (id: number) => void) {
    if (open !== level) return null;
    if (loading === level) {
      return (
        <div className="kim-vehicle-picker-menu">
          <span className="kim-vehicle-picker-msg">불러오는 중…</span>
        </div>
      );
    }
    if (errored === level) {
      return (
        <div className="kim-vehicle-picker-menu">
          <span className="kim-vehicle-picker-msg">불러오기 실패</span>
        </div>
      );
    }
    return (
      <div className="kim-vehicle-picker-menu" role="listbox">
        {items.map((item) => (
          <button key={item.id} className="kim-vehicle-picker-option" type="button" onClick={() => onPick(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="kim-vehicle-picker" ref={rootRef}>
      <div className="kim-vehicle-picker-anchor">
        <button className="kim-jeff-picker-row" type="button" onClick={() => setOpen(open === "brand" ? null : "brand")}>
          <span>제조사</span>
          <b className={brand ? "" : "muted"}>{brand?.name ?? "선택"}</b>
          <ChevronDown size={15} />
        </button>
        {renderMenu(
          "brand",
          brands.map((b) => ({ id: b.id, label: b.name })),
          (id) => {
            const picked = brands.find((b) => b.id === id);
            if (picked) selectBrand(picked);
          },
        )}
      </div>

      <div className="kim-vehicle-picker-anchor">
        <button className="kim-jeff-picker-row" type="button" disabled={!brand} onClick={() => setOpen(open === "model" ? null : "model")}>
          <span>모델</span>
          <b className={model ? "" : "muted"}>{model?.name ?? "선택"}</b>
          <ChevronDown size={15} />
        </button>
        {renderMenu(
          "model",
          models.map((m) => ({ id: m.id, label: m.name })),
          (id) => {
            const picked = models.find((m) => m.id === id);
            if (picked) selectModel(picked);
          },
        )}
      </div>

      <div className="kim-vehicle-picker-anchor">
        <button className="kim-jeff-picker-row" type="button" disabled={!model} onClick={() => setOpen(open === "trim" ? null : "trim")}>
          <span>트림</span>
          <b className={trim ? "" : "muted"}>{trim ? trim.trimName ?? trim.name : "선택"}</b>
          <ChevronDown size={15} />
        </button>
        {renderMenu(
          "trim",
          trims.map((t) => ({ id: t.id, label: t.trimName ?? t.name })),
          (id) => {
            const picked = trims.find((t) => t.id === id);
            if (picked) selectTrim(picked);
          },
        )}
      </div>
    </div>
  );
}
