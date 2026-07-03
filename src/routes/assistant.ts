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
  updateAssistantMessageContent,
  type AssistantMessageRow,
} from "../db/queries/assistant-messages";
import { embedTexts } from "../lib/gemini-embed";
import { generateAnswer, generateAnswerStream } from "../lib/gemini-generate";
import { resolveCustomerScope } from "../lib/assistant-scope";
import { resolveGeminiTarget, type GeminiTarget } from "../lib/gemini-target";
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
const messageIdParam = z.object({ id: z.uuid() });
const trimSchema = z.object({ content: z.string().trim().min(1).max(20000) });

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
  updateAssistantMessageContent: typeof updateAssistantMessageContent;
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
  updateAssistantMessageContent,
  deleteAssistantMessage,
};

assistant.get("/messages", zValidator("query", messagesQuery), async (c) => {
  const { before, beforeId } = c.req.valid("query");
  const cursor = before && beforeId ? { createdAt: new Date(before), id: beforeId } : undefined;
  const rows = await assistantDeps.listRecentMessages(c.var.user.id, DISPLAY_LIMIT, c.var.db, cursor);
  return c.json(rows);
});

// 중단 트림 — stop 시 클라가 화면에 노출된 만큼으로 본인 답변을 잘라 저장(stop = 본 것까지만, 앱 미러).
// 쿼리가 id+staffUserId+role='assistant' 삼중 키라 타 staff/user 행은 404.
assistant.patch("/messages/:id", zValidator("param", messageIdParam), zValidator("json", trimSchema), async (c) => {
  const row = await assistantDeps.updateAssistantMessageContent(
    c.req.valid("param").id, c.var.user.id, c.req.valid("json").content, c.var.db,
  );
  if (!row) return c.json({ error: "대상 메시지가 없습니다." }, 404);
  return c.json(row);
});

assistant.post("/ask", zValidator("json", askSchema), async (c) => {
  const question = c.req.valid("json").question.trim();
  if (!question) return c.json({ error: "질문을 입력하세요." }, 400);
  const apiKey = (c.env as { GEMINI_API_KEY?: string } | undefined)?.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return c.json({ error: "서버 설정 오류입니다. 관리자에게 문의하세요." }, 500);

  const staffUserId = c.var.user.id;
  try {
    // GEMINI_PROXY_URL 설정 시(prod) Supabase Edge 릴레이 경유 — HKG 콜로 리전 차단 우회.
    const proxyUrl = (c.env as { GEMINI_PROXY_URL?: string } | undefined)?.GEMINI_PROXY_URL ?? process.env.GEMINI_PROXY_URL;
    const target = resolveGeminiTarget({ apiKey, proxyUrl, authHeader: c.req.header("Authorization") });
    // 히스토리 로드는 임베딩→검색 체인과 독립 — 병렬로 시작해 원격 DB 왕복 1회분 지연을 없앤다.
    const scope = resolveCustomerScope(c.var.user);
    const [history, hits] = await Promise.all([
      assistantDeps.listRecentMessages(staffUserId, HISTORY_LIMIT, c.var.db)
        .then((rows) => rows.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))),
      assistantDeps.embedTexts([question], target, "RETRIEVAL_QUERY")
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
      return await streamAsk(c, { question, staffUserId, target, history, hits, promptChunks, sources });
    }

    const answer = hits.length === 0
      ? NO_HITS_ANSWER
      : await assistantDeps.generateAnswer(SYSTEM_PROMPT, buildUserPrompt(question, buildContextBlock(promptChunks)), target, history);

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
  target: GeminiTarget;
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

const HEARTBEAT_MS = 5_000; // 죽은 클라 감지 주기 — CF에서 쓰기 성공/실패가 유일하게 신뢰 가능한 채널
const HEARTBEAT_WRITE_TIMEOUT_MS = 3_000; // SSE 쓰기는 정상 소비 시 즉시 완료 — 이 이상 지연이면 사망 간주

// signal이 abort될 때까지 최대 ms 대기 — abort 시 즉시 해소(정상 종료 후 하트비트 잔류 지연 방지).
function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const done = () => { clearTimeout(t); signal.removeEventListener("abort", done); resolve(); };
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

// SSE 스트리밍 경로: user+빈 placeholder 선저장 → text 릴레이 → 종료 마감(finalize) → done/error.
// abort 경로(STOP suffix·done 미송출)는 hono streamSSE 내부 abort 배선에 의존해 fake 라우트 유닛으로 검증이
// 어려움 — finalizeStreamedAnswer 유닛 + 브라우저 스모크(중지→리로드 시 "(중단됨)" 보존·빈 말풍선 없음)가 전담.
async function streamAsk(c: AskContext, args: StreamAskArgs): Promise<Response> {
  const now = new Date();
  const [userRow, placeholder] = (await assistantDeps.insertAssistantMessages([
    { staffUserId: args.staffUserId, role: "user", content: args.question, sources: null, createdAt: now },
    { staffUserId: args.staffUserId, role: "assistant", content: "", sources: null, createdAt: new Date(now.getTime() + 1) },
  ], c.var.db)) as [AssistantMessageRow, AssistantMessageRow];

  // 스트림 수명 guard — 두 역할:
  // ① dbHold: dbMiddleware의 next()는 스트림 "완료"가 아니라 Response "반환" 시점에 끝난다. 이 guard가 없으면
  //    client.end()가 릴레이 중에 실행돼 finalize의 마감 쿼리가 죽은 연결로 전부 실패한다(prod 실사고 — 정상
  //    완료 done까지 미송출). 미들웨어가 이 promise 해소 후에 연결을 닫는다.
  // ② waitUntil: abort 직후 CF가 아이솔레이트를 회수해도 릴레이+finalize 실행 완료를 보장(유령 빈 placeholder 방지).
  let settleGuard!: () => void;
  const streamDone = new Promise<void>((resolve) => { settleGuard = resolve; });
  c.set("dbHold", streamDone);
  const waitUntil = getWaitUntil(c);
  if (waitUntil) waitUntil(streamDone);

  return streamSSE(c, async (sse) => {
    const hbStop = new AbortController();
    try {
      let fullText = "";
      let aborted = false;
      let failed = false;
      // CF Pages에서 클라 disconnect는 어느 채널로도 신뢰 있게 전달되지 않는다(2026-07-03 prod 실측:
      // sse.onAbort·raw signal 미발화 + pending read/write가 reject 없이 얼어붙음 → finalize가
      // waitUntil 유예(~30s)를 넘겨 취소돼 유령 placeholder). 대응 3중:
      // ① onClientAbort: 신호가 오는 런타임에선 즉시 업스트림 중단(sse.onAbort + raw signal 이중 배선)
      // ② 하트비트: SSE 코멘트(": hb") 주기 송출 — 쓰기 실패/타임아웃 = 사망 판정(신호 없는 런타임의 최후 채널)
      // ③ raceDead: gen 읽기·클라 쓰기를 사망 promise와 race — 어떤 await에 얼어붙어도 릴레이 탈출 보장
      const upstreamAbort = new AbortController();
      let markDead!: () => void;
      const clientDead = new Promise<"dead">((resolve) => { markDead = () => resolve("dead"); });
      const onClientAbort = (source: string) => {
        if (aborted) return;
        aborted = true;
        console.log(`[assistant] stream 클라 중단 감지(${source}):`, placeholder.id);
        upstreamAbort.abort();
        markDead();
      };
      sse.onAbort(() => onClientAbort("sse.onAbort"));
      if (c.req.raw.signal.aborted) onClientAbort("signal(pre)");
      else c.req.raw.signal.addEventListener("abort", () => onClientAbort("signal"));
      const raceDead = <T,>(p: Promise<T>): Promise<T | "dead"> => Promise.race([p, clientDead]);

      void (async () => {
        for (;;) {
          await sleepUnlessAborted(HEARTBEAT_MS, hbStop.signal);
          if (hbStop.signal.aborted || aborted) return;
          try {
            const ok = await Promise.race([
              sse.write(": hb\n\n").then(() => true),
              sleepUnlessAborted(HEARTBEAT_WRITE_TIMEOUT_MS, hbStop.signal).then(() => false),
            ]);
            if (!ok && !hbStop.signal.aborted) { onClientAbort("heartbeat-timeout"); return; }
            if (!ok) return;
          } catch {
            onClientAbort("heartbeat-write-fail");
            return;
          }
        }
      })();

      try {
        if (args.hits.length === 0) {
          fullText = NO_HITS_ANSWER;
          await raceDead(sse.writeSSE({ event: "text", data: JSON.stringify({ chunk: fullText }) }));
        } else {
          const gen = assistantDeps.generateAnswerStream(
            SYSTEM_PROMPT, buildUserPrompt(args.question, buildContextBlock(args.promptChunks)), args.target, args.history,
            undefined, upstreamAbort.signal, // fetchImpl은 기본(fetch) 유지
          );
          for (;;) {
            const step = await raceDead(gen.next());
            if (step === "dead" || aborted) break;
            if (step.done) break;
            fullText += step.value;
            const wrote = await raceDead(sse.writeSSE({ event: "text", data: JSON.stringify({ chunk: step.value }) }));
            if (wrote === "dead") break;
          }
          // 사망/중단 탈출 시 잔여 generator 정리 — 얼어붙은 read를 기다리지 않도록 await하지 않는다.
          if (aborted) void gen.return(undefined).catch(() => {});
        }
      } catch (e) {
        // 스트림 중간 실패는 raw 에러(JSON SyntaxError 포함)를 generic하게 수용 — 부분 저장은 finalize가 담당.
        console.error("[assistant] stream 생성 실패:", e);
        failed = true;
      }
      console.log(`[assistant] stream 릴레이 종료 len=${fullText.length} aborted=${aborted} failed=${failed}`);

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
        console.log(`[assistant] stream 마감 완료 kind=${outcome.kind} aborted=${aborted}`);
        if (aborted) return; // 클라는 이미 끊김 — 이벤트 송출 생략
        if (outcome.kind === "done") {
          await raceDead(sse.writeSSE({ event: "done", data: JSON.stringify({ messages: [userRow, outcome.assistant] }) }));
        } else {
          await raceDead(sse.writeSSE({ event: "error", data: JSON.stringify({ code: "generation_failed", message: "일시적으로 답변에 실패했습니다." }) }));
        }
      })();

      await finalize.catch((e) => console.error("[assistant] stream 마감 실패:", e));
    } finally {
      hbStop.abort();
      settleGuard();
    }
  });
}
