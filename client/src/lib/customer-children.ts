import { apiFetch } from "./api";

// 고객 자식(메모/할일/일정) CRUD. 쓰기는 apiFetch 재시도 대상 아님.
export type ChildCreated = { id: string; createdAt: string };

async function writeJson(path: string, method: "POST" | "PATCH", body: unknown): Promise<Response> {
  const res = await apiFetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path} 실패: ${res.status}`);
  return res;
}
async function del(path: string): Promise<void> {
  const res = await apiFetch(path, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} 실패: ${res.status}`);
}

type MemoBody = { body?: string | null };
type TaskBody = { category?: string | null; due?: string | null; body?: string | null; done?: boolean };
type ScheduleBody = { scheduledDate?: string | null; scheduledTime?: string | null; type?: string | null; memo?: string | null; done?: boolean };

export const addMemo = (cid: string, v: MemoBody) => writeJson(`/api/customers/${cid}/memos`, "POST", v).then((r) => r.json() as Promise<ChildCreated>);
export const updateMemo = (cid: string, id: string, v: MemoBody) => writeJson(`/api/customers/${cid}/memos/${id}`, "PATCH", v).then(() => undefined);
export const deleteMemo = (cid: string, id: string) => del(`/api/customers/${cid}/memos/${id}`);

export const addTask = (cid: string, v: TaskBody) => writeJson(`/api/customers/${cid}/tasks`, "POST", v).then((r) => r.json() as Promise<ChildCreated>);
export const updateTask = (cid: string, id: string, v: TaskBody) => writeJson(`/api/customers/${cid}/tasks/${id}`, "PATCH", v).then(() => undefined);
export const deleteTask = (cid: string, id: string) => del(`/api/customers/${cid}/tasks/${id}`);

export const addSchedule = (cid: string, v: ScheduleBody) => writeJson(`/api/customers/${cid}/schedules`, "POST", v).then((r) => r.json() as Promise<ChildCreated>);
export const updateSchedule = (cid: string, id: string, v: ScheduleBody) => writeJson(`/api/customers/${cid}/schedules/${id}`, "PATCH", v).then(() => undefined);
export const deleteSchedule = (cid: string, id: string) => del(`/api/customers/${cid}/schedules/${id}`);
