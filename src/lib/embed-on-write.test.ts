import { test, expect, beforeEach, afterAll } from "bun:test";

import type { Db } from "../db/client";
import { EMBEDDING_DIM } from "./gemini-embed";
import { embedOnWriteDeps, runEmbedJob, scheduleEmbedOnWrite, type EmbedOnWriteJob } from "./embed-on-write";
import type { GeminiTarget } from "./gemini-target";

const ORIGINAL = { ...embedOnWriteDeps };
afterAll(() => { Object.assign(embedOnWriteDeps, ORIGINAL); });

const TARGET: GeminiTarget = { baseUrl: "https://gemini.test", apiKey: "k" };
const DB = {} as Db; // deps가 전부 fake라 실제로 안 쓰인다
const JOB: EmbedOnWriteJob = { sourceType: "memo", sourceId: "s1" };
const VEC = Array.from({ length: EMBEDDING_DIM }, () => 0.01);

type Calls = { embed: number; upsert: number; del: number };
function arm(opts: { snap: { customerId: string; customerName: string; text: string } | null; existingHash: string | null }): Calls {
  const calls: Calls = { embed: 0, upsert: 0, del: 0 };
  embedOnWriteDeps.loadCorpusSource = async () => opts.snap;
  embedOnWriteDeps.getEmbeddingHash = async () => opts.existingHash;
  embedOnWriteDeps.embedTexts = async (texts) => { calls.embed++; return texts.map(() => VEC); };
  embedOnWriteDeps.upsertEmbedding = async () => { calls.upsert++; };
  embedOnWriteDeps.deleteEmbeddingBySource = async () => { calls.del++; };
  return calls;
}

beforeEach(() => { Object.assign(embedOnWriteDeps, ORIGINAL); });

test("runEmbedJob: 변경된 콘텐츠 → 임베딩+upsert, outcome embedded", async () => {
  const calls = arm({ snap: { customerId: "c1", customerName: "김민준", text: "새 메모" }, existingHash: "old-hash" });
  expect(await runEmbedJob(JOB, TARGET, DB)).toBe("embedded");
  expect(calls).toEqual({ embed: 1, upsert: 1, del: 0 });
});

test("runEmbedJob: hash 동일 → Gemini 미호출 skip, outcome unchanged", async () => {
  // 실제 콘텐츠의 해시를 기존 해시로 넣어 동일성 재현
  const { buildChunkContent, embeddingContentHash } = await import("./assistant-corpus");
  const snap = { customerId: "c1", customerName: "김민준", text: "같은 메모" };
  const content = buildChunkContent({ sourceType: "memo", sourceId: "s1", customerId: "c1", customerName: "김민준", text: "같은 메모" });
  const calls = arm({ snap, existingHash: embeddingContentHash(content) });
  expect(await runEmbedJob(JOB, TARGET, DB)).toBe("unchanged");
  expect(calls).toEqual({ embed: 0, upsert: 0, del: 0 });
});

test("runEmbedJob: 원본 소실 → 임베딩 행 삭제, outcome deleted", async () => {
  const calls = arm({ snap: null, existingHash: "h" });
  expect(await runEmbedJob(JOB, TARGET, DB)).toBe("deleted");
  expect(calls).toEqual({ embed: 0, upsert: 0, del: 1 });
});

test("runEmbedJob: 빈/공백 텍스트 → 삭제(니즈 필드 비움 경로)", async () => {
  const calls = arm({ snap: { customerId: "c1", customerName: "김민준", text: "  " }, existingHash: "h" });
  expect(await runEmbedJob(JOB, TARGET, DB)).toBe("deleted");
  expect(calls.del).toBe(1);
});

// authHeader는 null이 "헤더 없음" — 명시적 undefined는 JS 기본값 파라미터가 되살려버려 sentinel로 못 쓴다
function fakeHookContext(env: Record<string, string | undefined>, authHeader: string | null = "Bearer test-jwt") {
  let held: Promise<unknown> | undefined;
  return {
    ctx: {
      get executionCtx(): never { throw new Error("no executionCtx"); },
      env,
      req: { header: (_name: string) => authHeader ?? undefined },
      get: (_key: "dbHold") => held,
      set: (_key: "dbHold", value: Promise<unknown>) => { held = value; },
      var: { db: DB },
    },
    held: () => held,
  };
}

test("scheduleEmbedOnWrite: 정상 경로 — dbHold 등록 + 태스크가 deps 실행", async () => {
  const calls = arm({ snap: { customerId: "c1", customerName: "김민준", text: "훅 메모" }, existingHash: null });
  // EMBED_ON_WRITE: "on" 명시 필수 — test:server가 process.env에 off를 깔아두므로(env 오버라이드가 폴백보다 우선)
  const { ctx, held } = fakeHookContext({ GEMINI_API_KEY: "k", EMBED_ON_WRITE: "on" });
  scheduleEmbedOnWrite(ctx, JOB);
  expect(held()).toBeInstanceOf(Promise);
  await held();
  expect(calls.upsert).toBe(1);
});

test("scheduleEmbedOnWrite: EMBED_ON_WRITE=off / 키 부재 → no-op(dbHold 미등록)", () => {
  arm({ snap: { customerId: "c1", customerName: "김민준", text: "x" }, existingHash: null });
  const off = fakeHookContext({ GEMINI_API_KEY: "k", EMBED_ON_WRITE: "off" });
  scheduleEmbedOnWrite(off.ctx, JOB);
  expect(off.held()).toBeUndefined();

  const savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY; // process.env 폴백 차단
  try {
    // EMBED_ON_WRITE는 "on" 명시 — flag 게이트(test:server의 off)가 키 게이트 회귀를 가리지 않게 고립
    const noKey = fakeHookContext({ EMBED_ON_WRITE: "on" });
    scheduleEmbedOnWrite(noKey.ctx, JOB);
    expect(noKey.held()).toBeUndefined();
  } finally {
    if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
  }
});

test("scheduleEmbedOnWrite: 플래그 미지정 + NODE_ENV=test → 기본 off(no-op) — 스크립트 우회 직접 실행 오염 가드", () => {
  arm({ snap: { customerId: "c1", customerName: "김민준", text: "x" }, existingHash: null });
  const savedFlag = process.env.EMBED_ON_WRITE;
  delete process.env.EMBED_ON_WRITE; // process.env 폴백 차단 — env에도 미지정이라 flag=undefined
  try {
    // bun test는 NODE_ENV=test를 자동 설정(1.3.14 실측) — 명시적 on 없이는 게이트가 막아야 한다
    expect(process.env.NODE_ENV).toBe("test");
    const { ctx, held } = fakeHookContext({ GEMINI_API_KEY: "k" });
    scheduleEmbedOnWrite(ctx, JOB);
    expect(held()).toBeUndefined();
  } finally {
    if (savedFlag !== undefined) process.env.EMBED_ON_WRITE = savedFlag;
  }
});

test("scheduleEmbedOnWrite: 프록시URL+무Authorization → resolveGeminiTarget throw를 흡수(no-op·dbHold 미등록)", () => {
  arm({ snap: { customerId: "c1", customerName: "김민준", text: "x" }, existingHash: null });
  const { ctx, held } = fakeHookContext(
    { GEMINI_API_KEY: "k", EMBED_ON_WRITE: "on", GEMINI_PROXY_URL: "https://proxy.test" },
    null, // Authorization 헤더 없음 — 동기 throw의 유일한 현실 경로
  );
  scheduleEmbedOnWrite(ctx, JOB); // throw하면 테스트 실패(catch가 흡수해야 함)
  expect(held()).toBeUndefined();
});

test("scheduleEmbedOnWrite: 태스크 실패해도 throw 없음(저장 응답 불변) + dbHold 해소", async () => {
  arm({ snap: { customerId: "c1", customerName: "김민준", text: "x" }, existingHash: null });
  embedOnWriteDeps.embedTexts = async () => { throw new Error("Gemini down"); };
  const { ctx, held } = fakeHookContext({ GEMINI_API_KEY: "k", EMBED_ON_WRITE: "on" });
  scheduleEmbedOnWrite(ctx, JOB); // throw하면 테스트 실패
  await held(); // reject 전파되면 테스트 실패(holdWork가 흡수)
});
