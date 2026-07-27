import { describe, expect, it } from "vitest";

import { residualLabelOf } from "./app-card-labels";

// 파트너 응답 raw의 잔존 부분만 최소 형태로(파서가 monthlyPayment·금리까지 요구한다).
const snapshotWith = (residual: Record<string, unknown>) => ({
  ok: true,
  quote: {
    monthlyPayment: 1841200,
    rates: { annualRateDecimal: 0.0532 },
    residual,
  },
});

const OPTS = { noneLabel: "계산 후 안내", percentFirst: false };
const COND = { noneLabel: "계산 후 안내", percentFirst: true };

describe("residualLabelOf — max 모드는 솔루션 스냅샷의 실채택 잔가를 읽는다", () => {
  // 실측 스냅샷(iM캐피탈 520i M Spt): amount 41,880,000 / rateDecimal 0.6.
  const snap = snapshotWith({ amount: 41880000, rateDecimal: 0.6, source: "residual-matrix" });

  it("요약용은 금액 선행", () => {
    expect(residualLabelOf("max", null, 74300000, snap, OPTS)).toBe("41,880,000원 (60%)");
  });

  it("상세용은 % 선행", () => {
    expect(residualLabelOf("max", null, 74300000, snap, COND)).toBe("(60%) 41,880,000원");
  });

  it("% 는 스냅샷 rateDecimal이 기준 — 차량가로 재계산하지 않는다", () => {
    // 41,880,000 / 74,300,000 = 56.37%지만 파트너가 적용한 율은 60%다. 파트너 값이 SSOT.
    expect(residualLabelOf("max", null, 74300000, snap, OPTS)).toContain("(60%)");
  });

  it("소수 율도 잘리지 않는다", () => {
    const s = snapshotWith({ amount: 41880000, rateDecimal: 0.575 });
    expect(residualLabelOf("max", null, 74300000, s, OPTS)).toBe("41,880,000원 (57.5%)");
  });
});

describe("residualLabelOf — 스냅샷이 없으면 기존 '최대' 폴백", () => {
  it("파트너 조회 없이 max만 고른 시나리오", () => {
    expect(residualLabelOf("max", null, 74300000, null, OPTS)).toBe("최대");
  });

  it("스냅샷이 깨졌거나 잔존 금액이 빠졌으면 폴백", () => {
    expect(residualLabelOf("max", null, 74300000, { ok: false }, OPTS)).toBe("최대");
    expect(residualLabelOf("max", null, 74300000, snapshotWith({ rateDecimal: 0.6 }), OPTS)).toBe("최대");
  });
});

describe("residualLabelOf — max 외 모드는 기존 moneyModeLabel 그대로", () => {
  it("percent는 차량가 환산 병기", () => {
    expect(residualLabelOf("percent", "58", 74300000, null, OPTS)).toBe("43,094,000원 (58%)");
    expect(residualLabelOf("percent", "58", 74300000, null, COND)).toBe("(58%) 43,094,000원");
  });

  it("amount는 금액만", () => {
    expect(residualLabelOf("amount", "43094000", 74300000, null, OPTS)).toBe("43,094,000원");
  });

  it("none/null은 noneLabel", () => {
    expect(residualLabelOf("none", null, 74300000, null, OPTS)).toBe("계산 후 안내");
    expect(residualLabelOf(null, null, 74300000, null, OPTS)).toBe("계산 후 안내");
  });

  it("스냅샷이 있어도 max가 아니면 무시한다(수기 %가 우선)", () => {
    const snap = snapshotWith({ amount: 41880000, rateDecimal: 0.6 });
    expect(residualLabelOf("percent", "58", 74300000, snap, OPTS)).toBe("43,094,000원 (58%)");
  });
});
