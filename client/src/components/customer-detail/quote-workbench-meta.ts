// 견적 워크벤치 영역(9b~9e)의 타입·상수·순수 헬퍼 — 본체에서 이동(동작/값 무변경).
// 훅(useQuoteWorkbench)과 컴포넌트(QuoteWorkbench)가 공유한다.

import { PURCHASE_METHOD_OPTIONS, type PurchaseMethod } from "@/data/customers";
import { type QuoteDiscountLine, type QuoteItem } from "@/lib/quote-items";
import { type QuoteGuidance } from "@/data/quote-guidance";
import { computePricing, formatMoney, type PricingInputs } from "@/lib/quote-pricing";

export type DiscountUnit = "amount" | "percent";
export type DiscountLine = { id: string; label: string; amount: string; unit: DiscountUnit };

// 할인 행 1개의 원화 환산 — percent 행 환산 기준(basis) = basePrice + optionTotal.
// 역산 복원(restoreDiscountLines)·총액 합산(syncDiscountTotalFromRows)·단위 전환(convertDiscountInputUnit)
// 3소비처가 공유하는 단일 산술(배치 F) — 역산↔정산 산술이 어긋나면 수정 재진입 때 기본 할인이
// 조용히 오염되는 load-bearing 불변이라, 주석 계약이 아니라 함수 1벌로 잠근다.
export function discountLineWon(unit: DiscountUnit, value: number, basis: number): number {
  return unit === "percent" ? Math.round(basis * value / 100) : value;
}

// 수정 진입 복원: 저장된 할인 구성 내역(crm.quotes.discount_lines) → 워크벤치 행 state + 기본 할인 분리 산술.
// 기본 할인은 별도 저장하지 않는다 — finalDiscount(총액) − Σ추가 행 환산액(discountLineWon 공유 산술)으로 역산.
// 행 id는 idBase(nowMs)+index로 매번 새로 발급 — uncontrolled input(defaultValue)의 리마운트를 보장.
export function restoreDiscountLines(
  saved: QuoteDiscountLine[] | null | undefined,
  discountBasis: number, // basePrice + optionTotal
  finalDiscount: number,
  idBase: number,
): { lines: DiscountLine[]; primaryDiscount: number } {
  const rows = saved ?? [];
  const lines: DiscountLine[] = rows.map((s, i) => ({
    id: `discount-${idBase}-${i}`,
    label: s.label,
    // percent는 원문(소수 보존 — 콤마 포맷 우회 표시 규약), amount는 콤마 포맷(금액 입력칸 표시 규약).
    amount: s.unit === "percent" ? String(s.amount) : formatMoney(s.amount),
    unit: s.unit,
  }));
  const additional = rows.reduce((sum, s) => sum + discountLineWon(s.unit, s.amount, discountBasis), 0);
  // 음수 클램프: 총액보다 행 합이 크면(과거 데이터 드리프트) parseMoney가 음수 부호를 버려 오염되므로 0이 안전.
  return { lines, primaryDiscount: Math.max(0, finalDiscount - additional) };
}
export type ManualDepositMode = "none" | "amount" | "percent";
export type ManualResidualMode = "max" | "amount" | "percent";
export type ManualMileageMode = "basic" | "custom";
export type ManualCard = {
  id: string; title: string; round: string; copyLabel: string;
  lender: string; monthlyPayment: string;
  totalReturn: string; totalTakeover: string; dueAtDelivery: string; interestRate: string;
  depositMode: ManualDepositMode; depositValue: string;
  downPaymentMode: ManualDepositMode; downPaymentValue: string;
  residualMode: ManualResidualMode; residualValue: string;
  subsidyAmount: string;
};
export const discountLabelOptions = ["재구매 할인", "법인 추가 할인", "기타"] as const;
export const manualMileageOptions = [
  "10,000km / 년",
  "15,000km / 년",
  "20,000km / 년",
  "25,000km / 년",
  "30,000km / 년",
  "35,000km / 년",
  "40,000km / 년",
] as const;
export type AcquisitionTaxMode = "normal" | "hybrid" | "electric" | "manual";

export type QuoteEntryMode = "solution" | "manual" | "original";
export type QuotePurchaseMethod = PurchaseMethod;
export type RecognizedQuoteFile = { file: File; fileName: string; fileSize: number; mimeType: string };
export type EditScenario = {
  scenarioNo: number;
  lender: string;
  monthlyPayment: string;
  termMonths: number;
  depositMode: ManualDepositMode;
  depositValue: string;
  downPaymentMode: ManualDepositMode;
  downPaymentValue: string;
  residualMode: ManualResidualMode;
  residualValue: string;
  mileageMode: ManualMileageMode;
  mileageValue: string;
  carTaxIncluded: boolean;
  subsidyApplicable: boolean;
  subsidyAmount: string;
  totalReturnCost: string;
  totalTakeoverCost: string;
  dueAtDelivery: string;
  interestRate: string;
};
export type EditPrefill = {
  optionIds: number[];
  exteriorColorId: number | null;
  interiorColorId: number | null;
  // discount는 총액(data-pricing="discount" 입력), primaryDiscount는 기본 할인 행(총액 − 추가 행 환산 합 —
  // restoreDiscountLines 역산 결과. 추가 행 없으면 총액과 동일).
  pricing: { base: number; option: number; discount: number; primaryDiscount: number; acquisitionTax: number; bond: number; delivery: number; incidental: number };
  scenarios: EditScenario[];
  guidance: QuoteGuidance | null;
};

export const emptyQuotePricing: PricingInputs = {
  basePrice: 0,
  optionPrice: 0,
  discount: 0,
  acquisitionTax: 0,
  bond: 0,
  delivery: 0,
  incidental: 0,
};
// 워크벤치 pricing 초기 state(빈 기본값 계산 결과) — 이름은 목업 시절 maybachQuotePricingResult에서 정리(0705 배치 D).
export const initialQuotePricingResult = computePricing(emptyQuotePricing);

export const emptyQuoteConditionCards: ManualCard[] = [
  {
    id: "manual-condition-1",
    title: "견적 작성",
    round: "1",
    copyLabel: "",
    // round1도 비교 슬롯(2·3)과 동일한 빈 기본값 — 미입력 시 extractWorkbenchScenarios가 filled로 보지 않아
    // 신규 작성완료 시 가짜 금융 mock이 저장되지 않는다(사용자 입력 시에만 저장). display-only 필드도 0/placeholder.
    lender: "미선택",
    monthlyPayment: "0",
    totalReturn: "0",
    totalTakeover: "0",
    dueAtDelivery: "0",
    interestRate: "0",
    depositMode: "none" as ManualDepositMode,
    depositValue: "0",
    downPaymentMode: "none" as ManualDepositMode,
    downPaymentValue: "0",
    residualMode: "max" as ManualResidualMode,
    residualValue: "-",
    subsidyAmount: "0",
  },
  {
    id: "manual-condition-2",
    title: "견적 작성",
    round: "2",
    copyLabel: "1번 복사",
    lender: "미선택",
    monthlyPayment: "0",
    totalReturn: "0",
    totalTakeover: "0",
    dueAtDelivery: "0",
    interestRate: "0",
    depositMode: "none" as ManualDepositMode,
    depositValue: "0",
    downPaymentMode: "none" as ManualDepositMode,
    downPaymentValue: "0",
    residualMode: "max" as ManualResidualMode,
    residualValue: "-",
    subsidyAmount: "0",
  },
  {
    id: "manual-condition-3",
    title: "견적 작성",
    round: "3",
    copyLabel: "2번 복사",
    lender: "미선택",
    monthlyPayment: "0",
    totalReturn: "0",
    totalTakeover: "0",
    dueAtDelivery: "0",
    interestRate: "0",
    depositMode: "none" as ManualDepositMode,
    depositValue: "0",
    downPaymentMode: "none" as ManualDepositMode,
    downPaymentValue: "0",
    residualMode: "max" as ManualResidualMode,
    residualValue: "-",
    subsidyAmount: "0",
  },
] as const;

export const quotePurchaseMethodOptions = PURCHASE_METHOD_OPTIONS;

export function normalizeQuotePurchaseMethod(value?: string): QuotePurchaseMethod {
  if (value && quotePurchaseMethodOptions.includes(value as QuotePurchaseMethod)) return value as QuotePurchaseMethod;
  return "운용리스";
}

export function primaryQuotePurchaseMethod(fields: { label: string; value: string }[]) {
  return normalizeQuotePurchaseMethod(fields.find((field) => field.label === "구매방식")?.value);
}

export function createQuoteCode(existingQuotes: QuoteItem[]) {
  const yearMonth = "2606";
  const nextSequence = existingQuotes.reduce((max, quote) => {
    const match = quote.quoteCode.match(/^QT-\d{4}-(\d{4})$/);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0) + 1;
  return `QT-${yearMonth}-${String(nextSequence).padStart(4, "0")}`;
}
