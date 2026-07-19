import { describe, expect, it } from "vitest";

import type { Customer } from "@/data/customers";
import { GLOBAL_SEARCH_LIMIT, filterGlobalCustomerSearch } from "./global-customer-search";

function makeCustomer(over: Partial<Customer>): Customer {
  return {
    no: 1,
    customerId: "CU-2605-0001",
    receivedAt: "",
    assignedAt: "",
    team: "",
    name: "김민준",
    customerType: "",
    customerTypeDetail: "",
    phone: "010-9588-0812",
    vehicle: "Maybach S-Class",
    method: "",
    advisor: "김지안",
    statusGroup: "",
    status: "견적",
    date: "",
    source: "앱 견적비교",
    talkCount: "",
    priority: "",
    nextAction: "",
    aiSummary: "",
    ...over,
  };
}

describe("filterGlobalCustomerSearch", () => {
  const customers = [
    makeCustomer({ name: "김민준", customerId: "CU-2605-0020", phone: "010-9588-0812" }),
    makeCustomer({ name: "박서연", customerId: "CU-2605-0011", phone: "010-1234-5678", advisor: "이주선" }),
    makeCustomer({ name: "이도윤", customerId: "CU-2605-0007", phone: "010-7777-6666", vehicle: "GV80" }),
  ];

  it("빈 질의는 결과 없음", () => {
    expect(filterGlobalCustomerSearch(customers, "")).toEqual([]);
    expect(filterGlobalCustomerSearch(customers, "   ")).toEqual([]);
  });

  it("실 고객 목록을 대상으로 이름 매칭", () => {
    const hits = filterGlobalCustomerSearch(customers, "박서연");
    expect(hits.map((c) => c.customerId)).toEqual(["CU-2605-0011"]);
  });

  it("전화번호는 하이픈 유무 무관 매칭", () => {
    expect(filterGlobalCustomerSearch(customers, "010-7777-6666").map((c) => c.name)).toEqual(["이도윤"]);
    expect(filterGlobalCustomerSearch(customers, "01077776666").map((c) => c.name)).toEqual(["이도윤"]);
  });

  it("고객번호·차량명·담당자로도 매칭", () => {
    expect(filterGlobalCustomerSearch(customers, "CU-2605-0020").map((c) => c.name)).toEqual(["김민준"]);
    expect(filterGlobalCustomerSearch(customers, "GV80").map((c) => c.name)).toEqual(["이도윤"]);
    expect(filterGlobalCustomerSearch(customers, "이주선").map((c) => c.name)).toEqual(["박서연"]);
  });

  it("추가 연락처(phoneSecondary)도 검색 대상 — 목록 검색과 정합", () => {
    const withSecondary = [makeCustomer({ name: "김민준", phone: "010-9588-0812", phoneSecondary: "010-1233-4444" })];
    expect(filterGlobalCustomerSearch(withSecondary, "1233-4444").map((c) => c.name)).toEqual(["김민준"]);
  });

  // 배치 9 A#6: haystack 필드 잠금 — 아래 필드를 haystack에서 빼는 변이가 조용히 통과하던 사각 해소.
  it("진행 상태·상태 그룹·유입 경로로도 매칭(필드 잠금)", () => {
    const rows = [
      makeCustomer({ name: "상태보유", customerId: "CU-2605-0001", status: "출고완료", statusGroup: "계약완료", source: "유튜브" }),
      makeCustomer({ name: "상태무관", customerId: "CU-2605-0002", status: "견적", statusGroup: "견적", source: "앱 견적비교" }),
    ];
    expect(filterGlobalCustomerSearch(rows, "출고완료").map((c) => c.name)).toEqual(["상태보유"]);
    expect(filterGlobalCustomerSearch(rows, "계약완료").map((c) => c.name)).toEqual(["상태보유"]);
    expect(filterGlobalCustomerSearch(rows, "유튜브").map((c) => c.name)).toEqual(["상태보유"]);
  });

  it("질의 내부 공백은 무시 — '김 민준'도 김민준 매칭", () => {
    expect(filterGlobalCustomerSearch(customers, "김 민준").map((c) => c.name)).toEqual(["김민준"]);
  });

  it(`결과는 최대 ${GLOBAL_SEARCH_LIMIT}행`, () => {
    const many = Array.from({ length: 10 }, (_, i) => makeCustomer({ name: `공유고객`, customerId: `CU-2605-00${i}` }));
    expect(filterGlobalCustomerSearch(many, "공유고객")).toHaveLength(GLOBAL_SEARCH_LIMIT);
  });
});
