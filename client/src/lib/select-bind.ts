import { useRef, type SyntheticEvent } from "react";

// Safari는 select 팝오버 선택 시 input(신값) → React controlled 값 복원 → change(구값) 순서로 발화해
// onChange만 들으면 선택이 통째로 유실된다(2026-07-05 실측 — Chrome 정상, Playwright webkit 재현 불가, 실 Safari만).
// controlled select는 반드시 이 헬퍼로 onChange+onInput 병행 바인딩한다(setState 멱등이라 이중 발화 무해).
// defaultValue(uncontrolled) select는 복원이 없어 안전 — 이 헬퍼 대상 아님.
export function bindSelect<T extends string | number>(value: T, commit: (next: string) => void) {
  const handler = (event: SyntheticEvent<HTMLSelectElement>) => commit(event.currentTarget.value);
  return { value, onChange: handler, onInput: handler };
}

// value 고정(항상 placeholder로 복귀) 액션형 select — 실행이 멱등이 아니라 이중 발화하면 안 되는 경우.
// onInput에서 신값을 ref에 보관했다가 change에서 `value || ref` 폴백으로 1곳에서만 실행한다.
// (Safari change는 복원된 구값 ""를 주고, 정상 브라우저 change는 신값을 줘 ref를 쓰지 않는다.)
// ref는 훅이 소유하고 이벤트 핸들러 안에서만 접근한다(react-hooks/refs — 렌더 중 ref 전달 금지).
export function useActionSelect(run: (picked: string) => void) {
  const pendingRef = useRef("");
  return {
    value: "" as const,
    onInput: (event: SyntheticEvent<HTMLSelectElement>) => {
      pendingRef.current = event.currentTarget.value;
    },
    onChange: (event: SyntheticEvent<HTMLSelectElement>) => {
      const picked = event.currentTarget.value || pendingRef.current;
      pendingRef.current = "";
      if (picked) run(picked);
    },
  };
}
