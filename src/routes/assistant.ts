import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
import { z } from "zod";

import { getCustomerMetaByIds } from "../db/queries/embeddings-meta";
import { searchEmbeddings } from "../db/queries/embeddings";
import { runAssistantTool } from "../db/queries/assistant-tools";
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
import { resolveGeminiTargetFromRequest, type GeminiTarget } from "../lib/gemini-target";
import { ASSISTANT_TOOL_KEYS } from "../lib/assistant-tools";
import { buildContextBlock, buildUserPrompt, NO_HITS_ANSWER, SYSTEM_PROMPT } from "../lib/assistant-prompt";
import { finalizeStreamedAnswer } from "../lib/assistant-stream";
import { createSseLiveness } from "../lib/sse-liveness";
import type { AuthVariables } from "../middleware/auth";
import { holdStreamLifetime, type DbVariables } from "../middleware/db";

export const assistant = new Hono<{ Variables: AuthVariables & DbVariables }>();

const TOP_K = 8;
// 근거 채택 유사도 임계값(cosine, ≥ 유지) — top-k는 관련도와 무관하게 항상 k개를 돌려주므로, 미달 청크를
// 프롬프트(생성 오염)와 sources(답변 하단 근거 표시 노이즈) 양쪽에서 제외한다. 값은 2026-07-06 실측 기반
// (질문 8종 × 코퍼스 37청크): 진짜 관련 0.765~0.835 · 관련 질문에 딸려온 무관 청크 ≤0.757 · 무관 질문
// (잡담/일반지식) 최고 0.61~0.72. 갭(0.757↔0.765) 하단에 마진을 두고 0.75 — 재현율 우선(더 올리면 약한
// 질의가 통째로 NO_HITS로 떨어진다). 전부 미달이면 기존 hits 0건 경로(NO_HITS_ANSWER, Gemini 미호출).
// prod 재조정은 아래 필터 로그(tail)로 컷 분포를 보고 한다.
export const SIMILARITY_THRESHOLD = 0.75;
const HISTORY_LIMIT = 10; // 멀티턴 컨텍스트로 넣을 최근 메시지 수(앱과 동일)
export const DISPLAY_LIMIT = 30; // 패널 진입 시 로드할 최근 메시지 수 — 클라 AI_HISTORY_PAGE와 파리티(테스트 가드)
// tool = 빠른 질문 버튼 결정론 라우팅(B안 PR1) — 지정 시 임베딩 검색을 생략하고 화이트리스트
// 리포트 쿼리 결과를 근거로 생성한다. 자유 질문 모델 라우팅(function calling)은 PR2.
const askSchema = z.object({ question: z.string(), stream: z.boolean().optional(), tool: z.enum(ASSISTANT_TOOL_KEYS).optional() });
const messagesQuery = z.object({ before: z.iso.datetime().optional(), beforeId: z.uuid().optional() });
const messageIdParam = z.object({ id: z.uuid() });
const trimSchema = z.object({ content: z.string().trim().min(1).max(20000) });

// 테스트가 주입 가능한 의존성(mock.module 대신 — 전역 누출 방지).
export type AssistantDeps = {
  embedTexts: typeof embedTexts;
  searchEmbeddings: typeof searchEmbeddings;
  runAssistantTool: typeof runAssistantTool;
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
  runAssistantTool,
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
  // env→target 배선 SSOT(gemini-target.ts) — GEMINI_PROXY_URL 설정 시(prod) 서울 핀 릴레이 경유.
  const target = resolveGeminiTargetFromRequest(c);
  if (!target) return c.json({ error: "서버 설정 오류입니다. 관리자에게 문의하세요." }, 500);

  const staffUserId = c.var.user.id;
  try {
    // 히스토리 로드는 임베딩→검색 체인과 독립 — 병렬로 시작해 원격 DB 왕복 1회분 지연을 없앤다.
    // tool(빠른 질문 버튼 결정론) 지정 시 임베딩 검색 대신 리포트 쿼리를 같은 슬롯에서 병렬 실행.
    const scope = resolveCustomerScope(c.var.user);
    const toolKey = c.req.valid("json").tool;
    const [history, retrieval] = await Promise.all([
      assistantDeps.listRecentMessages(staffUserId, HISTORY_LIMIT, c.var.db)
        .then((rows) => rows.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))),
      toolKey
        ? assistantDeps.runAssistantTool(toolKey, c.var.db)
            .then((tool) => ({ hits: [] as Awaited<ReturnType<typeof searchEmbeddings>>, tool }))
        : assistantDeps.embedTexts([question], target, "RETRIEVAL_QUERY")
            .then(([queryVec]) => assistantDeps.searchEmbeddings(queryVec, scope, TOP_K, c.var.db))
            .then((all) => {
              const kept = all.filter((h) => h.similarity >= SIMILARITY_THRESHOLD);
              // 임계값 튜닝용 관측 로그(tail) — 컷 최고점이 임계값에 자주 근접하면 재조정 신호.
              if (kept.length < all.length) {
                const cutTop = Math.max(...all.filter((h) => h.similarity < SIMILARITY_THRESHOLD).map((h) => h.similarity));
                console.log(`[assistant] 근거 임계값 필터 ${all.length}→${kept.length} (컷 최고 ${cutTop.toFixed(4)})`);
              }
              return { hits: kept, tool: null };
            }),
    ]);
    const { hits, tool } = retrieval;
    const metaById = await assistantDeps.getCustomerMetaByIds([...new Set(hits.map((h) => h.customerId))], c.var.db);
    // 도구 결과는 근거 블록 1청크로 — 0건도 "조회 결과 없음"으로 실어 NO_HITS(고정 답변)가 아니라
    // 모델이 "해당 없음"을 정리하게 한다(리포트 질문에 "데이터를 못 찾았다"는 오답).
    const promptChunks = tool
      ? [{ customerName: tool.label, customerStatus: "리포트", content: tool.lines.length ? tool.lines.join("\n") : "조회 결과 없음" }]
      : hits.map((h) => ({
          customerName: metaById.get(h.customerId)?.name ?? "고객",
          customerStatus: metaById.get(h.customerId)?.status ?? "",
          content: h.content,
        }));
    const sources = tool
      ? [{ customerId: "", customerName: "리포트", sourceType: "tool", snippet: `${tool.label} — ${tool.lines.length}건 조회` }]
      : hits.map((h) => ({
          customerId: h.customerId, customerName: metaById.get(h.customerId)?.name ?? "고객",
          sourceType: h.sourceType, snippet: h.content.slice(0, 120),
        }));

    if (c.req.valid("json").stream === true) {
      // await 필수: 선저장(insertAssistantMessages) 실패를 이 try/catch가 잡으려면 rejection이
      // 이 스코프 안에서 throw로 전환돼야 한다(그냥 return하면 catch를 건너뛰고 app.onError로 샌다).
      return await streamAsk(c, { question, staffUserId, target, history, hits, promptChunks, sources });
    }

    const answer = promptChunks.length === 0
      ? NO_HITS_ANSWER
      : await assistantDeps.generateAnswer(SYSTEM_PROMPT, buildUserPrompt(question, buildContextBlock(promptChunks)), target, { history });

    const saved = await insertTurn(staffUserId, question, { content: answer, sources }, c.var.db);
    // 답변·출처는 saved[1]에 영속 — 클라이언트는 messages만 소비한다(이중 표현 금지).
    return c.json({ messages: saved });
  } catch (e) {
    console.error("[assistant] ask 실패:", e);
    return c.json({ error: "일시적으로 답변에 실패했습니다." }, 500);
  }
});

// user+assistant 2행 원자 저장 — createdAt now/now+1ms 규약은 (created_at,id) 복합 커서 정렬과 맞물린
// 계약이라 두 저장 경로(논스트림=완성 답변, 스트림=빈 placeholder 선저장)가 반드시 공유한다.
function insertTurn(
  staffUserId: string,
  question: string,
  assistant: { content: string; sources: unknown },
  db: DbVariables["db"],
): Promise<AssistantMessageRow[]> {
  const now = new Date();
  return assistantDeps.insertAssistantMessages([
    { staffUserId, role: "user", content: question, sources: null, createdAt: now },
    { staffUserId, role: "assistant", content: assistant.content, sources: assistant.sources, createdAt: new Date(now.getTime() + 1) },
  ], db);
}

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

const HEARTBEAT_MS = 5_000; // 죽은 클라 감지 주기 — CF에서 쓰기 성공/실패가 유일하게 신뢰 가능한 채널
const HEARTBEAT_WRITE_TIMEOUT_MS = 3_000; // SSE 쓰기는 정상 소비 시 즉시 완료 — 이 이상 지연이면 사망 간주

// SSE 스트리밍 경로: user+빈 placeholder 선저장 → text 릴레이 → 종료 마감(finalize) → done/error.
// abort 경로(STOP suffix·done 미송출)는 hono streamSSE 내부 abort 배선에 의존해 fake 라우트 유닛으로 검증이
// 어려움 — finalizeStreamedAnswer 유닛 + 브라우저 스모크(중지→리로드 시 "(중단됨)" 보존·빈 말풍선 없음)가 전담.
async function streamAsk(c: AskContext, args: StreamAskArgs): Promise<Response> {
  const [userRow, placeholder] = (await insertTurn(
    args.staffUserId, args.question, { content: "", sources: null }, c.var.db,
  )) as [AssistantMessageRow, AssistantMessageRow];

  // 스트림 수명 hold(dbHold+waitUntil 원자 등록) — 역할·사고 이력은 holdStreamLifetime 주석 참조.
  const releaseHold = holdStreamLifetime(c);

  return streamSSE(c, async (sse) => {
    // CF Pages에서 클라 disconnect는 어느 채널로도 신뢰 있게 전달되지 않는다 — 하트비트·raceDead
    // 타이밍 기계장치는 sse-liveness.ts로 추출(prod 실측 배경은 그 모듈 주석 참조). 여기는
    // 채널 배선(sse.onAbort + raw signal 이중)과 도메인(업스트림 Gemini 중단·finalize)만 소유한다.
    let aborted = false;
    const upstreamAbort = new AbortController();
    const onClientAbort = (source: string) => {
      if (aborted) return;
      aborted = true;
      console.log(`[assistant] stream 클라 중단 감지(${source}):`, placeholder.id);
      upstreamAbort.abort();
      live.markDead();
    };
    const live = createSseLiveness({
      writeRaw: (chunk) => sse.write(chunk),
      heartbeatMs: HEARTBEAT_MS,
      writeTimeoutMs: HEARTBEAT_WRITE_TIMEOUT_MS,
      onDead: onClientAbort,
    });
    const { raceDead } = live;
    try {
      let fullText = "";
      let failed = false;
      sse.onAbort(() => onClientAbort("sse.onAbort"));
      if (c.req.raw.signal.aborted) onClientAbort("signal(pre)");
      else c.req.raw.signal.addEventListener("abort", () => onClientAbort("signal"));

      try {
        if (args.promptChunks.length === 0) {
          fullText = NO_HITS_ANSWER;
          await raceDead(sse.writeSSE({ event: "text", data: JSON.stringify({ chunk: fullText }) }));
        } else {
          const gen = assistantDeps.generateAnswerStream(
            SYSTEM_PROMPT, buildUserPrompt(args.question, buildContextBlock(args.promptChunks)), args.target,
            { history: args.history, signal: upstreamAbort.signal },
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
      live.stop();
      releaseHold();
    }
  });
}
