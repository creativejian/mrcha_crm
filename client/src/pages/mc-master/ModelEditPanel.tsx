import { useState } from "react";

import { MODEL_CATEGORIES, VEHICLE_STATUSES, type VehicleStatus, statusLabel } from "@/data/vehicle-taxonomy";
import type { CatalogModel } from "@/lib/catalog";
import { EditDrawer } from "./EditDrawer";

// model=null → 추가 모드, model 있음 → 수정 모드(이름 RO, category·status만).
export function ModelEditPanel({
  model,
  onClose,
  onSubmit,
  busy,
  error,
}: {
  model: CatalogModel | null;
  onClose: () => void;
  onSubmit: (values: { name: string; category: string | null; status: VehicleStatus }) => void;
  busy: boolean;
  error: string | null;
}) {
  const isEdit = model !== null;
  const [name, setName] = useState(model?.name ?? "");
  const [category, setCategory] = useState(model?.category ?? "");
  const [status, setStatus] = useState<VehicleStatus>(model?.status ?? "판매중");

  const canSubmit = isEdit || name.trim().length > 0;
  const label = isEdit ? "모델 수정" : "모델 추가";

  return (
    <EditDrawer title={label} ariaLabel={label} onClose={onClose}>
      <label className="va-field">
        <span>모델명{isEdit ? " (수정 불가)" : " *"}</span>
        <input
          className="input"
          value={name}
          disabled={isEdit}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="예: 5 Series"
        />
      </label>
      <label className="va-field">
        <span>카테고리</span>
        <select className="select" value={category} onChange={(e) => setCategory(e.currentTarget.value)}>
          <option value="">미분류</option>
          {MODEL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="va-field">
        <span>상태</span>
        <select className="select" value={status} onChange={(e) => setStatus(e.currentTarget.value as VehicleStatus)}>
          {VEHICLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </label>
      {status === "단종" && isEdit && model?.status !== "단종" && (
        <div className="notice-box">
          <span>단종 처리 시 하위 트림도 모두 단종됩니다.</span>
        </div>
      )}
      {error && <div className="notice-box error">{error}</div>}
      <div className="va-form-actions">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          취소
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!canSubmit || busy}
          onClick={() => onSubmit({ name: name.trim(), category: category || null, status })}
        >
          {busy ? "저장 중…" : "저장"}
        </button>
      </div>
    </EditDrawer>
  );
}
