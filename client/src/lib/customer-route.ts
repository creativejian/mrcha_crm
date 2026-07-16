import { customerModeMeta, type CustomerMode } from "@/data/customers";

// 고객 목록 mode를 URL(?view=)에서 파생한다 — 드로어(?customer)와 같은 축으로 URL이 single source.
// 알 수 없는/없는 값은 all로 폴백. 딥링크·북마크·새로고침 유지·뒤로가기를 얻는다.
export function customerModeFromSearch(search: string): CustomerMode {
  const view = new URLSearchParams(search).get("view");
  return view && view in customerModeMeta ? (view as CustomerMode) : "all";
}

// 고객 목록 URL 조립 — mode(all은 view 생략)와 선택 고객(드로어)을 함께 얹는다.
// 목록 이동·드로어 열기/닫기·뒤로가기가 이 한 함수를 써서 현재 view를 잃지 않는다.
export function customerListPath(mode: CustomerMode, customerCode?: string): string {
  const params = new URLSearchParams();
  if (mode !== "all") params.set("view", mode);
  if (customerCode) params.set("customer", customerCode);
  const query = params.toString();
  return query ? `/customers?${query}` : "/customers";
}

// 선택 고객 코드를 URL에서 파생한다(App이 single source of truth로 사용).
// /customer-detail/:code → path의 code, /customers + ?customer= → 쿼리값, 그 외 → null.
export function customerCodeFromLocation(pathname: string, search: string): string | null {
  const detailMatch = pathname.match(/^\/customer-detail\/([^/]+)\/?$/);
  if (detailMatch) return decodeURIComponent(detailMatch[1]);
  if (pathname === "/customers") {
    const code = new URLSearchParams(search).get("customer");
    return code ? code : null;
  }
  return null;
}
