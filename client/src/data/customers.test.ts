import { describe, expect, it } from "vitest";

import {
  CONTRACT_ORDER_PATH_STATUSES,
  CONTRACTED_STATUS_GROUP,
  customerStatusGroups,
  IN_PROGRESS_STATUS_GROUPS,
  PURCHASE_METHOD_OPTIONS,
  REVENUE_BASIS_BY_PURCHASE_METHOD,
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

// 실적 산정 기준(이사님 확정 2026-08-03). 구매방식 어휘가 개명되면 여기가 먼저 깨져서
// 실적이 조용히 0으로 빠지는 것을 막는다.
describe("REVENUE_BASIS_BY_PURCHASE_METHOD", () => {
  it("운용리스=취득원가 · 장기렌트=최종차량가", () => {
    expect(REVENUE_BASIS_BY_PURCHASE_METHOD["운용리스"]).toBe("acquisitionCost");
    expect(REVENUE_BASIS_BY_PURCHASE_METHOD["장기렌트"]).toBe("finalVehiclePrice");
  });

  it("키는 실제 구매방식 어휘여야 한다 — 오타면 실적이 영구 0이 된다", () => {
    for (const method of Object.keys(REVENUE_BASIS_BY_PURCHASE_METHOD)) {
      expect(PURCHASE_METHOD_OPTIONS).toContain(method);
    }
  });

  it("나머지 구매방식은 실적 집계 대상이 아니다(0이 아니라 '없음')", () => {
    // 할부·중고리스는 슬라이딩 수수료 개념이 없어 실입금액이 곧 매출이다(이사님 명시).
    // ✅ **금융리스·일시불도 동일**(이사님 확정 2026-08-04 — "할부/중고리스와 동일, 실적은 없고
    // 매출은 실입금 자체"). 정의가 없던 동안 방어적으로 빼 뒀던 상태가 그대로 정답이 됐다 —
    // 구현 변경 0건. 이 4종이 `PURCHASE_METHOD_OPTIONS` 6종에서 실적 대상 2종을 뺀 나머지 전부다.
    for (const method of ["할부", "중고리스", "금융리스", "일시불"]) {
      expect(REVENUE_BASIS_BY_PURCHASE_METHOD[method]).toBeUndefined();
    }
  });
});
