import { describe, expect, it } from "vitest";

import { badgePopoverPos } from "./PendingRequestBadge";

// 배지 팝오버 좌표(플립 포함)의 순수 잠금 — 마지막 행 배지가 아래로 열려 뷰포트를 뚫던
// 실기 버그(2026-08-03)의 회귀 그물. mc-master는 페이지 스크롤이 잠겨 있어 잘리면 못 본다.

const VIEWPORT = { width: 1400, height: 900 };
const rect = (top: number, bottom: number, left = 100) => ({ top, bottom, left }) as DOMRect;

describe("badgePopoverPos", () => {
  it("아래 공간이 충분하면 배지 아래로 연다(top 앵커)", () => {
    const pos = badgePopoverPos(rect(100, 120), VIEWPORT)!;
    expect(pos.top).toBe(124); // bottom + 4
    expect(pos.bottom).toBeUndefined();
    expect(pos.maxHeight).toBe(900 - 120 - 16);
  });

  it("아래 공간이 240 미만이면 위로 편다(bottom 앵커 — top 없음)", () => {
    const pos = badgePopoverPos(rect(700, 720), VIEWPORT)!;
    expect(pos.top).toBeUndefined();
    expect(pos.bottom).toBe(900 - 700 + 4); // 뷰포트 하단 기준 — 배지 위 4px에서 위로 자란다
    expect(pos.maxHeight).toBe(700 - 16);
  });

  it("위도 좁은 극단(작은 창)에서는 maxHeight 하한 160을 지킨다", () => {
    const pos = badgePopoverPos(rect(60, 80), { width: 1400, height: 300 })!;
    expect(pos.bottom).toBe(300 - 60 + 4);
    expect(pos.maxHeight).toBe(160);
  });

  it("left는 팝오버 폭(736) 기준으로 클램프된다(popoverPosFromRect와 같은 규칙)", () => {
    expect(badgePopoverPos(rect(100, 120, 1300), VIEWPORT)!.left).toBe(1400 - 736);
    expect(badgePopoverPos(rect(100, 120, 2), VIEWPORT)!.left).toBe(8);
  });

  it("rect가 없으면 null", () => {
    expect(badgePopoverPos(undefined, VIEWPORT)).toBeNull();
  });
});
