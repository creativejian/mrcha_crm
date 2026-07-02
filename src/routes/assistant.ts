import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getCustomerMetaByIds } from "../db/queries/embeddings-meta";
import { searchEmbeddings } from "../db/queries/embeddings";
import { insertAssistantMessages, listRecentMessages } from "../db/queries/assistant-messages";
import { embedTexts } from "../lib/gemini-embed";
import { generateAnswer } from "../lib/gemini-generate";
import { resolveCustomerScope } from "../lib/assistant-scope";
import { buildContextBlock, buildUserPrompt, SYSTEM_PROMPT } from "../lib/assistant-prompt";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";

export const assistant = new Hono<{ Variables: AuthVariables & DbVariables }>();

const TOP_K = 8;
const HISTORY_LIMIT = 10; // 멀티턴 컨텍스트로 넣을 최근 메시지 수(앱과 동일)
const DISPLAY_LIMIT = 30; // 패널 진입 시 로드할 최근 메시지 수
const askSchema = z.object({ question: z.string() });

// 테스트가 주입 가능한 의존성(mock.module 대신 — 전역 누출 방지).
export type AssistantDeps = {
  embedTexts: typeof embedTexts;
  searchEmbeddings: typeof searchEmbeddings;
  generateAnswer: typeof generateAnswer;
  getCustomerMetaByIds: typeof getCustomerMetaByIds;
  listRecentMessages: typeof listRecentMessages;
  insertAssistantMessages: typeof insertAssistantMessages;
};
export const assistantDeps: AssistantDeps = {
  embedTexts, searchEmbeddings, generateAnswer, getCustomerMetaByIds, listRecentMessages, insertAssistantMessages,
};

assistant.get("/messages", async (c) => {
  const rows = await assistantDeps.listRecentMessages(c.var.user.id, DISPLAY_LIMIT, c.var.db);
  return c.json(rows);
});

assistant.post("/ask", zValidator("json", askSchema), async (c) => {
  const question = c.req.valid("json").question.trim();
  if (!question) return c.json({ error: "질문을 입력하세요." }, 400);
  const apiKey = (c.env as { GEMINI_API_KEY?: string } | undefined)?.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return c.json({ error: "서버 설정 오류입니다. 관리자에게 문의하세요." }, 500);

  const staffUserId = c.var.user.id;
  try {
    const history = (await assistantDeps.listRecentMessages(staffUserId, HISTORY_LIMIT, c.var.db))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    const scope = resolveCustomerScope(c.var.user);
    const [queryVec] = await assistantDeps.embedTexts([question], apiKey, "RETRIEVAL_QUERY");
    const hits = await assistantDeps.searchEmbeddings(queryVec, scope, TOP_K, c.var.db);
    const metaById = await assistantDeps.getCustomerMetaByIds([...new Set(hits.map((h) => h.customerId))], c.var.db);
    const promptChunks = hits.map((h) => ({
      customerName: metaById.get(h.customerId)?.name ?? "고객",
      customerStatus: metaById.get(h.customerId)?.status ?? "",
      content: h.content,
    }));
    const sources = hits.map((h) => ({
      customerId: h.customerId, customerName: metaById.get(h.customerId)?.name ?? "고객",
      sourceType: h.sourceType, snippet: h.content.slice(0, 120),
    }));
    const answer = hits.length === 0
      ? "관련 CRM 데이터를 찾지 못했습니다."
      : await assistantDeps.generateAnswer(SYSTEM_PROMPT, buildUserPrompt(question, buildContextBlock(promptChunks)), apiKey, history);

    const now = new Date();
    const saved = await assistantDeps.insertAssistantMessages([
      { staffUserId, role: "user", content: question, sources: null, createdAt: now },
      { staffUserId, role: "assistant", content: answer, sources: hits.length === 0 ? [] : sources, createdAt: new Date(now.getTime() + 1) },
    ], c.var.db);
    return c.json({ answer, sources, messages: saved });
  } catch (e) {
    console.error("[assistant] ask 실패:", e);
    return c.json({ error: "일시적으로 답변에 실패했습니다." }, 500);
  }
});
