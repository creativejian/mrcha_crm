# crm 견적 생성 #4c-1 (composer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적함 composer "견적 작성"으로 새 견적을 DB에 INSERT(quote 1 + 대표 시나리오 1)하고, 서버가 `quote_code`를 부여한다.

**Architecture:** #4b PATCH의 INSERT 거울. 신규 `POST /api/customers/:id/quotes`가 트랜잭션으로 `nextQuoteCode` → quote INSERT → scenario INSERT → `primary_scenario_id` UPDATE. 프론트는 #55 자식 add 패턴(낙관 추가 + 성공 시 임시 id/코드를 서버값으로 교체, 실패 롤백).

**Tech Stack:** Hono + drizzle(postgres-js) + zod / React(useState 낙관) / bun test.

**Spec:** `ref/specs/2026-06-21-crm-quotes-create-design.md`

**선행 사실(확인됨):**
- composer add 분기(`CustomerDetailPage.tsx:2229~2266`)는 `setQuotes((current)=>[...current, {id:`kim-quote-${Date.now()}`, ...}])`로 폼 값을 로컬 추가만(미저장). 가용 로컬: `source`(이미 manual/solution/original), `status`("작성중"), `brand`/`model`/`trim`/`quoteRound`/`vehicleName`/`financeType`/`term`/`monthlyPayment`/`lender`/`stockStatus`/`meta`/`nextTitle`.
- #4b 산출물 재사용: `customer-quotes.ts`(쿼리/프론트), 라우트가 이미 `import { deleteQuote, updateQuote } from "../db/queries/customer-quotes"` + `idParam`·`quoteScenarioBody` zod 정의 존재. 프론트 `parseTermMonths`/`parseMonthlyPayment`·`http.ts`의 `sendJson` 존재.
- 스키마: `quotes`(`quoteCode` UNIQUE, `revision` default 0, `primaryScenarioId` nullable), `quoteScenarios`(`quoteId` ON DELETE CASCADE, `scenarioNo` smallint).
- 트랜잭션 패턴: 라우트에서 `c.var.db.transaction((tx)=>fn(...,tx))`. `Executor = Db | tx`.
- 서버 코드 생성기 없음 — 클라 `createKimQuoteCode`가 `yearMonth="2606"` 하드코딩. 시드는 `QT-2606-0001~0003`.
- ⚠️ 서버 테스트는 공유 master DB의 `list[0]`(=김민준)에 insert → throwaway는 반드시 `try/finally`로 self-clean(2026-06-21 오염 사고 교훈).
- 검증: `bun run typecheck`·`lint`·`test:server`(=`bun test --env-file=.env.local`)·`build`.

---

## Task 1: 백엔드 쿼리 — nextQuoteCode + createQuote

**Files:**
- Modify: `src/db/queries/customer-quotes.ts`

(검증은 Task 2 라우트 라운드트립에서 — 자식 CRUD 관례와 동일.)

- [ ] **Step 1: import에 `like` 추가**

`src/db/queries/customer-quotes.ts` 첫 줄을 교체:

```ts
import { and, asc, eq, like, sql } from "drizzle-orm";
```

- [ ] **Step 2: 파일 끝에 `nextQuoteCode` + `createQuote` 추가**

```ts
// 다음 견적 코드 QT-YYMM-#### (현재월 기준, 기존 최대 시퀀스 +1). UNIQUE 컬럼이라 서버가 canonical 생성.
export async function nextQuoteCode(ex: Executor = getDefaultDb()): Promise<string> {
  const now = new Date();
  const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `QT-${yymm}-`;
  const rows = await ex.select({ code: quotes.quoteCode }).from(quotes).where(like(quotes.quoteCode, `${prefix}%`));
  const max = rows.reduce((m, r) => {
    const match = r.code.match(/-(\d{4})$/);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// 생성 바디(라우트 zod와 동형). 헤더 + 대표 시나리오 1건.
export type QuoteCreateBody = {
  entryMode?: string | null;
  status?: string | null;
  quoteRound?: string | null;
  stockStatus?: string | null;
  brandName?: string | null;
  modelName?: string | null;
  trimName?: string | null;
  note?: string | null;
  scenario?: QuoteScenarioPatch;
};

// 새 견적 INSERT — quote_code 서버 생성 → quote → scenario(scenario_no=1) → primary_scenario_id UPDATE.
// 라우트가 transaction으로 감싸 호출(ex=tx). app_status는 항상 "draft"(발송 전).
export async function createQuote(
  customerId: string,
  body: QuoteCreateBody,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string; quoteCode: string; createdAt: Date }> {
  const quoteCode = await nextQuoteCode(ex);
  const [q] = await ex.insert(quotes).values({
    quoteCode,
    customerId,
    entryMode: body.entryMode ?? null,
    status: body.status ?? null,
    quoteRound: body.quoteRound ?? null,
    stockStatus: body.stockStatus ?? null,
    brandName: body.brandName ?? null,
    modelName: body.modelName ?? null,
    trimName: body.trimName ?? null,
    note: body.note ?? null,
    appStatus: "draft",
    revision: 0,
  }).returning({ id: quotes.id, quoteCode: quotes.quoteCode, createdAt: quotes.createdAt });

  const [s] = await ex.insert(quoteScenarios).values({
    quoteId: q.id,
    scenarioNo: 1,
    purchaseMethod: body.scenario?.purchaseMethod ?? null,
    termMonths: body.scenario?.termMonths ?? null,
    monthlyPayment: body.scenario?.monthlyPayment ?? null,
    lender: body.scenario?.lender ?? null,
  }).returning({ id: quoteScenarios.id });

  await ex.update(quotes).set({ primaryScenarioId: s.id }).where(eq(quotes.id, q.id));
  return q;
}
```

- [ ] **Step 3: 타입 컴파일 확인**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git add src/db/queries/customer-quotes.ts
git commit -m "feat(crm): 견적 생성 #4c-1 — nextQuoteCode/createQuote 쿼리"
```

---

## Task 2: 라우트 POST + 서버 라운드트립 테스트

**Files:**
- Modify: `src/routes/customers.ts`
- Test: `src/routes/customers.test.ts` (append)

- [ ] **Step 1: 실패 테스트 작성**

`src/routes/customers.test.ts` 끝에 추가(파일은 이미 `getDefaultDb`·`quotes`·`quoteScenarios`·`eq` import 보유):

```ts
test("견적 생성: POST → 201·quote_code 형식·getCustomer 반영(대표 시나리오 포함)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  let createdId: string | undefined;
  try {
    const res = await app.request(`/api/customers/${cid}/quotes`, {
      method: "POST", headers: h,
      body: JSON.stringify({
        entryMode: "manual", status: "작성중", quoteRound: "1차", stockStatus: "재고있음",
        brandName: "벤츠", modelName: "Maybach S-Class", trimName: "S 500 4M Long", note: "테스트 생성",
        scenario: { purchaseMethod: "운용리스", termMonths: 60, monthlyPayment: "2473200", lender: "iM캐피탈" },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; quoteCode: string; createdAt: string };
    createdId = body.id;
    expect(body.quoteCode).toMatch(/^QT-\d{4}-\d{4}$/);

    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      quotes: Array<{ id: string; quoteCode: string; brandName: string | null; appStatus: string | null; primaryScenarioId: string | null; scenarios: Array<{ id: string; purchaseMethod: string | null; termMonths: number | null; lender: string | null }> }>;
    };
    const q = detail.quotes.find((x) => x.id === createdId)!;
    expect(q.quoteCode).toBe(body.quoteCode);
    expect(q.brandName).toBe("벤츠");
    expect(q.appStatus).toBe("draft");
    expect(q.scenarios.length).toBe(1);
    expect(q.scenarios[0].purchaseMethod).toBe("운용리스");
    expect(q.scenarios[0].termMonths).toBe(60);
    expect(q.scenarios[0].lender).toBe("iM캐피탈");
    expect(q.primaryScenarioId).toBe(q.scenarios[0].id); // 대표 시나리오 지정됨
  } finally {
    // 공유 master DB라 항상 정리(scenarios는 ON DELETE CASCADE).
    if (createdId) await getDefaultDb().delete(quotes).where(eq(quotes.id, createdId));
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test:server src/routes/customers.test.ts`
Expected: FAIL — `POST /:id/quotes` 라우트 없음(201 아님).

- [ ] **Step 3: 라우트 구현**

`src/routes/customers.ts`의 import를 교체(기존 `deleteQuote, updateQuote`에 `createQuote` 추가):

```ts
import { createQuote, deleteQuote, updateQuote } from "../db/queries/customer-quotes";
```

`quotePatchBody` 정의 **위**(또는 아래)에 생성용 zod 추가:

```ts
const quoteCreateBody = z.object({
  entryMode: z.enum(["manual", "solution", "original"]).nullable().optional(),
  status: z.string().nullable().optional(),
  quoteRound: z.string().nullable().optional(),
  stockStatus: z.enum(["재고있음", "재고없음", "재고확인중"]).nullable().optional(),
  brandName: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
  trimName: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  scenario: quoteScenarioBody.optional(),
});
```

견적 쓰기 라우트(`customers.patch("/:id/quotes/:childId"…)`) **위**에 POST 추가:

```ts
customers.post("/:id/quotes", zValidator("param", idParam), zValidator("json", quoteCreateBody), async (c) => {
  const id = c.req.valid("param").id;
  const body = c.req.valid("json");
  const row = await c.var.db.transaction((tx) => createQuote(id, body, tx));
  return c.json(row, 201);
});
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:server src/routes/customers.test.ts`
Expected: PASS (신규 1 + 기존 전부).

- [ ] **Step 5: 커밋**

```bash
git add src/routes/customers.ts src/routes/customers.test.ts
git commit -m "feat(crm): 견적 생성 #4c-1 — POST /:id/quotes 라우트 + 라운드트립 테스트"
```

---

## Task 3: 프론트 API lib

**Files:**
- Modify: `client/src/lib/customer-quotes.ts`

- [ ] **Step 1: import에 `sendJson` 추가**

`client/src/lib/customer-quotes.ts`의 http import를 교체:

```ts
import { sendJson, sendVoid } from "./http";
```

- [ ] **Step 2: 파일 끝에 생성 타입 + API 추가**

```ts
// POST 바디(서버 zod와 동형). 헤더 + 대표 시나리오.
export type QuoteCreatePayload = {
  entryMode?: "manual" | "solution" | "original" | null;
  status?: string | null;
  quoteRound?: string | null;
  stockStatus?: "재고있음" | "재고없음" | "재고확인중" | null;
  brandName?: string | null;
  modelName?: string | null;
  trimName?: string | null;
  note?: string | null;
  scenario?: {
    purchaseMethod?: string | null;
    termMonths?: number | null;
    monthlyPayment?: string | null;
    lender?: string | null;
  };
};

// 새 견적 생성. 서버가 quote_code·id 부여 → 반환값으로 낙관 임시 항목을 교체한다. 성공 시 상세 캐시 무효화.
export async function createQuote(customerId: string, payload: QuoteCreatePayload): Promise<{ id: string; quoteCode: string; createdAt: string }> {
  const row = await sendJson<{ id: string; quoteCode: string; createdAt: string }>(`/api/customers/${customerId}/quotes`, "POST", payload);
  invalidateCustomerDetail(customerId);
  return row;
}
```

- [ ] **Step 3: 타입 확인**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git add client/src/lib/customer-quotes.ts
git commit -m "feat(crm): 견적 생성 #4c-1 — 프론트 createQuote lib"
```

---

## Task 4: saveQuote add 분기 wiring (낙관 추가 + id/코드 스왑)

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: import에 createQuote/타입 추가**

`@/lib/customer-quotes` import 줄(현재 `updateQuote as apiUpdateQuote, deleteQuote as apiDeleteQuote, parseTermMonths, parseMonthlyPayment, type QuoteWritePatch`)을 교체:

```ts
import { updateQuote as apiUpdateQuote, deleteQuote as apiDeleteQuote, createQuote as apiCreateQuote, parseTermMonths, parseMonthlyPayment, type QuoteWritePatch, type QuoteCreatePayload } from "@/lib/customer-quotes";
```

- [ ] **Step 2: add 분기 교체(임시 id 추출 + 낙관 추가 + 스왑/롤백)**

add 분기의 **`setQuotes((current) => { ... });` 한 문장만** 교체한다(`:2229`의 `setQuotes((current) => {` 부터 `:2258`의 닫는 `});`까지). **그 뒤의 `setQuoteComposerMode(null)`·`setEditingQuoteId(null)`·`setRecognizedQuoteFile(null)`·`setConfirmingQuoteDeleteId(null)`·`setConfirmingQuoteContractId(null)`·`markRecentUpdate("견적함")`·`onToast("견적 항목이 추가되었습니다.")`(`:2259~2265`)는 그대로 둔다**(composer 닫기·정리). 교체 내용:

```ts
    const tempId = `kim-quote-${Date.now()}`;
    const tempQuoteCode = createKimQuoteCode(quotes);
    setQuotes((current) => [...current, {
      id: tempId,
      quoteCode: tempQuoteCode,
      title: nextTitle,
      status,
      source,
      appStatus: "draft",
      brand,
      model: model || vehicleName,
      trim: trim || vehicleName,
      quoteRound: quoteRound || "1차",
      vehicleName,
      financeType,
      term,
      monthlyPayment,
      lender,
      stockStatus: stockStatus || "재고확인중",
      validLabel,
      note: meta,
      meta: meta || `${formatKoreanShortTime()} · ${source === "original" ? "원본 인식" : "내부 작성"}`,
      ...(recognizedQuoteFile ? {
        fileName: recognizedQuoteFile.fileName,
        fileSize: recognizedQuoteFile.fileSize,
        mimeType: recognizedQuoteFile.mimeType,
        file: recognizedQuoteFile.file,
      } : {}),
    }]);
    if (customer.id) {
      const payload: QuoteCreatePayload = {
        entryMode: source,
        status,
        quoteRound: quoteRound || "1차",
        stockStatus: stockStatus || "재고확인중",
        brandName: brand || null,
        modelName: (model || vehicleName) || null,
        trimName: (trim || vehicleName) || null,
        note: meta || null,
        scenario: {
          purchaseMethod: financeType || null,
          termMonths: parseTermMonths(term),
          monthlyPayment: parseMonthlyPayment(monthlyPayment),
          lender: lender || null,
        },
      };
      void apiCreateQuote(customer.id, payload)
        .then(({ id, quoteCode }) => setQuotes((current) => current.map((q) => (q.id === tempId ? { ...q, id, quoteCode } : q))))
        .catch(() => { setQuotes((current) => current.filter((q) => q.id !== tempId)); onToast("견적 저장에 실패했습니다."); });
    }
```

- [ ] **Step 3: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS (0 problems). `apiCreateQuote`/`QuoteCreatePayload` 사용으로 unused import 없음.

- [ ] **Step 4: 커밋**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 견적 생성 #4c-1 — composer add 분기 DB 연결(낙관+id/코드 스왑)"
```

---

## Task 5: 전체 검증 + 브리프 갱신

**Files:**
- Modify: `ref/active-session-brief.md`

- [ ] **Step 1: 전체 검증**

Run:
```bash
bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build
```
Expected: typecheck 0 · lint 0 · test:unit 206(불변) · test:server +1(견적 생성) · build OK.

- [ ] **Step 2: 브리프 갱신**

`ref/active-session-brief.md` Current Focus와 Next에 #4c-1 완료를 1~2줄로 추가하고, #4c를 #4c-1(완료)·#4c-2(워크벤치)·#4c-3(다중 시나리오)으로 정리. 스펙/플랜 경로 명시.

- [ ] **Step 3: 커밋**

```bash
git add ref/active-session-brief.md ref/specs/2026-06-21-crm-quotes-create-design.md ref/plans/2026-06-21-crm-quotes-create.md
git commit -m "docs(crm): 견적 생성 #4c-1 스펙·플랜·브리프"
```

- [ ] **Step 4: 브라우저 수동 검증(인증 세션)**

- 견적함 `+` → composer "견적 작성" → 차량/방식/조건 입력 → "견적함에 저장" → 목록에 새 견적 추가(상태 `발송 전`).
- **`Cmd+Shift+R`** → 새 견적이 **유지**되고 `quote_code`가 `QT-2606-####`로 부여됨(이전엔 원복).
- 실패 경로(Network Offline)에서 낙관 항목 사라지고 "견적 저장에 실패했습니다" 토스트.
- 검증 후 시드 원복 원하면 `bun run seed:customers`(새로 만든 견적은 시드 대상 아니라 남음 → 필요 시 견적함에서 직접 삭제[#4b]).

---

## 미결 / 다음 (이 plan 범위 밖)

- **#4c-2 워크벤치 저장**: `saveQuoteFromWorkbench`(Maybach mock) → 실 입력(pricing/options/colors/discounts/vehicle) 매핑. 제품 결정 선행.
- **#4c-3 다중 시나리오 + 대표 지정 UI**: scenario 1~3 비교, primary 지정.
- **#4d 원본 업로드**: composer 원본 인식 모드의 file_* 영속(서류 Storage 재사용).
- `valid_until`(D-day) 날짜 입력 UI, `quote_code` 멀티 상담사 동시생성 UNIQUE 재시도.
