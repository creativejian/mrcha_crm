import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { DbVariables } from "../middleware/db";
import { getBrands, getModelsByBrand, getTrimDetail, getTrimsByModel, getWorkbenchVehicle } from "../db/queries/vehicles";

const idSchema = z.coerce.number().int().positive();

export const vehicles = new Hono<{ Variables: DbVariables }>();

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
  return c.json(detail);
});

vehicles.get("/workbench", zValidator("query", z.object({ trimId: idSchema })), async (c) => {
  const { trimId } = c.req.valid("query");
  const data = await getWorkbenchVehicle(trimId, c.var.db);
  if (!data) return c.json({ error: "Trim not found" }, 404);
  return c.json(data);
});
