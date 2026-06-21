import { and, asc, eq, like, sql } from "drizzle-orm";

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

// 다음 견적 코드 QT-YYMM-#### (현재월 기준, 기존 최대 시퀀스 +1). UNIQUE 컬럼이라 서버가 canonical 생성.
export async function nextQuoteCode(ex: Executor = getDefaultDb()): Promise<string> {
  const now = new Date();
  const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `QT-${yymm}-`;
  const rows = await ex.select({ code: quotes.quoteCode }).from(quotes).where(like(quotes.quoteCode, `${prefix}%`));
  const max = rows.reduce((m, r) => {
    const match = r.code.match(/-(\d{4})$/);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// 생성 바디(라우트 zod와 동형). 헤더 + 대표 시나리오 1건.
export type QuoteCreateBody = {
  entryMode?: string | null;
  status?: string | null;
  quoteRound?: string | null;
  stockStatus?: string | null;
  brandName?: string | null;
  modelName?: string | null;
  trimName?: string | null;
  note?: string | null;
  scenario?: QuoteScenarioPatch;
};

// 새 견적 INSERT — quote_code 서버 생성 → quote → scenario(scenario_no=1) → primary_scenario_id UPDATE.
// 라우트가 transaction으로 감싸 호출(ex=tx). app_status는 항상 "draft"(발송 전).
export async function createQuote(
  customerId: string,
  body: QuoteCreateBody,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string; quoteCode: string; createdAt: Date }> {
  const quoteCode = await nextQuoteCode(ex);
  const [q] = await ex.insert(quotes).values({
    quoteCode,
    customerId,
    entryMode: body.entryMode ?? null,
    status: body.status ?? null,
    quoteRound: body.quoteRound ?? null,
    stockStatus: body.stockStatus ?? null,
    brandName: body.brandName ?? null,
    modelName: body.modelName ?? null,
    trimName: body.trimName ?? null,
    note: body.note ?? null,
    appStatus: "draft",
    revision: 0,
  }).returning({ id: quotes.id, quoteCode: quotes.quoteCode, createdAt: quotes.createdAt });

  const [s] = await ex.insert(quoteScenarios).values({
    quoteId: q.id,
    scenarioNo: 1,
    purchaseMethod: body.scenario?.purchaseMethod ?? null,
    termMonths: body.scenario?.termMonths ?? null,
    monthlyPayment: body.scenario?.monthlyPayment ?? null,
    lender: body.scenario?.lender ?? null,
  }).returning({ id: quoteScenarios.id });

  await ex.update(quotes).set({ primaryScenarioId: s.id }).where(eq(quotes.id, q.id));
  return q;
}
