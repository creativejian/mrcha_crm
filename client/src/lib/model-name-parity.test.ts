// 파트너 `modelName` 조립 — **두 빌더 양방향 잠금**(2026-08-08).
//
// 같은 트림을 계산기 모달과 견적 워크벤치 중 어디서 보내느냐에 따라 파트너에 다른 이름이 가면
// 견적이 무음으로 갈린다. `#462`가 그 드리프트를 한 번 고쳤지만 **재발을 막는 그물이 없었다**:
//  - `build-payload.test.ts`는 계산기만, `solution-quote.test.ts`는 워크벤치만 본다.
//  - `solution-quote.test.ts`의 "계산기 build-payload 패리티"는 **제목 문자열일 뿐** — 그 파일은
//    build-payload를 import하지 않아 한쪽만 바뀌어도 둘 다 초록이었다.
// 이 파일은 레포의 패리티 락 관례(doc-type-parity·roles-parity)를 따라 **양쪽을 실제로 import해
// 같은 입력을 먹이고 결과를 대조**한다. 한쪽 체인만 고치면 여기서 빨개진다.
//
// ⚠️ 값 하나를 고정 단언하지 않는다 — 체인이 정당하게 바뀔 수 있고, 계약은 "같은 값"이지
// "특정 값"이 아니다. 대신 **tier가 갈리는 조합을 전수로 돌려** 두 결과가 언제나 같은지 본다.
import { describe, expect, test } from "vitest";

import { buildScenarioPayload, type SharedQuoteInputs } from "../components/calculator/build-payload";
import { defaultScenario } from "../components/calculator/types";
import { buildSolutionQuoteInput, type BuildArgs } from "./solution-quote";

// tier가 갈리는 4조합 — canonical / trimName / name / 전무. 두 빌더의 폴백 순서가 어긋나면
// 이 중 최소 한 줄에서 결과가 달라진다.
const TRIM_CASES = [
  { label: "3개 다 있음(canonical 우선)", canonicalName: "BMW 3시리즈 2026 가솔린 320i M Sport", trimName: "320i M Sport", name: "320i" },
  { label: "canonical만(trim_name NULL)", canonicalName: "BMW 3시리즈 2026 가솔린 320i", trimName: null, name: "320i" },
  { label: "canonical 없음 → trimName", canonicalName: null, trimName: "320i M Sport", name: "320i" },
  { label: "두 이름 다 NULL → name(notNull)", canonicalName: null, trimName: null, name: "320i" },
] as const;

const BRAND = "BMW";
const MODEL = "3시리즈";
const MC_CODE = "MC-PARITY-001";

// 계산기 쪽 최소 입력 — modelName 조립에 관여하지 않는 값들은 아무 값이나 유효하면 된다.
const SHARED: SharedQuoteInputs = {
  totalQuotedPrice: 50_000_000,
  finalVehiclePrice: 50_000_000,
  discountKrw: 0,
  taxAmountNum: 0,
  bondIncluded: "included",
  bondAmountNum: 0,
  deliveryIncluded: "included",
  deliveryAmountNum: 0,
  extraIncluded: "included",
  extraAmountNum: 0,
};

// 워크벤치 쪽 최소 입력 — 같은 축(차량 3필드)만 케이스별로 갈아끼운다.
const WORKBENCH_BASE: Omit<BuildArgs, "vehicle"> = {
  lenderLabel: "MG캐피탈",
  purchaseMethod: "운용리스",
  termMonths: 48,
  depositMode: "none",
  depositRaw: "",
  downPaymentMode: "none",
  downPaymentRaw: "",
  residualMode: "max",
  residualRaw: "",
  mileageValue: "20,000km / 년",
  subsidyApplicable: false,
  subsidyRaw: "",
  cmFeeRaw: "",
  agFeeRaw: "",
  dealerName: null,
  pricing: {
    baseAndOption: 50_000_000,
    discount: 0,
    acquisitionTax: 0,
    bond: 0,
    bondIncluded: true,
    delivery: 0,
    deliveryIncluded: true,
    incidental: 0,
    incidentalIncluded: true,
  },
};

describe("modelName 조립 패리티 — 계산기(build-payload) ↔ 워크벤치(solution-quote)", () => {
  for (const c of TRIM_CASES) {
    test(`같은 트림이면 같은 modelName: ${c.label}`, () => {
      const calculator = buildScenarioPayload(
        defaultScenario(),
        { mcCode: MC_CODE, name: c.name, trimName: c.trimName, canonicalName: c.canonicalName },
        { name: BRAND },
        SHARED,
      );
      const workbench = buildSolutionQuoteInput({
        ...WORKBENCH_BASE,
        vehicle: {
          brand: BRAND,
          model: MODEL,
          trimName: c.trimName,
          canonicalName: c.canonicalName,
          name: c.name,
          mcCode: MC_CODE,
        },
      });

      if (!calculator) throw new Error("계산기 payload 조립 실패(패리티 검증 불가)");
      if (!workbench.ok) throw new Error(`워크벤치 payload 조립 실패: ${workbench.reason}`);
      expect(workbench.input.modelName).toBe(calculator.modelName);
    });
  }

  // 위 4케이스는 "트림이 로드된" 상태만 본다. 워크벤치에만 있는 최종 폴백(트림 미조회 → 모델명)은
  // 계산기에 대응물이 없다(계산기는 trim이 null이면 payload 자체를 만들지 않는다) — 그 비대칭이
  // 의도된 것임을 여기 남긴다. 이 줄이 깨지면 워크벤치가 트림 없이도 뭔가를 보내기 시작한 것이다.
  test("트림 미조회 상태는 워크벤치만의 경로 — 모델명 폴백(계산기는 payload 미생성)", () => {
    const calculator = buildScenarioPayload(defaultScenario(), null, { name: BRAND }, SHARED);
    expect(calculator).toBeNull();

    const workbench = buildSolutionQuoteInput({
      ...WORKBENCH_BASE,
      vehicle: { brand: BRAND, model: MODEL, trimName: null, canonicalName: null, name: null, mcCode: MC_CODE },
    });
    if (!workbench.ok) throw new Error(workbench.reason);
    expect(workbench.input.modelName).toBe(MODEL);
  });
});
