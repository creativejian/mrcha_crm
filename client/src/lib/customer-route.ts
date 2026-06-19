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
