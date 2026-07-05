import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SyntheticEvent } from "react";

import { bindSelect, useActionSelect } from "./select-bind";

function selectEvent(value: string) {
  return { currentTarget: { value } } as SyntheticEvent<HTMLSelectElement>;
}

describe("bindSelect — controlled select Safari 병행 바인딩", () => {
  it("onChange와 onInput이 같은 커밋을 실행한다(둘 다 신값 전달)", () => {
    const commit = vi.fn();
    const bound = bindSelect("서울", commit);
    expect(bound.value).toBe("서울");
    bound.onInput(selectEvent("인천"));
    bound.onChange(selectEvent("인천"));
    expect(commit).toHaveBeenCalledTimes(2); // setState 멱등 전제 — 이중 발화 무해
    expect(commit).toHaveBeenNthCalledWith(1, "인천");
    expect(commit).toHaveBeenNthCalledWith(2, "인천");
  });

  it("숫자 value도 그대로 통과시킨다(페이지 크기 select)", () => {
    const bound = bindSelect(15, vi.fn());
    expect(bound.value).toBe(15);
  });
});

describe("useActionSelect — value 고정 액션형 select ref 폴백", () => {
  it("Safari 순서(input 신값 → change 복원 구값 '')에서 ref 폴백으로 1회 실행된다", () => {
    const run = vi.fn();
    const { result } = renderHook(() => useActionSelect(run));
    expect(result.current.value).toBe("");
    result.current.onInput(selectEvent("staff-1"));
    result.current.onChange(selectEvent("")); // controlled 복원으로 구값 수신
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("staff-1");
    // 소비 후 초기화 — 다음 change가 잔존값으로 재실행되지 않는다
    result.current.onChange(selectEvent(""));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("정상 순서(change가 신값 전달)에서도 1회만 실행된다", () => {
    const run = vi.fn();
    const { result } = renderHook(() => useActionSelect(run));
    result.current.onInput(selectEvent("staff-2"));
    result.current.onChange(selectEvent("staff-2"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("staff-2");
  });

  it("빈 선택(placeholder 재선택)은 실행하지 않는다", () => {
    const run = vi.fn();
    const { result } = renderHook(() => useActionSelect(run));
    result.current.onChange(selectEvent(""));
    expect(run).not.toHaveBeenCalled();
  });
});
