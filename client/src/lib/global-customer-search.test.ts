import { describe, expect, it } from "vitest";

import type { Customer } from "@/data/customers";
import { GLOBAL_SEARCH_LIMIT, filterGlobalCustomerSearch, globalSearchCountLabel, globalSearchEmptyState, resolveRecentSearchCustomers } from "./global-customer-search";

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
    expect(filterGlobalCustomerSearch(customers, "")).toEqual({ hits: [], total: 0 });
    expect(filterGlobalCustomerSearch(customers, "   ")).toEqual({ hits: [], total: 0 });
  });

  it("실 고객 목록을 대상으로 이름 매칭", () => {
    const { hits } = filterGlobalCustomerSearch(customers, "박서연");
    expect(hits.map((c) => c.customerId)).toEqual(["CU-2605-0011"]);
  });

  it("전화번호는 하이픈 유무 무관 매칭", () => {
    expect(filterGlobalCustomerSearch(customers, "010-7777-6666").hits.map((c) => c.name)).toEqual(["이도윤"]);
    expect(filterGlobalCustomerSearch(customers, "01077776666").hits.map((c) => c.name)).toEqual(["이도윤"]);
  });

  it("고객번호·차량명·담당자로도 매칭", () => {
    expect(filterGlobalCustomerSearch(customers, "CU-2605-0020").hits.map((c) => c.name)).toEqual(["김민준"]);
    expect(filterGlobalCustomerSearch(customers, "GV80").hits.map((c) => c.name)).toEqual(["이도윤"]);
    expect(filterGlobalCustomerSearch(customers, "이주선").hits.map((c) => c.name)).toEqual(["박서연"]);
  });

  it("추가 연락처(phoneSecondary)도 검색 대상 — 목록 검색과 정합", () => {
    const withSecondary = [makeCustomer({ name: "김민준", phone: "010-9588-0812", phoneSecondary: "010-1233-4444" })];
    expect(filterGlobalCustomerSearch(withSecondary, "1233-4444").hits.map((c) => c.name)).toEqual(["김민준"]);
  });

  // 배치 9 A#6: haystack 필드 잠금 — 아래 필드를 haystack에서 빼는 변이가 조용히 통과하던 사각 해소.
  it("진행 상태·상태 그룹·유입 경로로도 매칭(필드 잠금)", () => {
    const rows = [
      makeCustomer({ name: "상태보유", customerId: "CU-2605-0001", status: "출고완료", statusGroup: "계약완료", source: "유튜브" }),
      makeCustomer({ name: "상태무관", customerId: "CU-2605-0002", status: "견적", statusGroup: "견적", source: "앱 견적비교" }),
    ];
    expect(filterGlobalCustomerSearch(rows, "출고완료").hits.map((c) => c.name)).toEqual(["상태보유"]);
    expect(filterGlobalCustomerSearch(rows, "계약완료").hits.map((c) => c.name)).toEqual(["상태보유"]);
    expect(filterGlobalCustomerSearch(rows, "유튜브").hits.map((c) => c.name)).toEqual(["상태보유"]);
  });

  it("질의 내부 공백은 무시 — '김 민준'도 김민준 매칭", () => {
    expect(filterGlobalCustomerSearch(customers, "김 민준").hits.map((c) => c.name)).toEqual(["김민준"]);
  });

  // 배치 9 A#4: hits는 상한 컷, total은 컷 전 전체 매칭 수 — "6명"이 총원처럼 읽히던 것의 근거 데이터.
  it(`상한 초과 매칭은 hits만 최대 ${GLOBAL_SEARCH_LIMIT}행으로 컷하고 total은 전체 수`, () => {
    const many = Array.from({ length: 10 }, (_, i) => makeCustomer({ name: `공유고객`, customerId: `CU-2605-00${i}` }));
    const result = filterGlobalCustomerSearch(many, "공유고객");
    expect(result.hits).toHaveLength(GLOBAL_SEARCH_LIMIT);
    expect(result.total).toBe(10);
  });
});

// 배치 9 A#4: 캡 표기 어휘 — 상한 도달 시 총원과 표시 수를 함께.
describe("globalSearchCountLabel", () => {
  it("상한 이하는 총원 그대로, 초과는 '총 N명 중 6명'", () => {
    expect(globalSearchCountLabel(3)).toBe("3명");
    expect(globalSearchCountLabel(GLOBAL_SEARCH_LIMIT)).toBe(`${GLOBAL_SEARCH_LIMIT}명`);
    expect(globalSearchCountLabel(10)).toBe(`10명 중 ${GLOBAL_SEARCH_LIMIT}명`);
  });
});

// 배치 9 A#5: recent는 클릭 시점 스냅샷 — 현재 customers에서 id로 재해석해야 삭제 고객이 숨고
// (잔존 시 클릭 → 거짓 성공 토스트+드로어 미오픈) 스냅샷 이후 수정도 최신으로 보인다.
describe("resolveRecentSearchCustomers", () => {
  const snapA = makeCustomer({ name: "김민준", customerId: "CU-2605-0020" });
  const snapB = makeCustomer({ name: "박서연", customerId: "CU-2605-0011" });

  it("현재 목록에 없는(삭제된) 고객은 숨긴다", () => {
    const current = [makeCustomer({ name: "박서연", customerId: "CU-2605-0011" })];
    expect(resolveRecentSearchCustomers([snapA, snapB], current).map((c) => c.customerId)).toEqual(["CU-2605-0011"]);
  });

  it("표시값은 스냅샷이 아니라 현재 customers 기준(수정 반영)", () => {
    const current = [makeCustomer({ name: "김민준(개명)", customerId: "CU-2605-0020", phone: "010-0000-1111" })];
    const resolved = resolveRecentSearchCustomers([snapA], current);
    expect(resolved.map((c) => c.name)).toEqual(["김민준(개명)"]);
    expect(resolved.map((c) => c.phone)).toEqual(["010-0000-1111"]);
  });

  it("순서는 recent 클릭 순서를 유지한다", () => {
    const current = [snapB, snapA];
    expect(resolveRecentSearchCustomers([snapA, snapB], current).map((c) => c.customerId)).toEqual([
      "CU-2605-0020",
      "CU-2605-0011",
    ]);
  });
});

// 배치 9 A#3: 빈 상태 3분기 — 로드 실패/로딩 중이 데이터-부재 어휘("검색 결과 없음")로 안 읽히게.
describe("globalSearchEmptyState", () => {
  it("로드 실패가 최우선 — loaded 여부와 무관하게 실패 어휘", () => {
    expect(globalSearchEmptyState(true, true).title).toBe("고객 목록을 불러오지 못했습니다");
    expect(globalSearchEmptyState(false, true).title).toBe("고객 목록을 불러오지 못했습니다");
  });

  it("로드 전이면 로딩 어휘", () => {
    expect(globalSearchEmptyState(false, false).title).toBe("고객 목록을 불러오는 중입니다");
  });

  it("로드 완료·에러 없음 = 진짜 결과 없음(기존 어휘 유지)", () => {
    const state = globalSearchEmptyState(true, false);
    expect(state.title).toBe("검색 결과 없음");
    expect(state.hint).toBe("고객명, 연락처, 차량명, 고객번호를 다시 확인해주세요.");
  });
});
