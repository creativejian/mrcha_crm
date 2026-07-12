import { test, expect, beforeEach, afterAll } from "bun:test";

import type { Db } from "../db/client";
import type { AiHintSourceSnapshot } from "../db/queries/ai-hint-sources";
import { buildAiHintMaterial, type AiHintMaterialInput } from "./ai-hint";
import { aiHintDeps, runAiHintJob } from "./ai-hint-on-write";
import { contentHash } from "./assistant-corpus";
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
  expect(calls.set).toEqual([{ aiSummary: "**X3** 상담 중", sourceHash: contentHash(material ?? "") }]);
});

test("runAiHintJob: 재료 hash 동일 → Gemini 미호출 skip, outcome unchanged", async () => {
  const material = buildAiHintMaterial(MATERIAL_INPUT);
  const calls = arm({ snap: { ...SNAP, sourceHash: contentHash(material ?? "") } });
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
