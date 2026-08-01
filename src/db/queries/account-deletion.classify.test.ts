import { expect, test } from "bun:test";

import { classifyDeliverySignals } from "./account-deletion";

// 자동 분류 제안의 순수 판정(회신 §1) — DB 무관이라 CI pure 러너에서 돈다(db-bound 미등록).
// 원칙: 계약·출고 흔적이 하나라도 있으면 purge를 제안하지 않는다(오삭제 방지).

test("출고 정보 행 없음 → purge", () => {
  expect(classifyDeliverySignals(null)).toBe("purge");
});

test("계약일·출고일 모두 없음 → purge", () => {
  expect(classifyDeliverySignals({ contractDate: null, deliveredDate: null })).toBe("purge");
});

test("계약일만 있음(출고 진행 중) → active_fulfillment", () => {
  expect(classifyDeliverySignals({ contractDate: "2026-07-01", deliveredDate: null })).toBe("active_fulfillment");
});

test("출고일 있음 → settlement_reference (계약일 유무 무관 — 출고 완료가 우선)", () => {
  expect(classifyDeliverySignals({ contractDate: null, deliveredDate: "2026-07-15" })).toBe("settlement_reference");
  expect(classifyDeliverySignals({ contractDate: "2026-07-01", deliveredDate: "2026-07-15" })).toBe("settlement_reference");
});
