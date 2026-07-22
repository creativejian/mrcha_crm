import { test, expect, beforeEach, afterAll } from "bun:test";

import type { Db } from "../db/client";
import type { AiHintSourceSnapshot } from "../db/queries/ai-hint-sources";
import { aiHintSourceHash, buildAiHintMaterial, type AiHintMaterialInput } from "./ai-hint";
import { aiHintDeps, runAiHintJob, scheduleAiHintRefresh } from "./ai-hint-on-write";
import type { GeminiTarget } from "./gemini-target";

const ORIGINAL = { ...aiHintDeps };
afterAll(() => { Object.assign(aiHintDeps, ORIGINAL); });
beforeEach(() => { Object.assign(aiHintDeps, ORIGINAL); });

const TARGET: GeminiTarget = { baseUrl: "https://gemini.test", apiKey: "k" };
const DB = {} as Db; // deps가 전부 fake라 실제로 안 쓰인다

const MATERIAL_INPUT: AiHintMaterialInput = {
  name: "훅테스트", statusGroup: "상담중", status: "차량상담중", chance: null, priority: null,
  profileText: "관심 차종 X3", memos: [], tasks: [], quote: null, consultationNote: null,
};
const SNAP: AiHintSourceSnapshot = { ...MATERIAL_INPUT, aiSummary: null, sourceHash: null };

type Calls = { generate: number; set: { aiSummary: string | null; sourceHash: string | null }[] };
function arm(opts: { snap: AiHintSourceSnapshot | null; answer?: string }): Calls {
  const calls: Calls = { generate: 0, set: [] };
  aiHintDeps.loadAiHintSource = async () => opts.snap;
  aiHintDeps.generateAnswer = async () => { calls.generate++; return opts.answer ?? "**X3** 상담 중"; };
  aiHintDeps.setCustomerAiHint = async (_id, hint) => { calls.set.push(hint); };
  return calls;
}

test("runAiHintJob: 재료 신규 → 생성 1회 + sanitize된 힌트·재료 hash 저장, outcome generated", async () => {
  const calls = arm({ snap: SNAP, answer: '- "**X3** 상담 중"\n부연' });
  expect(await runAiHintJob("c1", TARGET, DB)).toBe("generated");
  const material = buildAiHintMaterial(MATERIAL_INPUT);
  expect(calls.set).toEqual([{ aiSummary: "**X3** 상담 중", sourceHash: aiHintSourceHash(material ?? "") }]);
});

test("runAiHintJob: 재료 hash 동일 → Gemini 미호출 skip, outcome unchanged", async () => {
  const material = buildAiHintMaterial(MATERIAL_INPUT);
  const calls = arm({ snap: { ...SNAP, sourceHash: aiHintSourceHash(material ?? "") } });
  expect(await runAiHintJob("c1", TARGET, DB)).toBe("unchanged");
  expect(calls.generate).toBe(0);
  expect(calls.set).toEqual([]);
});

test("runAiHintJob: 재료 전무 + 기존 힌트 있음 → NULL 클리어, outcome cleared", async () => {
  const calls = arm({ snap: { ...SNAP, profileText: "", aiSummary: "잔재", sourceHash: "h" } });
  expect(await runAiHintJob("c1", TARGET, DB)).toBe("cleared");
  expect(calls.generate).toBe(0);
  expect(calls.set).toEqual([{ aiSummary: null, sourceHash: null }]);
});

test("runAiHintJob: 재료 전무 + 이미 비어 있음 → UPDATE 생략(멱등 cleared)", async () => {
  const calls = arm({ snap: { ...SNAP, profileText: "" } });
  expect(await runAiHintJob("c1", TARGET, DB)).toBe("cleared");
  expect(calls.set).toEqual([]);
});

test("runAiHintJob: 고객 소실(경합 삭제) → 아무것도 안 함, outcome missing", async () => {
  const calls = arm({ snap: null });
  expect(await runAiHintJob("c1", TARGET, DB)).toBe("missing");
  expect(calls.generate).toBe(0);
  expect(calls.set).toEqual([]);
});

test("runAiHintJob: 생성이 빈 문자열 → 기존 값 유지(쓰기 0)·hash도 안 올림, outcome empty", async () => {
  const calls = arm({ snap: { ...SNAP, aiSummary: "기존", sourceHash: "old" }, answer: "  \n " });
  expect(await runAiHintJob("c1", TARGET, DB)).toBe("empty");
  expect(calls.set).toEqual([]);
});

test("runAiHintJob: Gemini throw → 그대로 전파(쓰기 0 — 호출부 catch가 fail-open 로그)", async () => {
  const calls = arm({ snap: SNAP });
  aiHintDeps.generateAnswer = async () => { throw new Error("boom"); };
  await expect(runAiHintJob("c1", TARGET, DB)).rejects.toThrow("boom");
  expect(calls.set).toEqual([]);
});

// ---- scheduleAiHintRefresh 게이트/스케줄러 (embed-on-write.test.ts 스케줄 5종 미러) ----
// Task 5가 라우트 15곳에 배선되면 게이트가 공유 master 오염(실 Gemini + ai_summary 실쓰기)을 막는
// 유일한 방어선 — `bun test <파일>` 직접 실행 실사고(2026-07-05)와 같은 축이라 유닛으로 잠근다.

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

test("scheduleAiHintRefresh: 정상 경로 — dbHold 등록 + 태스크가 deps 실행", async () => {
  const calls = arm({ snap: SNAP });
  // AI_HINT_ON_WRITE: "on" 명시 필수 — test:server가 process.env에 off를 깔아두므로(env 오버라이드가 폴백보다 우선)
  const { ctx, held } = fakeHookContext({ GEMINI_API_KEY: "k", AI_HINT_ON_WRITE: "on" });
  scheduleAiHintRefresh(ctx, "c1");
  expect(held()).toBeInstanceOf(Promise);
  await held();
  expect(calls.set.length).toBe(1);
});

test("scheduleAiHintRefresh: AI_HINT_ON_WRITE=off / 키 부재 → no-op(dbHold 미등록)", () => {
  const calls = arm({ snap: SNAP });
  const off = fakeHookContext({ GEMINI_API_KEY: "k", AI_HINT_ON_WRITE: "off" });
  scheduleAiHintRefresh(off.ctx, "c1");
  expect(off.held()).toBeUndefined();

  const savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY; // process.env 폴백 차단
  try {
    // AI_HINT_ON_WRITE는 "on" 명시 — flag 게이트(test:server의 off)가 키 게이트 회귀를 가리지 않게 고립
    const noKey = fakeHookContext({ AI_HINT_ON_WRITE: "on" });
    scheduleAiHintRefresh(noKey.ctx, "c1");
    expect(noKey.held()).toBeUndefined();
  } finally {
    if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
  }
  expect(calls.generate).toBe(0);
});

test("scheduleAiHintRefresh: 플래그 미지정 + NODE_ENV=test → 기본 off(no-op) — 스크립트 우회 직접 실행 오염 가드", () => {
  const calls = arm({ snap: SNAP });
  const savedFlag = process.env.AI_HINT_ON_WRITE;
  delete process.env.AI_HINT_ON_WRITE; // process.env 폴백 차단 — env에도 미지정이라 flag=undefined
  try {
    // bun test는 NODE_ENV=test를 자동 설정(1.3.14 실측) — 명시적 on 없이는 게이트가 막아야 한다
    expect(process.env.NODE_ENV).toBe("test");
    const { ctx, held } = fakeHookContext({ GEMINI_API_KEY: "k" });
    scheduleAiHintRefresh(ctx, "c1");
    expect(held()).toBeUndefined();
  } finally {
    if (savedFlag !== undefined) process.env.AI_HINT_ON_WRITE = savedFlag;
  }
  expect(calls.generate).toBe(0);
});

test("scheduleAiHintRefresh: 프록시URL+무Authorization → resolveGeminiTarget throw를 흡수(no-op·dbHold 미등록)", () => {
  arm({ snap: SNAP });
  const { ctx, held } = fakeHookContext(
    { GEMINI_API_KEY: "k", AI_HINT_ON_WRITE: "on", GEMINI_PROXY_URL: "https://proxy.test" },
    null, // Authorization 헤더 없음 — 동기 throw의 유일한 현실 경로
  );
  scheduleAiHintRefresh(ctx, "c1"); // throw하면 테스트 실패(catch가 흡수해야 함)
  expect(held()).toBeUndefined();
});

test("scheduleAiHintRefresh: 태스크 실패해도 throw 없음(저장 응답 불변) + dbHold 해소", async () => {
  arm({ snap: SNAP });
  aiHintDeps.generateAnswer = async () => { throw new Error("Gemini down"); };
  const { ctx, held } = fakeHookContext({ GEMINI_API_KEY: "k", AI_HINT_ON_WRITE: "on" });
  scheduleAiHintRefresh(ctx, "c1"); // throw하면 테스트 실패
  await held(); // reject 전파되면 테스트 실패(holdWork가 흡수)
});
