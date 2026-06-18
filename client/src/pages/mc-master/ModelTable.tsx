import { Pencil } from "lucide-react";

import { statusBadgeTone, statusLabel } from "@/data/vehicle-taxonomy";
import type { CatalogModel } from "@/lib/catalog";
import { formatPriceRangeKorean } from "@/lib/price-format";
import { SelectAllHeadCell, SelectCheckCell, SelectableRow } from "./table-select";

export function ModelTable({
  models,
  canEdit,
  selectMode,
  selected,
  draggingId,
  onOpen,
  onEdit,
  onToggle,
  onToggleAll,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  models: CatalogModel[];
  canEdit: boolean;
  selectMode: boolean;
  selected: Set<number>;
  draggingId: number | null;
  onOpen: (model: CatalogModel) => void;
  onEdit: (model: CatalogModel) => void;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  onDragStart: (id: number) => void;
  onDragOver: (id: number) => void;
  onDrop: () => void;
}) {
  if (models.length === 0) return <div className="va-empty">브랜드를 선택하세요.</div>;
  const allChecked = models.length > 0 && models.every((m) => selected.has(m.id));
  return (
    <table className="customer-table va-model-table">
      <thead>
        <tr>
          <SelectAllHeadCell show={selectMode} allChecked={allChecked} onToggleAll={onToggleAll} />
          <th className="va-mt-name">모델명</th>
          <th className="va-mt-cat">카테고리</th>
          <th className="va-mt-price">가격 범위</th>
          <th className="va-col-center va-mt-status">상태</th>
          <th className="va-col-center va-mt-count">트림 수</th>
          {canEdit && !selectMode && <th className="va-col-center va-mt-edit" aria-label="편집" />}
        </tr>
      </thead>
      <tbody>
        {models.map((m) => (
          <SelectableRow
            key={m.id}
            id={m.id}
            selectMode={selectMode}
            isSelected={selected.has(m.id)}
            isDragging={draggingId === m.id}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <SelectCheckCell
              show={selectMode}
              checked={selected.has(m.id)}
              onToggle={() => onToggle(m.id)}
              label={`${m.name} 선택`}
            />
            <td className="va-model-name">
              {m.imageUrl && <img src={m.imageUrl} alt="" className="va-model-thumb" />}
              {selectMode ? (
                <span>{m.name}</span>
              ) : (
                <button type="button" className="va-link" onClick={() => onOpen(m)}>
                  {m.name}
                </button>
              )}
            </td>
            <td>{m.category ?? "—"}</td>
            <td className="va-num va-mt-price">{formatPriceRangeKorean(m.minPrice, m.maxPrice)}</td>
            <td className="va-col-center">
              <span className={`badge ${statusBadgeTone(m.status)}`}>{statusLabel(m.status)}</span>
            </td>
            <td className="va-col-center va-num">{m.trimCount}</td>
            {canEdit && !selectMode && (
              <td className="va-col-center">
                <button type="button" className="tiny-btn" aria-label={`${m.name} 수정`} onClick={() => onEdit(m)}>
                  <Pencil size={14} />
                </button>
              </td>
            )}
          </SelectableRow>
        ))}
      </tbody>
    </table>
  );
}
