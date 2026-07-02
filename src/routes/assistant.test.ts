import { test, expect, afterEach } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { assistantDeps } from "./assistant";

// gemini 호출은 mock, guard 통과용 더미 키(값은 안 쓰임 — 주입된 fake만 호출됨).
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-key";

const realDeps = { ...assistantDeps };
afterEach(() => { Object.assign(assistantDeps, realDeps); }); // 각 테스트 후 원상복구

test("POST /api/assistant/ask 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "누가 급해?" }) });
  expect(res.status).toBe(401);
});

test("POST /api/assistant/ask 빈 질문 → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ question: "  " }),
  });
  expect(res.status).toBe(400);
});

test("POST /api/assistant/ask → 200 {answer, sources}", async () => {
  assistantDeps.embedTexts = async (texts: string[]) => texts.map(() => Array.from({ length: 3072 }, () => 0.01));
  assistantDeps.searchEmbeddings = async () => [
    { id: "e1", sourceType: "memo", sourceId: "s1", customerId: "c1", content: "고객 김민준 상담메모: GLC", similarity: 0.9 },
  ];
  assistantDeps.getCustomerMetaByIds = async () => new Map([["c1", { name: "김민준", status: "견적·발송완료" }]]);
  assistantDeps.generateAnswer = async () => "테스트 답변";

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ question: "계약 가능성 높은 고객은?" }),
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { answer: string; sources: unknown[] };
  expect(json.answer).toBe("테스트 답변");
  expect(json.sources.length).toBe(1);
});

test("POST /api/assistant/ask Gemini 실패 → 500 한국어 메시지", async () => {
  assistantDeps.embedTexts = async () => { throw new Error("boom"); };
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ question: "누가 급해?" }),
  });
  expect(res.status).toBe(500);
  const json = (await res.json()) as { error: string };
  expect(json.error).toBe("일시적으로 답변에 실패했습니다.");
});
