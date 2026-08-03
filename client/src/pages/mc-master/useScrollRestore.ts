import { useLayoutEffect, type RefObject } from "react";

import { mcMasterViewState } from "./view-state";

// 스크롤 위치 보존(모델 목록·트림 목록 각각): 트림 뷰 왕복은 물론 다른 메뉴에 갔다 와도
// 복원한다. 트림은 모델별로 나눠 담아 다른 모델에 들어갈 땐 맨 위에서 시작한다(view-state.ts —
// 모듈 상태라 컴포넌트 언마운트를 넘겨 산다).

export function useMcMasterScrollRestore(
  scrollRef: RefObject<HTMLDivElement | null>,
  modelId: string | undefined,
  /** 복원 시점 트리거 — 값 자체는 쓰지 않고 "목록이 채워졌다"만 본다. */
  models: readonly unknown[],
  trims: readonly unknown[],
): { onScroll: () => void } {
  // 목록이 채워진 뒤(models/trims) 복원해야 한다 — 빈 목록에 scrollTop을 주면 0으로 잘린다.
  // 그룹 접힘(expandedGroups)·탭 전환은 사용자가 방금 한 조작이라 일부러 deps에 넣지 않는다.
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = modelId
      ? (mcMasterViewState.trimScrollTop.get(modelId) ?? 0)
      : mcMasterViewState.modelScrollTop;
  }, [scrollRef, modelId, models, trims]);

  return {
    onScroll: () => {
      if (!scrollRef.current) return;
      if (modelId) mcMasterViewState.trimScrollTop.set(modelId, scrollRef.current.scrollTop);
      else mcMasterViewState.modelScrollTop = scrollRef.current.scrollTop;
    },
  };
}
