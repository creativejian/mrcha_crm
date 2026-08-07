// client/src/lib/solution-quote.ts
// 파트너(financial-dolim-solution) 견적 계산 API의 CRM 소비 계약 + 매핑 SSOT.
// 부작용 0 순수 모듈 — 서버(src/)가 import해도 되는 경계(#190 규칙).
// 계약 원본·매핑 근거: ref/specs/2026-07-14-crm-solution-quote-integration-design.md §파트너 계약.
// 잔존 3모드 매핑은 제프 UI 원본(dolim-solution QuoteRevolutionV2.tsx:197-202)을 미러한다.

import { formatMoney, parsePercentInput, percentToWon } from "./quote-pricing";

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

// ── 금융사 SSOT 드리프트 판정(2026-07-23) ──────────────────────────────────────
// `SOLUTION_LENDERS`는 파트너 목록의 **하드코딩 미러**다. 실시간 fetch로 바꾸지 않는 이유:
// ①`SolutionLenderCode`가 이 상수에서 파생된 **컴파일타임 타입**이라 런타임 값으로는 못 만든다
// ②딜러 조회·지원집합·`RENTAL_LENDER_CODES`가 전부 이 code에 키되고, label은 저장 견적
// (`crm.quotes.lender`)에 박히는 데이터 계약이다 ③`CRM_EXTRA_LENDERS`로 CRM이 **상위집합**을
// 소유하는 설계라 파트너 목록을 그대로 덮으면 그 확장점이 죽는다 ④파트너가 죽어도 금융사
// 드롭다운은 떠야 한다(계산·딜러·매트릭스만 파트너 의존).
// 대신 **드리프트는 시끄럽게** 잡는다 — 파트너 support-matrix 응답이 그쪽 lender SSOT를 그대로
// 싣고 오므로(회신 `ref/2026-07-21-jeff-support-matrix-reply.md`: 파라미터 없이 전량 반환) 그
// 응답과 여기를 대조한다. 런타임(`fetchSupportMatrix` 경고)과 `bun run check:lenders`가 이 한 벌을 공유한다.
// **축 3개**: 추가(onlyPartner) · 삭제(onlyCrm) · **개명(renamed)**.
// 개명 축은 제프가 요청 수락 후 `lenderName`을 실어 주면서 열렸다(요청 `…-request.md` / 회신
// `ref/2026-07-23-jeff-lender-name-reply.md`). 제프 쪽도 대칭 가드를 세웠다 — 라우트 테스트에 8사
// 표시명을 **리터럴로 박아** 그쪽이 개명하는 순간 그쪽 CI가 먼저 빨개진다(회신 문서).
// ⚠️ `lenderName`이 없는 응답(배포 전·구 캐시)에서는 **개명 축만 조용히 건너뛴다**(오탐 방지).
export type PartnerLender = { code: string; name: string | null };

export type LenderDrift = {
  onlyPartner: string[];
  onlyCrm: string[];
  /** 코드는 같은데 표시명이 다른 사 — 파트너가 `lenderName`을 실어 보낼 때만 판정한다. */
  renamed: { code: string; partner: string; crm: string }[];
};

// 파트너 support-matrix 응답에서 금융사 (code, 표시명) 쌍을 뽑는다. productType별로 같은 code가 여러 행에
// 오므로 code 기준으로 접는다(제프 계약: 행마다 같은 값 반복).
// ⚠️ `lenderName`은 2026-07-23 추가분이라 **없을 수 있다**(제프 배포 전·캐시된 구 응답) → null로 받고
// 그 사의 label 판정만 건너뛴다. code 축은 그대로 돈다 — 배포 순서 제약 0(회신 문서 명시).
export function extractPartnerLenders(raw: unknown): PartnerLender[] {
  const rows = (raw as { matrix?: unknown } | null)?.matrix;
  if (!Array.isArray(rows)) return [];
  const byCode = new Map<string, string | null>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { lenderCode, lenderName } = row as Record<string, unknown>;
    if (typeof lenderCode !== "string" || lenderCode === "") continue;
    const name = typeof lenderName === "string" && lenderName !== "" ? lenderName : null;
    const prev = byCode.get(lenderCode);
    // 먼저 온 이름을 유지하되, 이름 없는 행이 선행했으면 뒤의 실명으로 채운다(행 순서 무관).
    if (prev === undefined || (prev === null && name !== null)) byCode.set(lenderCode, name);
  }
  return [...byCode].map(([code, name]) => ({ code, name }));
}

export function detectLenderDrift(partner: readonly PartnerLender[]): LenderDrift {
  // 빈 입력 = 조회 실패·미확정(fail-open 경로) — 전 금융사가 "사라진" 것처럼 보이는 오탐을 막는다.
  if (partner.length === 0) return { onlyPartner: [], onlyCrm: [], renamed: [] };
  const partnerByCode = new Map(partner.map((l) => [l.code, l.name] as const));
  const crmByCode = new Map(SOLUTION_LENDERS.map((l) => [l.code as string, l.label as string] as const));
  const renamed: LenderDrift["renamed"] = [];
  for (const [code, crmLabel] of crmByCode) {
    const partnerName = partnerByCode.get(code);
    // undefined = 그 코드가 파트너에 아예 없음(onlyCrm이 잡는다) / null = lenderName 미탑재(판정 보류).
    if (partnerName == null) continue;
    if (partnerName !== crmLabel) renamed.push({ code, partner: partnerName, crm: crmLabel });
  }
  return {
    onlyPartner: [...partnerByCode.keys()].filter((code) => !crmByCode.has(code)).sort(), // 파트너에 새로 생김 → 우리가 못 고름(기능 누락)
    onlyCrm: [...crmByCode.keys()].filter((code) => !partnerByCode.has(code)).sort(), // 파트너에서 사라짐 → 고를 수 있는데 계산이 거부됨
    renamed: renamed.sort((a, b) => a.code.localeCompare(b.code)), // 개명 → 계산은 되는데 화면 표시명만 낡음
  };
}

export function hasLenderDrift(drift: LenderDrift): boolean {
  return drift.onlyPartner.length > 0 || drift.onlyCrm.length > 0 || drift.renamed.length > 0;
}

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
  // 취득원가 7필드(acquisitionTax*·publicBond·deliveryFee·miscFee)는 2026-07-30 실동작화부터 워크벤치
  // 빌더도 만든다(계산기 payload 미러 — spec 2026-07-30-crm-workbench-acquisition-cost D3). 나머지
  // (affiliateType·releaseMethod·정비등급·보험 등)는 여전히 계산기 전용.
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
  // trimName·canonicalName·name은 파트너 modelName 해석 재료(아래 buildSolutionQuoteInput 주석 참조).
  vehicle: {
    brand: string | null;
    model: string | null;
    trimName: string | null;
    canonicalName: string | null;
    // catalog.trims.name — trim_name과 달리 notNull이라 계산기(build-payload)의 최종 tier다.
    name: string | null;
    mcCode: string | null;
  };
  pricing: {
    baseAndOption: number;
    discount: number;
    // 취득원가(2026-07-30 실동작화 spec D3) — 금액은 가격 패널 값, 플래그는 토글 상태.
    acquisitionTax: number;
    bond: number;
    bondIncluded: boolean;
    delivery: number;
    deliveryIncluded: boolean;
    incidental: number;
    incidentalIncluded: boolean;
  };
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
    // modelName 해석 = canonicalName ?? trimName ?? trim.name ?? model — 계산기(build-payload.ts)와
    // **같은 체인**이다(뒤 두 tier까지 일치시켜야 두 빌더가 갈리지 않는다: trim_name은 nullable이고
    // name은 notNull이라, 두 이름이 다 NULL인 행에서 계산기는 name을, 워크벤치는 맨 모델명을 보냈다).
    // model 최종 폴백은 트림 미조회 상태(저장 견적 prefill 등)의 기존 동작 유지.
    //
    // ⚠️ 파트너 동작(2026-08-07 `dolim-solution` `routes/quote-core.ts` 실측 — 구 주석 정정):
    // masterMcCode가 offering에 링크되면 파트너가 그 offering의 (브랜드, 모델명)으로 **치환**하고,
    // 링크가 없으면 **폴백 매칭 없이 즉시 400 "미취급 차종"**이다(소스 주석 `vehicle_key 휴리스틱
    // fallback 차단`). 구 주석이 근거로 든 "(brand, modelName) prefix 폴백 매칭"은 CRM이 호출하지
    // 않는 cheapest 엔드포인트 소속이라 이 경로엔 없다 — 즉 canonical은 오매칭을 막는 안전장치가
    // **아니고**, 그 없는 근거로 mcCode 없는 경로를 열면 그쪽에서 진짜 휴리스틱 임의 매칭을 만난다.
    // 서버 zod가 masterMcCode를 min(1)로 강제하는 지금 이 체인의 실효는 두 빌더 일치 자체다.
    modelName:
      args.vehicle.canonicalName ?? args.vehicle.trimName ?? args.vehicle.name ?? args.vehicle.model,
    masterMcCode: args.vehicle.mcCode,
    ownershipType: "company",
    leaseTermMonths: args.termMonths,
    annualMileageKm: mileage,
    depositAmount,
    upfrontPayment,
    quotedVehiclePrice: args.pricing.baseAndOption,
    cmFeeRate: cmFeePct / 100,
    agFeeRate: agFeePct / 100,
    // 취득원가 3종(spec D3) — include 플래그는 상시 전송, 금액은 포함일 때만(계산기 buildScenarioPayload
    // :includePublicBondCost 블록 미러 — 불포함 금액을 실으면 파트너가 합산할 여지가 생긴다).
    includePublicBondCost: args.pricing.bondIncluded,
    publicBondCost: args.pricing.bondIncluded ? args.pricing.bond : undefined,
    includeDeliveryFeeAmount: args.pricing.deliveryIncluded,
    deliveryFeeAmount: args.pricing.deliveryIncluded ? args.pricing.delivery : undefined,
    includeMiscFeeAmount: args.pricing.incidentalIncluded,
    miscFeeAmount: args.pricing.incidentalIncluded ? args.pricing.incidental : undefined,
  };
  // 취득세: 화면 금액 >0일 때만 override(계산기는 자동 공식이 항상 채우지만 워크벤치는 자동 공식이 없어
  // 0이 흔하다 — 0 override는 엔진 자동 계산을 0으로 덮어 월납입 과소, spec D3 가드).
  if (args.pricing.acquisitionTax > 0) {
    input.acquisitionTaxMode = "amount";
    input.acquisitionTaxAmountOverride = args.pricing.acquisitionTax;
  }
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

// ── 파트너 차량가 대조(2026-07-27 iM 오배정 사고) ───────────────────────────────
//
// 파트너는 우리가 보낸 `masterMcCode`를 자기 offering에 링크해 계산한다. 그 링크가 **사람이 손으로**
// 걸려 있어서(제프 회신: `match_source = "manual"`), 엉뚱한 트림에 연결돼 있으면 **다른 차로 계산된
// 견적이 에러 없이 성공 응답으로 돌아온다.** 실사고: 520i M Spt(74,300,000)를 보냈는데 기본
// 520i(69,800,000) offering에 링크돼 있어 차량가·월납입·잔가가 전부 그 값 기준으로 나왔고,
// 그대로 고객에게 발송됐다(QT-2607-0012). 응답만 보면 정상이라 사람 눈으로는 안 잡힌다.
//
// ⚠️ 보는 축은 **`majorInputs.vehiclePrice`(파트너가 실제 계산에 쓴 값)**다.
// `resolvedVehicle.vehiclePrice`(링크된 offering의 카탈로그 가격)를 보면 **오탐이 난다** — 제프 회신 ③:
// 산은은 마스터↔offering 가격 체계가 애초에 달라 불일치 8건이 **정상**이고(대안 offering이 없어 재배정
// 대상도 아니다), 산은 엔진은 `quotedVehiclePrice`를 우선하므로 **그 불일치가 견적가에 영향을 주지
// 않는다.** 카탈로그가로 대조하면 산은 i5·iX1 견적마다 헛경고가 뜬다.
//
// 실제 계산 입력을 보면 금융사 제한이 필요 없다 — "우리가 보낸 가격으로 계산했는가"는 8사 모두에게
// 의미가 같다. 제프 표에 따르면 MG·하나·농협·산은·메리츠는 `quotedVehiclePrice` 우선, BNK·신한은
// 필수, **iM만 카탈로그가만 사용**한다(그래서 지금은 iM만 어긋난다).
//
// 제프 조치 B 완료(2026-07-29 실측)로 이 축은 예고대로 조용해졌다 — 8사 전부 요청가로 계산한다.
// 그래도 **축은 남긴다**: "우리가 보낸 가격으로 계산했는가"는 미래 회귀(새 금융사·엔진 개정)에도
// 같은 질문이고, 판정이 순수라 유지 비용이 0이다. 링크 오배정은 이제 이 축으로는 안 잡히고
// 아래 detectLinkPriceMismatch(requestedPrice ≠ catalogPrice — 제프 조치 D)가 유일 검출축이다.

export type VehiclePriceMismatch = {
  sentPrice: number;
  usedPrice: number; // 파트너가 실제 계산에 쓴 차량가
  resolvedModelName: string | null; // 링크된 offering 이름(있으면 경고 문구에 실어 원인 파악을 돕는다)
};

// 파트너가 우리가 보낸 차량가로 계산했는지 판정. 어긋나면 상세, 아니면 null.
// fail-open: 필드가 없거나 값이 비정상이면 null(견적 작성을 막지 않는다).
export function detectVehiclePriceMismatch(raw: unknown, quotedVehiclePrice: number): VehiclePriceMismatch | null {
  if (!(quotedVehiclePrice > 0)) return null;
  if (typeof raw !== "object" || raw === null) return null;
  const quote = (raw as { quote?: unknown }).quote;
  if (typeof quote !== "object" || quote === null) return null;
  const q = quote as { majorInputs?: unknown; resolvedVehicle?: unknown };
  if (typeof q.majorInputs !== "object" || q.majorInputs === null) return null;
  const usedPrice = numOrNull((q.majorInputs as { vehiclePrice?: unknown }).vehiclePrice);
  if (usedPrice == null || usedPrice <= 0) return null;
  if (usedPrice === quotedVehiclePrice) return null;
  const resolvedName =
    typeof q.resolvedVehicle === "object" && q.resolvedVehicle !== null
      ? (q.resolvedVehicle as { modelName?: unknown }).modelName
      : undefined;
  return {
    sentPrice: quotedVehiclePrice,
    usedPrice,
    resolvedModelName: typeof resolvedName === "string" ? resolvedName : null,
  };
}

// 상담사에게 띄울 한 줄. 파트너 warnings와 같은 토스트 라인에 실린다.
export function vehiclePriceMismatchMessage(m: VehiclePriceMismatch): string {
  const vehicle = m.resolvedModelName ? ` (${m.resolvedModelName})` : "";
  return `⚠️ 금융사가 다른 차량가로 계산했습니다 — 보낸 ${formatMoney(m.sentPrice)}원 ↔ 적용 ${formatMoney(m.usedPrice)}원${vehicle}. 발송 전 확인이 필요합니다.`;
}

// ── 링크 오배정 검출축 2종(2026-07-29 — 제프 B·D 배포 후속) ─────────────────────
//
// B 이후 8사 전부 요청가로 계산하므로 위 축(majorInputs 대조)은 링크 오배정을 못 잡는다 —
// "링크가 엉뚱한 트림을 가리키는데 가격만 우리 값으로 덮인" 상태가 되기 때문. 제프가 그래서
// D로 검출 필드를 실었다(`ref/2026-07-29-jeff-im-capital-bdf-shipped-reply.md`):
//   `requestedPrice`(요청가 에코) · `catalogPrice`(그 금융사의 **계산 기준가** — 정가 아님,
//   iM 탄력세율 보정 때문) · `linkedOfferingCount`(링크 2건 이상일 때만).
// ⚠️ `priceSource`는 판정에 쓰지 않는다 — B 이후 항상 "request"라 판별력이 없다(제프 명시).
// ⚠️ 산은 known-mismatch 8건(조치 F)은 `catalogPrice` 자체가 안 실린다 — 그래서 이 축은
// 산은 헛경고 없이 켤 수 있다(fail-open이 곧 F 수용).

const resolvedVehicleOf = (raw: unknown): Record<string, unknown> | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const quote = (raw as { quote?: unknown }).quote;
  if (typeof quote !== "object" || quote === null) return null;
  const rv = (quote as { resolvedVehicle?: unknown }).resolvedVehicle;
  return typeof rv === "object" && rv !== null ? (rv as Record<string, unknown>) : null;
};

export type LinkPriceMismatch = {
  requestedPrice: number;
  catalogPrice: number; // 금융사의 계산 기준가(정가 아님 — 위 블록 주석)
  resolvedModelName: string | null;
};

// 요청가 ↔ 금융사 계산 기준가 대조 — 어긋나면 링크가 다른 트림을 가리킬 가능성.
// 실측 사례(2026-07-29): 메리츠 MC070526006이 520d(디젤)로 resolve — 74.3M ↔ 73.0M로 잡힌다.
// fail-open: 두 필드 중 하나라도 없으면 null(구 응답·산은 F·미배포 경로에서 견적을 막지 않는다).
export function detectLinkPriceMismatch(raw: unknown): LinkPriceMismatch | null {
  const rv = resolvedVehicleOf(raw);
  if (!rv) return null;
  const requestedPrice = numOrNull(rv.requestedPrice);
  const catalogPrice = numOrNull(rv.catalogPrice);
  if (requestedPrice == null || catalogPrice == null) return null;
  if (requestedPrice === catalogPrice) return null;
  return {
    requestedPrice,
    catalogPrice,
    resolvedModelName: typeof rv.modelName === "string" ? rv.modelName : null,
  };
}

export function linkPriceMismatchMessage(m: LinkPriceMismatch): string {
  const vehicle = m.resolvedModelName ? ` (${m.resolvedModelName})` : "";
  return `⚠️ 금융사 링크가 다른 트림을 가리킬 수 있습니다 — 보낸 차량가 ${formatMoney(m.requestedPrice)}원 ↔ 금융사 기준가 ${formatMoney(m.catalogPrice)}원${vehicle}. 트림 확인이 필요합니다.`;
}

export type MultiLinkResolve = {
  linkedOfferingCount: number;
  resolvedModelName: string | null;
};

// 다중매칭 신호 — 필드가 실려 있으면 그 트림은 금융사 쪽 후보 여러 개 중 **임의로 뽑힌 것**이다
// (뽑히는 행마다 잔가·금리가 갈린다 — 제프 C 거부 게이트 전까지의 가시성). 링크 1건이면 파트너가
// 필드 자체를 생략하므로 부재 = 정상. 1 이하·비수치는 스펙 밖 — fail-open.
export function detectMultiLinkResolve(raw: unknown): MultiLinkResolve | null {
  const rv = resolvedVehicleOf(raw);
  if (!rv) return null;
  const count = numOrNull(rv.linkedOfferingCount);
  if (count == null || count < 2) return null;
  return {
    linkedOfferingCount: count,
    resolvedModelName: typeof rv.modelName === "string" ? rv.modelName : null,
  };
}

export function multiLinkResolveMessage(m: MultiLinkResolve): string {
  const vehicle = m.resolvedModelName ? ` — ${m.resolvedModelName}(으)로 계산됨` : "";
  return `⚠️ 금융사에 이 트림의 후보가 ${m.linkedOfferingCount}개 링크돼 있어 그중 하나로 계산됐습니다${vehicle}. 모델명 확인이 필요합니다.`;
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
