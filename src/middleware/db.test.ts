import { test, expect } from "bun:test";
import { Hono } from "hono";
import type { ExecutionContext } from "hono";

import { dbMiddleware, endAfterHold, holdStreamLifetime, holdWork, tryWaitUntil, type DbVariables } from "./db";

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

// holdStreamLifetime: 스트리밍 라우트의 dbHold+waitUntil 원자 등록 헬퍼 — 개별 배선 누락(#143 실사고)을
// 구조적으로 막는다. 등록되는 promise는 release() 호출로만 해소돼야 한다.
test("holdStreamLifetime: dbHold와 waitUntil에 같은 promise를 등록하고 release로 해소한다", async () => {
  const scheduled: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { scheduled.push(p); },
    passThroughOnException: () => {},
  } as ExecutionContext;
  let held: Promise<unknown> | undefined;
  const fakeContext = {
    executionCtx: ctx,
    set: (_key: "dbHold", value: Promise<unknown>) => { held = value; },
  };

  const release = holdStreamLifetime(fakeContext);
  expect(held).toBeInstanceOf(Promise);
  expect(scheduled).toHaveLength(1);
  expect(scheduled[0]).toBe(held!);

  let settled = false;
  void held!.then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(settled).toBe(false); // 스트림이 살아있는 동안 미해소

  release();
  await held;
});

test("holdStreamLifetime: executionCtx 없어도(로컬 bun) dbHold 등록은 그대로 동작한다", async () => {
  let held: Promise<unknown> | undefined;
  const fakeContext = {
    get executionCtx(): ExecutionContext { throw new Error("no executionCtx"); },
    set: (_key: "dbHold", value: Promise<unknown>) => { held = value; },
  };
  const release = holdStreamLifetime(fakeContext);
  expect(held).toBeInstanceOf(Promise);
  release();
  await held;
});

test("tryWaitUntil: executionCtx 없으면 false(폴백은 호출부 결정)", () => {
  const noCtx = { get executionCtx(): ExecutionContext { throw new Error("no executionCtx"); } };
  expect(tryWaitUntil(noCtx, Promise.resolve())).toBe(false);
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

test("holdWork: dbHold와 waitUntil에 등록, 작업 완료로 해소", async () => {
  const scheduled: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { scheduled.push(p); }, passThroughOnException: () => {} } as ExecutionContext;
  let held: Promise<unknown> | undefined;
  let resolveWork!: () => void;
  const work = new Promise<void>((r) => { resolveWork = r; });
  const fakeContext = {
    executionCtx: ctx,
    get: (_key: "dbHold") => held,
    set: (_key: "dbHold", value: Promise<unknown>) => { held = value; },
  };

  holdWork(fakeContext, work);
  expect(held).toBeInstanceOf(Promise);
  expect(scheduled).toHaveLength(1);

  let settled = false;
  void held!.then(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 10));
  expect(settled).toBe(false); // 작업 중엔 연결 유지

  resolveWork();
  await held;
});

test("holdWork: 같은 요청 2회 호출 시 dbHold가 둘 다 완료까지 대기(체인 — 니즈 3필드 동시 PATCH)", async () => {
  let held: Promise<unknown> | undefined;
  const fakeContext = {
    get executionCtx(): ExecutionContext { throw new Error("no executionCtx"); }, // 로컬 bun 경로
    get: (_key: "dbHold") => held,
    set: (_key: "dbHold", value: Promise<unknown>) => { held = value; },
  };
  let resolveA!: () => void;
  const a = new Promise<void>((r) => { resolveA = r; });
  holdWork(fakeContext, a);
  holdWork(fakeContext, Promise.resolve()); // 두 번째 작업은 즉시 완료

  let settled = false;
  void held!.then(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 10));
  expect(settled).toBe(false); // 첫 작업이 살아있는 동안 최종 hold 미해소

  resolveA();
  await held;
});

test("holdWork: 작업 reject여도 dbHold는 해소(연결 누수 방지)", async () => {
  let held: Promise<unknown> | undefined;
  const fakeContext = {
    get executionCtx(): ExecutionContext { throw new Error("no executionCtx"); },
    get: (_key: "dbHold") => held,
    set: (_key: "dbHold", value: Promise<unknown>) => { held = value; },
  };
  holdWork(fakeContext, Promise.reject(new Error("embed failed")));
  await held; // reject가 전파되면 이 await가 throw — 테스트 실패
});
