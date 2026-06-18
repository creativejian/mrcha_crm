import type { MiddlewareHandler } from "hono";

import { createDb, getDefaultDb, type Db } from "../db/client";

export type DbVariables = { db: Db };

// CF Pages Functions: c.env.HYPERDRIVE.connectionString이 있으면 Hyperdrive 경유.
// 로컬(Bun.serve)·테스트(app.request)는 c.env가 없어 getDefaultDb() fallback.
export const dbMiddleware: MiddlewareHandler<{ Variables: DbVariables }> = async (c, next) => {
  const connStr = (c.env as { HYPERDRIVE?: { connectionString: string } } | undefined)?.HYPERDRIVE?.connectionString;
  c.set("db", connStr ? createDb(connStr) : getDefaultDb());
  await next();
};
