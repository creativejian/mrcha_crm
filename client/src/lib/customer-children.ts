import { sendJson, sendVoid } from "./http";
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
