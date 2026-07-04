import { describe, expect, it } from "vitest";
import { seedScenarioCardFromRequest } from "./quote-request-seed";

const base = { period: 60, depositType: null as string | null, depositRatio: 0, rentalDeposit: 0, purchaseMethod: "운용리스" };

describe("seedScenarioCardFromRequest", () => {
  it("리스+보증금 비율: % 모드+비율값(금액 무시 — 최종가 재계산 정합)", () => {
    const s = seedScenarioCardFromRequest({ ...base, depositType: "deposit", depositRatio: 20, rentalDeposit: 11800000 });
    expect(s).toEqual({ termMonths: 60, depositMode: "percent", depositValue: "20", downPaymentMode: null, downPaymentValue: null });
  });
  it("리스+선수금 금액만: 선수금 행 금액 모드+콤마 포맷", () => {
    const s = seedScenarioCardFromRequest({ ...base, depositType: "advance", depositRatio: 0, rentalDeposit: 5000000 });
    expect(s).toEqual({ termMonths: 60, depositMode: null, depositValue: null, downPaymentMode: "amount", downPaymentValue: "5,000,000" });
  });
  it("할부+선납금: 선수금 행 금액 시드(라벨 전환은 표시층 책임)", () => {
    const s = seedScenarioCardFromRequest({ ...base, purchaseMethod: "할부", depositType: "prepayment", rentalDeposit: 3000000 });
    expect(s.downPaymentMode).toBe("amount");
    expect(s.downPaymentValue).toBe("3,000,000");
    expect(s.depositMode).toBeNull();
  });
  it("일시불/무타입/값 0: 초기비용 시드 없음", () => {
    expect(seedScenarioCardFromRequest({ ...base, purchaseMethod: "일시불" })).toEqual({ termMonths: 60, depositMode: null, depositValue: null, downPaymentMode: null, downPaymentValue: null });
    expect(seedScenarioCardFromRequest({ ...base, depositType: "deposit" }).depositMode).toBeNull(); // 비율·금액 둘 다 0
  });
  it("기간이 버튼 옵션 밖이면 null(60 유지)", () => {
    expect(seedScenarioCardFromRequest({ ...base, period: 72 }).termMonths).toBeNull();
    expect(seedScenarioCardFromRequest({ ...base, period: 36 }).termMonths).toBe(36);
  });
});
