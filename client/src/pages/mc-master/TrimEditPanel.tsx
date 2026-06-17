import { useState } from "react";
import { X } from "lucide-react";

import {
  DRIVE_SYSTEMS,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
  VEHICLE_STATUSES,
  type VehicleStatus,
  statusLabel,
} from "@/data/vehicle-taxonomy";
import type { CatalogTrim, TrimInput } from "@/lib/catalog";

const num = (s: string): number | null => {
  const n = Number(s.replace(/[^0-9]/g, ""));
  return s.trim() === "" || Number.isNaN(n) ? null : n;
};

// 천단위 콤마 포맷(입력 중 그룹핑). 저장 시엔 num()이 콤마를 제거한다.
const formatThousands = (s: string): string => {
  const digits = s.replace(/[^0-9]/g, "");
  return digits === "" ? "" : Number(digits).toLocaleString();
};

const won = (v: number | null): string => (v != null ? v.toLocaleString() : "");

export function TrimEditPanel({
  trim,
  onClose,
  onSubmit,
  busy,
  error,
}: {
  trim: CatalogTrim | null;
  onClose: () => void;
  onSubmit: (values: TrimInput) => void;
  busy: boolean;
  error: string | null;
}) {
  const isEdit = trim !== null;
  const [trimName, setTrimName] = useState(trim?.trimName ?? "");
  const [price, setPrice] = useState(trim ? trim.price.toLocaleString() : "");
  const [modelYear, setModelYear] = useState(String(trim?.modelYear ?? 2026));
  const [fuelType, setFuelType] = useState(trim?.fuelType ?? "가솔린");
  const [driveSystem, setDriveSystem] = useState(trim?.driveSystem ?? "FWD");
  const [transmissionType, setTransmissionType] = useState(trim?.transmissionType ?? "A/T");
  const [displacementCc, setDisplacementCc] = useState(trim?.displacementCc != null ? String(trim.displacementCc) : "");
  const [bodyStyle, setBodyStyle] = useState(trim?.bodyStyle ?? "");
  const [seatingCapacity, setSeatingCapacity] = useState(
    trim?.seatingCapacity != null ? String(trim.seatingCapacity) : "",
  );
  const [status, setStatus] = useState<VehicleStatus>(trim?.status ?? "판매중");
  const [financialDiscount, setFinancialDiscount] = useState(won(trim?.financialDiscountAmount ?? null));
  const [partnerDiscount, setPartnerDiscount] = useState(won(trim?.partnerDiscountAmount ?? null));
  const [cashDiscount, setCashDiscount] = useState(won(trim?.cashDiscountAmount ?? null));

  const priceNum = num(price);
  const yearNum = num(modelYear);
  const canSubmit = trimName.trim().length > 0 && priceNum != null && yearNum != null;

  return (
    <div className="customer-detail-drawer-overlay" role="presentation">
      <button type="button" aria-label="패널 닫기" className="customer-detail-drawer-backdrop" onClick={onClose} />
      <aside
        className="customer-detail-drawer va-edit-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "트림 수정" : "트림 추가"}
      >
        <div className="panel-head">
          <h2>{isEdit ? "트림 수정" : "트림 추가"}</h2>
          <button type="button" className="tiny-btn" aria-label="닫기" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="panel-body va-form">
          <label className="va-field">
            <span>트림명 *</span>
            <input className="input" value={trimName} onChange={(e) => setTrimName(e.currentTarget.value)} placeholder="예: 520i" />
          </label>
          {isEdit && (
            <label className="va-field">
              <span>정규화명 (자동 생성)</span>
              <input className="input va-readonly" value={trim?.canonicalName ?? ""} readOnly disabled />
            </label>
          )}
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
          <label className="va-field">
            <span>가격(원) *</span>
            <input
              className="input va-num"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(formatThousands(e.currentTarget.value))}
              placeholder="예: 70,000,000"
            />
          </label>
          <label className="va-field">
            <span>연식 *</span>
            <input className="input" inputMode="numeric" value={modelYear} onChange={(e) => setModelYear(e.currentTarget.value)} />
          </label>
          <label className="va-field">
            <span>연료 *</span>
            <select className="select" value={fuelType} onChange={(e) => setFuelType(e.currentTarget.value)}>
              {FUEL_TYPES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="va-field">
            <span>구동방식</span>
            <select className="select" value={driveSystem} onChange={(e) => setDriveSystem(e.currentTarget.value)}>
              {DRIVE_SYSTEMS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="va-field">
            <span>배기량(cc)</span>
            <input className="input" inputMode="numeric" value={displacementCc} onChange={(e) => setDisplacementCc(e.currentTarget.value)} />
          </label>
          <label className="va-field">
            <span>변속기</span>
            <select className="select" value={transmissionType} onChange={(e) => setTransmissionType(e.currentTarget.value)}>
              {TRANSMISSION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="va-field">
            <span>차체</span>
            <input className="input" value={bodyStyle} onChange={(e) => setBodyStyle(e.currentTarget.value)} placeholder="예: 세단" />
          </label>
          <label className="va-field">
            <span>인승</span>
            <input className="input" inputMode="numeric" value={seatingCapacity} onChange={(e) => setSeatingCapacity(e.currentTarget.value)} />
          </label>
          <div className="va-form-section">할인 정보</div>
          <label className="va-field">
            <span>자사 할인(원)</span>
            <input
              className="input va-num"
              inputMode="numeric"
              value={financialDiscount}
              onChange={(e) => setFinancialDiscount(formatThousands(e.currentTarget.value))}
              placeholder="예: 1,000,000"
            />
          </label>
          <label className="va-field">
            <span>제휴 할인(원)</span>
            <input
              className="input va-num"
              inputMode="numeric"
              value={partnerDiscount}
              onChange={(e) => setPartnerDiscount(formatThousands(e.currentTarget.value))}
              placeholder="예: 500,000"
            />
          </label>
          <label className="va-field">
            <span>타사 할인(원)</span>
            <input
              className="input va-num"
              inputMode="numeric"
              value={cashDiscount}
              onChange={(e) => setCashDiscount(formatThousands(e.currentTarget.value))}
              placeholder="예: 500,000"
            />
          </label>
          {error && <div className="notice-box error">{error}</div>}
          <div className="va-form-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              취소
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!canSubmit || busy}
              onClick={() =>
                onSubmit({
                  trimName: trimName.trim(),
                  price: priceNum as number,
                  modelYear: yearNum as number,
                  fuelType,
                  driveSystem,
                  transmissionType,
                  displacementCc: num(displacementCc),
                  bodyStyle: bodyStyle.trim() || null,
                  seatingCapacity: num(seatingCapacity),
                  status,
                  financialDiscountAmount: num(financialDiscount),
                  partnerDiscountAmount: num(partnerDiscount),
                  cashDiscountAmount: num(cashDiscount),
                })
              }
            >
              {busy ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
