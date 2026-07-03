# 업무 AI SSE 스트리밍 + 새 턴 앵커 스크롤 (앱 미러) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 업무 AI `/ask`를 SSE 스트리밍으로 전환하고 앱의 타자기 페이싱(38ms 가변 스텝)·송신/중지 토글·질문 상단 고정(새 턴 앵커) UX를 이식한다.

**Architecture:** 백엔드는 `stream: true` 분기에서 user+빈 placeholder 선저장 → Gemini `streamGenerateContent?alt=sse` 청크를 SSE `text` 이벤트로 릴레이 → 종료(완료/중단/에러) 시 placeholder 마감(`finalizeStreamedAnswer`) → `done`에 영속본 2건. 프론트는 fetch ReadableStream + 증분 SSE 파서 + 드레인 타자기(`nextDisplayLength`), 중지는 AbortController + 재조회 동기화, 스크롤은 min-height 예약 + 앵커 스크롤.

**Tech Stack:** Hono `streamSSE`(hono/streaming), Gemini REST alt=sse, React 훅. 백엔드 테스트 `bun:test`(`bun run test:server`), 프론트 `vitest`(`bun run test:unit`).

**Spec:** `ref/specs/2026-07-03-crm-work-ai-sse-streaming-design.md` (승인됨 — 코드와 충돌 시 spec의 결정 섹션이 우선)

## 진행 상태 (2026-07-03 오전 중단 시점 — subagent-driven 실행 중)

- ✅ **Task 1~4 완료 + 2단계 리뷰(spec/quality) 승인**: 백엔드 전체. 리뷰 반영분 포함 —
  - Task 1(`e3d5bb5`): reader.cancel(중지 시 업스트림 취소)·잔여 라인 flush·buildGenerateBody 헬퍼·회귀 테스트 4건 추가
  - Task 2(`1c6d141`): **update/delete에 staffUserId 이중 키**(owned-resource 관례) + 실 DB 테스트 — 아래 코드 블록은 이 시그니처로 이미 현행화됨
  - Task 3(`3dee460`): aborted 우선 문서화·0자 정상완료 테스트
  - Task 4(`0e8ef4c`): **waitUntil guard 선등록**(중지 직후 CF 회수 창에서 마감 저장 보장) + `return await streamAsk`(선저장 실패→기존 catch 500, 회귀 테스트) + abort 경로는 스모크 전담 주석
- ✅ **Task 5~7 구현 완료·커밋됨**(`330a159`/`6d58a6c`/`cadad79`), **리뷰(spec/quality) 미실시** — 재개 시 여기부터: 5~7 배치 리뷰 → Task 8.
  - Task 6 편차(정당·검증됨): 서로게이트 테스트 `nextDisplayLength(odd, 1)` 기대값은 4가 아니라 **3**(경계 3은 페어 사이라 이미 안전 — 아래 스니펫 정정됨)
- ⏳ Task 8(askAssistantStream)·9(useAssistantThread)·10(패널)·11(검증+PR)·12(브라우저 스모크) 미착수.
- 전 커밋 시점 검증 green: test:server 176·test:unit 344·typecheck 0·lint 0.

**브랜치:** 이미 `feat/crm-work-ai-sse-streaming` 체크아웃됨(spec 커밋 `6da0e4f` 존재). push는 Task 11에서. 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. skip-ci 마커 토큰 금지(글자로도 쓰지 말 것).

**선행 상태(C1~#139 머지됨):** `src/routes/assistant.ts` = `POST /ask`(RAG+멀티턴+성공 시 원자 저장, `assistantDeps` 주입) + `GET /messages`(커서). `src/lib/gemini-generate.ts` = `generateAnswer(systemPrompt, userPrompt, apiKey, history, fetchImpl)`. 프론트 = `useAssistantThread`(entries=messages+pendings, `prependAnchorRef`) + `AiAssistantPanel`(항상 최하단 스크롤) + `askAssistant`/`fetchAssistantMessages`.

---

## File Structure

- Modify `src/lib/gemini-generate.ts` — `generateAnswerStream`(async generator) 추가.
- Create `src/lib/assistant-stream.ts` — `finalizeStreamedAnswer`(종료 마감 순수 로직) + suffix 상수.
- Modify `src/db/queries/assistant-messages.ts` — `updateAssistantMessage`, `deleteAssistantMessage`.
- Modify `src/routes/assistant.ts` — `askSchema`에 `stream`, 스트림 분기(`streamAsk`), `assistantDeps` 3개 추가.
- Create `client/src/lib/assistant-sse.ts` — SSE 증분 파서(순수).
- Create `client/src/lib/assistant-drain.ts` — 드레인 수치/`nextDisplayLength`(앱 미러, 순수).
- Create `client/src/lib/assistant-layout.ts` — `computeTurnMinHeight` + 여백 상수(순수).
- Modify `client/src/lib/assistant.ts` — `askAssistantStream`.
- Modify `client/src/components/ai/useAssistantThread.ts` — streamText 드레인·`stop`·`newTurnAnchorRef`.
- Modify `client/src/components/ai/AiAssistantPanel.tsx` — 스트리밍 렌더·Send↔Stop 토글·새 턴 앵커 스크롤.
- CSS 변경 없음(아이콘 토글 + inline min-height만 — `client/src/styles/` `@import` 순서 불변).

---

### Task 1: 백엔드 `generateAnswerStream` (Gemini SSE 릴레이)

**Files:**
- Modify: `src/lib/gemini-generate.ts`
- Test: `src/lib/gemini-generate.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/gemini-generate.test.ts` 끝에 추가:

```ts
function sseBody(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const l of lines) controller.enqueue(enc.encode(l));
      controller.close();
    },
  });
}

test("generateAnswerStream: alt=sse 라인에서 텍스트 청크를 순서대로 yield", async () => {
  const chunk = (t: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`;
  let url = "";
  const fakeFetch = (async (u: string | URL | Request) => {
    url = String(u);
    return new Response(sseBody([chunk("안녕"), chunk("하세요")]), { status: 200 });
  }) as unknown as typeof fetch;

  const out: string[] = [];
  for await (const c of generateAnswerStream("SYS", "USER", "KEY", [], fakeFetch)) out.push(c);

  expect(out).toEqual(["안녕", "하세요"]);
  expect(url).toContain(`${GEN_MODEL}:streamGenerateContent?alt=sse`);
});

test("generateAnswerStream: 청크 경계가 라인 중간에서 갈라져도 파싱", async () => {
  const line = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "분할청크" }] } }] })}\n\n`;
  const fakeFetch = (async () =>
    new Response(sseBody([line.slice(0, 20), line.slice(20)]), { status: 200 })) as unknown as typeof fetch;

  const out: string[] = [];
  for await (const c of generateAnswerStream("s", "u", "K", [], fakeFetch)) out.push(c);
  expect(out).toEqual(["분할청크"]);
});

test("generateAnswerStream: HTTP 실패는 throw(스트림 시작 전)", async () => {
  const fakeFetch = (async () => new Response("nope", { status: 400 })) as unknown as typeof fetch;
  const gen = generateAnswerStream("s", "u", "K", [], fakeFetch);
  await expect(gen.next()).rejects.toThrow("Gemini 생성 실패");
});

test("generateAnswerStream: rate_limited는 1회 재시도 후 성공", async () => {
  let calls = 0;
  const ok = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "재시도성공" }] } }] })}\n\n`;
  const fakeFetch = (async () => {
    calls++;
    if (calls === 1) return new Response("quota", { status: 429 });
    return new Response(sseBody([ok]), { status: 200 });
  }) as unknown as typeof fetch;

  const out: string[] = [];
  for await (const c of generateAnswerStream("s", "u", "K", [], fakeFetch)) out.push(c);
  expect(out).toEqual(["재시도성공"]);
  expect(calls).toBe(2);
});
```

import 줄도 갱신: `import { generateAnswer, generateAnswerStream, GEN_MODEL } from "./gemini-generate";`

- [ ] **Step 2: 실패 확인**

Run: `bun test src/lib/gemini-generate.test.ts`
Expected: FAIL — `generateAnswerStream` export 없음.

- [ ] **Step 3: 구현** — `src/lib/gemini-generate.ts` 끝에 추가:

```ts
// 스트리밍 생성 — Gemini alt=sse의 `data: {json}` 라인에서 텍스트 파트만 순서대로 yield.
// HTTP 레벨 실패(스트림 시작 전)만 rate_limited/unavailable 1회 재시도. 스트림 중간 실패는 그대로 throw(호출부가 부분 저장 처리).
export async function* generateAnswerStream(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  history: ChatTurn[] = [],
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEN_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const contents = [
    ...history.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
    { role: "user", parts: [{ text: userPrompt }] },
  ];
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.2 },
  });

  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok) break;
    const bodyText = await res.text();
    const code = classifyGeminiError(res.status, bodyText);
    console.error(`[assistant] Gemini stream ${code} status=${res.status}`);
    if (attempt === 0 && (code === "rate_limited" || code === "unavailable")) { res = null; continue; }
    throw new Error(`Gemini 생성 실패: ${code}`);
  }
  if (!res?.ok || !res.body) throw new Error("Gemini 생성 실패");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trimEnd();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        const data = JSON.parse(payload) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text === "string" && text.length > 0) yield text;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test src/lib/gemini-generate.test.ts`
Expected: PASS (기존 테스트 포함 전부).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/gemini-generate.ts src/lib/gemini-generate.test.ts
git commit -m "feat(crm): Gemini streamGenerateContent SSE 릴레이 generateAnswerStream"
```

---

### Task 2: 쿼리 `updateAssistantMessage` / `deleteAssistantMessage`

**Files:**
- Modify: `src/db/queries/assistant-messages.ts`

(리뷰 반영으로 확정된 형태 — owned-resource 관례에 따라 **id+staffUserId 이중 키**, 실 DB 테스트 포함.)

- [ ] **Step 1: 구현** — `src/db/queries/assistant-messages.ts` 끝에 추가:

```ts
// 스트리밍 종료 시 placeholder 마감(내용·출처 확정). id+staffUserId 이중 키(타 staff 메시지 오염 방지 — owned-resource 관례). 대상 없으면 null.
export async function updateAssistantMessage(
  id: string,
  staffUserId: string,
  content: string,
  sources: unknown,
  executor: Executor = getDefaultDb(),
): Promise<AssistantMessageRow | null> {
  const [row] = await executor.update(assistantMessages).set({ content, sources })
    .where(and(eq(assistantMessages.id, id), eq(assistantMessages.staffUserId, staffUserId))).returning();
  return row ?? null;
}

// 0자 중단/실패 시 빈 placeholder 제거(유령 빈 메시지 방지). user 질문 행은 남긴다. 이중 키 동일.
export async function deleteAssistantMessage(id: string, staffUserId: string, executor: Executor = getDefaultDb()): Promise<void> {
  await executor.delete(assistantMessages).where(and(eq(assistantMessages.id, id), eq(assistantMessages.staffUserId, staffUserId)));
}
```

`src/db/queries/assistant-messages.test.ts`(실 master DB)에 삽입→갱신(타 staff는 null·미변경)→삭제 케이스 추가(기존 셋업/정리 패턴 준수).

- [ ] **Step 2: 타입 확인**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: 커밋**

```bash
git add src/db/queries/assistant-messages.ts
git commit -m "feat(crm): assistant_messages placeholder 마감용 update/delete 쿼리"
```

---

### Task 3: `finalizeStreamedAnswer` (종료 마감 로직)

**Files:**
- Create: `src/lib/assistant-stream.ts`
- Test: `src/lib/assistant-stream.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/assistant-stream.test.ts` 신규:

```ts
import { test, expect } from "bun:test";

import { finalizeStreamedAnswer, STOP_SUFFIX, ERROR_SUFFIX } from "./assistant-stream";
import type { AssistantMessageRow } from "../db/queries/assistant-messages";

function harness() {
  const calls: { updated?: { content: string; sources: unknown }; removed: boolean } = { removed: false };
  const update = async (content: string, sources: unknown): Promise<AssistantMessageRow | null> => {
    calls.updated = { content, sources };
    return { id: "a1", staffUserId: "s", role: "assistant", content, sources, createdAt: new Date(1) } as AssistantMessageRow;
  };
  const remove = async () => { calls.removed = true; };
  return { calls, update, remove };
}

test("정상 완료: 원문 그대로 + sources 저장, done", async () => {
  const h = harness();
  const out = await finalizeStreamedAnswer({ fullText: "답변", aborted: false, failed: false, sources: [{ s: 1 }], update: h.update, remove: h.remove });
  expect(out.kind).toBe("done");
  expect(h.calls.updated).toEqual({ content: "답변", sources: [{ s: 1 }] });
  expect(h.calls.removed).toBe(false);
});

test("중단(부분 있음): ' (중단됨)' suffix 저장", async () => {
  const h = harness();
  const out = await finalizeStreamedAnswer({ fullText: "부분", aborted: true, failed: false, sources: null, update: h.update, remove: h.remove });
  expect(out.kind).toBe("done");
  expect(h.calls.updated!.content).toBe(`부분${STOP_SUFFIX}`);
});

test("스트림 중간 실패(부분 있음): ' (연결 오류로 중단됨)' suffix 저장", async () => {
  const h = harness();
  const out = await finalizeStreamedAnswer({ fullText: "부분", aborted: false, failed: true, sources: null, update: h.update, remove: h.remove });
  expect(out.kind).toBe("done");
  expect(h.calls.updated!.content).toBe(`부분${ERROR_SUFFIX}`);
});

test("0자(중단/실패/빈 완료 공통): placeholder 삭제 + error", async () => {
  const h = harness();
  const out = await finalizeStreamedAnswer({ fullText: "", aborted: true, failed: false, sources: null, update: h.update, remove: h.remove });
  expect(out.kind).toBe("error");
  expect(h.calls.removed).toBe(true);
  expect(h.calls.updated).toBeUndefined();
});

test("update가 null(행 소실) 반환 시 error", async () => {
  const h = harness();
  const out = await finalizeStreamedAnswer({
    fullText: "답변", aborted: false, failed: false, sources: null,
    update: async () => null, remove: h.remove,
  });
  expect(out.kind).toBe("error");
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test src/lib/assistant-stream.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `src/lib/assistant-stream.ts` 신규:

```ts
import type { AssistantMessageRow } from "../db/queries/assistant-messages";

export const STOP_SUFFIX = " (중단됨)"; // 앱 미러
export const ERROR_SUFFIX = " (연결 오류로 중단됨)";

export type StreamOutcome = { kind: "done"; assistant: AssistantMessageRow } | { kind: "error" };

// 스트리밍 종료 상태에 따라 선저장된 placeholder를 마감한다.
// - 0자: 삭제 + error (빈 assistant 메시지를 히스토리에 남기지 않음 — 정상 done인데 0자여도 동일)
// - aborted: STOP_SUFFIX / failed: ERROR_SUFFIX / 정상: 원문 그대로. sources는 부분 저장에도 동일 근거라 항상 저장.
export async function finalizeStreamedAnswer(opts: {
  fullText: string;
  aborted: boolean;
  failed: boolean;
  sources: unknown;
  update: (content: string, sources: unknown) => Promise<AssistantMessageRow | null>;
  remove: () => Promise<void>;
}): Promise<StreamOutcome> {
  if (opts.fullText.length === 0) {
    await opts.remove();
    return { kind: "error" };
  }
  const suffix = opts.aborted ? STOP_SUFFIX : opts.failed ? ERROR_SUFFIX : "";
  const updated = await opts.update(opts.fullText + suffix, opts.sources);
  return updated ? { kind: "done", assistant: updated } : { kind: "error" };
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test src/lib/assistant-stream.test.ts`
Expected: PASS 5건.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/assistant-stream.ts src/lib/assistant-stream.test.ts
git commit -m "feat(crm): 스트리밍 종료 마감 finalizeStreamedAnswer (완료/중단/에러/0자)"
```

---

### Task 4: `/ask` 스트림 분기 (라우트)

**Files:**
- Modify: `src/routes/assistant.ts`
- Test: `src/routes/assistant.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/routes/assistant.test.ts` 끝에 추가:

```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:server -- src/routes/assistant.test.ts`
Expected: 신규 4건 FAIL(`generateAnswerStream`가 deps에 없음 / stream 분기 없음). 기존 테스트는 PASS 유지.

- [ ] **Step 3: 구현** — `src/routes/assistant.ts` 수정.

import 추가/변경:

```ts
import { streamSSE } from "hono/streaming";
import type { Context } from "hono";

import { getCustomerMetaByIds } from "../db/queries/embeddings-meta";
import { searchEmbeddings } from "../db/queries/embeddings";
import {
  deleteAssistantMessage, insertAssistantMessages, listRecentMessages, updateAssistantMessage,
  type AssistantMessageRow,
} from "../db/queries/assistant-messages";
import { embedTexts } from "../lib/gemini-embed";
import { generateAnswer, generateAnswerStream } from "../lib/gemini-generate";
import { finalizeStreamedAnswer } from "../lib/assistant-stream";
```

스키마·deps 확장:

```ts
const askSchema = z.object({ question: z.string(), stream: z.boolean().optional() });

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
  embedTexts, searchEmbeddings, generateAnswer, generateAnswerStream,
  getCustomerMetaByIds, listRecentMessages, insertAssistantMessages, updateAssistantMessage, deleteAssistantMessage,
};
```

`/ask` 핸들러 — RAG 앞단(scope→병렬 히스토리·검색→메타→promptChunks·sources)까지는 기존 코드 그대로 두고, `sources` 계산 직후에 분기 삽입:

```ts
    if (c.req.valid("json").stream === true) {
      return streamAsk(c, { question, staffUserId, apiKey, history, hits, promptChunks, sources });
    }
    // 이하 기존 논스트리밍 경로 그대로 (answer 생성 → insertAssistantMessages → c.json({ messages: saved }))
```

파일 하단에 스트림 핸들러 추가:

```ts
const NO_HITS_ANSWER = "관련 CRM 데이터를 찾지 못했습니다."; // 논스트리밍 경로의 기존 리터럴도 이 상수로 교체

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
      console.error("[assistant] stream 생성 실패:", e);
      failed = true;
    }

    const finalize = (async () => {
      const outcome = await finalizeStreamedAnswer({
        fullText, aborted, failed, sources: args.sources,
        update: (content, sources) => assistantDeps.updateAssistantMessage(placeholder.id, args.staffUserId, content, sources, c.var.db),
        remove: () => assistantDeps.deleteAssistantMessage(placeholder.id, args.staffUserId, c.var.db),
      });
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
```

주의: 선저장(insert)은 `streamSSE` 밖(기존 try 안)이라 실패 시 기존 catch가 JSON 500을 반환한다(클라 `askAssistantStream`의 `!res.ok` 처리와 맞물림).

- [ ] **Step 4: 통과 확인**

Run: `bun run test:server -- src/routes/assistant.test.ts`
Expected: 기존 + 신규 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/routes/assistant.ts src/routes/assistant.test.ts
git commit -m "feat(crm): /api/assistant/ask SSE 스트림 분기 — 선저장·text 릴레이·finalize 마감"
```

---

### Task 5: 프론트 SSE 증분 파서

**Files:**
- Create: `client/src/lib/assistant-sse.ts`
- Test: `client/src/lib/assistant-sse.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `client/src/lib/assistant-sse.test.ts` 신규:

```ts
import { describe, expect, it } from "vitest";

import { createSseParser } from "./assistant-sse";

describe("createSseParser", () => {
  it("완성된 이벤트(event+data)를 파싱한다", () => {
    const feed = createSseParser();
    expect(feed('event: text\ndata: {"chunk":"안녕"}\n\n')).toEqual([{ event: "text", data: '{"chunk":"안녕"}' }]);
  });

  it("청크 경계가 라인 중간이어도 이어붙여 파싱한다(증분)", () => {
    const feed = createSseParser();
    expect(feed("event: te")).toEqual([]);
    expect(feed('xt\ndata: {"chunk":"분')).toEqual([]);
    expect(feed('할"}\n\n')).toEqual([{ event: "text", data: '{"chunk":"분할"}' }]);
  });

  it("한 청크에 여러 이벤트가 있으면 순서대로 전부 반환한다", () => {
    const feed = createSseParser();
    const out = feed('event: text\ndata: {"chunk":"a"}\n\nevent: done\ndata: {"messages":[]}\n\n');
    expect(out.map((e) => e.event)).toEqual(["text", "done"]);
  });

  it("event 없는 이벤트는 message, CRLF 라인도 처리한다", () => {
    const feed = createSseParser();
    expect(feed("data: x\r\n\r\n")).toEqual([{ event: "message", data: "x" }]);
  });

  it("data 여러 줄은 \\n으로 합친다(SSE 규격)", () => {
    const feed = createSseParser();
    expect(feed("event: text\ndata: 줄1\ndata: 줄2\n\n")).toEqual([{ event: "text", data: "줄1\n줄2" }]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/assistant-sse.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `client/src/lib/assistant-sse.ts` 신규:

```ts
export type SseEvent = { event: string; data: string };

// SSE 증분 파서 — fetch ReadableStream 청크를 밀어 넣으면 그 시점까지 완성된 이벤트를 반환한다.
// 이벤트 경계 = 빈 줄, data 복수 라인은 \n으로 합침(SSE 규격), event 필드 없으면 "message".
export function createSseParser(): (chunk: string) => SseEvent[] {
  let buf = "";
  let event = "message";
  let dataLines: string[] = [];
  return (chunk: string): SseEvent[] => {
    buf += chunk;
    const out: SseEvent[] = [];
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line === "") {
        if (dataLines.length > 0) out.push({ event, data: dataLines.join("\n") });
        event = "message";
        dataLines = [];
      } else if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    return out;
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit client/src/lib/assistant-sse.test.ts`
Expected: PASS 5건.

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/assistant-sse.ts client/src/lib/assistant-sse.test.ts
git commit -m "feat(crm): SSE 증분 파서 — fetch 스트림 청크 경계 안전"
```

---

### Task 6: 드레인 페이싱 `nextDisplayLength` (앱 수치 미러)

**Files:**
- Create: `client/src/lib/assistant-drain.ts`
- Test: `client/src/lib/assistant-drain.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `client/src/lib/assistant-drain.test.ts` 신규:

```ts
import { describe, expect, it } from "vitest";

import { DRAIN_TICK_MS, nextDisplayLength } from "./assistant-drain";

describe("nextDisplayLength (앱 chat_streaming_controller 수치 미러)", () => {
  const target = "가".repeat(500);

  it("틱 주기는 38ms", () => {
    expect(DRAIN_TICK_MS).toBe(38);
  });

  it("도입부(<72자)는 2자/틱", () => {
    expect(nextDisplayLength(target, 0)).toBe(2);
    expect(nextDisplayLength(target, 70)).toBe(72);
  });

  it("72~159자는 4자/틱", () => {
    expect(nextDisplayLength(target, 72)).toBe(76);
    expect(nextDisplayLength(target, 159)).toBe(163);
  });

  it("잔여 >160자면 11자/틱, >56자면 7자/틱, 꼬리는 4자/틱", () => {
    expect(nextDisplayLength(target, 200)).toBe(211); // 잔여 300 > 160
    expect(nextDisplayLength("가".repeat(300), 200)).toBe(207); // 잔여 100 → 7
    expect(nextDisplayLength("가".repeat(230), 200)).toBe(204); // 잔여 30 → 4
  });

  it("타깃을 넘지 않는다 + 이미 완주면 그대로", () => {
    expect(nextDisplayLength("가나다", 2)).toBe(3);
    expect(nextDisplayLength("가나다", 3)).toBe(3);
    expect(nextDisplayLength("가나다", 10)).toBe(3);
  });

  it("UTF-16 서로게이트 페어 중간에서 자르지 않는다", () => {
    const emoji = "🚗".repeat(50); // 각 2 code unit — 홀수 경계가 생기면 페어를 함께 노출
    const next = nextDisplayLength(emoji, 0); // 도입부 step 2 → 2 (페어 1개)
    expect(next).toBe(2);
    const odd = "a" + "🚗".repeat(50); // 1 + 2n — 경계 3은 low(2)·high(3) 사이 = 페어 경계라 이미 안전
    const n2 = nextDisplayLength(odd, 1); // 확장하면 오히려 lone surrogate 노출 — 3 유지가 정답
    expect(n2).toBe(3);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/assistant-drain.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `client/src/lib/assistant-drain.ts` 신규:

```ts
// 앱 chat_streaming_controller.dart의 디스플레이 드레인 페이싱 미러 — 실사용 검증된 타자기 수치.
export const DRAIN_TICK_MS = 38;
const INTRO_STEP = 2; // 표시 <72자: 천천히 시작
const SLOW_STEP = 4; // 표시 <160자, 그리고 꼬리(잔여 ≤56자)
const MEDIUM_STEP = 7; // 잔여 >56자
const FAST_STEP = 11; // 잔여 >160자

const isHighSurrogate = (u: number) => u >= 0xd800 && u <= 0xdbff;
const isLowSurrogate = (u: number) => u >= 0xdc00 && u <= 0xdfff;

// 다음 틱에 표시할 길이. UTF-16 서로게이트 페어 중간에서 자르지 않는다(페어를 함께 노출).
export function nextDisplayLength(target: string, currentLength: number): number {
  if (currentLength >= target.length) return target.length;
  const remaining = target.length - currentLength;
  const step =
    currentLength < 72 ? INTRO_STEP
    : currentLength < 160 ? SLOW_STEP
    : remaining > 160 ? FAST_STEP
    : remaining > 56 ? MEDIUM_STEP
    : SLOW_STEP;
  let next = Math.min(currentLength + step, target.length);
  if (next < target.length && next > 0 && isHighSurrogate(target.charCodeAt(next - 1)) && isLowSurrogate(target.charCodeAt(next))) next += 1;
  return next;
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit client/src/lib/assistant-drain.test.ts`
Expected: PASS 6건.

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/assistant-drain.ts client/src/lib/assistant-drain.test.ts
git commit -m "feat(crm): 타자기 드레인 페이싱 nextDisplayLength — 앱 수치(38ms·2/4/7/11) 미러"
```

---

### Task 7: 새 턴 min-height 계산 `computeTurnMinHeight`

**Files:**
- Create: `client/src/lib/assistant-layout.ts`
- Test: `client/src/lib/assistant-layout.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `client/src/lib/assistant-layout.test.ts` 신규:

```ts
import { describe, expect, it } from "vitest";

import { NEW_TURN_TOP_GAP, NEW_TURN_BOTTOM_GAP, computeTurnMinHeight } from "./assistant-layout";

describe("computeTurnMinHeight (앱 latestChatTimelineTurnMinHeight 미러)", () => {
  it("body 높이 − 상단 20 − 하단 28 − 질문 높이", () => {
    expect(NEW_TURN_TOP_GAP).toBe(20);
    expect(NEW_TURN_BOTTOM_GAP).toBe(28);
    expect(computeTurnMinHeight(600, 40)).toBe(600 - 20 - 28 - 40);
  });

  it("음수가 되면 0으로 클램프(작은 팝오버 + 긴 질문)", () => {
    expect(computeTurnMinHeight(100, 200)).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/assistant-layout.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `client/src/lib/assistant-layout.ts` 신규:

```ts
// 새 턴 앵커 스크롤 여백 — 앱 kChatNewTurnTargetTop(90, 앱바 포함)·kChatTimelineTurnBottomGap(28) 미러.
// CRM은 스크롤 컨테이너 기준이라 상단 20px(체감 동일).
export const NEW_TURN_TOP_GAP = 20;
export const NEW_TURN_BOTTOM_GAP = 28;

// 마지막 턴의 assistant 요소에 줄 min-height — 답변이 짧아도 질문이 상단에 고정되도록 아래 공간을 예약한다.
export function computeTurnMinHeight(bodyHeight: number, questionHeight: number): number {
  return Math.max(0, bodyHeight - NEW_TURN_TOP_GAP - NEW_TURN_BOTTOM_GAP - questionHeight);
}
```

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `bun run test:unit client/src/lib/assistant-layout.test.ts` → PASS.

```bash
git add client/src/lib/assistant-layout.ts client/src/lib/assistant-layout.test.ts
git commit -m "feat(crm): 새 턴 앵커 min-height 계산 computeTurnMinHeight"
```

---

### Task 8: `askAssistantStream` (프론트 전송 계층)

**Files:**
- Modify: `client/src/lib/assistant.ts`
- Test: `client/src/lib/assistant.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `client/src/lib/assistant.test.ts`에 추가. 기존 테스트 파일의 mock 방식을 확인하고(파일 상단의 fetch/apiFetch mock 패턴 유지) 다음 케이스를 추가한다. `apiFetch`를 vi.mock으로 대체:

```ts
import { askAssistantStream } from "./assistant";
// 파일 상단 mock에 apiFetch 추가(기존 mock 형태에 맞춰):
// vi.mock("./api", () => ({ apiFetch: vi.fn() }));

function sseResponse(payload: string): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(payload));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("askAssistantStream", () => {
  it("text 청크마다 onChunk, done의 messages를 resolve한다", async () => {
    const payload =
      'event: text\ndata: {"chunk":"안녕"}\n\n' +
      'event: text\ndata: {"chunk":"하세요"}\n\n' +
      'event: done\ndata: {"messages":[{"id":"u1","role":"user","content":"q","sources":null,"createdAt":"2026-07-03T00:00:00.000Z"},{"id":"a1","role":"assistant","content":"안녕하세요","sources":[],"createdAt":"2026-07-03T00:00:00.001Z"}]}\n\n';
    vi.mocked(apiFetch).mockResolvedValue(sseResponse(payload));

    const chunks: string[] = [];
    const res = await askAssistantStream("q", { onChunk: (c) => chunks.push(c) }, new AbortController().signal);

    expect(chunks).toEqual(["안녕", "하세요"]);
    expect(res.messages).toHaveLength(2);
    expect(res.messages[1].content).toBe("안녕하세요");
    const init = vi.mocked(apiFetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ question: "q", stream: true });
  });

  it("error 이벤트는 서버 메시지로 throw한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue(sseResponse('event: error\ndata: {"code":"generation_failed","message":"일시적으로 답변에 실패했습니다."}\n\n'));
    await expect(askAssistantStream("q", { onChunk: () => {} }, new AbortController().signal)).rejects.toThrow("일시적으로 답변에 실패했습니다.");
  });

  it("HTTP 실패는 body.error로 throw한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ error: "질문을 입력하세요." }), { status: 400 }));
    await expect(askAssistantStream("q", { onChunk: () => {} }, new AbortController().signal)).rejects.toThrow("질문을 입력하세요.");
  });

  it("done 없이 스트림이 끝나면 throw한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue(sseResponse('event: text\ndata: {"chunk":"부분"}\n\n'));
    await expect(askAssistantStream("q", { onChunk: () => {} }, new AbortController().signal)).rejects.toThrow("응답이 완료되지 않았습니다.");
  });
});
```

주의: 기존 `client/src/lib/assistant.test.ts`가 `getJson/sendJson`(`./http`)을 mock하는 구조라면 `./api` mock을 추가하는 형태로 파일 상단만 맞춘다(기존 테스트 깨지지 않게).

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/assistant.test.ts`
Expected: 신규 4건 FAIL(`askAssistantStream` export 없음), 기존 PASS 유지.

- [ ] **Step 3: 구현** — `client/src/lib/assistant.ts`에 추가:

```ts
import { apiFetch } from "./api";
import { createSseParser } from "./assistant-sse";

export type AssistantStreamHandlers = { onChunk: (chunk: string) => void };

// 업무 AI 질문(SSE 스트리밍). text 청크마다 onChunk, done에서 영속본 2건을 resolve.
// error 이벤트/HTTP 실패는 한국어 메시지로 throw, 중지(abort)는 AbortError DOMException으로 throw(호출부 분기).
export async function askAssistantStream(
  question: string,
  handlers: AssistantStreamHandlers,
  signal: AbortSignal,
): Promise<AssistantAskResult> {
  const res = await apiFetch("/api/assistant/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, stream: true }),
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `요청 실패: ${res.status}`);
  }
  if (!res.body) throw new Error("응답이 완료되지 않았습니다.");

  const feed = createSseParser();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let result: AssistantAskResult | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const ev of feed(decoder.decode(value, { stream: true }))) {
      if (ev.event === "text") {
        handlers.onChunk((JSON.parse(ev.data) as { chunk: string }).chunk);
      } else if (ev.event === "done") {
        result = JSON.parse(ev.data) as AssistantAskResult;
      } else if (ev.event === "error") {
        const { message } = JSON.parse(ev.data) as { message?: string };
        throw new Error(message ?? "일시적으로 답변에 실패했습니다.");
      }
    }
  }
  if (!result) throw new Error("응답이 완료되지 않았습니다.");
  return result;
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit client/src/lib/assistant.test.ts`
Expected: PASS 전부.

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/assistant.ts client/src/lib/assistant.test.ts
git commit -m "feat(crm): askAssistantStream — fetch 스트림 + SSE 이벤트 소비"
```

---

### Task 9: `useAssistantThread` 스트리밍 상태기계 + stop

**Files:**
- Modify: `client/src/components/ai/useAssistantThread.ts`
- Test: `client/src/components/ai/useAssistantThread.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `useAssistantThread.test.ts` 수정/추가. 상단 mock에 `askAssistantStream` 추가:

```ts
vi.mock("@/lib/assistant", () => ({ askAssistant: vi.fn(), askAssistantStream: vi.fn(), fetchAssistantMessages: vi.fn() }));
const askStream = vi.mocked(askAssistantStream);
```

기존 submit 관련 테스트는 `ask`(askAssistant) mock을 쓰고 있음 — submit이 스트리밍으로 바뀌므로 해당 테스트들의 mock을 `askStream`으로 교체한다(성공 케이스는 `askStream.mockImplementation(async (_q, h) => { h.onChunk("답변"); return { messages: [...] }; })` 형태, 실패 케이스는 `mockRejectedValue`). 추가 케이스:

```ts
it("submit(스트리밍): onChunk가 드레인을 거쳐 streamText로 표시되고, done 후 영속본으로 교체된다", async () => {
  fetchMessages.mockResolvedValue([]);
  const user = msg(1, "user");
  const assistant = msg(2, "assistant");
  askStream.mockImplementation(async (_q, handlers) => {
    handlers.onChunk("답변본문입니다");
    return { messages: [user, assistant] };
  });

  const { result } = renderHook(() => useAssistantThread());
  await act(async () => { await result.current.submit("질문"); });

  // 드레인 완주 후: pending 제거 + 영속본 2건
  expect(result.current.entries.map((e) => e.kind)).toEqual(["message", "message"]);
  expect(result.current.asking).toBe(false);
});

it("submit 중 streamText가 점진 노출된다(드레인 틱)", async () => {
  fetchMessages.mockResolvedValue([]);
  let release!: () => void;
  askStream.mockImplementation((_q, handlers) => {
    handlers.onChunk("가나다라마바사아자차카타파하");
    return new Promise((res) => { release = () => res({ messages: [msg(1, "user"), msg(2, "assistant")] }); });
  });

  const { result } = renderHook(() => useAssistantThread());
  let submitP!: Promise<boolean>;
  act(() => { submitP = result.current.submit("질문"); });

  await waitFor(() => {
    const pending = result.current.entries.find((e) => e.kind === "pending");
    expect(pending && pending.kind === "pending" && (pending.streamText?.length ?? 0)).toBeGreaterThan(0);
  });
  const early = result.current.entries.find((e) => e.kind === "pending");
  expect(early!.kind === "pending" && early!.streamText!.length).toBeLessThan(14); // 도입부 2자/틱 — 전체가 한 번에 나오지 않음

  act(() => release());
  await act(async () => { await submitP; });
  expect(result.current.entries.map((e) => e.kind)).toEqual(["message", "message"]);
});

it("stop: abort 후 재조회로 서버 저장본과 동기화하고 pending을 제거한다", async () => {
  fetchMessages.mockResolvedValueOnce([]); // ensureHistory 아님 — stop 후 재조회 용
  askStream.mockImplementation((_q, handlers, signal) => {
    handlers.onChunk("부분답변");
    return new Promise((_res, rej) => {
      signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    });
  });
  const stopped = [msg(1, "user"), { ...msg(2, "assistant"), content: "부분답변 (중단됨)" }];
  fetchMessages.mockResolvedValueOnce(stopped);

  const { result } = renderHook(() => useAssistantThread());
  let submitP!: Promise<boolean>;
  act(() => { submitP = result.current.submit("질문"); });
  await waitFor(() => expect(result.current.asking).toBe(true));

  act(() => result.current.stop());
  await act(async () => { await submitP; });

  expect(result.current.entries.map((e) => e.kind)).toEqual(["message", "message"]);
  const last = result.current.entries.at(-1)!;
  expect(last.kind === "message" && last.message.content).toBe("부분답변 (중단됨)");
  expect(result.current.asking).toBe(false);
}, 10000);

it("스트리밍 실패(error 이벤트): pending이 에러 turn으로 남는다", async () => {
  fetchMessages.mockResolvedValue([]);
  askStream.mockRejectedValue(new Error("일시적으로 답변에 실패했습니다."));
  const { result } = renderHook(() => useAssistantThread());
  await act(async () => { await result.current.submit("질문"); });
  const pending = result.current.entries.find((e) => e.kind === "pending");
  expect(pending!.kind === "pending" && pending!.error).toBe("일시적으로 답변에 실패했습니다.");
});
```

주의: stop 테스트는 `STOP_SYNC_DELAY_MS`(500ms) 실시간 대기가 있어 timeout을 10s로 늘렸다.

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/components/ai/useAssistantThread.test.ts`
Expected: 신규/교체분 FAIL.

- [ ] **Step 3: 구현** — `client/src/components/ai/useAssistantThread.ts` 수정:

import·타입 변경:

```ts
import { askAssistantStream, fetchAssistantMessages, type AssistantMessage, type AssistantAskResult } from "@/lib/assistant";
import { DRAIN_TICK_MS, nextDisplayLength } from "@/lib/assistant-drain";

const STOP_SYNC_DELAY_MS = 500; // 중지 후 서버 waitUntil 저장과의 레이스를 흡수하는 재조회 지연

export type AssistantThreadEntry =
  | { kind: "message"; message: AssistantMessage }
  | { kind: "pending"; tempId: string; question: string; error?: string; streamText?: string };

type PendingTurn = { tempId: string; question: string; afterMessageId: string | null; error?: string; streamText?: string };
```

`entries` useMemo의 pending 매핑 두 곳에 `streamText: p.streamText` 추가(형태는 기존 코드 유지).

훅 본문에 ref 추가:

```ts
  const abortRef = useRef<AbortController | null>(null);
  // 직전 갱신이 "새 턴 전송"이면 그 tempId — 패널이 앵커 스크롤 후 null로 되돌린다(prependAnchorRef와 동일 패턴).
  const newTurnAnchorRef = useRef<string | null>(null);
```

`submit` 전체 교체 + `stop` 추가:

```ts
  // 질문 전송(SSE 스트리밍). text 청크는 드레인 타자기로 streamText에 점진 노출,
  // done 수신 시 드레인 완주를 기다린 뒤 영속본(user/assistant 2건)으로 교체. 실패 시 turn에 에러 표시.
  async function submit(questionRaw: string): Promise<boolean> {
    const question = questionRaw.trim();
    if (!question || asking) return false;
    const tempId = `pending-${++tempSeqRef.current}`;
    const afterMessageId = messagesRef.current.at(-1)?.id ?? null;
    setPendings((cur) => [...cur, { tempId, question, afterMessageId }]);
    newTurnAnchorRef.current = tempId;
    setAsking(true);
    const abort = new AbortController();
    abortRef.current = abort;

    // 드레인 상태(이 턴 로컬 — state가 아니라 지역 변수, 38ms 틱이 setPendings로만 반영)
    let fullText = "";
    let displayLength = 0;
    let doneResult: AssistantAskResult | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let settleDrain: (() => void) | null = null;
    const drained = new Promise<void>((resolve) => { settleDrain = resolve; });

    const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };
    const pump = () => {
      const next = nextDisplayLength(fullText, displayLength);
      if (next > displayLength) {
        displayLength = next;
        const text = fullText.slice(0, next);
        setPendings((cur) => cur.map((p) => (p.tempId === tempId ? { ...p, streamText: text } : p)));
      }
      if (doneResult && displayLength >= fullText.length) { stopTimer(); settleDrain?.(); }
    };
    const ensureTimer = () => { if (!timer) timer = setInterval(pump, DRAIN_TICK_MS); };

    try {
      const res = await askAssistantStream(question, {
        onChunk: (chunk) => { fullText += chunk; ensureTimer(); },
      }, abort.signal);
      doneResult = res;
      ensureTimer();
      pump(); // 즉시 done(짧은 답변·hits 0)도 마감되게
      await drained;
      setMessages((cur) => mergeAssistantMessages(cur, res.messages));
      setPendings((cur) => cur.filter((p) => p.tempId !== tempId));
      return true;
    } catch (e) {
      stopTimer();
      if (abort.signal.aborted) {
        // 중지: 표시 중이던 부분 + "(중단됨)" 임시 표시 → 서버 저장본 재조회로 동기화(서버가 진실원본).
        const displayed = fullText.slice(0, displayLength);
        if (displayed) {
          setPendings((cur) => cur.map((p) => (p.tempId === tempId ? { ...p, streamText: `${displayed} (중단됨)` } : p)));
        }
        await new Promise((resolve) => setTimeout(resolve, STOP_SYNC_DELAY_MS));
        try {
          const rows = await fetchAssistantMessages();
          setMessages((cur) => mergeAssistantMessages(cur, rows));
        } catch {
          // 재조회 실패해도 pending은 제거(이중 표시 방지) — 저장본은 다음 히스토리 로드/리로드에서 표시.
        }
        setPendings((cur) => cur.filter((p) => p.tempId !== tempId));
        return false;
      }
      const message = e instanceof Error ? e.message : "일시적으로 답변에 실패했습니다.";
      setPendings((cur) => cur.map((p) => (p.tempId === tempId ? { ...p, error: message, streamText: undefined } : p)));
      return false;
    } finally {
      stopTimer();
      abortRef.current = null;
      setAsking(false);
    }
  }

  // 생성 중지 — fetch abort. 이후 정리는 submit의 abort 분기가 담당.
  function stop(): void {
    abortRef.current?.abort();
  }
```

반환 확장:

```ts
  return { entries, historyStatus, hasMore, loadingOlder, asking, prependAnchorRef, newTurnAnchorRef, ensureHistory, loadOlder, submit, stop };
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit client/src/components/ai/useAssistantThread.test.ts`
Expected: PASS 전부(교체분 포함).

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/ai/useAssistantThread.ts client/src/components/ai/useAssistantThread.test.ts
git commit -m "feat(crm): useAssistantThread SSE 스트리밍 — 드레인 타자기·stop·새 턴 앵커 ref"
```

---

### Task 10: 패널 — 스트리밍 렌더·Send↔Stop 토글·새 턴 앵커 스크롤

**Files:**
- Modify: `client/src/components/ai/AiAssistantPanel.tsx`

CSS 추가 없음(아이콘 교체 + inline min-height). 대형 컴포넌트 관례상 유닛은 Task 7·9가 커버, 여기는 typecheck/lint + Task 12 브라우저 스모크로 검증.

- [ ] **Step 1: 구현** — `AiAssistantPanel.tsx` 수정.

import 변경:

```tsx
import { Maximize2, Send, Square, X } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState } from "react";

import { DoubleBounceDots } from "@/components/ai/DoubleBounceDots";
import { MarkdownMessage } from "@/components/ai/MarkdownMessage";
import { type useAssistantThread } from "@/components/ai/useAssistantThread";
import { NEW_TURN_TOP_GAP, computeTurnMinHeight } from "@/lib/assistant-layout";
```

훅 구조 분해에 `newTurnAnchorRef` 추가, 상태 추가:

```tsx
  const { entries, historyStatus, hasMore, loadingOlder, asking, prependAnchorRef, newTurnAnchorRef } = thread;
  // 마지막 턴 assistant 요소에 줄 min-height(px). 새 턴 전송 시 계산 — 영속 교체 후에도 렌더에 유지돼 스크롤 점프가 없다.
  const [turnMinHeight, setTurnMinHeight] = useState<number | null>(null);
  const lastTurnUserIdRef = useRef<string | null>(null); // 확대/축소 재계산 시 질문 높이를 다시 잴 앵커
```

기존 스크롤 useLayoutEffect 전체 교체:

```tsx
  // 대화 갱신 시 스크롤 분기:
  //  - 이전 대화 prepend → 그 배치 최상단 앵커(기존 동작)
  //  - 새 턴 전송 → 질문을 상단 20px에 앵커 + 마지막 턴 min-height 예약(아래 공간 확보, 앱 미러)
  //  - 그 외(스트리밍 틱·done 교체 등) → 스크롤 안 함(질문 고정이 핵심 — 답변은 예약 공간을 채우며 자란다)
  //  - 마운트 직후·히스토리 로드 완료 전이 → 최하단(기존 동작)
  const mountedRef = useRef(false);
  const prevStatusRef = useRef(historyStatus);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const prependId = prependAnchorRef.current;
    const newTurnId = newTurnAnchorRef.current;
    const loadedNow = prevStatusRef.current === "loading" && historyStatus === "loaded";
    prevStatusRef.current = historyStatus;

    if (prependId) {
      prependAnchorRef.current = null;
      const anchor = el.querySelector<HTMLElement>(`[data-eid="${prependId}"]`);
      el.scrollTop = anchor ? anchor.offsetTop : el.scrollHeight;
    } else if (newTurnId) {
      newTurnAnchorRef.current = null;
      const question = el.querySelector<HTMLElement>(`[data-eid="${newTurnId}-q"]`);
      if (question) {
        lastTurnUserIdRef.current = `${newTurnId}-q`;
        const minHeight = computeTurnMinHeight(el.clientHeight, question.offsetHeight);
        // 스크롤 목표가 max-scroll에 클램프되지 않도록 DOM에 먼저 반영(같은 프레임), state는 이후 렌더 유지용.
        const answer = el.querySelector<HTMLElement>(`[data-eid="${newTurnId}-a"]`);
        if (answer) answer.style.minHeight = `${minHeight}px`;
        setTurnMinHeight(minHeight);
        el.scrollTo({ top: question.offsetTop - NEW_TURN_TOP_GAP, behavior: "smooth" });
      }
    } else if (!mountedRef.current || loadedNow) {
      el.scrollTop = el.scrollHeight;
    }
    mountedRef.current = true;
  }, [entries, asking, historyStatus, prependAnchorRef, newTurnAnchorRef]);

  // 확대/축소 시 body 높이가 바뀌므로 마지막 턴 min-height 재계산(스크롤은 유지).
  useLayoutEffect(() => {
    const el = bodyRef.current;
    const anchorId = lastTurnUserIdRef.current;
    if (!el || !anchorId || turnMinHeight === null) return;
    const question = el.querySelector<HTMLElement>(`[data-eid="${anchorId}"]`);
    if (question) setTurnMinHeight(computeTurnMinHeight(el.clientHeight, question.offsetHeight));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- expanded 전환 시에만 재계산(turnMinHeight 자체 변화에 반응하면 루프)
  }, [expanded]);
```

영속 교체 후에도 min-height가 마지막 assistant 메시지에 유지되도록, entries 렌더에서 "마지막 entry가 assistant"면 style 부여. `entries.map(...)` 블록 교체:

```tsx
          {entries.map((entry, index) => {
            const isLast = index === entries.length - 1;
            const lastTurnStyle = isLast && turnMinHeight !== null ? { minHeight: `${turnMinHeight}px` } : undefined;
            if (entry.kind === "message") {
              return (
                <div
                  className={`work-ai-message ${entry.message.role}`}
                  data-eid={entry.message.id}
                  key={entry.message.id}
                  style={entry.message.role === "assistant" ? lastTurnStyle : undefined}
                >
                  {entry.message.role === "assistant" ? <MarkdownMessage content={entry.message.content} /> : <p>{entry.message.content}</p>}
                  {entry.message.role === "assistant" && entry.message.sources && entry.message.sources.length > 0 && (
                    <ul className="work-ai-sources">
                      {entry.message.sources.map((source, sourceIndex) => <li key={sourceIndex}>{source.customerName} · {source.snippet}</li>)}
                    </ul>
                  )}
                </div>
              );
            }
            return (
              <Fragment key={entry.tempId}>
                <div className="work-ai-message user" data-eid={`${entry.tempId}-q`}><p>{entry.question}</p></div>
                <div className="work-ai-message assistant" data-eid={`${entry.tempId}-a`} style={lastTurnStyle}>
                  {entry.error ? <p className="work-ai-error">{entry.error}</p>
                    : entry.streamText ? <MarkdownMessage content={entry.streamText} />
                    : <DoubleBounceDots />}
                </div>
              </Fragment>
            );
          })}
```

주의: pending Fragment에서 `lastTurnStyle`은 assistant div에 붙는다(마지막 entry는 pending이므로 isLast 판정이 그 Fragment에 걸림). user 버블에는 붙이지 않는다.

Send↔Stop 토글 — compose 버튼 교체:

```tsx
        <button
          type="button"
          aria-label={asking ? "생성 중지" : "보내기"}
          onClick={() => (asking ? thread.stop() : void submitQuestion())}
        >
          {asking ? <Square size={14} /> : <Send size={16} />}
        </button>
```

(기존 `disabled={asking}` 제거 — 생성 중엔 중지 버튼으로 동작. `submitQuestion`/Enter 핸들러의 `asking` 가드는 그대로라 이중 전송은 없음.)

- [ ] **Step 2: 검증**

Run: `bun run typecheck && bun run lint && bun run test:unit`
Expected: 전부 green (패널은 컴파일·기존 테스트 회귀 확인).

- [ ] **Step 3: 커밋**

```bash
git add client/src/components/ai/AiAssistantPanel.tsx
git commit -m "feat(crm): 업무 AI 패널 — 스트리밍 마크다운 렌더·Send/Stop 토글·새 턴 앵커 스크롤"
```

---

### Task 11: 전체 검증 + push + PR

- [ ] **Step 1: 전체 검증**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build`
Expected: 전부 green. 실패 시 고치고 재실행(성공 주장 전에 출력 확인).

- [ ] **Step 2: push + PR 생성**

```bash
git push -u origin feat/crm-work-ai-sse-streaming
gh pr create --title "feat(crm): 업무 AI SSE 스트리밍 + 새 턴 앵커 스크롤 (앱 미러)" --body "..."
```

PR 본문에 포함: spec/plan 링크, 앱 미러 수치(38ms·2/4/7/11·중단됨 suffix·상단 20px), 중지 저장 정책(부분 저장), 스모크 예정 항목. `[skip ci]` 금지.

---

### Task 12: 브라우저 스모크 (실 Gemini — magiclink 세션)

AGENTS.md의 "로컬 브라우저 스모크 로그인 우회" 절차로 admin 세션 수립 후 확인:

- [ ] 업무 AI 팝오버에서 질문 → **타자기 점진 노출**(도입부 느리게 → 중간 빠르게) 체감 확인
- [ ] 질문 전송 순간 **질문이 상단 ~20px에 고정**되고, 답변이 자라는 동안 **스크롤 점프 없음**
- [ ] 긴 답변 생성 중 **Stop 클릭** → 즉시 멈춤 + `" (중단됨)"` 표시 → **리로드 후에도 부분 답변 + "(중단됨)" 보존**(서버 부분 저장 실증). 중지 직후 빠르게 리로드해 **유령 빈 말풍선(빈 content placeholder)이 없는지**도 확인 — abort 경로는 라우트 유닛으로 검증 불가라 이 스모크가 전담(waitUntil guard 실측)
- [ ] 답변 완료 후 새 질문 → 이전 턴 min-height 해제·새 턴 앵커 정상
- [ ] 확대(Maximize) 토글 → min-height 재계산으로 레이아웃 안정
- [ ] 이전 대화 위로 스크롤 로드(prepend 앵커) 기존 동작 회귀 없음
- [ ] 스모크로 생성한 대화는 공유 master — 확인 후 정리 불필요(본인 staff 스레드)지만 과도한 테스트 대화는 자제

---

## Self-Review 결과 (plan 작성 시 수행)

- Spec 커버리지: 결정 1~9 전부 태스크에 매핑(1·2→Task 1·4, 3·4·5→Task 2·3·4·9, 6→Task 6·9, 7→Task 9·10, 8→범위 제외 유지, 9→Task 7·10). 스모크(Task 12)가 spec 리스크 3건(abort 감지·드레인 마감·부분 마크다운) 실측.
- 타입 일관성: `AssistantThreadEntry.streamText`(Task 9) ↔ 패널 렌더(Task 10), `newTurnAnchorRef`(Task 9) ↔ 패널 소비(Task 10), deps 3개(Task 4) ↔ 쿼리 시그니처(Task 2) 일치 확인.
- 기존 테스트 영향: `useAssistantThread.test.ts`의 submit 계열은 mock 교체 필요(Task 9 Step 1에 명시). 그 외 기존 테스트는 불변.
