import { and, eq } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { customerMemos, customerSchedules, customerTasks } from "../schema";

type Created = { id: string; createdAt: Date };

// ── 메모 ───────────────────────────────────────────────
export async function addMemo(customerId: string, v: { body?: string | null }, ex: Executor = getDefaultDb()): Promise<Created> {
  const [row] = await ex.insert(customerMemos).values({ customerId, body: v.body ?? null }).returning({ id: customerMemos.id, createdAt: customerMemos.createdAt });
  return row;
}
export async function updateMemo(customerId: string, id: string, patch: { body?: string | null }, ex: Executor = getDefaultDb()): Promise<{ id: string } | null> {
  const [row] = await ex.update(customerMemos).set(patch).where(and(eq(customerMemos.id, id), eq(customerMemos.customerId, customerId))).returning({ id: customerMemos.id });
  return row ?? null;
}
export async function deleteMemo(customerId: string, id: string, ex: Executor = getDefaultDb()): Promise<{ id: string } | null> {
  const [row] = await ex.delete(customerMemos).where(and(eq(customerMemos.id, id), eq(customerMemos.customerId, customerId))).returning({ id: customerMemos.id });
  return row ?? null;
}

// ── 할일 ───────────────────────────────────────────────
export async function addTask(customerId: string, v: { category?: string | null; due?: string | null; body?: string | null }, ex: Executor = getDefaultDb()): Promise<Created> {
  const [row] = await ex.insert(customerTasks).values({ customerId, category: v.category ?? null, due: v.due ?? null, body: v.body ?? null }).returning({ id: customerTasks.id, createdAt: customerTasks.createdAt });
  return row;
}
export async function updateTask(customerId: string, id: string, patch: { category?: string | null; due?: string | null; body?: string | null; done?: boolean }, ex: Executor = getDefaultDb()): Promise<{ id: string } | null> {
  const [row] = await ex.update(customerTasks).set(patch).where(and(eq(customerTasks.id, id), eq(customerTasks.customerId, customerId))).returning({ id: customerTasks.id });
  return row ?? null;
}
export async function deleteTask(customerId: string, id: string, ex: Executor = getDefaultDb()): Promise<{ id: string } | null> {
  const [row] = await ex.delete(customerTasks).where(and(eq(customerTasks.id, id), eq(customerTasks.customerId, customerId))).returning({ id: customerTasks.id });
  return row ?? null;
}

// ── 일정 ───────────────────────────────────────────────
export async function addSchedule(customerId: string, v: { scheduledDate?: string | null; scheduledTime?: string | null; type?: string | null; memo?: string | null }, ex: Executor = getDefaultDb()): Promise<Created> {
  const [row] = await ex.insert(customerSchedules).values({ customerId, scheduledDate: v.scheduledDate ?? null, scheduledTime: v.scheduledTime ?? null, type: v.type ?? null, memo: v.memo ?? null }).returning({ id: customerSchedules.id, createdAt: customerSchedules.createdAt });
  return row;
}
export async function updateSchedule(customerId: string, id: string, patch: { scheduledDate?: string | null; scheduledTime?: string | null; type?: string | null; memo?: string | null; done?: boolean }, ex: Executor = getDefaultDb()): Promise<{ id: string } | null> {
  const [row] = await ex.update(customerSchedules).set(patch).where(and(eq(customerSchedules.id, id), eq(customerSchedules.customerId, customerId))).returning({ id: customerSchedules.id });
  return row ?? null;
}
export async function deleteSchedule(customerId: string, id: string, ex: Executor = getDefaultDb()): Promise<{ id: string } | null> {
  const [row] = await ex.delete(customerSchedules).where(and(eq(customerSchedules.id, id), eq(customerSchedules.customerId, customerId))).returning({ id: customerSchedules.id });
  return row ?? null;
}
