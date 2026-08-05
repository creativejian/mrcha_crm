// 정산 목록 노출 마스킹(2026-08-05) — **정산은 admin만 본다**(2026-08-03 유슨생 결정).
//
// 정산 라우트(`GET/PUT /:id/settlement`)는 `requireRoles(["admin"])`으로 막혀 있지만, 목록에
// 정산 컬럼(수수료·비용·마진·단계)을 그리려면 목록 응답에도 실어야 한다. 그때 전 역할에게
// 함께 나가면 **회사 수입이 통째로 샌다** — 화면에서 감춰도 응답 본문에 있으면 DevTools로 보인다.
// 그래서 서버가 비운다.
//
// ⚠️ role 판정을 **이 파일 한 곳에만** 둔다(`dealer-visibility.ts`와 같은 규칙) — 소비처가 각자
// 문자열을 비교하면 한쪽만 고쳐진다. 범위를 팀장까지 넓히려면 여기 한 줄과 정산 라우트의
// `requireRoles` 배열을 **함께** 고쳐야 한다(둘이 갈리면 "목록엔 보이는데 팝오버는 403"이 된다).
//
// 층 분리: 목록 **필터**(누구의 고객을 보는가)는 쿼리 안 WHERE(#301 scope), **가시성**(어떤 필드를
// 보는가)은 여기. `listCustomers`는 role을 모른 채 항상 정산을 뽑고, 라우트가 이 함수를 한 겹 씌운다.
type SettlementBearing = { settlement: unknown };

// 정산을 볼 수 있는 역할. 정산 라우트의 requireRoles(["admin"])와 **같은 값이어야 한다**.
const SETTLEMENT_VISIBLE_ROLES = ["admin"];

export function visibleSettlementFor<T extends SettlementBearing>(role: string, rows: T[]): T[] {
  if (SETTLEMENT_VISIBLE_ROLES.includes(role)) return rows;
  // 키는 남기고 값만 null — 응답 형태가 role에 따라 갈리면 클라 파싱이 두 갈래가 된다
  // (dealer-visibility.ts "원래 없던 키를 새로 만들지 않는다"의 대칭). 원본은 건드리지 않는다.
  return rows.map((row) => ({ ...row, settlement: null }));
}
