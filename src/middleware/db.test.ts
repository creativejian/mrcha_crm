import { afterEach, test, expect } from "bun:test";
import { Hono } from "hono";
import type { ExecutionContext } from "hono";

import { getDefaultDb, type Db } from "../db/client";
import { dbMiddleware, endAfterHold, holdStreamLifetime, holdWork, setTestDb, tryWaitUntil, type DbVariables } from "./db";

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
    get: (_key: "dbHold") => held,
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
    get: (_key: "dbHold") => held,
    set: (_key: "dbHold", value: Promise<unknown>) => { held = value; },
  };
  const release = holdStreamLifetime(fakeContext);
  expect(held).toBeInstanceOf(Promise);
  release();
  await held;
});

// 계약 통일(0705 배치 B): holdStreamLifetime도 holdWork처럼 기존 dbHold와 체인해야 한다.
// 덮어쓰면 같은 요청의 선행 백그라운드 작업(예: 쓰기 성공 → embed 훅)이 dbHold에서 탈락 →
// endAfterHold가 작업 중에 client.end() → prod만 CONNECTION_ENDED(#143 클래스). 주석 순서 규약을 코드로 승격.
test("holdStreamLifetime: 기존 dbHold(holdWork 작업)를 덮어쓰지 않고 체인한다", async () => {
  let held: Promise<unknown> | undefined;
  const fakeContext = {
    get executionCtx(): ExecutionContext { throw new Error("no executionCtx"); },
    get: (_key: "dbHold") => held,
    set: (_key: "dbHold", value: Promise<unknown>) => { held = value; },
  };
  let resolveWork!: () => void;
  holdWork(fakeContext, new Promise<void>((r) => { resolveWork = r; })); // 선행 백그라운드 작업
  const release = holdStreamLifetime(fakeContext); // 이후 스트리밍 시작
  release(); // 스트림은 즉시 종료

  let settled = false;
  void held!.then(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 10));
  expect(settled).toBe(false); // 선행 작업이 살아있는 동안 최종 hold 미해소(덮어쓰기면 여기서 해소돼 실패)

  resolveWork();
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

// ── 테스트 전용 db 주입 seam(setTestDb) ───────────────────────────────────
// 라우트가 자기 트랜잭션(`c.var.db.transaction()`)을 여는 경로에 알림 가드를 태우려면,
// 라우트가 집는 db 자체를 바꾸는 수밖에 없다. seam은 fallback(`!connStr`) 브랜치 + NODE_ENV=test에만 산다.

// 라우트가 실제로 집어든 db 인스턴스를 identity로 되돌려주는 프로브(DB 쿼리는 하지 않는다).
const probes = { db: null as Db | null };
function probeApp() {
  const app = new Hono<{ Variables: DbVariables }>();
  app.use("*", dbMiddleware);
  app.get("/probe", (c) => {
    probes.db = c.var.db;
    return c.body(null, 204);
  });
  return app;
}
const marker = {} as unknown as Db;

afterEach(() => {
  setTestDb(null);
  probes.db = null;
});

test("setTestDb: 주입한 db를 라우트가 c.var.db로 집는다", async () => {
  setTestDb(marker);
  const res = await probeApp().request("/probe");
  expect(res.status).toBe(204);
  expect(probes.db).toBe(marker);
});

test("setTestDb(null): 기본 싱글톤으로 복귀", async () => {
  setTestDb(marker);
  setTestDb(null);
  await probeApp().request("/probe");
  expect(probes.db).toBe(getDefaultDb());
});

// ⚠️ 로컬 dev도 `!connStr` 브랜치를 탄다. NODE_ENV 게이트가 없으면 남아 있는 오버라이드가
// 로컬 dev의 진짜 알림을 조용히 죽인다 — 이 구역 사고 2건이 전부 "조용한 실패"였다(#199·#202).
test("NODE_ENV가 test가 아니면 오버라이드를 무시한다(로컬 dev 알림 보호)", async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    setTestDb(marker);
    await probeApp().request("/probe");
    expect(probes.db).toBe(getDefaultDb());
    expect(probes.db).not.toBe(marker);
  } finally {
    process.env.NODE_ENV = prev;
  }
});

// prod 경로(HYPERDRIVE binding 존재)는 seam을 아예 읽지 않는다 — 요청별 새 client 그대로.
test("HYPERDRIVE 있으면 오버라이드를 읽지 않는다(prod 경로 불변)", async () => {
  setTestDb(marker);
  await probeApp().request("/probe", undefined, FAKE_ENV);
  expect(probes.db).not.toBe(marker);
});

// bun test가 NODE_ENV=test를 자동 설정한다는 전제 위에 위 게이트가 서 있다.
test("bun test는 NODE_ENV=test를 자동 설정한다(게이트의 전제)", () => {
  expect(process.env.NODE_ENV).toBe("test");
});
