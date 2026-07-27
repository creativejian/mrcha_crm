import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { visibleTrimFor } from "../lib/dealer-visibility";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";
import { getBrands, getModelsByBrand, getTrimDetail, getTrimsByModel, getWorkbenchVehicle } from "../db/queries/vehicles";

const idSchema = z.coerce.number().int().positive();

// AuthVariables는 런타임에 이미 붙어 있다(app.ts의 protect("/api/vehicles/*")) — 타입에만 없어서
// role을 볼 수 없었다. 딜러에게 확정 할인을 감추려면 여기서 role이 필요하다.
export const vehicles = new Hono<{ Variables: AuthVariables & DbVariables }>();

vehicles.get("/brands", async (c) => {
  return c.json(await getBrands(c.var.db));
});

vehicles.get("/models", zValidator("query", z.object({ brandId: idSchema })), async (c) => {
  const { brandId } = c.req.valid("query");
  return c.json(await getModelsByBrand(brandId, c.var.db));
});

vehicles.get("/trims", zValidator("query", z.object({ modelId: idSchema })), async (c) => {
  const { modelId } = c.req.valid("query");
  return c.json(await getTrimsByModel(modelId, c.var.db));
});

vehicles.get("/trims/:trimId", zValidator("param", z.object({ trimId: idSchema })), async (c) => {
  const { trimId } = c.req.valid("param");
  const detail = await getTrimDetail(trimId, c.var.db);
  if (!detail) return c.json({ error: "Trim not found" }, 404);
  // 확정 할인은 딜러에게 내리지 않는다(lib/dealer-visibility) — /api/vehicles 안에서 3금액을
  // 싣는 경로는 여기뿐이다(getTrimsByModel·getWorkbenchVehicle은 애초에 선택하지 않는다).
  return c.json(visibleTrimFor(c.var.user.role, detail));
});

vehicles.get("/workbench", zValidator("query", z.object({ trimId: idSchema })), async (c) => {
  const { trimId } = c.req.valid("query");
  const data = await getWorkbenchVehicle(trimId, c.var.db);
  if (!data) return c.json({ error: "Trim not found" }, 404);
  return c.json(data);
});
