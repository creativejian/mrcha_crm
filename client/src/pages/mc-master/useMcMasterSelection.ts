import { useRef, useState } from "react";

// 차량 관리(/mc-master)의 선택 모드(일괄삭제/이동 대상 선택) + 드래그 순서변경 상태.
// 순수 선택/드래그 상태만 담는다 — 실제 순서 저장/재배치는 카탈로그 데이터를 만지므로
// 컴포넌트가 useMcMasterCatalog와 함께 엮어 처리한다.
export function useMcMasterSelection() {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const dragId = useRef<number | null>(null);

  function resetSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }
  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelected(new Set());
  }
  function toggle(idv: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(idv)) n.delete(idv);
      else n.add(idv);
      return n;
    });
  }
  function toggleAll(ids: number[]) {
    setSelected((s) => (s.size === ids.length ? new Set() : new Set(ids)));
  }
  function onDragStart(idv: number) {
    dragId.current = idv;
    setDraggingId(idv);
  }
  function endDrag() {
    dragId.current = null;
    setDraggingId(null);
  }
  function clearSelected() {
    setSelected(new Set());
  }

  return {
    selectMode,
    selected,
    draggingId,
    dragId,
    resetSelect,
    toggleSelectMode,
    toggle,
    toggleAll,
    onDragStart,
    endDrag,
    clearSelected,
  };
}
