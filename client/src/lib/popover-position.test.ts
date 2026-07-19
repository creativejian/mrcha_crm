import { describe, expect, it } from "vitest";

import { resolveFixedPopoverPosition } from "./popover-position";

// delivery-console.test.ts에서 이동(2026-07-19 클리핑 확산 픽스 — 헬퍼가 중립 모듈로 승격).
describe("팝오버 fixed 배치 계산(콘솔 래퍼 overflow:hidden 클리핑 탈출)", () => {
  const viewport = { width: 1200, height: 800 };
  const popover = { width: 220, height: 160 };

  it("아래에 여유가 있으면 앵커 바로 아래(+6px)에 열고 openUp은 false", () => {
    const anchor = { top: 300, bottom: 320, left: 100 };
    expect(resolveFixedPopoverPosition(anchor, popover, viewport)).toEqual({ top: 326, left: 100, openUp: false });
  });

  it("아래가 부족하고 위에 여유가 있으면 앵커 위(-6px)로 뒤집는다", () => {
    const anchor = { top: 700, bottom: 720, left: 100 };
    // 아래: 720+6+160=886 > 800-8=792 (부족) · 위: 700-6-160=534 >= 8 (여유) → openUp
    const result = resolveFixedPopoverPosition(anchor, popover, viewport);
    expect(result.openUp).toBe(true);
    expect(result.top).toBe(534);
    expect(result.left).toBe(100);
  });

  it("위아래 둘 다 부족하면(뷰포트보다 큰 팝오버 등) 아래를 유지한다(최선의 방어)", () => {
    const anchor = { top: 50, bottom: 70, left: 100 };
    const tallPopover = { width: 220, height: 900 }; // 뷰포트(800)보다 큰 극단 케이스
    const result = resolveFixedPopoverPosition(anchor, tallPopover, viewport);
    expect(result.openUp).toBe(false);
    expect(result.top).toBe(76); // bottom + GAP
  });

  it("좌측 클램프: 앵커가 왼쪽 경계에 가까우면 최소 여백(8px) 밑으로 내려가지 않는다", () => {
    const anchor = { top: 300, bottom: 320, left: -50 };
    const result = resolveFixedPopoverPosition(anchor, popover, viewport);
    expect(result.left).toBe(8);
  });

  it("우측 클램프: 앵커+팝오버 폭이 뷰포트를 넘으면 뷰포트 안으로 당긴다", () => {
    const anchor = { top: 300, bottom: 320, left: 1100 };
    const result = resolveFixedPopoverPosition(anchor, popover, viewport);
    // viewport.width(1200) - popover.width(220) - MARGIN(8) = 972
    expect(result.left).toBe(972);
  });
});
