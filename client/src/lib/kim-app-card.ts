import type { QuoteGuidance } from "@/data/quote-guidance";
import type { ScenarioInput } from "./customer-quotes";
import { formatScenarioMoneyMode, formatTerm } from "./kim-quote";
import { formatMoney } from "./quote-pricing";

// 미리보기 카드 조립 입력. 워크벤치 state에서 추출한 스냅샷(순수 변환을 위해 원시값만 받는다).
export type AppCardModelInput = {
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  modelYear: number | null;
  basePrice: number;
  discount: number;
  finalVehiclePrice: number;
  registrationCost: number;
  acquisitionCost: number;
  exteriorColorName: string | null;
  interiorColorName: string | null;
  guidance: QuoteGuidance;
  purchaseMethod: string;
  scenario: ScenarioInput | null;
};

// 카드 표시용 라벨 모델. KimAppCardPreview가 이 값을 그대로 렌더한다.
export type AppCardModel = {
  brand: string;
  modelLabel: string;
  trimLabel: string;
  yearLabel: string;
  basePriceLabel: string;
  discountLabel: string;
  purchaseMethod: string;
  termLabel: string;
  monthlyLabel: string;
  rateLabel: string;
  residualLabel: string;
  totalCostLabel: string;
  depositLabel: string;
  downPaymentLabel: string;
  mileageLabel: string;
  lenderLabel: string;
  exteriorColorLabel: string;
  interiorColorLabel: string;
  stockNotice: string;
  expectedDelivery: string;
  customerRegion: string;
  finalVehiclePriceLabel: string;
  registrationCostLabel: string;
  acquisitionCostLabel: string;
  hasScenario: boolean;
};

// 계산엔진 미연결 필드(금리/총비용)는 가짜 숫자 대신 정직한 안내 텍스트로 표시한다.
const CALC_PENDING = "계산 후 안내";
const NO_SOURCE = "—";
const DEFAULT_MILEAGE = "20,000km / 년";

function monthlyLabelOf(raw: string | null | undefined): string {
  if (!raw) return CALC_PENDING;
  const n = Number(raw);
  return Number.isNaN(n) ? CALC_PENDING : `${formatMoney(n)}원`;
}

export function buildAppCardModel(input: AppCardModelInput): AppCardModel {
  const s = input.scenario;
  return {
    brand: input.brandName ?? "차량 미선택",
    modelLabel: input.modelName ?? "차량 미선택",
    trimLabel: input.trimName ?? "",
    yearLabel: input.modelYear != null ? `${input.modelYear}년식` : "",
    basePriceLabel: formatMoney(input.basePrice),
    discountLabel: formatMoney(input.discount),
    purchaseMethod: input.purchaseMethod,
    termLabel: formatTerm(s?.termMonths ?? null),
    monthlyLabel: monthlyLabelOf(s?.monthlyPayment),
    rateLabel: NO_SOURCE,
    residualLabel: formatScenarioMoneyMode(s?.residualMode ?? null, s?.residualValue ?? null) ?? CALC_PENDING,
    totalCostLabel: CALC_PENDING,
    depositLabel: formatScenarioMoneyMode(s?.depositMode ?? null, s?.depositValue ?? null) ?? "조건 미정",
    downPaymentLabel: formatScenarioMoneyMode(s?.downPaymentMode ?? null, s?.downPaymentValue ?? null) ?? "없음",
    mileageLabel: s?.mileageValue ?? DEFAULT_MILEAGE,
    lenderLabel: s?.lender ?? "금융사 미정",
    exteriorColorLabel: input.exteriorColorName ?? "미선택",
    interiorColorLabel: input.interiorColorName ?? "미선택",
    stockNotice: input.guidance.stockNotice,
    expectedDelivery: input.guidance.expectedDelivery,
    customerRegion: input.guidance.customerRegion,
    finalVehiclePriceLabel: formatMoney(input.finalVehiclePrice),
    registrationCostLabel: formatMoney(input.registrationCost),
    acquisitionCostLabel: formatMoney(input.acquisitionCost),
    hasScenario: s != null,
  };
}
