import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getBrands, getModelsByBrand, getTrimDetail, getTrimsByModel } from "../db/queries/vehicles";

const idSchema = z.coerce.number().int().positive();

export const vehicles = new Hono();

vehicles.get("/brands", async (c) => {
  return c.json(await getBrands());
});

vehicles.get("/models", zValidator("query", z.object({ brandId: idSchema })), async (c) => {
  const { brandId } = c.req.valid("query");
  return c.json(await getModelsByBrand(brandId));
});

vehicles.get("/trims", zValidator("query", z.object({ modelId: idSchema })), async (c) => {
  const { modelId } = c.req.valid("query");
  return c.json(await getTrimsByModel(modelId));
});

vehicles.get("/trims/:trimId", zValidator("param", z.object({ trimId: idSchema })), async (c) => {
  const { trimId } = c.req.valid("param");
  const detail = await getTrimDetail(trimId);
  if (!detail) return c.json({ error: "Trim not found" }, 404);
  return c.json(detail);
});
