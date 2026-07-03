// 코퍼스(상담메모·상담이력·니즈메모·할일)를 임베딩해 crm.embeddings에 upsert하는 일회성 스크립트.
// 실행: bun run src/scripts/backfill-embeddings.ts  (.env.local의 GEMINI_API_KEY·DATABASE_URL 사용)
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { getDefaultDb } from "../db/client";
import { customers, customerMemos, customerTasks, consultations } from "../db/schema";
import { upsertEmbedding } from "../db/queries/embeddings";
import { buildChunkContent, contentHash, type CorpusRow } from "../lib/assistant-corpus";
import { embedTexts } from "../lib/gemini-embed";
import { resolveGeminiTarget } from "../lib/gemini-target";

const db = getDefaultDb();
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY is not set (.env.local)");
const geminiTarget = resolveGeminiTarget({ apiKey }); // 로컬 실행 — 항상 직결(한국 IP)

// null이 아니고, trim 후에도 빈 문자열이 아닌 행만 포함.
function nonEmpty(col: AnyPgColumn) {
  return and(isNotNull(col), ne(sql`btrim(${col})`, ""));
}

async function gather(): Promise<CorpusRow[]> {
  const rows: CorpusRow[] = [];

  // 자식 테이블 3종은 push 형태가 동일 — 쿼리는 콜사이트에서 조립해 넘긴다(견적 코퍼스 확장 시 collect 1줄 추가).
  // if (row.text)는 select 프로젝션이 nullable이라 남긴 타입 좁히기다(WHERE nonEmpty가 이미 걸러줌).
  async function collect(sourceType: CorpusRow["sourceType"], query: PromiseLike<{ id: string; customerId: string; name: string; text: string | null }[]>) {
    for (const row of await query) {
      if (row.text) rows.push({ sourceType, sourceId: row.id, customerId: row.customerId, customerName: row.name, text: row.text });
    }
  }

  await collect("memo", db
    .select({ id: customerMemos.id, customerId: customerMemos.customerId, name: customers.name, text: customerMemos.body })
    .from(customerMemos).innerJoin(customers, eq(customers.id, customerMemos.customerId))
    .where(nonEmpty(customerMemos.body)));
  await collect("task", db
    .select({ id: customerTasks.id, customerId: customerTasks.customerId, name: customers.name, text: customerTasks.body })
    .from(customerTasks).innerJoin(customers, eq(customers.id, customerTasks.customerId))
    .where(nonEmpty(customerTasks.body)));
  await collect("consultation", db
    .select({ id: consultations.id, customerId: consultations.customerId, name: customers.name, text: consultations.summary })
    .from(consultations).innerJoin(customers, eq(customers.id, consultations.customerId))
    .where(nonEmpty(consultations.summary)));

  // 니즈 3필드(customers 인라인): source_id = customer_id, source_type로 구분.
  const needs = await db
    .select({ id: customers.id, name: customers.name, needMemo: customers.needMemo, needCustomerNote: customers.needCustomerNote, needReviewNote: customers.needReviewNote })
    .from(customers);
  for (const n of needs) {
    if (n.needMemo?.trim()) rows.push({ sourceType: "need_memo", sourceId: n.id, customerId: n.id, customerName: n.name, text: n.needMemo });
    if (n.needCustomerNote?.trim()) rows.push({ sourceType: "need_customer_note", sourceId: n.id, customerId: n.id, customerName: n.name, text: n.needCustomerNote });
    if (n.needReviewNote?.trim()) rows.push({ sourceType: "need_review_note", sourceId: n.id, customerId: n.id, customerName: n.name, text: n.needReviewNote });
  }
  return rows;
}

async function main() {
  const rows = await gather();
  console.log(`코퍼스 ${rows.length}청크 수집`);
  const contents = rows.map(buildChunkContent);
  const vectors = await embedTexts(contents, geminiTarget, "RETRIEVAL_DOCUMENT");
  // 임베딩 개수가 청크 수와 다르면 인덱스 매핑이 어긋나므로 중단(부분 응답 방어).
  if (vectors.length !== rows.length) throw new Error(`임베딩 개수(${vectors.length}) != 코퍼스 청크 수(${rows.length}) — 매핑 불일치`);
  let ok = 0;
  for (let i = 0; i < rows.length; i++) {
    try {
      await upsertEmbedding({
        sourceType: rows[i].sourceType, sourceId: rows[i].sourceId, customerId: rows[i].customerId,
        content: contents[i], contentHash: contentHash(contents[i]), embedding: vectors[i],
      }, db);
      ok++;
    } catch (e) { console.error(`upsert 실패 ${rows[i].sourceType}/${rows[i].sourceId}:`, e); }
  }
  console.log(`백필 완료: ${ok}/${rows.length} upsert`);
  process.exit(0);
}

void main();
