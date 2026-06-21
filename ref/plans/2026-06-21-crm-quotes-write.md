# crm 견적 쓰기(#4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 김민준 견적함의 기존 견적 변경(메타 수정·삭제·decision/app status 토글)을 `useState`→DB로 영속화한다.

**Architecture:** 4개 쓰기 동작이 모두 같은 quote의 부분 변경이라 단일 `PATCH /api/customers/:id/quotes/:quoteId`(헤더 부분 + 선택적 대표 시나리오) + `DELETE`로 수렴. #55 자식 CRUD와 동일한 3계층(query/route/lib) + Kim 핸들러 낙관+롤백 wiring. 헤더+시나리오 갱신은 라우트가 트랜잭션으로 감싼다.

**Tech Stack:** Hono + drizzle(postgres-js) + zod / React(useState 낙관 갱신) / bun test.

**Spec:** `ref/specs/2026-06-21-crm-quotes-write-design.md`

**선행 사실(확인됨):**
- 스키마: `crm.quotes`(`src/db/schema.ts:120`)·`crm.quote_scenarios`(`:170`). 컬럼명 camelCase 프로퍼티. `quotes.revision` default 0 NOT NULL. `quoteScenarios.quoteId` ON DELETE CASCADE. `quotes.primaryScenarioId` nullable.
- 쿼리 패턴: `updateCustomer`(`src/db/queries/customers.ts:46`)가 `.returning({id})` → null이면 404. `Executor = Db | tx`(`src/db/client.ts:31`). 트랜잭션은 라우트에서 `c.var.db.transaction((tx)=>fn(...,tx))`(`src/routes/catalog/trims.ts:49`).
- 라우트 패턴: `customers.patch("/:id/memos/:childId", zValidator(...), (c)=>run(c,()=>updateMemo(...),"…없습니다."))`(`src/routes/customers.ts:58`). `childParam = z.object({ id: z.uuid(), childId: z.uuid() })`(`:51`). `run()`(`src/routes/shared.ts`): null+msg→404, throw→500.
- 프론트 lib 패턴: `customer-children.ts`가 `sendVoid` + 성공 시 `invalidateCustomerDetail(cid)`. `http.ts`의 `sendVoid(url,method,body)`.
- wiring 패턴: `customer.id`(실 uuid) 존재. 낙관 후 `if (customer.id && !id.startsWith("kim-")) void api(...).catch(()=>{ setX(prev); onToast("…실패"); })`(`CustomerDetailPage.tsx:2783` 등). 새 견적 임시 id는 `kim-quote-…`라 동일 가드로 자동 제외.
- 대상 핸들러: `saveQuote` edit 분기(`:2156-2202`)·`deleteQuote`(`:2408`)·`sendQuoteToApp`(`:2419`)·`updateQuoteDecisionStatus`(`:2434`).
- 검증 명령: `bun run typecheck` · `bun run lint` · `bun run test:unit` · `bun run test:server`(= `bun test --env-file=.env.local`) · `bun run build`. 서버테스트는 master 실DB 사용.

---

## Task 1: 프론트 파싱 헬퍼 (순수, TDD)

견적함 표시 문자열(`term="60개월"`, `monthlyPayment="월 2,473,200원"`)을 시나리오 컬럼값(smallint/numeric)으로 변환하는 순수 함수. PATCH 바디 빌드에 사용.

**Files:**
- Create: `client/src/lib/customer-quotes.ts`
- Test: `client/src/lib/customer-quotes.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `client/src/lib/customer-quotes.test.ts`:

```ts
import { describe, expect, it } from "vitest"; // 클라 단위테스트는 vitest(bun:test 아님)

import { parseTermMonths, parseMonthlyPayment } from "./customer-quotes";

describe("parseTermMonths", () => {
  it("'60개월' → 60", () => expect(parseTermMonths("60개월")).toBe(60));
  it("'60' → 60", () => expect(parseTermMonths("60")).toBe(60));
  it("빈 문자열 → null", () => expect(parseTermMonths("")).toBeNull());
  it("'조건 미정' 같은 비숫자 → null", () => expect(parseTermMonths("조건 미정")).toBeNull());
});

describe("parseMonthlyPayment", () => {
  it("'월 2,473,200원' → '2473200'", () => expect(parseMonthlyPayment("월 2,473,200원")).toBe("2473200"));
  it("'2473200' → '2473200'", () => expect(parseMonthlyPayment("2473200")).toBe("2473200"));
  it("빈 문자열 → null", () => expect(parseMonthlyPayment("")).toBeNull());
  it("숫자 없음 → null", () => expect(parseMonthlyPayment("확인 전")).toBeNull());
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test:unit client/src/lib/customer-quotes.test.ts`
Expected: FAIL — `parseTermMonths`/`parseMonthlyPayment` export 없음.

- [ ] **Step 3: 최소 구현**

Create `client/src/lib/customer-quotes.ts`:

```ts
import { invalidateCustomerDetail } from "./customers";
import { sendVoid } from "./http";

// 견적함 표시 문자열 → 시나리오 컬럼값. 숫자만 남겨 파싱한다.

// "60개월"/"60" → 60, 숫자 없으면 null(smallint term_months).
export function parseTermMonths(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isNaN(n) ? null : n;
}

// "월 2,473,200원"/"2473200" → "2473200", 숫자 없으면 null(numeric monthly_payment은 문자열로 전송).
export function parseMonthlyPayment(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? digits : null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:unit client/src/lib/customer-quotes.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/customer-quotes.ts client/src/lib/customer-quotes.test.ts
git commit -m "feat(crm): 견적 쓰기 #4b — 시나리오 값 파싱 헬퍼 + 테스트"
```

---

## Task 2: 백엔드 쿼리 `customer-quotes.ts`

`updateQuote`(헤더 부분 + 대표 시나리오 1건) + `deleteQuote`. `id AND customer_id` 가드, `.returning` null→404. 트랜잭션은 라우트가 감싸므로 쿼리는 `ex`(Executor)에서 순차 실행.

**Files:**
- Create: `src/db/queries/customer-quotes.ts`

(이 Task의 검증은 Task 3 라우트 라운드트립 테스트에서 함께 확인 — 쿼리 단독 테스트는 작성하지 않음, 자식 CRUD 관례와 동일.)

- [ ] **Step 1: 구현**

Create `src/db/queries/customer-quotes.ts`:

```ts
import { and, asc, eq, sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { quotes, quoteScenarios } from "../schema";

// PATCH 바디(라우트 zod와 동형). 전부 optional — 보낸 것만 갱신.
export type QuoteHeaderPatch = {
  status?: string | null;
  entryMode?: string | null;
  quoteRound?: string | null;
  stockStatus?: string | null;
  brandName?: string | null;
  modelName?: string | null;
  trimName?: string | null;
  appStatus?: string | null;
  decisionStatus?: string | null;
  note?: string | null;
  bumpRevision?: boolean;
};
export type QuoteScenarioPatch = {
  purchaseMethod?: string | null;
  termMonths?: number | null;
  monthlyPayment?: string | null;
  lender?: string | null;
};
export type QuotePatch = QuoteHeaderPatch & { scenario?: QuoteScenarioPatch };

// 헤더 컬럼만 골라 set 객체로(컬럼 아닌 키 bumpRevision/scenario는 제외).
function headerSet(p: QuoteHeaderPatch): Record<string, unknown> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (p.status !== undefined) set.status = p.status;
  if (p.entryMode !== undefined) set.entryMode = p.entryMode;
  if (p.quoteRound !== undefined) set.quoteRound = p.quoteRound;
  if (p.stockStatus !== undefined) set.stockStatus = p.stockStatus;
  if (p.brandName !== undefined) set.brandName = p.brandName;
  if (p.modelName !== undefined) set.modelName = p.modelName;
  if (p.trimName !== undefined) set.trimName = p.trimName;
  if (p.decisionStatus !== undefined) set.decisionStatus = p.decisionStatus;
  if (p.note !== undefined) set.note = p.note;
  if (p.appStatus !== undefined) {
    set.appStatus = p.appStatus;
    if (p.appStatus === "sent") set.sentAt = new Date(); // 발송 시 서버가 시각 확정
  }
  if (p.bumpRevision) set.revision = sql`${quotes.revision} + 1`;
  return set;
}

function scenarioSet(s: QuoteScenarioPatch): Record<string, unknown> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (s.purchaseMethod !== undefined) set.purchaseMethod = s.purchaseMethod;
  if (s.termMonths !== undefined) set.termMonths = s.termMonths;
  if (s.monthlyPayment !== undefined) set.monthlyPayment = s.monthlyPayment;
  if (s.lender !== undefined) set.lender = s.lender;
  return set;
}

// 기존 견적 헤더 + 대표 시나리오 1건 갱신. customer_id 가드 불일치/없는 quoteId면 null(→404).
// 대표 시나리오 = primary_scenario_id 일치 → 없으면 scenario_no 최소.
export async function updateQuote(
  customerId: string,
  quoteId: string,
  patch: QuotePatch,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string } | null> {
  const [row] = await ex
    .update(quotes)
    .set(headerSet(patch))
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)))
    .returning({ id: quotes.id, primaryScenarioId: quotes.primaryScenarioId });
  if (!row) return null;

  if (patch.scenario) {
    const scs = await ex
      .select({ id: quoteScenarios.id })
      .from(quoteScenarios)
      .where(eq(quoteScenarios.quoteId, quoteId))
      .orderBy(asc(quoteScenarios.scenarioNo));
    const target = scs.find((s) => s.id === row.primaryScenarioId) ?? scs[0];
    if (target) {
      await ex.update(quoteScenarios).set(scenarioSet(patch.scenario)).where(eq(quoteScenarios.id, target.id));
    }
  }
  return { id: row.id };
}

// 견적 삭제(시나리오는 ON DELETE CASCADE). customer_id 가드 불일치/없으면 null(→404).
export async function deleteQuote(
  customerId: string,
  quoteId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string } | null> {
  const [row] = await ex
    .delete(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)))
    .returning({ id: quotes.id });
  return row ?? null;
}
```

- [ ] **Step 2: 타입 컴파일 확인**

Run: `bun run typecheck`
Expected: PASS (라우트 미연결 상태라 쿼리 자체 타입만 확인).

- [ ] **Step 3: 커밋**

```bash
git add src/db/queries/customer-quotes.ts
git commit -m "feat(crm): 견적 쓰기 #4b — updateQuote/deleteQuote 쿼리"
```

---

## Task 3: 백엔드 라우트 + 서버 라운드트립 테스트

`PATCH·DELETE /:id/quotes/:childId`. 헤더 update + 대표 시나리오 update를 트랜잭션으로. 생성 API가 없으므로 테스트는 throwaway 견적을 직접 insert 후 라우트를 검증한다.

**Files:**
- Modify: `src/routes/customers.ts` (import + zod body + 라우트 2개)
- Test: `src/routes/customers.test.ts` (append)

- [ ] **Step 1: 실패 테스트 작성**

Append to `src/routes/customers.test.ts` (파일 상단 import에 추가: `import { getDefaultDb } from "../db/client";` 와 `import { quotes, quoteScenarios } from "../db/schema";` 와 `import { and, eq } from "drizzle-orm";`):

```ts
// throwaway 견적 1건 + 대표 시나리오 1건을 직접 insert(생성 API는 #4c라 없음). 반환 id로 라우트를 검증.
async function seedThrowawayQuote(customerId: string) {
  const db = getDefaultDb();
  const [q] = await db.insert(quotes).values({
    quoteCode: `QT-TEST-${crypto.randomUUID().slice(0, 8)}`,
    customerId, entryMode: "manual", appStatus: "draft", status: "작성중", revision: 0,
  }).returning({ id: quotes.id });
  const [s] = await db.insert(quoteScenarios).values({
    quoteId: q.id, scenarioNo: 1, purchaseMethod: "운용리스", termMonths: 60, lender: "iM캐피탈", monthlyPayment: "2473200",
  }).returning({ id: quoteScenarios.id });
  await db.update(quotes).set({ primaryScenarioId: s.id }).where(eq(quotes.id, q.id));
  return q.id;
}

test("견적 쓰기: PATCH 헤더+대표시나리오 → getCustomer 반영", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const quoteId = await seedThrowawayQuote(cid);

  const patched = await app.request(`/api/customers/${cid}/quotes/${quoteId}`, {
    method: "PATCH", headers: h,
    body: JSON.stringify({
      note: "수정됨", appStatus: "sent", bumpRevision: true, decisionStatus: "confirmed",
      scenario: { purchaseMethod: "장기렌트", termMonths: 48, monthlyPayment: "1999000", lender: "우리금융캐피탈" },
    }),
  });
  expect(patched.status).toBe(200);

  const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
    quotes: Array<{ id: string; note: string | null; appStatus: string | null; decisionStatus: string | null; revision: number; sentAt: string | null; scenarios: Array<{ purchaseMethod: string | null; termMonths: number | null; monthlyPayment: string | null; lender: string | null }> }>;
  };
  const q = detail.quotes.find((x) => x.id === quoteId)!;
  expect(q.note).toBe("수정됨");
  expect(q.appStatus).toBe("sent");
  expect(q.decisionStatus).toBe("confirmed");
  expect(q.revision).toBe(1);
  expect(q.sentAt).not.toBeNull();
  expect(q.scenarios[0].purchaseMethod).toBe("장기렌트");
  expect(q.scenarios[0].termMonths).toBe(48);
  expect(q.scenarios[0].monthlyPayment).toBe("1999000");
  expect(q.scenarios[0].lender).toBe("우리금융캐피탈");

  // cleanup
  await app.request(`/api/customers/${cid}/quotes/${quoteId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
});

test("견적 쓰기: DELETE → 200, getCustomer에서 사라짐(시나리오 cascade)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const quoteId = await seedThrowawayQuote(cid);

  const removed = await app.request(`/api/customers/${cid}/quotes/${quoteId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  expect(removed.status).toBe(200);

  const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { quotes: Array<{ id: string }> };
  expect(detail.quotes.some((x) => x.id === quoteId)).toBe(false);
  const leftover = await getDefaultDb().select({ id: quoteScenarios.id }).from(quoteScenarios).where(eq(quoteScenarios.quoteId, quoteId));
  expect(leftover.length).toBe(0);
});

test("견적 쓰기: 없는 quoteId PATCH/DELETE → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const missing = "00000000-0000-0000-0000-000000000000";
  expect((await app.request(`/api/customers/${cid}/quotes/${missing}`, { method: "PATCH", headers: h, body: JSON.stringify({ note: "x" }) })).status).toBe(404);
  expect((await app.request(`/api/customers/${cid}/quotes/${missing}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })).status).toBe(404);
});

test("견적 쓰기: 교차 고객 가드 — 다른 고객 id로 PATCH → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const otherCid = list[1].id;
  const quoteId = await seedThrowawayQuote(cid);

  const res = await app.request(`/api/customers/${otherCid}/quotes/${quoteId}`, { method: "PATCH", headers: h, body: JSON.stringify({ note: "x" }) });
  expect(res.status).toBe(404);

  // cleanup
  await app.request(`/api/customers/${cid}/quotes/${quoteId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test:server src/routes/customers.test.ts`
Expected: FAIL — 라우트 미존재라 PATCH/DELETE가 404가 아닌 다른 결과(혹은 매칭 실패).

- [ ] **Step 3: 라우트 구현**

In `src/routes/customers.ts`, import 추가(기존 query import 옆):

```ts
import { deleteQuote, updateQuote } from "../db/queries/customer-quotes";
```

자식 라우트 zod 정의들(`scheduleBody` 아래) 다음에 추가:

```ts
const quoteScenarioBody = z.object({
  purchaseMethod: z.string().nullable().optional(),
  termMonths: z.number().int().nullable().optional(),
  monthlyPayment: z.string().nullable().optional(),
  lender: z.string().nullable().optional(),
});
const quotePatchBody = z.object({
  status: z.string().nullable().optional(),
  entryMode: z.enum(["manual", "solution", "original"]).nullable().optional(),
  quoteRound: z.string().nullable().optional(),
  stockStatus: z.enum(["재고있음", "재고없음", "재고확인중"]).nullable().optional(),
  brandName: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
  trimName: z.string().nullable().optional(),
  appStatus: z.enum(["draft", "queued", "sent", "viewed"]).nullable().optional(),
  decisionStatus: z.enum(["none", "considering", "confirmed", "contracting"]).nullable().optional(),
  note: z.string().nullable().optional(),
  bumpRevision: z.boolean().optional(),
  scenario: quoteScenarioBody.optional(),
});
```

서류 라우트 위(또는 schedule 라우트 아래)에 라우트 2개 추가:

```ts
// ── 견적 쓰기(기존 견적 메타/시나리오 수정·삭제·상태 토글) ──────────
customers.patch("/:id/quotes/:childId", zValidator("param", childParam), zValidator("json", quotePatchBody), (c) => {
  const p = c.req.valid("param");
  const body = c.req.valid("json");
  return run(c, () => c.var.db.transaction((tx) => updateQuote(p.id, p.childId, body, tx)), "견적을 찾을 수 없습니다.");
});
customers.delete("/:id/quotes/:childId", zValidator("param", childParam), (c) => {
  const p = c.req.valid("param");
  return run(c, () => deleteQuote(p.id, p.childId, c.var.db), "견적을 찾을 수 없습니다.");
});
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:server src/routes/customers.test.ts`
Expected: PASS (신규 4 테스트 + 기존 전부).

- [ ] **Step 5: 커밋**

```bash
git add src/routes/customers.ts src/routes/customers.test.ts
git commit -m "feat(crm): 견적 쓰기 #4b — PATCH/DELETE 라우트 + 라운드트립 테스트"
```

---

## Task 4: 프론트 API lib (updateQuote/deleteQuote)

Task 1 파일에 API 함수 추가. 성공 시 `invalidateCustomerDetail`(상세 캐시 불변식).

**Files:**
- Modify: `client/src/lib/customer-quotes.ts`

- [ ] **Step 1: 구현 추가**

Append to `client/src/lib/customer-quotes.ts`:

```ts
// PATCH 바디(서버 zod와 동형). 보낸 키만 갱신.
export type QuoteWritePatch = {
  status?: string | null;
  entryMode?: "manual" | "solution" | "original" | null;
  quoteRound?: string | null;
  stockStatus?: "재고있음" | "재고없음" | "재고확인중" | null;
  brandName?: string | null;
  modelName?: string | null;
  trimName?: string | null;
  appStatus?: "draft" | "queued" | "sent" | "viewed" | null;
  decisionStatus?: "none" | "considering" | "confirmed" | "contracting" | null;
  note?: string | null;
  bumpRevision?: boolean;
  scenario?: {
    purchaseMethod?: string | null;
    termMonths?: number | null;
    monthlyPayment?: string | null;
    lender?: string | null;
  };
};

// 기존 견적 부분 수정. 성공 시 상세 캐시 무효화(재진입 stale 방지).
export async function updateQuote(customerId: string, quoteId: string, patch: QuoteWritePatch): Promise<void> {
  await sendVoid(`/api/customers/${customerId}/quotes/${quoteId}`, "PATCH", patch);
  invalidateCustomerDetail(customerId);
}

// 견적 삭제. 성공 시 상세 캐시 무효화.
export async function deleteQuote(customerId: string, quoteId: string): Promise<void> {
  await sendVoid(`/api/customers/${customerId}/quotes/${quoteId}`, "DELETE");
  invalidateCustomerDetail(customerId);
}
```

- [ ] **Step 2: 타입 확인**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: 커밋**

```bash
git add client/src/lib/customer-quotes.ts
git commit -m "feat(crm): 견적 쓰기 #4b — 프론트 updateQuote/deleteQuote lib"
```

---

## Task 5: Kim 핸들러 4개 wiring (낙관+롤백)

`CustomerDetailPage.tsx`의 견적 핸들러 4개에 백그라운드 PATCH/DELETE를 붙인다. 새 견적(`kim-quote-…`)은 가드로 자동 제외(생성=#4c).

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: import 추가**

`CustomerDetailPage.tsx` 상단의 `@/lib/customer-children` import 줄(`:6`) 다음에 추가:

```ts
import { updateQuote as apiUpdateQuote, deleteQuote as apiDeleteQuote, parseTermMonths, parseMonthlyPayment, type QuoteWritePatch } from "@/lib/customer-quotes";
```

- [ ] **Step 2: `saveQuote` edit 분기 wiring**

`saveQuote`의 edit 분기에서, 낙관 `setQuotes(...)` **직전**에 롤백 스냅샷을 잡고, `onToast(...)` **앞**에 PATCH 호출을 추가한다. `:2156` `if (quoteComposerMode === "edit" && editingQuoteId) {` 블록을 다음으로 교체(기존 setQuotes/상태정리 유지 + 앞뒤로 스냅샷·PATCH 추가):

```ts
    if (quoteComposerMode === "edit" && editingQuoteId) {
      const sentAt = formatKoreanShortTime();
      const prevQuotes = quotes;
      const prev = quotes.find((quote) => quote.id === editingQuoteId);
      setQuotes((current) => current.map((quote) => (
        quote.id === editingQuoteId ? {
          ...quote,
          title: nextTitle,
          status: "고객 확인 전",
          source,
          appStatus: "sent",
          vehicleName,
          brand: brand || quote.brand,
          model: model || quote.model,
          trim: trim || vehicleName || quote.trim,
          financeType,
          term,
          monthlyPayment,
          lender: lender || quote.lender,
          quoteRound: quoteRound || quote.quoteRound,
          stockStatus: stockStatus || quote.stockStatus,
          validLabel: validLabel || quote.validLabel,
          note: meta || quote.note,
          sentAt,
          viewedAt: undefined,
          revisedAt: sentAt,
          revision: (quote.revision ?? 1) + 1,
          decisionStatus: quote.decisionStatus === "contracting" ? quote.decisionStatus : "none",
          originalNeedsReplacement: Boolean(quote.fileName),
          meta: meta || `${sentAt} · 수정 후 앱 재발송`,
          ...(recognizedQuoteFile ? {
            fileName: recognizedQuoteFile.fileName,
            fileSize: recognizedQuoteFile.fileSize,
            mimeType: recognizedQuoteFile.mimeType,
            file: recognizedQuoteFile.file,
            originalNeedsReplacement: false,
          } : {}),
        } : quote
      )));
      if (customer.id && !editingQuoteId.startsWith("kim-")) {
        const patch: QuoteWritePatch = {
          status: "고객 확인 전",
          entryMode: source,
          appStatus: "sent",
          bumpRevision: true,
          quoteRound: quoteRound || prev?.quoteRound || null,
          stockStatus: (stockStatus || prev?.stockStatus) ?? null,
          brandName: (brand || prev?.brand) ?? null,
          modelName: (model || prev?.model) ?? null,
          trimName: (trim || vehicleName || prev?.trim) ?? null,
          note: meta || prev?.note || null,
          decisionStatus: prev?.decisionStatus === "contracting" ? "contracting" : "none",
          scenario: {
            purchaseMethod: financeType || null,
            termMonths: parseTermMonths(term),
            monthlyPayment: parseMonthlyPayment(monthlyPayment),
            lender: lender || prev?.lender || null,
          },
        };
        void apiUpdateQuote(customer.id, editingQuoteId, patch).catch(() => { setQuotes(prevQuotes); onToast("견적 저장에 실패했습니다."); });
      }
      setQuoteComposerMode(null);
      setEditingQuoteId(null);
      setRecognizedQuoteFile(null);
      setConfirmingQuoteDeleteId(null);
      setConfirmingQuoteContractId(null);
      setOpenQuoteActionId(null);
      setQuoteActionFrame(null);
      markRecentUpdate("견적함");
      onToast("수정 견적을 앱 견적함으로 재발송하고 푸시알림을 보냈습니다.");
      return;
    }
```

- [ ] **Step 3: `deleteQuote` wiring**

`:2408` `deleteQuote` 함수를 다음으로 교체:

```ts
  function deleteQuote(id: string) {
    const targetQuote = quotes.find((quote) => quote.id === id);
    if (targetQuote?.objectUrl) URL.revokeObjectURL(targetQuote.objectUrl);
    const prevQuotes = quotes;
    setQuotes((current) => current.filter((quote) => quote.id !== id));
    setPreviewQuoteId((current) => (current === id ? null : current));
    setConfirmingQuoteDeleteId(null);
    setConfirmingQuoteContractId(null);
    if (customer.id && !id.startsWith("kim-")) {
      void apiDeleteQuote(customer.id, id).catch(() => { setQuotes(prevQuotes); onToast("삭제에 실패했습니다."); });
    }
    markRecentUpdate("견적함");
    onToast("견적 항목을 삭제했습니다.");
  }
```

- [ ] **Step 4: `sendQuoteToApp` wiring**

`:2419` `sendQuoteToApp` 함수를 다음으로 교체:

```ts
  function sendQuoteToApp(id: string) {
    const sentAt = formatKoreanShortTime();
    const prevQuotes = quotes;
    setQuotes((current) => current.map((quote) => (
      quote.id === id ? {
        ...quote,
        status: "고객 확인 전",
        appStatus: "sent",
        sentAt,
        meta: `${sentAt} · 앱 발송완료`,
      } : quote
    )));
    if (customer.id && !id.startsWith("kim-")) {
      void apiUpdateQuote(customer.id, id, { status: "고객 확인 전", appStatus: "sent" }).catch(() => { setQuotes(prevQuotes); onToast("발송 저장에 실패했습니다."); });
    }
    markRecentUpdate("견적함");
    onToast(`김민준 고객 앱 견적함으로 발송했습니다. 대상: CU-2605-0020`);
  }
```

- [ ] **Step 5: `updateQuoteDecisionStatus` wiring**

`:2434` `updateQuoteDecisionStatus` 함수를 다음으로 교체:

```ts
  function updateQuoteDecisionStatus(id: string, decisionStatus: KimQuoteItem["decisionStatus"]) {
    const prevQuotes = quotes;
    setQuotes((current) => current.map((quote) => (
      quote.id === id ? { ...quote, decisionStatus } : quote
    )));
    if (customer.id && !id.startsWith("kim-") && decisionStatus) {
      void apiUpdateQuote(customer.id, id, { decisionStatus }).catch(() => { setQuotes(prevQuotes); onToast("저장에 실패했습니다."); });
    }
    markRecentUpdate("견적함");
    onToast(decisionStatus === "contracting" ? "계약 진행 견적으로 표시했습니다." : decisionStatus === "confirmed" ? "고객 확정 견적으로 표시했습니다." : decisionStatus === "considering" ? "최종 고민중 견적으로 표시했습니다." : "견적 확정 상태를 해제했습니다.");
  }
```

- [ ] **Step 6: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS (0 problems). `apiUpdateQuote`/`apiDeleteQuote`/`parseTermMonths`/`parseMonthlyPayment`/`QuoteWritePatch` 사용으로 unused import 없음.

- [ ] **Step 7: 커밋**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 견적 쓰기 #4b — Kim 견적 핸들러 4개 DB 연결(낙관+롤백)"
```

---

## Task 6: 전체 검증 + 문서 갱신

**Files:**
- Modify: `ref/active-session-brief.md` (완료 항목 추가)

- [ ] **Step 1: 전체 검증 4종**

Run:
```bash
bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build
```
Expected: typecheck 0 · lint 0 · test:unit PASS(파싱 8 추가) · test:server PASS(견적 쓰기 4 추가) · build OK.

- [ ] **Step 2: 브리프 갱신**

`ref/active-session-brief.md`의 "완료" 영역에 #4b 항목을 1줄 요약으로 추가하고, "다음 작업 후보"의 #4 견적을 #4c(생성·워크벤치)·#4d(원본)로 갱신. Current Focus 줄도 갱신. (60줄 이하 유지 — 핸드오프 관례.)

- [ ] **Step 3: 커밋**

```bash
git add ref/active-session-brief.md
git commit -m "docs(brief): 견적 쓰기 #4b 완료 기록"
```

- [ ] **Step 4: 브라우저 수동 검증(인증 세션, 배포 후 또는 로컬 dev)**

다음을 확인하고 결과를 사용자에게 보고:
- 김민준 견적 메타 수정 → **새로고침해도 유지**(이전엔 원복).
- 견적 삭제 → 새로고침 후에도 삭제 유지.
- 앱 발송 토글 → app_status/sent 유지.
- decision 토글(확정/고민중/계약/해제) → 유지.
- 실패 경로(네트워크 차단)에서 롤백 토스트.

> ⚠️ 로컬 dev 주의(메모리 `crm-dev-environment-pitfalls`): `dev:api`는 watch 없음 → 백엔드 변경 후 `bun dev` 재시작 필수. 프론트 캐시는 Cmd+Shift+R(detailCache 60s).

---

## 미결 / 다음 (이 plan 범위 밖)

- **#4c**: 견적 생성(composer add `:2204` + `saveQuoteFromWorkbench` `:2243`) → quote+scenarios INSERT. 대표 시나리오 지정·다중 시나리오 비교 UI도 여기서(PATCH 바디 scenario를 N건+primary 지정으로 확장).
- **#4d**: 원본 파일 업로드(`attachQuoteFileToQuote` `:2300`) → 서류 #3 Storage 재사용(`file_*` 컬럼).
- `valid_until`(D-day) 날짜 편집 UI는 별도.
- 견적 도메인 거대파일 분해는 #4c 데이터화 이후(`KimQuoteItem` 타입 변경 가능).
