import { count, isNull } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import {
  brandsInCatalog,
  colorsInCatalog,
  modelsInCatalog,
  trimNoOptionsInCatalog,
  trimOptionRelationsInCatalog,
  trimOptionsInCatalog,
  trimsInCatalog,
} from "../catalog";
import { db } from "../client";

export type CatalogCounts = {
  brands: number;
  models: number;
  trims: number;
  trimOptions: number;
  colors: number;
  trimNoOptions: number;
  trimOptionRelations: number;
};

async function activeCount(table: PgTable, deletedAt: PgColumn): Promise<number> {
  const [row] = await db.select({ c: count() }).from(table).where(isNull(deletedAt));
  return row?.c ?? 0;
}

// 순차 await: counts는 저빈도이고, Promise.all 7개 동시 쿼리는 connection pool(session mode, pool_size 15)을
// 빠르게 소진한다(dev 서버 연결과 겹치면 EMAXCONNSESSION). 연결을 1개씩 재사용하도록 순차 실행.
export async function getCatalogCounts(): Promise<CatalogCounts> {
  return {
    brands: await activeCount(brandsInCatalog, brandsInCatalog.deletedAt),
    models: await activeCount(modelsInCatalog, modelsInCatalog.deletedAt),
    trims: await activeCount(trimsInCatalog, trimsInCatalog.deletedAt),
    trimOptions: await activeCount(trimOptionsInCatalog, trimOptionsInCatalog.deletedAt),
    colors: await activeCount(colorsInCatalog, colorsInCatalog.deletedAt),
    trimNoOptions: await activeCount(trimNoOptionsInCatalog, trimNoOptionsInCatalog.deletedAt),
    trimOptionRelations: await activeCount(trimOptionRelationsInCatalog, trimOptionRelationsInCatalog.deletedAt),
  };
}
