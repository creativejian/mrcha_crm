import { describe, expect, it } from "vitest";

import { toCustomer, type CustomerRow } from "./customers";

const row: CustomerRow = {
  id: "11111111-1111-1111-1111-111111111111",
  customerCode: "CU-2605-0020",
  name: "김민준",
  phone: "010-9588-0812",
  customerType: "개인",
  customerTypeDetail: "4대보험",
  team: "인천본사",
  source: "디엘(견적서)",
  statusGroup: "견적",
  status: "발송완료",
  priority: "긴급",
  aiSummary: "요약",
  needModel: "Maybach S-Class",
  needMethod: "운용리스",
  receivedAt: "2026-05-14T12:56:00+09:00",
  assignedAt: "2026-05-14T13:04:00+09:00",
  lastActivityAt: "2026-05-14T14:20:00+09:00",
  latestTask: "GLC 재고 확인",
};

describe("toCustomer", () => {
  it("customerCode를 customerId로, 숫자부분을 no로 파생", () => {
    const c = toCustomer(row);
    expect(c.customerId).toBe("CU-2605-0020");
    expect(c.no).toBe(26050020);
  });
  it("needModel/needMethod를 vehicle/method로, latestTask를 nextAction으로", () => {
    const c = toCustomer(row);
    expect(c.vehicle).toBe("Maybach S-Class");
    expect(c.method).toBe("운용리스");
    expect(c.nextAction).toBe("GLC 재고 확인");
  });
  it("advisor는 미배정 폴백, null 필드는 빈 문자열", () => {
    const c = toCustomer({ ...row, latestTask: null, phone: null });
    expect(c.advisor).toBe("미배정");
    expect(c.nextAction).toBe("");
    expect(c.phone).toBe("");
  });
});
