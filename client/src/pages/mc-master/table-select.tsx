import type { ReactNode } from "react";
import { GripVertical } from "lucide-react";

// 모델/트림 테이블의 선택 모드(일괄삭제 + 드래그 순서변경) 공통 부품.
// 인덱스는 부모 핸들러가 최신 list 기준으로 계산한다(stale closure 방지) — 여기선 id만 넘긴다.

// 선택 모드에서만 드래그 가능한 행. 선택/드래그 하이라이트 클래스 부여. children=각 테이블 고유 셀.
export function SelectableRow({
  id,
  selectMode,
  isSelected,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  children,
}: {
  id: number;
  selectMode: boolean;
  isSelected: boolean;
  isDragging: boolean;
  onDragStart: (id: number) => void;
  onDragOver: (id: number) => void;
  onDrop: () => void;
  children: ReactNode;
}) {
  return (
    <tr
      draggable={selectMode}
      onDragStart={selectMode ? () => onDragStart(id) : undefined}
      onDragOver={
        selectMode
          ? (e) => {
              e.preventDefault();
              onDragOver(id);
            }
          : undefined
      }
      onDragEnd={selectMode ? onDrop : undefined}
      className={
        [selectMode && isSelected ? "va-row-selected" : "", isDragging ? "va-dragging" : ""]
          .filter(Boolean)
          .join(" ") || undefined
      }
    >
      {children}
    </tr>
  );
}

// 전체 선택 헤더 체크박스 셀(선택 모드일 때만 노출).
export function SelectAllHeadCell({
  show,
  allChecked,
  onToggleAll,
}: {
  show: boolean;
  allChecked: boolean;
  onToggleAll: () => void;
}) {
  if (!show) return null;
  return (
    <th className="va-col-sel">
      <input type="checkbox" checked={allChecked} onChange={onToggleAll} aria-label="전체 선택" />
    </th>
  );
}

// 행 선택 체크박스 + 드래그 그립 셀(선택 모드일 때만 노출).
export function SelectCheckCell({
  show,
  checked,
  onToggle,
  label,
}: {
  show: boolean;
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  if (!show) return null;
  return (
    <td className="va-col-sel">
      <span className="va-sel-cell">
        <GripVertical className="va-grip" size={15} />
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={label} />
      </span>
    </td>
  );
}
