import { and, desc, eq, lt, or } from "drizzle-orm";

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

export type MessageCursor = { createdAt: Date; id: string };

// user+assistant를 한 INSERT로 원자 저장. createdAt은 호출부가 명시(순서 보존).
export async function insertAssistantMessages(rows: NewAssistantMessage[], executor: Executor = getDefaultDb()): Promise<AssistantMessageRow[]> {
  if (rows.length === 0) return [];
  return executor.insert(assistantMessages).values(rows).returning();
}

// 최근 limit개를 created_at desc(동점 시 id desc)로 받아 오름차순(표시 순서)으로 반환.
// before 커서가 있으면 그보다 "오래된"(created_at<커서 or 동일 created_at & id<커서) 것만.
export async function listRecentMessages(
  staffUserId: string,
  limit: number,
  executor: Executor = getDefaultDb(),
  before?: MessageCursor,
): Promise<AssistantMessageRow[]> {
  const olderThan = before
    ? or(
        lt(assistantMessages.createdAt, before.createdAt),
        and(eq(assistantMessages.createdAt, before.createdAt), lt(assistantMessages.id, before.id)),
      )
    : undefined;
  const rows = await executor
    .select().from(assistantMessages)
    .where(before ? and(eq(assistantMessages.staffUserId, staffUserId), olderThan) : eq(assistantMessages.staffUserId, staffUserId))
    .orderBy(desc(assistantMessages.createdAt), desc(assistantMessages.id))
    .limit(limit);
  return rows.reverse();
}

// 스트리밍 종료 시 placeholder 마감(내용·출처 확정). 대상 없으면 null.
// id+staffUserId 이중 키로 본인 메시지만 갱신(타 staff 메시지 오염 방지).
export async function updateAssistantMessage(
  id: string,
  staffUserId: string,
  content: string,
  sources: unknown,
  executor: Executor = getDefaultDb(),
): Promise<AssistantMessageRow | null> {
  const [row] = await executor
    .update(assistantMessages)
    .set({ content, sources })
    .where(and(eq(assistantMessages.id, id), eq(assistantMessages.staffUserId, staffUserId)))
    .returning();
  return row ?? null;
}

// 중단 트림: 본인 assistant 행의 content만 교체(sources 유지) — stop 시 화면 노출분으로 잘라
// 저장해 화면과 리로드를 일치시킨다(앱 미러: stop = 본 것까지만). 대상 없으면 null.
export async function updateAssistantMessageContent(
  id: string,
  staffUserId: string,
  content: string,
  executor: Executor = getDefaultDb(),
): Promise<AssistantMessageRow | null> {
  const [row] = await executor
    .update(assistantMessages)
    .set({ content })
    .where(and(
      eq(assistantMessages.id, id),
      eq(assistantMessages.staffUserId, staffUserId),
      eq(assistantMessages.role, "assistant"),
    ))
    .returning();
  return row ?? null;
}

// 0자 중단/실패 시 빈 placeholder 제거(유령 빈 메시지 방지). user 질문 행은 남긴다.
// id+staffUserId 이중 키로 본인 메시지만 삭제(타 staff 메시지 오염 방지).
export async function deleteAssistantMessage(id: string, staffUserId: string, executor: Executor = getDefaultDb()): Promise<void> {
  await executor.delete(assistantMessages).where(and(eq(assistantMessages.id, id), eq(assistantMessages.staffUserId, staffUserId)));
}
