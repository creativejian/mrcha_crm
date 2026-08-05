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
  flash,
  onDragStart,
  onDragOver,
  onDrop,
  onActivate,
  onHover,
  children,
}: {
  id: number;
  selectMode: boolean;
  isSelected: boolean;
  isDragging: boolean;
  /** ?hl= 딥링크 착지 마킹(va-row-flash) — 명부 "보기" 팝오버에서 온 경우만 잠깐 켜진다. */
  flash?: boolean;
  onDragStart: (id: number) => void;
  onDragOver: (id: number) => void;
  onDrop: () => void;
  /** 행 전체를 진입 버튼으로 쓴다(고객 목록 `customer-row` 선례). 넘기지 않으면 행은 종전처럼
   * 클릭 대상이 아니다 — 셀 안 링크가 진입을 담당하는 테이블(트림류)은 안 넘기면 그만이다.
   * ⚠️ 선택 모드에서는 자동으로 꺼진다 — 그때 행은 draggable이고 클릭은 체크박스 몫이라
   * 진입이 섞이면 정렬 중 실수로 화면이 바뀐다. */
  onActivate?: () => void;
  /** 진입 대상 프리페치. 행 전체가 클릭 대상이므로 hover도 행 단위여야 한다 — 셀 안 링크에
   * 걸어두면 "행 아무 데나 눌리는데 미리 받기는 이름 위에 올려야만 도는" 엇박이 된다. */
  onHover?: () => void;
  children: ReactNode;
}) {
  const clickable = Boolean(onActivate) && !selectMode;
  return (
    <tr
      data-trim-id={id}
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
      onClick={clickable ? onActivate : undefined}
      // Enter만 — 고객 목록(openCustomerByKeyboard)과 같은 스코프. Space는 표에서 스크롤 기대가 있다.
      onKeyDown={clickable ? (e) => { if (e.key === "Enter") onActivate?.(); } : undefined}
      onMouseEnter={clickable ? onHover : undefined}
      onFocus={clickable ? onHover : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={
        [
          selectMode && isSelected ? "va-row-selected" : "",
          isDragging ? "va-dragging" : "",
          flash ? "va-row-flash" : "",
          clickable ? "va-row-click" : "",
        ]
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
