import { describe, expect, it } from "vitest";

import { formatActivity, toCustomer, toCustomerDetail, type CustomerDetailResponse, type CustomerRow } from "./customers";

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
  chance: null,
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
  it("id(uuid)를 그대로 전달", () => {
    expect(toCustomer(row).id).toBe("11111111-1111-1111-1111-111111111111");
  });
  it("chance를 전달(없으면 undefined)", () => {
    expect(toCustomer({ ...row, chance: "높음" }).chance).toBe("높음");
    expect(toCustomer(row).chance).toBeUndefined();
  });
});

describe("formatActivity", () => {
  it("null/빈값은 빈 문자열", () => {
    expect(formatActivity(null)).toBe("");
    expect(formatActivity("")).toBe("");
  });
  it("잘못된 값은 빈 문자열", () => {
    expect(formatActivity("nope")).toBe("");
  });
  it("타임스탬프를 YY/MM/DD HH:mm 형태로 (TZ 무관)", () => {
    expect(formatActivity("2026-05-14T13:18:00+09:00")).toMatch(/^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  });
});

const detailRes: CustomerDetailResponse = {
  id: "uuid-1",
  customerCode: "CU-2605-0020",
  name: "김민준",
  phone: "010-9588-0812",
  residence: "인천광역시",
  customerType: "개인",
  customerTypeDetail: "4대보험",
  source: "디엘(견적서)",
  assignedAt: null,
  receivedAt: "2026-05-14T12:56:00+09:00",
  needModel: "Maybach S-Class",
  needTrim: "S 500 4M Long",
  needColors: "외장 컬러 미정 · 내장 컬러 미정",
  needMethod: "운용리스",
  needTiming: "좋은 조건 즉시",
  needMemo: "비교 정리 필요",
  tasks: [{ id: "t1", category: "체크", due: "오늘", body: "GLC 재고", done: false }],
  schedules: [{ id: "s1", scheduledDate: "2026-05-26", scheduledTime: "16:00", type: "견적", memo: "재발송" }],
  memos: [{ id: "m1", body: "메모1", createdAt: "2026-05-14T13:18:00+09:00" }],
  documents: [{ id: "d1", title: "주민등록등본", docType: "자동인식", fileName: "f.pdf", fileSize: 100, fileMime: "application/pdf" }],
};

describe("toCustomerDetail", () => {
  it("고객 본체 필드와 니즈 상세를 전달", () => {
    const d = toCustomerDetail(detailRes);
    expect(d.name).toBe("김민준");
    expect(d.needTrim).toBe("S 500 4M Long");
    expect(d.needTiming).toBe("좋은 조건 즉시");
    expect(d.residence).toBe("인천광역시");
  });
  it("자식 배열(tasks/schedules/memos/documents)을 전달", () => {
    const d = toCustomerDetail(detailRes);
    expect(d.tasks).toHaveLength(1);
    expect(d.schedules[0].scheduledDate).toBe("2026-05-26");
    expect(d.memos[0].body).toBe("메모1");
    expect(d.documents[0].docType).toBe("자동인식");
  });
  it("자식 배열 누락 시 빈 배열로 방어", () => {
    const partial = { ...detailRes, tasks: undefined } as unknown as CustomerDetailResponse;
    expect(toCustomerDetail(partial).tasks).toEqual([]);
  });
});
