import { and, asc, eq, sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { quotes, quoteScenarios } from "../schema";

// PATCH 바디(라우트 zod와 동형). 전부 optional — 보낸 것만 갱신.
export type QuoteHeaderPatch = {
  status?: string | null;
  entryMode?: string | null;
  quoteRound?: string | null;
  stockStatus?: string | null;
  brandName?: string | null;
  modelName?: string | null;
  trimName?: string | null;
  appStatus?: string | null;
  decisionStatus?: string | null;
  note?: string | null;
  bumpRevision?: boolean;
};
export type QuoteScenarioPatch = {
  purchaseMethod?: string | null;
  termMonths?: number | null;
  monthlyPayment?: string | null;
  lender?: string | null;
};
export type QuotePatch = QuoteHeaderPatch & { scenario?: QuoteScenarioPatch };

// 헤더 컬럼만 골라 set 객체로(컬럼 아닌 키 bumpRevision/scenario는 제외).
function headerSet(p: QuoteHeaderPatch): Record<string, unknown> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (p.status !== undefined) set.status = p.status;
  if (p.entryMode !== undefined) set.entryMode = p.entryMode;
  if (p.quoteRound !== undefined) set.quoteRound = p.quoteRound;
  if (p.stockStatus !== undefined) set.stockStatus = p.stockStatus;
  if (p.brandName !== undefined) set.brandName = p.brandName;
  if (p.modelName !== undefined) set.modelName = p.modelName;
  if (p.trimName !== undefined) set.trimName = p.trimName;
  if (p.decisionStatus !== undefined) set.decisionStatus = p.decisionStatus;
  if (p.note !== undefined) set.note = p.note;
  if (p.appStatus !== undefined) {
    set.appStatus = p.appStatus;
    if (p.appStatus === "sent") set.sentAt = new Date(); // 발송 시 서버가 시각 확정
  }
  if (p.bumpRevision) set.revision = sql`${quotes.revision} + 1`;
  return set;
}

function scenarioSet(s: QuoteScenarioPatch): Record<string, unknown> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (s.purchaseMethod !== undefined) set.purchaseMethod = s.purchaseMethod;
  if (s.termMonths !== undefined) set.termMonths = s.termMonths;
  if (s.monthlyPayment !== undefined) set.monthlyPayment = s.monthlyPayment;
  if (s.lender !== undefined) set.lender = s.lender;
  return set;
}

// 기존 견적 헤더 + 대표 시나리오 1건 갱신. customer_id 가드 불일치/없는 quoteId면 null(→404).
// 대표 시나리오 = primary_scenario_id 일치 → 없으면 scenario_no 최소.
export async function updateQuote(
  customerId: string,
  quoteId: string,
  patch: QuotePatch,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string } | null> {
  const [row] = await ex
    .update(quotes)
    .set(headerSet(patch))
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)))
    .returning({ id: quotes.id, primaryScenarioId: quotes.primaryScenarioId });
  if (!row) return null;

  if (patch.scenario) {
    const scs = await ex
      .select({ id: quoteScenarios.id })
      .from(quoteScenarios)
      .where(eq(quoteScenarios.quoteId, quoteId))
      .orderBy(asc(quoteScenarios.scenarioNo));
    const target = scs.find((s) => s.id === row.primaryScenarioId) ?? scs[0];
    if (target) {
      await ex.update(quoteScenarios).set(scenarioSet(patch.scenario)).where(eq(quoteScenarios.id, target.id));
    }
  }
  return { id: row.id };
}

// 견적 삭제(시나리오는 ON DELETE CASCADE). customer_id 가드 불일치/없으면 null(→404).
export async function deleteQuote(
  customerId: string,
  quoteId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string } | null> {
  const [row] = await ex
    .delete(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)))
    .returning({ id: quotes.id });
  return row ?? null;
}
