import type { SyntheticEvent } from "react";

import { formatThousands } from "./trim-format";

// 천단위 콤마 입력의 **커서 유실 방지**(2026-07-28 유슨생 실기).
//
// 증상: `5,500,000`에서 끝자리가 아닌 숫자를 백스페이스로 지우면 커서가 맨 뒤로 튀어 그 자리에서
// 계속 고칠 수 없다. 원인은 controlled input + 재포맷이다 — onChange가 값을 다시 포맷해 length가
// 바뀌면 React가 DOM value를 교체하고, 그 순간 브라우저는 커서를 끝으로 보낸다.
//
// 해법: **커서 앞의 숫자 개수**를 보존한다. 콤마 위치는 포맷이 정하므로 문자 인덱스로는 되돌릴 수
// 없다(`5,500,000` → `550,000`처럼 콤마가 이동한다). 숫자 개수는 포맷과 무관한 논리 좌표다.

// 커서 앞에 있는 숫자(0-9) 개수. 콤마는 세지 않는다.
export function digitsBefore(value: string, caret: number): number {
  return value.slice(0, caret).replace(/\D/g, "").length;
}

// 숫자 n개를 지난 직후의 문자 위치. `caretAfterDigits("550,000", 2)` = 2 → `55|0,000`.
// n이 0이면 맨 앞, 문자열의 숫자보다 크면 맨 뒤(전부 지운 뒤 다시 입력하는 경우).
export function caretAfterDigits(formatted: string, digits: number): number {
  if (digits <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (formatted[i]! >= "0" && formatted[i]! <= "9") {
      seen += 1;
      if (seen === digits) return i + 1;
    }
  }
  return formatted.length;
}

// onChange 안에서 부른다. setValue는 **포맷된 문자열**을 받는다.
//
// ⚠️ 핸들러를 만들어 주는 팩토리(`onThousandsInput(setter)` 형태)로 두지 않는다: 그러면 렌더 중에
// 팩토리가 실행되고, setValue 콜백이 ref를 캡처하는 경우(딜러 셀의 디바운스 timerRef)
// `react-hooks/refs`가 "렌더 중 ref 접근"으로 잡는다. 이벤트 시점에 호출하는 형태가 안전하다.
export function applyThousandsInput(
  e: SyntheticEvent<HTMLInputElement>,
  setValue: (formatted: string) => void,
): void {
  const el = e.currentTarget;
  const caret = el.selectionStart ?? el.value.length;
  const wanted = digitsBefore(el.value, caret);
  setValue(formatThousands(el.value));
  // ⚠️ setValue 직후엔 DOM이 아직 구값이라 setSelectionRange가 무효다(React는 커밋 시점에
  // value를 교체한다). 다음 프레임에 **그때의 실제 DOM 값**을 기준으로 복원한다 — setValue가
  // 만든 문자열을 그대로 믿지 않는다(호출부가 값을 더 가공할 수 있다).
  requestAnimationFrame(() => {
    if (!el.isConnected) return; // 입력 중 언마운트(패널 닫기 등)
    const pos = caretAfterDigits(el.value, wanted);
    el.setSelectionRange(pos, pos);
  });
}
