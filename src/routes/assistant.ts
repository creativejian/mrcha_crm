import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
import { z } from "zod";

import { getCustomerMetaByIds } from "../db/queries/embeddings-meta";
import { searchEmbeddings } from "../db/queries/embeddings";
import {
  deleteAssistantMessage,
  insertAssistantMessages,
  listRecentMessages,
  updateAssistantMessage,
  type AssistantMessageRow,
} from "../db/queries/assistant-messages";
import { embedTexts } from "../lib/gemini-embed";
import { generateAnswer, generateAnswerStream } from "../lib/gemini-generate";
import { resolveCustomerScope } from "../lib/assistant-scope";
import { buildContextBlock, buildUserPrompt, SYSTEM_PROMPT } from "../lib/assistant-prompt";
import { finalizeStreamedAnswer } from "../lib/assistant-stream";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";

export const assistant = new Hono<{ Variables: AuthVariables & DbVariables }>();

const TOP_K = 8;
const HISTORY_LIMIT = 10; // 멀티턴 컨텍스트로 넣을 최근 메시지 수(앱과 동일)
const DISPLAY_LIMIT = 30; // 패널 진입 시 로드할 최근 메시지 수
const NO_HITS_ANSWER = "관련 CRM 데이터를 찾지 못했습니다.";
const askSchema = z.object({ question: z.string(), stream: z.boolean().optional() });
const messagesQuery = z.object({ before: z.iso.datetime().optional(), beforeId: z.uuid().optional() });

// 테스트가 주입 가능한 의존성(mock.module 대신 — 전역 누출 방지).
export type AssistantDeps = {
  embedTexts: typeof embedTexts;
  searchEmbeddings: typeof searchEmbeddings;
  generateAnswer: typeof generateAnswer;
  generateAnswerStream: typeof generateAnswerStream;
  getCustomerMetaByIds: typeof getCustomerMetaByIds;
  listRecentMessages: typeof listRecentMessages;
  insertAssistantMessages: typeof insertAssistantMessages;
  updateAssistantMessage: typeof updateAssistantMessage;
  deleteAssistantMessage: typeof deleteAssistantMessage;
};
export const assistantDeps: AssistantDeps = {
  embedTexts,
  searchEmbeddings,
  generateAnswer,
  generateAnswerStream,
  getCustomerMetaByIds,
  listRecentMessages,
  insertAssistantMessages,
  updateAssistantMessage,
  deleteAssistantMessage,
};

assistant.get("/messages", zValidator("query", messagesQuery), async (c) => {
  const { before, beforeId } = c.req.valid("query");
  const cursor = before && beforeId ? { createdAt: new Date(before), id: beforeId } : undefined;
  const rows = await assistantDeps.listRecentMessages(c.var.user.id, DISPLAY_LIMIT, c.var.db, cursor);
  return c.json(rows);
});

assistant.post("/ask", zValidator("json", askSchema), async (c) => {
  const question = c.req.valid("json").question.trim();
  if (!question) return c.json({ error: "질문을 입력하세요." }, 400);
  const apiKey = (c.env as { GEMINI_API_KEY?: string } | undefined)?.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return c.json({ error: "서버 설정 오류입니다. 관리자에게 문의하세요." }, 500);

  const staffUserId = c.var.user.id;
  try {
    // 히스토리 로드는 임베딩→검색 체인과 독립 — 병렬로 시작해 원격 DB 왕복 1회분 지연을 없앤다.
    const scope = resolveCustomerScope(c.var.user);
    const [history, hits] = await Promise.all([
      assistantDeps.listRecentMessages(staffUserId, HISTORY_LIMIT, c.var.db)
        .then((rows) => rows.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))),
      assistantDeps.embedTexts([question], apiKey, "RETRIEVAL_QUERY")
        .then(([queryVec]) => assistantDeps.searchEmbeddings(queryVec, scope, TOP_K, c.var.db)),
    ]);
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

    if (c.req.valid("json").stream === true) {
      // await 필수: 선저장(insertAssistantMessages) 실패를 이 try/catch가 잡으려면 rejection이
      // 이 스코프 안에서 throw로 전환돼야 한다(그냥 return하면 catch를 건너뛰고 app.onError로 샌다).
      return await streamAsk(c, { question, staffUserId, apiKey, history, hits, promptChunks, sources });
    }

    const answer = hits.length === 0
      ? NO_HITS_ANSWER
      : await assistantDeps.generateAnswer(SYSTEM_PROMPT, buildUserPrompt(question, buildContextBlock(promptChunks)), apiKey, history);

    const now = new Date();
    const saved = await assistantDeps.insertAssistantMessages([
      { staffUserId, role: "user", content: question, sources: null, createdAt: now },
      { staffUserId, role: "assistant", content: answer, sources, createdAt: new Date(now.getTime() + 1) },
    ], c.var.db);
    // 답변·출처는 saved[1]에 영속 — 클라이언트는 messages만 소비한다(이중 표현 금지).
    return c.json({ messages: saved });
  } catch (e) {
    console.error("[assistant] ask 실패:", e);
    return c.json({ error: "일시적으로 답변에 실패했습니다." }, 500);
  }
});

type AskContext = Context<{ Variables: AuthVariables & DbVariables }>;
type StreamAskArgs = {
  question: string;
  staffUserId: string;
  apiKey: string;
  history: { role: "user" | "assistant"; content: string }[];
  hits: Awaited<ReturnType<typeof searchEmbeddings>>;
  promptChunks: { customerName: string; customerStatus: string; content: string }[];
  sources: unknown;
};

// CF Workers면 waitUntil로 abort 후에도 마감 저장을 보장, 로컬 bun은 executionCtx가 없어 null(직접 await로 충분).
function getWaitUntil(c: AskContext): ((p: Promise<unknown>) => void) | null {
  try {
    const ctx = c.executionCtx;
    return (p) => ctx.waitUntil(p);
  } catch {
    return null;
  }
}

// SSE 스트리밍 경로: user+빈 placeholder 선저장 → text 릴레이 → 종료 마감(finalize) → done/error.
async function streamAsk(c: AskContext, args: StreamAskArgs): Promise<Response> {
  const now = new Date();
  const [userRow, placeholder] = (await assistantDeps.insertAssistantMessages([
    { staffUserId: args.staffUserId, role: "user", content: args.question, sources: null, createdAt: now },
    { staffUserId: args.staffUserId, role: "assistant", content: "", sources: null, createdAt: new Date(now.getTime() + 1) },
  ], c.var.db)) as [AssistantMessageRow, AssistantMessageRow];

  return streamSSE(c, async (sse) => {
    let fullText = "";
    let aborted = false;
    let failed = false;
    sse.onAbort(() => { aborted = true; });

    try {
      if (args.hits.length === 0) {
        fullText = NO_HITS_ANSWER;
        await sse.writeSSE({ event: "text", data: JSON.stringify({ chunk: fullText }) });
      } else {
        const gen = assistantDeps.generateAnswerStream(
          SYSTEM_PROMPT, buildUserPrompt(args.question, buildContextBlock(args.promptChunks)), args.apiKey, args.history,
        );
        for await (const chunk of gen) {
          if (aborted) break;
          fullText += chunk;
          await sse.writeSSE({ event: "text", data: JSON.stringify({ chunk }) });
        }
      }
    } catch (e) {
      // 스트림 중간 실패는 raw 에러(JSON SyntaxError 포함)를 generic하게 수용 — 부분 저장은 finalize가 담당.
      console.error("[assistant] stream 생성 실패:", e);
      failed = true;
    }

    const finalize = (async () => {
      const outcome = await finalizeStreamedAnswer({
        fullText, aborted, failed, sources: args.sources,
        update: (content, sources) => assistantDeps.updateAssistantMessage(placeholder.id, args.staffUserId, content, sources, c.var.db),
        remove: () => assistantDeps.deleteAssistantMessage(placeholder.id, args.staffUserId, c.var.db),
      });
      // 텍스트가 있는데 마감이 error면 행 소실(동시성/스코프 불일치) — 이례 상황이라 별도 로깅.
      if (outcome.kind === "error" && fullText.length > 0) {
        console.error("[assistant] placeholder 마감 실패(행 소실):", placeholder.id);
      }
      if (aborted) return; // 클라는 이미 끊김 — 이벤트 송출 생략
      if (outcome.kind === "done") {
        await sse.writeSSE({ event: "done", data: JSON.stringify({ messages: [userRow, outcome.assistant] }) });
      } else {
        await sse.writeSSE({ event: "error", data: JSON.stringify({ code: "generation_failed", message: "일시적으로 답변에 실패했습니다." }) });
      }
    })();

    const waitUntil = getWaitUntil(c);
    if (waitUntil) waitUntil(finalize); // abort로 핸들러가 조기 종료돼도 저장 완료 보장
    await finalize.catch((e) => console.error("[assistant] stream 마감 실패:", e));
  });
}
