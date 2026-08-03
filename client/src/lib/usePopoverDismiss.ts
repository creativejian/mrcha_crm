import { useEffect, useRef, type RefObject } from "react";

type PopoverDismissOptions = {
  // Esc 외에 처리할 추가 키 핸들러(예: 통합검색 Enter로 첫 결과 열기).
  onKeyDown?: (event: KeyboardEvent) => void;
  // true를 반환하면 외부 pointerdown 닫기를 건너뛴다(예: 확인 모달이 떠 있을 때).
  // Esc(onDismiss)에는 적용하지 않는다 — 원본 동작과 동일.
  guard?: () => boolean;
  // 토글 버튼(앵커) ref — 여기서 시작한 pointerdown은 닫지 않는다(2026-08-03). 없으면 앵커
  // 클릭이 pointerdown(닫기) → click(토글이 다시 열기)로 이중 발화해 **버튼을 다시 눌러도
  // 팝오버가 안 닫히는 것처럼** 보인다. 닫기는 버튼의 onClick 토글 한 곳이 담당하게 양보한다.
  anchorRef?: RefObject<HTMLElement | null>;
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
      if (optionsRef.current?.anchorRef?.current?.contains(event.target as Node)) return;
      if (!ref.current?.contains(event.target as Node)) onDismissRef.current();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismissRef.current();
      optionsRef.current?.onKeyDown?.(event);
    }

    // capture 단계(2026-08-03) — 버블 문서 리스너는 경로 위 어떤 핸들러든(확장 프로그램·서드파티
    // 스크립트 포함) stopPropagation 한 번이면 죽는다. 실기에서 "바깥 클릭해도 안 닫힘"이 브라우저
    // 전반에서 보고돼 fail-safe로 올린다(Topbar 알림 capture 선례). 판정은 target 포함 여부라
    // 단계와 무관 — 기존 소비처 의미 불변.
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, ref]);
}
