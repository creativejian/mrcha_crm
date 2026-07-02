# 업무 AI 채팅 (슬라이스 B1 RAG) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Topbar 업무 AI를 mock에서 실제 RAG로 — 고객 맥락 텍스트를 pgvector로 임베딩·검색해 Gemini가 근거 있는 답변을 주는 단일샷 채팅.

**Architecture:** `crm.embeddings`(pgvector 3072) 테이블 + 수동 백필 스크립트로 코퍼스 임베딩. `POST /api/assistant/ask`(기존 Hono 백엔드, staff JWT)가 질문 임베딩→top-k 검색(scope 필터 seam)→Gemini 생성→`{answer, sources}` 반환. Topbar 전송버튼이 이를 호출해 렌더.

**Tech Stack:** Hono + drizzle(postgres-js) + pgvector 0.8.0, Gemini REST(`gemini-embedding-001` 3072 / `gemini-3.1-flash-lite`), React(Topbar). 백엔드 테스트 `bun:test`(`bun run test:server`), 프론트 테스트 `vitest`(`bun run test:unit`).

**전제(구현 착수 전 1회 확인):** `.env.local`에 `GEMINI_API_KEY`와 `DATABASE_URL`(master)이 있어야 백필·백엔드·테스트가 Gemini/DB에 접근한다. crm-analyst용 GEMINI 키를 그대로 `.env.local`에 추가. CF 프로덕션은 별도 슬라이스(배포)에서 CF Pages env로 주입.

---

### Task 1: `crm.embeddings` 스키마 + 마이그레이션

**Files:**
- Modify: `src/db/schema.ts` (customType `vector` + `embeddings` 테이블 추가)
- Create(generated): `drizzle/00NN_*.sql` (db:generate 산출물, HNSW 인덱스 raw SQL 수동 추가)

- [ ] **Step 1: schema.ts에 vector customType + embeddings 테이블 추가**

`src/db/schema.ts` 상단 import에 `customType`, `unique`를 추가:

```ts
import {
  pgSchema, uuid, text, timestamp, boolean, integer, numeric, jsonb,
  smallint, bigint, date, check, customType, unique, type AnyPgColumn,
} from "drizzle-orm/pg-core";
```

파일 하단(마지막 테이블 뒤)에 추가:

```ts
// pgvector 3072차원. gemini-embedding-001 네이티브. 앱 관례(public.*.embedding vector(3072))와 동일.
// toDriver: number[] → '[a,b,c]' 문자열(pgvector 입력 포맷). fromDriver: 그 역.
const vector3072 = customType<{ data: number[]; driverData: string }>({
  dataType() { return "vector(3072)"; },
  toDriver(value) { return `[${value.join(",")}]`; },
  fromDriver(value) { return JSON.parse(value) as number[]; },
});

// RAG 코퍼스 임베딩 스토어. 청크 1행 = 메모/할일/니즈메모/상담이력 하나.
export const embeddings = crm.table("embeddings", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceType: text("source_type").notNull(), // memo|task|need_memo|need_customer_note|need_review_note|consultation
  sourceId: uuid("source_id").notNull(),      // 원본 행 id (need_*는 customer_id)
  customerId: uuid("customer_id").notNull(),  // scope 필터·고객 메타 조인
  content: text("content").notNull(),         // 임베딩한 원문 스냅샷(경량 컨텍스트 포함)
  contentHash: text("content_hash").notNull(),// 변경 없으면 재임베딩 skip
  embedding: vector3072("embedding").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("embeddings_source_uq").on(t.sourceType, t.sourceId),
  check("embeddings_source_type_check", inListCheck(t.sourceType,
    ["memo", "task", "need_memo", "need_customer_note", "need_review_note", "consultation"])),
]);
```

- [ ] **Step 2: 마이그레이션 생성**

Run: `bun run db:generate`
Expected: `drizzle/00NN_*.sql` 생성, 출력에 `embeddings` 테이블 CREATE 포함. (customType이 `embedding vector(3072)`로 emit됨.)

- [ ] **Step 3: 생성된 마이그에 HNSW(halfvec) 인덱스 수동 추가**

방금 생성된 `drizzle/00NN_*.sql` 파일 **끝에** 아래 줄을 추가(drizzle는 halfvec 캐스팅 인덱스를 표현 못 하므로 raw SQL로 박음. 앱의 `idx_insights_embedding`과 동일 패턴):

```sql
CREATE INDEX IF NOT EXISTS "embeddings_hnsw_idx" ON "crm"."embeddings" USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);
```

- [ ] **Step 4: 마이그레이션 적용**

Run: `bun run db:migrate`
Expected: `migrations applied successfully!` (NOTICE "already exists"는 무해)

- [ ] **Step 5: DB에서 컬럼·인덱스 확인**

Run:
```bash
source .env.local; psql "$DATABASE_URL" -c "\d crm.embeddings"
```
Expected: `embedding | vector(3072)`, `embeddings_source_uq` unique, `embeddings_hnsw_idx` hnsw 인덱스 표시.

- [ ] **Step 6: typecheck + 커밋**

Run: `bun run typecheck`
Expected: 통과(에러 없음)

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(crm): crm.embeddings 테이블(pgvector 3072 + halfvec HNSW)"
```

---

### Task 2: Gemini 에러 분류 + 임베딩 클라이언트 (백엔드 lib)

**Files:**
- Create: `src/lib/gemini-error.ts`
- Create: `src/lib/gemini-embed.ts`
- Test: `src/lib/gemini-embed.test.ts`

- [ ] **Step 1: 에러 분류 lib (crm-analyst gemini.ts에서 순수 분류만 복제)**

`src/lib/gemini-error.ts`:

```ts
export type GeminiErrorCode = "credits_depleted" | "rate_limited" | "unavailable" | "generic";

export function classifyGeminiError(status: number | undefined, bodyText: string): GeminiErrorCode {
  const t = bodyText.toLowerCase();
  if (status === 429 || t.includes("resource_exhausted") || t.includes("429")) {
    if (/credit|deplet|prepay|billing|balance|payment/.test(t)) return "credits_depleted";
    return "rate_limited";
  }
  if (status === 503 || t.includes("unavailable") || t.includes("overloaded") || t.includes("high demand")) {
    return "unavailable";
  }
  return "generic";
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/gemini-embed.test.ts`:

```ts
import { test, expect } from "bun:test";

import { embedTexts, EMBEDDING_MODEL } from "./gemini-embed";

test("embedTexts: batchEmbedContents 요청 본문 + 응답 파싱", async () => {
  let captured: { url: string; body: unknown } | null = null;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const out = await embedTexts(["a", "b"], "KEY", "RETRIEVAL_DOCUMENT", fakeFetch);

  expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  expect(captured!.url).toContain(`${EMBEDDING_MODEL}:batchEmbedContents`);
  expect(captured!.url).toContain("key=KEY");
  const body = captured!.body as { requests: { model: string; content: { parts: { text: string }[] }; taskType: string }[] };
  expect(body.requests).toHaveLength(2);
  expect(body.requests[0].content.parts[0].text).toBe("a");
  expect(body.requests[0].taskType).toBe("RETRIEVAL_DOCUMENT");
});

test("embedTexts: 빈 배열은 API 호출 없이 []", async () => {
  const out = await embedTexts([], "KEY", "RETRIEVAL_QUERY", (() => { throw new Error("호출되면 안 됨"); }) as unknown as typeof fetch);
  expect(out).toEqual([]);
});

test("embedTexts: 실패 응답은 throw", async () => {
  const fakeFetch = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
  await expect(embedTexts(["a"], "KEY", "RETRIEVAL_QUERY", fakeFetch)).rejects.toThrow();
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `bun test src/lib/gemini-embed.test.ts --env-file=.env.local`
Expected: FAIL ("Cannot find module './gemini-embed'")

- [ ] **Step 4: 구현**

`src/lib/gemini-embed.ts`:

```ts
import { classifyGeminiError } from "./gemini-error";

export const EMBEDDING_MODEL = "gemini-embedding-001"; // 앱 관례(3072 네이티브). output_dimensionality 미지정.
export type EmbedTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

// texts 각각을 3072차원 벡터로. 실패(재시도 후에도)는 throw. 빈 입력은 호출 없이 [].
export async function embedTexts(
  texts: string[],
  apiKey: string,
  taskType: EmbedTaskType,
  fetchImpl: typeof fetch = fetch,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${apiKey}`;
  const body = JSON.stringify({
    requests: texts.map((text) => ({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
    })),
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok) {
      const data = (await res.json()) as { embeddings?: { values?: number[] }[] };
      const vecs = data.embeddings?.map((e) => e.values);
      if (!vecs || vecs.some((v) => !Array.isArray(v))) throw new Error("Gemini 임베딩 응답 파싱 실패");
      return vecs as number[][];
    }
    const bodyText = await res.text();
    const code = classifyGeminiError(res.status, bodyText);
    console.error(`[assistant] Gemini embed ${code} status=${res.status}`);
    if (attempt === 0 && (code === "rate_limited" || code === "unavailable")) continue;
    throw new Error(`Gemini 임베딩 실패: ${code}`);
  }
  throw new Error("Gemini 임베딩 실패");
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `bun test src/lib/gemini-embed.test.ts --env-file=.env.local`
Expected: PASS (3 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/gemini-error.ts src/lib/gemini-embed.ts src/lib/gemini-embed.test.ts
git commit -m "feat(assistant): Gemini 임베딩 클라이언트 + 에러 분류"
```

---

### Task 3: 코퍼스 content 빌더 + 해시 (순수)

**Files:**
- Create: `src/lib/assistant-corpus.ts`
- Test: `src/lib/assistant-corpus.test.ts`

- [ ] **Step 1: 실패하는 테스트**

`src/lib/assistant-corpus.test.ts`:

```ts
import { test, expect } from "bun:test";

import { buildChunkContent, contentHash, type CorpusRow } from "./assistant-corpus";

test("buildChunkContent: 소스타입별 라벨 + 고객명 + 본문", () => {
  const row: CorpusRow = { sourceType: "memo", sourceId: "s1", customerId: "c1", customerName: "김민준", text: "GLC 재고 문의" };
  expect(buildChunkContent(row)).toBe("고객 김민준 상담메모: GLC 재고 문의");
});

test("buildChunkContent: need_review_note 라벨", () => {
  const row: CorpusRow = { sourceType: "need_review_note", sourceId: "c1", customerId: "c1", customerName: "박서연", text: "보증금 30% 검토" };
  expect(buildChunkContent(row)).toBe("고객 박서연 심사메모: 보증금 30% 검토");
});

test("contentHash: 같은 문자열 같은 해시, 다르면 다름", () => {
  expect(contentHash("a")).toBe(contentHash("a"));
  expect(contentHash("a")).not.toBe(contentHash("b"));
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test src/lib/assistant-corpus.test.ts --env-file=.env.local`
Expected: FAIL ("Cannot find module './assistant-corpus'")

- [ ] **Step 3: 구현**

`src/lib/assistant-corpus.ts`:

```ts
import { createHash } from "node:crypto";

export type CorpusSourceType = "memo" | "task" | "need_memo" | "need_customer_note" | "need_review_note" | "consultation";

export type CorpusRow = {
  sourceType: CorpusSourceType;
  sourceId: string;
  customerId: string;
  customerName: string;
  text: string;
};

const LABEL: Record<CorpusSourceType, string> = {
  memo: "상담메모",
  task: "할일",
  need_memo: "니즈메모",
  need_customer_note: "고객노트",
  need_review_note: "심사메모",
  consultation: "상담이력",
};

// 임베딩할 content 문자열. 고객명·소스라벨을 앞에 붙여 검색·생성 컨텍스트를 풍부하게 한다.
export function buildChunkContent(row: CorpusRow): string {
  return `고객 ${row.customerName} ${LABEL[row.sourceType]}: ${row.text}`;
}

// content 스냅샷 해시(재임베딩 skip 판단용).
export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun test src/lib/assistant-corpus.test.ts --env-file=.env.local`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/assistant-corpus.ts src/lib/assistant-corpus.test.ts
git commit -m "feat(assistant): 코퍼스 content 빌더 + 해시"
```

---

### Task 4: 스코프 resolver seam (순수)

**Files:**
- Create: `src/lib/assistant-scope.ts`
- Test: `src/lib/assistant-scope.test.ts`

- [ ] **Step 1: 실패하는 테스트**

`src/lib/assistant-scope.test.ts`:

```ts
import { test, expect } from "bun:test";

import { resolveCustomerScope } from "./assistant-scope";

test("v1: 모든 CRM 역할은 전체 코퍼스(all)", () => {
  expect(resolveCustomerScope({ id: "u1", role: "admin" })).toBe("all");
  expect(resolveCustomerScope({ id: "u2", role: "manager" })).toBe("all");
  expect(resolveCustomerScope({ id: "u3", role: "staff" })).toBe("all");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test src/lib/assistant-scope.test.ts --env-file=.env.local`
Expected: FAIL ("Cannot find module './assistant-scope'")

- [ ] **Step 3: 구현**

`src/lib/assistant-scope.ts`:

```ts
import type { AuthedUser } from "../auth/verify";

// 사용자가 볼 수 있는 고객 범위. "all" = 전체 코퍼스, string[] = 허용 customer_id 목록.
// v1: 전부 "all"(admin 수준). manager(자기 팀)·staff(본인) per-팀 필터는 후속 crm.staff/팀
// 파운데이션 슬라이스가 이 함수 본문만 교체한다(호출부 불변). 설계: ref/specs/2026-07-02-crm-work-ai-chat-design.md
export function resolveCustomerScope(_user: AuthedUser): "all" | string[] {
  return "all";
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun test src/lib/assistant-scope.test.ts --env-file=.env.local`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/assistant-scope.ts src/lib/assistant-scope.test.ts
git commit -m "feat(assistant): 고객 scope resolver seam (v1=all)"
```

---

### Task 5: 임베딩 upsert + 검색 쿼리

**Files:**
- Create: `src/db/queries/embeddings.ts`
- Test: `src/db/queries/embeddings.test.ts`

- [ ] **Step 1: 실패하는 테스트 (실 DB — upsert 멱등 + scope 필터 검색)**

`src/db/queries/embeddings.test.ts` (백엔드 테스트는 `--env-file=.env.local`로 실 master DB에 붙는다. 테스트용 임의 customer_id로 넣고 지운다):

```ts
import { test, expect, afterAll } from "bun:test";

import { getDefaultDb } from "../client";
import { embeddings } from "../schema";
import { eq } from "drizzle-orm";
import { upsertEmbedding, searchEmbeddings } from "./embeddings";

const db = getDefaultDb();
const CUST = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const vec = (seed: number) => Array.from({ length: 3072 }, (_, i) => (i === 0 ? seed : 0.001));

afterAll(async () => { await db.delete(embeddings).where(eq(embeddings.customerId, CUST)); });

test("upsertEmbedding: 삽입 후 동일 (source_type,source_id) 재upsert=갱신(중복 없음)", async () => {
  await upsertEmbedding({ sourceType: "memo", sourceId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", customerId: CUST, content: "첫 내용", contentHash: "h1", embedding: vec(0.9) }, db);
  await upsertEmbedding({ sourceType: "memo", sourceId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", customerId: CUST, content: "수정 내용", contentHash: "h2", embedding: vec(0.9) }, db);
  const rows = await db.select().from(embeddings).where(eq(embeddings.customerId, CUST));
  expect(rows).toHaveLength(1);
  expect(rows[0].content).toBe("수정 내용");
});

test("searchEmbeddings: scope=all 이면 유사도순 top-k", async () => {
  const res = await searchEmbeddings(vec(0.9), "all", 5, db);
  expect(res.some((r) => r.customerId === CUST)).toBe(true);
  expect(typeof res[0].similarity).toBe("number");
});

test("searchEmbeddings: scope=빈 배열이면 결과 없음", async () => {
  const res = await searchEmbeddings(vec(0.9), [], 5, db);
  expect(res).toHaveLength(0);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test src/db/queries/embeddings.test.ts --env-file=.env.local`
Expected: FAIL ("Cannot find module './embeddings'")

- [ ] **Step 3: 구현**

`src/db/queries/embeddings.ts`:

```ts
import { sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { embeddings } from "../schema";

export type UpsertEmbeddingInput = {
  sourceType: string;
  sourceId: string;
  customerId: string;
  content: string;
  contentHash: string;
  embedding: number[];
};

// (source_type, source_id) 유니크 기준 upsert. 재백필 멱등.
export async function upsertEmbedding(input: UpsertEmbeddingInput, executor: Executor = getDefaultDb()): Promise<void> {
  await executor
    .insert(embeddings)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [embeddings.sourceType, embeddings.sourceId],
      set: { content: input.content, contentHash: input.contentHash, embedding: input.embedding, customerId: input.customerId, updatedAt: new Date() },
    });
}

export type SearchHit = {
  id: string;
  sourceType: string;
  sourceId: string;
  customerId: string;
  content: string;
  similarity: number;
};

// 질문 벡터로 top-k 코사인 검색. scope="all"=전체, string[]=허용 customer_id(빈 배열=결과 없음).
// halfvec 캐스팅으로 HNSW 인덱스를 태운다(앱 관례와 동일). 코사인 유사도 = 1 - 거리.
export async function searchEmbeddings(
  queryVec: number[],
  scope: "all" | string[],
  k: number,
  executor: Executor = getDefaultDb(),
): Promise<SearchHit[]> {
  if (Array.isArray(scope) && scope.length === 0) return [];
  const vecLiteral = `[${queryVec.join(",")}]`;
  const scopeFilter =
    scope === "all" ? sql`` : sql`where customer_id = any(${sql`array[${sql.join(scope.map((id) => sql`${id}::uuid`), sql`, `)}]`})`;
  const rows = await executor.execute<SearchHit>(sql`
    select id, source_type as "sourceType", source_id as "sourceId", customer_id as "customerId", content,
           1 - (embedding::halfvec(3072) <=> ${vecLiteral}::halfvec(3072)) as similarity
    from crm.embeddings
    ${scopeFilter}
    order by embedding::halfvec(3072) <=> ${vecLiteral}::halfvec(3072)
    limit ${k}
  `);
  return rows as unknown as SearchHit[];
}
```

> 참고: `executor.execute<T>(sql\`...\`)`는 postgres-js drizzle에서 raw 결과 배열을 반환한다. 반환 형태가 드라이버 버전에 따라 `{ rows }` 래핑일 수 있으니 Step 5에서 실제 형태를 확인하고 필요 시 `.rows`로 조정한다(구현 시 실측 — 레포 관례).

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun test src/db/queries/embeddings.test.ts --env-file=.env.local`
Expected: PASS (3 tests). 실패 시 execute 반환 형태(`rows` 래핑)만 조정.

- [ ] **Step 5: 커밋**

```bash
git add src/db/queries/embeddings.ts src/db/queries/embeddings.test.ts
git commit -m "feat(assistant): 임베딩 upsert + pgvector top-k 검색"
```

---

### Task 6: 컨텍스트/프롬프트 조립기 (순수)

**Files:**
- Create: `src/lib/assistant-prompt.ts`
- Test: `src/lib/assistant-prompt.test.ts`

- [ ] **Step 1: 실패하는 테스트**

`src/lib/assistant-prompt.test.ts`:

```ts
import { test, expect } from "bun:test";

import { buildContextBlock, buildUserPrompt, SYSTEM_PROMPT, type PromptChunk } from "./assistant-prompt";

const chunks: PromptChunk[] = [
  { customerName: "김민준", content: "고객 김민준 상담메모: GLC 재고 문의", customerStatus: "견적·발송완료" },
  { customerName: "박서연", content: "고객 박서연 니즈메모: 보증금 조건별 견적", customerStatus: "상담중" },
];

test("buildContextBlock: 번호 매긴 근거 목록", () => {
  const block = buildContextBlock(chunks);
  expect(block).toContain("[1] (김민준 · 견적·발송완료) 고객 김민준 상담메모: GLC 재고 문의");
  expect(block).toContain("[2] (박서연 · 상담중) 고객 박서연 니즈메모: 보증금 조건별 견적");
});

test("buildUserPrompt: 질문 + 근거 블록 포함", () => {
  const p = buildUserPrompt("계약 가능성 높은 고객은?", buildContextBlock(chunks));
  expect(p).toContain("계약 가능성 높은 고객은?");
  expect(p).toContain("[1]");
});

test("SYSTEM_PROMPT: 근거 기반·모르면 모른다 지침 포함", () => {
  expect(SYSTEM_PROMPT).toContain("근거");
  expect(SYSTEM_PROMPT).toContain("찾지 못");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test src/lib/assistant-prompt.test.ts --env-file=.env.local`
Expected: FAIL ("Cannot find module './assistant-prompt'")

- [ ] **Step 3: 구현**

`src/lib/assistant-prompt.ts`:

```ts
export type PromptChunk = { customerName: string; customerStatus: string; content: string };

export const SYSTEM_PROMPT = [
  "당신은 자동차 CRM 상담사를 돕는 한국어 업무 어시스턴트입니다.",
  "아래에 제공된 근거(고객 메모·상담이력·니즈)만 사용해 답하세요. 근거에 없는 내용은 추측하지 마세요.",
  "답변은 간결한 한국어로, 관련 고객과 근거를 함께 제시하세요.",
  "관련 근거가 없으면 '관련 CRM 데이터를 찾지 못했습니다'라고만 답하세요.",
].join("\n");

// 검색된 청크를 번호 매긴 근거 블록으로.
export function buildContextBlock(chunks: PromptChunk[]): string {
  return chunks
    .map((c, i) => `[${i + 1}] (${c.customerName} · ${c.customerStatus}) ${c.content}`)
    .join("\n");
}

// 최종 사용자 프롬프트(근거 + 질문).
export function buildUserPrompt(question: string, contextBlock: string): string {
  return `# 근거\n${contextBlock || "(관련 근거 없음)"}\n\n# 질문\n${question}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun test src/lib/assistant-prompt.test.ts --env-file=.env.local`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/assistant-prompt.ts src/lib/assistant-prompt.test.ts
git commit -m "feat(assistant): 컨텍스트/프롬프트 조립기"
```

---

### Task 7: Gemini 생성 클라이언트 (백엔드 lib)

**Files:**
- Create: `src/lib/gemini-generate.ts`
- Test: `src/lib/gemini-generate.test.ts`

- [ ] **Step 1: 실패하는 테스트**

`src/lib/gemini-generate.test.ts`:

```ts
import { test, expect } from "bun:test";

import { generateAnswer, GEN_MODEL } from "./gemini-generate";

test("generateAnswer: system+user 프롬프트 전송, 텍스트 파싱", async () => {
  let captured: { url: string; body: { systemInstruction?: unknown; contents: { parts: { text: string }[] }[] } } | null = null;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "답변입니다" }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const out = await generateAnswer("SYS", "USER", "KEY", fakeFetch);

  expect(out).toBe("답변입니다");
  expect(captured!.url).toContain(`${GEN_MODEL}:generateContent`);
  expect(captured!.body.contents[0].parts[0].text).toBe("USER");
});

test("generateAnswer: 실패 응답은 throw", async () => {
  const fakeFetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  await expect(generateAnswer("s", "u", "KEY", fakeFetch)).rejects.toThrow();
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test src/lib/gemini-generate.test.ts --env-file=.env.local`
Expected: FAIL ("Cannot find module './gemini-generate'")

- [ ] **Step 3: 구현**

`src/lib/gemini-generate.ts`:

```ts
import { classifyGeminiError } from "./gemini-error";

export const GEN_MODEL = "gemini-3.1-flash-lite"; // 앱/crm-analyst 동일.

// 근거+질문으로 한국어 답변 생성. 실패(재시도 후에도)는 throw.
export async function generateAnswer(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEN_MODEL}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
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

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun test src/lib/gemini-generate.test.ts --env-file=.env.local`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/gemini-generate.ts src/lib/gemini-generate.test.ts
git commit -m "feat(assistant): Gemini 생성 클라이언트"
```

---

### Task 8: `POST /api/assistant/ask` 엔드포인트 + app.ts 배선

**Files:**
- Create: `src/routes/assistant.ts`
- Modify: `src/app.ts` (auth+db 미들웨어 + route 마운트)
- Test: `src/routes/assistant.test.ts`

- [ ] **Step 1: 실패하는 테스트 (gemini/검색 mock + 실 DB 인증)**

`src/routes/assistant.test.ts`:

```ts
import { mock } from "bun:test";

mock.module("../lib/gemini-embed", () => ({
  EMBEDDING_MODEL: "gemini-embedding-001",
  embedTexts: async (texts: string[]) => texts.map(() => Array.from({ length: 3072 }, () => 0.01)),
}));
mock.module("../lib/gemini-generate", () => ({
  GEN_MODEL: "gemini-3.1-flash-lite",
  generateAnswer: async () => "테스트 답변",
}));
mock.module("../db/queries/embeddings", () => ({
  searchEmbeddings: async () => [
    { id: "e1", sourceType: "memo", sourceId: "s1", customerId: "c1", content: "고객 김민준 상담메모: GLC", similarity: 0.9 },
  ],
}));

import { test, expect } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";

test("POST /api/assistant/ask 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "누가 급해?" }) });
  expect(res.status).toBe(401);
});

test("POST /api/assistant/ask → 200 {answer, sources}", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ question: "계약 가능성 높은 고객은?" }),
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { answer: string; sources: unknown[] };
  expect(json.answer).toBe("테스트 답변");
  expect(json.sources.length).toBe(1);
});

test("POST /api/assistant/ask 빈 질문 → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/assistant/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ question: "  " }),
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test src/routes/assistant.test.ts --env-file=.env.local`
Expected: FAIL ("Cannot find module '../routes/assistant'" 또는 404)

- [ ] **Step 3: 라우트 구현**

`src/routes/assistant.ts`:

```ts
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

const TOP_K = 8;
const askSchema = z.object({ question: z.string() });

assistant.post("/ask", zValidator("json", askSchema), async (c) => {
  const question = c.req.valid("json").question.trim();
  if (!question) return c.json({ error: "질문을 입력하세요." }, 400);

  const apiKey = (c.env as { GEMINI_API_KEY?: string } | undefined)?.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return c.json({ error: "서버 설정 오류입니다. 관리자에게 문의하세요." }, 500);

  const scope = resolveCustomerScope(c.var.user);
  const [queryVec] = await embedTexts([question], apiKey, "RETRIEVAL_QUERY");
  const hits = await searchEmbeddings(queryVec, scope, TOP_K, c.var.db);
  if (hits.length === 0) return c.json({ answer: "관련 CRM 데이터를 찾지 못했습니다.", sources: [] });

  // 고객 메타(이름/상태) 조회 후 근거 블록 조립.
  const metaById = await getCustomerMetaByIds([...new Set(hits.map((h) => h.customerId))], c.var.db);
  const promptChunks = hits.map((h) => ({
    customerName: metaById.get(h.customerId)?.name ?? "고객",
    customerStatus: metaById.get(h.customerId)?.status ?? "",
    content: h.content,
  }));
  const answer = await generateAnswer(SYSTEM_PROMPT, buildUserPrompt(question, buildContextBlock(promptChunks)), apiKey);

  const sources = hits.map((h) => ({
    customerId: h.customerId,
    customerName: metaById.get(h.customerId)?.name ?? "고객",
    sourceType: h.sourceType,
    snippet: h.content.slice(0, 120),
  }));
  return c.json({ answer, sources });
});
```

- [ ] **Step 4: 고객 메타 조회 헬퍼 구현**

`src/db/queries/embeddings-meta.ts`:

```ts
import { inArray } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { customers } from "../schema";

export type CustomerMeta = { name: string; status: string };

// 근거 고객들의 이름/상태(그룹·2차) 배치 조회. 빈 입력은 빈 맵.
export async function getCustomerMetaByIds(ids: string[], executor: Executor = getDefaultDb()): Promise<Map<string, CustomerMeta>> {
  if (ids.length === 0) return new Map();
  const rows = await executor
    .select({ id: customers.id, name: customers.name, statusGroup: customers.statusGroup, status: customers.status })
    .from(customers)
    .where(inArray(customers.id, ids));
  const map = new Map<string, CustomerMeta>();
  for (const r of rows) {
    const status = [r.statusGroup, r.status].filter(Boolean).join("·");
    map.set(r.id, { name: r.name, status });
  }
  return map;
}
```

- [ ] **Step 5: app.ts에 배선**

`src/app.ts` import 블록에 추가:

```ts
import { assistant } from "./routes/assistant";
```

`app.use("/api/quote-requests/*", dbMiddleware);` 줄 **다음**에 추가:

```ts
  app.use("/api/assistant/*", auth);
  app.use("/api/assistant/*", dbMiddleware);
```

`app.route("/api/quote-requests", quoteRequests);` 줄 **다음**에 추가:

```ts
  app.route("/api/assistant", assistant);
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `bun test src/routes/assistant.test.ts --env-file=.env.local`
Expected: PASS (3 tests)

- [ ] **Step 7: typecheck + 커밋**

Run: `bun run typecheck`
Expected: 통과

```bash
git add src/routes/assistant.ts src/db/queries/embeddings-meta.ts src/app.ts src/routes/assistant.test.ts
git commit -m "feat(assistant): POST /api/assistant/ask 엔드포인트 (검색+생성)"
```

---

### Task 9: 백필 스크립트

**Files:**
- Create: `src/scripts/backfill-embeddings.ts`

- [ ] **Step 1: 스크립트 구현 (TDD 비대상 — 순수 로직은 Task 3/5에서 이미 커버, 여기선 조립+실행)**

`src/scripts/backfill-embeddings.ts`:

```ts
// 코퍼스(상담메모·상담이력·니즈메모·할일)를 임베딩해 crm.embeddings에 upsert하는 일회성 스크립트.
// 실행: bun run src/scripts/backfill-embeddings.ts  (.env.local의 GEMINI_API_KEY·DATABASE_URL 사용)
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";

import { getDefaultDb } from "../db/client";
import { customers, customerMemos, customerTasks, consultations } from "../db/schema";
import { upsertEmbedding } from "../db/queries/embeddings";
import { buildChunkContent, contentHash, type CorpusRow } from "../lib/assistant-corpus";
import { embedTexts } from "../lib/gemini-embed";

const db = getDefaultDb();
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY is not set (.env.local)");

const nonEmpty = (col: Parameters<typeof isNotNull>[0]) => and(isNotNull(col), ne(sql`btrim(${col})`, ""));

async function gather(): Promise<CorpusRow[]> {
  const rows: CorpusRow[] = [];

  const memos = await db
    .select({ id: customerMemos.id, customerId: customerMemos.customerId, name: customers.name, text: customerMemos.body })
    .from(customerMemos).innerJoin(customers, eq(customers.id, customerMemos.customerId))
    .where(nonEmpty(customerMemos.body));
  for (const m of memos) rows.push({ sourceType: "memo", sourceId: m.id, customerId: m.customerId, customerName: m.name, text: m.text! });

  const tasks = await db
    .select({ id: customerTasks.id, customerId: customerTasks.customerId, name: customers.name, text: customerTasks.body })
    .from(customerTasks).innerJoin(customers, eq(customers.id, customerTasks.customerId))
    .where(nonEmpty(customerTasks.body));
  for (const t of tasks) rows.push({ sourceType: "task", sourceId: t.id, customerId: t.customerId, customerName: t.name, text: t.text! });

  const consults = await db
    .select({ id: consultations.id, customerId: consultations.customerId, name: customers.name, text: consultations.summary })
    .from(consultations).innerJoin(customers, eq(customers.id, consultations.customerId))
    .where(nonEmpty(consultations.summary));
  for (const s of consults) rows.push({ sourceType: "consultation", sourceId: s.id, customerId: s.customerId, customerName: s.name, text: s.text! });

  // 니즈 3필드(customers 인라인): source_id = customer_id, source_type로 구분.
  const needs = await db
    .select({ id: customers.id, name: customers.name, needMemo: customers.needMemo, needCustomerNote: customers.needCustomerNote, needReviewNote: customers.needReviewNote })
    .from(customers);
  for (const n of needs) {
    if (n.needMemo?.trim()) rows.push({ sourceType: "need_memo", sourceId: n.id, customerId: n.id, customerName: n.name, text: n.needMemo });
    if (n.needCustomerNote?.trim()) rows.push({ sourceType: "need_customer_note", sourceId: n.id, customerId: n.id, customerName: n.name, text: n.needCustomerNote });
    if (n.needReviewNote?.trim()) rows.push({ sourceType: "need_review_note", sourceId: n.id, customerId: n.id, customerName: n.name, text: n.needReviewNote });
  }
  return rows;
}

async function main() {
  const rows = await gather();
  console.log(`코퍼스 ${rows.length}청크 수집`);
  const contents = rows.map(buildChunkContent);
  const vectors = await embedTexts(contents, apiKey!, "RETRIEVAL_DOCUMENT");
  let ok = 0;
  for (let i = 0; i < rows.length; i++) {
    try {
      await upsertEmbedding({
        sourceType: rows[i].sourceType, sourceId: rows[i].sourceId, customerId: rows[i].customerId,
        content: contents[i], contentHash: contentHash(contents[i]), embedding: vectors[i],
      }, db);
      ok++;
    } catch (e) { console.error(`upsert 실패 ${rows[i].sourceType}/${rows[i].sourceId}:`, e); }
  }
  console.log(`백필 완료: ${ok}/${rows.length} upsert`);
  process.exit(0);
}

void main();
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 통과

- [ ] **Step 3: 커밋**

```bash
git add src/scripts/backfill-embeddings.ts
git commit -m "feat(assistant): 코퍼스 임베딩 백필 스크립트"
```

---

### Task 10: 프론트 API 클라이언트

**Files:**
- Create: `client/src/lib/assistant.ts`
- Test: `client/src/lib/assistant.test.ts`

- [ ] **Step 1: 실패하는 테스트 (vitest — http.sendJson mock)**

`client/src/lib/assistant.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("./http", () => ({ sendJson: vi.fn(async () => ({ answer: "답", sources: [{ customerId: "c1", customerName: "김민준", sourceType: "memo", snippet: "…" }] })) }));

import { sendJson } from "./http";
import { askAssistant } from "./assistant";

describe("askAssistant", () => {
  it("POST /api/assistant/ask로 질문 전송, 응답 반환", async () => {
    const res = await askAssistant("계약 가능성 높은 고객은?");
    expect(sendJson).toHaveBeenCalledWith("/api/assistant/ask", "POST", { question: "계약 가능성 높은 고객은?" });
    expect(res.answer).toBe("답");
    expect(res.sources[0].customerName).toBe("김민준");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test:unit client/src/lib/assistant.test.ts`
Expected: FAIL ("Cannot find module './assistant'")

- [ ] **Step 3: 구현**

`client/src/lib/assistant.ts`:

```ts
import { sendJson } from "./http";

export type AssistantSource = { customerId: string; customerName: string; sourceType: string; snippet: string };
export type AssistantAnswer = { answer: string; sources: AssistantSource[] };

// 업무 AI 질문 → 근거 답변. 실패 시 http 헬퍼가 throw(서버 한글 메시지 우선).
export async function askAssistant(question: string): Promise<AssistantAnswer> {
  return sendJson<AssistantAnswer>("/api/assistant/ask", "POST", { question });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:unit client/src/lib/assistant.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/assistant.ts client/src/lib/assistant.test.ts
git commit -m "feat(assistant): 프론트 askAssistant 클라이언트"
```

---

### Task 11: Topbar UI 연결 (업무 AI 채팅)

**Files:**
- Modify: `client/src/components/Topbar.tsx` (work-ai-panel 상태 + 전송 핸들러 + 렌더)

- [ ] **Step 1: 채팅 상태 + 전송 핸들러 추가**

`client/src/components/Topbar.tsx` 상단 import에 추가:

```ts
import { askAssistant, type AssistantAnswer } from "@/lib/assistant";
```

`const [aiInput, setAiInput] = useState("");`(137줄 부근) **다음**에 추가:

```ts
  const [aiTurns, setAiTurns] = useState<{ question: string; answer: AssistantAnswer | null; error?: string }[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  async function submitAiQuestion() {
    const question = aiInput.trim();
    if (!question || aiLoading) return;
    setAiInput("");
    setAiTurns((cur) => [...cur, { question, answer: null }]);
    setAiLoading(true);
    try {
      const res = await askAssistant(question);
      setAiTurns((cur) => cur.map((t, i) => (i === cur.length - 1 ? { ...t, answer: res } : t)));
    } catch (e) {
      const message = e instanceof Error ? e.message : "일시적으로 답변에 실패했습니다.";
      setAiTurns((cur) => cur.map((t, i) => (i === cur.length - 1 ? { ...t, error: message } : t)));
    } finally {
      setAiLoading(false);
    }
  }
```

- [ ] **Step 2: work-ai-body 렌더를 실제 대화로 교체**

`client/src/components/Topbar.tsx`의 `<div className="work-ai-body">…</div>`(428~446줄) 내용을 아래로 교체. "오늘 브리핑"과 빠른질문 칩은 유지하고, mock user/assistant(441~445줄)를 실제 turns로 대체:

```tsx
                <div className="work-ai-body">
                  <div className="work-ai-message assistant">
                    <strong>오늘 브리핑</strong>
                    <p>궁금한 업무를 물어보면 CRM 데이터(메모·상담·니즈)를 근거로 답합니다.</p>
                  </div>
                  <div className="work-ai-quick">
                    <span>빠른 질문</span>
                    <div>
                      {quickAiPrompts.map((prompt) => (
                        <button className={selectedPrompt === prompt ? "active" : ""} key={prompt} onClick={() => { setSelectedPrompt(prompt); setAiInput(prompt); }} type="button">{prompt}</button>
                      ))}
                    </div>
                  </div>
                  {aiTurns.map((turn, i) => (
                    <div key={i}>
                      <div className="work-ai-message user"><p>{turn.question}</p></div>
                      <div className="work-ai-message assistant">
                        {turn.error ? <p className="work-ai-error">{turn.error}</p>
                          : turn.answer ? (
                            <>
                              <p>{turn.answer.answer}</p>
                              {turn.answer.sources.length > 0 && (
                                <ul className="work-ai-sources">
                                  {turn.answer.sources.map((s, j) => <li key={j}>{s.customerName} · {s.snippet}</li>)}
                                </ul>
                              )}
                            </>
                          ) : <p className="work-ai-thinking">생각 중…</p>}
                      </div>
                    </div>
                  ))}
                </div>
```

- [ ] **Step 3: compose(입력+전송) 동작 연결**

`<div className="work-ai-compose">…</div>`(447~450줄)를 교체:

```tsx
                <div className="work-ai-compose">
                  <input
                    value={aiInput}
                    onChange={(event) => setAiInput(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitAiQuestion(); } }}
                    placeholder="업무 AI에게 물어보기"
                  />
                  <button type="button" aria-label="보내기" disabled={aiLoading} onClick={() => void submitAiQuestion()}><Send size={16} /></button>
                </div>
```

- [ ] **Step 4: 최소 스타일 추가**

`client/src/index.css` 끝에 추가:

```css
.work-ai-error { color: #c0392b; }
.work-ai-thinking { color: #7f858c; }
.work-ai-sources { margin: 6px 0 0; padding-left: 16px; font-size: 11.5px; color: #5f6872; }
.work-ai-sources li { margin: 2px 0; }
```

- [ ] **Step 5: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 둘 다 통과(에러/경고 0 유지)

- [ ] **Step 6: 커밋**

```bash
git add client/src/components/Topbar.tsx client/src/index.css
git commit -m "feat(assistant): Topbar 업무 AI 채팅 실연결 (mock→실 RAG)"
```

---

### Task 12: 통합 스모크 + 전체 검증

**Files:** (없음 — 실행/검증만)

- [ ] **Step 1: 백필 실행**

Run: `bun run src/scripts/backfill-embeddings.ts`
Expected: "코퍼스 N청크 수집" → "백필 완료: N/N upsert" (N ≈ 30, 대부분 김민준 시드)

- [ ] **Step 2: DB에 임베딩 적재 확인**

Run:
```bash
source .env.local; psql "$DATABASE_URL" -c "SELECT source_type, count(*) FROM crm.embeddings GROUP BY 1 ORDER BY 2 DESC;"
```
Expected: memo/task/need_*/(consultation은 0행이라 없음) 행 수 표시.

- [ ] **Step 3: 백엔드 전체 테스트**

Run: `bun run test:server`
Expected: 전부 PASS(신규 assistant 테스트 포함)

- [ ] **Step 4: 프론트 전체 테스트 + 빌드**

Run: `bun run test:unit && bun run build`
Expected: 전부 PASS, build 성공

- [ ] **Step 5: 브라우저 스모크 (실 Gemini)**

`bun dev` 재시작(백엔드 변경 반영) 후 staff/admin으로 로그인 → Topbar 업무 AI 열기 → "계약 가능성 높은 고객 정리해줘" 전송 → "생각 중…" 후 근거 있는 한국어 답변 + sources 렌더 확인. 관련 데이터 없는 질문 → "관련 CRM 데이터를 찾지 못했습니다" 확인.

- [ ] **Step 6: PR 생성**

```bash
git push -u origin feat/crm-work-ai-chat
gh pr create --base main --title "feat(crm): 업무 AI 채팅 (슬라이스 B1 RAG)" --body "설계 ref/specs/2026-07-02-crm-work-ai-chat-design.md, 플랜 ref/plans/2026-07-02-crm-work-ai-chat.md. pgvector RAG 수직 슬라이스(임베딩 테이블+백필→검색→Gemini 생성→Topbar 연결), scope=admin(seam), 차원 3072."
```

---

## 후속 슬라이스 (이 PR 이후 — 별도 spec/plan)

1. **crm.staff/팀 파운데이션** — `resolveCustomerScope` 실제화(manager=팀, staff=본인) + `advisor_id` 연결. 리스트/상세 scope에도 재사용.
2. 쓰기 시 자동 재임베딩(memo/task/need/consultation CRUD 훅).
3. 스트리밍 응답, 멀티턴 대화.
4. 견적 코퍼스 확장, "오늘 브리핑" 동적화.
5. CF 프로덕션 배포(`GEMINI_API_KEY` CF Pages env 주입 + 백필 프로덕션 실행).

## Self-Review 노트 (작성자 확인 완료)

- **Spec 커버리지**: 데이터모델(Task 1)·백필(Task 3·9)·검색+생성(Task 2·5·6·7·8)·scope seam(Task 4)·UI(Task 10·11)·에러(Task 7·8·11)·테스트(각 Task) — spec 전 섹션 대응.
- **Placeholder**: 없음(모든 코드 스텝에 실제 코드).
- **타입 일관성**: `CorpusRow`(Task 3)=백필(Task 9)에서 사용, `SearchHit`(Task 5)=엔드포인트(Task 8) 소비, `AssistantAnswer`(Task 10)=Topbar(Task 11) 소비, `resolveCustomerScope`(Task 4)=엔드포인트(Task 8) 호출 — 시그니처 일치.
- **구현 시 실측 필요**(spec의 verify-at-implementation): ①`batchEmbedContents`/`embedContent` 실제 응답 형태·3072 차원(Task 12 Step 1에서 실호출로 검증) ②`executor.execute` 반환 형태(`rows` 래핑 여부, Task 5 Step 4) ③`.env.local`에 `GEMINI_API_KEY` 존재.
