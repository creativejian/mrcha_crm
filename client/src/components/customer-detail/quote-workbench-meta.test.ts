import { describe, expect, it } from "vitest";

import { restoreDiscountLines } from "./quote-workbench-meta";

// 수정 진입 시 할인 구성 내역(discount_lines) 복원 — 행 state 재구성 + 기본 할인 분리 산술.
// 기본 할인은 별도 저장하지 않으므로 finalDiscount(총액) − Σ추가 행 환산액으로 역산한다.
describe("restoreDiscountLines", () => {
  it("저장본 없으면(null/빈 배열) 빈 행 + 기본 할인 = finalDiscount 전액(기존 동작 보존)", () => {
    expect(restoreDiscountLines(null, 75_300_000, 6_500_000, 1000)).toEqual({ lines: [], primaryDiscount: 6_500_000 });
    expect(restoreDiscountLines([], 75_300_000, 6_500_000, 1000)).toEqual({ lines: [], primaryDiscount: 6_500_000 });
  });

  it("금액 행: 표시값은 콤마 포맷, 기본 할인 = 총액 − 행 합", () => {
    const r = restoreDiscountLines([{ label: "재구매 할인", amount: 500_000, unit: "amount" }], 75_300_000, 6_500_000, 1000);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ label: "재구매 할인", amount: "500,000", unit: "amount" });
    expect(r.primaryDiscount).toBe(6_000_000);
  });

  it("percent 행: 표시값은 원문 유지(소수 보존), 환산은 base+option 기준 반올림(syncDiscountTotalFromRows와 동일 산술)", () => {
    const r = restoreDiscountLines([{ label: "프로모션", amount: 1.5, unit: "percent" }], 75_300_000, 6_500_000, 1000);
    expect(r.lines[0]).toMatchObject({ label: "프로모션", amount: "1.5", unit: "percent" });
    expect(r.primaryDiscount).toBe(6_500_000 - 1_129_500); // 75,300,000 × 1.5% = 1,129,500
  });

  it("혼합 다행: 각 행 복원 + 환산 합산", () => {
    const r = restoreDiscountLines(
      [
        { label: "재구매 할인", amount: 500_000, unit: "amount" },
        { label: "프로모션", amount: 1.5, unit: "percent" },
      ],
      75_300_000, 6_500_000, 1000,
    );
    expect(r.lines.map((l) => l.label)).toEqual(["재구매 할인", "프로모션"]);
    expect(r.primaryDiscount).toBe(6_500_000 - 500_000 - 1_129_500);
  });

  it("행 id는 idBase+index로 매번 새로 발급(uncontrolled defaultValue 리마운트 보장)", () => {
    const r = restoreDiscountLines(
      [
        { label: "A", amount: 1, unit: "amount" },
        { label: "B", amount: 2, unit: "amount" },
      ],
      0, 10, 42,
    );
    expect(r.lines.map((l) => l.id)).toEqual(["discount-42-0", "discount-42-1"]);
  });

  it("추가 행 합이 총액을 넘으면 기본 할인 0으로 클램프(음수면 parseMoney가 부호를 버려 오염)", () => {
    const r = restoreDiscountLines([{ label: "A", amount: 9_000_000, unit: "amount" }], 0, 6_500_000, 1);
    expect(r.primaryDiscount).toBe(0);
  });
});
