import { formatMoney } from "./quote-pricing";

// 앱 견적요청 조건 → 워크벤치 카드1 시드(순수). 도메인 규칙(스펙 표):
// lease/rent: deposit→보증금 행, advance→선수금 행. installment: prepayment→선수금 행(라벨 "선납금"은 표시층).
// 비율>0이면 % 모드(금액 무시 — CRM 최종가 기준 재계산 정합), 비율 0·금액>0이면 금액 모드. cash/무타입/0값은 시드 없음.
// 구현은 depositType만으로 행을 정한다(초기비용 유형이 구매방식과 1:1 대응 — 일시불만 코드 가드).
// 주의: depositLabelOf(quote-requests.ts)는 병기(비율+금액 동시 표시) — 여기는 비율 우선·금액 무시. 복붙 금지.
// 주의: 시드 값은 표시/입력 보조일 뿐 — 카드1이 채워짐(금융사 선택 or 월납입>0) 판정돼야 저장된다(extractWorkbenchScenarios isFilled 게이트).
export type ScenarioCardSeed = {
  termMonths: number | null; // null = 소비 측이 기본 60 유지(버튼 옵션 밖 기간 포함)
  depositMode: "percent" | "amount" | null;
  depositValue: string | null;
  downPaymentMode: "percent" | "amount" | null;
  downPaymentValue: string | null;
};

const TERM_OPTIONS = [12, 24, 36, 48, 60];

function termMonthsOf(period: number | null): number | null {
  return period != null && TERM_OPTIONS.includes(period) ? period : null;
}

export function seedScenarioCardFromRequest(req: {
  period: number | null;
  depositType: string | null;
  depositRatio: number | null;
  rentalDeposit: number | null;
  purchaseMethod: string | null;
}): ScenarioCardSeed {
  const termMonths = termMonthsOf(req.period);
  // 도메인 규칙(스펙 표): 일시불은 초기비용 없음 — depositType이 어긋나게 실려 와도 시드하지 않는다(방어).
  if (req.purchaseMethod === "일시불") {
    return { termMonths, depositMode: null, depositValue: null, downPaymentMode: null, downPaymentValue: null };
  }
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
