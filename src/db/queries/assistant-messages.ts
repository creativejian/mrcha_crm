import { desc, eq } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { assistantMessages } from "../schema";

export type AssistantMessageRow = typeof assistantMessages.$inferSelect;
export type NewAssistantMessage = {
  staffUserId: string;
  role: "user" | "assistant";
  content: string;
  sources: unknown;
  createdAt: Date;
};

// user+assistant를 한 INSERT로 원자 저장. createdAt은 호출부가 명시(순서 보존).
export async function insertAssistantMessages(rows: NewAssistantMessage[], executor: Executor = getDefaultDb()): Promise<AssistantMessageRow[]> {
  if (rows.length === 0) return [];
  return executor.insert(assistantMessages).values(rows).returning();
}

// 최근 limit개를 created_at 내림차순으로 받아 오름차순(표시 순서)으로 반환.
export async function listRecentMessages(staffUserId: string, limit: number, executor: Executor = getDefaultDb()): Promise<AssistantMessageRow[]> {
  const rows = await executor
    .select().from(assistantMessages)
    .where(eq(assistantMessages.staffUserId, staffUserId))
    .orderBy(desc(assistantMessages.createdAt))
    .limit(limit);
  return rows.reverse();
}
