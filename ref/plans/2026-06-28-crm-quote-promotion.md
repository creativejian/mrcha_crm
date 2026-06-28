# 앱 견적요청 → 견적 승격(S3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 견적요청 인박스의 연결된(app_user) 행에서 "견적 작성"을 누르면 그 고객 워크벤치가 차량·구매방식·옵션이 prefill된 채 열리고, 작성된 견적은 `source_quote_request_id`로 원 요청을 가리키며, 인박스에 "견적 N건" 배지가 뜬다.

**Architecture:** 백엔드 3계층(`db/queries/quote-requests.ts`·`customer-quotes.ts` → `routes` → `lib`)에 단건 fetch·source 저장·역참조 카운트를 추가하고, 프론트는 URL 쿼리(`?quoteRequest=<id>`)로 워크벤치를 자동 오픈해 **`editPrefill`(수정·가격 포함)과 별개 경로**로 차량/옵션/구매방식만 채운다(가격은 catalog 계산 보존).

**Tech Stack:** Hono + drizzle-orm(postgres-js) + Cloudflare Workers, React + react-router, bun:test(서버) / vitest(프론트).

**Spec:** `ref/specs/2026-06-28-crm-quote-promotion-design.md`

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/db/queries/quote-requests.ts` | 견적요청 read(인박스·단건·역참조) | `getQuoteRequestDetail` 신설 + `listQuoteRequests`에 `promotedQuoteCount` + `AppQuoteRequestRow` 확장 |
| `src/routes/quote-requests.ts` | 견적요청 라우트 | `GET /:id` 추가 |
| `src/db/queries/customer-quotes.ts` | 견적 write | `QuoteCreateBody`·`createQuote`에 `sourceQuoteRequestId` |
| `src/routes/customers.ts` | 고객/견적 라우트 | `quoteCreateBody` zod에 `sourceQuoteRequestId` |
| `client/src/lib/customer-quotes.ts` | 견적 write lib | `QuoteCreatePayload`에 `sourceQuoteRequestId` |
| `client/src/lib/quote-requests.ts` | 견적요청 read lib·어댑터 | `promotedQuoteCount` 매핑 + `fetchQuoteRequestDetail` + `PAYMENT_METHOD_LABEL` export |
| `client/src/pages/AppRequestsPage.tsx` | 인박스 화면 | "견적 작성" 버튼 + "견적 N건" 배지 |
| `client/src/pages/CustomerDetailPage.tsx` | 고객 상세·워크벤치 | URL prefill 감지 + 견적요청 prefill 경로 + source 저장 |
| `client/src/index.css` | 스타일 | 배지·버튼 스타일 |
| 테스트: `src/routes/quote-requests.test.ts` | 서버 | 단건·역참조 |
| 테스트: `src/routes/customers.test.ts` | 서버 | createQuote source |
| 테스트: `client/src/lib/quote-requests.test.ts` | 프론트 | 어댑터·fetch |

---

## Task 1: 백엔드 — 견적요청 단건 fetch (prefill 데이터원)

**Files:**
- Modify: `src/db/queries/quote-requests.ts`
- Modify: `src/routes/quote-requests.ts`
- Test: `src/routes/quote-requests.test.ts`

**선행 확인 (데이터 의미 검증):** 착수 시 `psql "$DATABASE_URL"`로 `quote_request_options.trim_option_id`가 catalog `trim_options.id`(워크벤치 OptionPicker가 쓰는 id)와 같은 체계인지 1건 실측. 예:
```bash
psql "$DATABASE_URL" -c "select qro.trim_option_id, t.id as catalog_option_id, t.name from public.quote_request_options qro left join catalog.trim_options t on t.id = qro.trim_option_id limit 5;"
```
catalog join이 이름을 반환하면 동일 체계(그대로 진행). 전부 null이면 매핑 체계가 다르므로 STOP하고 보고.

- [ ] **Step 1: Write the failing test**

`src/routes/quote-requests.test.ts` 맨 끝에 추가:

```typescript
import { getQuoteRequestDetail } from "../db/queries/quote-requests";
import { quoteRequestOptions as quoteRequestOptionsTable } from "../db/public-app";

test("getQuoteRequestDetail: 요청의 trimId·paymentMethod·optionIds 반환", async () => {
  const db = getDefaultDb();
  // 옵션이 있는 요청을 하나 고른다(없으면 첫 요청).
  const [opt] = await db.select({ reqId: quoteRequestOptionsTable.quoteRequestId, optId: quoteRequestOptionsTable.trimOptionId }).from(quoteRequestOptionsTable).limit(1);
  const targetId = opt?.reqId
    ?? (await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1))[0].id;
  const detail = await getQuoteRequestDetail(targetId);
  expect(detail).not.toBeNull();
  expect(detail!.id).toBe(targetId);
  expect(Array.isArray(detail!.optionIds)).toBe(true);
  // trimId는 number 또는 null
  expect(detail!.trimId === null || typeof detail!.trimId === "number").toBe(true);
});

test("getQuoteRequestDetail: 없는 요청 → null", async () => {
  const detail = await getQuoteRequestDetail("00000000-0000-0000-0000-000000000000");
  expect(detail).toBeNull();
});

test("GET /api/quote-requests/:id → 200 + detail 형태", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const [req] = await getDefaultDb().select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1);
  const res = await app.request(`/api/quote-requests/${req.id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: string; trimId: number | null; paymentMethod: string | null; optionIds: number[] };
  expect(body.id).toBe(req.id);
  expect(Array.isArray(body.optionIds)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --env-file=.env.local src/routes/quote-requests.test.ts`
Expected: FAIL — `getQuoteRequestDetail` is not exported / not a function.

- [ ] **Step 3: Implement `getQuoteRequestDetail`**

`src/db/queries/quote-requests.ts`의 `listQuoteRequests` 아래(혹은 `nextCustomerCode` 위)에 추가. 파일 상단 import에 이미 `quoteRequestOptions`, `quoteRequests`, `eq` 있음(추가 import 불필요).

```typescript
export type QuoteRequestDetail = {
  id: string;
  trimId: number | null;
  paymentMethod: string | null;
  optionIds: number[];
};

// prefill용 단건 조회. 요청 1행 + 옵션(trim_option_id) 배열. 없으면 null.
export async function getQuoteRequestDetail(
  requestId: string,
  executor: Executor = getDefaultDb(),
): Promise<QuoteRequestDetail | null> {
  const [req] = await executor
    .select({ id: quoteRequests.id, trimId: quoteRequests.trimId, paymentMethod: quoteRequests.paymentMethod })
    .from(quoteRequests)
    .where(eq(quoteRequests.id, requestId));
  if (!req) return null;
  const opts = await executor
    .select({ optId: quoteRequestOptions.trimOptionId })
    .from(quoteRequestOptions)
    .where(eq(quoteRequestOptions.quoteRequestId, requestId));
  const optionIds = opts.map((o) => o.optId).filter((v): v is number => v != null);
  return { id: req.id, trimId: req.trimId, paymentMethod: req.paymentMethod, optionIds };
}
```

- [ ] **Step 4: Add route `GET /:id`**

`src/routes/quote-requests.ts` — import에 `getQuoteRequestDetail` 추가, `GET "/"` 아래에 라우트 추가:

```typescript
import { createCustomerFromRequest, getQuoteRequestDetail, linkRequestToCustomer, listQuoteRequests } from "../db/queries/quote-requests";
```

```typescript
// prefill용 단건(차량·구매방식·옵션ids). 없으면 404.
quoteRequests.get("/:id", zValidator("param", idParam), (c) =>
  run(c, () => getQuoteRequestDetail(c.req.valid("param").id, c.var.db), "요청을 찾을 수 없습니다."),
);
```

> 주의: `GET "/"`(목록)와 `GET "/:id"`(단건) 둘 다 Hono에 등록한다. 라우트 순서상 정적 `/`가 먼저라 충돌 없음.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test --env-file=.env.local src/routes/quote-requests.test.ts`
Expected: PASS (기존 통과 + 신규 3개).

- [ ] **Step 6: Commit**

```bash
git add src/db/queries/quote-requests.ts src/routes/quote-requests.ts src/routes/quote-requests.test.ts
git commit -m "feat(crm): 견적요청 단건 fetch getQuoteRequestDetail + GET /:id (S3)"
```

---

## Task 2: 백엔드 — createQuote에 source_quote_request_id 관통

**Files:**
- Modify: `src/db/queries/customer-quotes.ts:199-230` (`QuoteCreateBody`), `:275-307` (`createQuote` INSERT)
- Modify: `src/routes/customers.ts:100-131` (`quoteCreateBody` zod)
- Modify: `client/src/lib/customer-quotes.ts:78-109` (`QuoteCreatePayload`)
- Test: `src/routes/customers.test.ts`

- [ ] **Step 1: Write the failing test**

`src/routes/customers.test.ts` 맨 끝에 추가(파일 상단 import에 `createQuote`·`quotes`가 없으면 추가; 기존 테스트가 쓰는 import 스타일을 따른다):

```typescript
import { createQuote } from "../db/queries/customer-quotes";
import { quotes as quotesTable } from "../db/schema";
import { quoteRequests as quoteRequestsTable } from "../db/public-app";

test("createQuote: sourceQuoteRequestId를 INSERT에 저장 (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [cust] = await db.select({ id: customers.id }).from(customers).limit(1);
  const [req] = await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      const created = await createQuote(cust.id, { sourceQuoteRequestId: req.id, status: "작성중" }, tx);
      const [q] = await tx.select({ src: quotesTable.sourceQuoteRequestId }).from(quotesTable).where(eq(quotesTable.id, created.id));
      expect(q.src).toBe(req.id);
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
});
```

> `customers.test.ts`에 이미 `getDefaultDb`·`customers`·`eq` import가 있는지 확인하고 없으면 추가. (기존 서버 테스트들이 동일 import를 쓴다.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: FAIL — `sourceQuoteRequestId`가 `QuoteCreateBody` 타입에 없어 컴파일 에러, 혹은 컬럼이 안 채워져 `q.src`가 null.

- [ ] **Step 3: Add field to `QuoteCreateBody` (서버 타입)**

`src/db/queries/customer-quotes.ts`의 `QuoteCreateBody`에 `note?` 줄 아래(헤더 영역)에 추가:

```typescript
  note?: string | null;
  sourceQuoteRequestId?: string | null; // 앱 견적요청 승격(S3) 출처. loose id(FK 없음).
```

- [ ] **Step 4: Add to `createQuote` INSERT values**

같은 파일 `createQuote`의 `ex.insert(quotes).values({ ... })`에서 `note: body.note ?? null,` 아래에 추가:

```typescript
    note: body.note ?? null,
    sourceQuoteRequestId: body.sourceQuoteRequestId ?? null,
```

- [ ] **Step 5: Add to `quoteCreateBody` zod (라우트)**

`src/routes/customers.ts`의 `quoteCreateBody`에서 `note:` 줄 아래에 추가:

```typescript
  note: z.string().nullable().optional(),
  sourceQuoteRequestId: z.uuid().nullable().optional(),
```

- [ ] **Step 6: Add to `QuoteCreatePayload` (클라 타입)**

`client/src/lib/customer-quotes.ts`의 `QuoteCreatePayload`에서 `note?: string | null;` 아래에 추가:

```typescript
  note?: string | null;
  sourceQuoteRequestId?: string | null;
```

- [ ] **Step 7: Run test + typecheck**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts && bun run typecheck`
Expected: PASS, typecheck 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/db/queries/customer-quotes.ts src/routes/customers.ts client/src/lib/customer-quotes.ts src/routes/customers.test.ts
git commit -m "feat(crm): createQuote에 source_quote_request_id 저장 (S3)"
```

---

## Task 3: 백엔드 — listQuoteRequests 승격 역참조 카운트

**Files:**
- Modify: `src/db/queries/quote-requests.ts` (`AppQuoteRequestRow` + `listQuoteRequests` Promise.all batch + return)
- Test: `src/routes/quote-requests.test.ts`

- [ ] **Step 1: Write the failing test**

`src/routes/quote-requests.test.ts` 맨 끝에 추가:

```typescript
import { listQuoteRequests } from "../db/queries/quote-requests";
import { createQuote } from "../db/queries/customer-quotes";

test("listQuoteRequests: source가 붙은 견적이 있으면 promotedQuoteCount 증가 (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [cust] = await db.select({ id: customers.id }).from(customers).limit(1);
  const [req] = await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      const before = (await listQuoteRequests(tx)).find((r) => r.id === req.id);
      expect(before?.promotedQuoteCount).toBe(0);
      await createQuote(cust.id, { sourceQuoteRequestId: req.id }, tx);
      const after = (await listQuoteRequests(tx)).find((r) => r.id === req.id);
      expect(after?.promotedQuoteCount).toBe(1);
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --env-file=.env.local src/routes/quote-requests.test.ts`
Expected: FAIL — `promotedQuoteCount` undefined.

- [ ] **Step 3: Add field to `AppQuoteRequestRow`**

`src/db/queries/quote-requests.ts`의 `AppQuoteRequestRow` 타입에서 `matchType` 위에 추가:

```typescript
  promotedQuoteCount: number;
  matchType: "app_user" | "phone" | "none";
```

- [ ] **Step 4: Add quotes back-reference to the Promise.all batch**

`listQuoteRequests`의 `import` 줄에 `quotes`를 추가:

```typescript
import { customers, quotes } from "../schema";
```

`const [trimRows, optRows, custRows] = await Promise.all([ ... ])`를 **4갈래**로 확장한다 — 기존 3갈래 뒤에 quotes 역참조 한 갈래 추가:

```typescript
  const [trimRows, optRows, custRows, promoRows] = await Promise.all([
    // ... (기존 trimRows 갈래 그대로) ...
    // ... (기존 optRows 갈래 그대로) ...
    // ... (기존 custRows 갈래 그대로) ...
    executor
      .select({ sourceId: quotes.sourceQuoteRequestId })
      .from(quotes)
      .where(inArray(quotes.sourceQuoteRequestId, reqIds)),
  ]);
```

> `reqIds`는 early-return 이후라 항상 1개 이상 → `inArray`가 빈 IN을 만들지 않는다.

- [ ] **Step 5: Build the count map + map into rows**

`const optCount = new Map ...` 아래에 추가:

```typescript
  const promoCount = new Map<string, number>();
  for (const p of promoRows) {
    if (p.sourceId) promoCount.set(p.sourceId, (promoCount.get(p.sourceId) ?? 0) + 1);
  }
```

`return rows.map((r) => { ... })` 안의 반환 객체에서 `matchType` 위에 추가:

```typescript
      promotedQuoteCount: promoCount.get(r.id) ?? 0,
      matchType,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test --env-file=.env.local src/routes/quote-requests.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/queries/quote-requests.ts src/routes/quote-requests.test.ts
git commit -m "feat(crm): listQuoteRequests에 승격 역참조 promotedQuoteCount (S3)"
```

---

## Task 4: 프론트 lib — 어댑터 promotedQuoteCount + fetchQuoteRequestDetail

**Files:**
- Modify: `client/src/lib/quote-requests.ts`
- Test: `client/src/lib/quote-requests.test.ts`

- [ ] **Step 1: Write the failing test**

`client/src/lib/quote-requests.test.ts`에 추가(기존 어댑터 테스트 옆). 기존 테스트가 만드는 `AppQuoteRequestRow` 목 객체 형태를 따르되 `promotedQuoteCount`를 포함:

```typescript
import { describe, expect, it, vi } from "vitest";
import { toAppQuoteRequest, fetchQuoteRequestDetail, type AppQuoteRequestRow } from "./quote-requests";

function makeRow(overrides: Partial<AppQuoteRequestRow> = {}): AppQuoteRequestRow {
  return {
    id: "r1", createdAt: "2026-06-28T00:00:00Z", requesterName: "홍길동", requesterPhone: null,
    paymentMethod: "lease", period: 36, depositType: null, rentalDeposit: null, trimPrice: null,
    status: "open", brandName: "BMW", modelName: "5 Series", trimName: "520i", optionCount: 2,
    promotedQuoteCount: 0, matchedCustomerId: null, matchedCustomerName: null, matchedCustomerCode: null,
    matchType: "none", ...overrides,
  };
}

describe("toAppQuoteRequest promotedQuoteCount", () => {
  it("역참조 카운트를 그대로 노출", () => {
    expect(toAppQuoteRequest(makeRow({ promotedQuoteCount: 3 })).promotedQuoteCount).toBe(3);
    expect(toAppQuoteRequest(makeRow()).promotedQuoteCount).toBe(0);
  });
});

describe("fetchQuoteRequestDetail", () => {
  it("GET /api/quote-requests/:id 호출 + paymentMethod 한글 매핑", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "r1", trimId: 100, paymentMethod: "lease", optionIds: [1, 2] }), { status: 200 }),
    );
    const d = await fetchQuoteRequestDetail("r1");
    expect(spy).toHaveBeenCalled();
    expect(d.trimId).toBe(100);
    expect(d.optionIds).toEqual([1, 2]);
    expect(d.purchaseMethod).toBe("운용리스"); // lease → 한글
    spy.mockRestore();
  });
});
```

> ⚠️ 실제 mock 방식은 기존 `quote-requests.test.ts`의 패턴을 따른다(이 레포가 `getJson`을 어떻게 모킹하는지 확인). 위 `globalThis.fetch` 모킹이 기존 패턴과 다르면 기존 패턴으로 맞춘다. 핵심은 "엔드포인트 호출 + purchaseMethod 한글 매핑" 검증.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:unit client/src/lib/quote-requests.test.ts`
Expected: FAIL — `fetchQuoteRequestDetail` not exported / `promotedQuoteCount` 누락.

- [ ] **Step 3: Add `promotedQuoteCount` to types + adapter**

`client/src/lib/quote-requests.ts`:
- `AppQuoteRequestRow`의 `matchType` 위에 `promotedQuoteCount: number;` 추가.
- `AppQuoteRequest`의 `matchType` 위에 `promotedQuoteCount: number;` 추가.
- `toAppQuoteRequest` 반환 객체에서 `matchType: row.matchType,` 위에 `promotedQuoteCount: row.promotedQuoteCount,` 추가.

- [ ] **Step 4: Export `PAYMENT_METHOD_LABEL` + add `fetchQuoteRequestDetail`**

같은 파일:
- `const PAYMENT_METHOD_LABEL` 앞에 `export`를 붙인다(Task 6의 CustomerDetailPage가 재사용).
- `fetchAppQuoteRequests` 아래에 추가:

```typescript
// prefill용 단건. paymentMethod는 한글 라벨(워크벤치 구매방식 옵션과 일치)로 변환해 반환.
export type QuoteRequestPrefill = {
  id: string;
  trimId: number | null;
  optionIds: number[];
  purchaseMethod: string | null;
};

export async function fetchQuoteRequestDetail(id: string): Promise<QuoteRequestPrefill> {
  const d = await getJson<{ id: string; trimId: number | null; paymentMethod: string | null; optionIds: number[] }>(
    `/api/quote-requests/${id}`,
  );
  return {
    id: d.id,
    trimId: d.trimId,
    optionIds: d.optionIds,
    purchaseMethod: d.paymentMethod ? (PAYMENT_METHOD_LABEL[d.paymentMethod] ?? d.paymentMethod) : null,
  };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun run test:unit client/src/lib/quote-requests.test.ts && bun run typecheck`
Expected: PASS, typecheck 0.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/quote-requests.ts client/src/lib/quote-requests.test.ts
git commit -m "feat(crm): 어댑터 promotedQuoteCount + fetchQuoteRequestDetail (S3)"
```

---

## Task 5: 프론트 UI — 인박스 "견적 작성" 버튼 + "견적 N건" 배지

**Files:**
- Modify: `client/src/pages/AppRequestsPage.tsx`
- Modify: `client/src/index.css`

> 거대 페이지가 아닌 작은 컴포넌트지만 navigate 의존이라 단위테스트 대신 typecheck + 수동 검증(프로젝트 관례: 페이지 컴포넌트는 수동/스크린샷 허용).

- [ ] **Step 1: Add `useNavigate` + "견적 작성" 버튼**

`AppRequestsPage.tsx` 상단 import 수정:

```typescript
import { Link, useNavigate } from "react-router";
```

컴포넌트 본문 상단(`const [rows, ...]` 근처)에 추가:

```typescript
  const navigate = useNavigate();
```

매칭 셀의 `app_user` 분기를 수정 — 기존 "고객 보기" Link 옆에 "견적 작성" 버튼 추가:

```jsx
                  {r.matchType === "app_user" && r.matchedCustomerCode && (
                    <>
                      <button
                        className="app-req-action"
                        type="button"
                        onClick={() => navigate(`/customer-detail/${r.matchedCustomerCode}?quoteRequest=${r.id}`)}
                      >견적 작성</button>
                      <Link className="app-req-action link" to={`/customer-detail/${r.matchedCustomerCode}`}>고객 보기</Link>
                    </>
                  )}
```

- [ ] **Step 2: Add "견적 N건" 배지**

같은 매칭 셀에서 `<span className={MATCH_CLASS[r.matchType]}>{r.matchLabel}</span>` 아래에 추가:

```jsx
                  {r.promotedQuoteCount > 0 && (
                    <span className="app-req-promoted">견적 {r.promotedQuoteCount}건</span>
                  )}
```

- [ ] **Step 3: Add CSS**

`client/src/index.css`에 기존 `.app-req-action` 규칙 근처를 찾아 그 아래에 추가(없으면 `.app-req-match` 근처):

```css
.app-req-promoted {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--brand);
  background: rgba(88, 54, 255, 0.1);
}
```

- [ ] **Step 4: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 errors, 0 problems.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/AppRequestsPage.tsx client/src/index.css
git commit -m "feat(crm): 인박스 견적 작성 버튼 + 견적 N건 배지 (S3)"
```

---

## Task 6: 프론트 통합 — CustomerDetailPage 견적요청 prefill 경로

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`

> 5700줄 거대 컴포넌트. TDD 대신 typecheck + 수동 검증(프로젝트 관례). 구현자는 아래 6개 지점을 정확히 수정한다. **`editPrefill`(수정·가격 포함) 경로를 건드리지 말고** 별개 경로를 추가하는 것이 핵심.

**선행 확인:** `client/src/lib/kim-status-fields.ts`(또는 import 출처)의 `kimQuotePurchaseMethodOptions` 값 목록을 읽어 `운용리스/장기렌트/할부/일시불`이 포함되는지 확인. 불일치하면 Step 4의 매핑을 그 목록에 맞춘다.

- [ ] **Step 1: state 2개 추가**

`KimMinjunDetailContent` 내부의 워크벤치 state 선언부(`const [editPrefill, setEditPrefill] = useState...` 근처)에 추가:

```typescript
  // 앱 견적요청 승격(S3) prefill. editPrefill(수정·가격 포함)과 별개 — 차량/옵션만 채우고 가격은 catalog 계산.
  const [quoteRequestPrefill, setQuoteRequestPrefill] = useState<{ trimId: number | null; optionIds: number[] } | null>(null);
  const [sourceQuoteRequestId, setSourceQuoteRequestId] = useState<string | null>(null);
```

import에 lib 함수 추가:

```typescript
import { fetchQuoteRequestDetail } from "@/lib/quote-requests";
```

react-router 훅이 이 컴포넌트에 없으면 추가(App에서 라우터 안에 렌더되므로 사용 가능):

```typescript
import { useLocation, useNavigate } from "react-router";
```

- [ ] **Step 2: URL `?quoteRequest` 감지 effect**

`KimMinjunDetailContent` 내부, 다른 effect들 근처에 추가. `customer`(prop)에서 코드(`customer.customerId` 또는 `customer.no`로 URL을 만든다 — App.tsx가 `/customer-detail/${customerId}`를 쓰므로 `customer.customerId`)를 얻는다:

```typescript
  const location = useLocation();
  const navigate = useNavigate();
  const quoteRequestPrefillRef = useRef(false); // StrictMode/재렌더 중복 방지

  useEffect(() => {
    const reqId = new URLSearchParams(location.search).get("quoteRequest");
    if (!reqId || quoteRequestPrefillRef.current) return;
    quoteRequestPrefillRef.current = true;
    void fetchQuoteRequestDetail(reqId)
      .then((detail) => {
        // 신규 워크벤치 열기와 동일한 리셋(견적함 + 버튼 onClick과 정렬)
        setConfirmingQuoteDeleteId(null);
        setEditingQuoteId(null);
        persistedQuoteIdRef.current = null;
        setEditPrefill(null);
        resetWorkbenchVehicle();
        setGuidance(DEFAULT_QUOTE_GUIDANCE);
        setManualQuoteCards([...kimManualQuoteConditionCards]);
        setManualTermMonths({});
        setSavedManualQuoteConditionIds([]);
        setRecognizedQuoteFile(null);
        setSolutionWorkbenchEntryMode("manual");
        setSolutionWorkbenchModeMenu(null);
        // 견적요청 prefill 설정
        setQuoteRequestPrefill({ trimId: detail.trimId, optionIds: detail.optionIds });
        setSourceQuoteRequestId(reqId);
        if (detail.purchaseMethod) setSolutionWorkbenchPurchaseMethod(detail.purchaseMethod);
        setIsQuoteSolutionWorkbenchOpen(true);
      })
      .catch(() => { onToast("견적요청 정보를 불러오지 못했습니다."); })
      .finally(() => {
        // URL에서 파라미터 제거(뒤로가기/재렌더 재오픈 방지)
        navigate(`/customer-detail/${customer.customerId}`, { replace: true });
      });
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps -- 진입 시 1회 prefill
```

> `quoteRequestPrefillRef`로 effect 중복 실행을 막고, 끝에 URL 파라미터를 지워 재진입(뒤로가기) 시 재오픈을 방지한다. `customer.customerId`가 App.tsx의 URL code와 일치하는지 확인(불일치 시 navigate 경로를 맞춘다).

- [ ] **Step 3: VehiclePicker `initialTrimId`에 견적요청 trimId 반영**

`<VehiclePicker key={editingQuoteId ?? "new"} initialTrimId={editingQuoteId ? openQuoteActionTrimId() : undefined} ...>` 를 수정 — 신규 모드일 때 `quoteRequestPrefill?.trimId`를 넘긴다:

```jsx
<VehiclePicker key={editingQuoteId ?? "new"} initialTrimId={editingQuoteId ? openQuoteActionTrimId() : (quoteRequestPrefill?.trimId ?? undefined)} onChange={(selection) => { void applyTrimToPricing(selection); }} />
```

- [ ] **Step 4: `applyTrimToPricing`에 견적요청 옵션 prefill 분기**

`applyTrimToPricing` 안에서 옵션/가격 처리를 수정한다. `const prefill = editPrefill;` 아래에 견적요청 prefill을 읽고, **옵션 선택**과 **옵션 총액 계산**에 반영한다(가격 base/discount는 else 분기의 catalog 계산을 그대로 둠):

```typescript
      const prefill = editPrefill;
      const qrPrefill = quoteRequestPrefill; // 견적요청 옵션(가격은 catalog 계산)
      setTrimDetail(detail);
      setWorkbenchVehicle(selection);
      setSelectedWorkbenchOptionIds(prefill ? prefill.optionIds : (qrPrefill?.optionIds ?? []));
      setExteriorColor(prefill ? detail.colors.find((c) => c.id === prefill.exteriorColorId) ?? null : null);
      setInteriorColor(prefill ? detail.colors.find((c) => c.id === prefill.interiorColorId) ?? null : null);
```

else 분기(`} else {` ... catalog 기본값)에서 `setInput("option", 0);`을 견적요청 옵션 총액으로 교체:

```typescript
      } else {
        setInput("base", detail.price);
        const qrOptionTotal = qrPrefill
          ? detail.options.filter((o) => qrPrefill.optionIds.includes(o.id)).reduce((s, o) => s + (o.price ?? 0), 0)
          : 0;
        setInput("option", qrOptionTotal);
        setInput("discount", detail.financialDiscountAmount ?? 0);
        if (primaryDiscount) primaryDiscount.value = formatMoney(detail.financialDiscountAmount ?? 0);
      }
```

함수 끝의 `setEditPrefill(null);` 옆에 견적요청 prefill도 소비(차량 재선택 시 다시 적용되지 않게):

```typescript
      setEditPrefill(null);
      setQuoteRequestPrefill(null);
```

> `sourceQuoteRequestId`는 여기서 지우지 않는다(저장 때 필요). `quoteRequestPrefill`(차량/옵션)만 1회 소비.

- [ ] **Step 5: `persistWorkbenchQuote` 신규 INSERT payload에 source 포함**

`persistWorkbenchQuote`에서 신규 INSERT payload를 만드는 곳(`apiCreateQuote(cid, payload)` 호출 직전, `entryMode`/`status` 등을 담는 `QuoteCreatePayload`)에 `sourceQuoteRequestId`를 추가한다. (Explore 기준 신규 분기는 `!targetId` 블록의 payload — 거기 snapshot spread 옆에 추가):

```typescript
      sourceQuoteRequestId: sourceQuoteRequestId ?? null,
```

INSERT 성공(`apiCreateQuote(...).then(...)`) 콜백 안에서, 인박스 배지 갱신을 위해 source가 있으면 인박스 캐시를 force fresh 한다(이미 import된 `fetchAppQuoteRequestsCached`가 있으면 재사용, 없으면 import):

```typescript
        if (sourceQuoteRequestId) void fetchAppQuoteRequestsCached(true);
```

> import: `import { fetchAppQuoteRequestsCached } from "@/lib/quote-requests";` (Task 2의 fetchQuoteRequestDetail import와 합쳐 한 줄로).

- [ ] **Step 6: `sourceQuoteRequestId` clear (일반 신규/수정 진입)**

source가 견적요청 prefill로 연 워크벤치에만 붙도록, **일반 `+` 신규 열기**(4140 onClick)와 **수정 진입**(openQuoteAction "견적 수정")에 `setSourceQuoteRequestId(null);`를 추가한다. 두 곳 모두 `setEditPrefill(null);` 또는 `setEditingQuoteId(...)` 근처에 한 줄:

```typescript
                  setSourceQuoteRequestId(null);
```

> 워크벤치 닫기 핸들러가 따로 있으면 거기에도 추가하면 더 안전하나, 신규/수정 진입 두 곳이면 충분(다음 INSERT 전에 항상 둘 중 하나를 거침).

- [ ] **Step 7: typecheck + lint + build**

Run: `bun run typecheck && bun run lint && bun run build`
Expected: typecheck 0, lint 0 problems, build OK.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 인박스→워크벤치 견적요청 prefill + source 저장 (S3)"
```

---

## Task 7: 전체 검증 + brief/메모리 갱신

**Files:**
- Modify: `ref/active-session-brief.md`
- Modify: 메모리 `next-task-quote-request-pipeline.md` (별도 — git 아님)

- [ ] **Step 1: 전체 검증**

Run:
```bash
bun run typecheck && bun run lint && bun run test:unit && bun test --env-file=.env.local && bun run build
```
Expected: typecheck 0, lint 0, test:unit 전부 PASS(신규 어댑터/fetch 포함), test:server 전부 PASS(신규 단건 3 + source 1 + 역참조 1), build OK.

- [ ] **Step 2: brief 갱신**

`ref/active-session-brief.md` 최상단 "최신 작업"에 S3 섹션 추가(60줄 이하, 다른 슬라이스 형식 따름): 범위·백엔드/프론트 변경·검증 수치·커밋·spec/plan 경로·⚠️데이터 제약(매칭 0이라 버튼 안 뜸, 로직만 완성)·"파이프라인 S1~S3 완성".

- [ ] **Step 3: Commit brief**

```bash
git add ref/active-session-brief.md
git commit -m "docs(crm): brief에 견적 승격 S3 반영"
```

- [ ] **Step 4: 메모리 갱신**

메모리 `next-task-quote-request-pipeline.md`의 description과 본문을 "S1~S3 머지 완료, 파이프라인 완성"으로 갱신(다음 작업 후보는 실 유입 검증 / 견적 계산엔진 / 고객 앱 노출).

---

## Self-Review (작성자 체크 — 구현 전 참고)

**Spec coverage:**
- 진입 노출(app_user만) → Task 5 ✓
- prefill 전달(URL `?quoteRequest`) → Task 6 Step 2 ✓
- prefill 범위(차량+구매방식+옵션) → Task 6 Step 3·4 ✓ (가격 catalog 계산 보존)
- source 저장(loose id) → Task 2 ✓
- 승격 표시(견적 N건 배지) → Task 3(카운트) + Task 5(배지) ✓
- 단건 fetch → Task 1 ✓
- trim_option_id 매핑 실측 → Task 1 선행 확인 ✓
- 캐시 불변식(invalidateCustomerDetail) → `createQuote` lib에 이미 있음(`customer-quotes.ts:132`); 인박스 force 갱신 → Task 6 Step 5 ✓

**Type consistency:** `promotedQuoteCount`(서버 `AppQuoteRequestRow` ↔ 클라 `AppQuoteRequestRow`/`AppQuoteRequest`), `sourceQuoteRequestId`(`QuoteCreateBody`/zod/`QuoteCreatePayload`/스키마 `sourceQuoteRequestId`), `QuoteRequestPrefill.purchaseMethod`(한글) ↔ `setSolutionWorkbenchPurchaseMethod` — 일관.

**알려진 검증 한계:** 브라우저 e2e는 실 유입(app_user 매칭) 데이터 필요 — 현재 0이라 "견적 작성" 버튼이 안 뜸. 로직/타입/단위·서버 테스트로 검증하고 실 브라우저 검증은 유입 후(유슨생).
