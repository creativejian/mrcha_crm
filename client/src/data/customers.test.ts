import { describe, expect, it } from "vitest";

import { CONTRACT_ORDER_PATH_STATUSES, customerStatusGroups } from "./customers";

// 계약 진행 마킹 넛지의 발주 경로 어휘(2026-07-21 이사님 ①ⓑ, delivery-step2 spec §8).
// 진행 상태 어휘가 개명되면 두 테스트가 함께 깨져 한쪽만 바뀌는 드리프트를 막는다.
describe("CONTRACT_ORDER_PATH_STATUSES", () => {
  it("계약완료 2차 상태 어휘의 부분집합이다", () => {
    for (const status of CONTRACT_ORDER_PATH_STATUSES) {
      expect(customerStatusGroups["계약완료"]).toContain(status);
    }
  });

  it("발주 경로 3종만 담는다 — 배정완료·출고완료(발주 이후 단계)는 제외", () => {
    expect(CONTRACT_ORDER_PATH_STATUSES).toEqual(["딜러사계약중", "대리점발주중", "특판발주중"]);
  });
});
