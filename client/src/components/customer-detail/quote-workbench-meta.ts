// 견적 워크벤치 영역(9b~9e)의 타입·상수·순수 헬퍼 — 본체에서 이동(동작/값 무변경).
// 훅(useQuoteWorkbench)과 컴포넌트(QuoteWorkbench)가 공유한다.

import { PURCHASE_METHOD_OPTIONS, type PurchaseMethod } from "@/data/customers";
import { type QuoteItem } from "@/lib/quote-items";
import { type QuoteGuidance } from "@/data/quote-guidance";
import { computePricing, type PricingInputs } from "@/lib/quote-pricing";

export type KimDiscountUnit = "amount" | "percent";
export type KimDiscountLine = { id: string; label: string; amount: string; unit: KimDiscountUnit };
export type KimManualDepositMode = "none" | "amount" | "percent";
export type KimManualResidualMode = "max" | "amount" | "percent";
export type KimManualMileageMode = "basic" | "custom";
export type KimManualCard = {
  id: string; title: string; round: string; copyLabel: string;
  lender: string; monthlyPayment: string;
  totalReturn: string; totalTakeover: string; dueAtDelivery: string; interestRate: string;
  depositMode: KimManualDepositMode; depositValue: string;
  downPaymentMode: KimManualDepositMode; downPaymentValue: string;
  residualMode: KimManualResidualMode; residualValue: string;
};
export const kimDiscountLabelOptions = ["재구매 할인", "법인 추가 할인", "기타"] as const;
export const kimManualMileageOptions = [
  "10,000km / 년",
  "15,000km / 년",
  "20,000km / 년",
  "25,000km / 년",
  "30,000km / 년",
  "35,000km / 년",
  "40,000km / 년",
] as const;
export type KimAcquisitionTaxMode = "normal" | "hybrid" | "electric" | "manual";

export type KimQuoteEntryMode = "solution" | "manual" | "original";
export type KimQuotePurchaseMethod = PurchaseMethod;
export type KimRecognizedQuoteFile = { file: File; fileName: string; fileSize: number; mimeType: string };
export type KimEditScenario = {
  scenarioNo: number;
  lender: string;
  monthlyPayment: string;
  termMonths: number;
  depositMode: KimManualDepositMode;
  depositValue: string;
  downPaymentMode: KimManualDepositMode;
  downPaymentValue: string;
  residualMode: KimManualResidualMode;
  residualValue: string;
  mileageMode: KimManualMileageMode;
  mileageValue: string;
};
export type KimEditPrefill = {
  optionIds: number[];
  exteriorColorId: number | null;
  interiorColorId: number | null;
  pricing: { base: number; option: number; discount: number; acquisitionTax: number; bond: number; delivery: number; incidental: number };
  scenarios: KimEditScenario[];
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
export const kimMaybachQuotePricingResult = computePricing(emptyQuotePricing);

export const emptyQuoteConditionCards: KimManualCard[] = [
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
    depositMode: "none" as KimManualDepositMode,
    depositValue: "0",
    downPaymentMode: "none" as KimManualDepositMode,
    downPaymentValue: "0",
    residualMode: "max" as KimManualResidualMode,
    residualValue: "-",
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
    depositMode: "none" as KimManualDepositMode,
    depositValue: "0",
    downPaymentMode: "none" as KimManualDepositMode,
    downPaymentValue: "0",
    residualMode: "max" as KimManualResidualMode,
    residualValue: "-",
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
    depositMode: "none" as KimManualDepositMode,
    depositValue: "0",
    downPaymentMode: "none" as KimManualDepositMode,
    downPaymentValue: "0",
    residualMode: "max" as KimManualResidualMode,
    residualValue: "-",
  },
] as const;

export const kimQuotePurchaseMethodOptions = PURCHASE_METHOD_OPTIONS;

export function normalizeKimQuotePurchaseMethod(value?: string): KimQuotePurchaseMethod {
  if (value && kimQuotePurchaseMethodOptions.includes(value as KimQuotePurchaseMethod)) return value as KimQuotePurchaseMethod;
  return "운용리스";
}

export function primaryKimQuotePurchaseMethod(fields: { label: string; value: string }[]) {
  return normalizeKimQuotePurchaseMethod(fields.find((field) => field.label === "구매방식")?.value);
}

export function createKimQuoteCode(existingQuotes: QuoteItem[]) {
  const yearMonth = "2606";
  const nextSequence = existingQuotes.reduce((max, quote) => {
    const match = quote.quoteCode.match(/^QT-\d{4}-(\d{4})$/);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0) + 1;
  return `QT-${yearMonth}-${String(nextSequence).padStart(4, "0")}`;
}
