import type { Customer } from "@/data/customers";

// 상단 통합검색 결과 상한(팝오버가 6행까지 노출).
export const GLOBAL_SEARCH_LIMIT = 6;

// 검색 정규화 — 소문자화 + 공백/하이픈 제거(전화번호 하이픈·성명 공백 유무 무관 매칭).
export function normalizeSearchValue(value: string): string {
  return value.toLowerCase().replace(/[\s-]/g, "");
}

// 상단 통합검색 필터(순수) — 실 고객 목록(App이 fetchCustomers로 로드한 것)을 대상으로 한다.
// 목록 검색(CustomerManagementPage)과 필드 정합: 추가 연락처(phoneSecondary)도 포함(배치 8 C#4).
// 빈 질의는 결과 없음, 최대 GLOBAL_SEARCH_LIMIT행.
export function filterGlobalCustomerSearch(customers: Customer[], query: string): Customer[] {
  const normalized = normalizeSearchValue(query);
  if (!normalized) return [];
  return customers
    .filter((customer) => {
      const haystack = normalizeSearchValue([
        customer.name,
        customer.phone,
        customer.phoneSecondary ?? "",
        customer.customerId,
        String(customer.no),
        customer.vehicle,
        customer.status,
        customer.statusGroup,
        customer.advisor,
        customer.source,
      ].join(" "));
      return haystack.includes(normalized);
    })
    .slice(0, GLOBAL_SEARCH_LIMIT);
}
