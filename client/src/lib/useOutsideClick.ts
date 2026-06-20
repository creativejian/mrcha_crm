import { useEffect, type RefObject } from "react";

// active(드롭다운 열림)인 동안 ref 영역 바깥에서 pointerdown이 발생하면 onClose를 호출한다.
// ColorPicker·OptionPicker·VehiclePicker 등 드롭다운 공용 외부 클릭 닫기.
export function useOutsideClick<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [active, onClose, ref]);
}
