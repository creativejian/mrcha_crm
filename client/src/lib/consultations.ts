// 앱 상담신청(public.consultations) → CRM 고객 통합. 견적요청(quote-requests.ts fetchCustomerQuoteRequestsCached) 패턴 미러.
// 고객 상세 니즈 영역의 읽기 전용 문의 카드 목록 전용 — link/create-customer 승격 흐름은 서버(consultations.ts 라우트)만 다룬다.
import { formatActivity } from "./customers";
import { getJson } from "./http";

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

// 캐시 버림(대칭용, 외부 무효화 경로용으로 노출 — 현재 호출부 없음: 상담신청은 읽기 전용이라 CRM 쓰기 경로가 없다).
export function invalidateCustomerConsultations(customerId: string): void {
  cache.delete(customerId);
}
