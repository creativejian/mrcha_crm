import { asc, eq } from "drizzle-orm";

import { buildCustomerDocumentsChunkText, buildCustomerProfileChunkText, buildQuoteChunkText, buildQuoteRequestChunkText, buildScheduleChunkText } from "../../lib/assistant-corpus";
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
      // 고객당 1행(source_id = customer_id): 프로필 + 구조화 니즈 — 필드 구성/생략 규칙은 빌더(SSOT).
      const [r] = await ex
        .select({
          name: customers.name,
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
        })
        .from(customers)
        .where(eq(customers.id, sourceId));
      if (!r) return null;
      return { customerId: sourceId, customerName: r.name, text: buildCustomerProfileChunkText(r) };
    }
    case "quote_request": {
      // 요청당 1행(public.quote_requests). 고객 연결 = customers.app_user_id 직접 연결만 —
      // 미연결 요청은 null(임베딩 없음, link/create-customer 승격 훅이 연결 시점에 적재).
      const [req] = await ex
        .select({
          userId: quoteRequests.userId,
          createdAt: quoteRequests.createdAt,
          trimId: quoteRequests.trimId,
          paymentMethod: quoteRequests.paymentMethod,
          period: quoteRequests.period,
          depositType: quoteRequests.depositType,
          depositRatio: quoteRequests.depositRatio,
          rentalDeposit: quoteRequests.rentalDeposit,
          trimPrice: quoteRequests.trimPrice,
        })
        .from(quoteRequests)
        .where(eq(quoteRequests.id, sourceId));
      if (!req) return null;
      const [cust] = await ex
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(eq(customers.appUserId, req.userId));
      if (!cust) return null;
      const [trim, opts] = await Promise.all([
        req.trimId != null
          ? ex
              .select({ trimName: trimsInCatalog.trimName, modelName: modelsInCatalog.name, brandName: brandsInCatalog.name })
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
      const text = buildQuoteRequestChunkText({
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
        optionNames: opts.map((o) => o.optionName),
      });
      return { customerId: cust.id, customerName: cust.name, text };
    }
    case "customer_documents": {
      // 고객당 1행(source_id = customer_id): 서류 메타 목록. 구성 규칙은 빌더(SSOT), 순서는 업로드일
      // (created_at, id) 고정 — sortOrder는 reorder마다 재임베딩이 나므로 안 쓴다(빌더 주석 참조).
      const [cust] = await ex.select({ name: customers.name }).from(customers).where(eq(customers.id, sourceId));
      if (!cust) return null;
      const docs = await ex
        .select({ docType: customerDocuments.docType, fileName: customerDocuments.fileName, createdAt: customerDocuments.createdAt })
        .from(customerDocuments)
        .where(eq(customerDocuments.customerId, sourceId))
        .orderBy(asc(customerDocuments.createdAt), asc(customerDocuments.id));
      return { customerId: sourceId, customerName: cust.name, text: buildCustomerDocumentsChunkText(docs) };
    }
    case "schedule": {
      // 일정당 1행. 텍스트 구성/생략 규칙은 빌더(SSOT) — 실질 필드 전무면 빈 텍스트 → 호출부가 행 삭제.
      const [r] = await ex
        .select({
          customerId: customerSchedules.customerId,
          name: customers.name,
          scheduledDate: customerSchedules.scheduledDate,
          scheduledTime: customerSchedules.scheduledTime,
          type: customerSchedules.type,
          memo: customerSchedules.memo,
          done: customerSchedules.done,
        })
        .from(customerSchedules)
        .innerJoin(customers, eq(customers.id, customerSchedules.customerId))
        .where(eq(customerSchedules.id, sourceId));
      return r ? { customerId: r.customerId, customerName: r.name, text: buildScheduleChunkText(r) } : null;
    }
    case "quote": {
      const [q] = await ex
        .select({
          customerId: quotes.customerId,
          name: customers.name,
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
        })
        .from(quotes)
        .innerJoin(customers, eq(customers.id, quotes.customerId))
        .where(eq(quotes.id, sourceId));
      if (!q) return null;
      // 대표 시나리오 선택 규칙은 pickPrimaryScenario(SSOT) — 발송 조립기·백필과 동일.
      const scs = await ex
        .select({
          id: quoteScenarios.id,
          purchaseMethod: quoteScenarios.purchaseMethod,
          termMonths: quoteScenarios.termMonths,
          monthlyPayment: quoteScenarios.monthlyPayment,
          lender: quoteScenarios.lender,
        })
        .from(quoteScenarios)
        .where(eq(quoteScenarios.quoteId, sourceId))
        .orderBy(asc(quoteScenarios.scenarioNo));
      const sc = pickPrimaryScenario(scs, q.primaryScenarioId);
      return { customerId: q.customerId, customerName: q.name, text: buildQuoteChunkText(q, sc, scs.filter((s) => s !== sc)) };
    }
  }
}
