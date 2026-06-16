// catalog 거울 full-sync 오케스트레이션 + CLI. `bun run sync`.
// 흐름: fetch → 검증(rows==total) → upsert(deleted_at=NULL 부활) → soft-delete(검증 통과 시만).
// 설계: ref/specs/2026-06-16-catalog-sync-design.md
import { and, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "../db/client";
import { chunk, idsToSoftDelete, projectRow } from "./sync-diff";
import { syncTables, type SyncTable } from "./sync-tables";
import { fetchMasterTable } from "./master-client";

// postgres 다중 VALUES 파라미터 한계(65535) 안전 예산. 청크당 rows*cols <= 이 값.
const INSERT_PARAM_BUDGET = 60_000;
const DELETE_BATCH = 1000;

type TableResult = {
  name: string;
  fetched: number;
  total: number;
  complete: boolean;
  upserted: number;
  softDeleted: number;
};

/** ON CONFLICT DO UPDATE SET: PK 제외 모든 컬럼을 EXCLUDED 값으로, deleted_at은 NULL(부활). */
function excludedSet(meta: SyncTable): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const { prop, col } of meta.columns) {
    if (prop === meta.pkProp) continue;
    set[prop] = sql.raw(`excluded.${col}`);
  }
  set.deletedAt = sql`NULL`;
  return set;
}

async function syncTable(meta: SyncTable): Promise<TableResult> {
  const { rows, total } = await fetchMasterTable(meta);
  const complete = rows.length === total;

  // upsert (부모 먼저는 syncTables 순서가 보장)
  const projected = rows.map((r) => projectRow(r, meta.columns));
  const batchSize = Math.max(1, Math.floor(INSERT_PARAM_BUDGET / meta.columns.length));
  const set = excludedSet(meta);
  for (const batch of chunk(projected, batchSize)) {
    await db
      .insert(meta.table)
      .values(batch as never)
      .onConflictDoUpdate({ target: meta.pkColumn as never, set: set as never });
  }

  // soft-delete: master에 없는 catalog 활성 id. 불완전 fetch면 스킵.
  let softDeleted = 0;
  if (complete) {
    const activeRows = (await db
      .select({ pk: meta.pkColumn })
      .from(meta.table as never)
      .where(isNull(meta.deletedAtColumn))) as { pk: number }[];
    const masterIds = new Set(rows.map((r) => r[meta.pkCol] as number));
    const toDelete = idsToSoftDelete(
      masterIds,
      activeRows.map((r) => r.pk),
    );
    for (const batch of chunk(toDelete, DELETE_BATCH)) {
      await db
        .update(meta.table)
        .set({ deletedAt: sql`now()` } as never)
        .where(and(inArray(meta.pkColumn, batch), isNull(meta.deletedAtColumn)));
      softDeleted += batch.length;
    }
  }

  return { name: meta.name, fetched: rows.length, total, complete, upserted: rows.length, softDeleted };
}

async function main(): Promise<void> {
  console.log("catalog full-sync 시작\n");
  const results: TableResult[] = [];
  for (const meta of syncTables) {
    const r = await syncTable(meta);
    const flag = r.complete ? "OK" : "SKIP(soft-delete)";
    console.log(
      `  ${r.name.padEnd(22)} fetch ${r.fetched}/${r.total} · upsert ${r.upserted} · soft-delete ${r.softDeleted} · 검증 ${flag}`,
    );
    results.push(r);
  }
  const incomplete = results.filter((r) => !r.complete);
  console.log("\ncatalog full-sync 완료.");
  if (incomplete.length) {
    console.warn(
      `경고: ${incomplete.map((r) => r.name).join(", ")} 불완전 fetch → soft-delete 스킵됨. 재실행 권장.`,
    );
  }
  await db.$client.end();
}

await main();
