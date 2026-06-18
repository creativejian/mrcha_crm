import { count } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import {
  brandsInCatalog,
  colorsInCatalog,
  modelsInCatalog,
  trimNoOptionsInCatalog,
  trimOptionRelationsInCatalog,
  trimOptionsInCatalog,
  trimsInCatalog,
} from "../catalog";
import { getDefaultDb, type Executor } from "../client";

export type CatalogCounts = {
  brands: number;
  models: number;
  trims: number;
  trimOptions: number;
  colors: number;
  trimNoOptions: number;
  trimOptionRelations: number;
};

// master catalog엔 deleted_at(거울 전용)이 없으므로 전체 행을 센다.
async function tableCount(table: PgTable, executor: Executor): Promise<number> {
  const [row] = await executor.select({ c: count() }).from(table);
  return row?.c ?? 0;
}

// 순차 await: counts는 저빈도이고, Promise.all 7개 동시 쿼리는 connection pool(session mode, pool_size 15)을
// 빠르게 소진한다(dev 서버 연결과 겹치면 EMAXCONNSESSION). 연결을 1개씩 재사용하도록 순차 실행.
export async function getCatalogCounts(executor: Executor = getDefaultDb()): Promise<CatalogCounts> {
  return {
    brands: await tableCount(brandsInCatalog, executor),
    models: await tableCount(modelsInCatalog, executor),
    trims: await tableCount(trimsInCatalog, executor),
    trimOptions: await tableCount(trimOptionsInCatalog, executor),
    colors: await tableCount(colorsInCatalog, executor),
    trimNoOptions: await tableCount(trimNoOptionsInCatalog, executor),
    trimOptionRelations: await tableCount(trimOptionRelationsInCatalog, executor),
  };
}
