# 업무 AI 채팅 영속+멀티턴+앱 UI (슬라이스 C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 업무 AI 채팅을 단일샷에서 **대화 영속 + 멀티턴 컨텍스트 + 앱식 마크다운/로딩 UI**로 확장(새로고침 생존, 지난 턴 반영, 마크다운 렌더).

**Architecture:** `crm.assistant_messages`(staff별 평면 스트림)에 user/assistant 메시지를 **성공 시 원자 저장**. `POST /api/assistant/ask`가 최근 10메시지를 Gemini 멀티턴 컨텍스트로 쓰고 저장까지, `GET /api/assistant/messages`가 히스토리 반환. 프론트는 진입 시 히스토리 로드·react-markdown 렌더·더블바운스 로딩. SSE 스트리밍은 후속.

**Tech Stack:** Hono + drizzle(postgres-js), Gemini REST, React(Topbar) + react-markdown/remark-gfm. 백엔드 테스트 `bun:test`(`bun run test:server`), 프론트 `vitest`(`bun run test:unit`).

**선행 상태(B1, PR #132 머지됨):** `src/routes/assistant.ts`에 `POST /ask`(staff JWT + `assistantDeps` 주입 객체 {embedTexts, searchEmbeddings, generateAnswer, getCustomerMetaByIds} + try/catch 한국어 500). `src/lib/gemini-generate.ts` `generateAnswer(systemPrompt, userPrompt, apiKey, fetchImpl=fetch)`. `src/lib/assistant-prompt.ts` `SYSTEM_PROMPT`(현재 "마크다운 없이 평문" 지시 포함). `client/src/lib/assistant.ts` `askAssistant`/`AssistantAnswer`/`AssistantSource`. `client/src/components/Topbar.tsx` `aiTurns` 메모리 상태 + `submitAiQuestion`.

**브랜치:** 이미 `feat/crm-work-ai-chat-persist` 체크아웃됨(spec 커밋 `5112381` 존재). push 금지, 커밋만. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `[skip ci]` 토큰 금지.

---

## File Structure

- Create `src/db/schema.ts`에 `assistantMessages` 테이블(+ `ASSISTANT_ROLES` 상수) — 마이그 신규.
- Create `src/db/queries/assistant-messages.ts` — `insertAssistantMessages`, `listRecentMessages`.
- Modify `src/lib/gemini-generate.ts` — `generateAnswer`에 `history` 인자.
- Modify `src/lib/assistant-prompt.ts` — 평문 지시 제거(마크다운 허용).
- Modify `src/routes/assistant.ts` — `assistantDeps`에 쿼리 2개 추가, `/ask` 멀티턴+영속, `GET /messages` 신규.
- Modify `client/src/lib/assistant.ts` — `AssistantMessage` 타입, `fetchAssistantMessages`, `askAssistant` 반환 확장.
- Create `client/src/components/ai/MarkdownMessage.tsx` — react-markdown 래퍼.
- Create `client/src/components/ai/DoubleBounceDots.tsx` — 로딩 애니메이션.
- Modify `client/src/components/Topbar.tsx` — 히스토리 로드·영속 turn 렌더·마크다운·로딩 닷.
- Modify `client/src/index.css` — 마크다운/버블/더블바운스 스타일.
- Modify `client/package.json` — `react-markdown`, `remark-gfm`.

---

### Task 1: `crm.assistant_messages` 스키마 + 마이그레이션

**Files:** Modify `src/db/schema.ts`; Create(generated) `drizzle/00NN_*.sql`

- [ ] **Step 1: schema.ts에 role 상수 + 테이블 추가**

`src/db/schema.ts`의 기술값 상수 블록(예: `const ACQ_TAX_MODES = [...]` 근처)에 추가:
```ts
const ASSISTANT_ROLES = ["user", "assistant"];
```
파일 하단(`embeddings` 테이블 뒤)에 추가:
```ts
// 업무 AI 채팅 메시지(직원/관리자별 평면 스트림). 세션/핸드오프 없음(내부 도구). staff_user_id=JWT sub, loose id(FK 보류).
export const assistantMessages = crm.table("assistant_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  staffUserId: uuid("staff_user_id").notNull(),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  sources: jsonb("sources"), // assistant RAG 근거 [{customerId,customerName,sourceType,snippet}], user는 null
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [check("assistant_messages_role_check", inListCheck(t.role, ASSISTANT_ROLES))]);
```
(주의: `check`·`inListCheck`·`jsonb`·`uuid`·`text`·`timestamp`는 이미 import돼 있음.)

- [ ] **Step 2: 마이그 생성**

Run: `bun run db:generate`
Expected: `drizzle/00NN_*.sql` 생성, `assistant_messages` CREATE TABLE 포함.

- [ ] **Step 3: 인덱스 raw SQL 추가**

생성된 `drizzle/00NN_*.sql` 끝에 추가:
```sql
CREATE INDEX IF NOT EXISTS "assistant_messages_staff_created_idx" ON "crm"."assistant_messages" ("staff_user_id", "created_at");
```

- [ ] **Step 4: 적용 + 확인**

Run: `bun run db:migrate`
Run: `source .env.local; psql "$DATABASE_URL" -c "\d crm.assistant_messages"`
Expected: 컬럼(id/staff_user_id/role/content/sources jsonb/created_at), role CHECK, staff_created 인덱스.

- [ ] **Step 5: typecheck + 커밋**

Run: `bun run typecheck` (0)
```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(assistant): crm.assistant_messages 테이블(대화 영속)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: assistant-messages 쿼리 (저장 + 최근 로드)

**Files:** Create `src/db/queries/assistant-messages.ts`; Test `src/db/queries/assistant-messages.test.ts`

- [ ] **Step 1: 실패 테스트 (실 DB, FK 없어 임의 uuid 사용)**

`src/db/queries/assistant-messages.test.ts`:
```ts
import { test, expect, afterAll } from "bun:test";
import { eq } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { assistantMessages } from "../schema";
import { insertAssistantMessages, listRecentMessages } from "./assistant-messages";

const db = getDefaultDb();
const STAFF = "cccccccc-cccc-cccc-cccc-cccccccccccc";

afterAll(async () => { await db.delete(assistantMessages).where(eq(assistantMessages.staffUserId, STAFF)); });

test("insertAssistantMessages: user+assistant 원자 저장, createdAt 순서 보존", async () => {
  const now = new Date();
  const saved = await insertAssistantMessages([
    { staffUserId: STAFF, role: "user", content: "질문1", sources: null, createdAt: now },
    { staffUserId: STAFF, role: "assistant", content: "답1", sources: [{ customerId: "x" }], createdAt: new Date(now.getTime() + 1) },
  ], db);
  expect(saved).toHaveLength(2);
});

test("listRecentMessages: 최근 N개 created_at 오름차순 반환", async () => {
  const rows = await listRecentMessages(STAFF, 10, db);
  expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
  expect(rows[0].content).toBe("질문1");
  expect(rows[1].content).toBe("답1");
});

test("listRecentMessages: limit 초과분은 최신 우선으로 잘림", async () => {
  const base = new Date();
  await insertAssistantMessages(
    Array.from({ length: 4 }, (_, i) => ({ staffUserId: STAFF, role: "user" as const, content: `m${i}`, sources: null, createdAt: new Date(base.getTime() + 100 + i) })),
    db,
  );
  const rows = await listRecentMessages(STAFF, 2, db);
  expect(rows).toHaveLength(2);
  expect(rows[1].content).toBe("m3"); // 가장 최신이 마지막
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test src/db/queries/assistant-messages.test.ts --env-file=.env.local`
Expected: FAIL ("Cannot find module './assistant-messages'")

- [ ] **Step 3: 구현**

`src/db/queries/assistant-messages.ts`:
```ts
import { desc, eq } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { assistantMessages } from "../schema";

export type AssistantMessageRow = typeof assistantMessages.$inferSelect;
export type NewAssistantMessage = {
  staffUserId: string;
  role: "user" | "assistant";
  content: string;
  sources: unknown;
  createdAt: Date;
};

// user+assistant를 한 INSERT로 원자 저장. createdAt은 호출부가 명시(순서 보존).
export async function insertAssistantMessages(rows: NewAssistantMessage[], executor: Executor = getDefaultDb()): Promise<AssistantMessageRow[]> {
  if (rows.length === 0) return [];
  return executor.insert(assistantMessages).values(rows).returning();
}

// 최근 limit개를 created_at 내림차순으로 받아 오름차순(표시 순서)으로 반환.
export async function listRecentMessages(staffUserId: string, limit: number, executor: Executor = getDefaultDb()): Promise<AssistantMessageRow[]> {
  const rows = await executor
    .select().from(assistantMessages)
    .where(eq(assistantMessages.staffUserId, staffUserId))
    .orderBy(desc(assistantMessages.createdAt))
    .limit(limit);
  return rows.reverse();
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test src/db/queries/assistant-messages.test.ts --env-file=.env.local`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/db/queries/assistant-messages.ts src/db/queries/assistant-messages.test.ts
git commit -m "feat(assistant): 대화 메시지 저장/최근 로드 쿼리

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `generateAnswer` 멀티턴 history 확장

**Files:** Modify `src/lib/gemini-generate.ts`; Modify `src/lib/gemini-generate.test.ts`

- [ ] **Step 1: 기존 테스트를 새 시그니처로 갱신 + 멀티턴 테스트 추가**

`src/lib/gemini-generate.test.ts`를 아래로 교체(기존 2개 호출을 `history=[]`, `fetchImpl` 위치 이동에 맞춰 갱신 + 멀티턴 1개 추가):
```ts
import { test, expect } from "bun:test";

import { generateAnswer, GEN_MODEL } from "./gemini-generate";

test("generateAnswer: system+user 프롬프트 전송, 텍스트 파싱", async () => {
  let captured: { url: string; body: { systemInstruction?: unknown; contents: { role: string; parts: { text: string }[] }[] } } | null = null;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "답변입니다" }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const out = await generateAnswer("SYS", "USER", "KEY", [], fakeFetch);

  expect(out).toBe("답변입니다");
  expect(captured!.url).toContain(`${GEN_MODEL}:generateContent`);
  expect(captured!.body.contents.at(-1)!.parts[0].text).toBe("USER");
  expect(captured!.body.contents.at(-1)!.role).toBe("user");
});

test("generateAnswer: history를 contents 앞부분에 role 매핑(assistant→model)", async () => {
  let contents: { role: string; parts: { text: string }[] }[] = [];
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    contents = JSON.parse(String(init?.body)).contents;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  await generateAnswer("SYS", "이번질문", "KEY", [
    { role: "user", content: "이전질문" },
    { role: "assistant", content: "이전답변" },
  ], fakeFetch);

  expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  expect(contents[0].parts[0].text).toBe("이전질문");
  expect(contents[1].parts[0].text).toBe("이전답변");
  expect(contents[2].parts[0].text).toBe("이번질문");
});

test("generateAnswer: 실패 응답은 throw", async () => {
  const fakeFetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  await expect(generateAnswer("s", "u", "KEY", [], fakeFetch)).rejects.toThrow();
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test src/lib/gemini-generate.test.ts --env-file=.env.local`
Expected: FAIL(시그니처/history 미구현)

- [ ] **Step 3: 구현 — history 인자 추가**

`src/lib/gemini-generate.ts`를 아래로 교체:
```ts
import { classifyGeminiError } from "./gemini-error";

export const GEN_MODEL = "gemini-3.1-flash-lite"; // 앱/crm-analyst 동일.

export type ChatTurn = { role: "user" | "assistant"; content: string };

// 근거+질문(+지난 turn history)으로 한국어 답변 생성. 실패(재시도 후에도)는 throw.
export async function generateAnswer(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  history: ChatTurn[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEN_MODEL}:generateContent?key=${apiKey}`;
  const contents = [
    ...history.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
    { role: "user", parts: [{ text: userPrompt }] },
  ];
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.2 },
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok) {
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string") throw new Error("Gemini 생성 응답 파싱 실패");
      return text;
    }
    const bodyText = await res.text();
    const code = classifyGeminiError(res.status, bodyText);
    console.error(`[assistant] Gemini generate ${code} status=${res.status}`);
    if (attempt === 0 && (code === "rate_limited" || code === "unavailable")) continue;
    throw new Error(`Gemini 생성 실패: ${code}`);
  }
  throw new Error("Gemini 생성 실패");
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test src/lib/gemini-generate.test.ts --env-file=.env.local`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/gemini-generate.ts src/lib/gemini-generate.test.ts
git commit -m "feat(assistant): generateAnswer 멀티턴 history 지원

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: SYSTEM_PROMPT 평문 지시 제거 (마크다운 허용)

**Files:** Modify `src/lib/assistant-prompt.ts`; Modify `src/lib/assistant-prompt.test.ts`

- [ ] **Step 1: 테스트 갱신 (마크다운 지시 단언 제거)**

`src/lib/assistant-prompt.test.ts`의 SYSTEM_PROMPT 테스트를 아래로 교체:
```ts
test("SYSTEM_PROMPT: 근거 기반·모르면 모른다 지침 포함", () => {
  expect(SYSTEM_PROMPT).toContain("근거");
  expect(SYSTEM_PROMPT).toContain("찾지 못");
  expect(SYSTEM_PROMPT).not.toContain("마크다운 기호"); // 평문 강제 제거됨(마크다운 렌더 도입)
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test src/lib/assistant-prompt.test.ts --env-file=.env.local`
Expected: FAIL(아직 "마크다운 기호" 문구 있음)

- [ ] **Step 3: SYSTEM_PROMPT에서 평문 라인 제거**

`src/lib/assistant-prompt.ts`의 `SYSTEM_PROMPT` 배열에서 아래 한 줄을 **삭제**:
```ts
  "마크다운 기호(*, #, -, ` 등)를 쓰지 말고 평문으로만 작성하세요. 목록은 줄바꿈으로 구분하세요.",
```
결과(참고):
```ts
export const SYSTEM_PROMPT = [
  "당신은 자동차 CRM 상담사를 돕는 한국어 업무 어시스턴트입니다.",
  "아래에 제공된 근거(고객 메모·상담이력·니즈)만 사용해 답하세요. 근거에 없는 내용은 추측하지 마세요.",
  "답변은 간결한 한국어로, 관련 고객과 근거를 함께 제시하세요.",
  "관련 근거가 없으면 '관련 CRM 데이터를 찾지 못했습니다'라고만 답하세요.",
].join("\n");
```

- [ ] **Step 4: 통과 확인**

Run: `bun test src/lib/assistant-prompt.test.ts --env-file=.env.local`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/assistant-prompt.ts src/lib/assistant-prompt.test.ts
git commit -m "feat(assistant): SYSTEM_PROMPT 평문 강제 해제 (마크다운 렌더 도입 전제)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `/ask` 멀티턴+영속 개편 + `GET /messages`

**Files:** Modify `src/routes/assistant.ts`; Modify `src/routes/assistant.test.ts`

- [ ] **Step 1: 테스트 교체(영속 2건·멀티턴·GET) — assistantDeps에 쿼리 주입**

`src/routes/assistant.test.ts`를 아래로 교체:
```ts
import { test, expect, afterEach } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
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
  assistantDeps.embedTexts = async (texts: string[]) => texts.map(() => Array.from({ length: 3072 }, () => 0.01));
  assistantDeps.searchEmbeddings = async () => [{ id: "e1", sourceType: "memo", sourceId: "s1", customerId: "c1", content: "근거", similarity: 0.9 }];
  assistantDeps.getCustomerMetaByIds = async () => new Map([["c1", { name: "김민준", status: "상담중" }]]);
  assistantDeps.generateAnswer = async (_s: string, _u: string, _k: string, history: { role: string }[]) => { seen.historyLen = history.length; return "답변"; };
  assistantDeps.insertAssistantMessages = async (rows: unknown[]) => { seen.saved = rows.length; return rows as never; };

  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: "이번질문" }) });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { answer: string; sources: unknown[]; messages: unknown[] };
  expect(json.answer).toBe("답변");
  expect(seen.historyLen).toBe(1);
  expect(seen.saved).toBe(2);
  expect(json.messages.length).toBe(2);
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
```

- [ ] **Step 2: 실패 확인**

Run: `bun test src/routes/assistant.test.ts --env-file=.env.local`
Expected: FAIL(멀티턴/영속/GET 미구현)

- [ ] **Step 3: 라우트 개편**

`src/routes/assistant.ts`를 아래로 교체:
```ts
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
```
(주의: `GET /messages`·`POST /ask` 모두 기존 `app.ts`의 `/api/assistant/*` auth+db 미들웨어가 커버 — app.ts 변경 불필요.)

- [ ] **Step 4: 통과 확인**

Run: `bun test src/routes/assistant.test.ts --env-file=.env.local`
Expected: PASS (5 tests). 이어서 `bun run test:server` 전체 green 확인.

- [ ] **Step 5: typecheck + 커밋**

Run: `bun run typecheck` (0), `bun run lint` (0)
```bash
git add src/routes/assistant.ts src/routes/assistant.test.ts
git commit -m "feat(assistant): /ask 멀티턴+대화 영속, GET /messages 히스토리

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 프론트 assistant.ts (히스토리 + 메시지 타입)

**Files:** Modify `client/src/lib/assistant.ts`; Modify `client/src/lib/assistant.test.ts`

- [ ] **Step 1: 테스트 교체**

`client/src/lib/assistant.test.ts`를 아래로 교체:
```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("./http", () => ({
  sendJson: vi.fn(async () => ({ answer: "답", sources: [], messages: [
    { id: "m1", role: "user", content: "q", sources: null, createdAt: "2026-07-02T00:00:00Z" },
    { id: "m2", role: "assistant", content: "답", sources: [], createdAt: "2026-07-02T00:00:01Z" },
  ] })),
  getJson: vi.fn(async () => ([
    { id: "m1", role: "user", content: "q", sources: null, createdAt: "2026-07-02T00:00:00Z" },
  ])),
}));

import { getJson, sendJson } from "./http";
import { askAssistant, fetchAssistantMessages } from "./assistant";

describe("assistant client", () => {
  it("askAssistant: POST /ask + messages 반환", async () => {
    const res = await askAssistant("q");
    expect(sendJson).toHaveBeenCalledWith("/api/assistant/ask", "POST", { question: "q" });
    expect(res.messages).toHaveLength(2);
    expect(res.messages[1].role).toBe("assistant");
  });
  it("fetchAssistantMessages: GET /messages", async () => {
    const rows = await fetchAssistantMessages();
    expect(getJson).toHaveBeenCalledWith("/api/assistant/messages");
    expect(rows[0].content).toBe("q");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/assistant.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`client/src/lib/assistant.ts`를 아래로 교체:
```ts
import { getJson, sendJson } from "./http";

export type AssistantSource = { customerId: string; customerName: string; sourceType: string; snippet: string };
export type AssistantMessage = { id: string; role: "user" | "assistant"; content: string; sources: AssistantSource[] | null; createdAt: string };
export type AssistantAnswer = { answer: string; sources: AssistantSource[]; messages: AssistantMessage[] };

// 업무 AI 질문 → 근거 답변 + 저장된 user/assistant 메시지. 실패 시 http 헬퍼가 throw.
export async function askAssistant(question: string): Promise<AssistantAnswer> {
  return sendJson<AssistantAnswer>("/api/assistant/ask", "POST", { question });
}

// 본인 최근 대화 히스토리(패널 진입 시).
export async function fetchAssistantMessages(): Promise<AssistantMessage[]> {
  return getJson<AssistantMessage[]>("/api/assistant/messages");
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit client/src/lib/assistant.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/assistant.ts client/src/lib/assistant.test.ts
git commit -m "feat(assistant): 프론트 fetchAssistantMessages + messages 타입

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: react-markdown 도입 + MarkdownMessage 컴포넌트

**Files:** Modify `client/package.json`(의존성); Create `client/src/components/ai/MarkdownMessage.tsx`; Test `client/src/components/ai/MarkdownMessage.test.tsx`

- [ ] **Step 1: 의존성 추가**

Run: `bun add react-markdown remark-gfm`
Expected: `client`/root package.json에 `react-markdown`·`remark-gfm` 추가(설치 성공). (모노레포 구조상 설치 위치가 root면 root, client면 client — 기존 react 의존성과 같은 곳에 들어감.)

- [ ] **Step 2: 실패 테스트 (vitest + jsdom)**

`client/src/components/ai/MarkdownMessage.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownMessage } from "./MarkdownMessage";

describe("MarkdownMessage", () => {
  it("마크다운을 HTML 요소로 렌더(헤딩·불릿·볼드)", () => {
    render(<MarkdownMessage content={"## 제목\n\n- 항목1\n- 항목2\n\n**굵게**"} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("제목");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("굵게").tagName.toLowerCase()).toBe("strong");
  });
});
```
(주의: `@testing-library/react`가 이미 devDeps에 있는지 확인 — 기존 컴포넌트 테스트가 쓰는지 grep. 없으면 `bun add -d @testing-library/react`를 이 Step에 추가하고 vitest jsdom 환경 확인.)

- [ ] **Step 3: 실패 확인**

Run: `bun run test:unit client/src/components/ai/MarkdownMessage.test.tsx`
Expected: FAIL

- [ ] **Step 4: 구현**

`client/src/components/ai/MarkdownMessage.tsx`:
```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 업무 AI 답변 마크다운 렌더. raw HTML 미허용(react-markdown 기본 = XSS 안전).
export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 5: 통과 확인**

Run: `bun run test:unit client/src/components/ai/MarkdownMessage.test.tsx`
Expected: PASS

- [ ] **Step 6: typecheck + 커밋**

Run: `bun run typecheck` (0), `bun run lint` (0)
```bash
git add client/src/components/ai/MarkdownMessage.tsx client/src/components/ai/MarkdownMessage.test.tsx package.json bun.lock client/package.json 2>/dev/null
git commit -m "feat(assistant): react-markdown 답변 렌더 컴포넌트

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: DoubleBounceDots 로딩 컴포넌트

**Files:** Create `client/src/components/ai/DoubleBounceDots.tsx`; Test `client/src/components/ai/DoubleBounceDots.test.tsx`; Modify `client/src/index.css`

- [ ] **Step 1: 실패 테스트**

`client/src/components/ai/DoubleBounceDots.test.tsx`:
```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DoubleBounceDots } from "./DoubleBounceDots";

describe("DoubleBounceDots", () => {
  it("두 개의 bounce 닷을 렌더", () => {
    const { container } = render(<DoubleBounceDots />);
    expect(container.querySelectorAll(".db-dot")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/components/ai/DoubleBounceDots.test.tsx`
Expected: FAIL

- [ ] **Step 3: 구현 + 스타일**

`client/src/components/ai/DoubleBounceDots.tsx`:
```tsx
// 앱 _ChaDoubleBounceIndicator 포팅: 브랜드색 두 원이 위상차로 펄스(1600ms). 색상은 CSS 토큰(--brand).
export function DoubleBounceDots() {
  return (
    <span className="db-dots" aria-label="생각 중" role="status">
      <span className="db-dot" />
      <span className="db-dot" />
    </span>
  );
}
```
`client/src/index.css` 끝에 추가:
```css
.db-dots { position: relative; display: inline-block; width: 20px; height: 20px; }
.db-dot { position: absolute; inset: 0; border-radius: 50%; background: var(--brand); opacity: 0.6; animation: db-bounce 1600ms cubic-bezier(0.65, 0, 0.35, 1) infinite; }
.db-dot:nth-child(2) { animation-delay: -800ms; }
@keyframes db-bounce { 0% { transform: scale(0.03); opacity: 0.15; } 50% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(0.03); opacity: 0.15; } }
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit client/src/components/ai/DoubleBounceDots.test.tsx`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/ai/DoubleBounceDots.tsx client/src/components/ai/DoubleBounceDots.test.tsx client/src/index.css
git commit -m "feat(assistant): 더블바운스 로딩 닷(앱 인디케이터 포팅)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Topbar 통합 (히스토리 로드·영속 렌더·마크다운·로딩)

**Files:** Modify `client/src/components/Topbar.tsx`; Modify `client/src/index.css`

앵커 코드로 위치를 찾아 편집(라인번호 드리프트 주의). B1에서 추가된 `aiTurns`/`aiLoading`/`submitAiQuestion`와 `work-ai-body`/`work-ai-compose` 렌더가 이미 있음. 이번엔 (a) 진입 시 히스토리 로드, (b) 답변을 마크다운으로, (c) 로딩을 더블바운스로 바꾼다.

- [ ] **Step 1: import + 히스토리 로드**

`client/src/components/Topbar.tsx` 상단 import 조정:
```ts
import { askAssistant, fetchAssistantMessages, type AssistantAnswer, type AssistantMessage } from "@/lib/assistant";
import { MarkdownMessage } from "@/components/ai/MarkdownMessage";
import { DoubleBounceDots } from "@/components/ai/DoubleBounceDots";
```
`aiTurns`/`aiLoading` state 근처에 히스토리 상태 + 로드 effect 추가:
```ts
  const [aiHistory, setAiHistory] = useState<AssistantMessage[]>([]);
  const [aiHistoryLoaded, setAiHistoryLoaded] = useState(false);

  useEffect(() => {
    if (!workAiOpen || aiHistoryLoaded) return;
    let alive = true;
    void fetchAssistantMessages()
      .then((rows) => { if (alive) { setAiHistory(rows); setAiHistoryLoaded(true); } })
      .catch(() => { if (alive) setAiHistoryLoaded(true); });
    return () => { alive = false; };
  }, [workAiOpen, aiHistoryLoaded]);
```
(주의: `useEffect`가 이미 import돼 있는지 확인. `workAiOpen`은 기존 팝오버 상태명 — 실제 이름 확인 후 사용.)

- [ ] **Step 2: 성공 시 히스토리에 서버 메시지 반영**

기존 `submitAiQuestion`의 성공 분기를 조정 — 서버가 돌려준 `res.messages`를 `aiHistory`에 append하고, 임시 `aiTurns`는 성공 시 비운다:
```ts
    try {
      const res = await askAssistant(question);
      setAiHistory((cur) => [...cur, ...res.messages]);
      setAiTurns((cur) => cur.filter((t) => t.question !== question)); // 낙관적 turn 제거(영속본으로 대체)
    } catch (e) {
      const message = e instanceof Error ? e.message : "일시적으로 답변에 실패했습니다.";
      setAiTurns((cur) => cur.map((t, i) => (i === cur.length - 1 ? { ...t, error: message } : t)));
    } finally {
      setAiLoading(false);
    }
```

- [ ] **Step 3: work-ai-body 렌더 — 히스토리(마크다운) + 진행중 turn(로딩 닷)**

`work-ai-body`의 turn 렌더 부분을 아래로 교체(오늘 브리핑·빠른질문 유지):
```tsx
                  {aiHistory.map((m) => (
                    <div className={`work-ai-message ${m.role}`} key={m.id}>
                      {m.role === "assistant" ? <MarkdownMessage content={m.content} /> : <p>{m.content}</p>}
                      {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                        <ul className="work-ai-sources">
                          {m.sources.map((s, j) => <li key={j}>{s.customerName} · {s.snippet}</li>)}
                        </ul>
                      )}
                    </div>
                  ))}
                  {aiTurns.map((turn, i) => (
                    <div key={`t${i}`}>
                      <div className="work-ai-message user"><p>{turn.question}</p></div>
                      <div className="work-ai-message assistant">
                        {turn.error ? <p className="work-ai-error">{turn.error}</p> : <DoubleBounceDots />}
                      </div>
                    </div>
                  ))}
```
(성공 시 turn은 제거되고 aiHistory로 확정되므로, aiTurns는 "진행중(로딩)" 또는 "에러"만 표시.)

- [ ] **Step 4: 마크다운 스타일(앱 스케일) 추가**

`client/src/index.css` 끝에 추가:
```css
.work-ai-message.assistant .md-body { font-size: 14px; line-height: 1.58; color: #2b2f36; }
.work-ai-message.assistant .md-body h1 { font-size: 17px; font-weight: 700; margin: 10px 0 4px; }
.work-ai-message.assistant .md-body h2 { font-size: 16px; font-weight: 700; margin: 10px 0 4px; }
.work-ai-message.assistant .md-body h3 { font-size: 14.5px; font-weight: 700; margin: 8px 0 4px; }
.work-ai-message.assistant .md-body ul { padding-left: 18px; list-style: none; }
.work-ai-message.assistant .md-body ul li::before { content: "• "; color: var(--brand); }
.work-ai-message.assistant .md-body ol { padding-left: 20px; }
.work-ai-message.assistant .md-body p { margin: 4px 0; }
.work-ai-message.assistant .md-body strong { font-weight: 600; }
```

- [ ] **Step 5: typecheck + lint**

Run: `bun run typecheck` (0), `bun run lint` (0). (기존 `aiTurns` 타입/미사용 정리 — 성공 분기 변경으로 unused 없도록.)

- [ ] **Step 6: 커밋**

```bash
git add client/src/components/Topbar.tsx client/src/index.css
git commit -m "feat(assistant): Topbar 대화 영속·마크다운 렌더·더블바운스 로딩 연결

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: 통합 스모크 + 검증 + PR

**Files:** (없음 — 실행/검증만)

- [ ] **Step 1: 전체 테스트 + 빌드**

Run: `bun run test:server` (전부 pass) · `bun run test:unit` (전부 pass) · `bun run typecheck` (0) · `bun run lint` (0) · `bun run build` (성공)

- [ ] **Step 2: DB 확인 (대화 저장되는지)**

`bun dev` 재시작(백엔드 반영) 후 staff/admin 로그인 → 업무 AI에서 질문 2~3개(후속질문 포함) → 아래로 저장 확인:
```bash
source .env.local; psql "$DATABASE_URL" -c "SELECT role, left(content,30), created_at FROM crm.assistant_messages ORDER BY created_at DESC LIMIT 6;"
```
Expected: user/assistant 쌍이 저장됨.

- [ ] **Step 3: 브라우저 스모크**

(a) 대화 후 **새로고침** → 히스토리 유지, (b) **후속질문**이 이전 맥락 반영("그 고객 연락처는?" 등), (c) 마크다운(헤딩·불릿·볼드) 정상 렌더, (d) 로딩 시 더블바운스 닷 표시.

- [ ] **Step 4: PR 생성**

```bash
git push -u origin feat/crm-work-ai-chat-persist
gh pr create --base main --title "feat(crm): 업무 AI 채팅 대화 영속+멀티턴+앱 UI (슬라이스 C1)" --body "설계 ref/specs/2026-07-02-crm-work-ai-chat-persist-design.md, 플랜 ref/plans/2026-07-02-crm-work-ai-chat-persist.md. crm.assistant_messages 영속+최근10턴 멀티턴+react-markdown 렌더+더블바운스 로딩. SSE 스트리밍은 후속."
```

---

## 후속 슬라이스 (이 PR 이후)
1. SSE 스트리밍 + 타자기 페이싱 + 송신/중지 토글(앱 완전 동일 연출).
2. 히스토리 커서 페이지네이션, related_questions 칩·a2ui 카드.
3. 대화 초기화/삭제, RAG 유사도 임계값·자동 재임베딩.

## Self-Review 노트 (작성자 확인)
- **Spec 커버리지**: 스키마(T1)·저장/로드 쿼리(T2)·멀티턴(T3·T5)·평문지시 제거(T4)·엔드포인트 영속+GET(T5)·프론트 lib(T6)·마크다운(T7)·로딩(T8)·Topbar 통합(T9)·검증(T10) — spec 전 항목 대응.
- **Placeholder**: 코드 스텝 전부 실제 코드. (T9 Topbar는 앵커 기반 편집 — B1 T11과 동일 방식, 실제 상태명 확인 지시 포함.)
- **타입 일관성**: `NewAssistantMessage`(T2, createdAt 포함)=엔드포인트(T5) 사용, `ChatTurn`(T3)=generateAnswer 시그니처, `AssistantMessage`(T6)=Topbar(T9) 소비, `assistantDeps`에 6개 함수(T5)=테스트 주입. generateAnswer 새 시그니처 `(system,user,apiKey,history,fetchImpl)`로 T3에서 기존 테스트 갱신.
- **구현 시 실측**: ①`bun add` 설치 위치(root vs client) ②`@testing-library/react` devDep 존재 여부(없으면 추가) ③Topbar 팝오버 상태명(`workAiOpen`) 실제 확인 ④멀티턴 contents(assistant→model) 실 Gemini 스모크(T10).
