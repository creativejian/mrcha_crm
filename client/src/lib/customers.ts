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
    nextAction: row.latestTask ?? "",
    aiSummary: row.aiSummary ?? "",
  };
}

export async function fetchCustomers(): Promise<Customer[]> {
  const res = await apiFetch("/api/customers");
  if (!res.ok) throw new Error(`고객 목록 실패: ${res.status}`);
  return ((await res.json()) as CustomerRow[]).map(toCustomer);
}

export async function fetchCustomer(id: string): Promise<CustomerRow & Record<string, unknown>> {
  const res = await apiFetch(`/api/customers/${id}`);
  if (!res.ok) throw new Error(`고객 상세 실패: ${res.status}`);
  return (await res.json()) as CustomerRow & Record<string, unknown>;
}
