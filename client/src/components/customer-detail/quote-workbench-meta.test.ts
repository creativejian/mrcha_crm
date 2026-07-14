import { describe, expect, it } from "vitest";

import { type ScenarioCardSeed } from "@/lib/quote-request-seed";

import {
  cardIdOfScenarioNo,
  cardUiFromScenario,
  cardUiFromSeed,
  cardUiMapFromScenarios,
  cardUiOf,
  DEFAULT_CARD_UI,
  discountLineWon,
  effectiveMileageValue,
  MILEAGE_BASIC_VALUE,
  residualDisplayFromSnapshot,
  restoreDiscountLines,
  solutionSnapshotsFromScenarios,
  type CardUiState,
  type EditScenario,
} from "./quote-workbench-meta";

// 수정 진입 시 할인 구성 내역(discount_lines) 복원 — 행 state 재구성 + 기본 할인 분리 산술.
// 기본 할인은 별도 저장하지 않으므로 finalDiscount(총액) − Σ추가 행 환산액으로 역산한다.
describe("restoreDiscountLines", () => {
  it("저장본 없으면(null/빈 배열) 빈 행 + 기본 할인 = finalDiscount 전액(기존 동작 보존)", () => {
    expect(restoreDiscountLines(null, 75_300_000, 6_500_000, 1000)).toEqual({ lines: [], primaryDiscount: 6_500_000 });
    expect(restoreDiscountLines([], 75_300_000, 6_500_000, 1000)).toEqual({ lines: [], primaryDiscount: 6_500_000 });
  });

  it("금액 행: 표시값은 콤마 포맷, 기본 할인 = 총액 − 행 합", () => {
    const r = restoreDiscountLines([{ label: "재구매 할인", amount: 500_000, unit: "amount" }], 75_300_000, 6_500_000, 1000);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ label: "재구매 할인", amount: "500,000", unit: "amount" });
    expect(r.primaryDiscount).toBe(6_000_000);
  });

  it("percent 행: 표시값은 원문 유지(소수 보존), 환산은 base+option 기준 반올림(syncDiscountTotalFromRows와 동일 산술)", () => {
    const r = restoreDiscountLines([{ label: "프로모션", amount: 1.5, unit: "percent" }], 75_300_000, 6_500_000, 1000);
    expect(r.lines[0]).toMatchObject({ label: "프로모션", amount: "1.5", unit: "percent" });
    expect(r.primaryDiscount).toBe(6_500_000 - 1_129_500); // 75,300,000 × 1.5% = 1,129,500
  });

  it("혼합 다행: 각 행 복원 + 환산 합산", () => {
    const r = restoreDiscountLines(
      [
        { label: "재구매 할인", amount: 500_000, unit: "amount" },
        { label: "프로모션", amount: 1.5, unit: "percent" },
      ],
      75_300_000, 6_500_000, 1000,
    );
    expect(r.lines.map((l) => l.label)).toEqual(["재구매 할인", "프로모션"]);
    expect(r.primaryDiscount).toBe(6_500_000 - 500_000 - 1_129_500);
  });

  it("행 id는 idBase+index로 매번 새로 발급(uncontrolled defaultValue 리마운트 보장)", () => {
    const r = restoreDiscountLines(
      [
        { label: "A", amount: 1, unit: "amount" },
        { label: "B", amount: 2, unit: "amount" },
      ],
      0, 10, 42,
    );
    expect(r.lines.map((l) => l.id)).toEqual(["discount-42-0", "discount-42-1"]);
  });

  it("추가 행 합이 총액을 넘으면 기본 할인 0으로 클램프(음수면 parseMoney가 부호를 버려 오염)", () => {
    const r = restoreDiscountLines([{ label: "A", amount: 9_000_000, unit: "amount" }], 0, 6_500_000, 1);
    expect(r.primaryDiscount).toBe(0);
  });
});

// 할인 행 원화 환산 단일 산술 — 역산(restore)·합산(sync)·단위 전환(convert) 3소비처가 공유(배치 F).
describe("discountLineWon", () => {
  it("amount 행은 값 그대로, percent 행은 basis 기준 반올림 환산", () => {
    expect(discountLineWon("amount", 500_000, 75_300_000)).toBe(500_000);
    expect(discountLineWon("percent", 1.5, 75_300_000)).toBe(1_129_500);
    expect(discountLineWon("percent", 0.333, 10_000)).toBe(33); // 33.3 → 반올림
  });
  it("basis 0이면 percent 환산 0 (빈 가격 입력 방어)", () => {
    expect(discountLineWon("percent", 10, 0)).toBe(0);
  });
});

// 카드 UI 상태 기본값 — 통합 전 8개 Record의 읽기 폴백(?? 60 / ?? "none" / ?? "max" / ?? "basic" / ?? false)과
// 빈 카드(emptyQuoteConditionCards)의 모드 값이 동일함을 잠근다. 이 값이 바뀌면 저장 payload가 바뀐다.
describe("DEFAULT_CARD_UI", () => {
  it("통합 전 읽기 폴백과 동일한 기본값을 갖는다", () => {
    expect(DEFAULT_CARD_UI).toEqual({
      termMonths: 60,
      depositMode: "none",
      downPaymentMode: "none",
      residualMode: "max",
      mileageMode: "basic",
      mileageValue: "20,000km / 년",
      carTaxIncluded: false,
      subsidyApplicable: false,
    });
  });

  it("약정거리 기본 문자열은 MILEAGE_BASIC_VALUE 상수와 같다", () => {
    expect(DEFAULT_CARD_UI.mileageValue).toBe(MILEAGE_BASIC_VALUE);
  });
});

describe("cardUiOf", () => {
  it("맵에 카드가 없으면 기본값을 돌려준다", () => {
    expect(cardUiOf({}, "manual-condition-2")).toEqual(DEFAULT_CARD_UI);
  });

  it("맵에 카드가 있으면 그 값을 그대로 돌려준다", () => {
    const ui: CardUiState = { ...DEFAULT_CARD_UI, termMonths: 36, carTaxIncluded: true };
    expect(cardUiOf({ "manual-condition-1": ui }, "manual-condition-1")).toBe(ui);
  });
});

describe("effectiveMileageValue", () => {
  it("basic 모드면 저장된 값과 무관하게 기본 주행거리를 쓴다", () => {
    const ui: CardUiState = { ...DEFAULT_CARD_UI, mileageMode: "basic", mileageValue: "40,000km / 년" };
    expect(effectiveMileageValue(ui)).toBe("20,000km / 년");
  });

  it("custom 모드면 저장된 값을 쓴다", () => {
    const ui: CardUiState = { ...DEFAULT_CARD_UI, mileageMode: "custom", mileageValue: "40,000km / 년" };
    expect(effectiveMileageValue(ui)).toBe("40,000km / 년");
  });
});

// 테스트 픽스처 — EditScenario 전 필드. CardUiState가 읽는 8필드 외에는 복원 대상이 아니다.
function scenarioFixture(over: Partial<EditScenario> = {}): EditScenario {
  return {
    scenarioNo: 1,
    lender: "우리금융캐피탈",
    monthlyPayment: "1,200,000",
    termMonths: 36,
    depositMode: "percent",
    depositValue: "10",
    downPaymentMode: "amount",
    downPaymentValue: "3,000,000",
    residualMode: "amount",
    residualValue: "40,000,000",
    mileageMode: "custom",
    mileageValue: "30,000km / 년",
    carTaxIncluded: true,
    subsidyApplicable: true,
    subsidyAmount: "1,000,000",
    totalReturnCost: "10,000,000",
    totalTakeoverCost: "20,000,000",
    dueAtDelivery: "5,000,000",
    interestRate: "5.3",
    ...over,
  };
}

describe("cardIdOfScenarioNo", () => {
  it("시나리오 번호를 카드 id로 바꾼다", () => {
    expect(cardIdOfScenarioNo(1)).toBe("manual-condition-1");
    expect(cardIdOfScenarioNo(3)).toBe("manual-condition-3");
  });
});

describe("cardUiFromScenario", () => {
  it("저장된 시나리오의 8필드를 카드 UI 상태로 복원한다", () => {
    expect(cardUiFromScenario(scenarioFixture())).toEqual({
      termMonths: 36,
      depositMode: "percent",
      downPaymentMode: "amount",
      residualMode: "amount",
      mileageMode: "custom",
      mileageValue: "30,000km / 년",
      carTaxIncluded: true,
      subsidyApplicable: true,
    });
  });
});

describe("cardUiMapFromScenarios", () => {
  it("시나리오 번호를 카드 id로 매핑한 맵을 만든다", () => {
    const map = cardUiMapFromScenarios([
      scenarioFixture({ scenarioNo: 1, termMonths: 36 }),
      scenarioFixture({ scenarioNo: 3, termMonths: 48 }),
    ]);
    expect(Object.keys(map)).toEqual(["manual-condition-1", "manual-condition-3"]);
    expect(map["manual-condition-1"].termMonths).toBe(36);
    expect(map["manual-condition-3"].termMonths).toBe(48);
  });

  it("시나리오가 없으면 빈 맵(모든 카드가 기본값으로 폴백)", () => {
    expect(cardUiMapFromScenarios([])).toEqual({});
  });
});

// 수정 재진입 스냅샷 시드 — 시나리오 저장이 전체 교체(서버 insertScenarios delete→insert)라,
// 재조회 없이 재저장해도 이 시드가 저장 payload에 스냅샷을 되실어 소실을 막는다(마이그 0031 계약).
// 카드 대응 규칙은 cardUiMapFromScenarios와 동일(cardIdOfScenarioNo — scenario_no ↔ manual-condition-N).
describe("solutionSnapshotsFromScenarios", () => {
  const snapshotRow = {
    scenarioNo: 1,
    solutionLenderCode: "im-capital",
    solutionWorkbookVersion: "2026-07 v2",
    solutionCalculatedAt: "2026-07-14T02:00:00.000Z",
    solutionRaw: { ok: true, quote: { monthlyPayment: 1_200_000 } },
  };

  it("스냅샷 있는 시나리오를 카드 id로 매핑한다(workbookVersion null은 null 그대로 왕복 — \"\" 드리프트 금지)", () => {
    const map = solutionSnapshotsFromScenarios([
      snapshotRow,
      { ...snapshotRow, scenarioNo: 3, solutionLenderCode: "mg-capital", solutionWorkbookVersion: null },
    ]);
    expect(Object.keys(map)).toEqual(["manual-condition-1", "manual-condition-3"]);
    expect(map["manual-condition-1"]).toEqual({
      solutionLenderCode: "im-capital",
      solutionWorkbookVersion: "2026-07 v2",
      solutionCalculatedAt: "2026-07-14T02:00:00.000Z",
      solutionRaw: { ok: true, quote: { monthlyPayment: 1_200_000 } },
    });
    expect(map["manual-condition-3"]).toMatchObject({ solutionLenderCode: "mg-capital", solutionWorkbookVersion: null });
  });

  it("스냅샷 없는(수기) 시나리오는 제외한다 — lenderCode/calculatedAt 둘 다 있어야 스냅샷 실존", () => {
    const map = solutionSnapshotsFromScenarios([
      { scenarioNo: 1, solutionLenderCode: null, solutionWorkbookVersion: null, solutionCalculatedAt: null, solutionRaw: null },
      { ...snapshotRow, scenarioNo: 2, solutionCalculatedAt: null }, // 반쪽 행(과거 드리프트 방어) — 스냅샷으로 안 본다
      { ...snapshotRow, scenarioNo: 3 },
    ]);
    expect(Object.keys(map)).toEqual(["manual-condition-3"]);
  });

  it("solutionRaw만 null인 반쪽 행도 제외한다 — raw 없으면 residualDisplayFromSnapshot이 '-' 폴백해 재시드가 인수·금리를 소실시킨다", () => {
    const map = solutionSnapshotsFromScenarios([
      { ...snapshotRow, scenarioNo: 1, solutionRaw: null }, // lenderCode·calculatedAt은 있으나 raw 없음(4컬럼 비원자 드리프트)
      { ...snapshotRow, scenarioNo: 2 },
    ]);
    expect(Object.keys(map)).toEqual(["manual-condition-2"]);
  });
});

// 수정 재진입 max 잔가 재시드 — max 모드는 DB residualValue가 null(추출 규칙)이라 표시값이 "-"로 시드되는데,
// 그대로 두면 재진입 직후 파생(residualAmountOf → null)이 인수 총비용·금리를 "0"으로 덮어 무재조회 재저장 시
// 이전 저장값이 조용히 소실된다. 스냅샷 raw의 실채택 잔가로 표시값을 복원해 파생이 보존 계산되게 한다.
describe("residualDisplayFromSnapshot", () => {
  const snapshot = {
    solutionLenderCode: "im-capital",
    solutionWorkbookVersion: null,
    solutionCalculatedAt: "2026-07-14T02:00:00.000Z",
    solutionRaw: {
      ok: true,
      quote: { monthlyPayment: 1_234_567, rates: { annualRateDecimal: 0.0532 }, residual: { amount: 26_550_000 } },
    },
  };

  it("스냅샷 raw의 실채택 잔가를 조회 채움과 동일 포맷(콤마)으로 돌려준다", () => {
    expect(residualDisplayFromSnapshot(snapshot)).toBe("26,550,000");
  });

  it("스냅샷 부재·raw 해석 불능이면 null(호출부 '-' 폴백 유지)", () => {
    expect(residualDisplayFromSnapshot(undefined)).toBeNull();
    expect(residualDisplayFromSnapshot({ ...snapshot, solutionRaw: "garbage" })).toBeNull();
  });
});

// 앱 견적요청 승격(카드1 시드). 시드 없는 필드는 DEFAULT_CARD_UI를 유지해야
// 통합 전(= Record에 키를 안 넣어 읽기 폴백을 타던) 동작과 같다.
describe("cardUiFromSeed", () => {
  const emptySeed: ScenarioCardSeed = {
    termMonths: null, depositMode: null, depositValue: null, downPaymentMode: null, downPaymentValue: null,
  };

  it("빈 시드면 전부 기본값", () => {
    expect(cardUiFromSeed(emptySeed)).toEqual(DEFAULT_CARD_UI);
  });

  it("기간만 있으면 기간만 덮어쓴다", () => {
    expect(cardUiFromSeed({ ...emptySeed, termMonths: 48 })).toEqual({ ...DEFAULT_CARD_UI, termMonths: 48 });
  });

  it("보증금·선수금 모드를 덮어쓴다(값 문자열은 카드 표시값이라 여기 없음)", () => {
    expect(cardUiFromSeed({ ...emptySeed, depositMode: "percent", depositValue: "10", downPaymentMode: "amount", downPaymentValue: "3,000,000" }))
      .toEqual({ ...DEFAULT_CARD_UI, depositMode: "percent", downPaymentMode: "amount" });
  });
});
