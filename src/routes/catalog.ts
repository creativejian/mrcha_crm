import { Hono } from "hono";

import { getCatalogCounts } from "../db/queries/catalog-counts";
import { getBrands } from "../db/queries/vehicles";
import type { DbVariables } from "../middleware/db";
import { registerModelRoutes } from "./catalog/models";
import { registerOptionRoutes } from "./catalog/options";
import { registerTrimRoutes } from "./catalog/trims";

// 차량 카탈로그 관리 라우트(master catalog 직접 쓰기). 도메인별로 catalog/*.ts에 등록한다.
export const catalog = new Hono<{ Variables: DbVariables }>();

catalog.get("/counts", async (c) => c.json(await getCatalogCounts(c.var.db)));
catalog.get("/brands", async (c) => c.json(await getBrands(c.var.db)));

registerModelRoutes(catalog);
registerTrimRoutes(catalog);
registerOptionRoutes(catalog);
