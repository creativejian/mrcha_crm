import { formatActivity } from "./customers";
import { normalizeQuoteGuidance, type QuoteGuidance } from "@/data/quote-guidance";

// 견적함 UI 항목 타입(기존 CustomerDetailPage 내부 정의에서 이동).
export type QuoteItem = {
  id: string;
  quoteCode: string;
  title: string;
  meta: string;
  status: string;
  source: "manual" | "solution" | "original";
  appStatus: "draft" | "queued" | "sent" | "viewed";
  brand?: string;
  model?: string;
  trim?: string;
  quoteRound?: string;
  vehicleName?: string;
  financeType?: string;
  term?: string;
  monthlyPayment?: string;
  lender?: string;
  stockStatus?: "재고있음" | "재고없음" | "재고확인중";
  validLabel?: string;
  note?: string;
  sentAt?: string;
  viewedAt?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  objectUrl?: string;
  file?: File;
  decisionStatus?: "none" | "considering" | "confirmed" | "contracting";
  revision?: number;
  revisedAt?: string;
  // #4c-2 표시용 가격/색상
  finalVehiclePrice?: number;
  exteriorColorName?: string;
  exteriorColorHex?: string;
  interiorColorName?: string;
  interiorColorHex?: string;
  // PR1: catalog FK(PR2 워크벤치 수정모드 prefill에서 소비)
  trimId?: number;
  exteriorColorId?: number;
  interiorColorId?: number;
  // #4c-3a 다중 시나리오(비교 표시는 #4c-3b가 소비)
  scenarios?: CustomerDetailScenario[];
  primaryScenarioId?: string;
  originalNeedsReplacement?: boolean;
  guidance?: QuoteGuidance;
};

// GET /api/customers/:id 의 quote 1건(drizzle camelCase 직렬화; numeric→string, timestamptz→ISO string).
export type CustomerDetailScenario = {
  id: string;
  scenarioNo: number | null;
  purchaseMethod: string | null;
  lender: string | null;
  termMonths: number | null;
  monthlyPayment: string | null;
  // #4c-3a 비교카드 입력 가능 컬럼
  depositMode: string | null;
  depositValue: string | null;
  downPaymentMode: string | null;
  downPaymentValue: string | null;
  residualMode: string | null;
  residualValue: string | null;
  mileageMode: string | null;
  mileageValue: string | null;
  isSaved: boolean;
};

export type CustomerDetailQuote = {
  id: string;
  quoteCode: string;
  entryMode: string | null;
  quoteRound: string | null;
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  status: string | null;
  appStatus: string | null;
  decisionStatus: string | null;
  stockStatus: string | null;
  note: string | null;
  validUntil: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  revision: number;
  primaryScenarioId: string | null;
  // #4c-2 가격/색상 스냅샷(numeric은 string, 없으면 null). getCustomer가 select() 전체라 응답에 포함.
  basePrice: string | null;
  optionTotal: string | null;
  finalDiscount: string | null;
  acquisitionTax: string | null;
  bond: string | null;
  delivery: string | null;
  incidental: string | null;
  finalVehiclePrice: string | null;
  acquisitionCost: string | null;
  // PR1: catalog FK(워크벤치 수정모드 차량/색상 복원용). bigint mode:"number"라 number|null.
  trimId: number | null;
  exteriorColorId: number | null;
  interiorColorId: number | null;
  options: { id: number; name: string; price: number | null }[] | null;
  exteriorColorName: string | null;
  exteriorColorHex: string | null;
  interiorColorName: string | null;
  interiorColorHex: string | null;
  // #4d 견적 원본(file_path는 서버 비노출, 미리보기는 signed URL)
  fileName: string | null;
  fileSize: number | null;
  fileMime: string | null;
  scenarios: CustomerDetailScenario[];
  guidance: QuoteGuidance | null;
};

const MS_DAY = 86_400_000;
const QUOTE_SOURCES = ["manual", "solution", "original"] as const;
const APP_STATUSES = ["draft", "queued", "sent", "viewed"] as const;
const STOCK_STATUSES = ["재고있음", "재고없음", "재고확인중"] as const;
const DECISION_STATUSES = ["none", "considering", "confirmed", "contracting"] as const;

function asEnum<T extends readonly string[]>(allowed: T, v: string | null, fallback: T[number]): T[number] {
  return v != null && (allowed as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}

// 표시 옵션 enum: 매칭 안 되면 undefined(렌더 시 숨김).
function asOptionalEnum<T extends readonly string[]>(allowed: T, v: string | null): T[number] | undefined {
  return v != null && (allowed as readonly string[]).includes(v) ? (v as T[number]) : undefined;
}

function pickPrimaryScenario(q: CustomerDetailQuote): CustomerDetailScenario | null {
  if (q.scenarios.length === 0) return null;
  if (q.primaryScenarioId) {
    const found = q.scenarios.find((s) => s.id === q.primaryScenarioId);
    if (found) return found;
  }
  return [...q.scenarios].sort((a, b) => (a.scenarioNo ?? 0) - (b.scenarioNo ?? 0))[0];
}

export function formatTerm(termMonths: number | null): string {
  return termMonths != null ? `${termMonths}개월` : "조건 미정";
}

export function formatMonthly(raw: string | null): string | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (Number.isNaN(n)) return undefined;
  return `월 ${n.toLocaleString("ko-KR")}원`;
}

// 대표 시나리오 → 견적 행 요약 4필드(financeType/term/monthlyPayment/lender). toQuoteItem과 "대표로" 핸들러가 공유.
export function flattenPrimaryScenario(
  s: CustomerDetailScenario | null,
): Pick<QuoteItem, "financeType" | "term" | "monthlyPayment" | "lender"> {
  return {
    financeType: s?.purchaseMethod ?? undefined,
    term: formatTerm(s?.termMonths ?? null),
    monthlyPayment: formatMonthly(s?.monthlyPayment ?? null),
    lender: s?.lender ?? "금융사 미정",
  };
}

// 시나리오 금액 mode+value 표기. percent→"N%", amount→"N만원"(만원 절삭), none→"없음", max→"최대", 그 외/빈값→undefined.
export function formatScenarioMoneyMode(mode: string | null, value: string | null): string | undefined {
  if (mode === "none") return "없음";
  if (mode === "max") return "최대";
  if (mode === "percent") return value ? `${value}%` : undefined;
  if (mode === "amount") {
    if (!value) return undefined;
    const n = Number(value);
    if (Number.isNaN(n)) return undefined;
    return `${Math.round(n / 10000).toLocaleString("ko-KR")}만원`;
  }
  return undefined;
}

// valid_until → 화면 D-day. 미래면 "D-N", 지났으면 "만료됨", 없으면 표시 안 함.
function validLabelFromUntil(validUntil: string | null, nowMs: number): string | undefined {
  if (!validUntil) return undefined;
  const until = new Date(validUntil).getTime();
  if (Number.isNaN(until)) return undefined;
  const days = Math.ceil((until - nowMs) / MS_DAY);
  return days > 0 ? `D-${days}` : "만료됨";
}

// 대표 시나리오를 평탄화해 기존 QuoteItem 형태로 변환(접근 1). 파일/원본 필드는 읽기 범위 밖.
export function toQuoteItem(q: CustomerDetailQuote, nowMs: number): QuoteItem {
  const primary = pickPrimaryScenario(q);
  const vehicleName = [q.brandName, q.modelName, q.trimName].filter(Boolean).join(" ");
  return {
    id: q.id,
    quoteCode: q.quoteCode,
    title: vehicleName || q.quoteCode,
    meta: "",
    status: q.status ?? "",
    source: asEnum(QUOTE_SOURCES, q.entryMode, "manual"),
    appStatus: asEnum(APP_STATUSES, q.appStatus, "draft"),
    brand: q.brandName ?? undefined,
    model: q.modelName ?? undefined,
    trim: q.trimName ?? undefined,
    quoteRound: q.quoteRound ?? undefined,
    vehicleName: vehicleName || undefined,
    ...flattenPrimaryScenario(primary),
    stockStatus: asOptionalEnum(STOCK_STATUSES, q.stockStatus),
    validLabel: validLabelFromUntil(q.validUntil, nowMs),
    note: q.note ?? undefined,
    sentAt: q.sentAt ? formatActivity(q.sentAt) : undefined,
    viewedAt: q.viewedAt ? formatActivity(q.viewedAt) : undefined,
    decisionStatus: asEnum(DECISION_STATUSES, q.decisionStatus, "none"),
    revision: q.revision,
    finalVehiclePrice: q.finalVehiclePrice != null && q.finalVehiclePrice !== "" && !Number.isNaN(Number(q.finalVehiclePrice)) ? Number(q.finalVehiclePrice) : undefined,
    exteriorColorName: q.exteriorColorName ?? undefined,
    exteriorColorHex: q.exteriorColorHex ?? undefined,
    interiorColorName: q.interiorColorName ?? undefined,
    interiorColorHex: q.interiorColorHex ?? undefined,
    trimId: q.trimId ?? undefined,
    exteriorColorId: q.exteriorColorId ?? undefined,
    interiorColorId: q.interiorColorId ?? undefined,
    fileName: q.fileName ?? undefined,
    fileSize: q.fileSize ?? undefined,
    mimeType: q.fileMime ?? undefined,
    primaryScenarioId: q.primaryScenarioId ?? undefined,
    scenarios: q.scenarios,
    guidance: normalizeQuoteGuidance(q.guidance) ?? undefined,
  };
}
