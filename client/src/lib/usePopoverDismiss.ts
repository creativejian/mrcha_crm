import { useEffect, useRef, type RefObject } from "react";

type PopoverDismissOptions = {
  // Esc 외에 처리할 추가 키 핸들러(예: 통합검색 Enter로 첫 결과 열기).
  onKeyDown?: (event: KeyboardEvent) => void;
  // true를 반환하면 외부 pointerdown 닫기를 건너뛴다(예: 확인 모달이 떠 있을 때).
  // Esc(onDismiss)에는 적용하지 않는다 — 원본 동작과 동일.
  guard?: () => boolean;
};

// 팝오버가 열린(open) 동안 ref 영역 바깥 pointerdown 또는 Escape로 onDismiss를 호출한다.
// 콜백/옵션은 ref로 안정화해 effect가 open 토글에만 반응하게 한다(호출부의 deps 부담 제거).
// Topbar 통합검색·업무 AI·계정 설정 팝오버 공용. 알림 팝오버는 첫 외부클릭 소비 특수 로직이라 제외한다.
export function usePopoverDismiss<T extends HTMLElement>(
  ref: RefObject<T | null>,
  open: boolean,
  onDismiss: () => void,
  options?: PopoverDismissOptions,
): void {
  const onDismissRef = useRef(onDismiss);
  const optionsRef = useRef(options);

  // 렌더 중이 아니라 commit 후에 최신 콜백/옵션을 ref에 반영한다(react-hooks/refs).
  // 이벤트 핸들러는 항상 그 이후에 실행되므로 최신값이 보장된다.
  useEffect(() => {
    onDismissRef.current = onDismiss;
    optionsRef.current = options;
  });

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (optionsRef.current?.guard?.()) return;
      if (!ref.current?.contains(event.target as Node)) onDismissRef.current();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismissRef.current();
      optionsRef.current?.onKeyDown?.(event);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, ref]);
}
