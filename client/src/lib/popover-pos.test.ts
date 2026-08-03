import { describe, expect, it } from "vitest";

import { popoverPos } from "./popover-pos";

// 팝오버 fixed 좌표의 순수 잠금. 플립 축(flipBelow)은 마지막 행 배지가 아래로 열려 뷰포트를
// 뚫던 실기 버그(2026-08-03)의 회귀 그물이다 — mc-master는 페이지 스크롤이 잠겨 있어 잘리면
// 못 본다. 플립을 안 주는 헤더 버튼 팝오버는 언제나 아래로 연다(구 popoverPosFromRect 동작).

const VIEWPORT = { width: 1400, height: 900 };
const rect = (top: number, bottom: number, left = 100) => ({ top, bottom, left }) as DOMRect;
/** 행 배지가 쓰는 플립 기준 — 요청 카드 1장(머리줄+diff+액션)이 잘리지 않는 최소치. */
const BADGE = { flipBelow: 240 };

describe("popoverPos", () => {
  it("아래 공간이 충분하면 배지 아래로 연다(top 앵커)", () => {
    const pos = popoverPos(rect(100, 120), VIEWPORT, BADGE)!;
    expect(pos.top).toBe(124); // bottom + 4
    expect(pos.bottom).toBeUndefined();
    expect(pos.maxHeight).toBe(900 - 120 - 16);
  });

  it("아래 공간이 flipBelow 미만이면 위로 편다(bottom 앵커 — top 없음)", () => {
    const pos = popoverPos(rect(700, 720), VIEWPORT, BADGE)!;
    expect(pos.top).toBeUndefined();
    expect(pos.bottom).toBe(900 - 700 + 4); // 뷰포트 하단 기준 — 배지 위 4px에서 위로 자란다
    expect(pos.maxHeight).toBe(700 - 16);
  });

  it("위도 좁은 극단(작은 창)에서는 maxHeight 하한 160을 지킨다", () => {
    const pos = popoverPos(rect(60, 80), { width: 1400, height: 300 }, BADGE)!;
    expect(pos.bottom).toBe(300 - 60 + 4);
    expect(pos.maxHeight).toBe(160);
  });

  it("flipBelow가 없으면 아래가 좁아도 아래로 연다(헤더 버튼 팝오버 — 구 popoverPosFromRect)", () => {
    const pos = popoverPos(rect(700, 720), VIEWPORT)!;
    expect(pos.top).toBe(724);
    expect(pos.bottom).toBeUndefined();
    expect(pos.maxHeight).toBe(164); // 900-720-16 = 164 (하한 160 위)
  });

  it("left는 팝오버 폭(736) 기준으로 클램프된다(플립 여부와 무관)", () => {
    expect(popoverPos(rect(100, 120, 1300), VIEWPORT, BADGE)!.left).toBe(1400 - 736);
    expect(popoverPos(rect(100, 120, 2), VIEWPORT, BADGE)!.left).toBe(8);
    expect(popoverPos(rect(100, 120, 1300), VIEWPORT)!.left).toBe(1400 - 736);
  });

  it("rect가 없으면 null", () => {
    expect(popoverPos(undefined, VIEWPORT, BADGE)).toBeNull();
    expect(popoverPos(undefined, VIEWPORT)).toBeNull();
  });
});
