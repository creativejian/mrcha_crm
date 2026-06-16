// catalog 거울 sync의 순수 로직 (IO 없음 → 단위테스트). 설계: ref/specs/2026-06-16-catalog-sync-design.md
// master REST는 snake_case, drizzle insert는 camelCase → projectRow가 화이트리스트 매핑을 담당.

export type SyncColumn = { prop: string; col: string };

/** catalog의 활성(deleted_at IS NULL) id 중 master 응답에 없는 id = soft-delete 대상. */
export function idsToSoftDelete<K>(masterIds: ReadonlySet<K>, catalogActiveIds: readonly K[]): K[] {
  return catalogActiveIds.filter((id) => !masterIds.has(id));
}

/** 배열을 size 단위 청크로 분할 (postgres 다중 VALUES 파라미터 한계 회피용 batch). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error(`chunk size must be >= 1, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** master REST row(snake_case 키)를 drizzle insert용 객체(camelCase prop)로 화이트리스트 투영. */
export function projectRow(
  row: Record<string, unknown>,
  columns: readonly SyncColumn[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { prop, col } of columns) {
    out[prop] = row[col];
  }
  return out;
}
