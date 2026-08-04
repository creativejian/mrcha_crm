import { and, arrayOverlaps, desc, eq, lt, or, sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { assistantMessages } from "../schema";

export type AssistantMessageRow = typeof assistantMessages.$inferSelect;
export type NewAssistantMessage = {
  staffUserId: string;
  role: "user" | "assistant";
  content: string;
  sources: unknown;
  createdAt: Date;
  /** user+assistant 한 쌍의 공통 키 — 반쪽만 남는 삭제를 막는다(provenance, 2026-08-04). */
  turnId: string;
  /** 이 턴이 다룬 고객 — 탈퇴 시 관련 대화만 골라 파기하는 근거. 없으면 빈 배열. */
  subjectCustomerIds: string[];
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

// 보존 기한 경과분 파기(회원탈퇴 계약 §7 "30일 rolling retention", 2026-08-04) — 업무 AI 대화는
// 고객 FK가 없고 user 턴 자유 텍스트에 고객 정보가 섞여 들어갈 수 있어 **어느 행이 누구 것인지
// 구조적으로 완전 추적이 불가능하다**. 앱 팀 회신에 명시했듯 이 일괄 파기가 그 한계의
// **상한 방어선**이다(개별 turn 삭제는 provenance 계측 후에야 정확해진다).
// ⚠️ 기준 시각은 반드시 **DB 시계**(`now()`) — 앱 시계로 계산해 넘기면 스큐만큼 경계가 흔들려
// 어떤 날은 하루치를 덜 지운다(`updated_at` 규약과 같은 축, AGENTS.md).
export async function purgeAssistantMessagesOlderThan(days: number, executor: Executor = getDefaultDb()): Promise<number> {
  const rows = await executor
    .delete(assistantMessages)
    .where(lt(assistantMessages.createdAt, sql`now() - make_interval(days => ${days})`))
    .returning({ id: assistantMessages.id });
  return rows.length;
}

// 특정 고객이 걸린 대화 파기(탈퇴·파기 경로 — 회신 §7 "탈퇴·파기 시 관련 turn 삭제").
// provenance(subject_customer_ids)가 붙은 턴만 걸린다: user·assistant 양쪽에 같은 배열을 싣기
// 때문에 질문과 답변이 함께 사라진다. **도입(2026-08-04) 이전 과거 행은 배열이 NULL이라 안
// 걸리고**, 질문 텍스트에만 이름이 나온 턴도 원리적으로 못 잡는다 — 그 잔여의 방어선이
// 30일 rolling이다(이 한계를 앱 팀 회신에 명시했다).
export async function purgeAssistantMessagesForCustomer(customerId: string, executor: Executor = getDefaultDb()): Promise<number> {
  const rows = await executor
    .delete(assistantMessages)
    .where(arrayOverlaps(assistantMessages.subjectCustomerIds, [customerId]))
    .returning({ id: assistantMessages.id });
  return rows.length;
}

// 전량 파기(앱 출시 전 1회 — 회신 §7 "출시 전 기존 메시지 일괄 정리"). 스크립트 전용:
// 되돌릴 수 없고 전 직원 대화가 사라지므로 실행 시점을 직원에게 사전 공지하는 것이 계약이다.
export async function purgeAllAssistantMessages(executor: Executor = getDefaultDb()): Promise<number> {
  const rows = await executor.delete(assistantMessages).returning({ id: assistantMessages.id });
  return rows.length;
}

// 0자 중단/실패 시 빈 placeholder 제거(유령 빈 메시지 방지). user 질문 행은 남긴다.
// id+staffUserId 이중 키로 본인 메시지만 삭제(타 staff 메시지 오염 방지).
export async function deleteAssistantMessage(id: string, staffUserId: string, executor: Executor = getDefaultDb()): Promise<void> {
  await executor.delete(assistantMessages).where(and(eq(assistantMessages.id, id), eq(assistantMessages.staffUserId, staffUserId)));
}
