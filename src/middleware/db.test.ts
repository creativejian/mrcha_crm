import { test, expect } from "bun:test";
import { Hono } from "hono";
import type { ExecutionContext } from "hono";

import { dbMiddleware, endAfterHold, type DbVariables } from "./db";

// 실제 연결은 일어나지 않는다 — postgres.js는 lazy connect라 end()만 호출되는 경로에선 소켓을 열지 않는다.
const FAKE_ENV = { HYPERDRIVE: { connectionString: "postgresql://user:pass@127.0.0.1:5432/fake" } };

test("endAfterHold: hold 없으면 즉시 end", async () => {
  let ended = false;
  await endAfterHold(undefined, async () => { ended = true; });
  expect(ended).toBe(true);
});

test("endAfterHold: hold 해소 전에는 end를 호출하지 않는다(스트림 마감 쿼리 보호)", async () => {
  let ended = false;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const done = endAfterHold(hold, async () => { ended = true; });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(ended).toBe(false); // 스트림이 살아있는 동안 연결 유지

  release();
  await done;
  expect(ended).toBe(true);
});

test("endAfterHold: hold가 reject여도 반드시 end(연결 누수 방지)", async () => {
  let ended = false;
  await endAfterHold(Promise.reject(new Error("stream failed")), async () => { ended = true; });
  expect(ended).toBe(true);
});

// 2026-07-03 prod 524 사고 회귀 테스트: Pages 엔트리가 ExecutionContext를 안 넘기면 c.executionCtx가
// throw하고, 폴백이 end(=dbHold 체인)를 인라인 await해 Response 반환이 스트림 종료까지 막혔다(데드락).
// 폴백은 어떤 경우에도 응답 반환을 막으면 안 된다.
test("dbMiddleware: executionCtx 없어도 응답 반환이 dbHold(스트림 수명)를 기다리지 않는다", async () => {
  const app = new Hono<{ Variables: DbVariables }>();
  app.use(dbMiddleware);
  app.get("/s", (c) => {
    c.set("dbHold", new Promise(() => {})); // 영원히 열린 스트림
    return c.text("ok");
  });
  const res = await app.fetch(new Request("http://local.test/s"), FAKE_ENV); // ctx 미전달 = 구 엔트리 버그 재현
  expect(await res.text()).toBe("ok");
});

test("dbMiddleware: executionCtx 있으면 연결 종료가 waitUntil로 위임된다", async () => {
  const scheduled: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { scheduled.push(p); },
    passThroughOnException: () => {},
  } as ExecutionContext;
  const app = new Hono<{ Variables: DbVariables }>();
  app.use(dbMiddleware);
  app.get("/s", (c) => c.text("ok"));
  const res = await app.fetch(new Request("http://local.test/s"), FAKE_ENV, ctx);
  expect(await res.text()).toBe("ok");
  expect(scheduled.length).toBe(1);
});
