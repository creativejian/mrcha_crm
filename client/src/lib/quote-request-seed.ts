import { formatMoney } from "./quote-pricing";

// 앱 견적요청 조건 → 워크벤치 카드1 시드(순수). 도메인 규칙(스펙 표):
// lease/rent: deposit→보증금 행, advance→선수금 행. installment: prepayment→선수금 행(라벨 "선납금"은 표시층).
// 비율>0이면 % 모드(금액 무시 — CRM 최종가 기준 재계산 정합), 비율 0·금액>0이면 금액 모드. cash/무타입/0값은 시드 없음.
export type ScenarioCardSeed = {
  termMonths: number | null;
  depositMode: "percent" | "amount" | null;
  depositValue: string | null;
  downPaymentMode: "percent" | "amount" | null;
  downPaymentValue: string | null;
};

const TERM_OPTIONS = [12, 24, 36, 48, 60];

export function seedScenarioCardFromRequest(req: {
  period: number | null;
  depositType: string | null;
  depositRatio: number | null;
  rentalDeposit: number | null;
  purchaseMethod: string | null;
}): ScenarioCardSeed {
  const termMonths = req.period != null && TERM_OPTIONS.includes(req.period) ? req.period : null;
  const ratio = req.depositRatio ?? 0;
  const amount = req.rentalDeposit ?? 0;
  const mode: "percent" | "amount" | null = ratio > 0 ? "percent" : amount > 0 ? "amount" : null;
  const value = mode === "percent" ? String(ratio) : mode === "amount" ? formatMoney(amount) : null;
  const target: "deposit" | "downPayment" | null =
    req.depositType === "deposit" ? "deposit"
    : req.depositType === "advance" || req.depositType === "prepayment" ? "downPayment"
    : null;
  return {
    termMonths,
    depositMode: target === "deposit" ? mode : null,
    depositValue: target === "deposit" ? value : null,
    downPaymentMode: target === "downPayment" ? mode : null,
    downPaymentValue: target === "downPayment" ? value : null,
  };
}
