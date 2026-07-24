import {
  COLOR_PREFERENCE_MODE_LABEL,
  DEPOSIT_TYPE_LABEL,
  PAYMENT_METHOD_LABEL,
  REQUEST_TOPIC_LABEL,
} from "../data/quote-request-labels";
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
  colorPreferenceMode: string | null;
  exteriorColorId: number | null;
  exteriorColorName: string | null;
  exteriorColorHex: string | null;
  interiorColorId: number | null;
  interiorColorName: string | null;
  interiorColorHex: string | null;
  // 출고 정보는 서버가 파생해서 보낸다(원본 지역 5필드가 아니라 결론 1개) — 사유는 서버 타입 주석 참조.
  deliveryRegion: string | null;
  deliveryTimingText: string | null;
  requestTopicCodes: string[];
  additionalRequest: string | null;
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
  nameMatches: { id: string; name: string; code: string }[];
};

// 결제방식/보증금 라벨은 data/quote-request-labels(클라·서버 공용 SSOT — 배치 E 수렴)에서 import.
// STATUS_LABEL은 클라 전용 잔존 — 서버 코퍼스는 status를 의도적으로 미포함(스테일 박제 방지).
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
  colorLabel: string | null; // null = 기존 행(mode 없음) → 카드 라벨 숨김
  // 출고 = 지역 · 시기 합성. null = V2 이전 레거시 요청 → 카드에서 줄째로 숨김(colorLabel과 동형).
  deliveryLabel: string | null;
  topicLabels: string[];
  additionalRequest: string | null;
  statusLabel: string;
  matchLabel: string;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  matchedCustomerCode: string | null;
  promotedQuoteCount: number;
  promotedQuoteIds: string[];
  matchType: AppQuoteRequestRow["matchType"];
  nameMatches: AppQuoteRequestRow["nameMatches"];
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

// 희망 컬러 상태 → 카드 라벨. mode null(기존 행)·미지의 값이면 null(라벨 숨김).
// selected일 때 어느 컬러인지는 워크벤치 프리필에서 보여준다(카드는 상태 텍스트만 — 이사님 결정).
export function colorLabelOf(mode: string | null): string | null {
  if (!mode) return null;
  return COLOR_PREFERENCE_MODE_LABEL[mode] ?? null;
}

// 출고 카드 라벨 = 지역 · 시기. 한쪽만 있으면 그것만, 둘 다 없으면 null(레거시 요청 → 줄 숨김).
// 지역·시기 파생 자체는 서버(quote-delivery.ts)가 끝냈고 여기는 합성만 한다.
export function deliveryLabelOf(row: Pick<AppQuoteRequestRow, "deliveryRegion" | "deliveryTimingText">): string | null {
  const parts = [row.deliveryRegion, row.deliveryTimingText].filter((v): v is string => !!v);
  return parts.length > 0 ? parts.join(" · ") : null;
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
    colorLabel: colorLabelOf(row.colorPreferenceMode),
    deliveryLabel: deliveryLabelOf(row),
    // ?? 방어는 타입상 불필요해 보이지만 실제로 필요하다 — 배포 스큐(브라우저에 캐시된 새 번들 ↔ 아직
    // 구버전인 API 응답) 때 이 필드가 통째로 없고, 그러면 .map()이 던져 인박스 전체가 빈 화면이 된다.
    topicLabels: (row.requestTopicCodes ?? []).map((code) => REQUEST_TOPIC_LABEL[code] ?? code),
    additionalRequest: row.additionalRequest ?? null,
    statusLabel: row.status ? (STATUS_LABEL[row.status] ?? row.status) : "—",
    matchLabel,
    matchedCustomerId: row.matchedCustomerId,
    matchedCustomerName: row.matchedCustomerName,
    matchedCustomerCode: row.matchedCustomerCode,
    promotedQuoteCount: row.promotedQuoteCount,
    promotedQuoteIds: row.promotedQuoteIds,
    matchType: row.matchType,
    nameMatches: row.nameMatches,
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
  // 컬러 id는 selected일 때만 non-null(서버가 그 경우만 담는다). 워크벤치가 catalog detail.colors에서
  // id로 TrimColor를 찾아 프리필하므로 name/hex는 프리필에 불필요.
  exteriorColorId: number | null;
  interiorColorId: number | null;
};

// customerId 동봉(배치 12 K1): 프리필 라우트가 customers 하위로 이사 — #302 인박스 게이트에 드로어
// 흐름이 걸리던 부수 피해 해소 + 서버가 "그 고객 소유 요청"만 반환(소유권 WHERE).
export async function fetchQuoteRequestDetail(customerId: string, id: string): Promise<QuoteRequestPrefill> {
  const d = await getJson<{
    id: string;
    trimId: number | null;
    paymentMethod: string | null;
    optionIds: number[];
    period: number | null;
    depositType: string | null;
    depositRatio: number | null;
    rentalDeposit: number | null;
    exteriorColorId?: number | null;
    interiorColorId?: number | null;
  }>(`/api/customers/${customerId}/quote-requests/${id}`);
  return {
    id: d.id,
    trimId: d.trimId,
    optionIds: d.optionIds,
    purchaseMethod: d.paymentMethod ? (PAYMENT_METHOD_LABEL[d.paymentMethod] ?? d.paymentMethod) : null,
    period: d.period,
    depositType: d.depositType,
    depositRatio: d.depositRatio,
    rentalDeposit: d.rentalDeposit,
    exteriorColorId: d.exteriorColorId ?? null,
    interiorColorId: d.interiorColorId ?? null,
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

// droppedPhone: link 전이에서 secondary 점유로 옮기지 못한 기존 번호(2026-07-17 spec — 무음 유실 방지 토스트용).
// create 응답에는 없다(optional).
type PromoteResult = { id: string; customerCode: string; name: string; droppedPhone?: string | null };

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
