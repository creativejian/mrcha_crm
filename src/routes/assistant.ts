import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
import { z } from "zod";

import { getCustomerMetaByIds, type CustomerMeta } from "../db/queries/embeddings-meta";
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
import { getStaffName } from "../db/queries/staff";
import { embedTexts } from "../lib/gemini-embed";
import { generateAnswer, generateAnswerStream } from "../lib/gemini-generate";
import { resolveCustomerScope } from "../lib/assistant-scope";
import { resolveGeminiTargetFromRequest, type GeminiTarget } from "../lib/gemini-target";
import { ASSISTANT_TOOL_KEYS, CRM_ROLE_LABELS } from "../lib/assistant-tools";
import { routeAssistantTool } from "../lib/assistant-tool-router";
import { stripChunkCustomerPrefix } from "../lib/assistant-corpus";
import { buildContextBlock, buildUserPrompt, NO_HITS_ANSWER, OUT_OF_SCOPE_ANSWER, SYSTEM_PROMPT, TOOL_SYSTEM_PROMPT, withCurrentUserContext, withTodayContext } from "../lib/assistant-prompt";
import { finalizeStreamedAnswer } from "../lib/assistant-stream";
import { createSseLiveness } from "../lib/sse-liveness";
import type { AuthVariables } from "../middleware/auth";
import { holdStreamLifetime, type DbVariables } from "../middleware/db";

export const assistant = new Hono<{ Variables: AuthVariables & DbVariables }>();

const TOP_K = 8;
// 근거 채택 유사도 임계값(cosine, ≥ 유지) — top-k는 관련도와 무관하게 항상 k개를 돌려주므로, 미달 청크를
// 프롬프트(생성 오염)와 sources(답변 하단 근거 표시 노이즈) 양쪽에서 제외한다.
// 전부 미달이면 기존 hits 0건 경로(NO_HITS_ANSWER, Gemini 미호출).
//
// 값은 **gemini-embedding-2 백필 직후 실측**(2026-07-22, 질문 12종 × 코퍼스 161청크):
//   관련 질문 최고 유사도 0.524 / 0.627 / 0.628 / 0.641 / 0.688 / 0.750 / 0.779 / 0.826
//   무관 질문(잡담·일반지식) 최고 0.461 / 0.490 / 0.495 / 0.540
// 무관 최고 0.540 위에 마진을 두고 **0.60** — 관련 7/8 통과·무관 0/4 오탐(0.65면 4/8까지 떨어진다).
// 유일한 탈락(0.524 "할 일 남은 게 뭐지?")은 질의 자체가 무한정 일반적인 경우라 수용한다.
//
// ⚠️ 구 값 0.75는 **gemini-embedding-001 공간의 실측치**였다(당시 관련 0.765~0.835·무관 0.61~0.72).
// 두 모델의 공간은 호환되지 않아(같은 문장 코사인 0.03) 분포가 통째로 아래로 이동·확산했고,
// 그대로 두면 관련 질문 8종 중 5종이 NO_HITS로 떨어졌다(모델 이관 시 실측). 임베딩 모델을 바꿀 때는
// 이 상수도 **반드시 같은 방법으로 재실측**할 것 — 모델 교체가 조용히 검색 재현율을 죽인다.
// prod 재조정은 아래 필터 로그(tail)로 컷 분포를 보고 한다.
export const SIMILARITY_THRESHOLD = 0.6;
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
  routeAssistantTool: typeof routeAssistantTool;
  getStaffName: typeof getStaffName;
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
  routeAssistantTool,
  getStaffName,
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
    // 히스토리·사용자 표시명 로드는 임베딩→검색 체인과 독립 — 병렬로 시작해 원격 DB 왕복 지연을 없앤다.
    // tool(빠른 질문 버튼 결정론) 지정 시 임베딩 검색 대신 리포트 쿼리를 같은 슬롯에서 병렬 실행.
    const scope = resolveCustomerScope(c.var.user);
    const toolKey = c.req.valid("json").tool;
    const historyPromise = assistantDeps.listRecentMessages(staffUserId, HISTORY_LIMIT, c.var.db)
      .then((rows) => rows.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
    const retrievalPromise = toolKey
      ? assistantDeps.runAssistantTool(toolKey, {}, scope, c.var.user, c.var.db)
          .then((tool) => ({ hits: [] as Awaited<ReturnType<typeof searchEmbeddings>>, tool }))
      : assistantDeps.embedTexts([question], target)
          .then(([queryVec]) => assistantDeps.searchEmbeddings(queryVec, scope, TOP_K, c.var.db))
          .then((all) => {
            const kept = all.filter((h) => h.similarity >= SIMILARITY_THRESHOLD);
            // 임계값 튜닝용 관측 로그(tail) — 컷 최고점이 임계값에 자주 근접하면 재조정 신호.
            if (kept.length < all.length) {
              const cutTop = Math.max(...all.filter((h) => h.similarity < SIMILARITY_THRESHOLD).map((h) => h.similarity));
              console.log(`[assistant] 근거 임계값 필터 ${all.length}→${kept.length} (컷 최고 ${cutTop.toFixed(4)})`);
            }
            return { hits: kept, tool: null };
          });
    // 자유 질문 라우팅도 같은 슬롯에서 겹친다 — 라우터는 question+history만 쓰고 hits에 의존하지 않는다.
    // Gemini 왕복 수·비용은 그대로다(줄지 않는다). 줄어드는 건 벽시계뿐: 직렬 (임베딩+검색)+라우팅이
    // max(임베딩+검색, 히스토리+라우팅)로 겹쳐 자유 질문 TTFB가 앞당겨진다(스트리밍 경로의 임계경로).
    // · tool(빠른 질문 버튼)이 의도를 확정했으면 라우터를 아예 호출하지 않는다(현행 계약).
    // · 검색이 먼저 실패하면 이 라우팅 응답은 버려진다 — 실패 경로에서 라우팅 1회를 더 쓰는 대가로,
    //   500 계약은 불변이다(routeAssistantTool은 자체 catch로 null만 반환해 Promise.all을 reject시키지 않는다).
    const routedPromise = toolKey
      ? Promise.resolve(null)
      : historyPromise.then((history) => assistantDeps.routeAssistantTool(question, target, { history }));
    const [history, retrieval, staffName, routed] = await Promise.all([
      historyPromise,
      retrievalPromise,
      assistantDeps.getStaffName(staffUserId, c.var.db),
      routedPromise,
    ]);
    let { tool } = retrieval;
    const { hits } = retrieval;
    // 자유 질문 라우팅 — 근거 유무와 무관하게 먼저 판단한다(2026-07-07 이사님 결정, 구 "근거 0건에서만"에서
    // 확장). "김지안 견적 몇 개"처럼 집계/목록 질문은 RAG 근거가 잡혀도(hits>0) top-k 나열론 개수를 정확히
    // 세지 못해 환각하므로, 라우터가 도구로 판단하면(call) 근거를 대체해 도구 결과로 답한다. 서술형·잡담은
    // 라우터가 none/null이라 기존 RAG 경로(hits)를 그대로 탄다 — 오라우팅 방지는 라우터 프롬프트+골든 테스트가
    // 잠근다. none(도구 불필요=범위 밖)은 근거도 0건일 때만 안내 문구(근거가 있으면 RAG로 답할 수 있으므로).
    let outOfScope = false;
    if (!tool) {
      if (routed?.kind === "call") {
        console.log(`[assistant] 도구 라우팅: ${routed.key}`, JSON.stringify(routed.params));
        // 도구 실행만은 라우터 결과에 의존하므로 병렬 슬롯에 넣을 수 없다(골든이 순서를 잠근다).
        tool = await assistantDeps.runAssistantTool(routed.key, routed.params, scope, c.var.user, c.var.db);
        // 오라우팅 구제(2026-07-22 실기) — 도구가 0건인데 RAG 근거는 있으면 도구 선택이 틀렸을 확률이
        // 높다. 라우팅 우선 게이트가 그 근거를 버려 "정보가 없습니다"로 답하던 것을 RAG로 되돌린다.
        // 도구가 1건이라도 냈으면 기존 계약(도구 우선 = 집계 정확)이 그대로다.
        if (tool.lines.length === 0 && hits.length > 0) {
          console.log(`[assistant] 도구 0건 → RAG 폴백(근거 ${hits.length}건)`);
          tool = null;
        }
      } else if (routed?.kind === "none" && hits.length === 0) {
        console.log("[assistant] 도구 라우팅: 해당 없음(범위 밖 판단 — 안내 문구)");
        outOfScope = true;
      }
    }
    // 도구 결과를 쓰는 경로는 아래 promptChunks·sources가 둘 다 tool 분기라 metaById를 소비하지 않는다.
    // 라우팅 도구 경로는 hits>0일 수 있어(#192 라우팅 우선 게이트) 가드 없이 조회하면 결과를 버리는
    // 원격 왕복이 된다. 버튼 경로는 hits=[]라 getCustomerMetaByIds의 빈 배열 단축이 이미 흡수한다.
    const metaById = tool
      ? new Map<string, CustomerMeta>()
      : await assistantDeps.getCustomerMetaByIds([...new Set(hits.map((h) => h.customerId))], c.var.db);
    // 도구 결과는 근거 블록 1청크로 — 0건도 "조회 결과 없음"으로 실어 NO_HITS(고정 답변)가 아니라
    // 모델이 "해당 없음"을 정리하게 한다(리포트 질문에 "데이터를 못 찾았다"는 오답).
    // content의 "고객 {이름} " 접두는 표시 라벨(customerName)과 중복이라 벗긴다(재임베딩 불필요 — 표시 시점만).
    const promptChunks = tool
      ? [{ customerName: tool.label, customerStatus: "리포트", content: tool.lines.length ? tool.lines.join("\n") : "조회 결과 없음" }]
      : hits.map((h) => {
          const name = metaById.get(h.customerId)?.name ?? "고객";
          return { customerName: name, customerStatus: metaById.get(h.customerId)?.status ?? "", content: stripChunkCustomerPrefix(h.content, name) };
        });
    const sources = tool
      ? [{ customerId: "", customerName: "리포트", sourceType: "tool", snippet: `${tool.label} — ${tool.lines.length}건 조회` }]
      : hits.map((h) => {
          const name = metaById.get(h.customerId)?.name ?? "고객";
          return { customerId: h.customerId, customerName: name, sourceType: h.sourceType, snippet: stripChunkCustomerPrefix(h.content, name).slice(0, 120) };
        });

    // 오늘 날짜(KST)·현재 사용자 컨텍스트 — 절대 날짜 근거의 과거/미래 판단 기준 + 1인칭("나/내") 해석
    // 기준(양 경로 공통). 표시명 미상(profiles 없음)이어도 역할 라벨은 항상 실린다.
    const userLabel = `${staffName ?? "이름 미상"}(${CRM_ROLE_LABELS[c.var.user.role] ?? c.var.user.role})`;
    const systemPrompt = withCurrentUserContext(withTodayContext(tool ? TOOL_SYSTEM_PROMPT : SYSTEM_PROMPT), userLabel);
    // promptChunks 0건일 때의 고정 답변 — 범위 밖 판단(라우터 none)만 안내 문구, 그 외는 기존 NO_HITS.
    const emptyAnswer = outOfScope ? OUT_OF_SCOPE_ANSWER : NO_HITS_ANSWER;

    if (c.req.valid("json").stream === true) {
      // await 필수: 선저장(insertAssistantMessages) 실패를 이 try/catch가 잡으려면 rejection이
      // 이 스코프 안에서 throw로 전환돼야 한다(그냥 return하면 catch를 건너뛰고 app.onError로 샌다).
      return await streamAsk(c, { question, staffUserId, target, history, promptChunks, sources, systemPrompt, emptyAnswer });
    }

    const answer = promptChunks.length === 0
      ? emptyAnswer
      : await assistantDeps.generateAnswer(systemPrompt, buildUserPrompt(question, buildContextBlock(promptChunks)), target, { history });

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
// hits는 넘기지 않는다 — NO_HITS 게이트가 promptChunks 기준(#171)으로 바뀐 뒤 streamAsk 내부 사용처 0.
type StreamAskArgs = {
  question: string;
  staffUserId: string;
  target: GeminiTarget;
  history: { role: "user" | "assistant"; content: string }[];
  promptChunks: { customerName: string; customerStatus: string; content: string }[];
  sources: unknown;
  systemPrompt: string; // RAG(SYSTEM_PROMPT) vs 도구 리포트(TOOL_SYSTEM_PROMPT) — 호출부가 선택
  emptyAnswer: string; // promptChunks 0건일 때의 고정 답변(NO_HITS vs 범위 밖 안내) — 호출부가 선택
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
          fullText = args.emptyAnswer;
          await raceDead(sse.writeSSE({ event: "text", data: JSON.stringify({ chunk: fullText }) }));
        } else {
          const gen = assistantDeps.generateAnswerStream(
            args.systemPrompt, buildUserPrompt(args.question, buildContextBlock(args.promptChunks)), args.target,
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
