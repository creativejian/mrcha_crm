import { test, expect, afterEach } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { EMBEDDING_DIM } from "../lib/gemini-embed";
import { assistantDeps, DISPLAY_LIMIT, SIMILARITY_THRESHOLD } from "./assistant";

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
  assistantDeps.generateAnswer = async (_s: string, _u: string, _t: unknown, opts?: { history?: { role: string }[] }) => { seen.historyLen = opts?.history?.length ?? 0; return "답변"; };
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

// 클라는 rows.length === AI_HISTORY_PAGE로 hasMore를 판정 — 서버 LIMIT만 바뀌면 이전 대화 페이지네이션이
// 에러 없이 조용히 죽는다(조기 종료 또는 항상 hasMore). STOP_SUFFIX 파리티(assistant-stream.test.ts)와 동일 패턴.
test("DISPLAY_LIMIT 서버↔클라(AI_HISTORY_PAGE) 파리티", async () => {
  const { AI_HISTORY_PAGE } = await import("../../client/src/lib/assistant-history");
  expect(DISPLAY_LIMIT).toBe(AI_HISTORY_PAGE);
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

// SSE 응답 텍스트 → 이벤트 배열(테스트 전용 간이 파서).
function parseSse(text: string): { event: string; data: string }[] {
  const events: { event: string; data: string }[] = [];
  let event = "message";
  let dataLines: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line === "") {
      if (dataLines.length > 0) events.push({ event, data: dataLines.join("\n") });
      event = "message";
      dataLines = [];
    } else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  return events;
}

function streamRagFakes(seen: { inserted: unknown[][]; updated?: { id: string; content: string }; deletedId?: string }) {
  assistantDeps.listRecentMessages = async () => [];
  assistantDeps.embedTexts = async (texts: string[]) => texts.map(() => Array.from({ length: EMBEDDING_DIM }, () => 0.01));
  assistantDeps.searchEmbeddings = async () => [{ id: "e1", sourceType: "memo", sourceId: "s1", customerId: "c1", content: "근거", similarity: 0.9 }];
  assistantDeps.getCustomerMetaByIds = async () => new Map([["c1", { name: "김민준", status: "상담중" }]]);
  assistantDeps.insertAssistantMessages = async (rows) => {
    seen.inserted.push(rows as unknown[]);
    return rows.map((r, i) => ({ ...r, id: `row-${i}` })) as never;
  };
  assistantDeps.updateAssistantMessage = async (id: string, _staffUserId: string, content: string, sources: unknown) => {
    seen.updated = { id, content };
    return { id, staffUserId: "s", role: "assistant", content, sources, createdAt: new Date(1) } as never;
  };
  assistantDeps.deleteAssistantMessage = async (id: string, _staffUserId: string) => { seen.deletedId = id; };
}

test("POST /ask stream:true → 선저장 + text 이벤트 릴레이 + done에 영속본 2건", async () => {
  const seen: { inserted: unknown[][]; updated?: { id: string; content: string } } = { inserted: [] };
  streamRagFakes(seen);
  assistantDeps.generateAnswerStream = async function* () { yield "안녕"; yield "하세요"; };

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "q", stream: true }) });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");

  const events = parseSse(await res.text());
  const texts = events.filter((e) => e.event === "text").map((e) => (JSON.parse(e.data) as { chunk: string }).chunk);
  expect(texts).toEqual(["안녕", "하세요"]);
  expect(seen.inserted[0]).toHaveLength(2); // user + 빈 placeholder 선저장
  expect(seen.updated!.id).toBe("row-1");
  expect(seen.updated!.content).toBe("안녕하세요");
  const done = events.find((e) => e.event === "done");
  const messages = (JSON.parse(done!.data) as { messages: { role: string; content: string }[] }).messages;
  expect(messages).toHaveLength(2);
  expect(messages[1].content).toBe("안녕하세요");
});

test("PATCH /messages/:id — 본인 assistant 행 content를 트림 저장(stop=본 것까지만)", async () => {
  let captured: [string, string, string] | null = null;
  assistantDeps.updateAssistantMessageContent = async (id: string, staffUserId: string, content: string) => {
    captured = [id, staffUserId, content];
    return { id, staffUserId, role: "assistant", content, sources: null, createdAt: new Date(1) } as never;
  };
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const id = "11111111-1111-4111-8111-111111111111";
  const res = await app.request(`/api/assistant/messages/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content: "부분 (중단됨)" }),
  });
  expect(res.status).toBe(200);
  expect((await res.json() as { content: string }).content).toBe("부분 (중단됨)");
  expect(captured![0]).toBe(id);
  expect(typeof captured![1]).toBe("string");
  expect(captured![2]).toBe("부분 (중단됨)");
});

test("PATCH /messages/:id — 대상 없음(타 staff/부재)은 404", async () => {
  assistantDeps.updateAssistantMessageContent = async () => null;
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/messages/11111111-1111-4111-8111-111111111111", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content: "x" }),
  });
  expect(res.status).toBe(404);
});

test("PATCH /messages/:id — 빈 content는 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/messages/11111111-1111-4111-8111-111111111111", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content: "  " }),
  });
  expect(res.status).toBe(400);
});

// 2026-07-03 prod 실측: 클라 disconnect 후 pending Gemini read는 CF에서 해소되지 않아 finalize가
// waitUntil 유예(30s)를 넘겨 취소된다(유령 placeholder). abort 시 업스트림 fetch를 즉시 끊기 위한 배선.
test("POST /ask stream:true → generateAnswerStream에 AbortSignal이 전달된다", async () => {
  const seen: { inserted: unknown[][] } = { inserted: [] };
  streamRagFakes(seen);
  let sig: unknown = "unset";
  assistantDeps.generateAnswerStream = async function* (
    _s: string, _u: string, _t: unknown, opts?: { signal?: AbortSignal },
  ) {
    sig = opts?.signal;
    yield "x";
  };

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "q", stream: true }) });
  await res.text();
  expect(sig).toBeInstanceOf(AbortSignal);
});

test("POST /ask stream:true 스트림 중간 실패(부분 있음) → 부분+ERROR_SUFFIX 저장 + done", async () => {
  const seen: { inserted: unknown[][]; updated?: { id: string; content: string } } = { inserted: [] };
  streamRagFakes(seen);
  assistantDeps.generateAnswerStream = async function* () { yield "부분"; throw new Error("boom"); };

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "q", stream: true }) });
  const events = parseSse(await res.text());
  expect(seen.updated!.content).toBe("부분 (연결 오류로 중단됨)");
  expect(events.some((e) => e.event === "done")).toBe(true);
  expect(events.some((e) => e.event === "error")).toBe(false);
});

test("POST /ask stream:true 0자 실패 → placeholder 삭제 + error 이벤트", async () => {
  const seen: { inserted: unknown[][]; deletedId?: string } = { inserted: [] };
  streamRagFakes(seen);
  // eslint-disable-next-line require-yield -- 0자(즉시 실패) 시나리오 재현을 위해 의도적으로 yield 없이 throw
  assistantDeps.generateAnswerStream = async function* () { throw new Error("boom"); };

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "q", stream: true }) });
  const events = parseSse(await res.text());
  expect(seen.deletedId).toBe("row-1");
  const error = events.find((e) => e.event === "error");
  expect((JSON.parse(error!.data) as { message: string }).message).toBe("일시적으로 답변에 실패했습니다.");
});

test("POST /ask stream:true hits 0건 → 고정 문구 text 1회 + done(저장 동일)", async () => {
  const seen: { inserted: unknown[][]; updated?: { id: string; content: string } } = { inserted: [] };
  streamRagFakes(seen);
  assistantDeps.searchEmbeddings = async () => [];
  assistantDeps.routeAssistantTool = async () => null; // PR2: hits 0이면 라우팅이 시도됨 — 이 테스트는 도구 불필요 판단 경로
  // eslint-disable-next-line require-yield -- hits 0건이면 호출 자체가 없어야 함을 검증하는 가드(호출되면 즉시 throw)
  assistantDeps.generateAnswerStream = async function* () { throw new Error("호출되면 안 됨"); };

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "q", stream: true }) });
  const events = parseSse(await res.text());
  const texts = events.filter((e) => e.event === "text");
  expect(texts).toHaveLength(1);
  expect((JSON.parse(texts[0].data) as { chunk: string }).chunk).toBe("관련 CRM 데이터를 찾지 못했습니다.");
  expect(seen.updated!.content).toBe("관련 CRM 데이터를 찾지 못했습니다.");
});

// 근거 유사도 임계값(2026-07-06 실측 기반) — top-k는 관련도와 무관하게 항상 k개를 돌려주므로
// 미달 청크를 프롬프트(생성 오염)·sources(화면 근거 8줄 노이즈) 양쪽에서 제외한다.
const mkHit = (id: string, similarity: number) =>
  ({ id, sourceType: "memo", sourceId: id, customerId: "c1", content: `근거-${id}`, similarity });

test("POST /ask 임계값 미달 청크는 프롬프트·sources에서 제외(경계값 == 임계값은 유지)", async () => {
  let userPrompt = "";
  let savedSources: unknown[] = [];
  assistantDeps.listRecentMessages = async () => [];
  assistantDeps.embedTexts = async (texts: string[]) => texts.map(() => Array.from({ length: EMBEDDING_DIM }, () => 0.01));
  assistantDeps.searchEmbeddings = async () => [mkHit("e1", 0.9), mkHit("e2", SIMILARITY_THRESHOLD), mkHit("e3", 0.749), mkHit("e4", 0.6)];
  assistantDeps.getCustomerMetaByIds = async () => new Map([["c1", { name: "김민준", status: "상담중" }]]);
  assistantDeps.generateAnswer = async (_s: string, u: string) => { userPrompt = u; return "답변"; };
  assistantDeps.insertAssistantMessages = async (rows: unknown[]) => {
    savedSources = (rows[1] as { sources: unknown[] }).sources;
    return rows as never;
  };

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "q" }) });
  expect(res.status).toBe(200);
  expect(userPrompt).toContain("근거-e1");
  expect(userPrompt).toContain("근거-e2"); // 경계값(== 임계값)은 유지 — ≥ 비교
  expect(userPrompt).not.toContain("근거-e3");
  expect(userPrompt).not.toContain("근거-e4");
  expect(savedSources).toHaveLength(2);
});

test("POST /ask 전부 임계값 미달 → 기존 hits 0건 경로(Gemini 미호출·고정 답변·sources 빈 배열)", async () => {
  let savedSources: unknown[] | null = null;
  assistantDeps.routeAssistantTool = async () => null; // 라우팅도 도구 불필요 판단
  assistantDeps.listRecentMessages = async () => [];
  assistantDeps.embedTexts = async (texts: string[]) => texts.map(() => Array.from({ length: EMBEDDING_DIM }, () => 0.01));
  assistantDeps.searchEmbeddings = async () => [mkHit("e1", 0.74), mkHit("e2", 0.6)];
  assistantDeps.getCustomerMetaByIds = async () => new Map();
  assistantDeps.generateAnswer = async () => { throw new Error("호출되면 안 됨"); };
  assistantDeps.insertAssistantMessages = async (rows: unknown[]) => {
    savedSources = (rows[1] as { sources: unknown[] }).sources;
    return rows as never;
  };

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "q" }) });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { messages: { content: string }[] };
  expect(json.messages[1].content).toBe("관련 CRM 데이터를 찾지 못했습니다.");
  expect(savedSources).toHaveLength(0);
});

test("POST /ask stream:true 전부 임계값 미달 → hits 0건과 동일(고정 문구 text 1회)", async () => {
  const seen: { inserted: unknown[][]; updated?: { id: string; content: string } } = { inserted: [] };
  streamRagFakes(seen);
  assistantDeps.searchEmbeddings = async () => [mkHit("e1", 0.7)];
  assistantDeps.routeAssistantTool = async () => null;
  // eslint-disable-next-line require-yield -- 전부 미달이면 호출 자체가 없어야 함을 검증하는 가드(호출되면 즉시 throw)
  assistantDeps.generateAnswerStream = async function* () { throw new Error("호출되면 안 됨"); };

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "q", stream: true }) });
  const events = parseSse(await res.text());
  const texts = events.filter((e) => e.event === "text");
  expect(texts).toHaveLength(1);
  expect((JSON.parse(texts[0].data) as { chunk: string }).chunk).toBe("관련 CRM 데이터를 찾지 못했습니다.");
  expect(seen.updated!.content).toBe("관련 CRM 데이터를 찾지 못했습니다.");
});

// 빠른 질문 도구 경로(2026-07-06 B안 PR1) — 버튼 결정론: tool 지정 시 임베딩 검색을 생략하고
// 화이트리스트 리포트 쿼리 결과를 근거 블록으로 생성한다(집계·조건형 질의는 RAG로 원리적 불가).
test("POST /ask tool 지정 → 검색 생략·도구 결과 근거·sources 리포트 표기·NO_HITS 미발동", async () => {
  let userPrompt = "";
  let savedSources: unknown[] = [];
  let calledKey = "";
  assistantDeps.listRecentMessages = async () => [];
  assistantDeps.embedTexts = async () => { throw new Error("도구 경로에서 임베딩이 호출되면 안 됨"); };
  assistantDeps.runAssistantTool = async (key) => {
    calledKey = key;
    return { label: "오늘 처리할 일", lines: ["김민준 — GLC 재고 확인 (기한 오늘)", "박서연 — 월납입표 확인 (기한 급함)"] };
  };
  assistantDeps.getCustomerMetaByIds = async () => new Map();
  let systemPrompt = "";
  assistantDeps.generateAnswer = async (sp: string, u: string) => { systemPrompt = sp; userPrompt = u; return "정리했습니다"; };
  assistantDeps.insertAssistantMessages = async (rows: unknown[]) => {
    savedSources = (rows[1] as { sources: unknown[] }).sources;
    return rows as never;
  };

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "오늘 내가 먼저 처리할 일 정리해줘", tool: "today_actions" }) });
  expect(res.status).toBe(200);
  expect(calledKey).toBe("today_actions");
  expect(userPrompt).toContain("김민준 — GLC 재고 확인");
  expect((await res.json() as { messages: { content: string }[] }).messages[1].content).toBe("정리했습니다");
  expect(savedSources).toHaveLength(1);
  expect(savedSources[0]).toEqual({ customerId: "", customerName: "리포트", sourceType: "tool", snippet: "오늘 처리할 일 — 2건 조회" });
  // 도구 경로는 전용 시스템 프롬프트 — RAG 프롬프트의 NO_HITS 지시가 실리면 리포트가 있어도
  // 모델이 고정 문구를 뱉는 실측 결함(2026-07-06 e2e) 재발 방지.
  expect(systemPrompt).toContain("리포트 조회 결과");
  expect(systemPrompt).not.toContain("관련 CRM 데이터를 찾지 못했습니다");
});

test("POST /ask tool 결과 0건 → NO_HITS가 아니라 '조회 결과 없음' 근거로 생성", async () => {
  let userPrompt = "";
  assistantDeps.listRecentMessages = async () => [];
  assistantDeps.embedTexts = async () => { throw new Error("호출되면 안 됨"); };
  assistantDeps.runAssistantTool = async () => ({ label: "출고/정산 리스크", lines: [] });
  assistantDeps.getCustomerMetaByIds = async () => new Map();
  assistantDeps.generateAnswer = async (_s: string, u: string) => { userPrompt = u; return "해당 고객이 없습니다"; };
  assistantDeps.insertAssistantMessages = async (rows: unknown[]) => rows as never;

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "출고/정산 리스크 찾아줘", tool: "delivery_risk" }) });
  expect(res.status).toBe(200);
  expect(userPrompt).toContain("조회 결과 없음");
  expect((await res.json() as { messages: { content: string }[] }).messages[1].content).toBe("해당 고객이 없습니다"); // 고정 NO_HITS 문구가 아님
});

test("POST /ask 알 수 없는 tool 값 → 400(zod 어휘 게이트)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "q", tool: "drop_table" }) });
  expect(res.status).toBe(400);
});

test("POST /ask stream:true + tool → 도구 근거로 스트림 생성(고정 문구 아님)", async () => {
  const seen: { inserted: unknown[][]; updated?: { id: string; content: string } } = { inserted: [] };
  streamRagFakes(seen);
  assistantDeps.embedTexts = async () => { throw new Error("도구 경로에서 임베딩이 호출되면 안 됨"); };
  assistantDeps.runAssistantTool = async () => ({ label: "계약 가능성 순위", lines: ["1위 김민준 — 확정"] });
  assistantDeps.generateAnswerStream = async function* () { yield "1위는 "; yield "김민준입니다"; };

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "계약 가능성 높은 고객 순위 뽑아줘", stream: true, tool: "chance_ranking" }) });
  const events = parseSse(await res.text());
  const texts = events.filter((e) => e.event === "text").map((e) => (JSON.parse(e.data) as { chunk: string }).chunk);
  expect(texts).toEqual(["1위는 ", "김민준입니다"]);
  expect(seen.updated!.content).toBe("1위는 김민준입니다");
});

test("POST /ask stream:true 선저장(insert) 실패 → SSE 아닌 기존 catch가 JSON 500 반환", async () => {
  // streamAsk 안의 선저장은 streamSSE 진입 전(RAG 계산과 같은 try 블록 안)이라, 실패 시
  // SSE 프로토콜이 아니라 기존 논스트리밍 catch와 동일한 JSON 500 에러 응답이어야 한다.
  assistantDeps.listRecentMessages = async () => [];
  assistantDeps.embedTexts = async (texts: string[]) => texts.map(() => Array.from({ length: EMBEDDING_DIM }, () => 0.01));
  assistantDeps.searchEmbeddings = async () => [{ id: "e1", sourceType: "memo", sourceId: "s1", customerId: "c1", content: "근거", similarity: 0.9 }];
  assistantDeps.getCustomerMetaByIds = async () => new Map([["c1", { name: "김민준", status: "상담중" }]]);
  assistantDeps.insertAssistantMessages = async () => { throw new Error("insert boom"); };

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "q", stream: true }) });
  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).not.toContain("text/event-stream");
  expect((await res.json() as { error: string }).error).toBe("일시적으로 답변에 실패했습니다.");
});


// ── PR2: 자유 질문 도구 라우팅(RAG 우선·근거 0건 폴백) ─────────────────────────────

test("POST /ask 근거 0건 + 라우팅 성공 → 도구 실행(params 전달)·NO_HITS 아님", async () => {
  let toolCall: unknown = null; // 클로저 대입이라 좁힘 없이 unknown으로 두고 toEqual로 전체 비교
  assistantDeps.listRecentMessages = async () => [];
  assistantDeps.embedTexts = async (texts: string[]) => texts.map(() => Array.from({ length: EMBEDDING_DIM }, () => 0.01));
  assistantDeps.searchEmbeddings = async () => [];
  assistantDeps.routeAssistantTool = async () => ({ key: "search_customers", params: { source: "앱" } });
  assistantDeps.runAssistantTool = async (key, params) => {
    toolCall = { key, params };
    return { label: "고객 검색(상담경로 앱)", lines: ["제임스 — 상담경로 앱 견적요청"] };
  };
  assistantDeps.getCustomerMetaByIds = async () => new Map();
  assistantDeps.generateAnswer = async (_s: string, u: string) => (u.includes("제임스") ? "제임스입니다" : "근거 누락");
  assistantDeps.insertAssistantMessages = async (rows: unknown[]) => rows as never;

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "앱을 통해서 들어온 고객은 누구야" }) });
  expect(res.status).toBe(200);
  expect(toolCall).toEqual({ key: "search_customers", params: { source: "앱" } });
  expect((await res.json() as { messages: { content: string }[] }).messages[1].content).toBe("제임스입니다");
});

test("POST /ask 근거 0건 + 라우팅 null(도구 불필요) → 기존 NO_HITS 고정 답변", async () => {
  assistantDeps.listRecentMessages = async () => [];
  assistantDeps.embedTexts = async (texts: string[]) => texts.map(() => Array.from({ length: EMBEDDING_DIM }, () => 0.01));
  assistantDeps.searchEmbeddings = async () => [];
  assistantDeps.routeAssistantTool = async () => null;
  assistantDeps.runAssistantTool = async () => { throw new Error("라우팅 null이면 실행되면 안 됨"); };
  assistantDeps.insertAssistantMessages = async (rows: unknown[]) => rows as never;

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "잡담" }) });
  expect((await res.json() as { messages: { content: string }[] }).messages[1].content).toBe("관련 CRM 데이터를 찾지 못했습니다.");
});

test("POST /ask 근거 있으면 라우팅 미호출(RAG 우선 — 골든 구조 가드)", async () => {
  assistantDeps.listRecentMessages = async () => [];
  assistantDeps.embedTexts = async (texts: string[]) => texts.map(() => Array.from({ length: EMBEDDING_DIM }, () => 0.01));
  assistantDeps.searchEmbeddings = async () => [{ id: "e1", sourceType: "memo", sourceId: "s1", customerId: "c1", content: "근거", similarity: 0.9 }];
  assistantDeps.routeAssistantTool = async () => { throw new Error("근거가 있으면 라우팅되면 안 됨"); };
  assistantDeps.getCustomerMetaByIds = async () => new Map([["c1", { name: "김민준", status: "상담중" }]]);
  assistantDeps.generateAnswer = async () => "근거 기반 답변";
  assistantDeps.insertAssistantMessages = async (rows: unknown[]) => rows as never;

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "김민준 근황" }) });
  expect((await res.json() as { messages: { content: string }[] }).messages[1].content).toBe("근거 기반 답변");
});
