// usePopoverViewportClose — fixed 팝오버가 뷰포트 시프트에 닫히는지 잠그는 단위테스트.
// 배경: 2026-07-31 타깃 렌즈 배치. 드로어 3카드(할일·일정·서류) 확인 팝오버가 이 닫기를
// 배선하지 않아, 드로어를 400px 굴리면 행만 400px 움직이고 팝오버는 제자리에 남았다(실측).
// 특히 "scroll을 capture로 듣는다"가 계약의 핵심이다 — 스크롤 컨테이너의 scroll 이벤트는
// 버블하지 않아 document 비캡처 리스너로는 영영 잡히지 않는다.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePopoverViewportClose } from "./use-popover-viewport-close";

function fireScrollOn(el: Element) {
  // 실제 스크롤 컨테이너와 동일하게 버블하지 않는 이벤트를 쏜다(capture가 아니면 못 잡는다).
  act(() => {
    el.dispatchEvent(new Event("scroll", { bubbles: false }));
  });
}

describe("usePopoverViewportClose", () => {
  it("내부 스크롤 컨테이너의 scroll(비버블)에도 닫는다 — capture 계약", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onClose = vi.fn();

    renderHook(() => usePopoverViewportClose(true, onClose));
    fireScrollOn(container);

    expect(onClose).toHaveBeenCalledTimes(1);
    container.remove();
  });

  it("resize에도 닫는다", () => {
    const onClose = vi.fn();
    renderHook(() => usePopoverViewportClose(true, onClose));

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("팝오버가 닫혀 있으면(active=false) 구독하지 않는다", () => {
    const onClose = vi.fn();
    renderHook(() => usePopoverViewportClose(false, onClose));

    fireScrollOn(document.body);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("언마운트 후에는 호출되지 않는다", () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => usePopoverViewportClose(true, onClose));

    unmount();
    fireScrollOn(document.body);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("호출부가 인라인 화살표를 넘겨도 최신 콜백이 불린다(ref 계약)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: () => void }) => usePopoverViewportClose(true, cb), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });
    fireScrollOn(document.body);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
