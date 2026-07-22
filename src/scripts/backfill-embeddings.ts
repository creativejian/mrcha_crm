// 코퍼스(상담메모·상담이력·니즈메모·할일·견적·프로필·일정·서류함·앱 견적요청)를 임베딩해 crm.embeddings에 upsert하는 보정 스크립트.
// 증분 임베딩 훅(embed-on-write) 도입 후에는 백필이 아니라 복구/정리 도구다 — hash skip으로 재실행 저비용.
// 실행: bun run src/scripts/backfill-embeddings.ts  (.env.local의 GEMINI_API_KEY·DATABASE_URL 사용)
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { getDefaultDb } from "../db/client";
import { customers, customerDocuments, customerMemos, customerSchedules, customerTasks, consultations, embeddings, quotes, quoteScenarios } from "../db/schema";
import { brandsInCatalog, modelsInCatalog, trimsInCatalog } from "../db/catalog";
import { quoteRequestOptions, quoteRequests } from "../db/public-app";
import { upsertEmbedding } from "../db/queries/embeddings";
import {
  CATALOG_TRIM_LABEL_COLUMNS, DOCUMENT_CHUNK_COLUMNS, ORPHAN_PREDICATES, PROFILE_CHUNK_COLUMNS,
  QUOTE_CHUNK_COLUMNS, QUOTE_REQUEST_CHUNK_COLUMNS, QUOTE_SCENARIO_CHUNK_COLUMNS, SCHEDULE_CHUNK_COLUMNS,
  quoteChunkTextOf, quoteRequestChunkTextOf,
} from "../db/queries/embed-sources";
import { buildChunkContent, buildCustomerDocumentsChunkText, buildCustomerProfileChunkText, buildScheduleChunkText, contentHash, type CorpusRow, type DocumentChunkDocument } from "../lib/assistant-corpus";
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

  // 프로필 청크(customers 인라인, 고객당 1행): source_id = customer_id. 필드 구성/생략 규칙은 빌더(SSOT),
  // 컬럼 목록은 로더와 공유(PROFILE_CHUNK_COLUMNS — 배치 D).
  const profiles = await db
    .select({ id: customers.id, name: customers.name, ...PROFILE_CHUNK_COLUMNS })
    .from(customers);
  for (const pr of profiles) {
    const text = buildCustomerProfileChunkText(pr);
    if (text) rows.push({ sourceType: "customer_profile", sourceId: pr.id, customerId: pr.id, customerName: pr.name, text });
  }

  // 일정: 일정당 1청크 — 텍스트 구성/생략 규칙은 빌더(SSOT). 실질 필드 전무(빈 텍스트)는 미수집.
  const scheduleRows = await db
    .select({ id: customerSchedules.id, customerId: customerSchedules.customerId, name: customers.name, ...SCHEDULE_CHUNK_COLUMNS })
    .from(customerSchedules).innerJoin(customers, eq(customers.id, customerSchedules.customerId));
  for (const s of scheduleRows) {
    const text = buildScheduleChunkText(s);
    if (text) rows.push({ sourceType: "schedule", sourceId: s.id, customerId: s.customerId, customerName: s.name, text });
  }

  // 서류함: 고객당 1청크(서류 메타 목록) — 순서는 업로드일(created_at, id) 고정(빌더 주석 참조).
  const docRows = await db
    .select({ customerId: customerDocuments.customerId, name: customers.name, ...DOCUMENT_CHUNK_COLUMNS })
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

  // 견적: 견적당 1청크 — 컬럼 목록·대표/비교안 조립은 로더와 공유(QUOTE_*_COLUMNS·quoteChunkTextOf, 배치 D).
  const quoteRows = await db
    .select({ id: quotes.id, customerId: quotes.customerId, name: customers.name, ...QUOTE_CHUNK_COLUMNS })
    .from(quotes).innerJoin(customers, eq(customers.id, quotes.customerId));
  const scRows = await db
    .select({ quoteId: quoteScenarios.quoteId, ...QUOTE_SCENARIO_CHUNK_COLUMNS })
    .from(quoteScenarios).orderBy(asc(quoteScenarios.scenarioNo));
  const scByQuote = new Map<string, typeof scRows>();
  for (const s of scRows) {
    const list = scByQuote.get(s.quoteId) ?? [];
    list.push(s);
    scByQuote.set(s.quoteId, list);
  }
  for (const q of quoteRows) {
    rows.push({ sourceType: "quote", sourceId: q.id, customerId: q.customerId, customerName: q.name, text: quoteChunkTextOf(q, scByQuote.get(q.id) ?? []) });
  }

  // 앱 견적요청: 요청당 1청크 — 고객 연결(customers.app_user_id) 있는 요청만. 같은 app_user에 고객이
  // 여럿이면(link 가드 도입 전 잔재) 최고령 고객(created_at, id) 기준 첫 행으로 결정 — 로더(embed-sources
  // quote_request 분기)와 동일 규칙이라 on-write↔백필 hash 플립플롭이 없다.
  // 앱이 write하는 신규 요청은 CRM 훅이 없어 이 collect가 유일한 보정 경로(승격 훅은 연결 시점만).
  const reqRows = await db
    .select({ id: quoteRequests.id, customerId: customers.id, name: customers.name, ...QUOTE_REQUEST_CHUNK_COLUMNS })
    .from(quoteRequests).innerJoin(customers, eq(customers.appUserId, quoteRequests.userId))
    .orderBy(asc(customers.createdAt), asc(customers.id));
  const reqById = new Map<string, (typeof reqRows)[number]>();
  for (const r of reqRows) if (!reqById.has(r.id)) reqById.set(r.id, r); // keep-first(최고령 고객)
  const uniqueReqs = [...reqById.values()];
  const reqTrimIds = [...new Set(uniqueReqs.map((r) => r.trimId).filter((v): v is number => v != null))];
  const [reqTrims, reqOpts] = await Promise.all([
    reqTrimIds.length
      ? db.select({ id: trimsInCatalog.id, ...CATALOG_TRIM_LABEL_COLUMNS })
          .from(trimsInCatalog)
          .leftJoin(modelsInCatalog, eq(trimsInCatalog.modelId, modelsInCatalog.id))
          .leftJoin(brandsInCatalog, eq(modelsInCatalog.brandId, brandsInCatalog.id))
          .where(inArray(trimsInCatalog.id, reqTrimIds))
      : Promise.resolve([] as { id: number; trimName: string | null; modelName: string | null; brandName: string | null }[]),
    // 코퍼스 대상(연결 요청)의 옵션만 — 무필터면 미연결 요청(앱 전체 유저) 옵션까지 전건 스캔(오버패치).
    uniqueReqs.length
      ? db.select({ quoteRequestId: quoteRequestOptions.quoteRequestId, optionName: quoteRequestOptions.optionName })
          .from(quoteRequestOptions)
          .where(inArray(quoteRequestOptions.quoteRequestId, uniqueReqs.map((r) => r.id)))
          .orderBy(asc(quoteRequestOptions.id))
      : Promise.resolve([] as { quoteRequestId: string; optionName: string }[]),
  ]);
  const reqTrimMap = new Map(reqTrims.map((t) => [t.id, t]));
  const reqOptMap = new Map<string, string[]>();
  for (const o of reqOpts) {
    const list = reqOptMap.get(o.quoteRequestId) ?? [];
    list.push(o.optionName);
    reqOptMap.set(o.quoteRequestId, list);
  }
  for (const r of uniqueReqs) {
    const t = r.trimId != null ? (reqTrimMap.get(r.trimId) ?? null) : null;
    const text = quoteRequestChunkTextOf(r, t, reqOptMap.get(r.id) ?? []);
    rows.push({ sourceType: "quote_request", sourceId: r.id, customerId: r.customerId, customerName: r.name, text });
  }

  return rows;
}

// 고아 정리(스펙 결정 6): 원본이 삭제됐거나 텍스트가 비워진 임베딩 행 제거 — 삭제 훅 도입 전 축적분 청소.
// 타입별 판정 술어는 ORPHAN_PREDICATES(embed-sources — 로더/빌더 규칙 곁에 병치, 배치 D)가 SSOT.
async function cleanupOrphans() {
  const deleted = await db.execute(sql`
    delete from crm.embeddings e where ${sql.join(Object.values(ORPHAN_PREDICATES), sql` or `)}
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

  const vectors = await embedTexts(pendingIdx.map((i) => contents[i]), geminiTarget);
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
