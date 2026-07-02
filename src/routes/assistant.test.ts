import { test, expect, afterEach } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { EMBEDDING_DIM } from "../lib/gemini-embed";
import { assistantDeps } from "./assistant";

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-key";

const realDeps = { ...assistantDeps };
afterEach(() => { Object.assign(assistantDeps, realDeps); });

test("POST /ask 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "q" }) });
  expect(res.status).toBe(401);
});

test("POST /ask 빈 질문 → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "  " }) });
  expect(res.status).toBe(400);
});

test("POST /ask → 200: 멀티턴 history 전달 + user/assistant 2건 저장", async () => {
  const seen: { historyLen: number; saved: number } = { historyLen: -1, saved: -1 };
  assistantDeps.listRecentMessages = async () => [
    { id: "m1", staffUserId: "s", role: "user", content: "이전질문", sources: null, createdAt: new Date(0) },
  ] as never;
  assistantDeps.embedTexts = async (texts: string[]) => texts.map(() => Array.from({ length: EMBEDDING_DIM }, () => 0.01));
  assistantDeps.searchEmbeddings = async () => [{ id: "e1", sourceType: "memo", sourceId: "s1", customerId: "c1", content: "근거", similarity: 0.9 }];
  assistantDeps.getCustomerMetaByIds = async () => new Map([["c1", { name: "김민준", status: "상담중" }]]);
  assistantDeps.generateAnswer = async (_s: string, _u: string, _k: string, history: { role: string }[] = []) => { seen.historyLen = history.length; return "답변"; };
  assistantDeps.insertAssistantMessages = async (rows: unknown[]) => { seen.saved = rows.length; return rows as never; };

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "이번질문" }) });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { messages: { role: string; content: string }[] };
  expect(seen.historyLen).toBe(1);
  expect(seen.saved).toBe(2);
  expect(json.messages.length).toBe(2);
  expect(json.messages[1].role).toBe("assistant");
  expect(json.messages[1].content).toBe("답변"); // 답변은 top-level이 아니라 저장된 messages[1]로만 내려간다
});

test("POST /ask Gemini 실패 → 500 한국어, 저장 0건", async () => {
  let saved = 0;
  assistantDeps.listRecentMessages = async () => [];
  assistantDeps.embedTexts = async () => { throw new Error("boom"); };
  assistantDeps.insertAssistantMessages = async (rows: unknown[]) => { saved += (rows as unknown[]).length; return rows as never; };
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "q" }) });
  expect(res.status).toBe(500);
  expect((await res.json() as { error: string }).error).toBe("일시적으로 답변에 실패했습니다.");
  expect(saved).toBe(0);
});

test("GET /messages → 본인 최근 목록", async () => {
  assistantDeps.listRecentMessages = async () => [
    { id: "m1", staffUserId: "s", role: "user", content: "q", sources: null, createdAt: new Date(0) },
    { id: "m2", staffUserId: "s", role: "assistant", content: "a", sources: [], createdAt: new Date(1) },
  ] as never;
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/messages", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect((await res.json() as unknown[]).length).toBe(2);
});

test("GET /messages?before=... → 커서를 listRecentMessages에 전달", async () => {
  let seenCursor: unknown = "unset";
  assistantDeps.listRecentMessages = async (_id: string, _limit: number, _db: unknown, before?: unknown) => { seenCursor = before; return []; };
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/messages?before=2026-07-02T00:00:00.000Z&beforeId=11111111-1111-4111-8111-111111111111", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect(seenCursor).toMatchObject({ id: "11111111-1111-4111-8111-111111111111" });
});
