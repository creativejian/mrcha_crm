import { GripVertical, Pencil, Trash2 } from "lucide-react";

import { statusBadgeTone, statusLabel } from "@/data/vehicle-taxonomy";
import type { CatalogTrim } from "@/lib/catalog";

export function TrimTable({
  trims,
  canEdit,
  selectMode,
  selected,
  onEdit,
  onDelete,
  onToggle,
  onToggleAll,
  onDragStart,
  onDragEnter,
  onDrop,
}: {
  trims: CatalogTrim[];
  canEdit: boolean;
  selectMode: boolean;
  selected: Set<number>;
  onEdit: (t: CatalogTrim) => void;
  onDelete: (t: CatalogTrim) => void;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  onDragStart: (id: number) => void;
  onDragEnter: (id: number) => void;
  onDrop: () => void;
}) {
  if (trims.length === 0) return <div className="va-empty">트림이 없습니다. ‘트림 추가’로 등록하세요.</div>;
  const allChecked = trims.length > 0 && trims.every((t) => selected.has(t.id));
  return (
    <div className="table-scroll">
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
            <th>가격</th>
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
              onDragEnter={selectMode ? () => onDragEnter(t.id) : undefined}
              onDragEnd={selectMode ? onDrop : undefined}
              onDragOver={selectMode ? (e) => e.preventDefault() : undefined}
              className={selectMode && selected.has(t.id) ? "va-row-selected" : undefined}
            >
              {selectMode && (
                <td className="va-col-sel">
                  <GripVertical className="lucide" size={15} />
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => onToggle(t.id)}
                    aria-label={`${t.trimName} 선택`}
                  />
                </td>
              )}
              <td>{t.trimName}</td>
              <td className="va-mono">{t.mcCode ?? "—"}</td>
              <td className="va-col-center">{t.modelYear ?? "—"}</td>
              <td>{t.price.toLocaleString()}원</td>
              <td className="va-col-center">
                <span className={`badge ${statusBadgeTone(t.status)}`}>{statusLabel(t.status)}</span>
              </td>
              {canEdit && !selectMode && (
                <td className="va-col-center">
                  <div className="va-row-actions">
                    <button type="button" className="tiny-btn" aria-label={`${t.trimName} 수정`} onClick={() => onEdit(t)}>
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="tiny-btn va-danger"
                      aria-label={`${t.trimName} 삭제`}
                      onClick={() => onDelete(t)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
