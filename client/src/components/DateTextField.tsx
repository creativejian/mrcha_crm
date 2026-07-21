// 날짜 입력 SSOT — 표시·타이핑은 항상 년-월-일 텍스트(로케일 무관, datetime-text 정규화와 쌍),
// 달력 버튼은 숨긴 native date input의 showPicker()를 빌려 쓴다(선택 반환값은 로케일 무관 ISO라
// 년/월/일 고정이 유지됨 — 로케일 문제는 native의 '표시'에만 있었다).
// controlled(value/onValueChange — 출고 팝오버)·uncontrolled(name/defaultValue → FormData — 일정/할일) 양쪽 패스스루.
import { CalendarDays } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from "react";

import { normalizeDateText } from "@/lib/datetime-text";

// showPicker 미지원 브라우저는 버튼만 숨긴다(fail-open) — 텍스트 입력은 항상 동작.
const SHOW_PICKER_SUPPORTED = typeof HTMLInputElement !== "undefined" && "showPicker" in HTMLInputElement.prototype;

type DateTextFieldProps = {
  ariaLabel?: string;
  autoFocus?: boolean;
  defaultValue?: string;
  name?: string;
  onValueChange?: (value: string) => void;
  value?: string;
};

export function DateTextField({ ariaLabel, autoFocus, defaultValue, name, onValueChange, value }: DateTextFieldProps) {
  const textRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const pickerBtnRef = useRef<HTMLButtonElement>(null);
  // 네이티브 픽커는 닫기 API·닫힘 이벤트가 없다 — 열림을 플래그 휴리스틱으로 추적해 아이콘 재클릭을
  // "닫기 의도"로 해석한다(2026-07-21 유슨생). 아이콘 밖 pointerdown(=네이티브 dismiss와 같은 클릭)·
  // 날짜 선택(change)이 플래그를 해제한다. 알려진 한계: Escape 닫힘은 페이지에 이벤트가 안 와서
  // 직후 아이콘 클릭 1회가 닫기로 소비된다(두 번째 클릭에 열림).
  const pickerOpenRef = useRef(false);
  const dismissListenerRef = useRef<((event: PointerEvent) => void) | null>(null);
  // 강제 닫기 수단 = 숨긴 native input 리마운트(key) — 픽커는 자기 input보다 오래 못 산다.
  // Chrome/Firefox는 밖 클릭(dismiss)이 이미 닫아 재오픈 스킵만으로 충분하지만, Safari는 아이콘
  // 클릭으로 안 닫히고 blur()도 무시(실기 2026-07-21). 리마운트는 전 브라우저 공통으로 닫는다.
  const [pickerEpoch, setPickerEpoch] = useState(0);

  function detachDismissListener() {
    if (!dismissListenerRef.current) return;
    document.removeEventListener("pointerdown", dismissListenerRef.current, true);
    dismissListenerRef.current = null;
  }

  useEffect(() => detachDismissListener, []);

  function openPicker(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (pickerOpenRef.current) {
      // 재클릭 = 닫기 — input 리마운트로 강제 종료(Safari 포함 전 브라우저).
      pickerOpenRef.current = false;
      detachDismissListener();
      setPickerEpoch((epoch) => epoch + 1);
      return;
    }
    const current = value !== undefined ? value : (textRef.current?.value ?? "");
    if (pickerRef.current) pickerRef.current.value = normalizeDateText(current) ?? "";
    try {
      pickerRef.current?.showPicker();
    } catch {
      textRef.current?.focus();
      return;
    }
    pickerOpenRef.current = true;
    const onOutsidePointerDown = (ev: PointerEvent) => {
      // 이 필드의 아이콘 위 pointerdown은 무시 — 이어지는 click을 위 토글-닫기 분기가 처리한다.
      if (pickerBtnRef.current && ev.target instanceof Node && pickerBtnRef.current.contains(ev.target)) return;
      pickerOpenRef.current = false;
      detachDismissListener();
    };
    dismissListenerRef.current = onOutsidePointerDown;
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
  }

  function handlePick(event: ChangeEvent<HTMLInputElement>) {
    pickerOpenRef.current = false; // 선택·취소 어느 쪽이든 픽커는 닫힌 상태
    detachDismissListener();
    const iso = event.target.value;
    if (!iso) return;
    if (value === undefined && textRef.current) textRef.current.value = iso;
    onValueChange?.(iso);
  }

  return (
    <span className="date-text-field">
      <input
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        maxLength={10}
        name={name}
        placeholder="2026-07-19"
        ref={textRef}
        type="text"
        {...(value !== undefined
          ? { value, onChange: (event: ChangeEvent<HTMLInputElement>) => onValueChange?.(event.target.value) }
          : { defaultValue, onChange: onValueChange ? (event: ChangeEvent<HTMLInputElement>) => onValueChange(event.target.value) : undefined })}
      />
      {SHOW_PICKER_SUPPORTED && (
        <button aria-label="달력에서 날짜 선택" className="date-text-field-picker-btn" onClick={openPicker} ref={pickerBtnRef} type="button">
          <CalendarDays aria-hidden="true" size={14} strokeWidth={2.1} />
        </button>
      )}
      <input aria-hidden="true" className="date-text-field-native" key={pickerEpoch} onChange={handlePick} ref={pickerRef} tabIndex={-1} type="date" />
    </span>
  );
}
