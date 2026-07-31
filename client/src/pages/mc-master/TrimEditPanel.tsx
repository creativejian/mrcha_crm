import { useState } from "react";

import {
  DRIVE_SYSTEMS,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
  VEHICLE_STATUSES,
  type VehicleStatus,
  isTrimStatusBlockedByModel,
  statusLabel,
} from "@/data/vehicle-taxonomy";
import type { CatalogTrim, TrimInput } from "@/lib/catalog";
import { bindSelect } from "@/lib/select-bind";
import { EditDrawer } from "./EditDrawer";
import { applyThousandsInput } from "./thousands-input";
import { parseWon } from "./trim-format";

// 입력 필드 초기값용 천단위 콤마(미정이면 빈칸). 표시용 wonText와 달리 단위·'—' 없음.
const won = (v: number | null): string => (v != null ? v.toLocaleString() : "");

export function TrimEditPanel({
  trim,
  modelStatus,
  onClose,
  onSubmit,
  busy,
  error,
  notice = null,
  submitLabel = "저장", // 팀장 제안 축은 "승인 요청" — 같은 폼, 다른 결말(spec §7.1)
  showDiscounts = true,
}: {
  trim: CatalogTrim | null;
  modelStatus: VehicleStatus | null;
  onClose: () => void;
  onSubmit: (values: TrimInput) => void;
  busy: boolean;
  error: string | null;
  // 프리필 안내(팀장 — 대기 중인 내 요청을 이어서 수정) 등 비에러 공지. 에러와 별개 슬롯.
  notice?: string | null;
  submitLabel?: string;
  // 할인 3필드는 딜러 제안→관리자 채택 체계 소유(spec §3.1 정정 2026-07-31) — 팀장 폼에선
  // 숨기고 제출 값에서도 뺀다(서버도 202 적재 시 제거하는 이중 방어).
  showDiscounts?: boolean;
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

  const priceNum = parseWon(price);
  const yearNum = parseWon(modelYear);
  const statusBlocked = isTrimStatusBlockedByModel(modelStatus, status);
  const canSubmit = trimName.trim().length > 0 && priceNum != null && yearNum != null && !statusBlocked;
  const label = isEdit ? "트림 수정" : "트림 추가";

  return (
    <EditDrawer title={label} ariaLabel={label} onClose={onClose}>
      {notice && <div className="notice-box">{notice}</div>}
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
        <select className="select" {...bindSelect(status, (v) => setStatus(v as VehicleStatus))}>
          {VEHICLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </label>
      {statusBlocked && (
        <div className="notice-box error">
          모델이 단종 상태입니다. 트림을 판매중/출시예정/사전예약으로 저장할 수 없습니다.
        </div>
      )}
      <label className="va-field">
        <span>가격(원) *</span>
        <input
          className="input va-num"
          inputMode="numeric"
          value={price}
          onChange={(e) => applyThousandsInput(e, setPrice)}
          placeholder="예: 70,000,000"
        />
      </label>
      <label className="va-field">
        <span>연식 *</span>
        <input className="input" inputMode="numeric" value={modelYear} onChange={(e) => setModelYear(e.currentTarget.value)} />
      </label>
      <label className="va-field">
        <span>연료 *</span>
        <select className="select" {...bindSelect(fuelType, setFuelType)}>
          {FUEL_TYPES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label className="va-field">
        <span>구동방식</span>
        <select className="select" {...bindSelect(driveSystem, setDriveSystem)}>
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
        <select className="select" {...bindSelect(transmissionType, setTransmissionType)}>
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
      {showDiscounts && (
        <>
          <div className="va-form-section">할인 정보</div>
          <label className="va-field">
            <span>자사 할인(원)</span>
            <input
              className="input va-num"
              inputMode="numeric"
              value={financialDiscount}
              onChange={(e) => applyThousandsInput(e, setFinancialDiscount)}
              placeholder="예: 1,000,000"
            />
          </label>
          <label className="va-field">
            <span>제휴 할인(원)</span>
            <input
              className="input va-num"
              inputMode="numeric"
              value={partnerDiscount}
              onChange={(e) => applyThousandsInput(e, setPartnerDiscount)}
              placeholder="예: 500,000"
            />
          </label>
          <label className="va-field">
            <span>타사 할인(원)</span>
            <input
              className="input va-num"
              inputMode="numeric"
              value={cashDiscount}
              onChange={(e) => applyThousandsInput(e, setCashDiscount)}
              placeholder="예: 500,000"
            />
          </label>
        </>
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
          onClick={() =>
            onSubmit({
              trimName: trimName.trim(),
              price: priceNum as number,
              modelYear: yearNum as number,
              fuelType,
              driveSystem,
              transmissionType,
              displacementCc: parseWon(displacementCc),
              bodyStyle: bodyStyle.trim() || null,
              seatingCapacity: parseWon(seatingCapacity),
              status,
              // 할인 3필드는 폼에 안 보일 때 제출 값에서도 뺀다 — 서버 제거의 클라 쪽 절반(위 prop 주석).
              ...(showDiscounts
                ? {
                    financialDiscountAmount: parseWon(financialDiscount),
                    partnerDiscountAmount: parseWon(partnerDiscount),
                    cashDiscountAmount: parseWon(cashDiscount),
                  }
                : {}),
            })
          }
        >
          {busy ? `${submitLabel} 중…` : submitLabel}
        </button>
      </div>
    </EditDrawer>
  );
}
