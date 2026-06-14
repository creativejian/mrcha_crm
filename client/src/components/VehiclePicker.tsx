import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { fetchBrands, fetchModels, fetchTrims, type Brand, type Model, type Trim } from "@/lib/vehicles";

export type VehicleSelection = { brand?: Brand; model?: Model; trim?: Trim };

type Level = "brand" | "model" | "trim";

export function VehiclePicker({ onChange }: { onChange?: (selection: VehicleSelection) => void }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [trims, setTrims] = useState<Trim[]>([]);
  const [brand, setBrand] = useState<Brand>();
  const [model, setModel] = useState<Model>();
  const [trim, setTrim] = useState<Trim>();
  const [open, setOpen] = useState<Level | null>(null);
  const [loading, setLoading] = useState<Level | null>(null);
  const [errored, setErrored] = useState<Level | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading("brand");
    setErrored(null);
    fetchBrands()
      .then((data) => setBrands(data))
      .catch(() => setErrored("brand"))
      .finally(() => setLoading(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

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
