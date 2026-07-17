// scenarioQueryFingerprint(배치 7 A#3) — "payload에 실리는 키 ⊆ fingerprint 키" 원칙 잠금.
import { describe, expect, it } from "vitest";

import { SCENARIO_QUERY_KEYS, scenarioQueryFingerprint } from "./query-fingerprint";
import { defaultScenario, type ScenarioState } from "./types";

const TOP = 'top-level-1';

// 키별 "기본값과 다른" 대체값 — 전 키 민감도 검사용. SCENARIO_QUERY_KEYS에 키를 추가하면
// 여기도 채워야 컴파일된다(누락 = 타입 에러).
const flipped: { [K in (typeof SCENARIO_QUERY_KEYS)[number]]: ScenarioState[K] } = {
  activeTab: "rent",
  deliveryType: "special",
  maintenanceGrade: "vip",
  period: "36",
  downPaymentType: "amount",
  downPayment: "1000000",
  depositType: "percent",
  deposit: "30",
  residualValueType: "percent",
  residualValue: "40",
  annualDistance: "30000",
  carTax: "included",
  subsidy: "applicable",
  subsidyAmount: "5000000",
  cmFeePercent: "1.5",
  agFeePercent: "2",
  dealerType: "input",
  dealer: "bnk-capital::모터원",
};

describe("scenarioQueryFingerprint (배치 7 A#3)", () => {
  it("A#3 회귀 잠금 — activeTab·deliveryType·maintenanceGrade 단독 변경이 fingerprint를 바꾼다", () => {
    const base = defaultScenario();
    const baseline = scenarioQueryFingerprint(base, TOP);
    // 종전 인라인 조립은 이 3필드 누락 — 리스 결과가 렌트 탭 아래 "조회 완료"로 오표시(재조회 불가)
    expect(scenarioQueryFingerprint({ ...base, activeTab: "rent" }, TOP)).not.toBe(baseline);
    expect(scenarioQueryFingerprint({ ...base, deliveryType: "special" }, TOP)).not.toBe(baseline);
    expect(scenarioQueryFingerprint({ ...base, maintenanceGrade: "vip" }, TOP)).not.toBe(baseline);
  });

  it("등록된 전 키는 각각 단독 변경으로 fingerprint를 바꾼다(민감도 전수)", () => {
    const base = defaultScenario();
    const baseline = scenarioQueryFingerprint(base, TOP);
    for (const key of SCENARIO_QUERY_KEYS) {
      expect(flipped[key], `flipped[${key}]가 기본값과 같아 민감도 검사가 무의미`).not.toBe(base[key]);
      const next: ScenarioState = { ...base, [key]: flipped[key] };
      expect(scenarioQueryFingerprint(next, TOP), `키 ${key} 변경이 fingerprint에 반영돼야 한다`).not.toBe(baseline);
    }
  });

  it("topLevel(차량/취득원가) 변경도 fingerprint를 바꾼다", () => {
    const base = defaultScenario();
    expect(scenarioQueryFingerprint(base, "top-level-2")).not.toBe(scenarioQueryFingerprint(base, TOP));
  });

  it("동일 입력은 동일 fingerprint(결정성 — 스냅샷 비교 전제)", () => {
    const base = defaultScenario();
    expect(scenarioQueryFingerprint(base, TOP)).toBe(scenarioQueryFingerprint({ ...base }, TOP));
  });
});
