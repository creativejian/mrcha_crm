import { describe, expect, test } from "bun:test";

import { pickPrimaryScenario } from "./primary-scenario";

const scenarios = [
  { id: "sc-1", label: "첫번째" },
  { id: "sc-2", label: "두번째" },
  { id: "sc-3", label: "세번째" },
];

describe("pickPrimaryScenario", () => {
  test("primaryScenarioId 일치 요소가 있으면 그 요소를 반환한다", () => {
    expect(pickPrimaryScenario(scenarios, "sc-2")).toBe(scenarios[1]);
  });

  test("불일치 id·null이면 첫 요소(scenario_no asc 정렬 전제) 폴백", () => {
    expect(pickPrimaryScenario(scenarios, "sc-없음")).toBe(scenarios[0]);
    expect(pickPrimaryScenario(scenarios, null)).toBe(scenarios[0]);
  });

  test("빈 배열이면 null", () => {
    expect(pickPrimaryScenario([], "sc-1")).toBeNull();
    expect(pickPrimaryScenario([], null)).toBeNull();
  });
});
