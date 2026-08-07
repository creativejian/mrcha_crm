// client/src/lib/solution-quote.test.ts
import { describe, expect, test } from "vitest";

import {
  SOLUTION_LENDERS,
  buildSolutionQuoteInput,
  detectLenderDrift,
  detectLinkPriceMismatch,
  detectMultiLinkResolve,
  detectVehiclePriceMismatch,
  extractPartnerLenders,
  hasLenderDrift,
  linkPriceMismatchMessage,
  multiLinkResolveMessage,
  parseSolutionQuoteResult,
  solutionLenderOptions,
  solutionProductTypeOf,
  type BuildArgs,
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
  cmFeeRaw: "",
  agFeeRaw: "",
  dealerName: null,
  // name: null = 트림 미조회 상태(저장 견적 prefill 등). 실 카탈로그의 name은 notNull이라,
  // 트림이 로드된 케이스는 각 테스트가 명시로 채운다.
  vehicle: { brand: "BMW", model: "3 Series", trimName: null, canonicalName: null, name: null, mcCode: "MC-TEST-001" },
  pricing: {
    baseAndOption: 59_000_000,
    discount: 6_500_000,
    // 취득원가(2026-07-30 실동작화) — 기본값 = 구 장식 표기(공채 포함·탁송/부대 불포함)·취득세 0.
    acquisitionTax: 0,
    bond: 0,
    bondIncluded: true,
    delivery: 0,
    deliveryIncluded: false,
    incidental: 0,
    incidentalIncluded: false,
  },
};

describe("어휘 SSOT", () => {
  test("운용리스 = 8사, 장기렌트 = 3사(MG·메리츠·iM), 그 외 = 빈 배열", () => {
    expect(SOLUTION_LENDERS).toHaveLength(8);
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
  test("modelName 해석은 canonicalName ?? trimName ?? name ?? model 순(계산기 build-payload 패리티)", () => {
    const modelNameOf = (vehicle: Partial<BuildArgs["vehicle"]>) => {
      const r = buildSolutionQuoteInput({ ...BASE_ARGS, vehicle: { ...BASE_ARGS.vehicle, ...vehicle } });
      if (!r.ok) throw new Error(r.reason);
      return r.input.modelName;
    };

    // 1순위 canonical — 아래 2·3순위 값이 함께 있어도 canonical이 이긴다.
    expect(
      modelNameOf({
        canonicalName: "BMW 3 Series 2026 가솔린 320i M Sport",
        trimName: "320i M Sport",
        name: "320i M Sport",
      }),
    ).toBe("BMW 3 Series 2026 가솔린 320i M Sport");

    // canonical만 있는 행(trim_name NULL) — "둘 다 있을 때만 canonical이 이긴다"는 변이를 잡는다.
    expect(modelNameOf({ canonicalName: "BMW 3 Series 2026 가솔린 320i", trimName: null, name: null })).toBe(
      "BMW 3 Series 2026 가솔린 320i",
    );

    expect(modelNameOf({ canonicalName: null, trimName: "320i M Sport", name: "320i" })).toBe("320i M Sport");

    // 두 이름이 다 NULL이어도 트림이 로드됐으면 name(notNull) — 이 tier가 없으면 맨 모델명이 나가
    // 계산기(build-payload: canonical ?? trimName ?? trim.name)와 두 빌더가 갈린다.
    expect(modelNameOf({ canonicalName: null, trimName: null, name: "320i" })).toBe("320i");

    // 트림 정보가 전혀 없으면 기존 동작(모델명) 유지 — 저장 견적 prefill 등 트림 미조회 상태 방어
    expect(modelNameOf({ canonicalName: null, trimName: null, name: null })).toBe("3 Series");
  });

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
      // CM/AG(계산기 패리티) — 빈 칸도 분율 0 상시 전송(계산기 payload 미러)
      cmFeeRate: 0,
      agFeeRate: 0,
      // 취득원가 포함/불포함 플래그 = 상시 전송, 금액은 포함일 때만(계산기 payload 미러)
      includePublicBondCost: true,
      publicBondCost: 0,
      includeDeliveryFeeAmount: false,
      includeMiscFeeAmount: false,
      residualMode: "high",
    });
  });

  test("취득세 >0이면 amount 모드+override 동봉, 0이면 둘 다 미전송(엔진 자동 계산 유지)", () => {
    const on = buildSolutionQuoteInput({
      ...BASE_ARGS,
      pricing: { ...BASE_ARGS.pricing, acquisitionTax: 5_078_180 },
    });
    if (!on.ok) throw new Error(on.reason);
    expect(on.input.acquisitionTaxMode).toBe("amount");
    expect(on.input.acquisitionTaxAmountOverride).toBe(5_078_180);

    const off = buildSolutionQuoteInput(BASE_ARGS);
    if (!off.ok) throw new Error(off.reason);
    expect(off.input.acquisitionTaxMode).toBeUndefined();
    expect(off.input.acquisitionTaxAmountOverride).toBeUndefined();
  });

  test("공채/탁송/부대: 포함이면 금액 동봉, 불포함이면 플래그만 false로 가고 금액 미전송", () => {
    const r = buildSolutionQuoteInput({
      ...BASE_ARGS,
      pricing: {
        ...BASE_ARGS.pricing,
        bond: 300_000, bondIncluded: false,
        delivery: 10_000, deliveryIncluded: true,
        incidental: 2_000, incidentalIncluded: false,
      },
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.includePublicBondCost).toBe(false);
    expect(r.input.publicBondCost).toBeUndefined();
    expect(r.input.includeDeliveryFeeAmount).toBe(true);
    expect(r.input.deliveryFeeAmount).toBe(10_000);
    expect(r.input.includeMiscFeeAmount).toBe(false);
    expect(r.input.miscFeeAmount).toBeUndefined();
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
    expect(
      buildSolutionQuoteInput({
        ...BASE_ARGS,
        vehicle: { brand: null, model: null, trimName: null, canonicalName: null, name: null, mcCode: null },
      }).ok,
    ).toBe(false);
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, vehicle: { ...BASE_ARGS.vehicle, mcCode: null } }).ok).toBe(false);
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, mileageValue: "13,000km / 년" }).ok).toBe(false);
  });

  test("장기렌트 × 운용리스 전용 금융사(신한카드) = 실패(미취급 선차단)", () => {
    const r = buildSolutionQuoteInput({ ...BASE_ARGS, purchaseMethod: "장기렌트" });
    expect(r.ok).toBe(false);
  });

  test("% 100 초과 = 실패(콤마 오입력 차단 — parseInterestRate 선례 미러)", () => {
    // "10,5"(10.5% 의도)가 콤마 제거로 105%가 되는 오입력 — 무음 전송 대신 fail-loud
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, depositMode: "percent", depositRaw: "10,5" }).ok).toBe(false);
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, residualMode: "percent", residualRaw: "45,5" }).ok).toBe(false);
  });

  test("소수 %는 정상 환산(10.5% → 반올림 원 환산)", () => {
    const r = buildSolutionQuoteInput({ ...BASE_ARGS, depositMode: "percent", depositRaw: "10.5" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.depositAmount).toBe(6_195_000); // 59,000,000의 10.5%
  });

  test("다중 소수점 % 오입력은 흡수(parsePercentInput SSOT 통일) — 콤마(>100 차단)와 별개 축, 파생과 일치", () => {
    // 구현 이전: Number("4.5.5")=NaN → 실패. 통일 후: parsePercentInput이 "4.55" 흡수.
    const r = buildSolutionQuoteInput({ ...BASE_ARGS, depositMode: "percent", depositRaw: "4.5.5" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.depositAmount).toBe(2_684_500); // 59,000,000의 4.55%
  });

  test("기간 이탈(72개월) = 실패", () => {
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, termMonths: 72 }).ok).toBe(false);
  });

  test("CM/AG 수수료 % → 분율 전송(빈 칸 = 0 상시 전송 — 계산기 payload 미러), 100 초과 = 실패", () => {
    const empty = buildSolutionQuoteInput(BASE_ARGS);
    if (!empty.ok) throw new Error(empty.reason);
    expect(empty.input.cmFeeRate).toBe(0);
    expect(empty.input.agFeeRate).toBe(0);
    const filled = buildSolutionQuoteInput({ ...BASE_ARGS, cmFeeRaw: "1.5", agFeeRaw: "2" });
    if (!filled.ok) throw new Error(filled.reason);
    expect(filled.input.cmFeeRate).toBeCloseTo(0.015);
    expect(filled.input.agFeeRate).toBeCloseTo(0.02);
    // "1,5"(1.5% 의도) 콤마 오입력 → 15%가 아니라 105류 상한 검사… parsePercentInput은 콤마 제거 "15" — 100 이하라 통과.
    // fail-loud 상한은 진짜 비현실값(>100)만 차단(보증금 % 미러): "10,5" → 105% → 실패.
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, cmFeeRaw: "10,5" }).ok).toBe(false);
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, agFeeRaw: "10,5" }).ok).toBe(false);
  });

  test("차량가 미입력(0원) = 실패", () => {
    expect(buildSolutionQuoteInput({ ...BASE_ARGS, pricing: { ...BASE_ARGS.pricing, baseAndOption: 0, discount: 0 } }).ok).toBe(false);
  });

  test("판매사(T2): dealerName passthrough — null(비제휴/미선택)은 미전송, 값은 그대로 동봉", () => {
    const off = buildSolutionQuoteInput(BASE_ARGS); // BASE_ARGS.dealerName = null
    if (!off.ok) throw new Error(off.reason);
    expect(off.input.dealerName).toBeUndefined(); // 파트너 zod min(1) optional — 빈/무선택은 키 자체 미전송
    const on = buildSolutionQuoteInput({ ...BASE_ARGS, dealerName: "도이치모터스" });
    if (!on.ok) throw new Error(on.reason);
    expect(on.input.dealerName).toBe("도이치모터스");
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

  test("rates가 primitive여도 크래시 없이 null(방어 파싱)", () => {
    expect(
      parseSolutionQuoteResult({ ok: true, quote: { monthlyPayment: 1, rates: "x", residual: { amount: 1 } } }),
    ).toBeNull();
  });

  // (solutionDisplayRatePct 케이스는 개정 1로 제거 — 카드 금리는 lease-rate.ts 실질 금리 파생이 담당.)
});

// ── 금융사 SSOT 드리프트 판정(2026-07-23) ──────────────────────────────────────
// `SOLUTION_LENDERS`는 파트너 목록의 하드코딩 미러라 조용히 낡을 수 있다. 이 판정 한 벌을
// 런타임 경고(fetchSupportMatrix)와 `bun run check:lenders`가 공유한다.
// 축 3개: 추가(onlyPartner)·삭제(onlyCrm)·개명(renamed). 개명 축은 제프가 `lenderName`을
// 실어 주면서 열렸다(회신 `ref/2026-07-23-jeff-lender-name-reply.md`).
describe("extractPartnerLenders / detectLenderDrift — 파트너 금융사 SSOT 대조", () => {
  // 파트너 응답 재현: productType별로 같은 code가 여러 행에 온다(제프 계약 — 이름은 같은 값 반복).
  const rowsOf = (lenders: readonly { code: string; name?: string | null }[]) =>
    lenders.flatMap((l) =>
      ["operating_lease", "long_term_rental"].map((productType) => ({
        lenderCode: l.code,
        ...(l.name === undefined ? {} : l.name === null ? {} : { lenderName: l.name }),
        productType,
        leaseTermMonths: [60],
        annualMileageKm: [20000],
      })),
    );
  const CURRENT = SOLUTION_LENDERS.map((l) => ({ code: l.code as string, name: l.label as string }));

  test("productType별 중복 행을 code 기준으로 접는다 + 표시명을 함께 뽑는다", () => {
    const got = extractPartnerLenders({ matrix: rowsOf(CURRENT) });
    expect(got).toHaveLength(SOLUTION_LENDERS.length);
    expect(got.find((l) => l.code === "im-capital")).toEqual({ code: "im-capital", name: "iM캐피탈" });
  });

  test("현행 어휘·표시명과 같으면 드리프트 없음(제프 회신 표 대조 = 현시점 실제 상태)", () => {
    const drift = detectLenderDrift(extractPartnerLenders({ matrix: rowsOf(CURRENT) }));
    expect(drift).toEqual({ onlyPartner: [], onlyCrm: [], renamed: [] });
    expect(hasLenderDrift(drift)).toBe(false);
  });

  test("파트너가 금융사를 추가하면 onlyPartner로 잡힌다(우리 화면에선 고를 수 없는 상태)", () => {
    // 제프가 예고한 실제 후보 = 하나캐피탈(운용리스 엔진 빌드됨·배선 보류).
    const drift = detectLenderDrift(
      extractPartnerLenders({ matrix: rowsOf([...CURRENT, { code: "hana-capital", name: "하나캐피탈" }]) }),
    );
    expect(drift.onlyPartner).toEqual(["hana-capital"]);
    expect(drift.onlyCrm).toEqual([]);
    expect(hasLenderDrift(drift)).toBe(true);
  });

  test("파트너가 금융사를 빼면 onlyCrm으로 잡힌다(고를 수 있는데 계산이 거부되는 상태)", () => {
    const drift = detectLenderDrift(
      extractPartnerLenders({ matrix: rowsOf(CURRENT.filter((l) => l.code !== "nh-capital")) }),
    );
    expect(drift.onlyCrm).toEqual(["nh-capital"]);
    expect(drift.onlyPartner).toEqual([]);
  });

  test("표시명만 바뀌면 renamed로 잡힌다 — code는 그대로라 계산은 정상, 화면 표기만 낡는다", () => {
    const drift = detectLenderDrift(
      extractPartnerLenders({
        matrix: rowsOf(CURRENT.map((l) => (l.code === "im-capital" ? { ...l, name: "아이엠캐피탈" } : l))),
      }),
    );
    expect(drift.renamed).toEqual([{ code: "im-capital", partner: "아이엠캐피탈", crm: "iM캐피탈" }]);
    expect(drift.onlyPartner).toEqual([]); // 추가·삭제 축은 조용해야 한다(축 독립)
    expect(drift.onlyCrm).toEqual([]);
    expect(hasLenderDrift(drift)).toBe(true);
  });

  test("lenderName이 없는 응답(파트너 배포 전·구 캐시)은 개명 축만 건너뛴다 — code 축은 그대로", () => {
    // 이 가드가 없으면 제프 배포 전까지 8사 전부가 "개명됨"으로 오탐한다.
    const noName = { matrix: rowsOf(CURRENT.map((l) => ({ code: l.code }))) };
    expect(extractPartnerLenders(noName).every((l) => l.name === null)).toBe(true);
    const drift = detectLenderDrift(extractPartnerLenders(noName));
    expect(drift.renamed).toEqual([]);
    expect(hasLenderDrift(drift)).toBe(false);
    // 이름이 없어도 추가/삭제는 계속 잡힌다.
    const removed = detectLenderDrift(
      extractPartnerLenders({ matrix: rowsOf(CURRENT.filter((l) => l.code !== "nh-capital").map((l) => ({ code: l.code }))) }),
    );
    expect(removed.onlyCrm).toEqual(["nh-capital"]);
  });

  test("빈 응답(조회 실패·matrix 부재)은 드리프트로 보지 않는다 — 전 금융사 오탐 차단", () => {
    expect(extractPartnerLenders(null)).toEqual([]);
    expect(extractPartnerLenders({})).toEqual([]);
    expect(detectLenderDrift([])).toEqual({ onlyPartner: [], onlyCrm: [], renamed: [] });
  });

  test("행 순서에 의존하지 않는다 — 파트너가 순서 비의존을 권고했고 집합 비교라 무관", () => {
    const reversed = { matrix: rowsOf([...CURRENT].reverse()) };
    expect(hasLenderDrift(detectLenderDrift(extractPartnerLenders(reversed)))).toBe(false);
  });
});

describe("detectVehiclePriceMismatch — 파트너가 우리 차량가로 계산했는지 대조", () => {
  // 실측 사고(2026-07-27 QT-2607-0012): 520i M Spt(74,300,000)를 보냈는데 파트너가 기본
  // 520i(69,800,000) offering에 링크돼 있어 그 가격으로 전액 계산했다.
  const rawWith = (
    used: number,
    catalog = used,
    modelName = "The New 5 Series 520i (P1) #116604-1054541",
  ) => ({
    ok: true,
    quote: {
      monthlyPayment: 795_410,
      rates: { annualRateDecimal: 0.052 },
      residual: { amount: 41_880_000, rateDecimal: 0.6 },
      majorInputs: { vehiclePrice: used, discountedVehiclePrice: used },
      resolvedVehicle: { brand: "BMW", modelName, vehiclePrice: catalog },
    },
  });

  test("실제 계산에 쓴 값이 우리가 보낸 값과 다르면 잡는다", () => {
    expect(detectVehiclePriceMismatch(rawWith(69_800_000), 74_300_000)).toEqual({
      sentPrice: 74_300_000,
      usedPrice: 69_800_000,
      resolvedModelName: "The New 5 Series 520i (P1) #116604-1054541",
    });
  });

  test("일치하면 null", () => {
    expect(detectVehiclePriceMismatch(rawWith(79_200_000), 79_200_000)).toBeNull();
  });

  // 제프 회신 ③: 산은은 마스터↔offering 가격 체계가 애초에 달라 카탈로그가 불일치가 정상이고,
  // 엔진이 quotedVehiclePrice를 우선하므로 견적가에 영향이 없다. 카탈로그가로 대조하면 헛경고가 뜬다.
  test("카탈로그가만 다르고 계산은 우리 값으로 했으면 경고하지 않는다(산은 i5·iX1 오탐 방지)", () => {
    // 보낸 84,900,000으로 계산했지만 링크된 offering 카탈로그가는 92,800,000
    expect(detectVehiclePriceMismatch(rawWith(84_900_000, 92_800_000), 84_900_000)).toBeNull();
  });

  test("금융사 구분 없이 같은 축을 쓴다 — 판정에 lenderCode가 필요 없다", () => {
    // 8사 모두 "우리가 보낸 가격으로 계산했는가"라는 질문은 동일하다.
    expect(detectVehiclePriceMismatch(rawWith(69_800_000), 74_300_000)).not.toBeNull();
  });

  test("fail-open: majorInputs가 없거나 값이 이상하면 경고하지 않는다", () => {
    expect(detectVehiclePriceMismatch({ ok: true, quote: {} }, 74_300_000)).toBeNull();
    expect(detectVehiclePriceMismatch(rawWith(0), 74_300_000)).toBeNull();
    expect(detectVehiclePriceMismatch(null, 74_300_000)).toBeNull();
    expect(detectVehiclePriceMismatch(rawWith(69_800_000), 0)).toBeNull();
  });

  test("resolvedVehicle이 없어도 가격 대조는 성립한다(문구에서 차량명만 빠진다)", () => {
    const raw = { ok: true, quote: { majorInputs: { vehiclePrice: 69_800_000 } } };
    expect(detectVehiclePriceMismatch(raw, 74_300_000)?.resolvedModelName).toBeNull();
  });
});

// ── 링크 오배정 검출축 2종 (2026-07-29 — 제프 B·D 배포 후속) ──────────────────
// B 이후 8사 전부 요청가로 계산하므로 위 detectVehiclePriceMismatch 축은 링크 오배정을
// 못 잡는다(계산가는 항상 일치). 유일한 검출축 = requestedPrice ≠ catalogPrice(제프 D).
describe("detectLinkPriceMismatch — 요청가 ↔ 금융사 계산 기준가 대조", () => {
  const rawWith = (resolved: Record<string, unknown>) => ({
    ok: true,
    quote: {
      majorInputs: { vehiclePrice: 74_300_000 },
      resolvedVehicle: { brand: "BMW", modelName: "520d M Sport", ...resolved },
    },
  });

  test("requestedPrice ≠ catalogPrice면 잡는다(메리츠 MC070526006 실측 — 디젤 트림 링크)", () => {
    expect(
      detectLinkPriceMismatch(rawWith({ requestedPrice: 74_300_000, catalogPrice: 73_000_000 })),
    ).toEqual({
      requestedPrice: 74_300_000,
      catalogPrice: 73_000_000,
      resolvedModelName: "520d M Sport",
    });
  });

  test("일치하면 null", () => {
    expect(detectLinkPriceMismatch(rawWith({ requestedPrice: 74_300_000, catalogPrice: 74_300_000 }))).toBeNull();
  });

  test("catalogPrice가 없으면 null — 산은 known-mismatch 8건은 F가 의도적으로 미탑재(헛경고 억제)", () => {
    expect(detectLinkPriceMismatch(rawWith({ requestedPrice: 84_900_000 }))).toBeNull();
  });

  test("requestedPrice가 없으면 null — 구 응답·미배포 경로 fail-open", () => {
    expect(detectLinkPriceMismatch(rawWith({ catalogPrice: 73_000_000 }))).toBeNull();
    expect(detectLinkPriceMismatch({ ok: true, quote: {} })).toBeNull();
    expect(detectLinkPriceMismatch(null)).toBeNull();
  });

  test("B 이후 기존 축이 못 잡는 오배정을 이 축이 잡는다(계산가는 요청가 그대로인 케이스)", () => {
    const raw = rawWith({ requestedPrice: 74_300_000, catalogPrice: 73_000_000 });
    // 기존 축: majorInputs.vehiclePrice(74.3M) === 보낸 값(74.3M) → 조용하다
    expect(detectVehiclePriceMismatch(raw, 74_300_000)).toBeNull();
    // 새 축이 링크 오배정을 드러낸다
    expect(detectLinkPriceMismatch(raw)).not.toBeNull();
  });

  test("문구에 두 값과 트림명이 실린다", () => {
    const msg = linkPriceMismatchMessage({
      requestedPrice: 74_300_000,
      catalogPrice: 73_000_000,
      resolvedModelName: "520d M Sport",
    });
    expect(msg).toContain("74,300,000");
    expect(msg).toContain("73,000,000");
    expect(msg).toContain("520d M Sport");
  });
});

describe("detectMultiLinkResolve — 다중매칭 임의 트림 신호(linkedOfferingCount)", () => {
  const rawWith = (resolved: Record<string, unknown>) => ({
    ok: true,
    quote: { resolvedVehicle: { brand: "BMW", modelName: "520d M Sport", ...resolved } },
  });

  test("2 이상이면 잡는다 + resolve된 모델명 동봉(상담사가 눈으로 대조할 근거)", () => {
    expect(detectMultiLinkResolve(rawWith({ linkedOfferingCount: 2 }))).toEqual({
      linkedOfferingCount: 2,
      resolvedModelName: "520d M Sport",
    });
  });

  test("필드가 없으면 null — 링크 1건이면 파트너가 필드 자체를 생략한다(제프 회신 D)", () => {
    expect(detectMultiLinkResolve(rawWith({}))).toBeNull();
    expect(detectMultiLinkResolve(null)).toBeNull();
  });

  test("방어: 1 이하·비수치는 null(스펙 밖 값 fail-open)", () => {
    expect(detectMultiLinkResolve(rawWith({ linkedOfferingCount: 1 }))).toBeNull();
    expect(detectMultiLinkResolve(rawWith({ linkedOfferingCount: "6" }))).toBeNull();
  });

  test("문구에 후보 수와 트림명이 실린다", () => {
    const msg = multiLinkResolveMessage({ linkedOfferingCount: 6, resolvedModelName: "Cayenne 3.0" });
    expect(msg).toContain("6");
    expect(msg).toContain("Cayenne 3.0");
  });
});
