import { Pencil } from "lucide-react";

import type { CatalogTrim, TrimColor, TrimOptionSummary } from "@/lib/catalog";
import { SelectAllHeadCell, SelectCheckCell, SelectableRow } from "./table-select";
import { ColorChips, OptionBadgeButton, TrimHeadCells, TrimMetaCells } from "./trim-cells";

// 평면 트림 테이블(전체 trim_name). 국산차 '순서 관리' 탭 / 수입차 기본 뷰에서 쓴다.
// 드래그 순서변경/일괄삭제는 '선택' 모드에서만(앱과 동일).
export function TrimTable({
  trims,
  canEdit,
  isDomestic,
  selectMode,
  selected,
  draggingId,
  colorsByTrim,
  optionByTrim,
  onEdit,
  onOpenOptions,
  onPrefetchOptions,
  onToggle,
  onToggleAll,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  trims: CatalogTrim[];
  canEdit: boolean;
  isDomestic: boolean;
  selectMode: boolean;
  selected: Set<number>;
  draggingId: number | null;
  colorsByTrim: Map<number, TrimColor[]>;
  optionByTrim: Map<number, TrimOptionSummary>;
  onEdit: (t: CatalogTrim) => void;
  onOpenOptions: (t: CatalogTrim) => void;
  onPrefetchOptions: (trimId: number) => void;
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
          <SelectAllHeadCell show={selectMode} allChecked={allChecked} onToggleAll={onToggleAll} />
          <th className="va-th-trim">트림명</th>
          <TrimHeadCells showOption={isDomestic} />
          {canEdit && !selectMode && <th className="va-col-center va-th-edit" aria-label="편집" />}
        </tr>
      </thead>
      <tbody>
        {trims.map((t) => (
          <SelectableRow
            key={t.id}
            id={t.id}
            selectMode={selectMode}
            isSelected={selected.has(t.id)}
            isDragging={draggingId === t.id}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <SelectCheckCell
              show={selectMode}
              checked={selected.has(t.id)}
              onToggle={() => onToggle(t.id)}
              label={`${t.trimName} 선택`}
            />
            <td className="va-th-trim">
              <div className="va-trim-name">{t.trimName}</div>
              <ColorChips colors={colorsByTrim.get(t.id) ?? []} />
            </td>
            <TrimMetaCells trim={t} />
            {isDomestic && (
              <td className="va-col-center">
                <OptionBadgeButton
                  summary={optionByTrim.get(t.id)}
                  onClick={() => onOpenOptions(t)}
                  onPrefetch={() => onPrefetchOptions(t.id)}
                />
              </td>
            )}
            {canEdit && !selectMode && (
              <td className="va-col-center">
                <button type="button" className="tiny-btn" aria-label={`${t.trimName} 수정`} onClick={() => onEdit(t)}>
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
