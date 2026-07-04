import type { QuoteGuidance } from "@/data/quote-guidance";
import { formatActivity } from "./customers";
import type { ScenarioInput } from "./customer-quotes";
import { formatTerm, validLabelFromUntil } from "./quote-items";
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

// 계산엔진 미연결 필드는 가짜 숫자 대신 정직한 안내 텍스트로 표시한다.
const CALC_PENDING = "계산 후 안내";
const NO_SOURCE = "—";
const TAX_MODE_LABELS: Record<AppCardModelInput["acquisitionTaxMode"], string> = {
  normal: "일반", hybrid: "하이브리드 감면", electric: "전기차 감면", manual: "직접 입력",
};

function numOr(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

function moneyLabelOf(raw: string | null | undefined, fallback: string): string {
  const n = numOr(raw);
  return n == null ? fallback : `${formatMoney(n)}원`;
}

// 모델+트림 표시명. 카탈로그 트림명이 모델명을 접두로 포함하는 경우(BMW 등) 중복 없이 트림명만 쓴다.
function vehicleTitleOf(modelName: string | null, trimName: string | null): string {
  const model = modelName?.trim() ?? "";
  const trim = trimName?.trim() ?? "";
  if (!model && !trim) return "차량 미선택";
  if (!model) return trim;
  if (!trim) return model;
  return trim.startsWith(model) ? trim : `${model} ${trim}`;
}

// mode+value 병기 포맷. percent 금액 환산 기준 = finalVehiclePrice(0이면 %만).
// percentFirst: 보증금/선수금 "(20%) 28,560,000원" ↔ 잔존가치 "82,824,000원 (58%)" 어순.
function moneyModeLabel(
  mode: string | null | undefined,
  value: string | null | undefined,
  finalVehiclePrice: number,
  opts: { noneLabel: string; percentFirst: boolean },
): string {
  if (mode == null || mode === "none") return opts.noneLabel;
  if (mode === "max") return "최대";
  if (mode === "percent") {
    const v = numOr(value);
    if (v == null) return opts.noneLabel;
    if (!finalVehiclePrice) return `${v}%`;
    const amount = `${formatMoney(Math.round(finalVehiclePrice * v / 100))}원`;
    return opts.percentFirst ? `(${v}%) ${amount}` : `${amount} (${v}%)`;
  }
  const n = numOr(value);
  return n == null ? opts.noneLabel : `${formatMoney(n)}원`;
}

// 발송 전(valid_until 없음/무효)엔 갭ⓐ 정책 안내, 발송 후엔 견적함 목록과 동일 계산(validLabelFromUntil SSOT).
function ddayLabelOf(validUntilIso: string | null, now: number): string {
  return validLabelFromUntil(validUntilIso, now) ?? "D-7 · 발송 시 시작";
}

// 푸터 발송시각 — 견적함 표시와 동일 포맷(formatActivity SSOT, "YY/MM/DD HH:mm"). 발송 전엔 프리뷰 표기.
function stampLabelOf(iso: string | null): string {
  return formatActivity(iso) || "발송 전 미리보기";
}

// "20,000km / 년" → "연 20,000km"(디자인 표기). "/" 앞부분에 "연 " 접두, 빈 head면 원문 유지.
function mileageLabelOf(raw: string | null | undefined): string {
  if (!raw) return "연 20,000km";
  const head = raw.split("/")[0]?.trim();
  return head ? `연 ${head}` : raw;
}

// "썬팅: 후퍼옵틱 …" → {label: "썬팅", value: "후퍼옵틱 …"}. 콜론 없으면 label 없이 전체.
function splitService(raw: string): { label: string; value: string } {
  const idx = raw.indexOf(":");
  if (idx === -1) return { label: "", value: raw.trim() };
  return { label: raw.slice(0, idx).trim(), value: raw.slice(idx + 1).trim() };
}

export function buildAppCardModel(input: AppCardModelInput): AppCardModel {
  const s = input.scenario;
  const fvp = input.finalVehiclePrice;
  const rate = numOr(s?.interestRate);
  const totalReturn = numOr(s?.totalReturnCost);
  const totalTakeover = numOr(s?.totalTakeoverCost);
  const totalCost = totalReturn ?? totalTakeover; // 반납 우선(설계 결정 2)
  return {
    statusLabel: input.appStatus === "viewed" ? "확인한 견적" : "미확인 견적",
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
    acquisitionTaxModeLabel: TAX_MODE_LABELS[input.acquisitionTaxMode],
    bondLabel: formatMoney(input.bond),
    deliveryFeeLabel: formatMoney(input.delivery),
    incidentalLabel: formatMoney(input.incidental),
    registrationCostLabel: formatMoney(input.registrationCost),
    acquisitionCostLabel: formatMoney(input.acquisitionCost),
    hasScenario: s != null,
    lenderLabel: s?.lender ?? "금융사 미정",
    downPaymentLabel: s ? moneyModeLabel(s.downPaymentMode, s.downPaymentValue, fvp, { noneLabel: "없음", percentFirst: true }) : "없음",
    downPaymentRowLabel: input.purchaseMethod === "할부" ? "선납금" : "선수금",
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
