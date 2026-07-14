# CRM 솔루션 조회 계산엔진 통합 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적 워크벤치 비교카드의 계산기 버튼(솔루션 조회)을 파트너(financial-dolim-solution) 견적 계산 API 실호출로 배선한다 — 월 납입금·금리·잔가를 채우고, 재현성 스냅샷·raw 응답을 시나리오에 영속한다.

**Architecture:** B안(클라 조립 + 서버 인증 릴레이). 클라 순수 매퍼(`client/src/lib/solution-quote.ts`)가 카드 조건을 파트너 `CanonicalQuoteInput` 서브셋으로 변환 → CRM 서버 `POST /api/solution/calculate`가 zod 검증 + `X-API-Key`/`X-Request-ID` 부착 릴레이 → 응답을 카드 uncontrolled input에 채움 → 저장 시 기존 시나리오 경로에 스냅샷 4필드 동봉(마이그 0031).

**Tech Stack:** 기존 스택 그대로 — Hono(서버 라우트)·zod·drizzle(마이그)·vitest(클라 유닛)·bun:test(서버). 신규 의존성 0.

**계약 SSOT:** `ref/specs/2026-07-14-crm-solution-quote-integration-design.md` — 매핑 표·에러 표·제프 전달 목록은 스펙이 원본. 이 계획과 어긋나면 스펙이 이긴다.

**공통 함정(작업 전 필독):**
- 서버 테스트는 반드시 `bun run test:server [파일]` — 직접 `bun test <파일>` 금지(EMBED_ON_WRITE 게이트 3규칙)
- `db:push` 금지 — `bun run db:generate` → `bun run db:migrate`만(schemaFilter crm)
- Workers에서 `deps.fetchImpl(...)` 메서드 호출 금지 — 지역 변수로 뽑아 plain call(Illegal invocation, PR #202)
- 견적 스모크 잔재는 psql 직접 삭제 금지(임베딩 고아) — UI/API 삭제 경로로 원복

---

## Task 1: 클라 순수 lib `solution-quote.ts` — 어휘 SSOT·매퍼·파서 (TDD)

**Files:**
- Create: `client/src/lib/solution-quote.ts`
- Test: `client/src/lib/solution-quote.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// client/src/lib/solution-quote.test.ts
import { describe, expect, test } from "vitest";

import {
  SOLUTION_LENDERS,
  buildSolutionQuoteInput,
  parseSolutionQuoteResult,
  solutionDisplayRatePct,
  solutionLenderOptions,
  solutionProductTypeOf,
} from "./solution-quote";

const BASE_ARGS = {
  lenderLabel: "신한카드",
  purchaseMethod: "운용리스",
  termMonths: 60,
  depositMode: "none" as const,
  depositRaw: "",
  downPaymentMode: "none" as const,
  downPaymentRaw: "",
  residualMode: "max" as const,
  residualRaw: "",
  mileageValue: "20,000km / 년",
  subsidyApplicable: false,
  subsidyRaw: "",
  vehicle: { brand: "BMW", model: "3 Series", mcCode: "MC-TEST-001" },
  pricing: { baseAndOption: 59_000_000, discount: 6_500_000 },
};

describe("어휘 SSOT", () => {
  test("운용리스 = 8사, 장기렌트 = 3사(MG·메리츠·iM), 그 외 = 빈 배열", () => {
    expect(solutionLenderOptions("운용리스")).toHaveLength(8);
    expect(solutionLenderOptions("장기렌트").map((l) => l.code)).toEqual([
      "mg-capital", "meritz-capital", "im-capital",
    ]);
    expect(solutionLenderOptions("할부")).toEqual([]);
  });

  test("productType 매핑: 운용리스/장기렌트만, 그 외 null", () => {
    expect(solutionProductTypeOf("운용리스")).toBe("operating_lease");
    expect(solutionProductTypeOf("장기렌트")).toBe("long_term_rental");
    expect(solutionProductTypeOf("할부")).toBeNull();
    expect(solutionProductTypeOf("일시불")).toBeNull();
  });
});

describe("buildSolutionQuoteInput", () => {
  test("기본 케이스(없음·최대·기본거리): 0원·high·20000km, ownershipType company 고정", () => {
    const r = buildSolutionQuoteInput(BASE_ARGS);
    if (!r.ok) throw new Error(r.reason);
    expect(r.input).toEqual({
      lenderCode: "shinhan-card",
      productType: "operating_lease",
      brand: "BMW",
      modelName: "3 Series",
      masterMcCode: "MC-TEST-001",
      ownershipType: "company",
      leaseTermMonths: 60,
      annualMileageKm: 20000,
      depositAmount: 0,
      upfrontPayment: 0,
      quotedVehiclePrice: 59_000_000,
      discountAmount: 6_500_000,
      residualMode: "high",
    });
  });

  test("% 모드는 할인 전 차량가 기준 원 환산(반올림)", () => {
    const r = buildSolutionQuoteInput({
      ...BASE_ARGS,
      depositMode: "percent", depositRaw: "10",
      downPaymentMode: "amount", downPaymentRaw: "1,180,000",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.depositAmount).toBe(5_900_000); // 59,000,000의 10%
    expect(r.input.upfrontPayment).toBe(1_180_000); // 콤마 파싱
  });

  test("잔존 3모드: 최대=high / %=standard+ratio(분율) / 금액=standard+amountOverride", () => {
    const pct = buildSolutionQuoteInput({ ...BASE_ARGS, residualMode: "percent", residualRaw: "45" });
    if (!pct.ok) throw new Error(pct.reason);
    expect(pct.input.residualMode).toBe("standard");
    expect(pct.input.residualValueRatio).toBeCloseTo(0.45);
    expect(pct.input.residualAmountOverride).toBeUndefined();

    const amt = buildSolutionQuoteInput({ ...BASE_ARGS, residualMode: "amount", residualRaw: "30,000,000" });
    if (!amt.ok) throw new Error(amt.reason);
    expect(amt.input.residualMode).toBe("standard");
    expect(amt.input.residualAmountOverride).toBe(30_000_000);
  });

  test("보조금 해당 시 evSubsidyAmount, 비해당 시 미전송", () => {
    const on = buildSolutionQuoteInput({ ...BASE_ARGS, subsidyApplicable: true, subsidyRaw: "5,700,000" });
    if (!on.ok) throw new Error(on.reason);
    expect(on.input.evSubsidyAmount).toBe(5_700_000);
    const off = buildSolutionQuoteInput(BASE_ARGS);
    if (!off.ok) throw new Error(off.reason);
    expect(off.input.evSubsidyAmount).toBeUndefined();
  });

  test("실패 사유: 금융사 미선택/미지원 어휘/차량 미선택/mcCode 부재/약정거리 이탈", () => {
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, lenderLabel: "미선택" }).ok).toBe(false);
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, lenderLabel: "하나캐피탈" }).ok).toBe(false); // 구 어휘
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, vehicle: { brand: null, model: null, mcCode: null } }).ok).toBe(false);
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, vehicle: { ...BASE_ARGS.vehicle, mcCode: null } }).ok).toBe(false);
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, mileageValue: "13,000km / 년" }).ok).toBe(false);
  });

  test("장기렌트 × 운용리스 전용 금융사(신한카드) = 실패(미취급 선차단)", () => {
    const r = buildSolutionQuoteInput({ ...BASE_ARGS, purchaseMethod: "장기렌트" });
    expect(r.ok).toBe(false);
  });
});

describe("parseSolutionQuoteResult", () => {
  const RAW = {
    ok: true,
    quote: {
      lenderCode: "shinhan-card",
      workbookImport: { id: "w1", versionLabel: "2607" },
      monthlyPayment: 1_750_000,
      rates: { annualRateDecimal: 0.0532, effectiveAnnualRateDecimal: 0.0561, monthlyRateDecimal: 0.0044 },
      residual: { rateDecimal: 0.45, amount: 26_550_000, source: "residual-matrix", matrixGroup: null },
      warnings: ["잔가 후보 2개 중 최대값 적용"],
    },
  };

  test("정상 응답: 필수 필드 + 확장 3필드 optional(null)", () => {
    const p = parseSolutionQuoteResult(RAW);
    if (!p) throw new Error("parse 실패");
    expect(p.monthlyPayment).toBe(1_750_000);
    expect(p.annualRatePct).toBeCloseTo(5.32);
    expect(p.effectiveAnnualRatePct).toBeCloseTo(5.61);
    expect(p.residualAmount).toBe(26_550_000);
    expect(p.workbookVersion).toBe("2607");
    expect(p.warnings).toEqual(["잔가 후보 2개 중 최대값 적용"]);
    expect(p.totalReturnCost).toBeNull(); // 제프 확장 전 — 파생 조립 금지(스펙 결정 3)
    expect(p.totalTakeoverCost).toBeNull();
    expect(p.dueAtDelivery).toBeNull();
  });

  test("확장 3필드가 오면 그대로 노출(제프 응답 확장 선반영)", () => {
    const p = parseSolutionQuoteResult({
      ...RAW,
      quote: { ...RAW.quote, totalReturnCost: 110_000_000, totalTakeoverCost: 140_000_000, dueAtDelivery: 15_000_000 },
    });
    if (!p) throw new Error("parse 실패");
    expect(p.totalReturnCost).toBe(110_000_000);
    expect(p.totalTakeoverCost).toBe(140_000_000);
    expect(p.dueAtDelivery).toBe(15_000_000);
  });

  test("필수 누락(monthlyPayment 없음/ok:false/비객체)은 null", () => {
    expect(parseSolutionQuoteResult({ ok: false, error: "미취급" })).toBeNull();
    expect(parseSolutionQuoteResult({ ok: true, quote: { rates: {} } })).toBeNull();
    expect(parseSolutionQuoteResult("garbage")).toBeNull();
  });

  test("금리 표시: 우리카드만 유효금리, 그 외 표면금리(제프 QuoteResultCard 규칙 미러)", () => {
    const p = parseSolutionQuoteResult(RAW);
    if (!p) throw new Error("parse 실패");
    expect(solutionDisplayRatePct("woori-card", p)).toBeCloseTo(5.61);
    expect(solutionDisplayRatePct("shinhan-card", p)).toBeCloseTo(5.32);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test:unit client/src/lib/solution-quote.test.ts` → Expected: FAIL(모듈 없음)

- [ ] **Step 3: 구현**

```ts
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
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test:unit client/src/lib/solution-quote.test.ts` → Expected: PASS(전 케이스)

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/solution-quote.ts client/src/lib/solution-quote.test.ts
git commit -m "feat(crm): 솔루션 조회 순수 계층 — 파트너 계약 어휘 SSOT·입력 매퍼·응답 파서 (TDD)"
```

---

## Task 2: vehicles API에 mcCode 노출

**Files:**
- Modify: `src/db/queries/vehicles.ts` (`getTrimsByModel`·`getTrimDetail` select에 1줄씩)
- Modify: `client/src/lib/vehicles.ts` (`Trim`·`TrimDetail` 타입)
- Test: `src/routes/vehicles.test.ts` (기존 파일 확장)

- [ ] **Step 1: 실패하는 테스트 추가** — `src/routes/vehicles.test.ts`의 기존 트림 목록 테스트 곁에:

```ts
test("트림 목록·상세에 mcCode 필드가 실린다(솔루션 조회 masterMcCode 소스)", async () => {
  // 기존 테스트가 쓰는 브랜드→모델→트림 체인 픽스처/실 catalog 조회 패턴을 그대로 재사용한다.
  // (이 파일 상단의 기존 GET 헬퍼·auth 토큰 사용 — 새 픽스처 생성 없음, read-only)
  const trims = await getJson(`/api/vehicles/models/${MODEL_ID}/trims`); // 기존 테스트의 조회 관례 변수
  expect(trims.length).toBeGreaterThan(0);
  expect(Object.keys(trims[0])).toContain("mcCode");
});
```

주의: 위 코드는 기존 파일의 조회 관례(헬퍼 이름·MODEL_ID 확보 방식)에 맞춰 이식한다 — 파일을 먼저 읽고
같은 패턴으로 작성. 단언의 핵심은 **키 존재**(값은 트림별로 null 가능).

- [ ] **Step 2: 실패 확인** — Run: `bun run test:server src/routes/vehicles.test.ts` → Expected: 신규 테스트 FAIL(키 없음)

- [ ] **Step 3: 구현** — `src/db/queries/vehicles.ts` `getTrimsByModel`의 select 객체에 `mcCode: trimsInCatalog.mcCode,` 추가. `getTrimDetail`(line ~73)의 select에도 동일 추가. `client/src/lib/vehicles.ts`의 `Trim` 타입과 `TrimDetail` 타입에 `mcCode: string | null;` 추가.

- [ ] **Step 4: 통과 확인** — Run: `bun run test:server src/routes/vehicles.test.ts` → PASS, `bun run typecheck` → 0

- [ ] **Step 5: 커밋**

```bash
git add src/db/queries/vehicles.ts client/src/lib/vehicles.ts src/routes/vehicles.test.ts
git commit -m "feat(crm): 차량 트림 조회에 mcCode 노출 — 솔루션 조회 masterMcCode 소스"
```

---

## Task 3: 서버 인증 릴레이 `POST /api/solution/calculate`

**Files:**
- Create: `src/routes/solution.ts`
- Modify: `src/app.ts` (protect + route 등록 2줄)
- Modify: `.env.example` (자리 2줄)
- Test: `src/routes/solution.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/routes/solution.test.ts
import { afterAll, beforeAll, expect, test } from "bun:test";

import { makeTestAuth } from "../auth/test-jwt";
import { solutionDeps } from "./solution";
// 앱 조립·auth 주입(buildAppWithTestAuth)은 src/routes/vehicles.test.ts의 관례를 파일을 읽고 그대로
// 이식한다 — 그쪽 시그니처가 정답(이 파일 로컬 헬퍼로 정의). 아래 스니펫은 그 헬퍼를 전제로 한다.

// ── 테스트 픽스처: 유효 입력(파트너 계약 서브셋) ──
const VALID_BODY = {
  lenderCode: "shinhan-card",
  productType: "operating_lease",
  brand: "BMW",
  modelName: "3 Series",
  masterMcCode: "MC-TEST-001",
  ownershipType: "company",
  leaseTermMonths: 60,
  annualMileageKm: 20000,
  depositAmount: 0,
  upfrontPayment: 0,
  quotedVehiclePrice: 59_000_000,
};

let token = "";
const origFetch = solutionDeps.fetchImpl;
const ENV_KEYS = ["SOLUTION_QUOTE_API_URL", "SOLUTION_QUOTE_API_KEY"] as const;
const origEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  const auth = await makeTestAuth("staff");
  token = auth.token; // buildApp에 keyResolver/issuer 주입 — vehicles.test.ts와 동일 배선
  for (const k of ENV_KEYS) origEnv[k] = process.env[k];
});
afterAll(() => {
  solutionDeps.fetchImpl = origFetch;
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
});

const post = (app: ReturnType<typeof buildApp>, body: unknown) =>
  app.request("/api/solution/calculate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("env 미설정 → 503 명시 에러(fail-loud)", async () => {
  delete process.env.SOLUTION_QUOTE_API_URL;
  const app = buildAppWithTestAuth(); // 파일 내 헬퍼 — vehicles.test.ts 관례로 조립
  const res = await post(app, VALID_BODY);
  expect(res.status).toBe(503);
  expect(((await res.json()) as { error: string }).error).toContain("설정");
});

test("zod 위반(음수 금액·미지원 lenderCode) → 400", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  const app = buildAppWithTestAuth();
  expect((await post(app, { ...VALID_BODY, depositAmount: -1 })).status).toBe(400);
  expect((await post(app, { ...VALID_BODY, lenderCode: "hana-capital" })).status).toBe(400);
});

test("성공 릴레이: 파트너 body 패스스루 + X-Request-ID(crm- 접두) + 키 설정 시 X-API-Key 부착", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  process.env.SOLUTION_QUOTE_API_KEY = "test-key-123";
  let captured: { url: string; headers: Record<string, string>; body: unknown } | null = null;
  solutionDeps.fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = {
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    };
    return new Response(JSON.stringify({ ok: true, quote: { monthlyPayment: 1 } }), { status: 200 });
  }) as typeof fetch;
  const app = buildAppWithTestAuth();
  const res = await post(app, VALID_BODY);
  expect(res.status).toBe(200);
  expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  expect(captured!.url).toBe("https://partner.test/calc");
  expect(captured!.headers["x-api-key"]).toBe("test-key-123");
  expect(captured!.headers["x-request-id"]).toMatch(/^crm-[0-9a-f-]{36}$/);
  expect((captured!.body as { lenderCode: string }).lenderCode).toBe("shinhan-card");
});

test("키 미설정이면 X-API-Key 생략(개발 무인증 단계) — 호출은 진행", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  delete process.env.SOLUTION_QUOTE_API_KEY;
  let headers: Record<string, string> = {};
  solutionDeps.fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Response(JSON.stringify({ ok: true, quote: {} }), { status: 200 });
  }) as typeof fetch;
  const app = buildAppWithTestAuth();
  await post(app, VALID_BODY);
  expect(headers["x-api-key"]).toBeUndefined();
});

test("파트너 4xx(미취급) → 400 + error 문구 패스스루", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  solutionDeps.fetchImpl = (async () =>
    new Response(JSON.stringify({ ok: false, error: "미취급 차종" }), { status: 400 })) as typeof fetch;
  const app = buildAppWithTestAuth();
  const res = await post(app, VALID_BODY);
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toContain("미취급");
});

test("네트워크 예외 → 502 / AbortError(타임아웃) → 504", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  solutionDeps.fetchImpl = (async () => { throw new Error("connect refused"); }) as typeof fetch;
  let app = buildAppWithTestAuth();
  expect((await post(app, VALID_BODY)).status).toBe(502);
  solutionDeps.fetchImpl = (async () => {
    const e = new Error("aborted"); e.name = "AbortError"; throw e;
  }) as typeof fetch;
  app = buildAppWithTestAuth();
  expect((await post(app, VALID_BODY)).status).toBe(504);
});

test("fetchImpl은 plain call로 호출된다(this 미결합 — Workers Illegal invocation 가드)", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  solutionDeps.fetchImpl = (async function (this: unknown) {
    expect(this).toBeUndefined(); // 메서드 호출이면 this=solutionDeps → 실패
    return new Response(JSON.stringify({ ok: true, quote: {} }), { status: 200 });
  }) as typeof fetch;
  const app = buildAppWithTestAuth();
  await post(app, VALID_BODY);
});
```

주의: `buildAppWithTestAuth` 조립·auth 주입은 **기존 `src/routes/vehicles.test.ts`의 관례를 파일을 읽고
그대로 이식**한다(앱 생성 시그니처가 다르면 그쪽이 정답). dealer 403은 전역 dealerWriteGate 기존 테스트가
커버하므로 여기서 중복하지 않는다.

- [ ] **Step 2: 실패 확인** — Run: `bun run test:server src/routes/solution.test.ts` → Expected: FAIL(라우트 없음)

- [ ] **Step 3: 구현**

```ts
// src/routes/solution.ts
// 파트너(financial-dolim-solution) 견적 계산 API 인증 릴레이 — 스펙 §구성 2.
// 매핑·조립은 클라(solution-quote.ts) 몫(B안), 여기는 zod 게이트 + 키/추적 헤더 + 타임아웃만.
import { Hono } from "hono";
import { z } from "zod";

import type { AuthVariables } from "../auth/verify";
import type { DbVariables } from "../middleware/db";

// 파트너 계약 서브셋 검증 — 어휘는 client/src/lib/solution-quote.ts(SSOT)와 값 일치(파리티는 Task 1 유닛이 잠금).
const LENDER_CODES = ["mg-capital", "bnk-capital", "woori-card", "meritz-capital", "shinhan-card", "kdbc-capital", "im-capital", "nh-capital"] as const;
const solutionCalcBody = z.object({
  lenderCode: z.enum(LENDER_CODES),
  productType: z.enum(["operating_lease", "long_term_rental"]),
  brand: z.string().min(1),
  modelName: z.string().min(1),
  masterMcCode: z.string().min(1),
  ownershipType: z.literal("company"),
  leaseTermMonths: z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(48), z.literal(60)]),
  annualMileageKm: z.union([z.literal(10000), z.literal(15000), z.literal(20000), z.literal(25000), z.literal(30000), z.literal(35000), z.literal(40000)]),
  depositAmount: z.number().int().min(0),
  upfrontPayment: z.number().int().min(0),
  quotedVehiclePrice: z.number().int().min(1),
  discountAmount: z.number().int().min(0).optional(),
  evSubsidyAmount: z.number().int().min(0).optional(),
  residualMode: z.enum(["high", "standard"]).optional(),
  residualValueRatio: z.number().min(0).max(1).optional(),
  residualAmountOverride: z.number().int().min(0).optional(),
});

// 테스트 주입 seam. ⚠️ 호출은 반드시 지역 변수 plain call — deps.fetchImpl(...)는 Workers에서
// this=deps가 되어 Illegal invocation(배정 알림 두 달 무발송 사고, PR #202).
export const solutionDeps = { fetchImpl: fetch as typeof fetch };

const TIMEOUT_MS = 8000; // 앱 partner_quote.ts 미러

export const solution = new Hono<{ Variables: AuthVariables & DbVariables }>();

solution.post("/calculate", async (c) => {
  const env = (c.env ?? {}) as { SOLUTION_QUOTE_API_URL?: string; SOLUTION_QUOTE_API_KEY?: string };
  const url = env.SOLUTION_QUOTE_API_URL ?? process.env.SOLUTION_QUOTE_API_URL;
  const apiKey = env.SOLUTION_QUOTE_API_KEY ?? process.env.SOLUTION_QUOTE_API_KEY;
  if (!url) return c.json({ error: "솔루션 연결이 설정되지 않았습니다(SOLUTION_QUOTE_API_URL)" }, 503);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "요청 본문이 JSON이 아닙니다" }, 400);
  }
  const parsed = solutionCalcBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "계산 입력이 유효하지 않습니다" }, 400);

  const requestId = `crm-${crypto.randomUUID()}`;
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Request-ID": requestId };
  if (apiKey) headers["X-API-Key"] = apiKey; // 미설정 = 개발 무인증 단계(external 전환 시 필수)

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  const fetchImpl = solutionDeps.fetchImpl; // plain call 보장
  try {
    const upstream = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(parsed.data),
      signal: controller.signal,
    });
    const body: unknown = await upstream.json().catch(() => null);
    const ms = Date.now() - startedAt;
    console.log(`[solution] calculate lender=${parsed.data.lenderCode} product=${parsed.data.productType} status=${upstream.status} ${ms}ms request_id=${requestId}`);
    if (!upstream.ok) {
      const msg = (body as { error?: unknown } | null)?.error;
      // 파트너 4xx(미취급 등)는 사유 패스스루 400, 5xx는 502로 구분(호출자 잘못 아님)
      const status = upstream.status >= 500 ? 502 : 400;
      return c.json({ error: typeof msg === "string" ? msg : "계산에 실패했습니다" }, status);
    }
    return c.json(body ?? { error: "빈 응답" });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.error(`[solution] calculate ${aborted ? "TIMEOUT" : "NETWORK_FAIL"} request_id=${requestId}`, e);
    if (aborted) return c.json({ error: "계산 서버가 응답하지 않습니다(시간 초과)" }, 504);
    return c.json({ error: "계산 서버에 연결하지 못했습니다" }, 502);
  } finally {
    clearTimeout(timer);
  }
});
```

`src/app.ts`: import 후 기존 protect 블록·route 블록에 각 1줄 —

```ts
protect("/api/solution/*");
app.route("/api/solution", solution);
```

`.env.example` 끝에 추가:

```bash
# 솔루션 견적 계산(파트너 financial-dolim-solution) 릴레이. 미설정 시 /api/solution/calculate 503.
# 개발: https://mc.mrcha.app/api/quotes/calculate (무인증) / 운영: external 엔드포인트 + 키(제프 협의 후)
SOLUTION_QUOTE_API_URL=
SOLUTION_QUOTE_API_KEY=
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test:server src/routes/solution.test.ts` → PASS · `bun run typecheck` → 0

- [ ] **Step 5: 커밋**

```bash
git add src/routes/solution.ts src/routes/solution.test.ts src/app.ts .env.example
git commit -m "feat(crm): 솔루션 계산 서버 릴레이 — zod 게이트·X-API-Key/X-Request-ID·8s 타임아웃(fail-loud)"
```

---

## Task 4: 마이그 0031 — 시나리오 스냅샷 4컬럼 + 저장 왕복

**Files:**
- Modify: `src/db/schema.ts` (`quoteScenarios`에 4컬럼)
- Create: `drizzle/0031_*.sql` (db:generate 산출)
- Modify: `src/routes/customers.ts` (`quoteScenarioBody`에 4필드)
- Modify: `src/db/queries/customer-quotes.ts` (`insertScenarios` values에 4필드)
- Modify: `client/src/lib/customer-quotes.ts` (`ScenarioInput`에 4필드)
- Test: 기존 견적 시나리오 저장 테스트 파일 확장(`src/routes/customers.test.ts`의 견적 시나리오 왕복 곁)

- [ ] **Step 1: 실패하는 테스트 추가** — 기존 견적 생성(시나리오 포함) 테스트 곁에, 같은 픽스처 관례
  (등록된 `QT-`/`CU-` 접두사·랜덤 서픽스·afterAll 정리)를 그대로 재사용해:

```ts
test("시나리오 솔루션 스냅샷 4필드 왕복(저장→조회)", async () => {
  // 기존 견적 POST 테스트와 동일한 고객·요청 조립에 scenarios[0]에 아래 4필드만 추가:
  const snapshot = {
    solutionLenderCode: "shinhan-card",
    solutionWorkbookVersion: "2607",
    solutionCalculatedAt: "2026-07-14T05:00:00.000Z",
    solutionRaw: { ok: true, quote: { monthlyPayment: 1_750_000 } },
  };
  // POST /api/customers/:id/quotes { ..., scenarios: [{ ...기존 최소 시나리오, ...snapshot }] }
  // → 200 후 GET(또는 기존 테스트의 조회 관례)으로 scenarios[0]에 4필드가 그대로 실려 오는지 단언.
  // solutionRaw는 깊은 동등 비교(jsonb 왕복), solutionCalculatedAt은 ISO 문자열 파싱 가능성만 단언.
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test:server src/routes/customers.test.ts` → 신규 테스트 FAIL

- [ ] **Step 3: 스키마 + 마이그레이션**

`src/db/schema.ts` `quoteScenarios`의 `interestRate` 아래에(jsonb는 파일 상단 drizzle import에 이미 있으면 재사용, 없으면 추가):

```ts
  // 솔루션 조회 재현성 스냅샷(스펙 결정 4·5) — 수기 시나리오는 전부 null.
  // 요율이 매월 갱신되는 도메인이라 "어느 워크북 기준 계산인지"를 남긴다. raw는 앱 partner_raw_response 선례.
  solutionLenderCode: text("solution_lender_code"),
  solutionWorkbookVersion: text("solution_workbook_version"),
  solutionCalculatedAt: timestamp("solution_calculated_at", { withTimezone: true }),
  solutionRaw: jsonb("solution_raw"),
```

```bash
bun run db:generate   # → drizzle/0031_*.sql 생성(ALTER TABLE crm.quote_scenarios ADD COLUMN ×4 확인)
bun run db:migrate    # 실 master 적용 — additive nullable이라 무파괴. 적용 후 psql로 컬럼 존재 확인
```

- [ ] **Step 4: 서버·클라 배선**

`src/routes/customers.ts` `quoteScenarioBody`에:

```ts
  // 솔루션 조회 스냅샷(마이그 0031) — 수기 시나리오는 미전송
  solutionLenderCode: z.string().nullable().optional(),
  solutionWorkbookVersion: z.string().nullable().optional(),
  solutionCalculatedAt: z.iso.datetime().nullable().optional(),
  solutionRaw: z.unknown().nullable().optional(),
```

`src/db/queries/customer-quotes.ts` `insertScenarios` values에:

```ts
      solutionLenderCode: sc.solutionLenderCode ?? null,
      solutionWorkbookVersion: sc.solutionWorkbookVersion ?? null,
      solutionCalculatedAt: sc.solutionCalculatedAt ? new Date(sc.solutionCalculatedAt) : null,
      solutionRaw: sc.solutionRaw ?? null,
```

(`ScenarioInput` 서버 타입이 zod 추론이면 자동, 수동 타입이면 4필드 optional 추가.)

`client/src/lib/customer-quotes.ts` `ScenarioInput`에:

```ts
  solutionLenderCode?: string | null;
  solutionWorkbookVersion?: string | null;
  solutionCalculatedAt?: string | null;
  solutionRaw?: unknown;
```

- [ ] **Step 5: 통과 확인** — Run: `bun run test:server src/routes/customers.test.ts` → PASS · `bun run typecheck` → 0

- [ ] **Step 6: 커밋**

```bash
git add src/db/schema.ts drizzle/ src/routes/customers.ts src/db/queries/customer-quotes.ts client/src/lib/customer-quotes.ts src/routes/customers.test.ts
git commit -m "feat(crm): 마이그 0031 — 시나리오 솔루션 스냅샷 4컬럼(lenderCode·워크북 버전·계산 시각·raw) 왕복"
```

---

## Task 5: 워크벤치 배선 — 금융사 select 교체 + 계산기 실동작

**Files:**
- Modify: `client/src/components/customer-detail/hooks/useQuoteWorkbench.ts`
- Modify: `client/src/components/customer-detail/QuoteWorkbench.tsx` (금융사 select `:445`·계산기 버튼 `:454`)
- Modify: `client/src/lib/customer-quotes.ts` (요청 헬퍼 1개)

이 태스크는 거대 페이지 컴포넌트 배선이라 유닛은 Task 1의 lib 테스트가 담당하고, 동작 검증은
typecheck/lint + Task 6 브라우저 스모크로 한다(프로젝트 관례 — 순수 로직 TDD·페이지는 실기).

- [ ] **Step 1: 클라 요청 헬퍼** — `client/src/lib/customer-quotes.ts`에(기존 `sendJson` import 재사용):

```ts
// 솔루션 계산 릴레이 호출 — 서버가 파트너 error 문구를 {error}로 내려주므로 sendJson의 에러 처리 관례를 따른다.
export async function requestSolutionQuote(input: SolutionQuoteInput): Promise<unknown> {
  return sendJson("/api/solution/calculate", "POST", input);
}
```

(`SolutionQuoteInput`은 `./solution-quote`에서 type import. `sendJson` 시그니처가 다르면 기존 사용례에 맞춘다 —
이 파일의 다른 POST 헬퍼가 정답.)

- [ ] **Step 2: 훅 상태·핸들러** — `useQuoteWorkbench.ts`:

상태 2개(기존 state 블록 곁):

```ts
  // 솔루션 조회: 카드별 in-flight(연타 방지)와 재현성 스냅샷(저장 시 시나리오 동봉 — 마이그 0031).
  const [solutionLoadingId, setSolutionLoadingId] = useState<string | null>(null);
  const [solutionSnapshots, setSolutionSnapshots] = useState<Record<string, SolutionSnapshot>>({});
```

핸들러(`extractWorkbenchScenarios` 곁 — 같은 DOM 접근 관례):

```ts
  // 비교카드 1장의 조건으로 파트너 계산 호출 → 결과를 카드 uncontrolled input에 채운다.
  // 채움 후 handleManualCardFieldEdit()로 미리보기 갱신+dirty 마킹(수동 타이핑과 동일 경로).
  async function queryCardSolution(condId: string) {
    if (solutionLoadingId) return; // 카드 단위가 아니라 전역 1건 — 파트너 서버 보호(스펙 §범위 밖: 자동 재계산 없음)
    const compareForm = quoteDetailFormRef.current;
    const cardEl = compareForm?.querySelector<HTMLElement>(`[data-scenario-card="${condId}"]`);
    if (!cardEl) return;
    const fieldVal = (f: string) => cardEl.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-sc-field="${f}"]`)?.value ?? "";
    const ui = cardUiOf(cardUi, condId);
    const built = buildSolutionQuoteInput({
      lenderLabel: fieldVal("lender") || null,
      purchaseMethod: solutionWorkbenchPurchaseMethod,
      termMonths: ui.termMonths,
      depositMode: ui.depositMode, depositRaw: fieldVal("deposit"),
      downPaymentMode: ui.downPaymentMode, downPaymentRaw: fieldVal("downPayment"),
      residualMode: ui.residualMode, residualRaw: fieldVal("residual"),
      mileageValue: effectiveMileageValue(ui),
      subsidyApplicable: ui.subsidyApplicable, subsidyRaw: fieldVal("subsidy"),
      vehicle: {
        brand: workbenchVehicle?.brand?.name ?? null,
        model: workbenchVehicle?.model?.name ?? null,
        mcCode: workbenchVehicle?.trim?.mcCode ?? null,
      },
      // 할인 전 차량가(base+option) + 할인 총액 — 가격패널 uncontrolled input에서 읽는다(저장 추출과 동일 관례).
      pricing: {
        baseAndOption: parseMoney(compareForm?.querySelector<HTMLInputElement>('input[data-pricing="base"]')?.value ?? "")
          + parseMoney(compareForm?.querySelector<HTMLInputElement>('input[data-pricing="option"]')?.value ?? ""),
        discount: parseMoney(compareForm?.querySelector<HTMLInputElement>('input[data-pricing="discount"]')?.value ?? ""),
      },
    });
    if (!built.ok) { onToast(built.reason); return; }
    setSolutionLoadingId(condId);
    try {
      const raw = await requestSolutionQuote(built.input);
      const parsed = parseSolutionQuoteResult(raw);
      if (!parsed) { onToast("계산 응답을 해석하지 못했습니다"); return; }
      const setField = (f: string, v: string) => {
        const el = cardEl.querySelector<HTMLInputElement>(`input[data-sc-field="${f}"]`);
        if (el) el.value = v;
      };
      setField("monthly", formatMoney(parsed.monthlyPayment));
      setField("interestRate", String(solutionDisplayRatePct(built.input.lenderCode, parsed)));
      if (ui.residualMode === "max") setField("residual", formatMoney(parsed.residualAmount)); // "– 원" → 실채택 잔가 표시
      if (parsed.totalReturnCost != null) setField("totalReturn", formatMoney(parsed.totalReturnCost));
      if (parsed.totalTakeoverCost != null) setField("totalTakeover", formatMoney(parsed.totalTakeoverCost));
      if (parsed.dueAtDelivery != null) setField("dueAtDelivery", formatMoney(parsed.dueAtDelivery));
      setSolutionSnapshots((prev) => ({
        ...prev,
        [condId]: {
          solutionLenderCode: built.input.lenderCode,
          solutionWorkbookVersion: parsed.workbookVersion,
          solutionCalculatedAt: new Date().toISOString(),
          solutionRaw: raw,
        },
      }));
      if (parsed.warnings.length > 0) onToast(parsed.warnings.join(" · "));
      handleManualCardFieldEdit();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "계산에 실패했습니다");
    } finally {
      setSolutionLoadingId(null);
    }
  }
```

import 추가: `buildSolutionQuoteInput, parseSolutionQuoteResult, solutionDisplayRatePct, type SolutionSnapshot`
(from `@/lib/solution-quote`), `requestSolutionQuote`(from `@/lib/customer-quotes`). `parseMoney`·`formatMoney`는
파일 내 기존 import 재사용(없으면 기존 사용처의 출처를 따라 추가).

- [ ] **Step 3: 스냅샷의 저장 동봉·시드·리셋**

1. `extractWorkbenchScenarios()`의 `scenarios.push({ ... })`에 스프레드 1줄:

```ts
        ...(solutionSnapshots[condId] ?? {}),
```

2. **수정 재진입 시드**(무재조회 재저장 시 기존 스냅샷 보존): `openEditQuote`의 `setCardUi(cardUiMapFromScenarios(...))`
   호출 지점(grep `cardUiMapFromScenarios`)에서 함께:

```ts
      setSolutionSnapshots(solutionSnapshotsFromScenarios(detailScenarios, emptyQuoteConditionCards));
```

   `solutionSnapshotsFromScenarios`는 `quote-workbench-meta.ts`에 순수 함수로 신설(+ 유닛 2케이스 —
   스냅샷 있는 시나리오만 카드 id에 매핑 / 없는 시나리오는 생략). `cardUiMapFromScenarios`와 같은
   시나리오→카드 id 대응 규칙을 재사용한다(그 함수 본문이 정답 — scenarioNo↔카드 순서).

3. **리셋**: `clearCardUiState()` 본문(또는 그 호출 3곳과 동일 지점)에 `setSolutionSnapshots({});` 추가 —
   이전 견적의 스냅샷이 새 견적 저장에 유입되는 잔상 차단(#163 잔상 부류).

- [ ] **Step 4: UI — 금융사 select 교체 + 계산기 버튼 배선** (`QuoteWorkbench.tsx`)

`:445` 금융사 select를:

```tsx
<label className="select-value"><span>금융사</span><select data-sc-field="lender" defaultValue={condition.lender} disabled={isConditionSaved}>
  <option>미선택</option>
  {solutionLenderOptions(solutionWorkbenchPurchaseMethod).map((l) => <option key={l.code}>{l.label}</option>)}
  {condition.lender && condition.lender !== "미선택" && !solutionLenderOptions(solutionWorkbenchPurchaseMethod).some((l) => l.label === condition.lender)
    ? <option>{condition.lender}</option> /* 구 어휘 저장 견적 표시 유지(스펙 결정 1) — 새 선택지는 아님 */
    : null}
</select></label>
```

`:454` 계산기 버튼의 onClick·disabled 교체:

```tsx
<button aria-label="솔루션 조회" className="kim-manual-solution-query"
  disabled={isConditionSaved || !solutionWorkbenchCanQuery || solutionLoadingId !== null}
  onClick={() => queryCardSolution(condition.id)} title="솔루션 조회" type="button">
  <Calculator size={14} strokeWidth={2.15} />
</button>
```

훅 반환 객체에 `queryCardSolution`·`solutionLoadingId` 추가, 컴포넌트에서 구조 분해. import에
`solutionLenderOptions`(from `@/lib/solution-quote`) 추가.

mc_code 부재 게이트는 매퍼 fail 사유 토스트가 1차 담당(스펙 §구성 3의 "비활성 + title 안내"는 브라우저
스모크에서 UX를 보고 `disabled={… || !workbenchVehicle?.trim?.mcCode}` 추가 여부를 결정 — 수정 재진입
로딩 중 순간 비활성이 무해한지 실기로 확인).

- [ ] **Step 5: 검증** — Run: `bun run typecheck && bun run lint && bun run test:unit` → 전부 green
  (신규 유닛: `solutionSnapshotsFromScenarios` 2케이스 포함)

- [ ] **Step 6: 커밋**

```bash
git add client/src
git commit -m "feat(crm): 워크벤치 솔루션 조회 실동작 — 금융사 어휘 교체·계산기 호출·스냅샷 시드/리셋"
```

---

## Task 6: 통합 검증 — 4종 + 격리 스택 실측 스모크

- [ ] **Step 1: 전체 스위트** — Run: `bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build` → 전부 green

- [ ] **Step 2: 격리 스택 스모크(파트너 prod 실계산 — read-only)**

```bash
# 사용자 dev(5173/8788) 불가침 — 8799/5174 임시 스택(선례: client/vite.config.smoke.ts 패턴, 스모크 후 삭제)
PORT=8799 PUSH_NOTIFY=off EMBED_ON_WRITE=off AI_HINT_ON_WRITE=off \
  SOLUTION_QUOTE_API_URL=https://mc.mrcha.app/api/quotes/calculate \
  bun --env-file=.env.local run src/local-dev.ts
```

시나리오(agent-browser + magiclink admin — 선례 그대로):
1. 실 고객(예: 김지안 CU-2606-0001) 워크벤치 → 구매방식 운용리스 → 진입 모드 "솔루션 조회" →
   **금융사 select에 파트너 8사만** 노출 확인(장기렌트 전환 시 3사)
2. 실 catalog 차량(mc_code 보유 트림) 선택 + 조건 입력 → 계산기 클릭 → 월 납입금·금리·잔가 채움 실측
3. **파트너 playground 대조**: 같은 조건을 제프 UI(또는 curl로 같은 body)에 넣어 monthlyPayment 일치 확인 — 파리티 증거 1건
4. 미취급 케이스: 장기렌트 외 금융사 강제(혹은 매칭 없는 mc_code) → 파트너 문구 토스트 + 카드 불변
5. 작성완료 저장 → psql로 `quote_scenarios.solution_*` 4컬럼 대조(raw jsonb에 monthlyPayment 존재) →
   수정 재진입 → 무재조회 재저장 → 스냅샷 보존 확인
6. **원복**: 스모크 견적은 워크벤치 UI 삭제(psql 직접 삭제 금지 — 임베딩 고아) → 잔재 0 확인

- [ ] **Step 3: 커밋·PR** — 브랜치 push 후 PR(스펙·plan 링크, 행위 변경 명시: 금융사 어휘 교체 🟡 이사님 사후 공유,
  결과 3필드는 제프 확장 대기로 공란). 머지는 squash + 브랜치 삭제, `[skip ci]` 금지.

---

## 남는 것(계획 밖 — 착수 금지, 기록만)

- **제프 전달 목록**(스펙 §10): external calculate 신설·응답 확장 3필드·자동차세 의미·키 공유 고지·X-Request-ID 형식
- **키 등록**(유슨생): `EXTERNAL_API_KEY` 값을 `.env.local` + CF Pages Production secret(`SOLUTION_QUOTE_API_KEY`)에.
  등록 후 URL을 external로 교체(코드 불변)
- **이사님 사후 공유**: 계산엔진 = 파트너 API 연동 확정 · 금융사 어휘 교체 · 총비용 3필드 제프 확장 대기
