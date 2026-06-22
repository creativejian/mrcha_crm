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
  primaryScenarioId?: string | null;
  bumpRevision?: boolean;
};
export type QuoteScenarioPatch = {
  purchaseMethod?: string | null;
  termMonths?: number | null;
  monthlyPayment?: string | null;
  lender?: string | null;
};
export type QuotePatch = QuoteHeaderPatch & { scenario?: QuoteScenarioPatch };
// #4c-3a 생성용 시나리오(비교카드 입력 가능 컬럼 + 메타). PATCH는 단수 그대로.
export type ScenarioInput = QuoteScenarioPatch & {
  scenarioNo?: number | null;
  isSaved?: boolean;
  depositMode?: string | null;
  depositValue?: string | null;
  downPaymentMode?: string | null;
  downPaymentValue?: string | null;
  residualMode?: string | null;
  residualValue?: string | null;
  mileageMode?: string | null;
  mileageValue?: string | null;
};

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

// 기존 견적 헤더 + (선택)대표 시나리오 1건 갱신 + (선택)대표 전환. customer_id 가드 불일치/없는 quoteId면 null(→404).
// 대표 전환(primaryScenarioId)은 그 id가 이 quote의 시나리오일 때만 set(타 quote/없는 id는 무시). null이면 해제.
// 대표 시나리오 갱신 = primary_scenario_id 일치 → 없으면 scenario_no 최소.
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

  // 대표 전환 또는 대표 시나리오 갱신이 필요할 때만 시나리오 목록을 조회한다.
  const needScenarios = patch.scenario != null || patch.primaryScenarioId !== undefined;
  const scs = needScenarios
    ? await ex
        .select({ id: quoteScenarios.id })
        .from(quoteScenarios)
        .where(eq(quoteScenarios.quoteId, quoteId))
        .orderBy(asc(quoteScenarios.scenarioNo))
    : [];

  // 대표 전환: 이 quote의 시나리오일 때만(또는 null=해제) set. 무효 id는 무시.
  let primaryId = row.primaryScenarioId;
  if (patch.primaryScenarioId !== undefined && (patch.primaryScenarioId === null || scs.some((s) => s.id === patch.primaryScenarioId))) {
    await ex.update(quotes).set({ primaryScenarioId: patch.primaryScenarioId }).where(eq(quotes.id, quoteId));
    primaryId = patch.primaryScenarioId;
  }

  // 대표 시나리오 1건 갱신(헤더 PATCH와 함께 온 경우) — 갱신된 대표 기준.
  if (patch.scenario) {
    const target = scs.find((s) => s.id === primaryId) ?? scs[0];
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

// 생성 바디(라우트 zod와 동형). 헤더 + 대표 시나리오 1건. #4c-2: 가격/색상/옵션 스냅샷(전부 optional, composer는 미전송).
export type QuoteCreateBody = {
  entryMode?: string | null;
  status?: string | null;
  quoteRound?: string | null;
  stockStatus?: string | null;
  brandName?: string | null;
  modelName?: string | null;
  trimName?: string | null;
  note?: string | null;
  // #4c-2 워크벤치 스냅샷
  trimId?: number | null;
  basePrice?: string | null;
  optionTotal?: string | null;
  options?: { id: number; name: string; price: number | null }[] | null;
  finalDiscount?: string | null;
  acquisitionTax?: string | null;
  acquisitionTaxMode?: string | null;
  bond?: string | null;
  delivery?: string | null;
  incidental?: string | null;
  finalVehiclePrice?: string | null;
  acquisitionCost?: string | null;
  exteriorColorId?: number | null;
  exteriorColorName?: string | null;
  exteriorColorHex?: string | null;
  interiorColorId?: number | null;
  interiorColorName?: string | null;
  interiorColorHex?: string | null;
  scenario?: QuoteScenarioPatch;
  scenarios?: ScenarioInput[];
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
    trimId: body.trimId ?? null,
    basePrice: body.basePrice ?? null,
    optionTotal: body.optionTotal ?? null,
    options: body.options ?? null,
    finalDiscount: body.finalDiscount ?? null,
    acquisitionTax: body.acquisitionTax ?? null,
    acquisitionTaxMode: body.acquisitionTaxMode ?? null,
    bond: body.bond ?? null,
    delivery: body.delivery ?? null,
    incidental: body.incidental ?? null,
    finalVehiclePrice: body.finalVehiclePrice ?? null,
    acquisitionCost: body.acquisitionCost ?? null,
    exteriorColorId: body.exteriorColorId ?? null,
    exteriorColorName: body.exteriorColorName ?? null,
    exteriorColorHex: body.exteriorColorHex ?? null,
    interiorColorId: body.interiorColorId ?? null,
    interiorColorName: body.interiorColorName ?? null,
    interiorColorHex: body.interiorColorHex ?? null,
    appStatus: "draft",
    revision: 0,
  }).returning({ id: quotes.id, quoteCode: quotes.quoteCode, createdAt: quotes.createdAt });

  // #4c-3a: scenarios(복수) 우선, 없으면 scenario(단수)를 1건으로(하위호환).
  const scenarioInputs: ScenarioInput[] = (body.scenarios && body.scenarios.length)
    ? body.scenarios
    : (body.scenario ? [{ ...body.scenario, scenarioNo: 1 }] : []);

  const inserted: { id: string; scenarioNo: number }[] = [];
  for (const sc of scenarioInputs) {
    const scenarioNo = sc.scenarioNo ?? 1;
    const [s] = await ex.insert(quoteScenarios).values({
      quoteId: q.id,
      scenarioNo,
      isSaved: sc.isSaved ?? false,
      savedAt: sc.isSaved ? new Date() : null,
      purchaseMethod: sc.purchaseMethod ?? null,
      termMonths: sc.termMonths ?? null,
      monthlyPayment: sc.monthlyPayment ?? null,
      lender: sc.lender ?? null,
      depositMode: sc.depositMode ?? null,
      depositValue: sc.depositValue ?? null,
      downPaymentMode: sc.downPaymentMode ?? null,
      downPaymentValue: sc.downPaymentValue ?? null,
      residualMode: sc.residualMode ?? null,
      residualValue: sc.residualValue ?? null,
      mileageMode: sc.mileageMode ?? null,
      mileageValue: sc.mileageValue ?? null,
    }).returning({ id: quoteScenarios.id });
    inserted.push({ id: s.id, scenarioNo });
  }

  // 대표 = scenario_no 최소(보통 1). 없으면 첫 건.
  const primary = inserted.length
    ? inserted.reduce((m, x) => (x.scenarioNo < m.scenarioNo ? x : m))
    : null;
  if (primary) await ex.update(quotes).set({ primaryScenarioId: primary.id }).where(eq(quotes.id, q.id));
  return q;
}
