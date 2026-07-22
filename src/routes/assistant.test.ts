import { test, expect, afterEach } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { OUT_OF_SCOPE_ANSWER } from "../lib/assistant-prompt";
import { EMBEDDING_DIM } from "../lib/gemini-embed";
import { assistantDeps, DISPLAY_LIMIT, SIMILARITY_THRESHOLD, type AssistantDeps } from "./assistant";

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-key";

const realDeps = { ...assistantDeps };
afterEach(() => { Object.assign(assistantDeps, realDeps); });

// RAG 경로 기본 스텁 일괄 장착(스트림/논스트림 공용) — 각 테스트는 필요한 dep만 overrides로 교체하고,
// 여분 스텁은 afterEach의 realDeps 리셋이 흡수한다.
// ⚠️ "호출되면 안 됨" 부정 가드는 기본값에 넣지 않는다 — 가드 의도가 본문에 보이도록 해당 테스트의 override로 유지.
type RagSeen = { inserted: unknown[][]; updated?: { id: string; content: string }; deletedId?: string };
function ragFakes(seen: RagSeen, overrides: Partial<AssistantDeps> = {}) {
  assistantDeps.listRecentMessages = async () => [];
  assistantDeps.getStaffName = async () => "테스트직원"; // 프롬프트 사용자 컨텍스트 — 실 profiles 조회 차단
  assistantDeps.embedTexts = async (texts: string[]) => texts.map(() => Array.from({ length: EMBEDDING_DIM }, () => 0.01));
  assistantDeps.searchEmbeddings = async () => [{ id: "e1", sourceType: "memo", sourceId: "s1", customerId: "c1", content: "근거", similarity: 1 }];
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
  Object.assign(assistantDeps, overrides);
}

// POST /api/assistant/ask 공통 요청 — token null = 무토큰(401 케이스), body에 stream:true면 SSE도 동일 경로.
function askJson(app: ReturnType<typeof createApp>, token: string | null, body: Record<string, unknown>) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return app.request("/api/assistant/ask", { method: "POST", headers, body: JSON.stringify(body) });
}

test("POST /ask 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, null, { question: "q" });
  expect(res.status).toBe(401);
});

test("POST /ask 빈 질문 → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "  " });
  expect(res.status).toBe(400);
});

test("POST /ask → 200: 멀티턴 history 전달 + user/assistant 2건 저장", async () => {
  const seen: { historyLen: number; saved: number } = { historyLen: -1, saved: -1 };
  ragFakes({ inserted: [] }, {
    listRecentMessages: async () => [
      { id: "m1", staffUserId: "s", role: "user", content: "이전질문", sources: null, createdAt: new Date(0) },
    ] as never,
    generateAnswer: async (_s: string, _u: string, _t: unknown, opts?: { history?: { role: string }[] }) => { seen.historyLen = opts?.history?.length ?? 0; return "답변"; },
    insertAssistantMessages: async (rows: unknown[]) => { seen.saved = rows.length; return rows as never; },
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "이번질문" });
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
  ragFakes({ inserted: [] }, {
    embedTexts: async () => { throw new Error("boom"); },
    insertAssistantMessages: async (rows: unknown[]) => { saved += rows.length; return rows as never; },
  });
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "q" });
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

test("POST /ask stream:true → 선저장 + text 이벤트 릴레이 + done에 영속본 2건", async () => {
  const seen: { inserted: unknown[][]; updated?: { id: string; content: string } } = { inserted: [] };
  ragFakes(seen, { generateAnswerStream: async function* () { yield "안녕"; yield "하세요"; } });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "q", stream: true });
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
  let sig: unknown = "unset";
  ragFakes({ inserted: [] }, {
    generateAnswerStream: async function* (
      _s: string, _u: string, _t: unknown, opts?: { signal?: AbortSignal },
    ) {
      sig = opts?.signal;
      yield "x";
    },
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "q", stream: true });
  await res.text();
  expect(sig).toBeInstanceOf(AbortSignal);
});

test("POST /ask stream:true 스트림 중간 실패(부분 있음) → 부분+ERROR_SUFFIX 저장 + done", async () => {
  const seen: { inserted: unknown[][]; updated?: { id: string; content: string } } = { inserted: [] };
  ragFakes(seen, { generateAnswerStream: async function* () { yield "부분"; throw new Error("boom"); } });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "q", stream: true });
  const events = parseSse(await res.text());
  expect(seen.updated!.content).toBe("부분 (연결 오류로 중단됨)");
  expect(events.some((e) => e.event === "done")).toBe(true);
  expect(events.some((e) => e.event === "error")).toBe(false);
});

test("POST /ask stream:true 0자 실패 → placeholder 삭제 + error 이벤트", async () => {
  const seen: { inserted: unknown[][]; deletedId?: string } = { inserted: [] };
  ragFakes(seen, {
    // eslint-disable-next-line require-yield -- 0자(즉시 실패) 시나리오 재현을 위해 의도적으로 yield 없이 throw
    generateAnswerStream: async function* () { throw new Error("boom"); },
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "q", stream: true });
  const events = parseSse(await res.text());
  expect(seen.deletedId).toBe("row-1");
  const error = events.find((e) => e.event === "error");
  expect((JSON.parse(error!.data) as { message: string }).message).toBe("일시적으로 답변에 실패했습니다.");
});

test("POST /ask stream:true hits 0건 → 고정 문구 text 1회 + done(저장 동일)", async () => {
  const seen: { inserted: unknown[][]; updated?: { id: string; content: string } } = { inserted: [] };
  ragFakes(seen, {
    searchEmbeddings: async () => [],
    routeAssistantTool: async () => null, // PR2: hits 0이면 라우팅이 시도됨 — 이 테스트는 라우팅 실패 폴백 경로
    // eslint-disable-next-line require-yield -- hits 0건이면 호출 자체가 없어야 함을 검증하는 가드(호출되면 즉시 throw)
    generateAnswerStream: async function* () { throw new Error("호출되면 안 됨"); },
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "q", stream: true });
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
  ragFakes({ inserted: [] }, {
    // 임계값 근처 값은 **상대값**으로 만든다 — 하드코딩하면 SIMILARITY_THRESHOLD를 조정하는 순간
    // "미달이어야 할 청크"가 통과로 뒤집혀 테스트 의도가 조용히 반대가 된다(2026-07-22 실제로 겪음).
    searchEmbeddings: async () => [
      mkHit("e1", 1), mkHit("e2", SIMILARITY_THRESHOLD),
      mkHit("e3", SIMILARITY_THRESHOLD - 0.001), mkHit("e4", SIMILARITY_THRESHOLD - 0.15),
    ],
    generateAnswer: async (_s: string, u: string) => { userPrompt = u; return "답변"; },
    insertAssistantMessages: async (rows: unknown[]) => {
      savedSources = (rows[1] as { sources: unknown[] }).sources;
      return rows as never;
    },
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "q" });
  expect(res.status).toBe(200);
  expect(userPrompt).toContain("근거-e1");
  expect(userPrompt).toContain("근거-e2"); // 경계값(== 임계값)은 유지 — ≥ 비교
  expect(userPrompt).not.toContain("근거-e3");
  expect(userPrompt).not.toContain("근거-e4");
  expect(savedSources).toHaveLength(2);
});

test("POST /ask 전부 임계값 미달 → 기존 hits 0건 경로(Gemini 미호출·고정 답변·sources 빈 배열)", async () => {
  let savedSources: unknown[] | null = null;
  ragFakes({ inserted: [] }, {
    routeAssistantTool: async () => null, // 라우팅 실패 폴백(범위 밖 판단 아님 — NO_HITS 유지)
    searchEmbeddings: async () => [mkHit("e1", SIMILARITY_THRESHOLD - 0.01), mkHit("e2", SIMILARITY_THRESHOLD - 0.15)], // 둘 다 미달(상대값 — 임계값 조정에 무관)
    getCustomerMetaByIds: async () => new Map(),
    generateAnswer: async () => { throw new Error("호출되면 안 됨"); },
    insertAssistantMessages: async (rows: unknown[]) => {
      savedSources = (rows[1] as { sources: unknown[] }).sources;
      return rows as never;
    },
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "q" });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { messages: { content: string }[] };
  expect(json.messages[1].content).toBe("관련 CRM 데이터를 찾지 못했습니다.");
  expect(savedSources).toHaveLength(0);
});

test("POST /ask stream:true 전부 임계값 미달 → hits 0건과 동일(고정 문구 text 1회)", async () => {
  const seen: { inserted: unknown[][]; updated?: { id: string; content: string } } = { inserted: [] };
  ragFakes(seen, {
    searchEmbeddings: async () => [mkHit("e1", SIMILARITY_THRESHOLD - 0.05)], // 미달(상대값 — 임계값 조정에 무관)
    routeAssistantTool: async () => null,
    // eslint-disable-next-line require-yield -- 전부 미달이면 호출 자체가 없어야 함을 검증하는 가드(호출되면 즉시 throw)
    generateAnswerStream: async function* () { throw new Error("호출되면 안 됨"); },
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "q", stream: true });
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
  let systemPrompt = "";
  ragFakes({ inserted: [] }, {
    embedTexts: async () => { throw new Error("도구 경로에서 임베딩이 호출되면 안 됨"); },
    runAssistantTool: async (key) => {
      calledKey = key;
      return { label: "오늘 처리할 일", lines: ["김민준 — GLC 재고 확인 (기한 오늘)", "박서연 — 월납입표 확인 (기한 급함)"] };
    },
    getCustomerMetaByIds: async () => new Map(),
    generateAnswer: async (sp: string, u: string) => { systemPrompt = sp; userPrompt = u; return "정리했습니다"; },
    insertAssistantMessages: async (rows: unknown[]) => {
      savedSources = (rows[1] as { sources: unknown[] }).sources;
      return rows as never;
    },
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "오늘 내가 먼저 처리할 일 정리해줘", tool: "today_actions" });
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
  ragFakes({ inserted: [] }, {
    embedTexts: async () => { throw new Error("호출되면 안 됨"); },
    runAssistantTool: async () => ({ label: "출고/정산 리스크", lines: [] }),
    getCustomerMetaByIds: async () => new Map(),
    generateAnswer: async (_s: string, u: string) => { userPrompt = u; return "해당 고객이 없습니다"; },
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "출고/정산 리스크 찾아줘", tool: "delivery_risk" });
  expect(res.status).toBe(200);
  expect(userPrompt).toContain("조회 결과 없음");
  expect((await res.json() as { messages: { content: string }[] }).messages[1].content).toBe("해당 고객이 없습니다"); // 고정 NO_HITS 문구가 아님
});

test("POST /ask 알 수 없는 tool 값 → 400(zod 어휘 게이트)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "q", tool: "drop_table" });
  expect(res.status).toBe(400);
});

test("POST /ask stream:true + tool → 도구 근거로 스트림 생성(고정 문구 아님)", async () => {
  const seen: { inserted: unknown[][]; updated?: { id: string; content: string } } = { inserted: [] };
  ragFakes(seen, {
    embedTexts: async () => { throw new Error("도구 경로에서 임베딩이 호출되면 안 됨"); },
    runAssistantTool: async () => ({ label: "계약 가능성 순위", lines: ["1위 김민준 — 확정"] }),
    generateAnswerStream: async function* () { yield "1위는 "; yield "김민준입니다"; },
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "계약 가능성 높은 고객 순위 뽑아줘", stream: true, tool: "chance_ranking" });
  const events = parseSse(await res.text());
  const texts = events.filter((e) => e.event === "text").map((e) => (JSON.parse(e.data) as { chunk: string }).chunk);
  expect(texts).toEqual(["1위는 ", "김민준입니다"]);
  expect(seen.updated!.content).toBe("1위는 김민준입니다");
});

test("POST /ask stream:true 선저장(insert) 실패 → SSE 아닌 기존 catch가 JSON 500 반환", async () => {
  // streamAsk 안의 선저장은 streamSSE 진입 전(RAG 계산과 같은 try 블록 안)이라, 실패 시
  // SSE 프로토콜이 아니라 기존 논스트리밍 catch와 동일한 JSON 500 에러 응답이어야 한다.
  ragFakes({ inserted: [] }, {
    insertAssistantMessages: async () => { throw new Error("insert boom"); },
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "q", stream: true });
  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).not.toContain("text/event-stream");
  expect((await res.json() as { error: string }).error).toBe("일시적으로 답변에 실패했습니다.");
});


// ── PR2: 자유 질문 도구 라우팅(RAG 우선·근거 0건 폴백) ─────────────────────────────

// #192의 "라우팅 우선" 게이트 이후 근거가 있어도(hits>0) 라우터가 call을 내면 도구 결과를 쓴다.
// 그 경로에서 promptChunks·sources는 둘 다 tool 분기라 근거 고객 메타(metaById)를 쓰지 않는다 —
// 조회하면 결과를 버리는 원격 DB 왕복이다(버튼 경로는 hits=[]라 빈 배열 단축이 흡수한다).
test("POST /ask 라우팅 도구 경로: 근거가 있어도 getCustomerMetaByIds를 호출하지 않는다", async () => {
  let metaCalls = 0;
  ragFakes({ inserted: [] }, {
    // ragFakes 기본 searchEmbeddings가 근거 1건을 낸다 — hits>0 상태에서 라우팅되는 실경로 재현.
    routeAssistantTool: async () => ({ kind: "call" as const, key: "customer_quotes" as const, params: { name: "김지안" } }),
    runAssistantTool: async () => ({ label: "고객 견적(이름 김지안)", lines: ["김지안 · QT-2607-0005 · BMW 520i · 발송완료"] }),
    getCustomerMetaByIds: async () => { metaCalls += 1; return new Map(); },
    generateAnswer: async () => "김지안 고객의 견적은 2건입니다",
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "김지안 견적 몇 개야" });

  expect(res.status).toBe(200);
  expect(metaCalls).toBe(0);
});

test("POST /ask 근거 0건 + 라우팅 성공 → 도구 실행(params 전달)·NO_HITS 아님", async () => {
  let toolCall: unknown = null; // 클로저 대입이라 좁힘 없이 unknown으로 두고 toEqual로 전체 비교
  ragFakes({ inserted: [] }, {
    searchEmbeddings: async () => [],
    routeAssistantTool: async () => ({ kind: "call" as const, key: "search_customers" as const, params: { source: "앱" } }),
    runAssistantTool: async (key, params) => {
      toolCall = { key, params };
      return { label: "고객 검색(상담경로 앱)", lines: ["제임스 — 상담경로 앱 견적요청"] };
    },
    getCustomerMetaByIds: async () => new Map(),
    generateAnswer: async (_s: string, u: string) => (u.includes("제임스") ? "제임스입니다" : "근거 누락"),
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "앱을 통해서 들어온 고객은 누구야" });
  expect(res.status).toBe(200);
  expect(toolCall).toEqual({ key: "search_customers", params: { source: "앱" } });
  expect((await res.json() as { messages: { content: string }[] }).messages[1].content).toBe("제임스입니다");
});

test("POST /ask 근거 0건 + 라우팅 null(실패) → 기존 NO_HITS 고정 답변(범위 밖 단정 없음)", async () => {
  ragFakes({ inserted: [] }, {
    searchEmbeddings: async () => [],
    routeAssistantTool: async () => null,
    runAssistantTool: async () => { throw new Error("라우팅 null이면 실행되면 안 됨"); },
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "잡담" });
  expect((await res.json() as { messages: { content: string }[] }).messages[1].content).toBe("관련 CRM 데이터를 찾지 못했습니다.");
});

// 범위 밖 안내(2026-07-07): 라우터가 "해당 없음"(도구 불필요)으로 명시 판단한 질문은 NO_HITS(고장처럼
// 읽힘)가 아니라 어시스턴트 범위 안내 문구로 답한다 — 실패(null)와의 분기 자체가 계약(위 테스트와 짝).
test("POST /ask 근거 0건 + 라우팅 none(범위 밖 판단) → 안내 문구(OUT_OF_SCOPE_ANSWER)", async () => {
  ragFakes({ inserted: [] }, {
    searchEmbeddings: async () => [],
    routeAssistantTool: async () => ({ kind: "none" as const }),
    runAssistantTool: async () => { throw new Error("none이면 실행되면 안 됨"); },
    generateAnswer: async () => { throw new Error("고정 문구 경로 — 생성 호출되면 안 됨"); },
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "오늘 날씨?" });
  expect((await res.json() as { messages: { content: string }[] }).messages[1].content).toBe(OUT_OF_SCOPE_ANSWER);
});

test("POST /ask stream:true + 라우팅 none → 안내 문구 text 1회(저장 동일)", async () => {
  const seen: { inserted: unknown[][]; updated?: { id: string; content: string } } = { inserted: [] };
  ragFakes(seen, {
    searchEmbeddings: async () => [],
    routeAssistantTool: async () => ({ kind: "none" as const }),
    // eslint-disable-next-line require-yield -- 고정 문구 경로면 호출 자체가 없어야 함을 검증하는 가드(호출되면 즉시 throw)
    generateAnswerStream: async function* () { throw new Error("호출되면 안 됨"); },
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "오늘 날씨?", stream: true });
  const events = parseSse(await res.text());
  const texts = events.filter((e) => e.event === "text");
  expect(texts).toHaveLength(1);
  expect((JSON.parse(texts[0].data) as { chunk: string }).chunk).toBe(OUT_OF_SCOPE_ANSWER);
  expect(seen.updated!.content).toBe(OUT_OF_SCOPE_ANSWER);
});

// 라우팅 우선(2026-07-07): 근거가 잡혀도 라우터가 먼저 판단한다. 서술형은 none → RAG, 집계/목록은
// call → 도구(RAG top-k로는 개수를 못 세 환각하던 견적 질문 해소). 두 골든이 양방향을 잠근다.
// ⚠️ 이 둘이 잠그는 것은 **라우터 판정 → 경로 선택 배선**뿐이다(routeAssistantTool은 페이크 주입).
// "서술형이면 라우터가 none을 낸다"는 모델 행위는 여기서 검증되지 않으며, 실제로 서술형이 call로
// 나가는 것이 실측됐다(배치 14 K2-d). 모델 쪽 1차 억제는 assistant-tools.ts의 description 하드닝이고,
// 그 문자열은 assistant-tools.test.ts가 잠근다.
test("POST /ask 근거 있는 서술형은 라우터 none → RAG 경로(배선 한정 골든)", async () => {
  ragFakes({ inserted: [] }, {
    routeAssistantTool: async () => ({ kind: "none" }),
    runAssistantTool: async () => { throw new Error("none이면 도구 실행 금지"); },
    generateAnswer: async () => "근거 기반 답변",
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "김민준 근황" });
  expect((await res.json() as { messages: { content: string }[] }).messages[1].content).toBe("근거 기반 답변");
});

test("POST /ask 근거 있어도 라우터 call이면 도구로 답한다(집계 정확 — 견적 환각 해소)", async () => {
  const seenTool = { called: false };
  ragFakes({ inserted: [] }, {
    routeAssistantTool: async () => ({ kind: "call", key: "customer_quotes", params: { name: "김지안" } }),
    runAssistantTool: async () => { seenTool.called = true; return { label: "고객 견적 목록(이름 김지안)", lines: ["김지안 · QT-1 · 기아 쏘렌토 · 작성중"] }; },
    generateAnswer: async (_s: string, u: string) => (u.includes("쏘렌토") ? "견적 1개(쏘렌토)" : "RAG로 샘"),
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "김지안 견적 몇 개야?" });
  expect(seenTool.called).toBe(true); // hits(RAG)가 아니라 도구가 실행됨
  expect((await res.json() as { messages: { content: string }[] }).messages[1].content).toBe("견적 1개(쏘렌토)");
});

// 오라구팅 구제(2026-07-22 실기 발견): 라우터가 도구를 골랐는데 **0건**이고 RAG 근거는 있으면,
// 도구 선택이 틀렸을 확률이 높다(실측 2건 — "박서연이 원하는 조건" → customer_consultations 0건인데
// 프로필 청크는 코퍼스에 있었고, 화면엔 "정보가 없습니다"가 떴다). 라우팅 우선 게이트가 그 근거를
// 통째로 버리던 것을 되돌린다. 도구가 1건이라도 냈으면 기존 계약(도구 우선) 그대로다.
test("POST /ask 라우팅 도구가 0건 + 근거 있음 → RAG 폴백(오라우팅 구제)", async () => {
  ragFakes({ inserted: [] }, {
    routeAssistantTool: async () => ({ kind: "call", key: "customer_consultations", params: { name: "박서연" } }),
    runAssistantTool: async () => ({ label: "고객 상담신청 목록(이름 박서연)", lines: [] }), // 0건
    generateAnswer: async (_s: string, u: string) => (u.includes("근거") ? "RAG 근거 기반 답변" : "도구 0건으로 답함"),
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "박서연 고객이 원하는 조건이 뭐야?" });
  const saved = (await res.json() as { messages: { content: string; sources?: { sourceType: string }[] }[] }).messages[1];
  expect(saved.content).toBe("RAG 근거 기반 답변");
  expect(saved.sources?.[0]?.sourceType).toBe("memo"); // 근거 표시도 도구("tool")가 아니라 RAG 청크
});

// 반대 방향 가드 — 근거도 0건이면 폴백할 곳이 없다. 도구 경로를 유지해 "조회 결과 없음"을 모델이
// 정리하게 한다(NO_HITS 고정 답변으로 새면 리포트 질문에 "데이터를 못 찾았다"는 오답이 된다).
// 질문 라벨은 **실 코퍼스에서 실제로 hits=0이 나는 조합**으로 골랐다(배치 14 K2-b — 구 라벨
// `"박서연 상담신청 뭐 했어?"`는 실측 hits>0이라 이 전제를 재현하지 못했다). 집계형 어투("몇 개야?")는
// 산문 청크와 유사도가 낮아 임계값을 못 넘는다 — `"박서연 견적 몇 개야?"` top1 실측 **0.586**.
test("POST /ask 라우팅 도구 0건 + 근거도 0건 → 도구 경로 유지(조회 결과 없음)", async () => {
  ragFakes({ inserted: [] }, {
    searchEmbeddings: async () => [],
    routeAssistantTool: async () => ({ kind: "call", key: "customer_quotes", params: { name: "박서연" } }),
    runAssistantTool: async () => ({ label: "고객 견적 목록(이름 박서연)", lines: [] }),
    generateAnswer: async (_s: string, u: string) => (u.includes("조회 결과 없음") ? "견적 내역이 없습니다" : "엉뚱한 경로"),
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "박서연 견적 몇 개야?" });
  const saved = (await res.json() as { messages: { content: string; sources?: { sourceType: string }[] }[] }).messages[1];
  expect(saved.content).toBe("견적 내역이 없습니다");
  expect(saved.sources?.[0]?.sourceType).toBe("tool");
});

// `none` 부류 확장의 회귀 그물(배치 14 K2-c) — `#315`가 라우터 프롬프트에 "지원 필터로 표현할 수 없는
// 조건이면 호출하지 말 것"을 넣으면서, **정당한 CRM 질문**(관심 차종 검색)이 none으로 오게 됐다.
// 그런 질문은 근거가 받쳐줄 때만 제대로 답이 나가고, 근거가 임계값 아래로 떨어지면 "범위 밖" 안내가
// 대신 나간다("마이바흐 관심 고객" top1 실측 0.6146 — 임계값이 0.62를 넘으면 전락, 0.65 변이로 재현).
// 이 테스트는 **근거가 남아 있는 한 안내 문구로 새지 않는다**를 잠근다.
test("POST /ask 지원 필터 밖 CRM 질문(none) + 근거 있음 → RAG로 답한다(범위 밖 안내로 새지 않음)", async () => {
  ragFakes({ inserted: [] }, {
    // 임계값 근처의 실측값 — 상대값으로 둬야 SIMILARITY_THRESHOLD 조정 시 의도가 조용히 뒤집히지 않는다.
    searchEmbeddings: async () => [
      { id: "e1", sourceType: "customer_profile", sourceId: "s1", customerId: "c1", content: "관심 차종 Maybach S-Class", similarity: SIMILARITY_THRESHOLD + 0.0146 },
    ],
    routeAssistantTool: async () => ({ kind: "none" }),
    runAssistantTool: async () => { throw new Error("none이면 도구 실행 금지"); },
    generateAnswer: async (_s: string, u: string) => (u.includes("Maybach") ? "김민준 고객입니다" : "근거 없이 생성됨"),
  });

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "마이바흐 관심 고객이 누구야?" });
  const saved = (await res.json() as { messages: { content: string }[] }).messages[1];
  expect(saved.content).toBe("김민준 고객입니다");
  expect(saved.content).not.toBe(OUT_OF_SCOPE_ANSWER); // 정당한 CRM 질문이 "범위 밖"으로 전락하면 RED
});

// 위 테스트는 스텁 유사도가 **상대값**이라 임계값을 올려도 항상 통과한다(배선만 잠근다). 실 데이터가
// 그 임계값 위에 남아 있는지는 별개 문제이므로, 실측 앵커로 따로 잠근다 — `#315`가 되살린 마이바흐
// 케이스의 여유는 **0.0146뿐**이라 임계값을 조금만 올려도 죽는다(0.65 변이로 OUT_OF_SCOPE 재현 확인).
// 임계값을 올리려는 사람이 이 단언에서 먼저 멈추는 것이 목적이다.
// ⚠️ 임베딩 모델을 바꾸면 이 값은 무의미해진다(공간이 달라진다) — 그때는 재실측해 갱신할 것.
test("실측 앵커: 지원 필터 밖 CRM 질문의 근거가 임계값 위에 있다(마진 0.0146)", () => {
  const MAYBACH_TOP1_OBSERVED = 0.6146; // 2026-07-22 실 코퍼스(161청크) 실측 — "마이바흐 관심 고객이 누구야?"
  expect(MAYBACH_TOP1_OBSERVED).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
});

// 사용자 컨텍스트(2026-07-07): 시스템 프롬프트에 현재 사용자(이름·역할)를 주입 — "내/제 담당" 1인칭 해석 기준.
test("POST /ask 시스템 프롬프트에 현재 사용자 컨텍스트(이름·역할) 주입", async () => {
  let sys = "";
  ragFakes({ inserted: [] }, {
    generateAnswer: async (systemPrompt: string) => { sys = systemPrompt; return "답변"; },
  });
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  await askJson(app, token, { question: "김민준 근황" });
  expect(sys).toContain("현재 로그인 사용자는 테스트직원(최고관리자)입니다"); // 라벨 = 클라 UI(data/roles.ts) 어휘
});

// 역할 scope(이사님 요구 07-06): staff 토큰이면 검색·도구 모두 {advisorId: 본인 sub}로 좁혀진다.
test("POST /ask staff 토큰 → searchEmbeddings·runAssistantTool에 {advisorId} scope + user 전달", async () => {
  const STAFF_SUB = crypto.randomUUID();
  let searchScope: unknown = null;
  let toolScope: unknown = null;
  let toolUser: unknown = null;
  ragFakes({ inserted: [] }, {
    searchEmbeddings: async (_v, scope) => { searchScope = scope; return []; },
    routeAssistantTool: async () => ({ kind: "call" as const, key: "search_customers" as const, params: {} }),
    runAssistantTool: async (_k, _p, scope, user) => { toolScope = scope; toolUser = user; return { label: "조건 검색", lines: [] }; },
    getCustomerMetaByIds: async () => new Map(),
    generateAnswer: async () => "답변",
  });

  const { token, keyResolver, issuer } = await makeTestAuth("staff", STAFF_SUB);
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "내 고객 근황" });
  expect(res.status).toBe(200);
  expect(searchScope).toEqual({ advisorId: STAFF_SUB });
  expect(toolScope).toEqual({ advisorId: STAFF_SUB }); // 근거 0건 → 라우팅 도구도 같은 scope
  expect(toolUser).toMatchObject({ id: STAFF_SUB, role: "staff" }); // mine/current_user의 "나" 식별자

  // admin은 전체("all") — 기존 동작 불변 가드.
  const admin = await makeTestAuth("admin");
  const adminApp = createApp({ keyResolver: admin.keyResolver, issuer: admin.issuer });
  await askJson(adminApp, admin.token, { question: "전체 근황" });
  expect(searchScope).toBe("all");
});

// ── 라우터 결합 골든(PR H 선행) ────────────────────────────────────────────
// `/ask`의 자유 질문 경로는 history·retrieval·staffName을 병렬로 모은 뒤 라우터를 순차 호출한다.
// 라우터를 그 병렬 슬롯으로 옮겨도 **결합 결과는 같아야 한다**. 기존 테스트는 최종값만 보고
// 호출 순서·부정 가드를 잠그지 않아, 아래 4개가 리팩토링의 안전망이다.

test("골든: tool(빠른 질문 버튼) 지정 시 라우터를 아예 호출하지 않는다", async () => {
  let routeCalls = 0;
  ragFakes({ inserted: [] }, {
    embedTexts: async () => { throw new Error("도구 경로에서 임베딩이 호출되면 안 됨"); },
    routeAssistantTool: async () => { routeCalls += 1; return null; },
    runAssistantTool: async () => ({ label: "오늘 처리할 일", lines: ["김민준 — GLC 재고 확인"] }),
    generateAnswer: async () => "정리했습니다",
  });
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "오늘 할 일", tool: "today_actions" });
  expect(res.status).toBe(200);
  expect(routeCalls).toBe(0); // 버튼이 의도를 확정했으므로 라우팅 Gemini 왕복이 없어야 한다
});

test("골든: 라우터는 멀티턴 history를 받는다(대명사 후속 질의 판단 근거)", async () => {
  let seenHistory: unknown = null;
  assistantDeps.listRecentMessages = async () => [
    { id: "m1", staffUserId: "s", role: "user", content: "이전질문", sources: null, createdAt: new Date(1) },
    { id: "m2", staffUserId: "s", role: "assistant", content: "이전답변", sources: null, createdAt: new Date(2) },
  ] as never;
  ragFakes({ inserted: [] }, {
    listRecentMessages: assistantDeps.listRecentMessages,
    searchEmbeddings: async () => [],
    routeAssistantTool: async (_q: string, _t: unknown, opts?: { history?: unknown }) => { seenHistory = opts?.history; return null; },
  });
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  await askJson(app, token, { question: "그건 얼마야" });
  // 병렬화해도 라우터가 빈 history를 보면 안 된다 — history 로드 완료 후 호출되어야 한다.
  expect(seenHistory).toEqual([
    { role: "user", content: "이전질문" },
    { role: "assistant", content: "이전답변" },
  ]);
});

test("골든: 라우터 call → runAssistantTool은 라우터가 resolve된 뒤에 실행된다", async () => {
  const order: string[] = [];
  ragFakes({ inserted: [] }, {
    searchEmbeddings: async () => [],
    routeAssistantTool: async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("route");
      return { kind: "call" as const, key: "customer_quotes" as const, params: { name: "김지안" } };
    },
    runAssistantTool: async () => { order.push("run"); return { label: "고객 견적", lines: ["QT-0005"] }; },
    generateAnswer: async () => "2건입니다",
  });
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "김지안 견적 몇 개야" });
  expect(res.status).toBe(200);
  expect(order).toEqual(["route", "run"]); // 도구 실행은 라우터 결과 의존 — 병렬 슬롯에 들어가면 안 된다
});

test("골든: 임베딩 실패는 500 — 라우터가 call을 내도 도구를 실행하지 않는다", async () => {
  let runCalls = 0;
  ragFakes({ inserted: [] }, {
    embedTexts: async () => { throw new Error("boom"); },
    routeAssistantTool: async () => ({ kind: "call" as const, key: "customer_quotes" as const, params: {} }),
    runAssistantTool: async () => { runCalls += 1; return { label: "x", lines: [] }; },
  });
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await askJson(app, token, { question: "q" });
  expect(res.status).toBe(500);
  expect(runCalls).toBe(0); // 검색 실패 요청이 도구 결과로 살아나면 안 된다
});

// 이 PR의 유일한 행위 주장 — 라우터가 임베딩→검색 완료를 기다리지 않는다.
// (왕복 수·비용은 그대로다. 겹치는 건 벽시계뿐.)
test("라우터는 임베딩→검색 완료 전에 시작한다(지연 겹침)", async () => {
  const events: string[] = [];
  ragFakes({ inserted: [] }, {
    embedTexts: async (texts: string[]) => {
      events.push("embed:start");
      await new Promise((r) => setTimeout(r, 30));
      events.push("embed:end");
      return texts.map(() => Array.from({ length: EMBEDDING_DIM }, () => 0.01));
    },
    searchEmbeddings: async () => { events.push("search:end"); return []; },
    routeAssistantTool: async () => { events.push("route:start"); return null; },
  });
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  await askJson(app, token, { question: "자유 질문" });

  expect(events).toContain("route:start");
  // 직렬이면 route:start가 search:end 뒤에 온다. 병렬이면 embed가 끝나기도 전에 시작한다.
  expect(events.indexOf("route:start")).toBeLessThan(events.indexOf("embed:end"));
});
