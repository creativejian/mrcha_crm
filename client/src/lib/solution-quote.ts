// client/src/lib/solution-quote.ts
// 파트너(financial-dolim-solution) 견적 계산 API의 CRM 소비 계약 + 매핑 SSOT.
// 부작용 0 순수 모듈 — 서버(src/)가 import해도 되는 경계(#190 규칙).
// 계약 원본·매핑 근거: ref/specs/2026-07-14-crm-solution-quote-integration-design.md §파트너 계약.
// 잔존 3모드 매핑은 제프 UI 원본(dolim-solution QuoteRevolutionV2.tsx:197-202)을 미러한다.

import { parsePercentInput, percentToWon } from "./quote-pricing";

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

// CRM 소유 수기 전용 금융사(개정 1 R2 — 어휘 = 파트너 상위집합 구조). 여기 라벨을 한 줄 추가하면
// 금융사 select에 노출되지만 계산기는 미취급 경고(R1-3)를 낸다 — 파트너 미지원사의 수기 견적용.
export const CRM_EXTRA_LENDERS: readonly string[] = [];

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
// export — 서버 릴레이(src/routes/solution.ts)의 zod 게이트가 이 값에서 파생한다(손 복제 금지).
export const SOLUTION_MILEAGES = [10000, 15000, 20000, 25000, 30000, 35000, 40000] as const;
// export — 지원집합 게이트(support-matrix.ts 소비처)가 표시 문자열 ↔ km 왕복에 쓴다(손 복제 금지).
export function solutionMileageOf(mileageValue: string): number | null {
  const digits = Number(mileageValue.replace(/[^\d]/g, ""));
  return (SOLUTION_MILEAGES as readonly number[]).includes(digits) ? digits : null;
}

// 파트너 지원 기간(개월). export — 서버 릴레이 zod 게이트가 이 값에서 파생한다(손 복제 금지).
export const SOLUTION_LEASE_TERMS = [12, 24, 36, 48, 60] as const;

// 계산기 모달(값어림 계산) 확장 어휘 — 제프 shared/contracts/quote.constants.ts 미러
// (스펙: ref/specs/2026-07-16-crm-calculator-modal-design.md §릴레이 zod 확장).
// export — 서버 릴레이 zod 게이트가 이 값에서 파생한다(손 복제 금지, SOLUTION_MILEAGES 선례).
export const SOLUTION_AFFILIATE_TYPES = ["비제휴사", "KCC오토", "KCC면제"] as const;
export const SOLUTION_ACQUISITION_TAX_MODES = ["automatic", "ratio", "reduction", "amount"] as const;
export const SOLUTION_RELEASE_METHODS = ["dealer", "special"] as const; // 장기렌트 출고방식(dealer=대리점 / special=제조사 특판)
export const SOLUTION_MAINTENANCE_GRADES = ["basic", "vip"] as const; // 장기렌트 정비 등급

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
  // ── 계산기 모달 확장 17필드(전부 optional — 스펙 2026-07-16 §릴레이 zod 확장, 제프 calculateQuoteSchema 미러) ──
  // buildSolutionQuoteInput(워크벤치 빌더)은 이 필드들을 만들지 않는다 — 출력 불변(하위호환).
  affiliateType?: (typeof SOLUTION_AFFILIATE_TYPES)[number];
  directModelEntry?: boolean;
  releaseMethod?: (typeof SOLUTION_RELEASE_METHODS)[number]; // 장기렌트 전용(리스는 미전송 — V2 미러)
  maintenanceGrade?: (typeof SOLUTION_MAINTENANCE_GRADES)[number]; // 장기렌트 전용
  selectedResidualRateOverride?: number; // 분율(0.45) — 제프는 positive(0 불가)
  acquisitionTaxMode?: (typeof SOLUTION_ACQUISITION_TAX_MODES)[number];
  acquisitionTaxAmountOverride?: number; // 원
  includePublicBondCost?: boolean;
  publicBondCost?: number; // 원
  includeDeliveryFeeAmount?: boolean;
  deliveryFeeAmount?: number; // 원
  includeMiscFeeAmount?: boolean;
  miscFeeAmount?: number; // 원
  cmFeeRate?: number; // 분율(0.01 = 1%)
  agFeeRate?: number; // 분율
  insuranceYearlyAmount?: number; // 원/년
  lossDamageAmount?: number; // 원
  // 판매사(딜러) — 제프 canonical 필드(quote.schema.ts:85, bnkDealerName은 deprecated alias라 미사용).
  // 해당 lender 요청에만 동봉(useMultiQuote dealerSelection) — 타사로 흘리면 견적이 조용히 틀어진다.
  dealerName?: string;
};

const parseWon = (raw: string): number => {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
};

// export — 워크벤치 훅(직접 계산)·랭킹 모달(금융사별 병렬)이 lenderLabel 제외 조립(Omit)을 공유한다(개정 2).
export type BuildArgs = {
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
  // CM/AG 수수료 % 원문(계산기 패리티 — 파트너 cmFeeRate/agFeeRate 분율로 변환 전송).
  cmFeeRaw: string;
  agFeeRaw: string;
  // 판매사(T2) — 선택 딜러명 그대로 passthrough(null = 비제휴/미선택 → 미전송). ⚠️ 딜러는 lenderLabel의
  // 금융사에 귀속된 값이다 — 다른 금융사 요청에 실으면 견적이 무음으로 틀어진다(BNK 하드 폴백/메리츠 fee 0,
  // useMultiQuote DealerSelection 근거). 전사 프로브(랭킹 모달)는 buildCardSolutionBaseArgs가 null로 벗긴다.
  dealerName: string | null;
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

  if (!(SOLUTION_LEASE_TERMS as readonly number[]).includes(args.termMonths))
    return { ok: false, reason: "기간은 12·24·36·48·60개월만 지원합니다" };

  const mileage = solutionMileageOf(args.mileageValue);
  if (mileage == null) return { ok: false, reason: "약정거리는 10,000~40,000km(5,000 단위)만 지원합니다" };

  if (args.pricing.baseAndOption <= 0) return { ok: false, reason: "차량 가격을 먼저 입력해 주세요" };

  // %→원 환산 기준 = 할인 전 차량가(파트너 입력이 할인 전 기준 — 스펙 §계약). 파싱은 parsePercentInput SSOT
  // (파생·할인 %와 공유). 100% 초과는 null → 빌드 실패(fail-loud) — 콤마 오입력 "10,5"→"105"→105% 무음 전송 차단.
  // 빈 % 칸·비유한은 0 → 0원(에러 아님 — 빈 % 칸은 0 의미).
  const wonOf = (mode: "none" | "amount" | "percent", raw: string): number | null => {
    if (mode === "none") return 0;
    if (mode === "percent") {
      const pct = parsePercentInput(raw);
      if (pct > 100) return null;
      return percentToWon(args.pricing.baseAndOption, pct);
    }
    return parseWon(raw);
  };

  const depositAmount = wonOf(args.depositMode, args.depositRaw);
  const upfrontPayment = wonOf(args.downPaymentMode, args.downPaymentRaw);
  if (depositAmount == null || upfrontPayment == null)
    return { ok: false, reason: "보증금·선수금 %는 100 이하로 입력해 주세요" };

  // CM/AG %(계산기 패리티) — 분율(0.01 = 1%) 변환 전송. 빈 칸은 0(계산기도 0 상시 전송 — prod 실증).
  // 100 초과 = 콤마 오입력 fail-loud(wonOf 상한 미러).
  const cmFeePct = parsePercentInput(args.cmFeeRaw);
  const agFeePct = parsePercentInput(args.agFeeRaw);
  if (cmFeePct > 100 || agFeePct > 100)
    return { ok: false, reason: "CM/AG 수수료 %는 100 이하로 입력해 주세요" };

  const input: SolutionQuoteInput = {
    lenderCode: lender.code,
    productType,
    brand: args.vehicle.brand,
    modelName: args.vehicle.model,
    masterMcCode: args.vehicle.mcCode,
    ownershipType: "company",
    leaseTermMonths: args.termMonths,
    annualMileageKm: mileage,
    depositAmount,
    upfrontPayment,
    quotedVehiclePrice: args.pricing.baseAndOption,
    cmFeeRate: cmFeePct / 100,
    agFeeRate: agFeePct / 100,
  };
  if (args.pricing.discount > 0) input.discountAmount = args.pricing.discount;
  // 판매사(T2) — 값 있을 때만 동봉(파트너 zod min(1) optional — 빈 문자열 전송 금지).
  if (args.dealerName) input.dealerName = args.dealerName;
  if (args.subsidyApplicable) {
    const subsidy = parseWon(args.subsidyRaw);
    if (subsidy > 0) input.evSubsidyAmount = subsidy;
  }
  // 잔존 3모드 — 제프 UI 원본 매핑(최대=high / %·금액=standard+override)
  if (args.residualMode === "max") {
    input.residualMode = "high";
  } else if (args.residualMode === "percent") {
    const pct = parsePercentInput(args.residualRaw);
    if (pct <= 0) return { ok: false, reason: "잔존가치 %를 입력해 주세요" };
    // 100% 초과 = 콤마 오입력("45,5"→455%) — wonOf와 동일한 fail-loud 상한
    if (pct > 100) return { ok: false, reason: "잔존가치 %는 100 이하로 입력해 주세요" };
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

// 파트너 응답의 CRM 소비 형태. 확장 3필드(반납/인수/출고 전)·금리 필드는 raw 스냅샷 보존용 파싱
// (개정 1 — 원 결정 3 폐기: 카드 결과 4필드 채움은 lease-rate.ts 파생이 담당, 제프 값은 카드에 안 실린다).
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
    effectiveAnnualRatePct: pct(numOrNull(rates.effectiveAnnualRateDecimal) ?? annualRate), // 유효금리 누락 시 표면금리 폴백 — 방어 기본값
    residualRatePct: pct(numOrNull(residual.rateDecimal) ?? 0),
    residualAmount,
    workbookVersion: typeof workbook.versionLabel === "string" ? workbook.versionLabel : "",
    warnings: Array.isArray(q.warnings) ? q.warnings.filter((w): w is string => typeof w === "string") : [],
    totalReturnCost: numOrNull(q.totalReturnCost),
    totalTakeoverCost: numOrNull(q.totalTakeoverCost),
    dueAtDelivery: numOrNull(q.dueAtDelivery),
  };
}

// (solutionDisplayRatePct — 우리카드 유효금리 표시 규칙 — 는 개정 1로 제거: 카드 금리는 제프 응답이 아니라
// 리스계산기 실질 금리 파생(lease-rate.ts). 제프 금리 필드는 raw 스냅샷·파서에만 잔존.)

// 시나리오 저장에 동봉하는 재현성 스냅샷(마이그 0031 — 스펙 결정 4·5).
export type SolutionSnapshot = {
  solutionLenderCode: string;
  solutionWorkbookVersion: string | null; // 새 조회는 항상 string(parse 폴백 "") — null은 구 행(DB) 왕복 보존용
  solutionCalculatedAt: string; // ISO
  solutionRaw: unknown; // 파트너 응답 raw 통째(앱 partner_raw_response 선례)
};
