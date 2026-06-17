import { GripVertical, Pencil } from "lucide-react";

import { statusBadgeTone, statusLabel } from "@/data/vehicle-taxonomy";
import type { CatalogTrim, TrimColor } from "@/lib/catalog";

function fmtDate(s: string | null): string {
  return s ? s.slice(0, 10) : "—";
}

function discountText(amount: number | null, price: number): string {
  if (!amount) return "—";
  const rate = price > 0 ? ((amount / price) * 100).toFixed(1) : "0.0";
  return `${amount.toLocaleString()}원 (${rate}%)`;
}

function ColorChips({ colors }: { colors: TrimColor[] }) {
  if (!colors || colors.length === 0) return null;
  const ext = colors.filter((c) => c.colorType === "exterior");
  const int = colors.filter((c) => c.colorType === "interior");
  const chip = (c: TrimColor, k: string) => (
    <span key={k} className="va-color-chip" style={{ backgroundColor: c.hexValue ?? "#cccccc" }} title={c.name} />
  );
  return (
    <div className="va-color-chips">
      {ext.slice(0, 6).map((c, i) => chip(c, `e${i}`))}
      {ext.length > 6 && <span className="va-color-more">+{ext.length - 6}</span>}
      {int.length > 0 && <span className="va-color-div">|</span>}
      {int.slice(0, 6).map((c, i) => chip(c, `i${i}`))}
      {int.length > 6 && <span className="va-color-more">+{int.length - 6}</span>}
    </div>
  );
}

export function TrimTable({
  trims,
  canEdit,
  selectMode,
  selected,
  draggingId,
  colorsByTrim,
  onEdit,
  onToggle,
  onToggleAll,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  trims: CatalogTrim[];
  canEdit: boolean;
  selectMode: boolean;
  selected: Set<number>;
  draggingId: number | null;
  colorsByTrim: Map<number, TrimColor[]>;
  onEdit: (t: CatalogTrim) => void;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  onDragStart: (id: number) => void;
  onDragOver: (id: number) => void;
  onDrop: () => void;
}) {
  if (trims.length === 0) return <div className="va-empty">트림이 없습니다. ‘트림 추가’로 등록하세요.</div>;
  const allChecked = trims.length > 0 && trims.every((t) => selected.has(t.id));
  return (
    <table className="customer-table va-trim-table">
      <thead>
        <tr>
          {selectMode && (
            <th className="va-col-sel">
              <input type="checkbox" checked={allChecked} onChange={onToggleAll} aria-label="전체 선택" />
            </th>
          )}
          <th>트림명</th>
          <th>고유번호</th>
          <th className="va-col-center">연식</th>
          <th>기본가격(개소세인하)</th>
          <th className="va-col-center">가격변경일</th>
          <th>자사할인</th>
          <th>제휴할인</th>
          <th>타사할인</th>
          <th className="va-col-center">할인변경일</th>
          <th className="va-col-center">상태</th>
          {canEdit && !selectMode && <th className="va-col-center" aria-label="편집" />}
        </tr>
      </thead>
      <tbody>
        {trims.map((t) => (
          <tr
            key={t.id}
            draggable={selectMode}
            onDragStart={selectMode ? () => onDragStart(t.id) : undefined}
            onDragOver={
              selectMode
                ? (e) => {
                    e.preventDefault();
                    onDragOver(t.id);
                  }
                : undefined
            }
            onDragEnd={selectMode ? onDrop : undefined}
            className={
              [selectMode && selected.has(t.id) ? "va-row-selected" : "", draggingId === t.id ? "va-dragging" : ""]
                .filter(Boolean)
                .join(" ") || undefined
            }
          >
            {selectMode && (
              <td className="va-col-sel">
                <span className="va-sel-cell">
                  <GripVertical className="va-grip" size={15} />
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => onToggle(t.id)}
                    aria-label={`${t.trimName} 선택`}
                  />
                </span>
              </td>
            )}
            <td>
              <div className="va-trim-name">{t.trimName}</div>
              <ColorChips colors={colorsByTrim.get(t.id) ?? []} />
            </td>
            <td className="va-num">{t.mcCode ?? "—"}</td>
            <td className="va-col-center va-num">{t.modelYear ?? "—"}</td>
            <td className="va-num">{t.price.toLocaleString()}원</td>
            <td className="va-col-center va-num va-muted">{fmtDate(t.priceUpdatedAt)}</td>
            <td className="va-num">{discountText(t.financialDiscountAmount, t.price)}</td>
            <td className="va-num">{discountText(t.partnerDiscountAmount, t.price)}</td>
            <td className="va-num">{discountText(t.cashDiscountAmount, t.price)}</td>
            <td className="va-col-center va-num va-muted">{fmtDate(t.discountUpdatedAt)}</td>
            <td className="va-col-center">
              <span className={`badge ${statusBadgeTone(t.status)}`}>{statusLabel(t.status)}</span>
            </td>
            {canEdit && !selectMode && (
              <td className="va-col-center">
                <button type="button" className="tiny-btn" aria-label={`${t.trimName} 수정`} onClick={() => onEdit(t)}>
                  <Pencil size={14} />
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
