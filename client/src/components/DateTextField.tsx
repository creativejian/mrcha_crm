// 날짜 입력 SSOT — 표시·타이핑은 항상 년-월-일 텍스트(로케일 무관, datetime-text 정규화와 쌍),
// 달력 버튼은 숨긴 native date input의 showPicker()를 빌려 쓴다(선택 반환값은 로케일 무관 ISO라
// 년/월/일 고정이 유지됨 — 로케일 문제는 native의 '표시'에만 있었다).
// controlled(value/onValueChange — 출고 팝오버)·uncontrolled(name/defaultValue → FormData — 일정/할일) 양쪽 패스스루.
import { CalendarDays } from "lucide-react";
import { useRef, type ChangeEvent, type MouseEvent } from "react";

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

  function openPicker(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const current = value !== undefined ? value : (textRef.current?.value ?? "");
    if (pickerRef.current) pickerRef.current.value = normalizeDateText(current) ?? "";
    try {
      pickerRef.current?.showPicker();
    } catch {
      textRef.current?.focus();
    }
  }

  function handlePick(event: ChangeEvent<HTMLInputElement>) {
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
        <button aria-label="달력에서 날짜 선택" className="date-text-field-picker-btn" onClick={openPicker} type="button">
          <CalendarDays aria-hidden="true" size={14} strokeWidth={2.1} />
        </button>
      )}
      <input aria-hidden="true" className="date-text-field-native" onChange={handlePick} ref={pickerRef} tabIndex={-1} type="date" />
    </span>
  );
}
