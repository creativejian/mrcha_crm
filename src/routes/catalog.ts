import { Hono } from "hono";

import { getCatalogCounts } from "../db/queries/catalog-counts";
import { getBrands } from "../db/queries/vehicles";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";
import { registerChangeRequestRoutes } from "./catalog/change-requests";
import { registerDiscountRoutes } from "./catalog/discounts";
import { registerModelRoutes } from "./catalog/models";
import { registerOptionRoutes } from "./catalog/options";
import { registerTrimRoutes } from "./catalog/trims";

// 차량 카탈로그 관리 라우트(master catalog 직접 쓰기). 도메인별로 catalog/*.ts에 등록한다.
//
// ⚠️ 이 라우터엔 전역 role 게이트가 없다(GET 열람은 전 role에 의도적으로 열려 있다 — 딜러 마스킹은
// 라우트 내부에서). **새 쓰기 라우트를 추가할 땐 requireRoles를 반드시 명시 부착**할 것 —
// 큐 8종 = ["admin","manager"](manager는 submitChangeRequest 분기), 그 외 쓰기 = ["admin"].
// 2026-07-30 게이트 봉인 전까지 staff 직접 쓰기가 열려 있었다(spec §6.2). 게이트 전수는
// routes/catalog.change-requests.test.ts의 역할 매트릭스가 잠근다.
export const catalog = new Hono<{ Variables: AuthVariables & DbVariables }>();

catalog.get("/counts", async (c) => c.json(await getCatalogCounts(c.var.db)));
catalog.get("/brands", async (c) => c.json(await getBrands(c.var.db)));

registerModelRoutes(catalog);
registerTrimRoutes(catalog);
registerOptionRoutes(catalog);
registerDiscountRoutes(catalog);
registerChangeRequestRoutes(catalog);
