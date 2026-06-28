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
  matchType: AppQuoteRequestRow["matchType"];
};

function moneyOrDash(won: number | null): string {
  return won != null && won > 0 ? formatPriceRangeKorean(won, null) : "—";
}

export function toAppQuoteRequest(row: AppQuoteRequestRow): AppQuoteRequest {
  const vehicleLabel =
    [row.brandName, row.modelName].filter(Boolean).join(" ") +
    (row.trimName ? ` · ${row.trimName}` : "");
  const depositName = row.depositType ? (DEPOSIT_TYPE_LABEL[row.depositType] ?? row.depositType) : null;
  const depositMoney = row.rentalDeposit != null && row.rentalDeposit > 0 ? ` ${formatPriceRangeKorean(row.rentalDeposit, null)}` : "";
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
    depositLabel: depositName ? `${depositName}${depositMoney}` : "—",
    trimPriceLabel: moneyOrDash(row.trimPrice),
    optionLabel: row.optionCount > 0 ? `${row.optionCount}개` : "없음",
    statusLabel: row.status ? (STATUS_LABEL[row.status] ?? row.status) : "—",
    matchLabel,
    matchedCustomerId: row.matchedCustomerId,
    matchedCustomerName: row.matchedCustomerName,
    matchedCustomerCode: row.matchedCustomerCode,
    promotedQuoteCount: row.promotedQuoteCount,
    matchType: row.matchType,
  };
}

export async function fetchAppQuoteRequests(): Promise<AppQuoteRequest[]> {
  return (await getJson<AppQuoteRequestRow[]>("/api/quote-requests")).map(toAppQuoteRequest);
}

// prefill용 단건. paymentMethod는 한글 라벨(워크벤치 구매방식 옵션과 일치)로 변환해 반환.
export type QuoteRequestPrefill = {
  id: string;
  trimId: number | null;
  optionIds: number[];
  purchaseMethod: string | null;
};

export async function fetchQuoteRequestDetail(id: string): Promise<QuoteRequestPrefill> {
  const d = await getJson<{ id: string; trimId: number | null; paymentMethod: string | null; optionIds: number[] }>(
    `/api/quote-requests/${id}`,
  );
  return {
    id: d.id,
    trimId: d.trimId,
    optionIds: d.optionIds,
    purchaseMethod: d.paymentMethod ? (PAYMENT_METHOD_LABEL[d.paymentMethod] ?? d.paymentMethod) : null,
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
