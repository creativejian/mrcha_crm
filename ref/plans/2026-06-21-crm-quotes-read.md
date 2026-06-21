# crm 견적 읽기(#4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 김민준 견적함을 `kimMinjunQuoteHistory` mock const에서 DB(`crm.quotes` + `crm.quote_scenarios`) read로 전환한다.

**Architecture:** 기존 read-first 3계층(#46/#51) 확장. `getCustomer`가 quote + scenarios[]를 중첩 로드 → `GET /api/customers/:id` 응답에 포함 → 프론트 어댑터 `toKimQuoteItem`이 대표 시나리오를 평탄화해 기존 `KimQuoteItem` 형태로 변환. UI는 state 초기값 출처만 바뀜(미저장 로컬 조작은 그대로).

**Tech Stack:** Hono + drizzle-orm(postgres-js) 백엔드, React + vitest 프론트, bun:test 서버 테스트, drizzle 시드 스크립트.

**Spec:** `ref/specs/2026-06-21-crm-quotes-read-design.md`

---

## File Structure

- `src/db/queries/customers.ts` — `getCustomer`에 quotes+scenarios 로드, `CustomerDetail` 타입에 `quotes` 추가 (수정)
- `src/routes/customers.test.ts` — `GET :id` 응답에 quotes 배열 포함 검증 (수정)
- `client/src/lib/kim-quote.ts` — **신규**. `KimQuoteItem` 타입(페이지에서 이동) + raw 응답 타입(`CustomerDetailQuote`/`CustomerDetailScenario`) + 평탄화 어댑터 `toKimQuoteItem` + 파생 헬퍼
- `client/src/lib/kim-quote.test.ts` — **신규**. `toKimQuoteItem` 단위테스트
- `client/src/lib/customers.ts` — `CustomerDetailResponse`/`CustomerDetailData`에 `quotes` 추가, `toCustomerDetail` 통과 (수정)
- `client/src/lib/customers.test.ts` — `toCustomerDetail`가 quotes 통과 검증 (수정)
- `client/src/pages/CustomerDetailPage.tsx` — `KimQuoteItem` 정의 제거(kim-quote import), `kimMinjunQuoteHistory` mock 제거, quotes state 초기값을 `detail.quotes.map((q) => toKimQuoteItem(q, Date.now()))`로 교체 (수정)
- `scripts/seed-customers.ts` — 김민준 견적 3 + 시나리오 3 시드 블록 추가 (수정)

---

## Task 1: 백엔드 — getCustomer에 quotes + scenarios 로드

**Files:**
- Modify: `src/db/queries/customers.ts`
- Test: `src/routes/customers.test.ts`

- [ ] **Step 1: 서버 테스트 추가 (실패 확인용)**

`src/routes/customers.test.ts` 끝에 추가:

```ts
test("GET /api/customers/:id → quotes(+scenarios) 배열 포함", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const res = await app.request(`/api/customers/${list[0].id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { quotes: Array<{ id: string; scenarios: unknown[] }> };
  expect(Array.isArray(body.quotes)).toBe(true);
  for (const q of body.quotes) expect(Array.isArray(q.scenarios)).toBe(true);
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `bun run test:server`
Expected: 새 테스트가 FAIL (`body.quotes`가 undefined → `Array.isArray(undefined)` false)

- [ ] **Step 3: getCustomer 구현 수정**

`src/db/queries/customers.ts`:
- import 라인에 `inArray` 추가, schema import에 `quotes`, `quoteScenarios` 추가:

```ts
import { asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import {
  consultations,
  customerDocuments,
  customerMemos,
  customers,
  customerSchedules,
  customerTasks,
  quotes,
  quoteScenarios,
} from "../schema";
```

- `CustomerDetail` 타입 위에 견적 묶음 타입 추가하고 `CustomerDetail`에 `quotes` 필드 추가:

```ts
export type QuoteWithScenarios = typeof quotes.$inferSelect & {
  scenarios: (typeof quoteScenarios.$inferSelect)[];
};

export type CustomerDetail = typeof customers.$inferSelect & {
  tasks: (typeof customerTasks.$inferSelect)[];
  schedules: (typeof customerSchedules.$inferSelect)[];
  memos: (typeof customerMemos.$inferSelect)[];
  documents: Omit<typeof customerDocuments.$inferSelect, "filePath">[];
  consultations: (typeof consultations.$inferSelect)[];
  quotes: QuoteWithScenarios[];
};
```

- `getCustomer`의 `Promise.all` 배열에 quotes 로드를 6번째로 추가하고, scenarios를 quoteIds 기준 한 번에 묶어 그룹핑한 뒤 반환에 포함:

```ts
export async function getCustomer(id: string, executor: Executor = getDefaultDb()): Promise<CustomerDetail | null> {
  const [customer] = await executor.select().from(customers).where(eq(customers.id, id));
  if (!customer) return null;
  // 자식 6개는 병렬(1 배치). quotes는 scenarios 묶음을 위해 id 목록을 먼저 받아야 하므로 그 뒤 1 왕복 추가.
  const [tasks, schedules, memos, documents, consults, quoteRows] = await Promise.all([
    executor.select().from(customerTasks).where(eq(customerTasks.customerId, id)),
    executor.select().from(customerSchedules).where(eq(customerSchedules.customerId, id)),
    executor.select().from(customerMemos).where(eq(customerMemos.customerId, id)),
    executor
      .select({
        id: customerDocuments.id,
        customerId: customerDocuments.customerId,
        title: customerDocuments.title,
        docType: customerDocuments.docType,
        fileName: customerDocuments.fileName,
        fileSize: customerDocuments.fileSize,
        fileMime: customerDocuments.fileMime,
        sortOrder: customerDocuments.sortOrder,
        createdAt: customerDocuments.createdAt,
      })
      .from(customerDocuments)
      .where(eq(customerDocuments.customerId, id))
      .orderBy(asc(customerDocuments.sortOrder), asc(customerDocuments.createdAt)),
    executor.select().from(consultations).where(eq(consultations.customerId, id)),
    executor.select().from(quotes).where(eq(quotes.customerId, id)).orderBy(asc(quotes.createdAt)),
  ]);

  const quoteIds = quoteRows.map((q) => q.id);
  const scenarioRows = quoteIds.length
    ? await executor.select().from(quoteScenarios).where(inArray(quoteScenarios.quoteId, quoteIds)).orderBy(asc(quoteScenarios.scenarioNo))
    : [];
  const scenariosByQuote = new Map<string, (typeof quoteScenarios.$inferSelect)[]>();
  for (const s of scenarioRows) {
    const arr = scenariosByQuote.get(s.quoteId);
    if (arr) arr.push(s);
    else scenariosByQuote.set(s.quoteId, [s]);
  }
  const quotesWithScenarios: QuoteWithScenarios[] = quoteRows.map((q) => ({ ...q, scenarios: scenariosByQuote.get(q.id) ?? [] }));

  return { ...customer, tasks, schedules, memos, documents, consultations: consults, quotes: quotesWithScenarios };
}
```

라우트(`src/routes/customers.ts`)는 `getCustomer` 결과를 그대로 `c.json(...)` 하므로 **수정 불필요**.

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `bun run test:server`
Expected: 전체 PASS (기존 + 신규 1건)

- [ ] **Step 5: 커밋**

```bash
git add src/db/queries/customers.ts src/routes/customers.test.ts
git commit -m "feat(crm): getCustomer가 quotes+scenarios 중첩 로드"
```

---

## Task 2: 프론트 lib — kim-quote.ts (타입 이동 + 평탄화 어댑터)

**Files:**
- Create: `client/src/lib/kim-quote.ts`
- Test: `client/src/lib/kim-quote.test.ts`

> 메모: `KimQuoteItem` 타입을 `CustomerDetailPage.tsx`에서 이 파일로 **이동**한다(필드 82-113 동일). 페이지는 Task 4에서 import로 전환. 어댑터를 lib에 두는 이유는 단위테스트 가능(거대 페이지 컴포넌트는 테스트 곤란).

- [ ] **Step 1: 실패 테스트 작성**

Create `client/src/lib/kim-quote.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { toKimQuoteItem, type CustomerDetailQuote } from "./kim-quote";

const NOW = new Date("2026-05-28T12:00:00+09:00").getTime();

function makeQuote(over: Partial<CustomerDetailQuote> = {}): CustomerDetailQuote {
  return {
    id: "q1",
    quoteCode: "QT-2606-0001",
    entryMode: "solution",
    quoteRound: "1차",
    brandName: "벤츠",
    modelName: "Maybach S-Class",
    trimName: "S 500 4M Long",
    status: "고객 확인 전",
    appStatus: "sent",
    decisionStatus: "none",
    stockStatus: "재고있음",
    note: "비고",
    validUntil: "2026-06-03T12:00:00+09:00", // NOW + 6일
    sentAt: "2026-05-28T12:39:00+09:00",
    viewedAt: null,
    revision: 0,
    primaryScenarioId: "s1",
    scenarios: [
      { id: "s1", scenarioNo: 1, purchaseMethod: "운용리스", lender: "iM캐피탈", termMonths: 60, monthlyPayment: "2473200" },
    ],
    ...over,
  };
}

describe("toKimQuoteItem", () => {
  it("대표 시나리오(primaryScenarioId)에서 금융 4필드를 평탄화", () => {
    const k = toKimQuoteItem(makeQuote(), NOW);
    expect(k.financeType).toBe("운용리스");
    expect(k.term).toBe("60개월");
    expect(k.monthlyPayment).toBe("월 2,473,200원");
    expect(k.lender).toBe("iM캐피탈");
  });

  it("quote 헤더 필드 직매핑 + union 좁히기", () => {
    const k = toKimQuoteItem(makeQuote(), NOW);
    expect(k.id).toBe("q1");
    expect(k.quoteCode).toBe("QT-2606-0001");
    expect(k.source).toBe("solution");
    expect(k.appStatus).toBe("sent");
    expect(k.decisionStatus).toBe("none");
    expect(k.stockStatus).toBe("재고있음");
    expect(k.brand).toBe("벤츠");
    expect(k.model).toBe("Maybach S-Class");
    expect(k.trim).toBe("S 500 4M Long");
  });

  it("vehicleName/title은 brand+model+trim 조합", () => {
    const k = toKimQuoteItem(makeQuote(), NOW);
    expect(k.vehicleName).toBe("벤츠 Maybach S-Class S 500 4M Long");
    expect(k.title).toBe("벤츠 Maybach S-Class S 500 4M Long");
  });

  it("validLabel: 미래는 D-day", () => {
    expect(toKimQuoteItem(makeQuote(), NOW).validLabel).toBe("D-6");
  });

  it("validLabel: 과거/null", () => {
    expect(toKimQuoteItem(makeQuote({ validUntil: "2026-05-27T12:00:00+09:00" }), NOW).validLabel).toBe("만료됨");
    expect(toKimQuoteItem(makeQuote({ validUntil: null }), NOW).validLabel).toBeUndefined();
  });

  it("시나리오 비거나 값 null이면 폴백", () => {
    const k = toKimQuoteItem(makeQuote({ primaryScenarioId: null, scenarios: [] }), NOW);
    expect(k.financeType).toBeUndefined();
    expect(k.term).toBe("조건 미정");
    expect(k.monthlyPayment).toBeUndefined();
    expect(k.lender).toBe("금융사 미정");
  });

  it("primaryScenarioId 없으면 scenarioNo 최소를 대표로", () => {
    const k = toKimQuoteItem(
      makeQuote({
        primaryScenarioId: null,
        scenarios: [
          { id: "s2", scenarioNo: 2, purchaseMethod: "할부", lender: "B", termMonths: 36, monthlyPayment: "100" },
          { id: "s1", scenarioNo: 1, purchaseMethod: "운용리스", lender: "A", termMonths: 60, monthlyPayment: "200" },
        ],
      }),
      NOW,
    );
    expect(k.financeType).toBe("운용리스");
  });

  it("알 수 없는 enum 값은 안전 폴백", () => {
    const k = toKimQuoteItem(makeQuote({ entryMode: "weird", appStatus: null, decisionStatus: null, stockStatus: "??" }), NOW);
    expect(k.source).toBe("manual");
    expect(k.appStatus).toBe("draft");
    expect(k.decisionStatus).toBe("none");
    expect(k.stockStatus).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `bun run test:unit client/src/lib/kim-quote.test.ts`
Expected: FAIL ("Cannot find module './kim-quote'")

- [ ] **Step 3: kim-quote.ts 구현**

Create `client/src/lib/kim-quote.ts`:

```ts
import { formatActivity } from "./customers";

// 견적함 UI 항목 타입(기존 CustomerDetailPage 내부 정의에서 이동).
export type KimQuoteItem = {
  id: string;
  quoteCode: string;
  title: string;
  meta: string;
  status: string;
  source: "manual" | "solution" | "original";
  appStatus: "draft" | "queued" | "sent" | "viewed";
  brand?: string;
  model?: string;
  trim?: string;
  quoteRound?: string;
  vehicleName?: string;
  financeType?: string;
  term?: string;
  monthlyPayment?: string;
  lender?: string;
  stockStatus?: "재고있음" | "재고없음" | "재고확인중";
  validLabel?: string;
  note?: string;
  sentAt?: string;
  viewedAt?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  objectUrl?: string;
  file?: File;
  decisionStatus?: "none" | "considering" | "confirmed" | "contracting";
  revision?: number;
  revisedAt?: string;
  originalNeedsReplacement?: boolean;
};

// GET /api/customers/:id 의 quote 1건(drizzle camelCase 직렬화; numeric→string, timestamptz→ISO string).
export type CustomerDetailScenario = {
  id: string;
  scenarioNo: number | null;
  purchaseMethod: string | null;
  lender: string | null;
  termMonths: number | null;
  monthlyPayment: string | null;
};

export type CustomerDetailQuote = {
  id: string;
  quoteCode: string;
  entryMode: string | null;
  quoteRound: string | null;
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  status: string | null;
  appStatus: string | null;
  decisionStatus: string | null;
  stockStatus: string | null;
  note: string | null;
  validUntil: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  revision: number;
  primaryScenarioId: string | null;
  scenarios: CustomerDetailScenario[];
};

const MS_DAY = 86_400_000;
const QUOTE_SOURCES = ["manual", "solution", "original"] as const;
const APP_STATUSES = ["draft", "queued", "sent", "viewed"] as const;
const STOCK_STATUSES = ["재고있음", "재고없음", "재고확인중"] as const;
const DECISION_STATUSES = ["none", "considering", "confirmed", "contracting"] as const;

function asEnum<T extends readonly string[]>(allowed: T, v: string | null, fallback: T[number]): T[number] {
  return v != null && (allowed as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}

// 표시 옵션 enum: 매칭 안 되면 undefined(렌더 시 숨김).
function asOptionalEnum<T extends readonly string[]>(allowed: T, v: string | null): T[number] | undefined {
  return v != null && (allowed as readonly string[]).includes(v) ? (v as T[number]) : undefined;
}

function pickPrimaryScenario(q: CustomerDetailQuote): CustomerDetailScenario | null {
  if (q.scenarios.length === 0) return null;
  if (q.primaryScenarioId) {
    const found = q.scenarios.find((s) => s.id === q.primaryScenarioId);
    if (found) return found;
  }
  return [...q.scenarios].sort((a, b) => (a.scenarioNo ?? 0) - (b.scenarioNo ?? 0))[0];
}

function formatTerm(termMonths: number | null): string {
  return termMonths != null ? `${termMonths}개월` : "조건 미정";
}

function formatMonthly(raw: string | null): string | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (Number.isNaN(n)) return undefined;
  return `월 ${n.toLocaleString("ko-KR")}원`;
}

// valid_until → 화면 D-day. 미래면 "D-N", 지났으면 "만료됨", 없으면 표시 안 함.
function validLabelFromUntil(validUntil: string | null, nowMs: number): string | undefined {
  if (!validUntil) return undefined;
  const until = new Date(validUntil).getTime();
  if (Number.isNaN(until)) return undefined;
  const days = Math.ceil((until - nowMs) / MS_DAY);
  return days > 0 ? `D-${days}` : "만료됨";
}

// 대표 시나리오를 평탄화해 기존 KimQuoteItem 형태로 변환(접근 1). 파일/원본 필드는 읽기 범위 밖.
export function toKimQuoteItem(q: CustomerDetailQuote, nowMs: number): KimQuoteItem {
  const primary = pickPrimaryScenario(q);
  const vehicleName = [q.brandName, q.modelName, q.trimName].filter(Boolean).join(" ");
  return {
    id: q.id,
    quoteCode: q.quoteCode,
    title: vehicleName || q.quoteCode,
    meta: "",
    status: q.status ?? "",
    source: asEnum(QUOTE_SOURCES, q.entryMode, "manual"),
    appStatus: asEnum(APP_STATUSES, q.appStatus, "draft"),
    brand: q.brandName ?? undefined,
    model: q.modelName ?? undefined,
    trim: q.trimName ?? undefined,
    quoteRound: q.quoteRound ?? undefined,
    vehicleName: vehicleName || undefined,
    financeType: primary?.purchaseMethod ?? undefined,
    term: formatTerm(primary?.termMonths ?? null),
    monthlyPayment: formatMonthly(primary?.monthlyPayment ?? null),
    lender: primary?.lender ?? "금융사 미정",
    stockStatus: asOptionalEnum(STOCK_STATUSES, q.stockStatus),
    validLabel: validLabelFromUntil(q.validUntil, nowMs),
    note: q.note ?? undefined,
    sentAt: q.sentAt ? formatActivity(q.sentAt) : undefined,
    viewedAt: q.viewedAt ? formatActivity(q.viewedAt) : undefined,
    decisionStatus: asEnum(DECISION_STATUSES, q.decisionStatus, "none"),
    revision: q.revision,
  };
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `bun run test:unit client/src/lib/kim-quote.test.ts`
Expected: PASS (8 it)

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/kim-quote.ts client/src/lib/kim-quote.test.ts
git commit -m "feat(crm): KimQuoteItem 평탄화 어댑터 toKimQuoteItem(lib/kim-quote)"
```

---

## Task 3: 프론트 lib — customers.ts 응답에 quotes 통과

**Files:**
- Modify: `client/src/lib/customers.ts`
- Test: `client/src/lib/customers.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`client/src/lib/customers.test.ts`:
- import 라인에 raw quote 타입 사용을 위해 `detailRes`에 quotes를 추가하고 검증 케이스 추가.
- 상단 import는 그대로 두고, `detailRes` 객체에 `quotes` 필드를 추가:

```ts
// detailRes 객체 마지막 필드 뒤에 추가 (documents 다음):
  quotes: [
    {
      id: "q1",
      quoteCode: "QT-2606-0001",
      entryMode: "solution",
      quoteRound: "1차",
      brandName: "벤츠",
      modelName: "Maybach S-Class",
      trimName: "S 500 4M Long",
      status: "고객 확인 전",
      appStatus: "sent",
      decisionStatus: "none",
      stockStatus: "재고있음",
      note: null,
      validUntil: null,
      sentAt: null,
      viewedAt: null,
      revision: 0,
      primaryScenarioId: "s1",
      scenarios: [{ id: "s1", scenarioNo: 1, purchaseMethod: "운용리스", lender: "iM캐피탈", termMonths: 60, monthlyPayment: "2473200" }],
    },
  ],
```

- `describe("toCustomerDetail", ...)` 안에 케이스 추가:

```ts
  it("quotes(+scenarios)를 그대로 전달, 누락 시 빈 배열", () => {
    const d = toCustomerDetail(detailRes);
    expect(d.quotes).toHaveLength(1);
    expect(d.quotes[0].quoteCode).toBe("QT-2606-0001");
    expect(d.quotes[0].scenarios[0].purchaseMethod).toBe("운용리스");
    const partial = { ...detailRes, quotes: undefined } as unknown as CustomerDetailResponse;
    expect(toCustomerDetail(partial).quotes).toEqual([]);
  });
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `bun run test:unit client/src/lib/customers.test.ts`
Expected: FAIL (타입에 quotes 없음 → 컴파일/런타임 에러)

- [ ] **Step 3: customers.ts 수정**

`client/src/lib/customers.ts`:
- 상단에 kim-quote raw 타입 import 추가:

```ts
import type { CustomerDetailQuote } from "./kim-quote";
```

- `CustomerDetailResponse` 타입에 `quotes` 추가(documents 다음 줄):

```ts
  documents: CustomerDetailDocument[];
  quotes: CustomerDetailQuote[];
};
```

- `CustomerDetailData` Pick 목록에 `"quotes"` 추가(`| "documents"` 다음):

```ts
  | "documents"
  | "quotes"
>;
```

- `toCustomerDetail` 반환 객체에 quotes 추가(`documents: res.documents ?? [],` 다음):

```ts
    documents: res.documents ?? [],
    quotes: res.quotes ?? [],
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:unit client/src/lib/customers.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/customers.ts client/src/lib/customers.test.ts
git commit -m "feat(crm): CustomerDetail 응답에 quotes 통과(toCustomerDetail)"
```

---

## Task 4: 페이지 — mock 제거 + DB 파생으로 교체

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: KimQuoteItem 정의를 import로 교체**

`CustomerDetailPage.tsx:82-113`의 `type KimQuoteItem = { ... };` 블록 전체를 **삭제**하고, 상단 import(4번째 줄 `@/lib/customers` import 부근)에 추가:

```ts
import { toKimQuoteItem, type KimQuoteItem } from "@/lib/kim-quote";
```

(기존 `import { fetchCustomerDetail, formatActivity, ... } from "@/lib/customers";`는 그대로 둔다.)

- [ ] **Step 2: mock 상수 제거**

`CustomerDetailPage.tsx:318-387`의 `const kimMinjunQuoteHistory: KimQuoteItem[] = [ ... ];` 블록 전체를 **삭제**한다. (참조는 985 한 곳뿐이며 Step 3에서 교체.)

- [ ] **Step 3: quotes state 초기값을 DB 파생으로 교체**

`CustomerDetailPage.tsx:985`:

```ts
  const [quotes, setQuotes] = useState<KimQuoteItem[]>(kimMinjunQuoteHistory);
```

을 아래로 교체:

```ts
  const [quotes, setQuotes] = useState<KimQuoteItem[]>(() => detail.quotes.map((q) => toKimQuoteItem(q, Date.now())));
```

(`detail`은 이미 `KimMinjunDetailContent`의 prop. 이후 로컬 조작(setQuotes)은 #51 패턴대로 미저장 유지.)

- [ ] **Step 4: 타입/린트 검증**

Run: `bun run typecheck`
Expected: 0 errors (KimQuoteItem 참조가 import로 해소, kimMinjunQuoteHistory 미참조)

Run: `bun run lint`
Expected: 0 problems (미사용 import/변수 없음 — `setQuotes` 등 기존 사용 유지)

- [ ] **Step 5: 빌드 확인**

Run: `bun run build`
Expected: 성공

- [ ] **Step 6: 커밋**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 김민준 견적함 초기값을 mock→DB 파생(toKimQuoteItem)"
```

---

## Task 5: 시드 — 김민준 견적 3 + 시나리오 3

**Files:**
- Modify: `scripts/seed-customers.ts`

- [ ] **Step 1: import에 quotes/quoteScenarios 추가**

`scripts/seed-customers.ts:5`:

```ts
import { customerDocuments, customerMemos, customers, customerSchedules, customerTasks, quotes, quoteScenarios } from "../src/db/schema";
```

- [ ] **Step 2: 김민준 블록 끝(documents insert 다음, console.log 앞)에 견적 시드 추가**

`scripts/seed-customers.ts`의 `await db.insert(customerDocuments)...` 다음, `console.log("seeded 김민준...")` 앞에 삽입:

```ts
    // 견적 3건 + 시나리오 3(각 1). 멱등: quote_code 기준 delete→insert(시나리오는 ON DELETE CASCADE).
    // valid_until은 시드 시점 기준 상대 오프셋(D-6/D-4/만료) — 시간 경과 시 D-day가 실제로 줄어드는 것은 정상.
    const dayOffset = (days: number): Date => new Date(Date.now() + days * 86_400_000);
    await db.delete(quotes).where(eq(quotes.customerId, kim.id));
    const quoteSeeds = [
      {
        quoteCode: "QT-2606-0001",
        entryMode: "solution",
        quoteRound: "1차",
        brandName: "벤츠",
        modelName: "Maybach S-Class",
        trimName: "S 500 4M Long",
        status: "고객 확인 전",
        appStatus: "sent",
        decisionStatus: "none",
        stockStatus: "재고있음",
        note: "보증금 30% 기준, 할인 조건 재확인 필요",
        validUntil: dayOffset(6),
        sentAt: ts("5/28 12:39"),
        viewedAt: null as Date | null,
        scenario: { purchaseMethod: "운용리스", lender: "iM캐피탈", termMonths: 60, monthlyPayment: "2473200" as string | null },
      },
      {
        quoteCode: "QT-2606-0002",
        entryMode: "solution",
        quoteRound: "2차",
        brandName: "벤츠",
        modelName: "Maybach S-Class",
        trimName: "S 500 4M Long",
        status: "고객 열람",
        appStatus: "viewed",
        decisionStatus: "confirmed",
        stockStatus: "재고확인중",
        note: "가족 상의 후 최종 조건 확인 예정",
        validUntil: dayOffset(4),
        sentAt: ts("5/28 12:39"),
        viewedAt: ts("5/29 16:08"),
        scenario: { purchaseMethod: "운용리스", lender: "우리금융캐피탈", termMonths: 60, monthlyPayment: "2398000" as string | null },
      },
      {
        quoteCode: "QT-2606-0003",
        entryMode: "manual",
        quoteRound: "1차",
        brandName: "벤츠",
        modelName: "GLC",
        trimName: "재고 비교",
        status: "작성중",
        appStatus: "draft",
        decisionStatus: "none",
        stockStatus: "재고확인중",
        note: "GLC 재고 확인 후 X3 조건과 총비용 비교",
        validUntil: dayOffset(-1),
        sentAt: null as Date | null,
        viewedAt: null as Date | null,
        scenario: { purchaseMethod: "비교 견적", lender: null as string | null, termMonths: null as number | null, monthlyPayment: null as string | null },
      },
    ];
    for (const q of quoteSeeds) {
      const [qrow] = await db
        .insert(quotes)
        .values({
          quoteCode: q.quoteCode,
          customerId: kim.id,
          entryMode: q.entryMode,
          quoteRound: q.quoteRound,
          brandName: q.brandName,
          modelName: q.modelName,
          trimName: q.trimName,
          status: q.status,
          appStatus: q.appStatus,
          decisionStatus: q.decisionStatus,
          stockStatus: q.stockStatus,
          note: q.note,
          validUntil: q.validUntil,
          sentAt: q.sentAt,
          viewedAt: q.viewedAt,
        })
        .returning({ id: quotes.id });
      const [srow] = await db
        .insert(quoteScenarios)
        .values({
          quoteId: qrow.id,
          scenarioNo: 1,
          isSaved: q.appStatus !== "draft",
          purchaseMethod: q.scenario.purchaseMethod,
          lender: q.scenario.lender,
          termMonths: q.scenario.termMonths,
          monthlyPayment: q.scenario.monthlyPayment,
        })
        .returning({ id: quoteScenarios.id });
      // 순환 FK 회피: 시나리오 INSERT 후 대표 지정.
      await db.update(quotes).set({ primaryScenarioId: srow.id }).where(eq(quotes.id, qrow.id));
    }
```

- `console.log` 문구를 갱신:

```ts
    console.log("seeded 김민준(CU-2605-0020) detail: tasks 4 / memos 3 / schedules 1 / documents 2 / quotes 3");
```

- [ ] **Step 3: 시드 실행(멱등)**

Run: `bun run seed:customers`
Expected: `seeded 김민준 ... / quotes 3` 출력, 에러 없음

- [ ] **Step 4: 멱등 재실행 확인**

Run: `bun run seed:customers`
Expected: 동일 출력, 에러 없음(delete→insert로 중복 없음)

- [ ] **Step 5: DB 확인**

Run:
```bash
set -a; source .env.local; set +a; psql "$DATABASE_URL" -c "SELECT q.quote_code, q.app_status, s.purchase_method, s.monthly_payment FROM crm.quotes q LEFT JOIN crm.quote_scenarios s ON s.id = q.primary_scenario_id WHERE q.customer_id = (SELECT id FROM crm.customers WHERE customer_code='CU-2605-0020') ORDER BY q.quote_code;"
```
Expected: 3행(QT-2606-0001/0002/0003), 0001=sent/운용리스/2473200, 0003=draft/비교 견적/(null)

- [ ] **Step 6: 커밋**

```bash
git add scripts/seed-customers.ts
git commit -m "feat(crm): 김민준 견적 3+시나리오 3 시드(멱등)"
```

---

## Task 6: 통합 검증

**Files:** (없음 — 검증만)

- [ ] **Step 1: 전체 정적 검증**

Run: `bun run typecheck` → 0 errors
Run: `bun run lint` → 0 problems

- [ ] **Step 2: 전체 테스트**

Run: `bun run test:unit` → 기존 + 신규(kim-quote 8, customers +1) 통과
Run: `bun run test:server` → 기존 + 신규 1 통과
Run: `bun run build` → 성공

- [ ] **Step 3: 브라우저 수동 검증(인증 세션 필요)**

`bun run dev` 또는 배포본 로그인 후 김민준(`CU-2605-0020`) 상세 → 견적함에 3건이 뜨고, 각 row의 브랜드/모델/트림/차수/구매방식/기간/월납입금/금융사/재고/유효기간(D-day)/메모가 mock과 동일하게 표시되는지 확인. (QT-0003은 "월 납입금 확인 전" 표시)

- [ ] **Step 4: PR 생성**

```bash
git push -u origin feat/crm-quotes-read-4a
gh pr create --title "feat(crm): 견적 읽기 #4a — 김민준 견적함 mock→DB" --body "..."
```

---

## Self-Review 결과

- **Spec 커버리지**: §1 데이터흐름→Task1, §2 매핑/§파생규칙→Task2, §3 시드→Task5, §4 로컬조작(미저장)→Task4 Step3 메모, §검증→Task6. 누락 없음.
- **placeholder**: 없음(모든 코드/명령 구체). PR body의 `...`는 작성 시점 채움(메타).
- **타입 일관성**: `CustomerDetailQuote`(kim-quote 정의) → customers.ts import → 페이지 사용. `toKimQuoteItem(q, nowMs)` 시그니처 Task2/4 동일. `KimQuoteItem` 단일 정의(kim-quote)로 이동.
- **주의**: Task 순서는 1→2→3→4→5→6. Task4(페이지)는 Task2/3 선행 필수(import 대상). Task1/5는 실DB 필요(test:server/seed는 `.env.local`).
