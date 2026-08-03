import { useRef, useState, type Dispatch, type SetStateAction } from "react";

import { reorderTrims, type CatalogTrim } from "@/lib/catalog";
import { moveGroupToKey } from "./reorder";

// 그룹(서브라인) 블록 드래그 — 목록 보기 '선택' 모드에서 그룹 헤더만 남기고 통째 옮긴다
// (이사님 요청 2026-08-03: 캐스퍼처럼 연식·라인 그룹이 많으면 트림 하나씩이 부담. 구 ↑/↓
// 패널은 드래그로 대체·폐기). 낙관 갱신 + 실패 시 재조회는 트림 드래그(MCMasterPage onDrop)와
// 같은 규칙이다. 드래그 키가 문자열(서브라인)이라 선택 훅의 숫자 id 드래그 상태와 섞지 않고
// 따로 든다 — 그래서 이 훅이 따로 산다.

export function useGroupReorder(
  trims: CatalogTrim[],
  setTrims: Dispatch<SetStateAction<CatalogTrim[]>>,
  reloadTrims: () => void,
): {
  draggingGroupKey: string | null;
  onGroupDragStart: (key: string) => void;
  onGroupDragOver: (overKey: string) => void;
  onGroupDrop: () => void;
} {
  const dragKey = useRef<string | null>(null);
  const [draggingGroupKey, setDraggingGroupKey] = useState<string | null>(null);

  return {
    draggingGroupKey,
    onGroupDragStart: (key) => {
      dragKey.current = key;
      setDraggingGroupKey(key);
    },
    onGroupDragOver: (overKey) => {
      const cur = dragKey.current;
      if (cur == null || cur === overKey) return;
      setTrims((list) => moveGroupToKey(list, cur, overKey));
    },
    onGroupDrop: () => {
      if (dragKey.current == null) return; // dragEnd 중복 발화 방어
      dragKey.current = null;
      setDraggingGroupKey(null);
      void reorderTrims(trims.map((t) => t.id)).catch((e: unknown) => {
        window.alert(e instanceof Error ? e.message : "순서변경 실패");
        reloadTrims();
      });
    },
  };
}
