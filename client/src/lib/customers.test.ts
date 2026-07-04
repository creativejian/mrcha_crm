import { describe, expect, it } from "vitest";

import { formatActivity, toCustomer, toCustomerDetail, type CustomerDetailResponse, type CustomerRow } from "./customers";

const row: CustomerRow = {
  id: "11111111-1111-1111-1111-111111111111",
  customerCode: "CU-2605-0020",
  name: "김민준",
  phone: "010-9588-0812",
  appUserId: null,
  customerType: "개인",
  customerTypeDetail: "4대보험",
  advisorName: null,
  team: "인천본사",
  source: "디엘(견적서)",
  statusGroup: "견적",
  status: "발송완료",
  priority: "긴급",
  aiSummary: "요약",
  needModel: "Maybach S-Class",
  needTrim: "S 500 4M Long",
  needMethod: "운용리스",
  receivedAt: "2026-05-14T12:56:00+09:00",
  assignedAt: "2026-05-14T13:04:00+09:00",
  lastActivityAt: "2026-05-14T14:20:00+09:00",
  recontacted: false,
  latestTask: "GLC 재고 확인",
  chance: null,
};

describe("toCustomer", () => {
  it("customerCode를 customerId로, 숫자부분을 no로 파생", () => {
    const c = toCustomer(row);
    expect(c.customerId).toBe("CU-2605-0020");
    expect(c.no).toBe(26050020);
  });
  it("needModel/needTrim/needMethod를 vehicle/vehicleTrim/method로, latestTask를 nextAction으로", () => {
    const c = toCustomer(row);
    expect(c.vehicle).toBe("Maybach S-Class");
    expect(c.vehicleTrim).toBe("S 500 4M Long");
    expect(c.method).toBe("운용리스");
    expect(c.nextAction).toBe("GLC 재고 확인");
  });
  it("needTrim 없으면 vehicleTrim은 undefined(목록은 트림 미확인 폴백)", () => {
    expect(toCustomer({ ...row, needTrim: null }).vehicleTrim).toBeUndefined();
  });
  it("advisor는 미배정 폴백, null 필드는 빈 문자열", () => {
    const c = toCustomer({ ...row, latestTask: null, phone: null });
    expect(c.advisor).toBe("미배정");
    expect(c.nextAction).toBe("");
    expect(c.phone).toBe("");
  });
  it("advisorName 있으면 advisor는 이름만(team은 별도 컬럼)", () => {
    const c = toCustomer({ ...row, advisorName: "김지안" });
    expect(c.advisor).toBe("김지안");
    expect(c.team).toBe("인천본사");
  });
  it("id(uuid)를 그대로 전달", () => {
    expect(toCustomer(row).id).toBe("11111111-1111-1111-1111-111111111111");
  });
  it("chance를 전달(없으면 undefined)", () => {
    expect(toCustomer({ ...row, chance: "높음" }).chance).toBe("높음");
    expect(toCustomer(row).chance).toBeUndefined();
  });
  it("appUserId를 관통시킨다 (앱 유입 고객 매칭용)", () => {
    expect(toCustomer({ ...row, appUserId: "app-u1" }).appUserId).toBe("app-u1");
    expect(toCustomer({ ...row, appUserId: null }).appUserId).toBeNull();
  });
  it("lastActivityAt(raw ISO)·recontacted를 관통시킨다 (관리 상태 파생 입력)", () => {
    const c = toCustomer(row);
    expect(c.lastActivityAt).toBe(row.lastActivityAt);
    expect(c.recontacted).toBe(false);
    expect(toCustomer({ ...row, recontacted: true }).recontacted).toBe(true);
    expect(toCustomer({ ...row, lastActivityAt: null }).lastActivityAt).toBeNull();
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
  advisorName: "김지안",
  team: "인천본사",
  assignedAt: null,
  receivedAt: "2026-05-14T12:56:00+09:00",
  appUserId: "user-1",
  needModel: "Maybach S-Class",
  needTrim: "S 500 4M Long",
  needColors: "외장 컬러 미정 · 내장 컬러 미정",
  needMethod: "운용리스",
  needTiming: "좋은 조건 즉시",
  needMemo: "비교 정리 필요",
  needContractTerm: "36개월",
  needInitialCost: "보증금 30%",
  needAnnualMileage: "20,000km",
  needDeliveryMethod: "탁송 요청",
  needContractFocus: "#월 납입 최소",
  needCustomerNote: "#카톡 선호",
  needReviewNote: null,
  tasks: [{ id: "t1", category: "체크", due: "오늘", body: "GLC 재고", done: false }],
  schedules: [{ id: "s1", scheduledDate: "2026-05-26", scheduledTime: "16:00", type: "견적", memo: "재발송", done: false }],
  memos: [{ id: "m1", body: "메모1", createdAt: "2026-05-14T13:18:00+09:00" }],
  documents: [{ id: "d1", docType: "자동인식", fileName: "f.pdf", fileSize: 100, fileMime: "application/pdf", sortOrder: 1, createdAt: "2026-05-14T13:18:00+09:00" }],
  quotes: [
    {
      id: "q1",
      quoteCode: "QT-2606-0001",
      entryMode: "solution",
      quoteRound: "1차",
      brandName: "벤츠",
      modelName: "Maybach S-Class",
      trimName: "S 500 4M Long",
      status: "고객 확인 전",
      appStatus: "sent",
      decisionStatus: "none",
      stockStatus: "재고있음",
      note: null,
      validUntil: null,
      sentAt: null,
      viewedAt: null,
      revision: 0,
      primaryScenarioId: "s1",
      basePrice: null,
      optionTotal: null,
      finalDiscount: null,
      acquisitionTax: null,
      bond: null,
      delivery: null,
      incidental: null,
      finalVehiclePrice: null,
      acquisitionCost: null,
      trimId: null,
      exteriorColorId: null,
      interiorColorId: null,
      options: null,
      exteriorColorName: null,
      exteriorColorHex: null,
      interiorColorName: null,
      interiorColorHex: null,
      fileName: null,
      fileSize: null,
      fileMime: null,
      guidance: null,
      scenarios: [{ id: "s1", scenarioNo: 1, purchaseMethod: "운용리스", lender: "iM캐피탈", termMonths: 60, monthlyPayment: "2473200", depositMode: null, depositValue: null, downPaymentMode: null, downPaymentValue: null, residualMode: null, residualValue: null, mileageMode: null, mileageValue: null, isSaved: false }],
    },
  ],
};

describe("toCustomerDetail", () => {
  it("고객 본체 필드와 니즈 상세를 전달", () => {
    const d = toCustomerDetail(detailRes);
    expect(d.name).toBe("김민준");
    expect(d.needTrim).toBe("S 500 4M Long");
    expect(d.needTiming).toBe("좋은 조건 즉시");
    expect(d.residence).toBe("인천광역시");
    expect(d.advisorName).toBe("김지안");
    expect(d.team).toBe("인천본사");
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
  it("quotes(+scenarios)를 그대로 전달, 누락 시 빈 배열", () => {
    const d = toCustomerDetail(detailRes);
    expect(d.quotes).toHaveLength(1);
    expect(d.quotes[0].quoteCode).toBe("QT-2606-0001");
    expect(d.quotes[0].scenarios[0].purchaseMethod).toBe("운용리스");
    const partial = { ...detailRes, quotes: undefined } as unknown as CustomerDetailResponse;
    expect(toCustomerDetail(partial).quotes).toEqual([]);
  });
  it("appUserId를 그대로 전달(앱 유입 여부 분기용)", () => {
    expect(toCustomerDetail(detailRes).appUserId).toBe("user-1");
    expect(toCustomerDetail({ ...detailRes, appUserId: null }).appUserId).toBeNull();
  });
  it("구매조건 7필드를 그대로 전달", () => {
    const d = toCustomerDetail(detailRes);
    expect(d.needContractTerm).toBe("36개월");
    expect(d.needInitialCost).toBe("보증금 30%");
    expect(d.needAnnualMileage).toBe("20,000km");
    expect(d.needDeliveryMethod).toBe("탁송 요청");
    expect(d.needContractFocus).toBe("#월 납입 최소");
    expect(d.needCustomerNote).toBe("#카톡 선호");
    expect(d.needReviewNote).toBeNull();
  });
});
