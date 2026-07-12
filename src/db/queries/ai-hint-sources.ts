import { and, desc, eq, isNotNull, ne, notExists, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type { AiHintMaterialInput } from "../../lib/ai-hint";
import { buildCustomerProfileChunkText } from "../../lib/assistant-corpus";
import { getDefaultDb, type Executor } from "../client";
import { consultationRequests } from "../public-app";
import { consultationDismissals, customerMemos, customerTasks, customers, quotes } from "../schema";
import { PROFILE_CHUNK_COLUMNS } from "./embed-sources";

// AI 힌트 재료의 fresh read(고객 단위) + ai_summary 쓰기. 재료 구성 = 설계 노트 재료 목록
// (프로필 SSOT + 진행 + 최근 메모/미완료 할일 + 최신 견적 + 앱 상담 문의). 일정·서류는 의도적 제외
// (lib/ai-hint.ts AiHintMaterialInput 계약 참조).

export type AiHintSourceSnapshot = AiHintMaterialInput & {
  aiSummary: string | null;
  sourceHash: string | null;
};

const RECENT_MEMOS = 3;
const RECENT_TASKS = 3;

// null이 아니고, trim 후에도 빈 문자열이 아닌 행만 포함(backfill-embeddings.ts nonEmpty 미러 — 스크립트
// 모듈은 GEMINI_API_KEY 없으면 즉시 throw해 쿼리 계층에서 import 불가, 소형 순수 헬퍼라 각자 보유).
function nonEmpty(col: AnyPgColumn) {
  return and(isNotNull(col), ne(sql`btrim(${col})`, ""));
}

export async function loadAiHintSource(customerId: string, ex: Executor = getDefaultDb()): Promise<AiHintSourceSnapshot | null> {
  const [row] = await ex.select({
    name: customers.name,
    statusGroup: customers.statusGroup, status: customers.status,
    chance: customers.chance, priority: customers.priority,
    appUserId: customers.appUserId,
    aiSummary: customers.aiSummary, sourceHash: customers.aiSummarySourceHash,
    ...PROFILE_CHUNK_COLUMNS,
  }).from(customers).where(eq(customers.id, customerId));
  if (!row) return null;

  const memos = await ex.select({ body: customerMemos.body })
    .from(customerMemos)
    .where(and(eq(customerMemos.customerId, customerId), nonEmpty(customerMemos.body)))
    .orderBy(desc(customerMemos.createdAt), desc(customerMemos.id))
    .limit(RECENT_MEMOS);

  const tasks = await ex.select({ category: customerTasks.category, due: customerTasks.due, body: customerTasks.body })
    .from(customerTasks)
    .where(and(eq(customerTasks.customerId, customerId), eq(customerTasks.done, false)))
    .orderBy(desc(customerTasks.createdAt), desc(customerTasks.id))
    .limit(RECENT_TASKS);

  const [quote] = await ex.select({ modelName: quotes.modelName, trimName: quotes.trimName, appStatus: quotes.appStatus })
    .from(quotes)
    .where(eq(quotes.customerId, customerId))
    .orderBy(desc(quotes.createdAt), desc(quotes.id))
    .limit(1);

  // 앱 상담신청 최신 문의 — customer_consultations 도구(assistant-tools.ts)와 같은 dismissed 제외 규칙.
  // appUserId 없는(미연결) 고객은 상담 조회 자체를 안 탄다(왕복 절약).
  let consultationNote: string | null = null;
  if (row.appUserId) {
    const [latest] = await ex.select({ notes: consultationRequests.notes })
      .from(consultationRequests)
      .where(and(
        eq(consultationRequests.userId, row.appUserId),
        nonEmpty(consultationRequests.notes),
        notExists(
          ex.select({ id: consultationDismissals.consultationId })
            .from(consultationDismissals)
            .where(eq(consultationDismissals.consultationId, consultationRequests.id)),
        ),
      ))
      .orderBy(desc(consultationRequests.createdAt))
      .limit(1);
    consultationNote = latest?.notes ?? null;
  }

  return {
    name: row.name,
    statusGroup: row.statusGroup, status: row.status, chance: row.chance, priority: row.priority,
    aiSummary: row.aiSummary, sourceHash: row.sourceHash,
    profileText: buildCustomerProfileChunkText(row),
    memos: memos.map((m) => ({ body: m.body ?? "" })),
    tasks,
    quote: quote ?? null,
    consultationNote,
  };
}

export async function setCustomerAiHint(
  customerId: string,
  hint: { aiSummary: string | null; sourceHash: string | null },
  ex: Executor = getDefaultDb(),
): Promise<void> {
  await ex.update(customers)
    .set({ aiSummary: hint.aiSummary, aiSummarySourceHash: hint.sourceHash })
    .where(eq(customers.id, customerId));
}
