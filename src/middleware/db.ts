import type { Context, MiddlewareHandler } from "hono";

import { createDbClient, getDefaultDb, type Db } from "../db/client";

// dbHold: 스트리밍 핸들러가 Response 반환 후에도 DB를 써야 할 때(SSE 마감 저장) 그 수명을 알리는 promise.
// next()는 스트림 "완료"가 아니라 Response "반환" 시점에 끝나므로, hold 없이 닫으면 마감 쿼리가
// 죽은 연결로 실행된다(#142 prod 사고 — finalize update가 CONNECTION_ENDED로 전부 실패).
export type DbVariables = { db: Db; dbHold?: Promise<unknown> };

// executionCtx는 CF Workers에만 있고 로컬 bun/테스트에선 getter가 throw한다 — waitUntil 등록을
// 시도하고 성공 여부를 반환한다(실패 시 폴백은 호출부 결정). 어떤 경로에서도 p를 인라인 await하지
// 않는다 — 대기 시 Response 반환이 스트림 종료까지 막힌다(2026-07-03 prod 524 데드락, #145).
export function tryWaitUntil(c: Pick<Context, "executionCtx">, p: Promise<unknown>): boolean {
  try {
    c.executionCtx.waitUntil(p);
    return true;
  } catch {
    return false;
  }
}

// 스트리밍 핸들러 진입 시 호출 — 스트림 수명 promise를 만들어 dbHold(미들웨어가 해소 후 연결 종료)와
// waitUntil(클라 abort 직후 CF 아이솔레이트 회수에도 릴레이+finalize 완주 보장)에 원자 등록한다.
// 반환된 release를 스트림 종료 finally에서 반드시 호출할 것.
// 두 배선을 헬퍼 하나로 묶는 이유: 개별 배선은 누락해도 로컬(bun 싱글톤 db·executionCtx 없음)에선
// 정상 동작하고 prod에서만 P0가 된다(#143 실사고 — 신규 스트리밍 라우트가 이 헬퍼만 쓰면 구조적으로 안전).
// 파라미터는 구조적 타입 — hono Context가 Variables에 invariant라 교차 Variables 라우트가 못 들어온다.
// 주의: 기존 dbHold를 덮어쓴다(holdWork와 달리 체인 안 함). 같은 요청에서 holdWork와 섞어 쓰려면
// 이 함수를 먼저 호출할 것 — 현재 유일 호출처(assistant 스트리밍)는 holdWork와 공존하지 않는다.
export function holdStreamLifetime(
  c: Pick<Context, "executionCtx"> & { set: (key: "dbHold", value: Promise<unknown>) => void },
): () => void {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  c.set("dbHold", held);
  tryWaitUntil(c, held);
  return release;
}

// 응답 후 백그라운드 작업(증분 임베딩 등)을 dbHold+waitUntil에 등록 — holdStreamLifetime과 달리
// 수동 release가 아니라 작업 promise 완료가 곧 해소다. 같은 요청에서 여러 번 호출되면 기존 hold와
// 체인한다(고객 PATCH가 니즈 3필드를 동시에 보내는 경우 — 덮어쓰면 앞선 작업이 연결 종료에 잘린다).
// 작업 실패는 여기서 흡수(연결 종료·waitUntil은 성패와 무관하게 진행돼야 한다) — 로깅은 호출부 책임.
export function holdWork(
  c: Pick<Context, "executionCtx"> & {
    get: (key: "dbHold") => Promise<unknown> | undefined;
    set: (key: "dbHold", value: Promise<unknown>) => void;
  },
  work: Promise<unknown>,
): void {
  const settled = work.then(() => undefined, () => undefined);
  const prev = c.get("dbHold");
  c.set("dbHold", prev ? Promise.all([prev.then(() => undefined, () => undefined), settled]) : settled);
  tryWaitUntil(c, settled);
}

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
    // 응답 전송 후 연결 종료(요청 수명에 묶지 않음). executionCtx가 없으면 fire-and-forget.
    // 여기서 end를 await하면 안 된다 — end는 dbHold(스트림 수명)에 체인돼 있어, 인라인 대기 시
    // Response 반환이 스트림 종료까지 막히는 데드락이 된다(2026-07-03 prod 524 사고: Pages 엔트리가
    // ExecutionContext를 안 넘겨 이 폴백이 발동, 업무 AI 스트리밍 전면 불능).
    const end = endAfterHold(c.get("dbHold"), () => client.end());
    if (!tryWaitUntil(c, end)) void end.catch(() => {});
  }
};
