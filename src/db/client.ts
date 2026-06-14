import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as catalog from "./catalog";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set (see .env.local / .env.example)");
}

// `prepare: false` — Supabase pooler 호환(특히 transaction pooler에서 prepared statement 미지원).
const client = postgres(url, { prepare: false });

// public(CRM 도메인) + catalog(차량 거울) 타입을 모두 노출.
export const db = drizzle(client, { schema: { ...schema, ...catalog } });

export { catalog, schema };
