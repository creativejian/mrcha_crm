import { asc, eq } from "drizzle-orm";

import { buildCustomerProfileChunkText, buildQuoteChunkText, buildScheduleChunkText } from "../../lib/assistant-corpus";
import { pickPrimaryScenario } from "../../lib/primary-scenario";
import { getDefaultDb, type Executor } from "../client";
import { customerMemos, customers, customerSchedules, customerTasks, quotes, quoteScenarios } from "../schema";

// 증분 임베딩 훅의 fresh read — 커밋된 최신 원본+고객명 스냅샷.
// 원본 행 없음 → null(호출부가 임베딩 행 삭제). text 비움 판정(trim)은 호출부(runEmbedJob) 책임.
export type CorpusSourceSnapshot = { customerId: string; customerName: string; text: string };

// on-write 대상 소스타입. consultation은 CRM 쓰기 경로가 없어 제외(스펙 결정 3 —
// 채팅 AI 요약 자동 수신 경로가 생기면 그쪽에서 훅 추가).
export type WritableCorpusSourceType = "memo" | "task" | "need_memo" | "need_customer_note" | "need_review_note" | "quote" | "customer_profile" | "schedule";

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
      return { customerId: q.customerId, customerName: q.name, text: buildQuoteChunkText(q, sc) };
    }
  }
}
