// 코퍼스(상담메모·상담이력·니즈메모·할일·견적·프로필·일정)를 임베딩해 crm.embeddings에 upsert하는 보정 스크립트.
// 증분 임베딩 훅(embed-on-write) 도입 후에는 백필이 아니라 복구/정리 도구다 — hash skip으로 재실행 저비용.
// 실행: bun run src/scripts/backfill-embeddings.ts  (.env.local의 GEMINI_API_KEY·DATABASE_URL 사용)
import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { getDefaultDb } from "../db/client";
import { customers, customerDocuments, customerMemos, customerSchedules, customerTasks, consultations, embeddings, quotes, quoteScenarios } from "../db/schema";
import { upsertEmbedding } from "../db/queries/embeddings";
import { buildChunkContent, buildCustomerDocumentsChunkText, buildCustomerProfileChunkText, buildQuoteChunkText, buildScheduleChunkText, contentHash, type CorpusRow, type DocumentChunkDocument } from "../lib/assistant-corpus";
import { embedTexts } from "../lib/gemini-embed";
import { resolveGeminiTarget } from "../lib/gemini-target";
import { pickPrimaryScenario } from "../lib/primary-scenario";

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

  // 자식 테이블 3종은 push 형태가 동일 — 쿼리는 콜사이트에서 조립해 넘긴다(견적은 시나리오 조인이 필요해 아래 별도 블록).
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

  // 프로필 청크(customers 인라인, 고객당 1행): source_id = customer_id. 필드 구성/생략 규칙은 빌더(SSOT).
  const profiles = await db
    .select({
      id: customers.id, name: customers.name,
      residence: customers.residence, customerType: customers.customerType, customerTypeDetail: customers.customerTypeDetail,
      source: customers.source, advisorName: customers.advisorName,
      needModel: customers.needModel, needTrim: customers.needTrim, needMethod: customers.needMethod,
      needTiming: customers.needTiming, needColors: customers.needColors, needCompare: customers.needCompare,
      needContractTerm: customers.needContractTerm, needInitialCost: customers.needInitialCost,
      needAnnualMileage: customers.needAnnualMileage, needDeliveryMethod: customers.needDeliveryMethod,
      needContractFocus: customers.needContractFocus,
    })
    .from(customers);
  for (const pr of profiles) {
    const text = buildCustomerProfileChunkText(pr);
    if (text) rows.push({ sourceType: "customer_profile", sourceId: pr.id, customerId: pr.id, customerName: pr.name, text });
  }

  // 일정: 일정당 1청크 — 텍스트 구성/생략 규칙은 빌더(SSOT). 실질 필드 전무(빈 텍스트)는 미수집.
  const scheduleRows = await db
    .select({
      id: customerSchedules.id, customerId: customerSchedules.customerId, name: customers.name,
      scheduledDate: customerSchedules.scheduledDate, scheduledTime: customerSchedules.scheduledTime,
      type: customerSchedules.type, memo: customerSchedules.memo, done: customerSchedules.done,
    })
    .from(customerSchedules).innerJoin(customers, eq(customers.id, customerSchedules.customerId));
  for (const s of scheduleRows) {
    const text = buildScheduleChunkText(s);
    if (text) rows.push({ sourceType: "schedule", sourceId: s.id, customerId: s.customerId, customerName: s.name, text });
  }

  // 서류함: 고객당 1청크(서류 메타 목록) — 순서는 업로드일(created_at, id) 고정(빌더 주석 참조).
  const docRows = await db
    .select({
      customerId: customerDocuments.customerId, name: customers.name,
      docType: customerDocuments.docType, fileName: customerDocuments.fileName, createdAt: customerDocuments.createdAt,
    })
    .from(customerDocuments).innerJoin(customers, eq(customers.id, customerDocuments.customerId))
    .orderBy(asc(customerDocuments.createdAt), asc(customerDocuments.id));
  const docsByCustomer = new Map<string, { name: string; docs: DocumentChunkDocument[] }>();
  for (const d of docRows) {
    const entry = docsByCustomer.get(d.customerId) ?? { name: d.name, docs: [] };
    entry.docs.push(d);
    docsByCustomer.set(d.customerId, entry);
  }
  for (const [customerId, { name, docs }] of docsByCustomer) {
    rows.push({ sourceType: "customer_documents", sourceId: customerId, customerId, customerName: name, text: buildCustomerDocumentsChunkText(docs) });
  }

  // 견적: 견적당 1청크 — 대표 시나리오(pickPrimaryScenario SSOT) 기준(스펙 결정 2).
  const quoteRows = await db
    .select({
      id: quotes.id, customerId: quotes.customerId, name: customers.name, quoteCode: quotes.quoteCode,
      brandName: quotes.brandName, modelName: quotes.modelName, trimName: quotes.trimName,
      appStatus: quotes.appStatus, sentAt: quotes.sentAt, guidance: quotes.guidance,
      discountLines: quotes.discountLines, finalDiscount: quotes.finalDiscount,
      primaryScenarioId: quotes.primaryScenarioId,
    })
    .from(quotes).innerJoin(customers, eq(customers.id, quotes.customerId));
  const scRows = await db
    .select({
      id: quoteScenarios.id, quoteId: quoteScenarios.quoteId, scenarioNo: quoteScenarios.scenarioNo,
      purchaseMethod: quoteScenarios.purchaseMethod, termMonths: quoteScenarios.termMonths,
      monthlyPayment: quoteScenarios.monthlyPayment, lender: quoteScenarios.lender,
    })
    .from(quoteScenarios).orderBy(asc(quoteScenarios.scenarioNo));
  const scByQuote = new Map<string, typeof scRows>();
  for (const s of scRows) {
    const list = scByQuote.get(s.quoteId) ?? [];
    list.push(s);
    scByQuote.set(s.quoteId, list);
  }
  for (const q of quoteRows) {
    const scs = scByQuote.get(q.id) ?? [];
    const sc = pickPrimaryScenario(scs, q.primaryScenarioId);
    rows.push({ sourceType: "quote", sourceId: q.id, customerId: q.customerId, customerName: q.name, text: buildQuoteChunkText(q, sc, scs.filter((s) => s !== sc)) });
  }

  return rows;
}

// 고아 정리(스펙 결정 6): 원본이 삭제됐거나 텍스트가 비워진 임베딩 행 제거 — 삭제 훅 도입 전 축적분 청소.
// need_*는 고객 행이 남는 한 cascade가 못 지우므로 "필드 비워짐"도 고아로 본다. 고객 삭제는 FK cascade가 처리.
async function cleanupOrphans() {
  const deleted = await db.execute(sql`
    delete from crm.embeddings e where
      (e.source_type = 'memo' and not exists (
        select 1 from crm.customer_memos m where m.id = e.source_id and btrim(coalesce(m.body, '')) <> ''))
      or (e.source_type = 'task' and not exists (
        select 1 from crm.customer_tasks t where t.id = e.source_id and btrim(coalesce(t.body, '')) <> ''))
      or (e.source_type = 'consultation' and not exists (
        select 1 from crm.consultations cs where cs.id = e.source_id and btrim(coalesce(cs.summary, '')) <> ''))
      or (e.source_type = 'quote' and not exists (
        select 1 from crm.quotes q where q.id = e.source_id))
      or (e.source_type = 'need_memo' and not exists (
        select 1 from crm.customers c where c.id = e.source_id and btrim(coalesce(c.need_memo, '')) <> ''))
      or (e.source_type = 'need_customer_note' and not exists (
        select 1 from crm.customers c where c.id = e.source_id and btrim(coalesce(c.need_customer_note, '')) <> ''))
      or (e.source_type = 'need_review_note' and not exists (
        select 1 from crm.customers c where c.id = e.source_id and btrim(coalesce(c.need_review_note, '')) <> ''))
      or (e.source_type = 'customer_profile' and not exists (
        select 1 from crm.customers c where c.id = e.source_id))
      -- 일정: 행 삭제 또는 실질 필드(날짜·시간·타입·메모) 전무 — buildScheduleChunkText 빈 텍스트 판정의 SQL 미러.
      or (e.source_type = 'schedule' and not exists (
        select 1 from crm.customer_schedules s where s.id = e.source_id
          and (s.scheduled_date is not null
            or btrim(coalesce(s.scheduled_time, '')) <> ''
            or btrim(coalesce(s.type, '')) <> ''
            or btrim(coalesce(s.memo, '')) <> '')))
      -- 서류함(aggregate, source_id=customer_id): 해당 고객 서류가 0건이면 고아(고객 삭제는 FK cascade가 처리).
      or (e.source_type = 'customer_documents' and not exists (
        select 1 from crm.customer_documents d where d.customer_id = e.source_id))
    returning e.id
  `);
  console.log(`고아 정리: ${[...(deleted as Iterable<unknown>)].length}행 삭제`);
}

async function main() {
  // 고아 정리를 선두에서 — 임베딩 단계의 throw(매핑 불일치 등)가 정리를 건너뛰지 않게 하고,
  // 고아 제거 후 hash 스캔 대상도 줄어든다(임베딩과 완전 독립이라 순서 의존 없음).
  await cleanupOrphans();

  const rows = await gather();
  const contents = rows.map(buildChunkContent);
  const hashes = contents.map(contentHash);

  // hash skip(스펙 결정 4): 기존 행과 content가 같으면 재임베딩하지 않는다 — 재실행 비용 절감.
  const existing = await db
    .select({ sourceType: embeddings.sourceType, sourceId: embeddings.sourceId, contentHash: embeddings.contentHash })
    .from(embeddings);
  const hashByKey = new Map(existing.map((r) => [`${r.sourceType}/${r.sourceId}`, r.contentHash]));
  const pendingIdx = rows.map((_, i) => i).filter((i) => hashByKey.get(`${rows[i].sourceType}/${rows[i].sourceId}`) !== hashes[i]);
  console.log(`코퍼스 ${rows.length}청크 수집 — ${pendingIdx.length} 임베딩 대상, ${rows.length - pendingIdx.length} skip(hash 동일)`);

  const vectors = await embedTexts(pendingIdx.map((i) => contents[i]), geminiTarget, "RETRIEVAL_DOCUMENT");
  // 임베딩 개수가 대상 수와 다르면 인덱스 매핑이 어긋나므로 중단(부분 응답 방어).
  if (vectors.length !== pendingIdx.length) throw new Error(`임베딩 개수(${vectors.length}) != 대상 청크 수(${pendingIdx.length}) — 매핑 불일치`);
  let ok = 0;
  for (let k = 0; k < pendingIdx.length; k++) {
    const i = pendingIdx[k];
    try {
      await upsertEmbedding({
        sourceType: rows[i].sourceType, sourceId: rows[i].sourceId, customerId: rows[i].customerId,
        content: contents[i], contentHash: hashes[i], embedding: vectors[k],
      }, db);
      ok++;
    } catch (e) { console.error(`upsert 실패 ${rows[i].sourceType}/${rows[i].sourceId}:`, e); }
  }
  console.log(`백필 완료: ${ok}/${pendingIdx.length} upsert`);
  process.exit(0);
}

void main();
