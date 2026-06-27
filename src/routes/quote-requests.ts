import { Hono } from "hono";

import { listQuoteRequests } from "../db/queries/quote-requests";
import type { DbVariables } from "../middleware/db";
import { run } from "./shared";

export const quoteRequests = new Hono<{ Variables: DbVariables }>();

quoteRequests.get("/", (c) => run(c, () => listQuoteRequests(c.var.db)));
