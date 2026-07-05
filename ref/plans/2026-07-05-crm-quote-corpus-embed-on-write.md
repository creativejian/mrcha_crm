# 업무 AI 견적 코퍼스 확장 + 증분 임베딩 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RAG 코퍼스에 견적(quote) 청크를 추가하고, 메모·할일·니즈·견적 쓰기 시점에 응답 비차단 증분 임베딩(hash skip 포함)을 배선해 백필 수동 실행을 불필요하게 만든다.

**Architecture:** 순수 청크 빌더(`buildQuoteChunkText`) + fresh-read 로더(`loadCorpusSource`) + deps 주입형 훅 모듈(`embed-on-write.ts`)을 라우트 성공 경로에 걸고, dbHold+waitUntil 체인 헬퍼(`holdWork`)로 CF 연결/아이솔레이트 수명을 확보한다. 삭제는 동기 1쿼리, 백필은 hash skip+고아 정리를 얹어 보정 도구로 잔존.

**Tech Stack:** Hono + drizzle(postgres.js) + pgvector(crm.embeddings 3072) + Gemini embedding(gemini-embedding-001, 프록시 스위치) + bun:test.

**Spec:** `ref/specs/2026-07-05-crm-quote-corpus-embed-on-write-design.md` (확정 결정 6개 — 이 플랜과 충돌 시 스펙이 우선)

**브랜치:** `feat/crm-quote-corpus-embed-on-write` (스펙 커밋 698ab60 위에서 진행)

**파일 구조(전체 조감):**

| 파일 | 역할 | 신규/수정 |
|---|---|---|
| `src/db/schema.ts` | EMBEDDING_SOURCE_TYPES에 "quote" | 수정 |
| `drizzle/0016_*.sql` | CHECK drop→add | 생성(db:generate) |
| `src/db/queries/embeddings.ts` | getEmbeddingHash·deleteEmbeddingBySource | 수정 |
| `src/lib/app-card-payload.ts` | 라벨 헬퍼 5종 export | 수정(export만) |
| `src/lib/assistant-corpus.ts` | "quote" 타입 + buildQuoteChunkText | 수정 |
| `src/middleware/db.ts` | holdWork(dbHold 체인 등록) | 수정 |
| `src/db/queries/embed-sources.ts` | fresh-read 로더 loadCorpusSource | 신규 |
| `src/lib/embed-on-write.ts` | runEmbedJob + scheduleEmbedOnWrite | 신규 |
| `src/routes/customers.ts` | 훅 콜사이트 8곳 + 동기 삭제 3곳 | 수정 |
| `package.json` | test:server에 EMBED_ON_WRITE=off | 수정 |
| `src/scripts/backfill-embeddings.ts` | quote collect + hash skip + 고아 정리 | 수정 |

**공통 주의(모든 태스크):**
- 검증 명령: `bun run typecheck` / `bun run lint`(0 problems 유지) / `bun run test:server`(실 master DB — .env.local) / `bun run test:unit`(vitest, 클라).
- `any` 금지(불가피하면 `unknown` 후 좁히기). lint 룰 끌 때는 `eslint-disable-next-line <rule> -- <사유>`.
- 커밋 메시지에 skip-ci 마커 토큰 금지(CF Pages 배포 스킵 사고 — AGENTS.md).
- `db:push` 금지 — `db:generate` → `db:migrate`만.

---

### Task 1: 스키마 — EMBEDDING_SOURCE_TYPES에 "quote" + 마이그레이션 0016

**Files:**
- Modify: `src/db/schema.ts:46`
- Create: `drizzle/0016_*.sql` (db:generate 산출물 — 파일명은 drizzle이 랜덤 생성)

- [ ] **Step 1: 스키마 상수에 "quote" 추가**

`src/db/schema.ts` 46행:

```ts
// 변경 전
const EMBEDDING_SOURCE_TYPES = ["memo", "task", "need_memo", "need_customer_note", "need_review_note", "consultation"];
// 변경 후
const EMBEDDING_SOURCE_TYPES = ["memo", "task", "need_memo", "need_customer_note", "need_review_note", "consultation", "quote"];
```

- [ ] **Step 2: 마이그레이션 생성**

Run: `bun run db:generate`
Expected: `drizzle/0016_<랜덤명>.sql` 생성. 내용이 embeddings CHECK drop→add **2문장뿐**인지 확인(다른 테이블 변경이 섞여 있으면 스키마 드리프트 — 중단하고 원인 파악):

```sql
ALTER TABLE "crm"."embeddings" DROP CONSTRAINT "embeddings_source_type_check";--> statement-breakpoint
ALTER TABLE "crm"."embeddings" ADD CONSTRAINT "embeddings_source_type_check" CHECK (... IN ('memo', 'task', 'need_memo', 'need_customer_note', 'need_review_note', 'consultation', 'quote'));
```

(0015와 달리 신규 값 추가라 drop↔add 사이 백필 UPDATE 불필요 — 기존 행 위반 없음.)

- [ ] **Step 3: 마이그레이션 적용**

Run: `bun run db:migrate`
Expected: 에러 없이 완료. 확인: `psql "$DATABASE_URL" -c "select pg_get_constraintdef(oid) from pg_constraint where conname='embeddings_source_type_check'"` 출력에 `'quote'` 포함.

- [ ] **Step 4: 검증 후 커밋**

Run: `bun run typecheck && bun run lint`
Expected: 둘 다 0 problems.

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(crm): embeddings source_type에 quote 추가 — CHECK 마이그레이션 0016"
```

---

### Task 2: embeddings 쿼리 2함수 — getEmbeddingHash · deleteEmbeddingBySource (TDD)

**Files:**
- Modify: `src/db/queries/embeddings.ts`
- Test: `src/db/queries/embeddings.test.ts` (기존 파일에 추가 — 기존 `CUST`/`vec` 픽스처 재사용)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/db/queries/embeddings.test.ts` 맨 끝에 추가(import 줄에 `getEmbeddingHash, deleteEmbeddingBySource` 추가):

```ts
test("getEmbeddingHash: 있는 행은 해시, 없는 행은 null", async () => {
  const SRC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  await upsertEmbedding(
    { sourceType: "memo", sourceId: SRC, customerId: CUST, content: "해시 조회 테스트", contentHash: "hash-v1", embedding: vec(3) },
    db,
  );
  expect(await getEmbeddingHash("memo", SRC, db)).toBe("hash-v1");
  expect(await getEmbeddingHash("memo", "dddddddd-dddd-dddd-dddd-dddddddddddd", db)).toBeNull();
  expect(await getEmbeddingHash("task", SRC, db)).toBeNull(); // 같은 id라도 source_type이 다르면 별개
});

test("deleteEmbeddingBySource: 삭제 + 멱등(없어도 no-op)", async () => {
  const SRC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  await deleteEmbeddingBySource("memo", SRC, db);
  expect(await getEmbeddingHash("memo", SRC, db)).toBeNull();
  await deleteEmbeddingBySource("memo", SRC, db); // 재호출도 throw 없음
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test src/db/queries/embeddings.test.ts --env-file=.env.local`
Expected: FAIL — `getEmbeddingHash` export 없음(컴파일 에러).

- [ ] **Step 3: 구현**

`src/db/queries/embeddings.ts` — import에 `and, eq` 추가(`import { and, eq, sql } from "drizzle-orm";`), 파일 끝에:

```ts
// hash skip용: 기존 임베딩 행의 content_hash 조회. 행 없으면 null(→ 신규 임베딩).
export async function getEmbeddingHash(
  sourceType: string,
  sourceId: string,
  executor: Executor = getDefaultDb(),
): Promise<string | null> {
  const rows = await executor
    .select({ contentHash: embeddings.contentHash })
    .from(embeddings)
    .where(and(eq(embeddings.sourceType, sourceType), eq(embeddings.sourceId, sourceId)));
  return rows[0]?.contentHash ?? null;
}

// 원본 삭제/텍스트 비움 시 임베딩 행 제거. 멱등 — 행이 없어도 no-op(미발송 견적 삭제 등).
export async function deleteEmbeddingBySource(
  sourceType: string,
  sourceId: string,
  executor: Executor = getDefaultDb(),
): Promise<void> {
  await executor.delete(embeddings).where(and(eq(embeddings.sourceType, sourceType), eq(embeddings.sourceId, sourceId)));
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test src/db/queries/embeddings.test.ts --env-file=.env.local`
Expected: PASS (기존 테스트 포함 전부).

- [ ] **Step 5: 커밋**

```bash
git add src/db/queries/embeddings.ts src/db/queries/embeddings.test.ts
git commit -m "feat(crm): embeddings hash 조회·소스별 삭제 쿼리 — 증분 임베딩 skip/정리용"
```

---

### Task 3: 견적 청크 빌더 — app-card-payload 헬퍼 export + buildQuoteChunkText (TDD)

**Files:**
- Modify: `src/lib/app-card-payload.ts` (export 키워드 추가만 — 로직 무변경)
- Modify: `src/lib/assistant-corpus.ts`
- Test: `src/lib/assistant-corpus.test.ts` (기존 파일에 추가)

**배경:** 청크 최종 content는 기존 `buildChunkContent`가 조립한다(`고객 {이름} 견적: {text}`). `buildQuoteChunkText`는 그 `{text}` 부분만 만든다. 스펙의 예시 문구(`고객 제임스 견적 QT-…: BMW…`)는 illustrative — 실제 포맷은 `고객 제임스 견적: QT-2607-0001 · BMW …`로 기존 파이프라인을 그대로 탄다(특례 금지).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/assistant-corpus.test.ts` 맨 끝에 추가(import 줄에 `buildQuoteChunkText, type QuoteChunkQuote, type QuoteChunkScenario` 추가):

```ts
const FULL_QUOTE: QuoteChunkQuote = {
  quoteCode: "QT-2607-0001",
  brandName: "BMW",
  modelName: "320i",
  trimName: "320i M Sport",
  appStatus: "sent",
  sentAt: new Date("2026-07-05T00:30:00Z"), // KST 09:30
  guidance: {
    recommendReason: "재고 확보 차량\n조건 우수",
    keyPoints: ["즉시 출고", "보증 연장"],
    services: ["썬팅: 후퍼옵틱"],
  },
};
const FULL_SC: QuoteChunkScenario = { purchaseMethod: "운용리스", termMonths: 60, monthlyPayment: "2350000", lender: "하나캐피탈" };

test("buildQuoteChunkText: 풀필드 — 헤더+대표 시나리오+발송(KST)+guidance", () => {
  expect(buildQuoteChunkText(FULL_QUOTE, FULL_SC)).toBe(
    "QT-2607-0001 · BMW 320i M Sport · 운용리스 · 60개월 · 월 2,350,000원 · 하나캐피탈 · 26/07/05 09:30 발송"
    + " · 추천이유: 재고 확보 차량 조건 우수 · 핵심포인트: 즉시 출고, 보증 연장 · 서비스: 썬팅: 후퍼옵틱",
  );
});

test("buildQuoteChunkText: 최소 필드 — 차량 미선택·시나리오 없음·draft", () => {
  const q: QuoteChunkQuote = { quoteCode: "QT-2607-0002", brandName: null, modelName: null, trimName: null, appStatus: "draft", sentAt: null, guidance: null };
  expect(buildQuoteChunkText(q, null)).toBe("QT-2607-0002 · 차량 미선택 · 작성 중");
});

test("buildQuoteChunkText: sent인데 sentAt 없으면 작성 중(방어), viewed도 발송으로 표기", () => {
  const noStamp: QuoteChunkQuote = { ...FULL_QUOTE, appStatus: "sent", sentAt: null };
  expect(buildQuoteChunkText(noStamp, null)).toContain("작성 중");
  const viewed: QuoteChunkQuote = { ...FULL_QUOTE, appStatus: "viewed" };
  expect(buildQuoteChunkText(viewed, null)).toContain("26/07/05 09:30 발송");
  // 열람 여부는 절대 미포함(스펙 결정 1 — 앱이 advisor_quotes에 직접 써 CRM 훅 없음)
  expect(buildQuoteChunkText(viewed, null)).not.toContain("열람");
});

test("buildQuoteChunkText: legacy keyPoint(단수) 승격 — normalizeQuoteGuidance 재현", () => {
  const q: QuoteChunkQuote = { ...FULL_QUOTE, guidance: { keyPoint: "구형 단수 포인트" } };
  expect(buildQuoteChunkText(q, FULL_SC)).toContain("핵심포인트: 구형 단수 포인트");
});

test("buildQuoteChunkText: 값 없는 항목 생략 — 빈 라벨 나열 금지", () => {
  const sc: QuoteChunkScenario = { purchaseMethod: "할부", termMonths: null, monthlyPayment: null, lender: null };
  const text = buildQuoteChunkText({ ...FULL_QUOTE, appStatus: "draft", sentAt: null, guidance: null }, sc);
  expect(text).toBe("QT-2607-0001 · BMW 320i M Sport · 할부 · 작성 중");
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test src/lib/assistant-corpus.test.ts`
Expected: FAIL — `buildQuoteChunkText` export 없음.

- [ ] **Step 3: app-card-payload 헬퍼 export**

`src/lib/app-card-payload.ts`에서 아래 5개 선언 앞에 `export` 키워드만 추가(본문 무변경 — 클라 파리티 테스트는 payload 필드 집합만 잠그므로 export 추가는 무해):

- `function formatMoney` → `export function formatMoney` (123행 부근)
- `function formatTerm` → `export function formatTerm` (130행 부근)
- `function numOr` → `export function numOr` (134행 부근)
- `function vehicleTitleOf` → `export function vehicleTitleOf` (151행 부근)
- `function stampLabelOf` → `export function stampLabelOf` (184행 부근)
- `function guidanceOf` → `export function guidanceOf` (231행 부근)

- [ ] **Step 4: buildQuoteChunkText 구현**

`src/lib/assistant-corpus.ts` — 상단 import 추가:

```ts
import { formatMoney, formatTerm, guidanceOf, numOr, stampLabelOf, vehicleTitleOf } from "./app-card-payload";
```

`CorpusSourceType`·LABEL 확장:

```ts
export type CorpusSourceType = "memo" | "task" | "need_memo" | "need_customer_note" | "need_review_note" | "consultation" | "quote";

const LABEL: Record<CorpusSourceType, string> = {
  memo: "상담메모",
  task: "할일",
  need_memo: "니즈메모",
  need_customer_note: "고객노트",
  need_review_note: "심사메모",
  consultation: "상담이력",
  quote: "견적",
};
```

파일 끝에 추가:

```ts
// ── 견적 청크(스펙 2026-07-05 결정 2) ────────────────────────────────────────
// CorpusRow.text에 들어갈 견적 요약 본문. 최종 content는 buildChunkContent가 "고객 {이름} 견적: " 접두를 붙인다.
// 라벨 헬퍼는 app-card-payload(발송 payload 조립기)의 것을 재사용 — 라벨 규칙이 바뀌면 코퍼스도 자동 추종.

export type QuoteChunkQuote = {
  quoteCode: string;
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  appStatus: string | null; // draft|queued|sent|viewed
  sentAt: Date | null;
  guidance: unknown; // jsonb — guidanceOf가 legacy keyPoint(단수)까지 흡수
};

export type QuoteChunkScenario = {
  purchaseMethod: string | null;
  termMonths: number | null;
  monthlyPayment: string | null; // drizzle numeric = string
  lender: string | null;
};

// 값 없는 항목은 생략(빈 라벨 나열 금지). 열람(viewed_at) 상태는 넣지 않는다 —
// 앱이 advisor_quotes에 직접 써 CRM 훅이 없어 스테일로 박제된다(스펙 결정 1).
export function buildQuoteChunkText(q: QuoteChunkQuote, sc: QuoteChunkScenario | null): string {
  const g = guidanceOf(q.guidance);
  const monthly = numOr(sc?.monthlyPayment ?? null);
  const keyPoints = g.keyPoints.map((k) => k.trim()).filter(Boolean);
  const services = g.services.map((s) => s.trim()).filter(Boolean);
  const recommend = g.recommendReason.replace(/\s*\n+\s*/g, " ").trim();
  const sentLabel =
    (q.appStatus === "sent" || q.appStatus === "viewed") && q.sentAt
      ? `${stampLabelOf(q.sentAt.toISOString())} 발송`
      : "작성 중";
  const parts: (string | null)[] = [
    q.quoteCode,
    `${q.brandName ?? ""} ${vehicleTitleOf(q.modelName, q.trimName)}`.trim(),
    sc?.purchaseMethod || null,
    sc?.termMonths != null ? formatTerm(sc.termMonths) : null,
    monthly != null ? `월 ${formatMoney(monthly)}원` : null,
    sc?.lender || null,
    sentLabel,
    recommend ? `추천이유: ${recommend}` : null,
    keyPoints.length ? `핵심포인트: ${keyPoints.join(", ")}` : null,
    services.length ? `서비스: ${services.join(", ")}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
```

- [ ] **Step 5: 통과 확인**

Run: `bun test src/lib/assistant-corpus.test.ts && bun run test:unit`
Expected: bun 테스트 PASS + vitest 전부 PASS(app-card-payload 파리티 테스트 포함 — export 추가가 무해함을 증명).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/app-card-payload.ts src/lib/assistant-corpus.ts src/lib/assistant-corpus.test.ts
git commit -m "feat(crm): 견적 청크 빌더 buildQuoteChunkText — app-card-payload 라벨 헬퍼 재사용, 열람 미포함"
```

---

### Task 4: holdWork — 응답 후 작업의 dbHold 체인 등록 (TDD)

**Files:**
- Modify: `src/middleware/db.ts`
- Test: `src/middleware/db.test.ts` (기존 파일에 추가)

**배경:** `holdStreamLifetime`은 수동 release 방식(스트림용). 증분 임베딩은 promise 완료 = 해소이고, **같은 요청에서 여러 번 스케줄될 수 있다**(고객 PATCH가 니즈 3필드를 한 번에 보냄). dbHold를 덮어쓰면 앞선 작업이 연결 종료에 잘리므로 기존 hold와 체인한다. (스펙의 "holdStreamLifetime 재사용+finally(release)"를 다건 안전하게 정련 — 구현 편차 노트에 기록할 것.)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/middleware/db.test.ts` 맨 끝에 추가(import 줄에 `holdWork` 추가):

```ts
test("holdWork: dbHold와 waitUntil에 등록, 작업 완료로 해소", async () => {
  const scheduled: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { scheduled.push(p); }, passThroughOnException: () => {} } as ExecutionContext;
  let held: Promise<unknown> | undefined;
  let resolveWork!: () => void;
  const work = new Promise<void>((r) => { resolveWork = r; });
  const fakeContext = {
    executionCtx: ctx,
    get: (_key: "dbHold") => held,
    set: (_key: "dbHold", value: Promise<unknown>) => { held = value; },
  };

  holdWork(fakeContext, work);
  expect(held).toBeInstanceOf(Promise);
  expect(scheduled).toHaveLength(1);

  let settled = false;
  void held!.then(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 10));
  expect(settled).toBe(false); // 작업 중엔 연결 유지

  resolveWork();
  await held;
});

test("holdWork: 같은 요청 2회 호출 시 dbHold가 둘 다 완료까지 대기(체인 — 니즈 3필드 동시 PATCH)", async () => {
  let held: Promise<unknown> | undefined;
  const fakeContext = {
    get executionCtx(): ExecutionContext { throw new Error("no executionCtx"); }, // 로컬 bun 경로
    get: (_key: "dbHold") => held,
    set: (_key: "dbHold", value: Promise<unknown>) => { held = value; },
  };
  let resolveA!: () => void;
  const a = new Promise<void>((r) => { resolveA = r; });
  holdWork(fakeContext, a);
  holdWork(fakeContext, Promise.resolve()); // 두 번째 작업은 즉시 완료

  let settled = false;
  void held!.then(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 10));
  expect(settled).toBe(false); // 첫 작업이 살아있는 동안 최종 hold 미해소

  resolveA();
  await held;
});

test("holdWork: 작업 reject여도 dbHold는 해소(연결 누수 방지)", async () => {
  let held: Promise<unknown> | undefined;
  const fakeContext = {
    get executionCtx(): ExecutionContext { throw new Error("no executionCtx"); },
    get: (_key: "dbHold") => held,
    set: (_key: "dbHold", value: Promise<unknown>) => { held = value; },
  };
  holdWork(fakeContext, Promise.reject(new Error("embed failed")));
  await held; // reject가 전파되면 이 await가 throw — 테스트 실패
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test src/middleware/db.test.ts`
Expected: FAIL — `holdWork` export 없음.

- [ ] **Step 3: 구현**

`src/middleware/db.ts`의 `holdStreamLifetime` 아래에 추가:

```ts
// 응답 후 백그라운드 작업(증분 임베딩 등)을 dbHold+waitUntil에 등록 — holdStreamLifetime과 달리
// 수동 release가 아니라 작업 promise 완료가 곧 해소다. 같은 요청에서 여러 번 호출되면 기존 hold와
// 체인한다(고객 PATCH가 니즈 3필드를 동시에 보내는 경우 — 덮어쓰면 앞선 작업이 연결 종료에 잘린다).
// 작업 실패는 여기서 흡수(연결 종료·waitUntil은 성패와 무관하게 진행돼야 한다) — 로깅은 호출부 책임.
export function holdWork(
  c: Pick<Context, "executionCtx"> & {
    get: (key: "dbHold") => Promise<unknown> | undefined;
    set: (key: "dbHold", value: Promise<unknown>) => void;
  },
  work: Promise<unknown>,
): void {
  const settled = work.then(() => undefined, () => undefined);
  const prev = c.get("dbHold");
  c.set("dbHold", prev ? Promise.all([prev.then(() => undefined, () => undefined), settled]) : settled);
  tryWaitUntil(c, settled);
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test src/middleware/db.test.ts`
Expected: PASS (기존 8개 + 신규 3개).

- [ ] **Step 5: 커밋**

```bash
git add src/middleware/db.ts src/middleware/db.test.ts
git commit -m "feat(crm): holdWork — 응답 후 작업 dbHold 체인 등록(다건 안전, 증분 임베딩 수명)"
```

---

### Task 5: fresh-read 로더 — loadCorpusSource (TDD, 실 DB)

**Files:**
- Create: `src/db/queries/embed-sources.ts`
- Test: `src/db/queries/embed-sources.test.ts` (신규)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/db/queries/embed-sources.test.ts`:

```ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { customerMemos, customers, quotes, quoteScenarios } from "../schema";
import { loadCorpusSource } from "./embed-sources";

const db = getDefaultDb();
let CUST = "";
let MEMO = "";
let QUOTE = "";

beforeAll(async () => {
  const [c] = await db.insert(customers).values({
    customerCode: "CU-EMBSRC-9991", name: "로더테스트", needMemo: "니즈 로더 검증", needCustomerNote: "  ",
  }).returning({ id: customers.id });
  CUST = c.id;
  const [m] = await db.insert(customerMemos).values({ customerId: CUST, body: "메모 로더 검증" }).returning({ id: customerMemos.id });
  MEMO = m.id;
  const [q] = await db.insert(quotes).values({
    quoteCode: "QT-EMBSRC-9991", customerId: CUST, brandName: "BMW", modelName: "320i", trimName: "320i M Sport", appStatus: "draft", revision: 0,
  }).returning({ id: quotes.id });
  QUOTE = q.id;
  const [s] = await db.insert(quoteScenarios).values({
    quoteId: QUOTE, scenarioNo: 1, purchaseMethod: "운용리스", termMonths: 60, monthlyPayment: "2350000", lender: "하나캐피탈",
  }).returning({ id: quoteScenarios.id });
  await db.update(quotes).set({ primaryScenarioId: s.id }).where(eq(quotes.id, QUOTE));
});

afterAll(async () => {
  await db.delete(quotes).where(eq(quotes.id, QUOTE)); // 시나리오는 FK cascade
  await db.delete(customers).where(eq(customers.id, CUST)); // 메모는 FK cascade
});

test("loadCorpusSource(memo): 본문+고객명, 없는 id는 null", async () => {
  const snap = await loadCorpusSource("memo", MEMO, db);
  expect(snap).toEqual({ customerId: CUST, customerName: "로더테스트", text: "메모 로더 검증" });
  expect(await loadCorpusSource("memo", "00000000-0000-0000-0000-000000000000", db)).toBeNull();
});

test("loadCorpusSource(need_*): 필드 선택 — 공백뿐 필드는 그대로 반환(빈 판정은 호출부)", async () => {
  const memo = await loadCorpusSource("need_memo", CUST, db);
  expect(memo?.text).toBe("니즈 로더 검증");
  const note = await loadCorpusSource("need_customer_note", CUST, db);
  expect(note?.text).toBe("  "); // trim 판정은 runEmbedJob 책임
  const review = await loadCorpusSource("need_review_note", CUST, db);
  expect(review?.text).toBe(""); // null 필드는 빈 문자열
});

test("loadCorpusSource(quote): 대표 시나리오 기준 청크 텍스트", async () => {
  const snap = await loadCorpusSource("quote", QUOTE, db);
  expect(snap?.customerName).toBe("로더테스트");
  expect(snap?.text).toBe("QT-EMBSRC-9991 · BMW 320i M Sport · 운용리스 · 60개월 · 월 2,350,000원 · 하나캐피탈 · 작성 중");
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test src/db/queries/embed-sources.test.ts --env-file=.env.local`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/db/queries/embed-sources.ts`:

```ts
import { asc, eq } from "drizzle-orm";

import { buildQuoteChunkText } from "../../lib/assistant-corpus";
import { getDefaultDb, type Executor } from "../client";
import { customerMemos, customers, customerTasks, quotes, quoteScenarios } from "../schema";

// 증분 임베딩 훅의 fresh read — 커밋된 최신 원본+고객명 스냅샷.
// 원본 행 없음 → null(호출부가 임베딩 행 삭제). text 비움 판정(trim)은 호출부(runEmbedJob) 책임.
export type CorpusSourceSnapshot = { customerId: string; customerName: string; text: string };

// on-write 대상 소스타입. consultation은 CRM 쓰기 경로가 없어 제외(스펙 결정 3 —
// 채팅 AI 요약 자동 수신 경로가 생기면 그쪽에서 훅 추가).
export type WritableCorpusSourceType = "memo" | "task" | "need_memo" | "need_customer_note" | "need_review_note" | "quote";

export async function loadCorpusSource(
  sourceType: WritableCorpusSourceType,
  sourceId: string,
  ex: Executor = getDefaultDb(),
): Promise<CorpusSourceSnapshot | null> {
  switch (sourceType) {
    case "memo": {
      const [r] = await ex
        .select({ customerId: customerMemos.customerId, name: customers.name, text: customerMemos.body })
        .from(customerMemos)
        .innerJoin(customers, eq(customers.id, customerMemos.customerId))
        .where(eq(customerMemos.id, sourceId));
      return r ? { customerId: r.customerId, customerName: r.name, text: r.text ?? "" } : null;
    }
    case "task": {
      const [r] = await ex
        .select({ customerId: customerTasks.customerId, name: customers.name, text: customerTasks.body })
        .from(customerTasks)
        .innerJoin(customers, eq(customers.id, customerTasks.customerId))
        .where(eq(customerTasks.id, sourceId));
      return r ? { customerId: r.customerId, customerName: r.name, text: r.text ?? "" } : null;
    }
    case "need_memo":
    case "need_customer_note":
    case "need_review_note": {
      const [r] = await ex
        .select({
          name: customers.name,
          needMemo: customers.needMemo,
          needCustomerNote: customers.needCustomerNote,
          needReviewNote: customers.needReviewNote,
        })
        .from(customers)
        .where(eq(customers.id, sourceId));
      if (!r) return null;
      const text = sourceType === "need_memo" ? r.needMemo : sourceType === "need_customer_note" ? r.needCustomerNote : r.needReviewNote;
      return { customerId: sourceId, customerName: r.name, text: text ?? "" };
    }
    case "quote": {
      const [q] = await ex
        .select({
          customerId: quotes.customerId,
          name: customers.name,
          quoteCode: quotes.quoteCode,
          brandName: quotes.brandName,
          modelName: quotes.modelName,
          trimName: quotes.trimName,
          appStatus: quotes.appStatus,
          sentAt: quotes.sentAt,
          guidance: quotes.guidance,
          primaryScenarioId: quotes.primaryScenarioId,
        })
        .from(quotes)
        .innerJoin(customers, eq(customers.id, quotes.customerId))
        .where(eq(quotes.id, sourceId));
      if (!q) return null;
      // 대표 시나리오: primary_scenario_id 일치 → 없으면 scenario_no 최소(발송 조립기와 동일 규칙).
      const scs = await ex
        .select({
          id: quoteScenarios.id,
          purchaseMethod: quoteScenarios.purchaseMethod,
          termMonths: quoteScenarios.termMonths,
          monthlyPayment: quoteScenarios.monthlyPayment,
          lender: quoteScenarios.lender,
        })
        .from(quoteScenarios)
        .where(eq(quoteScenarios.quoteId, sourceId))
        .orderBy(asc(quoteScenarios.scenarioNo));
      const sc = scs.find((s) => s.id === q.primaryScenarioId) ?? scs[0] ?? null;
      return { customerId: q.customerId, customerName: q.name, text: buildQuoteChunkText(q, sc) };
    }
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test src/db/queries/embed-sources.test.ts --env-file=.env.local`
Expected: PASS 3건.

- [ ] **Step 5: 커밋**

```bash
git add src/db/queries/embed-sources.ts src/db/queries/embed-sources.test.ts
git commit -m "feat(crm): loadCorpusSource — 증분 임베딩 fresh-read 로더(메모/할일/니즈/견적)"
```

---

### Task 6: 훅 모듈 — runEmbedJob + scheduleEmbedOnWrite (TDD, fake deps)

**Files:**
- Create: `src/lib/embed-on-write.ts`
- Test: `src/lib/embed-on-write.test.ts` (신규)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/embed-on-write.test.ts`:

```ts
import { test, expect, beforeEach, afterAll } from "bun:test";

import type { Db } from "../db/client";
import { EMBEDDING_DIM } from "./gemini-embed";
import { embedOnWriteDeps, runEmbedJob, scheduleEmbedOnWrite, type EmbedOnWriteJob } from "./embed-on-write";
import type { GeminiTarget } from "./gemini-target";

const ORIGINAL = { ...embedOnWriteDeps };
afterAll(() => { Object.assign(embedOnWriteDeps, ORIGINAL); });

const TARGET: GeminiTarget = { baseUrl: "https://gemini.test", apiKey: "k" };
const DB = {} as Db; // deps가 전부 fake라 실제로 안 쓰인다
const JOB: EmbedOnWriteJob = { sourceType: "memo", sourceId: "s1" };
const VEC = Array.from({ length: EMBEDDING_DIM }, () => 0.01);

type Calls = { embed: number; upsert: number; del: number };
function arm(opts: { snap: { customerId: string; customerName: string; text: string } | null; existingHash: string | null }): Calls {
  const calls: Calls = { embed: 0, upsert: 0, del: 0 };
  embedOnWriteDeps.loadCorpusSource = async () => opts.snap;
  embedOnWriteDeps.getEmbeddingHash = async () => opts.existingHash;
  embedOnWriteDeps.embedTexts = async (texts) => { calls.embed++; return texts.map(() => VEC); };
  embedOnWriteDeps.upsertEmbedding = async () => { calls.upsert++; };
  embedOnWriteDeps.deleteEmbeddingBySource = async () => { calls.del++; };
  return calls;
}

beforeEach(() => { Object.assign(embedOnWriteDeps, ORIGINAL); });

test("runEmbedJob: 변경된 콘텐츠 → 임베딩+upsert, outcome embedded", async () => {
  const calls = arm({ snap: { customerId: "c1", customerName: "김민준", text: "새 메모" }, existingHash: "old-hash" });
  expect(await runEmbedJob(JOB, TARGET, DB)).toBe("embedded");
  expect(calls).toEqual({ embed: 1, upsert: 1, del: 0 });
});

test("runEmbedJob: hash 동일 → Gemini 미호출 skip, outcome unchanged", async () => {
  // 실제 콘텐츠의 해시를 기존 해시로 넣어 동일성 재현
  const { buildChunkContent, contentHash } = await import("./assistant-corpus");
  const snap = { customerId: "c1", customerName: "김민준", text: "같은 메모" };
  const content = buildChunkContent({ sourceType: "memo", sourceId: "s1", customerId: "c1", customerName: "김민준", text: "같은 메모" });
  const calls = arm({ snap, existingHash: contentHash(content) });
  expect(await runEmbedJob(JOB, TARGET, DB)).toBe("unchanged");
  expect(calls).toEqual({ embed: 0, upsert: 0, del: 0 });
});

test("runEmbedJob: 원본 소실 → 임베딩 행 삭제, outcome deleted", async () => {
  const calls = arm({ snap: null, existingHash: "h" });
  expect(await runEmbedJob(JOB, TARGET, DB)).toBe("deleted");
  expect(calls).toEqual({ embed: 0, upsert: 0, del: 1 });
});

test("runEmbedJob: 빈/공백 텍스트 → 삭제(니즈 필드 비움 경로)", async () => {
  const calls = arm({ snap: { customerId: "c1", customerName: "김민준", text: "  " }, existingHash: "h" });
  expect(await runEmbedJob(JOB, TARGET, DB)).toBe("deleted");
  expect(calls.del).toBe(1);
});

function fakeHookContext(env: Record<string, string | undefined>) {
  let held: Promise<unknown> | undefined;
  return {
    ctx: {
      get executionCtx(): never { throw new Error("no executionCtx"); },
      env,
      req: { header: (_name: string) => "Bearer test-jwt" as string | undefined },
      get: (_key: "dbHold") => held,
      set: (_key: "dbHold", value: Promise<unknown>) => { held = value; },
      var: { db: DB },
    },
    held: () => held,
  };
}

test("scheduleEmbedOnWrite: 정상 경로 — dbHold 등록 + 태스크가 deps 실행", async () => {
  const calls = arm({ snap: { customerId: "c1", customerName: "김민준", text: "훅 메모" }, existingHash: null });
  // EMBED_ON_WRITE: "on" 명시 필수 — test:server가 process.env에 off를 깔아두므로(env 오버라이드가 폴백보다 우선)
  const { ctx, held } = fakeHookContext({ GEMINI_API_KEY: "k", EMBED_ON_WRITE: "on" });
  scheduleEmbedOnWrite(ctx, JOB);
  expect(held()).toBeInstanceOf(Promise);
  await held();
  expect(calls.upsert).toBe(1);
});

test("scheduleEmbedOnWrite: EMBED_ON_WRITE=off / 키 부재 → no-op(dbHold 미등록)", () => {
  arm({ snap: { customerId: "c1", customerName: "김민준", text: "x" }, existingHash: null });
  const off = fakeHookContext({ GEMINI_API_KEY: "k", EMBED_ON_WRITE: "off" });
  scheduleEmbedOnWrite(off.ctx, JOB);
  expect(off.held()).toBeUndefined();
  const noKey = fakeHookContext({ GEMINI_API_KEY: undefined });
  scheduleEmbedOnWrite(noKey.ctx, JOB);
  expect(noKey.held()).toBeUndefined();
});

test("scheduleEmbedOnWrite: 태스크 실패해도 throw 없음(저장 응답 불변) + dbHold 해소", async () => {
  arm({ snap: { customerId: "c1", customerName: "김민준", text: "x" }, existingHash: null });
  embedOnWriteDeps.embedTexts = async () => { throw new Error("Gemini down"); };
  const { ctx, held } = fakeHookContext({ GEMINI_API_KEY: "k", EMBED_ON_WRITE: "on" });
  scheduleEmbedOnWrite(ctx, JOB); // throw하면 테스트 실패
  await held(); // reject 전파되면 테스트 실패(holdWork가 흡수)
});
```

**주의:** `.env.local`에 `GEMINI_API_KEY`가 있어도 이 테스트는 fake deps라 실 호출 없음. 단 `scheduleEmbedOnWrite`의 키 부재 케이스는 `c.env`가 아니라 `process.env` 폴백을 탈 수 있다 — 구현에서 **env 객체에 키가 명시적으로 undefined면 process.env 폴백을 건너뛰지 않으므로**, 테스트 실행 환경(`bun test` 단독, --env-file 없이)으로 돌리거나 케이스에서 `process.env.GEMINI_API_KEY`를 임시 비우고 복원한다. 가장 단순한 규약: **이 파일은 `bun test src/lib/embed-on-write.test.ts`(--env-file 없이)로 먼저 돌려 보고, test:server 전체 실행에서도 깨지지 않도록 키 부재 케이스에서 `process.env.GEMINI_API_KEY` 저장→delete→복원을 넣는다:**

```ts
test("scheduleEmbedOnWrite: EMBED_ON_WRITE=off / 키 부재 → no-op(dbHold 미등록)", () => {
  arm({ snap: { customerId: "c1", customerName: "김민준", text: "x" }, existingHash: null });
  const off = fakeHookContext({ GEMINI_API_KEY: "k", EMBED_ON_WRITE: "off" });
  scheduleEmbedOnWrite(off.ctx, JOB);
  expect(off.held()).toBeUndefined();

  const savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY; // process.env 폴백 차단
  try {
    const noKey = fakeHookContext({});
    scheduleEmbedOnWrite(noKey.ctx, JOB);
    expect(noKey.held()).toBeUndefined();
  } finally {
    if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
  }
});
```

(위 두 번째 코드 블록이 최종본 — 첫 블록의 해당 테스트를 이걸로 작성한다.)

- [ ] **Step 2: 실패 확인**

Run: `bun test src/lib/embed-on-write.test.ts --env-file=.env.local`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/lib/embed-on-write.ts`:

```ts
import type { Context } from "hono";

import type { Db } from "../db/client";
import { loadCorpusSource, type WritableCorpusSourceType } from "../db/queries/embed-sources";
import { deleteEmbeddingBySource, getEmbeddingHash, upsertEmbedding } from "../db/queries/embeddings";
import { holdWork } from "../middleware/db";
import { buildChunkContent, contentHash } from "./assistant-corpus";
import { embedTexts } from "./gemini-embed";
import { resolveGeminiTarget, type GeminiTarget } from "./gemini-target";

// 증분 임베딩(스펙 2026-07-05): 쓰기 라우트가 성공 직후 scheduleEmbedOnWrite를 호출하면
// 응답 반환 후 백그라운드에서 fresh read→hash 비교→임베딩→upsert가 돈다. 실패는 로그만
// (다음 쓰기/백필이 보정 — 내구성 없음은 스펙 수용 결정).

export type EmbedOnWriteJob = { sourceType: WritableCorpusSourceType; sourceId: string };
export type EmbedJobOutcome = "deleted" | "unchanged" | "embedded";

// 테스트 주입용(assistantDeps 패턴 — mock.module 대신 전역 누출 없는 필드 교체).
export const embedOnWriteDeps = { loadCorpusSource, getEmbeddingHash, deleteEmbeddingBySource, upsertEmbedding, embedTexts };

// 태스크 본문. 순수 오케스트레이션 — 유닛은 fake deps로 직접 호출, 라우트 경유는 배선 테스트가 커버.
export async function runEmbedJob(job: EmbedOnWriteJob, target: GeminiTarget, db: Db): Promise<EmbedJobOutcome> {
  const snap = await embedOnWriteDeps.loadCorpusSource(job.sourceType, job.sourceId, db);
  if (!snap || !snap.text.trim()) {
    // 원본 소실(경합 삭제) 또는 텍스트 비움(니즈 필드 클리어) — 검색에서 제거.
    await embedOnWriteDeps.deleteEmbeddingBySource(job.sourceType, job.sourceId, db);
    return "deleted";
  }
  const content = buildChunkContent({
    sourceType: job.sourceType, sourceId: job.sourceId,
    customerId: snap.customerId, customerName: snap.customerName, text: snap.text,
  });
  const hash = contentHash(content);
  if ((await embedOnWriteDeps.getEmbeddingHash(job.sourceType, job.sourceId, db)) === hash) return "unchanged"; // Gemini 호출 생략(스펙 결정 4)
  const [vector] = await embedOnWriteDeps.embedTexts([content], target, "RETRIEVAL_DOCUMENT");
  await embedOnWriteDeps.upsertEmbedding(
    { sourceType: job.sourceType, sourceId: job.sourceId, customerId: snap.customerId, content, contentHash: hash, embedding: vector },
    db,
  );
  return "embedded";
}

// 구조적 타입 — hono Context가 Variables에 invariant라 교차 Variables 라우트가 못 들어오는 문제 회피
// (holdStreamLifetime과 같은 이유). env는 CF Pages c.env, 로컬은 undefined → process.env 폴백.
type HookContext = Pick<Context, "executionCtx"> & {
  env: unknown;
  req: { header: (name: string) => string | undefined };
  get: (key: "dbHold") => Promise<unknown> | undefined;
  set: (key: "dbHold", value: Promise<unknown>) => void;
  var: { db: Db };
};

// 저장 성공 경로에서 호출. 어떤 경우에도 throw하지 않는다(저장 응답 불변) — 게이트 미충족은 조용히 no-op.
export function scheduleEmbedOnWrite(c: HookContext, job: EmbedOnWriteJob): void {
  try {
    const env = (c.env ?? {}) as { GEMINI_API_KEY?: string; GEMINI_PROXY_URL?: string; EMBED_ON_WRITE?: string };
    const apiKey = env.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
    const flag = env.EMBED_ON_WRITE ?? process.env.EMBED_ON_WRITE;
    if (!apiKey || flag === "off") return; // 키 없는 환경·테스트(EMBED_ON_WRITE=off)는 임베딩 없이 저장만
    // prod는 GEMINI_PROXY_URL 설정 시 서울 핀 프록시 경유(#144) — Authorization 포워딩 필수.
    const target = resolveGeminiTarget({
      apiKey,
      proxyUrl: env.GEMINI_PROXY_URL ?? process.env.GEMINI_PROXY_URL,
      authHeader: c.req.header("Authorization"),
    });
    const task = runEmbedJob(job, target, c.var.db).then(
      (outcome) => { if (outcome !== "unchanged") console.log(`[embed-on-write] ${job.sourceType}/${job.sourceId} ${outcome}`); },
      (e) => console.error(`[embed-on-write] ${job.sourceType}/${job.sourceId} 실패:`, e),
    );
    holdWork(c, task); // dbHold 체인+waitUntil — 응답 비차단, CF 연결/아이솔레이트 수명 확보(#143 유형 방지)
  } catch (e) {
    console.error("[embed-on-write] 스케줄 실패:", e);
  }
}
```

**스펙 편차(구현 편차 노트에 기록):** job에서 `customerId` 제거 — fresh read가 원본 행에서 customerId를 얻으므로 중복 입력이었다(YAGNI).

- [ ] **Step 4: 통과 확인**

Run: `bun test src/lib/embed-on-write.test.ts --env-file=.env.local`
Expected: PASS 7건(fake deps라 실 Gemini/DB 접근 0).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/embed-on-write.ts src/lib/embed-on-write.test.ts
git commit -m "feat(crm): 증분 임베딩 훅 모듈 — runEmbedJob(hash skip·삭제)+scheduleEmbedOnWrite(비차단·게이트)"
```

---

### Task 7: 라우트 배선 — test:server 게이트 + 훅 콜사이트 + 배선 테스트

**Files:**
- Modify: `package.json:18`
- Modify: `src/routes/customers.ts`
- Test: `src/routes/customers.embed.test.ts` (신규)

- [ ] **Step 1: test:server에 게이트 플래그 (반드시 배선보다 먼저)**

`package.json` 18행:

```json
"test:server": "EMBED_ON_WRITE=off bun test --env-file=.env.local",
```

**이유(스펙 함정):** 훅이 배선되는 순간 기존 쓰기 테스트(customers.test.ts 등)가 .env.local의 실 GEMINI_API_KEY로 실 Gemini 호출 + master 임베딩 오염을 일으킨다. 플래그가 구조적으로 차단.

- [ ] **Step 2: 실패하는 배선 테스트 작성**

`src/routes/customers.embed.test.ts`:

```ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import { and, eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { customers, embeddings, quotes } from "../db/schema";
import { EMBEDDING_DIM } from "../lib/gemini-embed";
import { embedOnWriteDeps } from "../lib/embed-on-write";

const db = getDefaultDb();
const ORIGINAL_EMBED = embedOnWriteDeps.embedTexts;
const SAVED_FLAG = process.env.EMBED_ON_WRITE;
let CUST = "";
let embedCalls = 0;
let auth: Awaited<ReturnType<typeof makeTestAuth>>;

beforeAll(async () => {
  // 게이트 개방(test:server 기본 off) + embedTexts만 fake(고정 벡터·실 Gemini 차단). DB deps는 실물 —
  // crm.embeddings 실 왕복까지 검증하는 통합 테스트다.
  process.env.EMBED_ON_WRITE = "on";
  embedOnWriteDeps.embedTexts = async (texts) => { embedCalls++; return texts.map(() => Array.from({ length: EMBEDDING_DIM }, () => 0.01)); };
  auth = await makeTestAuth("admin");
  const [c] = await db.insert(customers).values({ customerCode: "CU-EMBRT-9992", name: "배선테스트" }).returning({ id: customers.id });
  CUST = c.id;
});

afterAll(async () => {
  embedOnWriteDeps.embedTexts = ORIGINAL_EMBED;
  if (SAVED_FLAG !== undefined) process.env.EMBED_ON_WRITE = SAVED_FLAG; else delete process.env.EMBED_ON_WRITE;
  await db.delete(quotes).where(eq(quotes.customerId, CUST)); // customers FK에 cascade 없음 — 견적 먼저
  await db.delete(customers).where(eq(customers.id, CUST)); // 메모·임베딩은 FK cascade
});

// 훅은 응답 후 비동기 — 조건 충족까지 폴링(최대 timeoutMs).
async function until(cond: () => Promise<boolean> | boolean, timeoutMs = 3000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - t0 > timeoutMs) throw new Error("until: 조건 미충족 타임아웃");
    await Bun.sleep(25);
  }
}

async function embeddingRow(sourceType: string, sourceId: string) {
  const rows = await db
    .select({ content: embeddings.content, customerId: embeddings.customerId })
    .from(embeddings)
    .where(and(eq(embeddings.sourceType, sourceType), eq(embeddings.sourceId, sourceId)));
  return rows[0] ?? null;
}

test("메모 POST → 임베딩 행 생성(비동기), 동일 내용 재저장은 hash skip", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  const res = await app.request(`/api/customers/${CUST}/memos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "임베딩 배선 검증 메모" }),
  });
  expect(res.status).toBe(201);
  const memo = (await res.json()) as { id: string };

  await until(async () => (await embeddingRow("memo", memo.id)) != null);
  const row = await embeddingRow("memo", memo.id);
  expect(row?.content).toBe("고객 배선테스트 상담메모: 임베딩 배선 검증 메모");
  expect(row?.customerId).toBe(CUST);
  const callsAfterInsert = embedCalls;

  // 동일 본문 PATCH → fresh read 콘텐츠 불변 → hash skip(Gemini 미호출)
  const patch = await app.request(`/api/customers/${CUST}/memos/${memo.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "임베딩 배선 검증 메모" }),
  });
  expect(patch.status).toBe(200);
  await Bun.sleep(300); // 훅이 돌 시간 — skip이면 호출 수 불변
  expect(embedCalls).toBe(callsAfterInsert);

  // DELETE → 임베딩 행 동기 제거
  const del = await app.request(`/api/customers/${CUST}/memos/${memo.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(del.status).toBe(200);
  expect(await embeddingRow("memo", memo.id)).toBeNull(); // 폴링 불필요 — 삭제는 동기(스펙 결정 6)
});

test("니즈 필드 PATCH → need_memo 임베딩, 비우면 행 삭제", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  const res = await app.request(`/api/customers/${CUST}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ needMemo: "GLC 재고 확인 필요" }),
  });
  expect(res.status).toBe(200);
  await until(async () => (await embeddingRow("need_memo", CUST)) != null);
  expect((await embeddingRow("need_memo", CUST))?.content).toBe("고객 배선테스트 니즈메모: GLC 재고 확인 필요");

  const clear = await app.request(`/api/customers/${CUST}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ needMemo: "" }),
  });
  expect(clear.status).toBe(200);
  await until(async () => (await embeddingRow("need_memo", CUST)) == null); // 빈 텍스트 → 훅이 행 삭제
});

test("견적 POST(트랜잭션) → quote 임베딩, DELETE → 동기 제거", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  const res = await app.request(`/api/customers/${CUST}/quotes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ brandName: "BMW", modelName: "320i", trimName: "320i M Sport", scenario: { purchaseMethod: "운용리스", termMonths: 60, monthlyPayment: "2350000", lender: "하나캐피탈" } }),
  });
  expect(res.status).toBe(201);
  const quote = (await res.json()) as { id: string; quoteCode: string };

  await until(async () => (await embeddingRow("quote", quote.id)) != null);
  const row = await embeddingRow("quote", quote.id);
  expect(row?.content).toContain(quote.quoteCode);
  expect(row?.content).toContain("BMW 320i M Sport");
  expect(row?.content).toContain("운용리스");

  const del = await app.request(`/api/customers/${CUST}/quotes/${quote.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(del.status).toBe(200);
  expect(await embeddingRow("quote", quote.id)).toBeNull();
});

test("404 경로는 스케줄 안 함 — 없는 메모 PATCH에 임베딩 호출 0", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  const before = embedCalls;
  const res = await app.request(`/api/customers/${CUST}/memos/00000000-0000-0000-0000-000000000000`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "유령" }),
  });
  expect(res.status).toBe(404);
  await Bun.sleep(200);
  expect(embedCalls).toBe(before);
});
```

- [ ] **Step 3: 실패 확인**

Run: `bun test src/routes/customers.embed.test.ts --env-file=.env.local`
Expected: FAIL — 임베딩 행이 생성되지 않음(훅 미배선). `until` 타임아웃.

- [ ] **Step 4: 라우트 배선 구현**

`src/routes/customers.ts` — import 2줄 추가:

```ts
import { deleteEmbeddingBySource } from "../db/queries/embeddings";
import { scheduleEmbedOnWrite } from "../lib/embed-on-write";
```

**(a) 메모 3라우트 교체** (기존 214~223행):

```ts
customers.post("/:id/memos", zValidator("param", idParam), zValidator("json", memoBody), async (c) => {
  const row = await addMemo(c.req.valid("param").id, c.req.valid("json"), c.var.db);
  scheduleEmbedOnWrite(c, { sourceType: "memo", sourceId: row.id });
  return c.json(row, 201);
});
customers.patch("/:id/memos/:childId", zValidator("param", childParam), zValidator("json", memoBody), (c) => {
  const p = c.req.valid("param");
  return run(c, async () => {
    const row = await updateMemo(p.id, p.childId, c.req.valid("json"), c.var.db);
    if (row) scheduleEmbedOnWrite(c, { sourceType: "memo", sourceId: p.childId });
    return row;
  }, "메모를 찾을 수 없습니다.");
});
customers.delete("/:id/memos/:childId", zValidator("param", childParam), (c) => {
  const p = c.req.valid("param");
  return run(c, async () => {
    const row = await deleteMemo(p.id, p.childId, c.var.db);
    // 삭제 정리는 동기 1쿼리(Gemini 무관) — 응답 시점에 검색에서 제거(스펙 결정 6). 실패는 로그만(고아는 백필이 청소).
    if (row) await deleteEmbeddingBySource("memo", p.childId, c.var.db).catch((e) => console.error("[embed-on-write] 삭제 정리 실패:", e));
    return row;
  }, "메모를 찾을 수 없습니다.");
});
```

**(b) 할일 3라우트** — 메모와 동일 패턴, `sourceType: "task"`. POST/PATCH의 기존 `validateLookupValue("task_category", ...)` 검증은 그대로 유지하고 성공 경로에만 스케줄 추가:

```ts
customers.post("/:id/tasks", zValidator("param", idParam), zValidator("json", taskBody), async (c) => {
  const body = c.req.valid("json");
  if (body.category !== undefined) {
    const error = validateLookupValue("task_category", body.category);
    if (error) return c.json({ error }, 400);
  }
  const row = await addTask(c.req.valid("param").id, body, c.var.db);
  scheduleEmbedOnWrite(c, { sourceType: "task", sourceId: row.id });
  return c.json(row, 201);
});
customers.patch("/:id/tasks/:childId", zValidator("param", childParam), zValidator("json", taskBody), async (c) => {
  const p = c.req.valid("param");
  const body = c.req.valid("json");
  if (body.category !== undefined) {
    const error = validateLookupValue("task_category", body.category);
    if (error) return c.json({ error }, 400);
  }
  return run(c, async () => {
    const row = await updateTask(p.id, p.childId, body, c.var.db);
    if (row) scheduleEmbedOnWrite(c, { sourceType: "task", sourceId: p.childId });
    return row;
  }, "할 일을 찾을 수 없습니다.");
});
customers.delete("/:id/tasks/:childId", zValidator("param", childParam), (c) => {
  const p = c.req.valid("param");
  return run(c, async () => {
    const row = await deleteTask(p.id, p.childId, c.var.db);
    if (row) await deleteEmbeddingBySource("task", p.childId, c.var.db).catch((e) => console.error("[embed-on-write] 삭제 정리 실패:", e));
    return row;
  }, "할 일을 찾을 수 없습니다.");
});
```

**(c) 고객 PATCH(니즈 3필드)** — 기존 101행의 `return run(c, () => updateCustomer(...), ...)`를 교체:

```ts
    return run(c, async () => {
      const row = await updateCustomer(c.req.valid("param").id, finalPatch, c.var.db);
      if (row) {
        const id = c.req.valid("param").id;
        // 니즈 3필드 중 이번 PATCH에 온 키만 재임베딩(스펙 결정 3). 값 비움 포함 —
        // 훅의 fresh read가 빈 텍스트로 판정해 임베딩 행을 삭제한다(경로 통일).
        if (patch.needMemo !== undefined) scheduleEmbedOnWrite(c, { sourceType: "need_memo", sourceId: id });
        if (patch.needCustomerNote !== undefined) scheduleEmbedOnWrite(c, { sourceType: "need_customer_note", sourceId: id });
        if (patch.needReviewNote !== undefined) scheduleEmbedOnWrite(c, { sourceType: "need_review_note", sourceId: id });
      }
      return row;
    }, "고객을 찾을 수 없습니다.");
```

**(d) 견적 3라우트** (기존 270~288행):

```ts
customers.post("/:id/quotes", zValidator("param", idParam), zValidator("json", quoteCreateBody), async (c) => {
  const id = c.req.valid("param").id;
  const body = c.req.valid("json");
  const row = await c.var.db.transaction((tx) => createQuote(id, body, tx));
  // 트랜잭션 resolve(=커밋) 후 스케줄 — 훅의 fresh read가 커밋 전 구값을 보는 것을 방지(스펙 함정).
  scheduleEmbedOnWrite(c, { sourceType: "quote", sourceId: row.id });
  return c.json(row, 201);
});

customers.patch("/:id/quotes/:childId", zValidator("param", childParam), zValidator("json", quotePatchBody), (c) => {
  const p = c.req.valid("param");
  const body = c.req.valid("json");
  return run(c, async () => {
    const row = await c.var.db.transaction((tx) => updateQuote(p.id, p.childId, body, tx));
    if (row) scheduleEmbedOnWrite(c, { sourceType: "quote", sourceId: p.childId }); // 발송(appStatus sent) 포함 — 커밋 후
    return row;
  }, "견적을 찾을 수 없습니다.");
});
customers.delete("/:id/quotes/:childId", zValidator("param", childParam), (c) => {
  const p = c.req.valid("param");
  // 트랜잭션: 견적 삭제와 advisor_quotes 회수(발송 파이프라인 스펙 결정 7)가 함께 성공/실패해야
  // 앱에 회수 실패한 유령 카드가 남지 않는다.
  return run(c, async () => {
    const row = await c.var.db.transaction((tx) => deleteQuote(p.id, p.childId, tx));
    if (row) await deleteEmbeddingBySource("quote", p.childId, c.var.db).catch((e) => console.error("[embed-on-write] 삭제 정리 실패:", e));
    return row;
  }, "견적을 찾을 수 없습니다.");
});
```

- [ ] **Step 5: 통과 확인**

Run: `bun test src/routes/customers.embed.test.ts --env-file=.env.local`
Expected: PASS 4건.

Run: `bun run test:server`
Expected: 전부 PASS — **기존 customers.test.ts가 느려지거나 임베딩 행을 남기지 않는지 확인**(EMBED_ON_WRITE=off 게이트 증명). 확인 쿼리(테스트 후 잔여 0):
`psql "$DATABASE_URL" -c "select count(*) from crm.embeddings e where not exists (select 1 from crm.customers c where c.id = e.customer_id)"` → 0 (FK cascade라 애초에 0이어야 정상).

- [ ] **Step 6: 커밋**

```bash
git add package.json src/routes/customers.ts src/routes/customers.embed.test.ts
git commit -m "feat(crm): 증분 임베딩 라우트 배선 — 메모/할일/니즈/견적 8콜사이트+동기 삭제 3곳, test:server 게이트 off"
```

---

### Task 8: 백필 스크립트 — quote collect + hash skip + 고아 정리

**Files:**
- Modify: `src/scripts/backfill-embeddings.ts`

스크립트는 자동 테스트 없음(수동 실행 도구) — Task 9에서 실 실행으로 검증한다.

- [ ] **Step 1: import·quote collect 추가**

import 블록 수정:

```ts
import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { getDefaultDb } from "../db/client";
import { customers, customerMemos, customerTasks, consultations, embeddings, quotes, quoteScenarios } from "../db/schema";
import { upsertEmbedding } from "../db/queries/embeddings";
import { buildChunkContent, buildQuoteChunkText, contentHash, type CorpusRow } from "../lib/assistant-corpus";
import { embedTexts } from "../lib/gemini-embed";
import { resolveGeminiTarget } from "../lib/gemini-target";
```

`gather()`의 니즈 블록 뒤(return 직전)에 추가:

```ts
  // 견적: 견적당 1청크 — 대표 시나리오(primary_scenario_id 일치, 없으면 scenario_no 최소) 기준(스펙 결정 2).
  const quoteRows = await db
    .select({
      id: quotes.id, customerId: quotes.customerId, name: customers.name, quoteCode: quotes.quoteCode,
      brandName: quotes.brandName, modelName: quotes.modelName, trimName: quotes.trimName,
      appStatus: quotes.appStatus, sentAt: quotes.sentAt, guidance: quotes.guidance,
      primaryScenarioId: quotes.primaryScenarioId,
    })
    .from(quotes).innerJoin(customers, eq(customers.id, quotes.customerId));
  const scRows = await db
    .select({
      id: quoteScenarios.id, quoteId: quoteScenarios.quoteId, scenarioNo: quoteScenarios.scenarioNo,
      purchaseMethod: quoteScenarios.purchaseMethod, termMonths: quoteScenarios.termMonths,
      monthlyPayment: quoteScenarios.monthlyPayment, lender: quoteScenarios.lender,
    })
    .from(quoteScenarios).orderBy(asc(quoteScenarios.scenarioNo));
  const scByQuote = new Map<string, typeof scRows>();
  for (const s of scRows) {
    const list = scByQuote.get(s.quoteId) ?? [];
    list.push(s);
    scByQuote.set(s.quoteId, list);
  }
  for (const q of quoteRows) {
    const list = scByQuote.get(q.id) ?? [];
    const sc = list.find((s) => s.id === q.primaryScenarioId) ?? list[0] ?? null;
    rows.push({ sourceType: "quote", sourceId: q.id, customerId: q.customerId, customerName: q.name, text: buildQuoteChunkText(q, sc) });
  }
```

- [ ] **Step 2: main()에 hash skip 적용**

`main()`을 다음으로 교체:

```ts
async function main() {
  const rows = await gather();
  const contents = rows.map(buildChunkContent);
  const hashes = contents.map(contentHash);

  // hash skip(스펙 결정 4): 기존 행과 content가 같으면 재임베딩하지 않는다 — 재실행 비용 절감.
  const existing = await db
    .select({ sourceType: embeddings.sourceType, sourceId: embeddings.sourceId, contentHash: embeddings.contentHash })
    .from(embeddings);
  const hashByKey = new Map(existing.map((r) => [`${r.sourceType}/${r.sourceId}`, r.contentHash]));
  const pendingIdx = rows.map((_, i) => i).filter((i) => hashByKey.get(`${rows[i].sourceType}/${rows[i].sourceId}`) !== hashes[i]);
  console.log(`코퍼스 ${rows.length}청크 수집 — ${pendingIdx.length} 임베딩 대상, ${rows.length - pendingIdx.length} skip(hash 동일)`);

  const vectors = await embedTexts(pendingIdx.map((i) => contents[i]), geminiTarget, "RETRIEVAL_DOCUMENT");
  // 임베딩 개수가 대상 수와 다르면 인덱스 매핑이 어긋나므로 중단(부분 응답 방어).
  if (vectors.length !== pendingIdx.length) throw new Error(`임베딩 개수(${vectors.length}) != 대상 청크 수(${pendingIdx.length}) — 매핑 불일치`);
  let ok = 0;
  for (let k = 0; k < pendingIdx.length; k++) {
    const i = pendingIdx[k];
    try {
      await upsertEmbedding({
        sourceType: rows[i].sourceType, sourceId: rows[i].sourceId, customerId: rows[i].customerId,
        content: contents[i], contentHash: hashes[i], embedding: vectors[k],
      }, db);
      ok++;
    } catch (e) { console.error(`upsert 실패 ${rows[i].sourceType}/${rows[i].sourceId}:`, e); }
  }
  console.log(`백필 완료: ${ok}/${pendingIdx.length} upsert`);

  await cleanupOrphans();
  process.exit(0);
}
```

- [ ] **Step 3: 고아 정리 함수 추가**

`main()` 위에 추가:

```ts
// 고아 정리(스펙 결정 6): 원본이 삭제됐거나 텍스트가 비워진 임베딩 행 제거 — 삭제 훅 도입 전 축적분 청소.
// need_*는 고객 행이 남는 한 cascade가 못 지우므로 "필드 비워짐"도 고아로 본다. 고객 삭제는 FK cascade가 처리.
async function cleanupOrphans() {
  const deleted = await db.execute(sql`
    delete from crm.embeddings e where
      (e.source_type = 'memo' and not exists (
        select 1 from crm.customer_memos m where m.id = e.source_id and btrim(coalesce(m.body, '')) <> ''))
      or (e.source_type = 'task' and not exists (
        select 1 from crm.customer_tasks t where t.id = e.source_id and btrim(coalesce(t.body, '')) <> ''))
      or (e.source_type = 'consultation' and not exists (
        select 1 from crm.consultations cs where cs.id = e.source_id and btrim(coalesce(cs.summary, '')) <> ''))
      or (e.source_type = 'quote' and not exists (
        select 1 from crm.quotes q where q.id = e.source_id))
      or (e.source_type = 'need_memo' and not exists (
        select 1 from crm.customers c where c.id = e.source_id and btrim(coalesce(c.need_memo, '')) <> ''))
      or (e.source_type = 'need_customer_note' and not exists (
        select 1 from crm.customers c where c.id = e.source_id and btrim(coalesce(c.need_customer_note, '')) <> ''))
      or (e.source_type = 'need_review_note' and not exists (
        select 1 from crm.customers c where c.id = e.source_id and btrim(coalesce(c.need_review_note, '')) <> ''))
    returning e.id
  `);
  console.log(`고아 정리: ${[...(deleted as Iterable<unknown>)].length}행 삭제`);
}
```

파일 상단 주석(1행)도 갱신:

```ts
// 코퍼스(상담메모·상담이력·니즈메모·할일·견적)를 임베딩해 crm.embeddings에 upsert하는 보정 스크립트.
// 증분 임베딩 훅(embed-on-write) 도입 후에는 백필이 아니라 복구/정리 도구다 — hash skip으로 재실행 저비용.
```

- [ ] **Step 4: 정적 검증 후 커밋**

Run: `bun run typecheck && bun run lint`
Expected: 0 problems. (실 실행은 Task 9.)

```bash
git add src/scripts/backfill-embeddings.ts
git commit -m "feat(crm): 백필 확장 — 견적 청크 collect + hash skip + 고아 정리(보정 도구화)"
```

---

### Task 9: 최종 검증 — 4종+build, 백필 실 실행, 로컬 스모크

**Files:** 없음(검증 전용 — 스모크 스크립트는 스크래치에 만들고 커밋하지 않는다)

- [ ] **Step 1: 전체 검증**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build`
Expected: 전부 green, lint 0 problems.

- [ ] **Step 2: 백필 실 실행 (master — 견적 소급 적재 + 고아 정리)**

Run: `bun run src/scripts/backfill-embeddings.ts`
Expected 로그 3종: `코퍼스 N청크 수집 — M 임베딩 대상, K skip(hash 동일)`(K>0 — 기존 메모/할일 등은 skip), `백필 완료: M/M upsert`, `고아 정리: X행 삭제`.

확인: `psql "$DATABASE_URL" -c "select source_type, count(*) from crm.embeddings group by 1 order by 1"` — `quote` 행 존재.

- [ ] **Step 3: 로컬 end-to-end 스모크 (실 Gemini — 한국 IP 직결)**

스크래치 디렉토리에 일회용 스크립트를 만들어 in-process로 검증한다(브라우저/서버 기동 불필요, makeTestAuth 사용):

1. 스모크 고객 생성 → POST 메모("스모크 임베딩 검증용 유니크 문구") → `crm.embeddings`에 행 생길 때까지 폴링(실 Gemini 임베딩).
2. POST `/api/assistant/ask` `{question: "스모크 임베딩 검증용 문구 관련 메모 있어?"}` → 응답 answer/sources에 해당 메모 근거 포함 확인(RAG 반영 증명).
3. 견적 생성(시나리오 포함) → 임베딩 행 폴링 → content에 견적코드 포함 확인.
4. **원복(공유 master 원칙)**: 견적 삭제(→임베딩 동기 제거 확인), 고객 삭제(cascade), `/ask`로 생성된 `crm.assistant_messages` 스모크 행 삭제.

Expected: 각 단계 실측 통과 + 원복 후 잔여 데이터 0.

- [ ] **Step 4: 마무리**

- `ref/active-session-brief.md`의 Current Focus를 이 슬라이스 완료 상태로 갱신(다음 세션 인계).
- 이 plan 파일 맨 끝 "구현 편차 노트"에 실제 구현과 plan의 차이를 기록.

```bash
git add ref/active-session-brief.md ref/plans/2026-07-05-crm-quote-corpus-embed-on-write.md
git commit -m "docs(crm): brief — 견적 코퍼스+증분 임베딩 슬라이스 완료 기록"
```

이후 superpowers:finishing-a-development-branch로 PR 생성 여부를 사용자와 확정한다(gh pr create — squash 머지, `[skip ci]` 금지).

---

## 구현 편차 노트

(구현 중 plan과 달라진 결정을 여기에 기록 — 코드 블록보다 이 노트가 우선한다.)

- Task 6 확정 편차: `EmbedOnWriteJob`에서 `customerId` 제거(스펙에는 잔존) — fresh read가 원본 행에서 얻으므로 중복.
- Task 4 확정 편차: 스펙의 "holdStreamLifetime 재사용+finally(release)" 대신 전용 `holdWork`(dbHold 체인) — 같은 요청 다건 스케줄(니즈 3필드 동시 PATCH)에서 덮어쓰기로 앞선 작업이 잘리는 문제 방지.
