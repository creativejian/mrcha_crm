// client/src/lib/solution-quote.ts
// 파트너(financial-dolim-solution) 견적 계산 API의 CRM 소비 계약 + 매핑 SSOT.
// 부작용 0 순수 모듈 — 서버(src/)가 import해도 되는 경계(#190 규칙).
// 계약 원본·매핑 근거: ref/specs/2026-07-14-crm-solution-quote-integration-design.md §파트너 계약.
// 잔존 3모드 매핑은 제프 UI 원본(dolim-solution QuoteRevolutionV2.tsx:197-202)을 미러한다.

export const SOLUTION_LENDERS = [
  { code: "mg-capital", label: "MG캐피탈" },
  { code: "bnk-capital", label: "BNK캐피탈" },
  { code: "woori-card", label: "우리카드" },
  { code: "meritz-capital", label: "메리츠캐피탈" },
  { code: "shinhan-card", label: "신한카드" },
  { code: "kdbc-capital", label: "산은캐피탈" },
  { code: "im-capital", label: "iM캐피탈" },
  { code: "nh-capital", label: "농협캐피탈" },
] as const; // 순서 = 파트너 /api/lenders 표시 순서(변경 금지)

export type SolutionLenderCode = (typeof SOLUTION_LENDERS)[number]["code"];

// 장기렌트 취급 3사 — 파트너 app.ts의 long_term_rental dispatch 게이트 미러.
const RENTAL_LENDER_CODES: readonly SolutionLenderCode[] = ["mg-capital", "meritz-capital", "im-capital"];

export type SolutionProductType = "operating_lease" | "long_term_rental";

export function solutionProductTypeOf(purchaseMethod: string): SolutionProductType | null {
  if (purchaseMethod === "운용리스") return "operating_lease";
  if (purchaseMethod === "장기렌트") return "long_term_rental";
  return null; // 금융리스·할부·일시불 등 — 파트너 미구현(수기 작성 몫)
}

export function solutionLenderOptions(purchaseMethod: string): { code: SolutionLenderCode; label: string }[] {
  const product = solutionProductTypeOf(purchaseMethod);
  if (!product) return [];
  const list = product === "long_term_rental"
    ? SOLUTION_LENDERS.filter((l) => RENTAL_LENDER_CODES.includes(l.code))
    : SOLUTION_LENDERS;
  return list.map((l) => ({ code: l.code, label: l.label }));
}

// 파트너 ANNUAL_MILEAGES 미러. CRM 표시 문자열("20,000km / 년")과 왕복.
const SOLUTION_MILEAGES = [10000, 15000, 20000, 25000, 30000, 35000, 40000] as const;
export function solutionMileageOf(mileageValue: string): number | null {
  const digits = Number(mileageValue.replace(/[^\d]/g, ""));
  return (SOLUTION_MILEAGES as readonly number[]).includes(digits) ? digits : null;
}

const LEASE_TERMS = [12, 24, 36, 48, 60] as const;

// 파트너 CanonicalQuoteInput의 CRM 전송 서브셋(스펙 §계약).
export type SolutionQuoteInput = {
  lenderCode: SolutionLenderCode;
  productType: SolutionProductType;
  brand: string;
  modelName: string;
  masterMcCode: string;
  ownershipType: "company"; // 제프 UI 고정 기본 미러(QuoteRevolutionV2.tsx:220)
  leaseTermMonths: number;
  annualMileageKm: number;
  depositAmount: number;
  upfrontPayment: number;
  quotedVehiclePrice: number; // 할인 전(base+option) — 할인 차감은 파트너가 수행(이중 차감 금지)
  discountAmount?: number;
  evSubsidyAmount?: number;
  residualMode?: "high" | "standard";
  residualValueRatio?: number; // 분율(0.45)
  residualAmountOverride?: number; // 원
};

const parseWon = (raw: string): number => {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
};

type BuildArgs = {
  lenderLabel: string | null;
  purchaseMethod: string;
  termMonths: number;
  depositMode: "none" | "amount" | "percent";
  depositRaw: string;
  downPaymentMode: "none" | "amount" | "percent";
  downPaymentRaw: string;
  residualMode: "max" | "amount" | "percent";
  residualRaw: string;
  mileageValue: string;
  subsidyApplicable: boolean;
  subsidyRaw: string;
  vehicle: { brand: string | null; model: string | null; mcCode: string | null };
  pricing: { baseAndOption: number; discount: number };
};

export type BuildResult = { ok: true; input: SolutionQuoteInput } | { ok: false; reason: string };

export function buildSolutionQuoteInput(args: BuildArgs): BuildResult {
  const productType = solutionProductTypeOf(args.purchaseMethod);
  if (!productType) return { ok: false, reason: "솔루션 조회는 운용리스·장기렌트만 지원합니다" };

  const options = solutionLenderOptions(args.purchaseMethod);
  const lender = options.find((l) => l.label === args.lenderLabel);
  if (!lender) return { ok: false, reason: "솔루션 지원 금융사를 선택해 주세요" };

  if (!args.vehicle.brand || !args.vehicle.model) return { ok: false, reason: "차량을 먼저 선택해 주세요" };
  if (!args.vehicle.mcCode) return { ok: false, reason: "이 차량은 MC코드가 없어 솔루션 조회를 할 수 없습니다" };

  if (!(LEASE_TERMS as readonly number[]).includes(args.termMonths))
    return { ok: false, reason: "기간은 12·24·36·48·60개월만 지원합니다" };

  const mileage = solutionMileageOf(args.mileageValue);
  if (mileage == null) return { ok: false, reason: "약정거리는 10,000~40,000km(5,000 단위)만 지원합니다" };

  if (args.pricing.baseAndOption <= 0) return { ok: false, reason: "차량 가격을 먼저 입력해 주세요" };

  // %→원 환산 기준 = 할인 전 차량가(파트너 입력이 할인 전 기준 — 스펙 §계약)
  const wonOf = (mode: "none" | "amount" | "percent", raw: string): number => {
    if (mode === "none") return 0;
    if (mode === "percent") {
      const pct = Number(raw.replace(/[^\d.]/g, ""));
      return Number.isFinite(pct) ? Math.round(args.pricing.baseAndOption * pct / 100) : 0;
    }
    return parseWon(raw);
  };

  const input: SolutionQuoteInput = {
    lenderCode: lender.code,
    productType,
    brand: args.vehicle.brand,
    modelName: args.vehicle.model,
    masterMcCode: args.vehicle.mcCode,
    ownershipType: "company",
    leaseTermMonths: args.termMonths,
    annualMileageKm: mileage,
    depositAmount: wonOf(args.depositMode, args.depositRaw),
    upfrontPayment: wonOf(args.downPaymentMode, args.downPaymentRaw),
    quotedVehiclePrice: args.pricing.baseAndOption,
  };
  if (args.pricing.discount > 0) input.discountAmount = args.pricing.discount;
  if (args.subsidyApplicable) {
    const subsidy = parseWon(args.subsidyRaw);
    if (subsidy > 0) input.evSubsidyAmount = subsidy;
  }
  // 잔존 3모드 — 제프 UI 원본 매핑(최대=high / %·금액=standard+override)
  if (args.residualMode === "max") {
    input.residualMode = "high";
  } else if (args.residualMode === "percent") {
    const pct = Number(args.residualRaw.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(pct) || pct <= 0) return { ok: false, reason: "잔존가치 %를 입력해 주세요" };
    input.residualMode = "standard";
    input.residualValueRatio = pct / 100;
  } else {
    const amount = parseWon(args.residualRaw);
    if (amount <= 0) return { ok: false, reason: "잔존가치 금액을 입력해 주세요" };
    input.residualMode = "standard";
    input.residualAmountOverride = amount;
  }
  return { ok: true, input };
}

// 파트너 응답의 CRM 소비 형태. 확장 3필드(반납/인수/출고 전)는 제프 응답 확장 전 null —
// CRM은 파생 조립하지 않는다(스펙 결정 3: 계산 권위 = 제프 한 곳).
export type SolutionQuoteParsed = {
  monthlyPayment: number;
  annualRatePct: number;
  effectiveAnnualRatePct: number;
  residualRatePct: number;
  residualAmount: number;
  workbookVersion: string;
  warnings: string[];
  totalReturnCost: number | null;
  totalTakeoverCost: number | null;
  dueAtDelivery: number | null;
};

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseSolutionQuoteResult(raw: unknown): SolutionQuoteParsed | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as { ok?: unknown; quote?: unknown };
  if (body.ok !== true || typeof body.quote !== "object" || body.quote === null) return null;
  const q = body.quote as Record<string, unknown>;
  const rates = (q.rates ?? {}) as Record<string, unknown>;
  const residual = (q.residual ?? {}) as Record<string, unknown>;
  const workbook = (q.workbookImport ?? {}) as Record<string, unknown>;

  const monthlyPayment = numOrNull(q.monthlyPayment);
  const annualRate = numOrNull(rates.annualRateDecimal);
  const residualAmount = numOrNull(residual.amount);
  if (monthlyPayment == null || annualRate == null || residualAmount == null) return null;

  const pct = (d: number) => Math.round(d * 10000) / 100; // 0.0532 → 5.32

  return {
    monthlyPayment,
    annualRatePct: pct(annualRate),
    effectiveAnnualRatePct: pct(numOrNull(rates.effectiveAnnualRateDecimal) ?? annualRate),
    residualRatePct: pct(numOrNull(residual.rateDecimal) ?? 0),
    residualAmount,
    workbookVersion: typeof workbook.versionLabel === "string" ? workbook.versionLabel : "",
    warnings: Array.isArray(q.warnings) ? q.warnings.filter((w): w is string => typeof w === "string") : [],
    totalReturnCost: numOrNull(q.totalReturnCost),
    totalTakeoverCost: numOrNull(q.totalTakeoverCost),
    dueAtDelivery: numOrNull(q.dueAtDelivery),
  };
}

// 금리 표시 선택 — 우리카드는 잔가보장수수료 lump-sum 때문에 유효금리가 메인(제프 QuoteResultCard.tsx:29 미러).
export function solutionDisplayRatePct(lenderCode: SolutionLenderCode, parsed: SolutionQuoteParsed): number {
  return lenderCode === "woori-card" ? parsed.effectiveAnnualRatePct : parsed.annualRatePct;
}

// 시나리오 저장에 동봉하는 재현성 스냅샷(마이그 0031 — 스펙 결정 4·5).
export type SolutionSnapshot = {
  solutionLenderCode: string;
  solutionWorkbookVersion: string;
  solutionCalculatedAt: string; // ISO
  solutionRaw: unknown; // 파트너 응답 raw 통째(앱 partner_raw_response 선례)
};
