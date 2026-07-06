import { asc, eq, sql, type SQL } from "drizzle-orm";

import { buildCustomerDocumentsChunkText, buildCustomerProfileChunkText, buildQuoteChunkText, buildQuoteRequestChunkText, buildScheduleChunkText, type CorpusSourceType, type QuoteChunkQuote, type QuoteChunkScenario } from "../../lib/assistant-corpus";
import { pickPrimaryScenario } from "../../lib/primary-scenario";
import { brandsInCatalog, modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { quoteRequestOptions, quoteRequests } from "../public-app";
import { customerDocuments, customerMemos, customers, customerSchedules, customerTasks, quotes, quoteScenarios } from "../schema";

// 증분 임베딩 훅의 fresh read — 커밋된 최신 원본+고객명 스냅샷.
// 원본 행 없음 → null(호출부가 임베딩 행 삭제). text 비움 판정(trim)은 호출부(runEmbedJob) 책임.
export type CorpusSourceSnapshot = { customerId: string; customerName: string; text: string };

// on-write 대상 소스타입. consultation은 CRM 쓰기 경로가 없어 제외(스펙 결정 3 —
// 채팅 AI 요약 자동 수신 경로가 생기면 그쪽에서 훅 추가).
export type WritableCorpusSourceType = "memo" | "task" | "need_memo" | "need_customer_note" | "need_review_note" | "quote" | "customer_profile" | "schedule" | "customer_documents" | "quote_request";

// ── 로더 ↔ 백필 공유 계층(0706 배치 D) ─────────────────────────────────────────
// 아래 프로젝션 상수·텍스트 조립 헬퍼는 loadCorpusSource(단건 fresh read)와 backfill-embeddings의
// gather(전건 collect)가 공유한다 — 문자 그대로 미러였던 select 목록·조립식이 한쪽만 바뀌어 on-write와
// 백필의 content가 갈라지는(백필 재실행마다 전건 재임베딩 churn) 드리프트 축 제거. 배치 collect의
// 조인/그룹핑/dedupe 구조는 단건 load와 형태가 달라(N+1 회피) 백필에 그대로 남긴다.

// 프로필 청크 구성 컬럼(고객당 1행) — 필드 구성/생략 규칙은 빌더(SSOT).
export const PROFILE_CHUNK_COLUMNS = {
  residence: customers.residence,
  customerType: customers.customerType,
  customerTypeDetail: customers.customerTypeDetail,
  source: customers.source,
  advisorName: customers.advisorName,
  needModel: customers.needModel,
  needTrim: customers.needTrim,
  needMethod: customers.needMethod,
  needTiming: customers.needTiming,
  needColors: customers.needColors,
  needCompare: customers.needCompare,
  needContractTerm: customers.needContractTerm,
  needInitialCost: customers.needInitialCost,
  needAnnualMileage: customers.needAnnualMileage,
  needDeliveryMethod: customers.needDeliveryMethod,
  needContractFocus: customers.needContractFocus,
} as const;

// 일정 청크 구성 컬럼(일정당 1행).
export const SCHEDULE_CHUNK_COLUMNS = {
  scheduledDate: customerSchedules.scheduledDate,
  scheduledTime: customerSchedules.scheduledTime,
  type: customerSchedules.type,
  memo: customerSchedules.memo,
  done: customerSchedules.done,
} as const;

// 서류함 aggregate 청크 구성 컬럼(고객당 1행 — 목록 순서는 업로드일(created_at, id) 고정, 빌더 주석 참조).
export const DOCUMENT_CHUNK_COLUMNS = {
  docType: customerDocuments.docType,
  fileName: customerDocuments.fileName,
  createdAt: customerDocuments.createdAt,
} as const;

// 견적 청크 구성 컬럼(견적당 1행) + 시나리오 컬럼(대표+비교안).
export const QUOTE_CHUNK_COLUMNS = {
  quoteCode: quotes.quoteCode,
  brandName: quotes.brandName,
  modelName: quotes.modelName,
  trimName: quotes.trimName,
  appStatus: quotes.appStatus,
  sentAt: quotes.sentAt,
  guidance: quotes.guidance,
  discountLines: quotes.discountLines,
  finalDiscount: quotes.finalDiscount,
  primaryScenarioId: quotes.primaryScenarioId,
} as const;
export const QUOTE_SCENARIO_CHUNK_COLUMNS = {
  id: quoteScenarios.id,
  purchaseMethod: quoteScenarios.purchaseMethod,
  termMonths: quoteScenarios.termMonths,
  monthlyPayment: quoteScenarios.monthlyPayment,
  lender: quoteScenarios.lender,
} as const;

// 앱 견적요청 청크 구성 컬럼(요청당 1행) + 트림 라벨 조인 컬럼.
export const QUOTE_REQUEST_CHUNK_COLUMNS = {
  createdAt: quoteRequests.createdAt,
  trimId: quoteRequests.trimId,
  paymentMethod: quoteRequests.paymentMethod,
  period: quoteRequests.period,
  depositType: quoteRequests.depositType,
  depositRatio: quoteRequests.depositRatio,
  rentalDeposit: quoteRequests.rentalDeposit,
  trimPrice: quoteRequests.trimPrice,
} as const;
export const CATALOG_TRIM_LABEL_COLUMNS = {
  trimName: trimsInCatalog.trimName,
  modelName: modelsInCatalog.name,
  brandName: brandsInCatalog.name,
} as const;

// 견적 텍스트 조립 — 대표 선택(pickPrimaryScenario SSOT)+비교안 분리를 1벌로(발송 조립기·로더·백필의
// 4번째 유사 패턴 방지). scs는 scenario_no asc 정렬 전제(pickPrimaryScenario 주석).
export function quoteChunkTextOf(
  q: QuoteChunkQuote & { primaryScenarioId: string | null },
  scs: (QuoteChunkScenario & { id: string })[],
): string {
  const sc = pickPrimaryScenario(scs, q.primaryScenarioId);
  return buildQuoteChunkText(q, sc, scs.filter((s) => s !== sc));
}

// 앱 견적요청 텍스트 조립 — 요청 행+트림 라벨+옵션명을 빌더 입력으로(로더·백필 공유).
export function quoteRequestChunkTextOf(
  req: { createdAt: string; paymentMethod: string | null; period: number | null; depositType: string | null; depositRatio: number | null; rentalDeposit: number | null; trimPrice: number | null },
  trim: { trimName: string | null; modelName: string | null; brandName: string | null } | null,
  optionNames: string[],
): string {
  return buildQuoteRequestChunkText({
    createdAt: req.createdAt,
    brandName: trim?.brandName ?? null,
    modelName: trim?.modelName ?? null,
    trimName: trim?.trimName ?? null,
    paymentMethod: req.paymentMethod,
    period: req.period,
    depositType: req.depositType,
    depositRatio: req.depositRatio,
    rentalDeposit: req.rentalDeposit,
    trimPrice: req.trimPrice,
    optionNames,
  });
}

// 고아 판정 SQL 조각(소스타입별) — "이 임베딩 행(e)의 원본이 더는 코퍼스 대상이 아니다"의 술어.
// 빌더의 빈 텍스트 판정과 미러인 지점(need_* 필드 비움·schedule 실질 필드 전무)은 텍스트 규칙이 바뀌면
// 여기도 함께 바뀌어야 하는 유일한 무보호 드리프트 축이라, 로더/빌더 참조 곁(이 파일)에 병치한다.
// 소비는 백필 cleanupOrphans가 or-join으로 조립. need_*는 고객 행이 남는 한 cascade가 못 지우므로
// "필드 비워짐"도 고아로 본다. 고객 삭제는 FK cascade가 처리.
export const ORPHAN_PREDICATES: Record<CorpusSourceType, SQL> = {
  memo: sql`(e.source_type = 'memo' and not exists (
    select 1 from crm.customer_memos m where m.id = e.source_id and btrim(coalesce(m.body, '')) <> ''))`,
  task: sql`(e.source_type = 'task' and not exists (
    select 1 from crm.customer_tasks t where t.id = e.source_id and btrim(coalesce(t.body, '')) <> ''))`,
  consultation: sql`(e.source_type = 'consultation' and not exists (
    select 1 from crm.consultations cs where cs.id = e.source_id and btrim(coalesce(cs.summary, '')) <> ''))`,
  quote: sql`(e.source_type = 'quote' and not exists (
    select 1 from crm.quotes q where q.id = e.source_id))`,
  need_memo: sql`(e.source_type = 'need_memo' and not exists (
    select 1 from crm.customers c where c.id = e.source_id and btrim(coalesce(c.need_memo, '')) <> ''))`,
  need_customer_note: sql`(e.source_type = 'need_customer_note' and not exists (
    select 1 from crm.customers c where c.id = e.source_id and btrim(coalesce(c.need_customer_note, '')) <> ''))`,
  need_review_note: sql`(e.source_type = 'need_review_note' and not exists (
    select 1 from crm.customers c where c.id = e.source_id and btrim(coalesce(c.need_review_note, '')) <> ''))`,
  customer_profile: sql`(e.source_type = 'customer_profile' and not exists (
    select 1 from crm.customers c where c.id = e.source_id))`,
  // 일정: 행 삭제 또는 실질 필드(날짜·시간·타입·메모) 전무 — buildScheduleChunkText 빈 텍스트 판정의 SQL 미러.
  schedule: sql`(e.source_type = 'schedule' and not exists (
    select 1 from crm.customer_schedules s where s.id = e.source_id
      and (s.scheduled_date is not null
        or btrim(coalesce(s.scheduled_time, '')) <> ''
        or btrim(coalesce(s.type, '')) <> ''
        or btrim(coalesce(s.memo, '')) <> '')))`,
  // 서류함(aggregate, source_id=customer_id): 해당 고객 서류가 0건이면 고아(고객 삭제는 FK cascade가 처리).
  customer_documents: sql`(e.source_type = 'customer_documents' and not exists (
    select 1 from crm.customer_documents d where d.customer_id = e.source_id))`,
  // 앱 견적요청: 요청 삭제 또는 고객 연결(app_user_id) 해제 — 연결 있는 요청만 코퍼스 대상.
  quote_request: sql`(e.source_type = 'quote_request' and not exists (
    select 1 from public.quote_requests qr
      join crm.customers c on c.app_user_id = qr.user_id
      where qr.id = e.source_id))`,
};

export async function loadCorpusSource(
  sourceType: WritableCorpusSourceType,
  sourceId: string,
  ex: Executor = getDefaultDb(),
): Promise<CorpusSourceSnapshot | null> {
  switch (sourceType) {
    case "memo": {
      const [r] = await ex
        .select({ customerId: customerMemos.customerId, name: customers.name, text: customerMemos.body })
        .from(customerMemos)
        .innerJoin(customers, eq(customers.id, customerMemos.customerId))
        .where(eq(customerMemos.id, sourceId));
      return r ? { customerId: r.customerId, customerName: r.name, text: r.text ?? "" } : null;
    }
    case "task": {
      const [r] = await ex
        .select({ customerId: customerTasks.customerId, name: customers.name, text: customerTasks.body })
        .from(customerTasks)
        .innerJoin(customers, eq(customers.id, customerTasks.customerId))
        .where(eq(customerTasks.id, sourceId));
      return r ? { customerId: r.customerId, customerName: r.name, text: r.text ?? "" } : null;
    }
    case "need_memo":
    case "need_customer_note":
    case "need_review_note": {
      const [r] = await ex
        .select({
          name: customers.name,
          needMemo: customers.needMemo,
          needCustomerNote: customers.needCustomerNote,
          needReviewNote: customers.needReviewNote,
        })
        .from(customers)
        .where(eq(customers.id, sourceId));
      if (!r) return null;
      const text = sourceType === "need_memo" ? r.needMemo : sourceType === "need_customer_note" ? r.needCustomerNote : r.needReviewNote;
      return { customerId: sourceId, customerName: r.name, text: text ?? "" };
    }
    case "customer_profile": {
      // 고객당 1행(source_id = customer_id): 프로필 + 구조화 니즈 — 필드 구성/생략 규칙은 빌더(SSOT),
      // 컬럼 목록은 백필과 공유(PROFILE_CHUNK_COLUMNS).
      const [r] = await ex
        .select({ name: customers.name, ...PROFILE_CHUNK_COLUMNS })
        .from(customers)
        .where(eq(customers.id, sourceId));
      if (!r) return null;
      return { customerId: sourceId, customerName: r.name, text: buildCustomerProfileChunkText(r) };
    }
    case "quote_request": {
      // 요청당 1행(public.quote_requests). 고객 연결 = customers.app_user_id 직접 연결만 —
      // 미연결 요청은 null(임베딩 없음, link/create-customer 승격 훅이 연결 시점에 적재).
      const [req] = await ex
        .select({ userId: quoteRequests.userId, ...QUOTE_REQUEST_CHUNK_COLUMNS })
        .from(quoteRequests)
        .where(eq(quoteRequests.id, sourceId));
      if (!req) return null;
      const [cust] = await ex
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(eq(customers.appUserId, req.userId))
        // app_user_id 중복 고객(link 가드 도입 전 잔재) 대비 결정적 선택 — 최고령 고객(created_at, id).
        // 백필 collect의 dedupe와 동일 규칙이라 on-write↔백필 hash 플립플롭이 없다.
        .orderBy(asc(customers.createdAt), asc(customers.id))
        .limit(1);
      if (!cust) return null;
      const [trim, opts] = await Promise.all([
        req.trimId != null
          ? ex
              .select(CATALOG_TRIM_LABEL_COLUMNS)
              .from(trimsInCatalog)
              .leftJoin(modelsInCatalog, eq(trimsInCatalog.modelId, modelsInCatalog.id))
              .leftJoin(brandsInCatalog, eq(modelsInCatalog.brandId, brandsInCatalog.id))
              .where(eq(trimsInCatalog.id, req.trimId))
              .then((rows) => rows[0] ?? null)
          : Promise.resolve(null),
        ex
          .select({ optionName: quoteRequestOptions.optionName })
          .from(quoteRequestOptions)
          .where(eq(quoteRequestOptions.quoteRequestId, sourceId))
          .orderBy(asc(quoteRequestOptions.id)),
      ]);
      const text = quoteRequestChunkTextOf(req, trim, opts.map((o) => o.optionName));
      return { customerId: cust.id, customerName: cust.name, text };
    }
    case "customer_documents": {
      // 고객당 1행(source_id = customer_id): 서류 메타 목록. 구성 규칙은 빌더(SSOT), 순서는 업로드일
      // (created_at, id) 고정 — sortOrder는 reorder마다 재임베딩이 나므로 안 쓴다(빌더 주석 참조).
      const [cust] = await ex.select({ name: customers.name }).from(customers).where(eq(customers.id, sourceId));
      if (!cust) return null;
      const docs = await ex
        .select(DOCUMENT_CHUNK_COLUMNS)
        .from(customerDocuments)
        .where(eq(customerDocuments.customerId, sourceId))
        .orderBy(asc(customerDocuments.createdAt), asc(customerDocuments.id));
      return { customerId: sourceId, customerName: cust.name, text: buildCustomerDocumentsChunkText(docs) };
    }
    case "schedule": {
      // 일정당 1행. 텍스트 구성/생략 규칙은 빌더(SSOT) — 실질 필드 전무면 빈 텍스트 → 호출부가 행 삭제.
      const [r] = await ex
        .select({ customerId: customerSchedules.customerId, name: customers.name, ...SCHEDULE_CHUNK_COLUMNS })
        .from(customerSchedules)
        .innerJoin(customers, eq(customers.id, customerSchedules.customerId))
        .where(eq(customerSchedules.id, sourceId));
      return r ? { customerId: r.customerId, customerName: r.name, text: buildScheduleChunkText(r) } : null;
    }
    case "quote": {
      const [q] = await ex
        .select({ customerId: quotes.customerId, name: customers.name, ...QUOTE_CHUNK_COLUMNS })
        .from(quotes)
        .innerJoin(customers, eq(customers.id, quotes.customerId))
        .where(eq(quotes.id, sourceId));
      if (!q) return null;
      // 대표 시나리오 선택·비교안 분리는 quoteChunkTextOf(내부 pickPrimaryScenario SSOT) — 백필과 동일.
      const scs = await ex
        .select(QUOTE_SCENARIO_CHUNK_COLUMNS)
        .from(quoteScenarios)
        .where(eq(quoteScenarios.quoteId, sourceId))
        .orderBy(asc(quoteScenarios.scenarioNo));
      return { customerId: q.customerId, customerName: q.name, text: quoteChunkTextOf(q, scs) };
    }
  }
}
