import type { MiddlewareHandler } from "hono";

import { createDbClient, getDefaultDb, type Db } from "../db/client";

// dbHold: 스트리밍 핸들러가 Response 반환 후에도 DB를 써야 할 때(SSE 마감 저장) 그 수명을 알리는 promise.
// next()는 스트림 "완료"가 아니라 Response "반환" 시점에 끝나므로, hold 없이 닫으면 마감 쿼리가
// 죽은 연결로 실행된다(#142 prod 사고 — finalize update가 CONNECTION_ENDED로 전부 실패).
export type DbVariables = { db: Db; dbHold?: Promise<unknown> };

// hold(스트림 수명)가 있으면 그 해소를 기다렸다가 연결을 닫는다 — hold 실패 여부와 무관하게 반드시 닫는다.
export function endAfterHold(hold: Promise<unknown> | undefined, end: () => Promise<void>): Promise<void> {
  return hold ? Promise.resolve(hold).then(() => undefined, () => undefined).then(end) : end();
}

// CF Pages Functions(Workers): c.env.HYPERDRIVE.connectionString이 있으면 Hyperdrive 경유.
// Workers는 요청 간 DB 소켓을 재사용할 수 없으므로(재사용 시 "Worker hung" 발생) 요청마다
// 새 client를 만들고 응답 후 waitUntil(endAfterHold(...))로 닫는다. Hyperdrive가 origin 연결을
// 풀링하므로 요청별 client 생성은 가볍다.
// 로컬(Bun.serve)·테스트(app.request)는 c.env가 없어 getDefaultDb() 싱글톤 fallback.
export const dbMiddleware: MiddlewareHandler<{ Variables: DbVariables }> = async (c, next) => {
  const connStr = (c.env as { HYPERDRIVE?: { connectionString: string } } | undefined)?.HYPERDRIVE?.connectionString;
  if (!connStr) {
    c.set("db", getDefaultDb());
    await next();
    return;
  }
  const { db, client } = createDbClient(connStr);
  c.set("db", db);
  try {
    await next();
  } finally {
    // 응답 전송 후 연결 종료(요청 수명에 묶지 않음). executionCtx가 없으면(이론상 비-Workers) 즉시 종료.
    const end = endAfterHold(c.get("dbHold"), () => client.end());
    try {
      c.executionCtx.waitUntil(end);
    } catch {
      await end;
    }
  }
};
