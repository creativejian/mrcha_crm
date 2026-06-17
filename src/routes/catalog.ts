import { Hono } from "hono";

import { getCatalogCounts } from "../db/queries/catalog-counts";

export const catalog = new Hono();

catalog.get("/counts", async (c) => {
  return c.json(await getCatalogCounts());
});
