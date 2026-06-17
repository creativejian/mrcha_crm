import { Pencil, Trash2 } from "lucide-react";

import { statusBadgeTone, statusLabel } from "@/data/vehicle-taxonomy";
import type { CatalogTrim } from "@/lib/catalog";

export function TrimTable({
  trims,
  canEdit,
  onEdit,
  onDelete,
}: {
  trims: CatalogTrim[];
  canEdit: boolean;
  onEdit: (t: CatalogTrim) => void;
  onDelete: (t: CatalogTrim) => void;
}) {
  if (trims.length === 0) return <div className="va-empty">트림이 없습니다. ‘트림 추가’로 등록하세요.</div>;
  return (
    <div className="table-scroll">
      <table className="customer-table va-trim-table">
        <thead>
          <tr>
            <th>트림명</th>
            <th>고유번호</th>
            <th className="va-col-center">연식</th>
            <th>가격</th>
            <th className="va-col-center">상태</th>
            {canEdit && <th className="va-col-center" aria-label="편집" />}
          </tr>
        </thead>
        <tbody>
          {trims.map((t) => (
            <tr key={t.id}>
              <td>{t.trimName}</td>
              <td className="va-mono">{t.mcCode ?? "—"}</td>
              <td className="va-col-center">{t.modelYear ?? "—"}</td>
              <td>{t.price.toLocaleString()}원</td>
              <td className="va-col-center">
                <span className={`badge ${statusBadgeTone(t.status)}`}>{statusLabel(t.status)}</span>
              </td>
              {canEdit && (
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
