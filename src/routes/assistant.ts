import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getCustomerMetaByIds } from "../db/queries/embeddings-meta";
import { searchEmbeddings } from "../db/queries/embeddings";
import { embedTexts } from "../lib/gemini-embed";
import { generateAnswer } from "../lib/gemini-generate";
import { resolveCustomerScope } from "../lib/assistant-scope";
import { buildContextBlock, buildUserPrompt, SYSTEM_PROMPT } from "../lib/assistant-prompt";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";

export const assistant = new Hono<{ Variables: AuthVariables & DbVariables }>();

export type AssistantDeps = {
  embedTexts: typeof embedTexts;
  searchEmbeddings: typeof searchEmbeddings;
  generateAnswer: typeof generateAnswer;
  getCustomerMetaByIds: typeof getCustomerMetaByIds;
};
// 테스트가 이 객체 프로퍼티만 갈아끼워 주입한다(mock.module 미사용 → 전역 누출 없음).
export const assistantDeps: AssistantDeps = { embedTexts, searchEmbeddings, generateAnswer, getCustomerMetaByIds };

const TOP_K = 8;
const askSchema = z.object({ question: z.string() });

assistant.post("/ask", zValidator("json", askSchema), async (c) => {
  const question = c.req.valid("json").question.trim();
  if (!question) return c.json({ error: "질문을 입력하세요." }, 400);

  const apiKey = (c.env as { GEMINI_API_KEY?: string } | undefined)?.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return c.json({ error: "서버 설정 오류입니다. 관리자에게 문의하세요." }, 500);

  const scope = resolveCustomerScope(c.var.user);
  const [queryVec] = await assistantDeps.embedTexts([question], apiKey, "RETRIEVAL_QUERY");
  const hits = await assistantDeps.searchEmbeddings(queryVec, scope, TOP_K, c.var.db);
  if (hits.length === 0) return c.json({ answer: "관련 CRM 데이터를 찾지 못했습니다.", sources: [] });

  const metaById = await assistantDeps.getCustomerMetaByIds([...new Set(hits.map((h) => h.customerId))], c.var.db);
  const promptChunks = hits.map((h) => ({
    customerName: metaById.get(h.customerId)?.name ?? "고객",
    customerStatus: metaById.get(h.customerId)?.status ?? "",
    content: h.content,
  }));
  const answer = await assistantDeps.generateAnswer(SYSTEM_PROMPT, buildUserPrompt(question, buildContextBlock(promptChunks)), apiKey);

  const sources = hits.map((h) => ({
    customerId: h.customerId,
    customerName: metaById.get(h.customerId)?.name ?? "고객",
    sourceType: h.sourceType,
    snippet: h.content.slice(0, 120),
  }));
  return c.json({ answer, sources });
});
