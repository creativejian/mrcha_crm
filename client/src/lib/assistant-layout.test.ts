import { describe, expect, it } from "vitest";

import { NEW_TURN_TOP_GAP, NEW_TURN_BOTTOM_GAP, computeTurnMinHeight } from "./assistant-layout";

describe("computeTurnMinHeight (앱 latestChatTimelineTurnMinHeight 미러)", () => {
  it("body 높이 − 상단 20 − 하단 28 − 질문 높이", () => {
    expect(NEW_TURN_TOP_GAP).toBe(20);
    expect(NEW_TURN_BOTTOM_GAP).toBe(28);
    expect(computeTurnMinHeight(600, 40)).toBe(600 - 20 - 28 - 40);
  });

  it("음수가 되면 0으로 클램프(작은 팝오버 + 긴 질문)", () => {
    expect(computeTurnMinHeight(100, 200)).toBe(0);
  });
});
