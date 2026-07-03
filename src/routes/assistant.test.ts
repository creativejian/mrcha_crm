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
  assistantDeps.generateAnswer = async (_s: string, _u: string, _t: unknown, history: { role: string }[] = []) => { seen.historyLen = history.length; return "답변"; };
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
    _s: string, _u: string, _t: unknown, _h: unknown, _f: unknown, signal?: AbortSignal,
  ) {
    sig = signal;
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
