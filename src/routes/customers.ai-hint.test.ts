import { test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { customers } from "../db/schema";
import { aiHintDeps } from "../lib/ai-hint-on-write";

const db = getDefaultDb();
const ORIGINAL_GENERATE = aiHintDeps.generateAnswer;
const SAVED_FLAG = process.env.AI_HINT_ON_WRITE;
let CUST = "";
let generateCalls = 0;
let auth: Awaited<ReturnType<typeof makeTestAuth>>;

beforeAll(async () => {
  // 게이트 개방(test:server 기본 off) + generateAnswer만 fake(실 Gemini 차단). 로더/라이터는 실물 —
  // crm.customers.ai_summary 실 왕복까지 검증하는 통합 테스트다(customers.embed.test.ts 미러).
  process.env.AI_HINT_ON_WRITE = "on";
  aiHintDeps.generateAnswer = async () => {
    generateCalls++;
    return "**배선** 검증 힌트";
  };
  auth = await makeTestAuth("admin");
  const [c] = await db.insert(customers).values({
    customerCode: `CU-AIHINT-${crypto.randomUUID().slice(0, 8)}`, name: "AI힌트배선테스트",
  }).returning({ id: customers.id });
  CUST = c.id;
});

afterAll(async () => {
  aiHintDeps.generateAnswer = ORIGINAL_GENERATE;
  if (SAVED_FLAG !== undefined) process.env.AI_HINT_ON_WRITE = SAVED_FLAG; else delete process.env.AI_HINT_ON_WRITE;
  await db.delete(customers).where(eq(customers.id, CUST)); // 메모는 FK cascade
});

// 훅은 응답 후 비동기 — 조건 충족까지 폴링(customers.embed.test.ts until 미러).
async function until(cond: () => Promise<boolean> | boolean, timeoutMs = 3000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - t0 > timeoutMs) throw new Error("until: 조건 미충족 타임아웃");
    await Bun.sleep(25);
  }
}

async function hintRow() {
  const [row] = await db.select({ aiSummary: customers.aiSummary, hash: customers.aiSummarySourceHash })
    .from(customers).where(eq(customers.id, CUST));
  return row;
}

function makeApp() {
  return createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
}

test("고객 PATCH(재료 필드) → ai_summary 생성(비동기), 동일 재료 재PATCH는 hash skip", async () => {
  const app = makeApp();
  const patch = (body: unknown) => app.request(`/api/customers/${CUST}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  expect((await patch({ needModel: "X3" })).status).toBe(200);
  await until(async () => (await hintRow())?.aiSummary === "**배선** 검증 힌트");
  expect((await hintRow())?.hash).not.toBeNull();
  const callsAfterFirst = generateCalls;

  // 같은 값 재PATCH → 재료 불변 → Gemini 미호출(hash skip)
  expect((await patch({ needModel: "X3" })).status).toBe(200);
  await Bun.sleep(300); // 훅이 돌 시간 — skip이라 관측할 변화가 없어 고정 대기
  expect(generateCalls).toBe(callsAfterFirst);
});

test("메모 POST → 재료 변경 → 재생성, 메모 삭제 → 다시 재생성(원 재료로 수렴)", async () => {
  const app = makeApp();
  const before = generateCalls;
  const res = await app.request(`/api/customers/${CUST}/memos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "AI힌트 배선 검증 메모" }),
  });
  expect(res.status).toBe(201);
  const memo = (await res.json()) as { id: string };
  await until(() => generateCalls === before + 1);

  const del = await app.request(`/api/customers/${CUST}/memos/${memo.id}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(del.status).toBe(200);
  await until(() => generateCalls === before + 2); // 삭제 후 재료(메모 없음)로 재생성
});

test("재료 전무 고객의 무관 필드 PATCH → 잔재 힌트 NULL 클리어", async () => {
  // 별도 고객 — 프로필/메모/할일/견적/상담 전무, 잔재 힌트만 시드.
  const [ghost] = await db.insert(customers).values({
    customerCode: `CU-AIHINT-${crypto.randomUUID().slice(0, 8)}`, name: "AI힌트클리어테스트",
    aiSummary: "잔재 힌트", aiSummarySourceHash: "stale",
  }).returning({ id: customers.id });
  try {
    const app = makeApp();
    const res = await app.request(`/api/customers/${ghost.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ team: "인천본사" }), // 재료 밖 필드 — 그래도 훅은 돌고, 재료 전무 판정이 클리어
    });
    expect(res.status).toBe(200);
    await until(async () => {
      const [row] = await db.select({ aiSummary: customers.aiSummary }).from(customers).where(eq(customers.id, ghost.id));
      return row.aiSummary === null;
    });
  } finally {
    await db.delete(customers).where(eq(customers.id, ghost.id));
  }
});
