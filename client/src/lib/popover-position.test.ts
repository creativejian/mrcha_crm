import { describe, expect, it } from "vitest";

import { resolveFixedPopoverPosition } from "./popover-position";

// delivery-console.test.ts에서 이동(2026-07-19 클리핑 확산 픽스 — 헬퍼가 중립 모듈로 승격).
describe("팝오버 fixed 배치 계산(콘솔 래퍼 overflow:hidden 클리핑 탈출)", () => {
  const viewport = { width: 1200, height: 800 };
  const popover = { width: 220, height: 160 };

  it("아래에 여유가 있으면 앵커 바로 아래(+6px)에 열고 openUp은 false", () => {
    const anchor = { top: 300, bottom: 320, left: 100 };
    expect(resolveFixedPopoverPosition(anchor, popover, viewport)).toMatchObject({ top: 326, left: 100, openUp: false });
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

// ── 사용 가능 높이(2026-08-05) ─────────────────────────────────────────────
// 배경: 출고 정보 팝오버에 정산 비용 행·요청 버튼이 붙으면서(`#447`) **위아래 어디에도 안 들어가는**
// 길이가 됐다. flip 조건은 "아래로 넘치고 && 위에 충분한 공간"이라 그 경우 뒤집지 못하고 아래로
// 붙는데, max-height가 없어 잘린 채 남았다(실화면 실측: "실입금액" 아래가 통째로 안 보임).
// → 배치가 정해진 뒤 **남는 세로 공간**을 함께 돌려주고, 소비처가 그걸 max-height로 건다.
describe("resolveFixedPopoverPosition — maxHeight", () => {
  const viewport = { width: 1200, height: 800 };

  it("아래로 열리면 앵커 아래부터 뷰포트 끝까지가 사용 가능 높이다", () => {
    const r = resolveFixedPopoverPosition({ top: 100, bottom: 130, left: 40 }, { width: 320, height: 200 }, viewport);
    expect(r.openUp).toBe(false);
    // top(136) 아래로 남는 공간 = 800 - 136 - 8(여백)
    expect(r.maxHeight).toBe(viewport.height - r.top - 8);
  });

  it("위로 열리면 뷰포트 위부터 앵커까지가 사용 가능 높이다", () => {
    const r = resolveFixedPopoverPosition({ top: 700, bottom: 740, left: 40 }, { width: 320, height: 300 }, viewport);
    expect(r.openUp).toBe(true);
    expect(r.maxHeight).toBe(700 - 6 - 8);
  });

  it("**위아래 모두 부족하면** 아래로 붙되 남는 만큼으로 제한한다(이 케이스가 잘림의 원인이었다)", () => {
    // 앵커가 화면 중앙이고 팝오버가 매우 길다 — flip 조건의 둘째 항이 false라 아래로 붙는다.
    const r = resolveFixedPopoverPosition({ top: 380, bottom: 420, left: 40 }, { width: 320, height: 900 }, viewport);
    expect(r.openUp).toBe(false);
    expect(r.maxHeight).toBe(800 - 426 - 8);
    expect(r.maxHeight).toBeLessThan(900); // 팝오버 실제 높이보다 작다 = 스크롤이 생긴다
  });
});
