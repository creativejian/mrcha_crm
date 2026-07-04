import { describe, expect, it } from "vitest";

import {
  calculateKimQuoteActionFrame,
  calculateKimQuoteStatusTooltip,
  isKimPurchaseFloatingKind,
  kimPurchasePopoverSize,
} from "./popover-frames";

// getBoundingClientRect만 쓰므로 rect를 주입한 가짜 element로 충분하다.
// 뷰포트는 jsdom 기본값(window.innerWidth 1024 / innerHeight 768)을 가정한다.
function mockTarget(rect: Partial<DOMRect>): HTMLElement {
  const full: DOMRect = {
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect;
  return { getBoundingClientRect: () => full } as unknown as HTMLElement;
}

describe("isKimPurchaseFloatingKind", () => {
  it("purchase* 종류만 true로 좁힌다", () => {
    expect(isKimPurchaseFloatingKind("purchaseMethod")).toBe(true);
    expect(isKimPurchaseFloatingKind("purchaseReviewNotes")).toBe(true);
    expect(isKimPurchaseFloatingKind("status")).toBe(false);
    expect(isKimPurchaseFloatingKind("schedule")).toBe(false);
  });
});

describe("kimPurchasePopoverSize", () => {
  it("종류별 고정 크기를 반환한다", () => {
    expect(kimPurchasePopoverSize("purchaseMethod")).toEqual({ width: 390, height: 48 });
    expect(kimPurchasePopoverSize("purchaseInitialCost")).toEqual({ width: 330, height: 146 });
    expect(kimPurchasePopoverSize("purchaseCustomerNotes")).toEqual({ width: 380, height: 154 });
  });
});

describe("calculateKimQuoteActionFrame", () => {
  it("타깃 오른쪽에 붙이되 뷰포트 우측을 넘지 않는다", () => {
    // rect.right+8=108 < (1024-214-10)=800 → left=108
    expect(calculateKimQuoteActionFrame(mockTarget({ right: 100, bottom: 200 }))).toEqual({ top: 200, left: 108 });
    // rect.right 매우 큼 → 우측 한계 800으로 clamp
    expect(calculateKimQuoteActionFrame(mockTarget({ right: 1000, bottom: 50 }))).toEqual({ top: 50, left: 800 });
  });
});

describe("calculateKimQuoteStatusTooltip", () => {
  it("타깃 위쪽에 두고 id를 보존한다", () => {
    // top: max(10, 50-8)=42, left: min(1014, max(10,30))=30
    expect(calculateKimQuoteStatusTooltip(mockTarget({ top: 50, left: 30 }), "q1")).toEqual({ id: "q1", top: 42, left: 30 });
    // 상단 경계: top 5 → max(10, -3)=10
    expect(calculateKimQuoteStatusTooltip(mockTarget({ top: 5, left: 5 }), "q2")).toEqual({ id: "q2", top: 10, left: 10 });
  });
});
