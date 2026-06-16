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

export async function getCatalogCounts(): Promise<CatalogCounts> {
  const [brands, models, trims, trimOptions, colors, trimNoOptions, trimOptionRelations] =
    await Promise.all([
      activeCount(brandsInCatalog, brandsInCatalog.deletedAt),
      activeCount(modelsInCatalog, modelsInCatalog.deletedAt),
      activeCount(trimsInCatalog, trimsInCatalog.deletedAt),
      activeCount(trimOptionsInCatalog, trimOptionsInCatalog.deletedAt),
      activeCount(colorsInCatalog, colorsInCatalog.deletedAt),
      activeCount(trimNoOptionsInCatalog, trimNoOptionsInCatalog.deletedAt),
      activeCount(trimOptionRelationsInCatalog, trimOptionRelationsInCatalog.deletedAt),
    ]);
  return { brands, models, trims, trimOptions, colors, trimNoOptions, trimOptionRelations };
}
