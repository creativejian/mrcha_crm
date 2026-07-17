// 앱 상담신청(public.consultations) → CRM 고객 통합. 견적요청(quote-requests.ts fetchCustomerQuoteRequestsCached) 패턴 미러.
// ①고객 상세 니즈 영역의 읽기 전용 문의 카드 목록 ②상담 신청 DB 인박스(pending 목록 + link/create 승격).
import { formatActivity, invalidateCustomerDetail } from "./customers";
import { getJson, sendJson, sendVoid } from "./http";

// 백엔드 GET /api/customers/:id/consultations 응답 1행(ConsultationRow, camelCase).
export type AppConsultationRow = {
  id: string;
  userId: string | null;
  customerName: string;
  phoneNumber: string;
  carModel: string | null;
  notes: string | null;
  status: string | null;
  createdAt: string;
};

// 화면 표시용 상담신청 1건(읽기 전용 문의 카드).
export type AppConsultation = {
  id: string;
  carModel: string | null;
  notes: string | null;
  dateLabel: string;
};

export function toAppConsultation(row: AppConsultationRow): AppConsultation {
  return {
    id: row.id,
    carModel: row.carModel,
    notes: row.notes,
    dateLabel: formatActivity(row.createdAt),
  };
}

// 고객 상세 니즈 영역: 그 고객의 앱 상담신청 문의 카드 목록.
export async function fetchCustomerConsultations(customerId: string): Promise<AppConsultation[]> {
  return (await getJson<AppConsultationRow[]>(`/api/customers/${customerId}/consultations`)).map(toAppConsultation);
}

// 고객별 캐시 + TTL + inflight dedupe (fetchCustomerQuoteRequestsCached와 동형, 고객 uuid 키).
const TTL_MS = 60_000;
const cache = new Map<string, { value: AppConsultation[]; at: number }>();
const inflight = new Map<string, Promise<AppConsultation[]>>();

export function fetchCustomerConsultationsCached(customerId: string, force = false): Promise<AppConsultation[]> {
  const cached = cache.get(customerId);
  if (!force && cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.value);
  const existing = inflight.get(customerId);
  if (!force && existing) return existing;
  const p = fetchCustomerConsultations(customerId)
    .then((value) => {
      cache.set(customerId, { value, at: Date.now() });
      return value;
    })
    .finally(() => {
      if (inflight.get(customerId) === p) inflight.delete(customerId);
    });
  if (!force) inflight.set(customerId, p);
  return p;
}

// 캐시 버림(dismissConsultation 성공 후 그 고객 캐시 무효화용).
export function invalidateCustomerConsultations(customerId: string): void {
  cache.delete(customerId);
}

// CRM 전용 삭제 — 백엔드가 dismissal만 기록(public.consultations는 어떤 경로로도 변경하지 않는다).
export async function dismissConsultation(consultationId: string): Promise<void> {
  await sendVoid(`/api/consultations/${consultationId}`, "DELETE");
}

// ── 상담 신청 DB 인박스 ─────────────────────────────────────────────────────────
// raw row 그대로 반환 — 유저 그룹핑·매칭 파생은 consultation-inbox.ts(순수 계층)가 담당.
export async function fetchPendingConsultations(): Promise<AppConsultationRow[]> {
  return getJson<AppConsultationRow[]>("/api/consultations");
}

// 인박스 목록 캐시 + inflight dedupe (quote-requests fetchAppQuoteRequestsCached와 동형, 단일 키).
// 사이드메뉴 hover 프리패치·재진입은 캐시 hit으로 즉시, 60s 폴링·승격 후는 force=true로 fresh.
const INBOX_TTL_MS = 60_000;
let inboxCache: { value: AppConsultationRow[]; at: number } | null = null;
let inboxInflight: Promise<AppConsultationRow[]> | null = null;

export function fetchPendingConsultationsCached(force = false): Promise<AppConsultationRow[]> {
  if (!force && inboxCache && Date.now() - inboxCache.at < INBOX_TTL_MS) return Promise.resolve(inboxCache.value);
  if (!force && inboxInflight) return inboxInflight;
  const p = fetchPendingConsultations()
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

// 사이드메뉴 '상담 신청 DB' hover가 호출. 백그라운드 워밍(결과/에러 무시).
export function prefetchPendingConsultations(): void {
  void fetchPendingConsultationsCached().catch(() => {});
}

// droppedPhone: link 전이에서 secondary 점유로 옮기지 못한 기존 번호(2026-07-17 spec — 무음 유실 방지 토스트용).
// create 응답에는 없다(optional).
type PromoteResult = { id: string; customerCode: string; name: string; droppedPhone?: string | null };

// 전화 매칭된 기존 고객에 연결. 성공 시 인박스 캐시 fresh + 그 고객 상세·상담 카드 캐시 무효화
// (연결로 그 고객의 상담신청 카드 목록이 비어있음→N건으로 바뀐다).
export async function linkConsultationToCustomer(consultationId: string, customerId: string): Promise<PromoteResult> {
  const r = await sendJson<PromoteResult>(`/api/consultations/${consultationId}/link`, "POST", { customerId });
  await fetchPendingConsultationsCached(true);
  invalidateCustomerDetail(customerId);
  invalidateCustomerConsultations(customerId);
  return r;
}

// 미매칭 유저 → 신규 고객 생성. 성공 시 인박스 캐시 fresh + 생성 고객 상세 캐시 무효화.
export async function createCustomerFromConsultation(consultationId: string): Promise<PromoteResult> {
  const r = await sendJson<PromoteResult>(`/api/consultations/${consultationId}/create-customer`, "POST");
  await fetchPendingConsultationsCached(true);
  invalidateCustomerDetail(r.id);
  return r;
}
