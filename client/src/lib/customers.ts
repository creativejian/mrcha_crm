import type { Customer } from "@/data/customers";
import { getJson, sendVoid } from "./http";
import type { CustomerDetailQuote } from "./kim-quote";

// 백엔드 listCustomers 응답 1행(camelCase, null 가능). 상세는 추가 자식 필드 포함.
export type CustomerRow = {
  id: string;
  customerCode: string;
  name: string;
  phone: string | null;
  customerType: string | null;
  customerTypeDetail: string | null;
  team: string | null;
  source: string | null;
  statusGroup: string | null;
  status: string | null;
  priority: string | null;
  chance: string | null;
  aiSummary: string | null;
  needModel: string | null;
  needMethod: string | null;
  receivedAt: string | null;
  assignedAt: string | null;
  lastActivityAt: string | null;
  latestTask: string | null;
};

// 전화번호 표시 포맷. DB엔 숫자만 저장하고, 화면에선 하이픈 포맷으로 보여준다.
// 입력이 하이픈 포함이어도 먼저 숫자만 추출하므로 digits/hyphen 둘 다 안전(전환기 호환).
export function formatPhone(raw: string | null): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return raw ?? "";
}

// timestamptz → 화면 표시 문자열. 기준일 비교 없이 "YY/MM/DD HH:mm"(읽기 1차 — 상대표현 보류).
export function formatActivity(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear()).slice(2)}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    no: Number(row.customerCode.replace(/\D/g, "")),
    customerId: row.customerCode,
    receivedAt: formatActivity(row.receivedAt),
    assignedAt: formatActivity(row.assignedAt),
    team: row.team ?? "",
    name: row.name,
    customerType: row.customerType ?? "",
    customerTypeDetail: row.customerTypeDetail ?? "",
    phone: formatPhone(row.phone),
    vehicle: row.needModel ?? "",
    method: row.needMethod ?? "",
    advisor: "미배정",
    statusGroup: row.statusGroup ?? "",
    status: row.status ?? "",
    date: formatActivity(row.lastActivityAt),
    source: row.source ?? "",
    talkCount: "",
    priority: row.priority ?? "",
    chance: row.chance ?? undefined,
    nextAction: row.latestTask ?? "",
    aiSummary: row.aiSummary ?? "",
  };
}

export async function fetchCustomers(): Promise<Customer[]> {
  return (await getJson<CustomerRow[]>("/api/customers")).map(toCustomer);
}

// ── 고객 상세(GET /api/customers/:id = getCustomer) ─────────────────────────────
// 백엔드는 drizzle camelCase 그대로 반환(자식 배열 포함). consultations는 이번 범위 외라 생략.
type CustomerDetailTask = { id: string; category: string | null; due: string | null; body: string | null; done: boolean };
type CustomerDetailSchedule = { id: string; scheduledDate: string | null; scheduledTime: string | null; type: string | null; memo: string | null; done: boolean };
type CustomerDetailMemo = { id: string; body: string | null; createdAt: string | null };
type CustomerDetailDocument = { id: string; docType: string | null; fileName: string | null; fileSize: number | null; fileMime: string | null; sortOrder: number | null; createdAt: string | null };

export type CustomerDetailResponse = {
  id: string;
  customerCode: string;
  name: string;
  phone: string | null;
  residence: string | null;
  customerType: string | null;
  customerTypeDetail: string | null;
  source: string | null;
  assignedAt: string | null;
  receivedAt: string | null;
  needModel: string | null;
  needTrim: string | null;
  needColors: string | null;
  needMethod: string | null;
  needTiming: string | null;
  needMemo: string | null;
  tasks: CustomerDetailTask[];
  schedules: CustomerDetailSchedule[];
  memos: CustomerDetailMemo[];
  documents: CustomerDetailDocument[];
  quotes: CustomerDetailQuote[];
};

export type CustomerDetailData = Pick<
  CustomerDetailResponse,
  | "id"
  | "customerCode"
  | "name"
  | "phone"
  | "residence"
  | "customerType"
  | "customerTypeDetail"
  | "source"
  | "assignedAt"
  | "receivedAt"
  | "needModel"
  | "needTrim"
  | "needColors"
  | "needMethod"
  | "needTiming"
  | "needMemo"
  | "tasks"
  | "schedules"
  | "memos"
  | "documents"
  | "quotes"
>;

export function toCustomerDetail(res: CustomerDetailResponse): CustomerDetailData {
  return {
    id: res.id,
    customerCode: res.customerCode,
    name: res.name,
    phone: res.phone,
    residence: res.residence,
    customerType: res.customerType,
    customerTypeDetail: res.customerTypeDetail,
    source: res.source,
    assignedAt: res.assignedAt,
    receivedAt: res.receivedAt,
    needModel: res.needModel,
    needTrim: res.needTrim,
    needColors: res.needColors,
    needMethod: res.needMethod,
    needTiming: res.needTiming,
    needMemo: res.needMemo,
    tasks: res.tasks ?? [],
    schedules: res.schedules ?? [],
    memos: res.memos ?? [],
    documents: res.documents ?? [],
    quotes: res.quotes ?? [],
  };
}

// 상세 결과 캐시 + inflight dedup.
// - 재진입은 캐시 hit으로 즉시(왕복 0), hover 프리패치가 캐시를 미리 채움.
// - 쓰기(본체 PATCH·자식 CRUD)는 성공 시 해당 고객 캐시를 무효화 → 다음 진입만 새로 fetch(stale 없음).
// - TTL 60s: 타인 변경 등 외부 수정도 흡수.
const DETAIL_FRESH_MS = 60_000;
const detailCache = new Map<string, { data: CustomerDetailData; at: number }>();
const detailInflight = new Map<string, Promise<CustomerDetailData>>();

// 쓰기 성공 시 호출 — 해당 고객 상세 캐시를 버려 다음 진입에 최신을 받게 한다.
export function invalidateCustomerDetail(id: string): void {
  detailCache.delete(id);
}

export async function fetchCustomerDetail(id: string): Promise<CustomerDetailData> {
  const cached = detailCache.get(id);
  if (cached && Date.now() - cached.at < DETAIL_FRESH_MS) return cached.data;
  const existing = detailInflight.get(id);
  if (existing) return existing;
  const p = getJson<CustomerDetailResponse>(`/api/customers/${id}`)
    .then(toCustomerDetail)
    .then((data) => {
      detailCache.set(id, { data, at: Date.now() });
      return data;
    })
    .finally(() => detailInflight.delete(id));
  detailInflight.set(id, p);
  return p;
}

// 행 hover 시 호출 — 클릭 전에 캐시를 미리 채워 진입 시 즉시 표시.
export function prefetchCustomerDetail(id: string): void {
  void fetchCustomerDetail(id).catch(() => undefined);
}

// ── 고객 본체 쓰기(PATCH /api/customers/:id) ────────────────────────────────────
// 쓰기 가능 컬럼 partial. 백엔드 customerWriteSchema와 1:1. 쓰기는 apiFetch 재시도 대상 아님.
export type CustomerWritePatch = {
  phone?: string | null;
  residence?: string | null;
  customerType?: string | null;
  customerTypeDetail?: string | null;
  source?: string | null;
  statusGroup?: string | null;
  status?: string | null;
  chance?: string | null;
  needModel?: string | null;
  needTrim?: string | null;
  needColors?: string | null;
  needMethod?: string | null;
  needTiming?: string | null;
  needMemo?: string | null;
};

export async function updateCustomer(id: string, patch: CustomerWritePatch): Promise<void> {
  await sendVoid(`/api/customers/${id}`, "PATCH", patch);
  invalidateCustomerDetail(id);
}
