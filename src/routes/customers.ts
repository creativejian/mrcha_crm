import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getCustomer, listCustomers } from "../db/queries/customers";
import type { DbVariables } from "../middleware/db";

export const customers = new Hono<{ Variables: DbVariables }>();

customers.get("/", async (c) => c.json(await listCustomers(c.var.db)));

customers.get("/:id", zValidator("param", z.object({ id: z.uuid() })), async (c) => {
  const row = await getCustomer(c.req.valid("param").id, c.var.db);
  return row ? c.json(row) : c.json({ error: "고객을 찾을 수 없습니다." }, 404);
});
