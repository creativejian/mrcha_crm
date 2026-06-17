import { GripVertical, Pencil } from "lucide-react";

import { statusBadgeTone, statusLabel } from "@/data/vehicle-taxonomy";
import type { CatalogModel } from "@/lib/catalog";

function priceRange(min: number | null, max: number | null): string {
  if (min == null || max == null) return "—";
  const fmt = (n: number) => `${n.toLocaleString()}원`;
  return min === max ? fmt(min) : `${fmt(min)} ~ ${fmt(max)}`;
}

export function ModelTable({
  models,
  canEdit,
  selectMode,
  selected,
  onOpen,
  onEdit,
  onToggle,
  onToggleAll,
  onDragStart,
  onDragEnter,
  onDrop,
}: {
  models: CatalogModel[];
  canEdit: boolean;
  selectMode: boolean;
  selected: Set<number>;
  onOpen: (model: CatalogModel) => void;
  onEdit: (model: CatalogModel) => void;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  onDragStart: (id: number) => void;
  onDragEnter: (id: number) => void;
  onDrop: () => void;
}) {
  if (models.length === 0) return <div className="va-empty">브랜드를 선택하세요.</div>;
  const allChecked = models.length > 0 && models.every((m) => selected.has(m.id));
  return (
    <table className="customer-table va-model-table">
      <thead>
        <tr>
          {selectMode && (
            <th className="va-col-sel">
              <input type="checkbox" checked={allChecked} onChange={onToggleAll} aria-label="전체 선택" />
            </th>
          )}
          <th>모델명</th>
          <th>카테고리</th>
          <th>가격 범위</th>
          <th className="va-col-center">상태</th>
          <th className="va-col-center">트림 수</th>
          {canEdit && !selectMode && <th className="va-col-center" aria-label="편집" />}
        </tr>
      </thead>
      <tbody>
        {models.map((m) => (
          <tr
            key={m.id}
            draggable={selectMode}
            onDragStart={selectMode ? () => onDragStart(m.id) : undefined}
            onDragEnter={selectMode ? () => onDragEnter(m.id) : undefined}
            onDragEnd={selectMode ? onDrop : undefined}
            onDragOver={selectMode ? (e) => e.preventDefault() : undefined}
            className={selectMode && selected.has(m.id) ? "va-row-selected" : undefined}
          >
            {selectMode && (
              <td className="va-col-sel">
                <span className="va-sel-cell">
                  <GripVertical className="va-grip" size={15} />
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    onChange={() => onToggle(m.id)}
                    aria-label={`${m.name} 선택`}
                  />
                </span>
              </td>
            )}
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
            <td className="va-num">{priceRange(m.minPrice, m.maxPrice)}</td>
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
          </tr>
        ))}
      </tbody>
    </table>
  );
}
