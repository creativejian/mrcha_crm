import { Pencil, Trash2 } from "lucide-react";

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
  onEdit,
  onDelete,
}: {
  models: CatalogModel[];
  canEdit: boolean;
  onEdit: (model: CatalogModel) => void;
  onDelete: (model: CatalogModel) => void;
}) {
  if (models.length === 0) return <div className="va-empty">브랜드를 선택하세요.</div>;
  return (
    <div className="table-scroll">
      <table className="customer-table va-model-table">
        <thead>
          <tr>
            <th>모델명</th>
            <th>카테고리</th>
            <th>가격 범위</th>
            <th className="va-col-center">상태</th>
            <th className="va-col-center">트림 수</th>
            {canEdit && <th className="va-col-center" aria-label="편집" />}
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id}>
              <td className="va-model-name">
                {m.imageUrl && <img src={m.imageUrl} alt="" className="va-model-thumb" />}
                <span>{m.name}</span>
              </td>
              <td>{m.category ?? "—"}</td>
              <td>{priceRange(m.minPrice, m.maxPrice)}</td>
              <td className="va-col-center">
                <span className={`badge ${statusBadgeTone(m.status)}`}>{statusLabel(m.status)}</span>
              </td>
              <td className="va-col-center">{m.trimCount}</td>
              {canEdit && (
                <td className="va-col-center">
                  <div className="va-row-actions">
                    <button type="button" className="tiny-btn" aria-label={`${m.name} 수정`} onClick={() => onEdit(m)}>
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="tiny-btn va-danger"
                      aria-label={`${m.name} 삭제`}
                      onClick={() => onDelete(m)}
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
