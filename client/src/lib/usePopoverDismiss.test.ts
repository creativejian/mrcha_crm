import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePopoverDismiss } from "./usePopoverDismiss";

// ref 영역으로 쓸 element와 그 바깥 element를 body에 붙여 RefObject를 구성한다.
function setupRef() {
  const inside = document.createElement("div");
  const outside = document.createElement("div");
  document.body.append(inside, outside);
  return { ref: { current: inside }, inside, outside };
}

function firePointerDown(target: EventTarget) {
  target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
}

function fireKey(key: string) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("usePopoverDismiss", () => {
  it("open=false면 외부 pointerdown/Escape에 반응하지 않는다", () => {
    const { ref, outside } = setupRef();
    const onDismiss = vi.fn();
    renderHook(() => usePopoverDismiss(ref, false, onDismiss));

    firePointerDown(outside);
    fireKey("Escape");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("open=true면 외부 pointerdown에서 onDismiss를 호출한다", () => {
    const { ref, outside } = setupRef();
    const onDismiss = vi.fn();
    renderHook(() => usePopoverDismiss(ref, true, onDismiss));

    firePointerDown(outside);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ref 영역 내부 pointerdown에서는 onDismiss를 호출하지 않는다", () => {
    const { ref, inside } = setupRef();
    const onDismiss = vi.fn();
    renderHook(() => usePopoverDismiss(ref, true, onDismiss));

    firePointerDown(inside);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("Escape에서 onDismiss를 호출한다", () => {
    const { ref } = setupRef();
    const onDismiss = vi.fn();
    renderHook(() => usePopoverDismiss(ref, true, onDismiss));

    fireKey("Escape");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("guard()가 true면 외부 pointerdown은 무시하되 Escape는 그대로 닫는다", () => {
    const { ref, outside } = setupRef();
    const onDismiss = vi.fn();
    renderHook(() => usePopoverDismiss(ref, true, onDismiss, { guard: () => true }));

    firePointerDown(outside);
    expect(onDismiss).not.toHaveBeenCalled();

    fireKey("Escape");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("onKeyDown 옵션은 임의의 키(예: Enter)에 대해 호출된다", () => {
    const { ref } = setupRef();
    const onDismiss = vi.fn();
    const onKeyDown = vi.fn();
    renderHook(() => usePopoverDismiss(ref, true, onDismiss, { onKeyDown }));

    fireKey("Enter");
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("unmount 후에는 리스너가 정리된다", () => {
    const { ref, outside } = setupRef();
    const onDismiss = vi.fn();
    const { unmount } = renderHook(() => usePopoverDismiss(ref, true, onDismiss));

    unmount();
    firePointerDown(outside);
    fireKey("Escape");
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
