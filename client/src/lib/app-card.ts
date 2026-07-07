import type { QuoteGuidance } from "@/data/quote-guidance";
import {
  CALC_PENDING,
  NO_SOURCE,
  acquisitionTaxModeLabelOf,
  formatTerm,
  mileageLabelOf,
  moneyLabelOf,
  moneyModeLabel,
  numOr,
  splitService,
  vehicleTitleOf,
  downPaymentRowLabelOf,
} from "./app-card-labels";
import { formatActivity } from "./customers";
import type { ScenarioInput } from "./customer-quotes";
import { validLabelFromUntil } from "./quote-items";
import { formatMoney } from "./quote-pricing";

// 미리보기 카드 조립 입력. 워크벤치 state에서 추출한 스냅샷(순수 변환을 위해 원시값만 받는다).
export type AppCardModelInput = {
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  modelYear: number | null;
  basePrice: number;
  optionTotal: number;
  optionNames: string[];
  discount: number;
  discountLabels: string[];
  finalVehiclePrice: number;
  acquisitionTax: number;
  acquisitionTaxMode: "normal" | "hybrid" | "electric" | "manual";
  bond: number;
  delivery: number;
  incidental: number;
  registrationCost: number;
  acquisitionCost: number;
  exteriorColorName: string | null;
  interiorColorName: string | null;
  guidance: QuoteGuidance;
  purchaseMethod: string;
  scenario: ScenarioInput | null;
  quoteCode: string | null;
  appStatus: string | null;
  sentAtIso: string | null;
  validUntilIso: string | null;
  nowMs: number;
};

// 카드 표시용 라벨 모델(4섹션). AppCardPreview가 이 값을 그대로 렌더한다.
export type AppCardModel = {
  // 섹션 1 — 헤더·핵심 요약
  statusLabel: string;
  ddayLabel: string;
  brand: string;
  vehicleTitle: string;
  purchaseMethod: string;
  termLabel: string;
  sublineLabel: string;
  monthlyLabel: string;
  rateChipLabel: string | null;
  residualLabel: string;
  residualCondLabel: string;
  totalCostLabel: string;
  discountRowLabel: string;
  discountLabel: string;
  depositLabel: string;
  mileageLabel: string;
  keyPoints: string[];
  // 섹션 2 — 출고 정보 + 취득원가 구성
  deliveryComment: string;
  exteriorColorLabel: string;
  interiorColorLabel: string;
  optionSummaryLabel: string;
  stockNotice: string;
  expectedDelivery: string;
  customerRegion: string;
  basePriceLabel: string;
  optionTotalLabel: string;
  finalVehiclePriceLabel: string;
  acquisitionTaxLabel: string;
  acquisitionTaxModeLabel: string;
  bondLabel: string;
  deliveryFeeLabel: string;
  incidentalLabel: string;
  registrationCostLabel: string;
  acquisitionCostLabel: string;
  // 섹션 3 — 추천 견적 조건(대표 시나리오 전체)
  hasScenario: boolean;
  lenderLabel: string;
  downPaymentLabel: string;
  // 할부의 초기비용 어휘는 "선납금"(도메인 규칙 — 저장 컬럼은 down_payment_* 동일, 화면 어휘만 구매방식 종속). SSOT.
  downPaymentRowLabel: string;
  carTaxLabel: string;
  subsidyLabel: string;
  rateLabel: string;
  totalReturnCostLabel: string;
  totalTakeoverCostLabel: string;
  dueAtDeliveryLabel: string;
  // 섹션 4 — 추천 이유 + 서비스 + 푸터
  recommendReasons: string[];
  services: { label: string; value: string }[];
  footerStampLabel: string;
  quoteCodeLabel: string;
};

// 공용 라벨 상수·포맷터(CALC_PENDING/moneyModeLabel 등)는 app-card-labels(서버 발송 조립기와 물리 공유)로
// 이동 — 아래에는 클라 전용(부작용 체인·타임존 semantics 상이) 헬퍼만 남긴다.

// 발송 전(valid_until 없음/무효)엔 갭ⓐ 정책 안내, 발송 후엔 견적함 목록과 동일 계산(validLabelFromUntil SSOT).
function ddayLabelOf(validUntilIso: string | null, now: number): string {
  return validLabelFromUntil(validUntilIso, now) ?? "D-7 · 발송 시 시작";
}

// 푸터 발송시각 — 견적함 표시와 동일 포맷(formatActivity SSOT, "YY/MM/DD HH:mm"). 발송 전엔 프리뷰 표기.
// 서버 조립기의 stampLabelOf(KST 고정 환산)와 타임존 semantics가 달라 공유 제외(브라우저 로컬 = 사용자 KST).
function stampLabelOf(iso: string | null): string {
  return formatActivity(iso) || "발송 전 미리보기";
}

export function buildAppCardModel(input: AppCardModelInput): AppCardModel {
  const s = input.scenario;
  const fvp = input.finalVehiclePrice;
  const rate = numOr(s?.interestRate);
  const totalReturn = numOr(s?.totalReturnCost);
  const totalTakeover = numOr(s?.totalTakeoverCost);
  const totalCost = totalReturn ?? totalTakeover; // 반납 우선(설계 결정 2)
  return {
    // appStatus "viewed"는 dead 값 정리(0705 배치 D) — CRM 프리뷰는 항상 발송자 관점 "미확인 견적"
    // (실 카드의 확인/미확인은 앱이 advisor_quotes.viewed_at으로 계산 — 서버 조립기 statusLabel 제외와 같은 이유).
    statusLabel: "미확인 견적",
    ddayLabel: ddayLabelOf(input.validUntilIso, input.nowMs),
    brand: input.brandName ?? "차량 미선택",
    vehicleTitle: vehicleTitleOf(input.modelName, input.trimName),
    purchaseMethod: input.purchaseMethod,
    termLabel: formatTerm(s?.termMonths ?? null),
    sublineLabel: [
      input.modelYear != null ? `${input.modelYear}년식` : null,
      `${formatMoney(input.basePrice)}원`,
      input.optionNames.length ? `추가옵션 ${input.optionNames.length}개` : "추가옵션 없음",
    ].filter(Boolean).join(" ㅣ "),
    monthlyLabel: moneyLabelOf(s?.monthlyPayment, CALC_PENDING),
    rateChipLabel: rate != null ? `금리 ${rate}%` : null,
    residualLabel: s ? moneyModeLabel(s.residualMode, s.residualValue, fvp, { noneLabel: CALC_PENDING, percentFirst: false }) : CALC_PENDING,
    residualCondLabel: s ? moneyModeLabel(s.residualMode, s.residualValue, fvp, { noneLabel: CALC_PENDING, percentFirst: true }) : CALC_PENDING,
    totalCostLabel: totalCost != null ? `${formatMoney(totalCost)}원` : CALC_PENDING,
    // CRM 미리보기는 구성 내역 라벨을 병기한다 — 고객 발송 payload(src/lib/app-card-payload.ts)는 항상
    // "최대 할인 적용" 고정. 의도된 클라↔서버 차이(2026-07-05 이사님 결정: "CRM은 모든 할인 항목 표시,
    // 고객 앱은 총액만") — 파리티 테스트가 양쪽 값을 각각 잠근다(app-card-payload-parity.test.ts).
    discountRowLabel: input.discountLabels.length ? `최대 할인 적용 (${input.discountLabels.join("·")})` : "최대 할인 적용",
    discountLabel: formatMoney(input.discount),
    depositLabel: s ? moneyModeLabel(s.depositMode, s.depositValue, fvp, { noneLabel: "0원 (무보증)", percentFirst: true }) : "조건 미정",
    mileageLabel: mileageLabelOf(s?.mileageValue),
    keyPoints: input.guidance.keyPoints.map((k) => k.trim()).filter(Boolean),
    deliveryComment: input.guidance.deliveryComment,
    exteriorColorLabel: input.exteriorColorName ?? "미선택",
    interiorColorLabel: input.interiorColorName ?? "미선택",
    optionSummaryLabel: input.optionNames.length ? input.optionNames.join(", ") : "없음",
    stockNotice: input.guidance.stockNotice,
    expectedDelivery: input.guidance.expectedDelivery,
    customerRegion: input.guidance.customerRegion,
    basePriceLabel: formatMoney(input.basePrice),
    optionTotalLabel: formatMoney(input.optionTotal),
    finalVehiclePriceLabel: formatMoney(fvp),
    acquisitionTaxLabel: formatMoney(input.acquisitionTax),
    acquisitionTaxModeLabel: acquisitionTaxModeLabelOf(input.acquisitionTaxMode),
    bondLabel: formatMoney(input.bond),
    deliveryFeeLabel: formatMoney(input.delivery),
    incidentalLabel: formatMoney(input.incidental),
    registrationCostLabel: formatMoney(input.registrationCost),
    acquisitionCostLabel: formatMoney(input.acquisitionCost),
    hasScenario: s != null,
    lenderLabel: s?.lender ?? "금융사 미정",
    downPaymentLabel: s ? moneyModeLabel(s.downPaymentMode, s.downPaymentValue, fvp, { noneLabel: "없음", percentFirst: true }) : "없음",
    downPaymentRowLabel: downPaymentRowLabelOf(input.purchaseMethod),
    carTaxLabel: s?.carTaxIncluded === true ? "포함" : "불포함",
    subsidyLabel: s?.subsidyApplicable === true ? moneyLabelOf(s.subsidyAmount, NO_SOURCE) : "해당 없음",
    rateLabel: rate != null ? `${rate}%` : NO_SOURCE,
    totalReturnCostLabel: totalReturn != null ? `${formatMoney(totalReturn)}원` : NO_SOURCE,
    totalTakeoverCostLabel: totalTakeover != null ? `${formatMoney(totalTakeover)}원` : NO_SOURCE,
    dueAtDeliveryLabel: moneyLabelOf(s?.dueAtDelivery, NO_SOURCE),
    recommendReasons: input.guidance.recommendReason.split("\n").map((line) => line.trim()).filter(Boolean),
    services: input.guidance.services.map((sv) => sv.trim()).filter(Boolean).map(splitService),
    footerStampLabel: stampLabelOf(input.sentAtIso),
    quoteCodeLabel: input.quoteCode ?? "저장 후 부여",
  };
}
