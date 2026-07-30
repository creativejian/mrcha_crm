// 변경 요청 승인 시점의 드리프트 판정(순수 — DB 무관, test:pure 커버).
// snapshot(요청 시점 값)에 있는 키만 현재 값과 대조한다 — "payload가 건드리는 필드만"
// 규칙(spec §5.1)은 snapshot을 그 필드들로만 만들어 두는 것으로 성립한다.
// null/undefined는 동치("값 없음") — DB의 NULL과 select 누락이 서로 오탐하지 않게.
// 스냅샷·현재 값은 호출측(스냅샷 빌더)에서 동일 JS 타입(숫자/문자열/null)으로 정규화됐다고
// 가정한다 — 타입이 어긋나면(예: DB numeric의 문자열) 값이 같아도 드리프트로 오판된다(의도 — fail-closed).
export function detectSnapshotDrift(
  snapshot: Record<string, unknown>,
  current: Record<string, unknown>,
): string[] {
  const norm = (v: unknown) => (v === undefined ? null : v);
  return Object.keys(snapshot).filter((key) => !Object.is(norm(snapshot[key]), norm(current[key])));
}
