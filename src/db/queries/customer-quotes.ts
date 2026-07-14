import { and, asc, eq, like, sql } from "drizzle-orm";

import { buildAdvisorQuotePayload } from "../../lib/app-card-payload";
import { nextSequenceCode, yymmKstOf } from "../../lib/business-code";
import { pickPrimaryScenario } from "../../lib/primary-scenario";
import { trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { quoteRequests } from "../public-app";
import { quotes, quoteScenarios } from "../schema";
import { completeQuoteRequest, deleteAdvisorQuoteByCrmQuoteId, reopenQuoteRequestIfUndelivered, upsertAdvisorQuote } from "./advisor-quotes";
import { getCustomerAppUserId } from "./customers";

// 발송 시 유효기간 7일(앱카드 D-day 정책 — 갭ⓐ, 2026-07-04 이사님 결정).
const SENT_VALID_MS = 7 * 86_400_000;

// 추가 안내 사항(앱 노출용). client/src/data/quote-guidance.ts QuoteGuidance와 동형.
export type QuoteGuidanceInput = {
  deliveryComment: string;
  stockNotice: string;
  expectedDelivery: string;
  customerRegion: string;
  keyPoints: string[];
  recommendReason: string;
  services: string[];
};

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
  // PR2a: 워크벤치 수정용 가격/색상/옵션 스냅샷(보낸 것만 갱신)
  trimId?: number | null;
  basePrice?: string | null;
  optionTotal?: string | null;
  options?: { id: number; name: string; price: number | null }[] | null;
  finalDiscount?: string | null;
  // 할인 구성 내역(기본 할인 제외 추가 행 — finalDiscount 총액과 별개로 항목 라벨/값 보존, 전체 교체).
  discountLines?: { label: string; amount: number; unit: string }[] | null;
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
  guidance?: QuoteGuidanceInput | null;
  bumpRevision?: boolean;
};
export type QuoteScenarioPatch = {
  purchaseMethod?: string | null;
  termMonths?: number | null;
  monthlyPayment?: string | null;
  lender?: string | null;
};
export type QuotePatch = QuoteHeaderPatch & { scenario?: QuoteScenarioPatch; scenarios?: ScenarioInput[] };
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
  // 앱카드 4섹션(2026-07-04): 계산엔진 연결 전 수기 입력 결과 필드 + 자동차세/보조금
  carTaxIncluded?: boolean | null;
  subsidyApplicable?: boolean | null;
  subsidyAmount?: string | null;
  totalReturnCost?: string | null;
  totalTakeoverCost?: string | null;
  dueAtDelivery?: string | null;
  interestRate?: string | null;
  // 솔루션 조회 재현성 스냅샷(마이그 0031) — 수기 시나리오는 미전송(→null 저장).
  solutionLenderCode?: string | null;
  solutionWorkbookVersion?: string | null;
  solutionCalculatedAt?: string | null;
  solutionRaw?: unknown;
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
  if (p.guidance !== undefined) set.guidance = p.guidance;
  if (p.appStatus !== undefined) {
    set.appStatus = p.appStatus;
    if (p.appStatus === "sent") {
      // 발송 시 서버가 시각 확정 + 유효기간 자동 스탬프(갭ⓐ, 2026-07-04 이사님 결정).
      // 재발송도 재스탬프(유효기간 리셋 — 수정 후 재발송이 새 유효기간을 갖는 의도된 동작).
      const sentAt = new Date();
      set.sentAt = sentAt;
      set.validUntil = new Date(sentAt.getTime() + SENT_VALID_MS);
    }
  }
  if (p.trimId !== undefined) set.trimId = p.trimId;
  if (p.basePrice !== undefined) set.basePrice = p.basePrice;
  if (p.optionTotal !== undefined) set.optionTotal = p.optionTotal;
  if (p.options !== undefined) set.options = p.options;
  if (p.finalDiscount !== undefined) set.finalDiscount = p.finalDiscount;
  if (p.discountLines !== undefined) set.discountLines = p.discountLines;
  if (p.acquisitionTax !== undefined) set.acquisitionTax = p.acquisitionTax;
  if (p.acquisitionTaxMode !== undefined) set.acquisitionTaxMode = p.acquisitionTaxMode;
  if (p.bond !== undefined) set.bond = p.bond;
  if (p.delivery !== undefined) set.delivery = p.delivery;
  if (p.incidental !== undefined) set.incidental = p.incidental;
  if (p.finalVehiclePrice !== undefined) set.finalVehiclePrice = p.finalVehiclePrice;
  if (p.acquisitionCost !== undefined) set.acquisitionCost = p.acquisitionCost;
  if (p.exteriorColorId !== undefined) set.exteriorColorId = p.exteriorColorId;
  if (p.exteriorColorName !== undefined) set.exteriorColorName = p.exteriorColorName;
  if (p.exteriorColorHex !== undefined) set.exteriorColorHex = p.exteriorColorHex;
  if (p.interiorColorId !== undefined) set.interiorColorId = p.interiorColorId;
  if (p.interiorColorName !== undefined) set.interiorColorName = p.interiorColorName;
  if (p.interiorColorHex !== undefined) set.interiorColorHex = p.interiorColorHex;
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

  // PR2a: scenarios(복수) 제공 시 전체 교체(delete→insert). 대표 재계산.
  if (patch.scenarios) {
    await ex.delete(quoteScenarios).where(eq(quoteScenarios.quoteId, quoteId));
    const { primaryId } = await insertScenarios(ex, quoteId, patch.scenarios);
    await ex.update(quotes).set({ primaryScenarioId: primaryId }).where(eq(quotes.id, quoteId));
  } else if (patch.scenario) {
    // 대표 시나리오 1건 갱신(헤더 PATCH와 함께 온 경우) — 갱신된 대표 기준(선택 규칙 SSOT).
    const target = pickPrimaryScenario(scs, primaryId);
    if (target) {
      await ex.update(quoteScenarios).set(scenarioSet(patch.scenario)).where(eq(quoteScenarios.id, target.id));
    }
  }

  // 발송 훅은 반드시 함수 "맨 끝"(시나리오 교체/대표 갱신 이후) — 워크벤치 발송은
  // {scenarios 전체 교체, appStatus:"sent"}가 한 PATCH에 동봉되므로 교체 반영 후의 fresh 상태를 스냅샷해야 한다.
  if (patch.appStatus === "sent") {
    try {
      await syncAdvisorQuoteOnSend(customerId, quoteId, ex);
    } catch (e) {
      // 발송은 저빈도·고중요 조작 — 실패 시 트랜잭션 롤백(스탬프 포함)되지만 사후 진단용 로그는 여기서만 남는다.
      console.error(`[advisor-quotes] 발송 수신함 반영 실패 quote=${quoteId}:`, e);
      throw e;
    }
  }
  return { id: row.id };
}

// 발송 훅(견적 앱 발송 파이프라인, 2026-07-05 스펙): appStatus "sent" 전이 시 같은 트랜잭션에서
// 앱 수신함 public.advisor_quotes에 라벨 완성본 카드를 upsert하고, 원 견적요청을 completed로 전이한다.
async function syncAdvisorQuoteOnSend(customerId: string, quoteId: string, ex: Executor): Promise<void> {
  // 앱 미연결 고객(app_user_id null)은 전부 생략 — 기존 내부 스탬프 발송 그대로(스펙 확정 결정 5).
  const owner = await getCustomerAppUserId(customerId, ex);
  const appUserId = owner?.appUserId ?? null;
  if (!appUserId) return;

  // fresh read: 헤더 UPDATE(sent_at/valid_until 스탬프)와 시나리오 교체가 모두 반영된 현재 상태.
  const [q] = await ex.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q?.sentAt) return; // sent 전이 직후라 스탬프는 항상 존재 — 타입 좁히기 겸 방어
  const scs = await ex
    .select()
    .from(quoteScenarios)
    .where(eq(quoteScenarios.quoteId, quoteId))
    .orderBy(asc(quoteScenarios.scenarioNo));
  const primary = pickPrimaryScenario(scs, q.primaryScenarioId);

  // crm.quotes에는 model_year가 없다 — trimId → catalog.trims 조인으로 조달(없으면 null, 조립기가 년식 생략).
  let modelYear: number | null = null;
  if (q.trimId != null) {
    const [trim] = await ex
      .select({ modelYear: trimsInCatalog.modelYear })
      .from(trimsInCatalog)
      .where(eq(trimsInCatalog.id, q.trimId));
    modelYear = trim?.modelYear ?? null;
  }

  // loose id ↔ 엄격 FK 경계(최종 통합 리뷰 I-1): crm.quotes.source_quote_request_id는 FK 없는 loose id지만
  // advisor_quotes.quote_request_id는 quote_requests 엄격 FK(ON DELETE SET NULL)다. 승격 후 앱 측에서
  // 원 요청이 삭제되면 dangling id를 그대로 upsert 시 FK 위반→트랜잭션 롤백→그 견적은 (재)발송이 영구
  // 차단된다. 발송 직전 존재를 확인해 없으면 "요청 무관 제안 견적"(스펙 확정 결정 1의 nullable 어휘)으로
  // null 강등하고 completed 전이도 생략한다. 존재 확인은 sourceQuoteRequestId 있을 때만 +1 왕복.
  let quoteRequestId: string | null = null;
  if (q.sourceQuoteRequestId) {
    const [req] = await ex
      .select({ id: quoteRequests.id })
      .from(quoteRequests)
      .where(eq(quoteRequests.id, q.sourceQuoteRequestId));
    quoteRequestId = req?.id ?? null;
  }

  // crm 스키마 timestamptz는 Date(mode 미지정), advisor_quotes(public 관례)는 string — ISO 변환 필수.
  const { payload, vehicleLabel, monthlyPayment } = buildAdvisorQuotePayload(q, primary, {
    modelYear,
    sentAtIso: q.sentAt.toISOString(),
  });
  await upsertAdvisorQuote(
    {
      userId: appUserId,
      quoteRequestId,
      crmQuoteId: q.id,
      quoteCode: q.quoteCode,
      revision: q.revision,
      vehicleLabel,
      monthlyPayment,
      payload,
      sentAt: q.sentAt.toISOString(),
      validUntil: q.validUntil?.toISOString() ?? null,
    },
    ex,
  );
  // 원 견적요청 완료 전이(스펙 확정 결정 6). 요청 무관 발송·원 요청 삭제(null 강등)는 스킵.
  if (quoteRequestId) await completeQuoteRequest(quoteRequestId, ex);
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
  if (!row) return null;
  try {
    // 보낸 카드 회수(스펙 확정 결정 7): loose id라 CASCADE가 없어 직접 삭제. 미발송 견적은 행이 없어 no-op.
    // RETURNING으로 요청 연결을 함께 회수 — crm.quotes.source_quote_request_id 대신 advisor 행 값을 쓰는 이유:
    // 앱 화면을 지배하는 건 advisor 쪽이고, dangling 강등(null)까지 반영된 정합값이라서.
    const recalled = await deleteAdvisorQuoteByCrmQuoteId(quoteId, ex);
    // 마지막 카드 회수면 요청 completed→open 복원(앱 정책 제안 2026-07-05 — "완료인데 견적 없음" 모순 방지).
    if (recalled?.quoteRequestId) await reopenQuoteRequestIfUndelivered(recalled.quoteRequestId, ex);
  } catch (e) {
    // 회수도 발송처럼 저빈도·고중요(실패 시 앱에 유령 카드) — 트랜잭션 롤백 전 사후 진단 로그를 남긴다.
    console.error(`[advisor-quotes] 카드 회수/요청 복원 실패 quote=${quoteId}:`, e);
    throw e;
  }
  return row;
}

// 다음 견적 코드 QT-YYMM-#### (KST 현재월 기준, 기존 최대 시퀀스 +1). UNIQUE 컬럼이라 서버가 canonical 생성.
export async function nextQuoteCode(ex: Executor = getDefaultDb()): Promise<string> {
  const prefix = `QT-${yymmKstOf()}-`;
  const rows = await ex.select({ code: quotes.quoteCode }).from(quotes).where(like(quotes.quoteCode, `${prefix}%`));
  return nextSequenceCode(prefix, rows.map((r) => r.code));
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
  sourceQuoteRequestId?: string | null; // 앱 견적요청 승격(S3) 출처. loose id(FK 없음).
  // #4c-2 워크벤치 스냅샷
  trimId?: number | null;
  basePrice?: string | null;
  optionTotal?: string | null;
  options?: { id: number; name: string; price: number | null }[] | null;
  finalDiscount?: string | null;
  discountLines?: { label: string; amount: number; unit: string }[] | null;
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
  guidance?: QuoteGuidanceInput | null;
  scenario?: QuoteScenarioPatch;
  scenarios?: ScenarioInput[];
};

// 시나리오 N건 insert + 대표(scenario_no 최소) id 반환. createQuote/updateQuote 공용.
async function insertScenarios(
  ex: Executor,
  quoteId: string,
  inputs: ScenarioInput[],
): Promise<{ primaryId: string | null }> {
  const inserted: { id: string; scenarioNo: number }[] = [];
  for (const sc of inputs) {
    const scenarioNo = sc.scenarioNo ?? 1;
    const [s] = await ex.insert(quoteScenarios).values({
      quoteId,
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
      carTaxIncluded: sc.carTaxIncluded ?? null,
      subsidyApplicable: sc.subsidyApplicable ?? null,
      subsidyAmount: sc.subsidyAmount ?? null,
      totalReturnCost: sc.totalReturnCost ?? null,
      totalTakeoverCost: sc.totalTakeoverCost ?? null,
      dueAtDelivery: sc.dueAtDelivery ?? null,
      interestRate: sc.interestRate ?? null,
      // 솔루션 조회 스냅샷(마이그 0031) — 재현성: 어느 금융사/워크북 버전으로 언제 계산했는지 + 원 응답.
      solutionLenderCode: sc.solutionLenderCode ?? null,
      solutionWorkbookVersion: sc.solutionWorkbookVersion ?? null,
      solutionCalculatedAt: sc.solutionCalculatedAt ? new Date(sc.solutionCalculatedAt) : null,
      solutionRaw: sc.solutionRaw ?? null,
    }).returning({ id: quoteScenarios.id });
    inserted.push({ id: s.id, scenarioNo });
  }
  const primary = inserted.length
    ? inserted.reduce((m, x) => (x.scenarioNo < m.scenarioNo ? x : m))
    : null;
  return { primaryId: primary?.id ?? null };
}

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
    sourceQuoteRequestId: body.sourceQuoteRequestId ?? null,
    guidance: body.guidance ?? null,
    trimId: body.trimId ?? null,
    basePrice: body.basePrice ?? null,
    optionTotal: body.optionTotal ?? null,
    options: body.options ?? null,
    finalDiscount: body.finalDiscount ?? null,
    discountLines: body.discountLines ?? null,
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

  const { primaryId } = await insertScenarios(ex, q.id, scenarioInputs);
  if (primaryId) await ex.update(quotes).set({ primaryScenarioId: primaryId }).where(eq(quotes.id, q.id));
  return q;
}

// ── 견적 원본 파일(#4d) — quotes.file_* 영속. id AND customer_id 가드. ──────
export async function setQuoteFile(
  customerId: string,
  quoteId: string,
  file: { fileName: string; fileSize: number; fileMime: string | null; filePath: string },
  ex: Executor = getDefaultDb(),
): Promise<{ previousFilePath: string | null } | null> {
  const [prev] = await ex
    .select({ filePath: quotes.filePath })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)));
  if (!prev) return null;
  await ex
    .update(quotes)
    .set({ fileName: file.fileName, fileSize: file.fileSize, fileMime: file.fileMime, filePath: file.filePath, updatedAt: new Date() })
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)));
  return { previousFilePath: prev.filePath };
}

export async function clearQuoteFile(
  customerId: string,
  quoteId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ previousFilePath: string | null } | null> {
  const [prev] = await ex
    .select({ filePath: quotes.filePath })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)));
  if (!prev) return null;
  await ex
    .update(quotes)
    .set({ fileName: null, fileSize: null, fileMime: null, filePath: null, updatedAt: new Date() })
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)));
  return { previousFilePath: prev.filePath };
}

export async function getQuoteFilePath(
  customerId: string,
  quoteId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ filePath: string | null; fileMime: string | null } | null> {
  const [row] = await ex
    .select({ filePath: quotes.filePath, fileMime: quotes.fileMime })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)));
  return row ?? null;
}
