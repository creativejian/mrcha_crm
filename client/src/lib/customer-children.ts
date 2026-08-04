import type { CustomerDeliveryInfo, CustomerSettlement, CustomerSettlementPatch } from "@/data/customers";
import { getJson, sendJson, sendVoid } from "./http";
import { invalidateCustomerDetail } from "./customers";

// 고객 자식(메모/할일/일정) CRUD. 쓰기는 apiFetch 재시도 대상 아님.
// 성공 시 해당 고객 상세 캐시를 무효화 → 재진입 시 최신 자식 목록을 받는다.
export type ChildCreated = { id: string; createdAt: string };

// 성공 후 캐시 무효화 래퍼.
async function created(cid: string, op: Promise<ChildCreated>): Promise<ChildCreated> {
  const d = await op;
  invalidateCustomerDetail(cid);
  return d;
}
async function done(cid: string, op: Promise<unknown>): Promise<void> {
  await op;
  invalidateCustomerDetail(cid);
}

type MemoBody = { body?: string | null };
type TaskBody = { category?: string | null; due?: string | null; body?: string | null; done?: boolean };
type ScheduleBody = { scheduledDate?: string | null; scheduledTime?: string | null; type?: string | null; memo?: string | null; done?: boolean };

export const addMemo = (cid: string, v: MemoBody) => created(cid, sendJson<ChildCreated>(`/api/customers/${cid}/memos`, "POST", v));
export const updateMemo = (cid: string, id: string, v: MemoBody) => done(cid, sendVoid(`/api/customers/${cid}/memos/${id}`, "PATCH", v));
export const deleteMemo = (cid: string, id: string) => done(cid, sendVoid(`/api/customers/${cid}/memos/${id}`, "DELETE"));

export const addTask = (cid: string, v: TaskBody) => created(cid, sendJson<ChildCreated>(`/api/customers/${cid}/tasks`, "POST", v));
export const updateTask = (cid: string, id: string, v: TaskBody) => done(cid, sendVoid(`/api/customers/${cid}/tasks/${id}`, "PATCH", v));
export const deleteTask = (cid: string, id: string) => done(cid, sendVoid(`/api/customers/${cid}/tasks/${id}`, "DELETE"));

export const addSchedule = (cid: string, v: ScheduleBody) => created(cid, sendJson<ChildCreated>(`/api/customers/${cid}/schedules`, "POST", v));
export const updateSchedule = (cid: string, id: string, v: ScheduleBody) => done(cid, sendVoid(`/api/customers/${cid}/schedules/${id}`, "PATCH", v));
export const deleteSchedule = (cid: string, id: string) => done(cid, sendVoid(`/api/customers/${cid}/schedules/${id}`, "DELETE"));

// 출고 정보 upsert(PUT — 전체 교체, 출고 2단계 spec §4.2). 드로어는 출고 정보를 안 보여주지만
// 캐시 무효화는 관례대로 동반(무해·미래 편입 대비).
export const saveCustomerDelivery = (cid: string, v: CustomerDeliveryInfo) => done(cid, sendVoid(`/api/customers/${cid}/delivery`, "PUT", v));

// 정산(입금일·실입금액) — **admin 전용 라우트**(서버 requireRoles가 진짜 게이트, 유슨생 결정 2026-08-03).
// 출고 정보와 같은 행이지만 경로를 나눠서, 고객 목록 응답이 정산을 실어 나르지 않는다(읽기 차단).
// 그래서 팝오버는 열릴 때 이걸 따로 조회해야 한다 — 목록 데이터에는 정산이 없다.
export const fetchCustomerSettlement = (cid: string) => getJson<CustomerSettlement>(`/api/customers/${cid}/settlement`);
export const saveCustomerSettlement = (cid: string, v: CustomerSettlementPatch) => done(cid, sendVoid(`/api/customers/${cid}/settlement`, "PUT", v));
