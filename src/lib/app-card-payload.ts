// 발송 payload 서버 조립기 — 발송 시 앱카드 "라벨 완성본"을 public.advisor_quotes.payload로 스냅샷한다.
// 앱은 재계산·재포맷 없이 그대로 렌더한다(발송본 고정 — 계약: ref/2026-07-05-app-advisor-quotes-handoff.md 2절).
//
// ⚠️ 라벨 파리티 tripwire: 아래 라벨 로직·문구·포맷은 클라 buildAppCardModel(client/src/lib/app-card.ts)에서
// 복사한 재현본이다. 한쪽을 수정하면 반드시 양쪽 + 파리티 테스트(Task 3, client/src/lib/app-card-payload-parity.test.ts)를
// 함께 갱신할 것 — doc-types 파리티 가드와 같은 원칙.
//
// 순수 모듈: drizzle/클라 import 금지(입력은 DB 행 모양의 구조적 타입), Node/bun 전용 API 금지.
// vitest(클라 테스트)가 상대경로로 import해 클라 조립기와 파리티 비교한다.

// crm.quotes 행 모양(조립에 필요한 필드만 — drizzle numeric 컬럼은 string|null, jsonb는 unknown).
export type AdvisorPayloadQuoteRow = {
  quoteCode: string;
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  basePrice: string | null;
  optionTotal: string | null;
  options: unknown; // [{trim_option_id, name, price}] — name만 사용 (schema.ts crm.quotes.options)
  discountLines: unknown; // [{label, amount, unit}] — label만 사용
  finalDiscount: string | null;
  acquisitionTax: string | null;
  acquisitionTaxMode: string | null;
  bond: string | null;
  delivery: string | null;
  incidental: string | null;
  exteriorColorName: string | null;
  interiorColorName: string | null;
  guidance: unknown; // QuoteGuidance jsonb(legacy keyPoint 단수 행 존재 가능) | null
};

// crm.quote_scenarios 행 모양(대표 시나리오 — numeric은 string|null, smallint는 number).
export type AdvisorPayloadScenarioRow = {
  purchaseMethod: string | null;
  lender: string | null;
  termMonths: number | null;
  depositMode: string | null;
  depositValue: string | null;
  downPaymentMode: string | null;
  downPaymentValue: string | null;
  residualMode: string | null;
  residualValue: string | null;
  mileageValue: string | null;
  carTaxIncluded: boolean | null;
  subsidyApplicable: boolean | null;
  subsidyAmount: string | null;
  monthlyPayment: string | null;
  totalReturnCost: string | null;
  totalTakeoverCost: string | null;
  dueAtDelivery: string | null;
  interestRate: string | null;
};

// 클라 AppCardModel 동형에서 statusLabel/ddayLabel 2필드 제외 + payloadVersion 추가.
// 그 2필드는 앱이 viewed_at/valid_until 컬럼으로 계산한다(스냅샷하면 "D-7" 박제 버그 — 스펙 결정 2).
export type AdvisorQuotePayload = {
  payloadVersion: 1;
  // 섹션 1 — 헤더·핵심 요약
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
  // 행 라벨 자체가 값 — 할부면 "선납금", 아니면 "선수금"(도메인 규칙, 클라 SSOT 재현)
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

// ── 클라 재현 상수·헬퍼(app-card.ts / quote-pricing.ts / quote-items.ts / customers.ts 복사본) ──

const CALC_PENDING = "계산 후 안내";
const NO_SOURCE = "—";
const TAX_MODE_LABELS: Record<string, string> = {
  normal: "일반", hybrid: "하이브리드 감면", electric: "전기차 감면", manual: "직접 입력",
};

// 클라 quote-pricing.ts formatMoney 재현
function formatMoney(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 클라 quote-items.ts formatTerm 재현
function formatTerm(termMonths: number | null): string {
  return termMonths != null ? `${termMonths}개월` : "조건 미정";
}

function numOr(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

// 클라 수정 프리필(useQuoteWorkbench openEditQuote)의 Number(dq.x ?? 0) 변환 재현 — null/빈 문자열은 0.
function toNum(raw: string | null): number {
  return Number(raw ?? 0);
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

// 푸터 발송시각 — 클라 formatActivity("YY/MM/DD HH:mm") 재현. 단 클라는 브라우저 로컬(KST) 기준이고
// 서버 런타임(CF Workers)은 UTC라 로컬 타임존을 쓰면 9시간 어긋난다 → KST(+09:00, 한국은 DST 없음) 고정 환산.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
function stampLabelOf(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "발송 전 미리보기"; // 클라 stampLabelOf 폴백 재현(무효 입력 방어)
  const d = new Date(t + KST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getUTCFullYear()).slice(2)}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
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

// jsonb 배열([{...}])에서 string 필드만 추출 — DB jsonb는 unknown이라 좁혀서 읽는다.
function stringListFrom(raw: unknown, key: string): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item == null) continue;
    const v = (item as Record<string, unknown>)[key];
    if (typeof v === "string") out.push(v);
  }
  return out;
}

type GuidanceShape = {
  deliveryComment: string;
  stockNotice: string;
  expectedDelivery: string;
  customerRegion: string;
  keyPoints: string[];
  recommendReason: string;
  services: string[];
};

// 클라 normalizeQuoteGuidance(client/src/data/quote-guidance.ts) 재현: keyPoints 배열 우선, 없으면
// legacy keyPoint(단수) 승격, 둘 다 없으면 []. null guidance는 빈 guidance로 방어 —
// 클라 워크벤치의 DEFAULT_QUOTE_GUIDANCE 폴백은 "작성 시드"라 발송본에 주입하지 않는다(상담사가 안 쓴 제안문 발송 방지).
function guidanceOf(raw: unknown): GuidanceShape {
  const g: Record<string, unknown> =
    typeof raw === "object" && raw != null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const strList = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  const keyPointsArr = strList(g.keyPoints);
  const legacyKeyPoint = str(g.keyPoint).trim();
  return {
    deliveryComment: str(g.deliveryComment),
    stockNotice: str(g.stockNotice),
    expectedDelivery: str(g.expectedDelivery),
    customerRegion: str(g.customerRegion),
    keyPoints: keyPointsArr ?? (legacyKeyPoint ? [legacyKeyPoint] : []),
    recommendReason: str(g.recommendReason),
    services: strList(g.services) ?? [],
  };
}

export function buildAdvisorQuotePayload(
  q: AdvisorPayloadQuoteRow,
  sc: AdvisorPayloadScenarioRow | null,
  // modelYear는 crm.quotes에 없어 호출부가 catalog.trims 조인으로 조달, sentAtIso는 서버 확정 발송 스탬프.
  extra: { modelYear: number | null; sentAtIso: string },
): { payload: AdvisorQuotePayload; vehicleLabel: string; monthlyPayment: number | null } {
  // 파생가는 저장 컬럼(final_vehicle_price 등)을 읽지 않고 클라 computePricing(quote-pricing.ts) 공식으로
  // 재계산한다 — 클라도 수정 진입 시 base/option/discount에서 재계산해 표시하므로 이 경로가 화면과 동일하고,
  // registration_cost는 애초에 컬럼이 없다. percent 병기 환산 기준도 이 finalVehiclePrice다(#157 결정).
  const basePrice = toNum(q.basePrice);
  const optionTotal = toNum(q.optionTotal);
  const discount = toNum(q.finalDiscount);
  const acquisitionTax = toNum(q.acquisitionTax);
  const bond = toNum(q.bond);
  const delivery = toNum(q.delivery);
  const incidental = toNum(q.incidental);
  const finalVehiclePrice = basePrice + optionTotal - discount;
  const registrationCost = acquisitionTax + bond;
  const acquisitionCost = finalVehiclePrice + registrationCost;

  const optionNames = stringListFrom(q.options, "name");
  const discountLabels = stringListFrom(q.discountLines, "label");
  const guidance = guidanceOf(q.guidance);
  // 클라는 워크벤치 state에서 오지만 서버 SSOT는 대표 시나리오 행. sc/값 없으면 "" —
  // downPaymentRowLabel은 "할부"만 분기하므로 클라 폴백("운용리스" 정규화)과 라벨 결과가 같다.
  const purchaseMethod = sc?.purchaseMethod ?? "";

  const rate = numOr(sc?.interestRate);
  const totalReturn = numOr(sc?.totalReturnCost);
  const totalTakeover = numOr(sc?.totalTakeoverCost);
  const totalCost = totalReturn ?? totalTakeover; // 반납 우선(클라 설계 결정 2)

  const vehicleTitle = vehicleTitleOf(q.modelName, q.trimName);

  const payload: AdvisorQuotePayload = {
    payloadVersion: 1,
    brand: q.brandName ?? "차량 미선택",
    vehicleTitle,
    purchaseMethod,
    termLabel: formatTerm(sc?.termMonths ?? null),
    sublineLabel: [
      extra.modelYear != null ? `${extra.modelYear}년식` : null,
      `${formatMoney(basePrice)}원`,
      optionNames.length ? `추가옵션 ${optionNames.length}개` : "추가옵션 없음",
    ].filter(Boolean).join(" ㅣ "),
    monthlyLabel: moneyLabelOf(sc?.monthlyPayment, CALC_PENDING),
    rateChipLabel: rate != null ? `금리 ${rate}%` : null,
    residualLabel: sc ? moneyModeLabel(sc.residualMode, sc.residualValue, finalVehiclePrice, { noneLabel: CALC_PENDING, percentFirst: false }) : CALC_PENDING,
    residualCondLabel: sc ? moneyModeLabel(sc.residualMode, sc.residualValue, finalVehiclePrice, { noneLabel: CALC_PENDING, percentFirst: true }) : CALC_PENDING,
    totalCostLabel: totalCost != null ? `${formatMoney(totalCost)}원` : CALC_PENDING,
    discountRowLabel: discountLabels.length ? `최대 할인 적용 (${discountLabels.join("·")})` : "최대 할인 적용",
    discountLabel: formatMoney(discount),
    depositLabel: sc ? moneyModeLabel(sc.depositMode, sc.depositValue, finalVehiclePrice, { noneLabel: "0원 (무보증)", percentFirst: true }) : "조건 미정",
    mileageLabel: mileageLabelOf(sc?.mileageValue),
    keyPoints: guidance.keyPoints.map((k) => k.trim()).filter(Boolean),
    deliveryComment: guidance.deliveryComment,
    exteriorColorLabel: q.exteriorColorName ?? "미선택",
    interiorColorLabel: q.interiorColorName ?? "미선택",
    optionSummaryLabel: optionNames.length ? optionNames.join(", ") : "없음",
    stockNotice: guidance.stockNotice,
    expectedDelivery: guidance.expectedDelivery,
    customerRegion: guidance.customerRegion,
    basePriceLabel: formatMoney(basePrice),
    optionTotalLabel: formatMoney(optionTotal),
    finalVehiclePriceLabel: formatMoney(finalVehiclePrice),
    acquisitionTaxLabel: formatMoney(acquisitionTax),
    acquisitionTaxModeLabel: TAX_MODE_LABELS[q.acquisitionTaxMode ?? "normal"] ?? TAX_MODE_LABELS.normal,
    bondLabel: formatMoney(bond),
    deliveryFeeLabel: formatMoney(delivery),
    incidentalLabel: formatMoney(incidental),
    registrationCostLabel: formatMoney(registrationCost),
    acquisitionCostLabel: formatMoney(acquisitionCost),
    hasScenario: sc != null,
    lenderLabel: sc?.lender ?? "금융사 미정",
    downPaymentLabel: sc ? moneyModeLabel(sc.downPaymentMode, sc.downPaymentValue, finalVehiclePrice, { noneLabel: "없음", percentFirst: true }) : "없음",
    downPaymentRowLabel: purchaseMethod === "할부" ? "선납금" : "선수금",
    carTaxLabel: sc?.carTaxIncluded === true ? "포함" : "불포함",
    subsidyLabel: sc?.subsidyApplicable === true ? moneyLabelOf(sc.subsidyAmount, NO_SOURCE) : "해당 없음",
    rateLabel: rate != null ? `${rate}%` : NO_SOURCE,
    totalReturnCostLabel: totalReturn != null ? `${formatMoney(totalReturn)}원` : NO_SOURCE,
    totalTakeoverCostLabel: totalTakeover != null ? `${formatMoney(totalTakeover)}원` : NO_SOURCE,
    dueAtDeliveryLabel: moneyLabelOf(sc?.dueAtDelivery, NO_SOURCE),
    recommendReasons: guidance.recommendReason.split("\n").map((line) => line.trim()).filter(Boolean),
    services: guidance.services.map((sv) => sv.trim()).filter(Boolean).map(splitService),
    footerStampLabel: stampLabelOf(extra.sentAtIso),
    quoteCodeLabel: q.quoteCode,
  };

  return {
    payload,
    // 정규 컬럼 vehicle_label: 앱 목록 카드가 payload 파싱 없이 렌더 — 브랜드 없으면 vehicleTitle만.
    vehicleLabel: `${q.brandName ?? ""} ${vehicleTitle}`.trim(),
    monthlyPayment: numOr(sc?.monthlyPayment),
  };
}
