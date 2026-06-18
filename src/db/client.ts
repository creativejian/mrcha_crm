import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as catalog from "./catalog";
import * as schema from "./schema";

// connStr 하나당 drizzle 인스턴스 1개를 isolate 스코프에 메모이즈한다.
// CF Pages Functions는 isolate가 여러 요청을 처리하므로, 같은 connStr이면
// 요청마다 새 postgres 클라이언트를 만들지 않고 재사용한다.
const pool = new Map<string, ReturnType<typeof build>>();

// `prepare: false` — fallback origin(Supabase transaction pooler 6543)은 prepared statement 미지원.
// Hyperdrive 경로(session pooler 5432)는 true 가능하나 v1은 parity·무중단을 위해 false 통일.
function build(connStr: string) {
  const client = postgres(connStr, { prepare: false });
  return drizzle(client, { schema: { ...schema, ...catalog } });
}

// 요청 컨텍스트의 connection string(Hyperdrive 또는 fallback)으로 db를 얻는다.
export function createDb(connStr: string) {
  let db = pool.get(connStr);
  if (!db) {
    db = build(connStr);
    pool.set(connStr, db);
  }
  return db;
}

// 로컬 dev · 테스트 · CF에서 Hyperdrive binding이 없을 때의 fallback.
export function getDefaultDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.local / .env.example)");
  return createDb(url);
}

export type Db = ReturnType<typeof createDb>;
// 쓰기 함수는 db 또는 tx(transaction 콜백 인자)를 받는다.
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export { catalog, schema };
