import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as catalog from "./catalog";
import * as schema from "./schema";

const allSchema = { ...schema, ...catalog };

// `prepare: false` — Supabase pooler 호환(transaction pooler에서 prepared statement 미지원).
// drizzle + 원시 postgres client를 함께 반환한다. Workers(Hyperdrive)에선 요청 종료 후
// client.end()로 닫아야 하므로 호출부가 client에 접근할 수 있어야 한다.
export function createDbClient(connStr: string) {
  const client = postgres(connStr, { prepare: false });
  return { db: drizzle(client, { schema: allSchema }), client };
}

// 로컬 dev · 테스트 · CF에서 Hyperdrive binding이 없을 때의 fallback.
// Bun/Node 환경이라 연결을 프로세스 수명 동안 재사용해도 안전하므로 싱글톤으로 메모이즈한다.
// (CF Workers는 요청 간 소켓 재사용이 안 되므로 이 경로를 쓰지 않고 dbMiddleware가 요청별로 생성한다.)
let defaultDb: ReturnType<typeof createDbClient>["db"] | null = null;
export function getDefaultDb() {
  if (defaultDb) return defaultDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.local / .env.example)");
  defaultDb = createDbClient(url).db;
  return defaultDb;
}

export type Db = ReturnType<typeof createDbClient>["db"];
// 쓰기 함수는 db 또는 tx(transaction 콜백 인자)를 받는다.
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export { catalog, schema };
