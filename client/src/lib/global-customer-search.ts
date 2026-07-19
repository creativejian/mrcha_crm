import type { Customer } from "@/data/customers";

// 상단 통합검색 결과 상한(팝오버가 6행까지 노출).
export const GLOBAL_SEARCH_LIMIT = 6;

// 검색 정규화 — 소문자화 + 공백/하이픈 제거(전화번호 하이픈·성명 공백 유무 무관 매칭).
export function normalizeSearchValue(value: string): string {
  return value.toLowerCase().replace(/[\s-]/g, "");
}

export type GlobalSearchResult = { hits: Customer[]; total: number };

// 상단 통합검색 필터(순수) — 실 고객 목록(App이 fetchCustomers로 로드한 것)을 대상으로 한다.
// 목록 검색(CustomerManagementPage)과 정규화 정합(normalizeSearchValue — 배치 9 A#1). 필드 집합은
// 부분만 겹친다(의도 — 배치 9 A#2): 통합검색은 식별 중심이라 customerId·no·statusGroup을 더 갖고,
// 목록-only 필드(직군 customerType/Detail·AI 힌트 어휘)는 전역 질의에서 노이즈라 뺐다("높음" 한 단어에
// 전 고객이 걸리는 류). 집합을 바꿀 땐 두 표면을 함께 판단할 것.
// 빈 질의는 결과 없음. hits는 최대 GLOBAL_SEARCH_LIMIT행, total은 컷 전 전체 매칭 수(캡 표기용 — A#4).
export function filterGlobalCustomerSearch(customers: Customer[], query: string): GlobalSearchResult {
  const normalized = normalizeSearchValue(query);
  if (!normalized) return { hits: [], total: 0 };
  const matched = customers.filter((customer) => {
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
  });
  return { hits: matched.slice(0, GLOBAL_SEARCH_LIMIT), total: matched.length };
}

// 캡 카운트 어휘(배치 9 A#4) — 상한 컷 후 "{n}명"만 보이면 6건이 총원처럼 읽힌다.
export function globalSearchCountLabel(total: number): string {
  return total > GLOBAL_SEARCH_LIMIT ? `${total}명 중 ${GLOBAL_SEARCH_LIMIT}명` : `${total}명`;
}

// 검색 빈 상태 어휘 3분기(배치 9 A#3) — 로딩/로드 실패가 데이터-부재 어휘("검색 결과 없음 …
// 다시 확인해주세요")로 읽히지 않게(fail-loud 어휘 관례 — 배치 8 dealerSelectPlaceholder 미러).
// loaded는 "fetch가 끝났다"는 뜻(실패 포함 — App reloadCustomers가 catch에서도 true로 세팅)이라
// error 분기가 선행해야 실패가 영원히 "로딩 중"으로 안 읽힌다.
export type GlobalSearchEmptyState = { title: string; hint: string };
export function globalSearchEmptyState(customersLoaded: boolean, customersError: boolean): GlobalSearchEmptyState {
  if (customersError) return { title: "고객 목록을 불러오지 못했습니다", hint: "네트워크 확인 후 새로고침해주세요." };
  if (!customersLoaded) return { title: "고객 목록을 불러오는 중입니다", hint: "잠시 후 검색 결과가 표시됩니다." };
  return { title: "검색 결과 없음", hint: "고객명, 연락처, 차량명, 고객번호를 다시 확인해주세요." };
}
