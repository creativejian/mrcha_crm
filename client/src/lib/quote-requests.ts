import { formatActivity, invalidateCustomerDetail } from "./customers";
import { getJson, sendJson } from "./http";
import { formatPriceRangeKorean } from "./price-format";

// 백엔드 listQuoteRequests 응답 1행(camelCase, null 가능).
export type AppQuoteRequestRow = {
  id: string;
  createdAt: string;
  requesterName: string | null;
  requesterPhone: string | null;
  paymentMethod: string | null;
  period: number | null;
  depositType: string | null;
  depositRatio: number | null;
  rentalDeposit: number | null;
  trimPrice: number | null;
  status: string | null;
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  optionCount: number;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  matchedCustomerCode: string | null;
  promotedQuoteCount: number;
  promotedQuoteIds: string[];
  matchType: "app_user" | "phone" | "none";
};

// 앱 enum → 한글. Flutter 앱 SSOT(purchase_method.dart / deposit_type.dart / quote_status.dart)와 일치.
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  lease: "운용리스",
  rent: "장기렌트",
  installment: "할부",
  cash: "일시불",
};
const DEPOSIT_TYPE_LABEL: Record<string, string> = {
  deposit: "보증금",
  advance: "선수금",
  prepayment: "선납금",
};
const STATUS_LABEL: Record<string, string> = {
  open: "진행중",
  closed: "마감",
  completed: "완료",
};

// 화면 표시용 견적요청 1행.
export type AppQuoteRequest = {
  id: string;
  createdAt: string;
  requesterName: string;
  vehicleLabel: string;
  paymentLabel: string;
  periodLabel: string;
  depositLabel: string;
  trimPriceLabel: string;
  optionLabel: string;
  statusLabel: string;
  matchLabel: string;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  matchedCustomerCode: string | null;
  promotedQuoteCount: number;
  promotedQuoteIds: string[];
  matchType: AppQuoteRequestRow["matchType"];
};

function moneyOrDash(won: number | null): string {
  return won != null && won > 0 ? formatPriceRangeKorean(won, null) : "—";
}

// 보증금/선수금/선납금 라벨 병기(앱카드 문법): 비율+금액 → "보증금 (20%) 1,180만원", 금액만 → "보증금 1,180만원",
// 비율만 → "보증금 (20%)", 둘 다 0 → 유형명만, 유형 null → "—".
// 주의: seedScenarioCardFromRequest(quote-request-seed.ts)는 비율 우선·금액 무시 — 여기는 병기(둘 다 표시). 복붙 금지.
export function depositLabelOf(row: Pick<AppQuoteRequestRow, "depositType" | "depositRatio" | "rentalDeposit">): string {
  const depositName = row.depositType ? (DEPOSIT_TYPE_LABEL[row.depositType] ?? row.depositType) : null;
  if (!depositName) return "—";
  const ratio = row.depositRatio ?? 0;
  const amount = row.rentalDeposit ?? 0;
  const ratioLabel = ratio > 0 ? ` (${ratio}%)` : "";
  const amountLabel = amount > 0 ? ` ${formatPriceRangeKorean(amount, null)}` : "";
  return `${depositName}${ratioLabel}${amountLabel}`;
}

export function toAppQuoteRequest(row: AppQuoteRequestRow): AppQuoteRequest {
  const vehicleLabel =
    [row.brandName, row.modelName].filter(Boolean).join(" ") +
    (row.trimName ? ` · ${row.trimName}` : "");
  const matchLabel =
    row.matchType === "app_user"
      ? `연결됨 ${row.matchedCustomerName ?? ""}`.trim()
      : row.matchType === "phone"
        ? row.matchedCustomerName
          ? `기존 고객 ${row.matchedCustomerName}(추정)`
          : "기존 고객(추정)"
        : "신규(미연결)";
  return {
    id: row.id,
    createdAt: formatActivity(row.createdAt),
    requesterName: row.requesterName ?? "이름없음",
    vehicleLabel: vehicleLabel || "차량 미지정",
    paymentLabel: row.paymentMethod ? (PAYMENT_METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod) : "—",
    periodLabel: row.period != null ? `${row.period}개월` : "—",
    depositLabel: depositLabelOf(row),
    trimPriceLabel: moneyOrDash(row.trimPrice),
    optionLabel: row.optionCount > 0 ? `${row.optionCount}개` : "없음",
    statusLabel: row.status ? (STATUS_LABEL[row.status] ?? row.status) : "—",
    matchLabel,
    matchedCustomerId: row.matchedCustomerId,
    matchedCustomerName: row.matchedCustomerName,
    matchedCustomerCode: row.matchedCustomerCode,
    promotedQuoteCount: row.promotedQuoteCount,
    promotedQuoteIds: row.promotedQuoteIds,
    matchType: row.matchType,
  };
}

export async function fetchAppQuoteRequests(): Promise<AppQuoteRequest[]> {
  return (await getJson<AppQuoteRequestRow[]>("/api/quote-requests")).map(toAppQuoteRequest);
}

// 고객 상세 니즈 영역: 그 고객의 앱 견적요청 카드 목록. 인박스와 동일한 toAppQuoteRequest 어댑터 재사용.
export async function fetchCustomerQuoteRequests(customerId: string): Promise<AppQuoteRequest[]> {
  return (await getJson<AppQuoteRequestRow[]>(`/api/customers/${customerId}/quote-requests`)).map(toAppQuoteRequest);
}

// 고객별 앱 견적요청 캐시 + inflight dedupe (detailCache·인박스 캐시와 동형, 고객 uuid 키).
// 행 hover 프리패치·재진입은 캐시 hit으로 즉시(왕복 0). 승격 후엔 force=true로 우회(배지 fresh).
const NEEDS_TTL_MS = 60_000;
const needsCache = new Map<string, { value: AppQuoteRequest[]; at: number }>();
const needsInflight = new Map<string, Promise<AppQuoteRequest[]>>();

export function fetchCustomerQuoteRequestsCached(customerId: string, force = false): Promise<AppQuoteRequest[]> {
  const cached = needsCache.get(customerId);
  if (!force && cached && Date.now() - cached.at < NEEDS_TTL_MS) return Promise.resolve(cached.value);
  const existing = needsInflight.get(customerId);
  if (!force && existing) return existing;
  const p = fetchCustomerQuoteRequests(customerId)
    .then((value) => {
      needsCache.set(customerId, { value, at: Date.now() });
      return value;
    })
    .finally(() => {
      if (needsInflight.get(customerId) === p) needsInflight.delete(customerId);
    });
  if (!force) needsInflight.set(customerId, p);
  return p;
}

// 고객 행 hover가 호출. 백그라운드 워밍(결과/에러 무시).
export function prefetchCustomerQuoteRequests(customerId: string): void {
  void fetchCustomerQuoteRequestsCached(customerId).catch(() => {});
}

// 캐시 버림(대칭용). 현재 무효화는 reloadAppRequests의 force로 처리되나, 외부 무효화 경로용으로 노출.
export function invalidateCustomerQuoteRequests(customerId: string): void {
  needsCache.delete(customerId);
}

// prefill용 단건. paymentMethod는 한글 라벨(워크벤치 구매방식 옵션과 일치)로 변환해 반환.
export type QuoteRequestPrefill = {
  id: string;
  trimId: number | null;
  optionIds: number[];
  purchaseMethod: string | null;
  period: number | null;
  depositType: string | null;
  depositRatio: number | null;
  rentalDeposit: number | null;
};

export async function fetchQuoteRequestDetail(id: string): Promise<QuoteRequestPrefill> {
  const d = await getJson<{
    id: string;
    trimId: number | null;
    paymentMethod: string | null;
    optionIds: number[];
    period: number | null;
    depositType: string | null;
    depositRatio: number | null;
    rentalDeposit: number | null;
  }>(`/api/quote-requests/${id}`);
  return {
    id: d.id,
    trimId: d.trimId,
    optionIds: d.optionIds,
    purchaseMethod: d.paymentMethod ? (PAYMENT_METHOD_LABEL[d.paymentMethod] ?? d.paymentMethod) : null,
    period: d.period,
    depositType: d.depositType,
    depositRatio: d.depositRatio,
    rentalDeposit: d.rentalDeposit,
  };
}

// 인박스 목록 캐시 + inflight dedupe (고객 상세 detailCache와 동형, 단일 키).
// - 사이드메뉴 hover 프리패치·재진입은 캐시 hit으로 즉시(왕복 0) → 배포 cold 로딩 완화.
// - 실시간 INSERT(signal)·60s 폴백은 force=true로 캐시를 우회(항상 fresh, 새 요청 반영).
const INBOX_TTL_MS = 60_000;
let inboxCache: { value: AppQuoteRequest[]; at: number } | null = null;
let inboxInflight: Promise<AppQuoteRequest[]> | null = null;

export function fetchAppQuoteRequestsCached(force = false): Promise<AppQuoteRequest[]> {
  if (!force && inboxCache && Date.now() - inboxCache.at < INBOX_TTL_MS) return Promise.resolve(inboxCache.value);
  if (!force && inboxInflight) return inboxInflight;
  const p = fetchAppQuoteRequests()
    .then((value) => {
      inboxCache = { value, at: Date.now() };
      return value;
    })
    .finally(() => {
      if (inboxInflight === p) inboxInflight = null;
    });
  if (!force) inboxInflight = p;
  return p;
}

// 사이드메뉴 '앱 견적요청' hover가 호출. 백그라운드 워밍(결과/에러 무시).
export function prefetchAppQuoteRequests(): void {
  void fetchAppQuoteRequestsCached().catch(() => {});
}

type PromoteResult = { id: string; customerCode: string; name: string };

// 전화 매칭된 기존 고객에 연결. 성공 시 인박스 캐시 fresh + 그 고객 상세 캐시 무효화.
export async function linkRequestToCustomer(requestId: string, customerId: string): Promise<PromoteResult> {
  const r = await sendJson<PromoteResult>(`/api/quote-requests/${requestId}/link`, "POST", { customerId });
  await fetchAppQuoteRequestsCached(true);
  invalidateCustomerDetail(customerId);
  return r;
}

// 미매칭 요청 → 신규 고객 생성. 성공 시 인박스 캐시 fresh + 생성 고객 상세 캐시 무효화.
export async function createCustomerFromRequest(requestId: string): Promise<PromoteResult> {
  const r = await sendJson<PromoteResult>(`/api/quote-requests/${requestId}/create-customer`, "POST");
  await fetchAppQuoteRequestsCached(true);
  invalidateCustomerDetail(r.id);
  return r;
}
