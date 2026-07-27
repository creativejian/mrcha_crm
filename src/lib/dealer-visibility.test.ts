import { expect, test } from "bun:test";

import { visibleTrimFor, visibleTrimsFor } from "./dealer-visibility";

// 딜러에게 확정 할인을 감추는 계약(2026-07-27). 순수 함수라 이 파일은 DB에 붙지 않는다
// → test:pure(CI)가 돌린다. 실제 HTTP 응답은 routes/dealer.role-gate.test.ts가 잠근다.

const TRIM = {
  id: 708,
  trimName: "523d",
  price: 76_800_000,
  financialDiscountAmount: 5_000_000,
  partnerDiscountAmount: 6_000_000,
  cashDiscountAmount: 7_000_000,
  discountUpdatedAt: "2026-07-27T13:43:35.645Z",
};

test("딜러에게는 확정 3금액과 할인변경일이 비워진다", () => {
  const [masked] = visibleTrimsFor("dealer", [TRIM]);
  expect(masked!.financialDiscountAmount).toBeNull();
  expect(masked!.partnerDiscountAmount).toBeNull();
  expect(masked!.cashDiscountAmount).toBeNull();
  // 금액만 감추고 변경일을 남기면 "경쟁 딜러 제안이 채택된 시점"이 샌다.
  expect(masked!.discountUpdatedAt).toBeNull();
});

test("딜러가 아닌 role은 원값을 받는다", () => {
  for (const role of ["admin", "staff", "manager"]) {
    const [row] = visibleTrimsFor(role, [TRIM]);
    expect(row!.financialDiscountAmount).toBe(5_000_000);
    expect(row!.discountUpdatedAt).toBe(TRIM.discountUpdatedAt);
  }
});

test("할인 외 필드는 보존된다(가격·트림명은 앱 공개 정보라 감출 대상이 아니다)", () => {
  const [masked] = visibleTrimsFor("dealer", [TRIM]);
  expect(masked!.id).toBe(708);
  expect(masked!.trimName).toBe("523d");
  expect(masked!.price).toBe(76_800_000);
});

test("원래 없던 discountUpdatedAt 키를 새로 만들지 않는다(응답 형태가 role에 따라 갈리면 안 된다)", () => {
  // 견적용 트림 상세(queries/vehicles.ts getTrimDetail)는 3금액만 싣고 할인변경일이 없다.
  const detail = { id: 708, financialDiscountAmount: 1, partnerDiscountAmount: 2, cashDiscountAmount: 3 };
  const masked = visibleTrimFor("dealer", detail);
  expect("discountUpdatedAt" in masked).toBe(false);
  expect(masked.financialDiscountAmount).toBeNull();
});

test("단일 트림도 role 판정이 같다", () => {
  expect(visibleTrimFor("admin", TRIM).financialDiscountAmount).toBe(5_000_000);
  expect(visibleTrimFor("dealer", TRIM).financialDiscountAmount).toBeNull();
});

test("빈 목록도 안전하다", () => {
  expect(visibleTrimsFor("dealer", [])).toEqual([]);
});
