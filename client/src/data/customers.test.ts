import { describe, expect, it } from "vitest";

import {
  CONTRACT_ORDER_PATH_STATUSES,
  CONTRACTED_STATUS_GROUP,
  customerStatusGroups,
  IN_PROGRESS_STATUS_GROUPS,
} from "./customers";

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

// 경영 리포트 "상담 진행중"/"계약 완료" 집계 어휘(리포트 spec §2). 상태 그룹이 추가·개명되면
// 여기가 먼저 깨져서 리포트 숫자가 조용히 어긋나는 것을 막는다.
describe("IN_PROGRESS_STATUS_GROUPS", () => {
  it("종결 3그룹을 뺀 진행 6그룹이다", () => {
    expect(IN_PROGRESS_STATUS_GROUPS).toEqual(["신규", "상담중", "견적", "차량체크", "심사서류", "관리중"]);
  });

  it("customerStatusGroups의 부분집합이고 종결 3그룹과 겹치지 않는다", () => {
    for (const group of IN_PROGRESS_STATUS_GROUPS) {
      expect(Object.keys(customerStatusGroups)).toContain(group);
    }
    expect(IN_PROGRESS_STATUS_GROUPS).not.toContain("상담완료");
    expect(IN_PROGRESS_STATUS_GROUPS).not.toContain(CONTRACTED_STATUS_GROUP);
    expect(IN_PROGRESS_STATUS_GROUPS).not.toContain("불발");
  });

  it("진행중과 계약완료를 합쳐도 전체 그룹을 넘지 않는다 — 중복 집계 방지", () => {
    expect(customerStatusGroups[CONTRACTED_STATUS_GROUP]).toBeDefined();
    expect(IN_PROGRESS_STATUS_GROUPS.length + 1).toBeLessThanOrEqual(Object.keys(customerStatusGroups).length);
  });
});
