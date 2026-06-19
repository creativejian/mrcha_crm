import type { Customer } from "@/data/customers";
import { apiFetch } from "./api";

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
    phone: row.phone ?? "",
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
  const res = await apiFetch("/api/customers");
  if (!res.ok) throw new Error(`고객 목록 실패: ${res.status}`);
  return ((await res.json()) as CustomerRow[]).map(toCustomer);
}

// ── 고객 상세(GET /api/customers/:id = getCustomer) ─────────────────────────────
// 백엔드는 drizzle camelCase 그대로 반환(자식 배열 포함). consultations는 이번 범위 외라 생략.
export type CustomerDetailTask = { id: string; category: string | null; due: string | null; body: string | null; done: boolean };
export type CustomerDetailSchedule = { id: string; scheduledDate: string | null; scheduledTime: string | null; type: string | null; memo: string | null; done: boolean };
export type CustomerDetailMemo = { id: string; body: string | null; createdAt: string | null };
export type CustomerDetailDocument = { id: string; title: string | null; docType: string | null; fileName: string | null; fileSize: number | null; fileMime: string | null };

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
  };
}

export async function fetchCustomerDetail(id: string): Promise<CustomerDetailData> {
  const res = await apiFetch(`/api/customers/${id}`);
  if (!res.ok) throw new Error(`고객 상세 실패: ${res.status}`);
  return toCustomerDetail((await res.json()) as CustomerDetailResponse);
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
  const res = await apiFetch(`/api/customers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`고객 저장 실패: ${res.status}`);
}
