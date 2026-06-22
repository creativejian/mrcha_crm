# 견적 다중 시나리오 #4c-3a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 워크벤치 하단 비교카드의 입력 가능 필드(금융사·보증금·선수금·잔존·약정거리·월납입 + 상단 구매방식)를 추출해 견적당 시나리오 N건(1~3) 저장 + 읽기 어댑터에 scenarios 배열 보존.

**Architecture:** #4c-2 `createQuote`를 scenario 단수 → `scenarios[]` 복수로 확장(단수 폴백으로 composer/#4c-2 하위호환). 비교카드 입력은 controlled 전환 없이 식별자(`data-scenario-card`/`data-sc-field`) 부여 + 저장 시 DOM+mode-state 일괄 추출. DB·읽기쿼리 완비라 마이그레이션 없음. 입력 불가 mock 필드(기간/자동차세/보조금/계산결과)는 #4c-3a 미저장.

**Tech Stack:** Hono + zod + drizzle(postgres-js, master `crm`), React, TypeScript 6.0.3, bun test.

스펙: `ref/specs/2026-06-22-crm-quotes-multi-scenario-design.md`

---

## File Structure

- `src/db/queries/customer-quotes.ts` — `ScenarioInput` 타입 + `createQuote` scenarios 복수화. **수정.**
- `src/routes/customers.ts` — `quoteScenarioBody` zod 확장 + `quoteCreateBody.scenarios`. **수정.**
- `src/routes/customers.test.ts` — scenarios 3건 라운드트립 + 단수 하위호환 테스트. **수정.**
- `client/src/lib/customer-quotes.ts` — `QuoteCreatePayload.scenarios` + 시나리오 타입. **수정.**
- `client/src/lib/kim-quote.ts` — `CustomerDetailScenario` 확장 + `KimQuoteItem.scenarios` + `toKimQuoteItem`. **수정.**
- `client/src/lib/kim-quote.test.ts` — scenarios 배열 보존 단위테스트. **수정.**
- `client/src/pages/CustomerDetailPage.tsx` — 비교카드 식별자 부여 + `saveQuoteFromWorkbench` scenarios 추출. **수정.**

---

## Task 1: 서버 `createQuote` scenarios 복수화 + `ScenarioInput`

**Files:** Modify `src/db/queries/customer-quotes.ts`

- [ ] **Step 1: `QuoteScenarioPatch` → `ScenarioInput` 확장**

`src/db/queries/customer-quotes.ts`의 `QuoteScenarioPatch`(20-25행)를 아래로 교체(기존 PATCH는 그대로 alias 유지):

```ts
export type QuoteScenarioPatch = {
  purchaseMethod?: string | null;
  termMonths?: number | null;
  monthlyPayment?: string | null;
  lender?: string | null;
};
// #4c-3a 생성용 시나리오(비교카드 입력 가능 컬럼 + 메타). PATCH는 단수 그대로.
export type ScenarioInput = QuoteScenarioPatch & {
  scenarioNo?: number | null;
  isSaved?: boolean;
  depositMode?: string | null;
  depositValue?: string | null;
  downPaymentMode?: string | null;
  downPaymentValue?: string | null;
  residualMode?: string | null;
  residualValue?: string | null;
  mileageMode?: string | null;
  mileageValue?: string | null;
};
```

- [ ] **Step 2: `QuoteCreateBody`에 `scenarios` 추가**

`QuoteCreateBody` 타입의 `scenario?: QuoteScenarioPatch;` 줄을 아래로 교체:

```ts
  scenario?: QuoteScenarioPatch;
  scenarios?: ScenarioInput[];
```

- [ ] **Step 3: `createQuote`의 scenario INSERT를 복수 루프로 교체**

`createQuote` 함수에서 단일 scenario INSERT + primary UPDATE 블록(약 148-157행, `const [s] = await ex.insert(quoteScenarios)...` 부터 `return q;` 직전까지)을 아래로 교체:

```ts
  // #4c-3a: scenarios(복수) 우선, 없으면 scenario(단수)를 1건으로(하위호환).
  const scenarioInputs: ScenarioInput[] = (body.scenarios && body.scenarios.length)
    ? body.scenarios
    : (body.scenario ? [{ ...body.scenario, scenarioNo: 1 }] : []);

  const inserted: { id: string; scenarioNo: number }[] = [];
  for (const sc of scenarioInputs) {
    const scenarioNo = sc.scenarioNo ?? 1;
    const [s] = await ex.insert(quoteScenarios).values({
      quoteId: q.id,
      scenarioNo,
      isSaved: sc.isSaved ?? false,
      savedAt: sc.isSaved ? new Date() : null,
      purchaseMethod: sc.purchaseMethod ?? null,
      termMonths: sc.termMonths ?? null,
      monthlyPayment: sc.monthlyPayment ?? null,
      lender: sc.lender ?? null,
      depositMode: sc.depositMode ?? null,
      depositValue: sc.depositValue ?? null,
      downPaymentMode: sc.downPaymentMode ?? null,
      downPaymentValue: sc.downPaymentValue ?? null,
      residualMode: sc.residualMode ?? null,
      residualValue: sc.residualValue ?? null,
      mileageMode: sc.mileageMode ?? null,
      mileageValue: sc.mileageValue ?? null,
    }).returning({ id: quoteScenarios.id });
    inserted.push({ id: s.id, scenarioNo });
  }

  // 대표 = scenario_no 최소(보통 1). 없으면 첫 건.
  const primary = inserted.length
    ? inserted.reduce((m, x) => (x.scenarioNo < m.scenarioNo ? x : m))
    : null;
  if (primary) await ex.update(quotes).set({ primaryScenarioId: primary.id }).where(eq(quotes.id, q.id));
  return q;
```

- [ ] **Step 4: typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/queries/customer-quotes.ts
git commit -m "feat(crm): 견적 다중 시나리오 #4c-3a — createQuote scenarios 복수화 + ScenarioInput"
```

---

## Task 2: 서버 zod 확장 + 라운드트립 테스트

**Files:** Modify `src/routes/customers.ts`, `src/routes/customers.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/routes/customers.test.ts` 끝에 추가(`seedThrowawayQuote`/`makeTestAuth` 패턴, throwaway `try/finally`):

```ts
test("견적 다중 시나리오(#4c-3a): scenarios 3건 → getCustomer 라운드트립 + primary=round1", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  let quoteId: string | null = null;
  try {
    const created = await app.request(`/api/customers/${cid}/quotes`, {
      method: "POST", headers: h,
      body: JSON.stringify({
        entryMode: "manual", status: "작성중", brandName: "벤츠",
        scenarios: [
          { scenarioNo: 1, isSaved: true, purchaseMethod: "운용리스", lender: "우리금융캐피탈", monthlyPayment: "2398000", depositMode: "percent", depositValue: "30", residualMode: "max", mileageMode: "basic", mileageValue: "20,000km / 년" },
          { scenarioNo: 2, isSaved: true, purchaseMethod: "운용리스", lender: "iM캐피탈", monthlyPayment: "2473200", depositMode: "amount", depositValue: "10000000" },
          { scenarioNo: 3, isSaved: true, purchaseMethod: "운용리스", lender: "하나캐피탈", monthlyPayment: "2550000" },
        ],
      }),
    });
    expect(created.status).toBe(201);
    quoteId = ((await created.json()) as { id: string }).id;

    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      quotes: Array<{ id: string; primaryScenarioId: string | null; scenarios: Array<{ id: string; scenarioNo: number | null; lender: string | null; monthlyPayment: string | null; depositMode: string | null; depositValue: string | null; isSaved: boolean }> }>;
    };
    const q = detail.quotes.find((x) => x.id === quoteId)!;
    expect(q.scenarios.length).toBe(3);
    const byNo = [...q.scenarios].sort((a, b) => (a.scenarioNo ?? 0) - (b.scenarioNo ?? 0));
    expect(byNo[0].lender).toBe("우리금융캐피탈");
    expect(byNo[0].depositMode).toBe("percent");
    expect(byNo[0].depositValue).toBe("30");
    expect(byNo[0].isSaved).toBe(true);
    expect(byNo[1].lender).toBe("iM캐피탈");
    expect(byNo[2].monthlyPayment).toBe("2550000");
    expect(q.primaryScenarioId).toBe(byNo[0].id); // round 1이 대표
  } finally {
    if (quoteId) await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});

test("견적 다중 시나리오(#4c-3a): scenario 단수 하위호환 — 1건 저장", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  let quoteId: string | null = null;
  try {
    const created = await app.request(`/api/customers/${cid}/quotes`, {
      method: "POST", headers: h,
      body: JSON.stringify({ entryMode: "manual", status: "작성중", scenario: { purchaseMethod: "할부", termMonths: 36, monthlyPayment: "1000000", lender: "iM캐피탈" } }),
    });
    expect(created.status).toBe(201);
    quoteId = ((await created.json()) as { id: string }).id;
    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      quotes: Array<{ id: string; scenarios: Array<{ scenarioNo: number | null; purchaseMethod: string | null }> }>;
    };
    const q = detail.quotes.find((x) => x.id === quoteId)!;
    expect(q.scenarios.length).toBe(1);
    expect(q.scenarios[0].scenarioNo).toBe(1);
    expect(q.scenarios[0].purchaseMethod).toBe("할부");
  } finally {
    if (quoteId) await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: 첫 테스트 FAIL — zod가 `scenarios`를 strip해 시나리오 0건(또는 단수만) → `q.scenarios.length` 불일치.

- [ ] **Step 3: zod 확장**

`src/routes/customers.ts`의 `quoteScenarioBody`(56-61행)를 아래로 교체:

```ts
const quoteScenarioBody = z.object({
  scenarioNo: z.number().int().nullable().optional(),
  isSaved: z.boolean().optional(),
  purchaseMethod: z.string().nullable().optional(),
  termMonths: z.number().int().nullable().optional(),
  monthlyPayment: z.string().nullable().optional(),
  lender: z.string().nullable().optional(),
  depositMode: z.string().nullable().optional(),
  depositValue: z.string().nullable().optional(),
  downPaymentMode: z.string().nullable().optional(),
  downPaymentValue: z.string().nullable().optional(),
  residualMode: z.string().nullable().optional(),
  residualValue: z.string().nullable().optional(),
  mileageMode: z.string().nullable().optional(),
  mileageValue: z.string().nullable().optional(),
});
```

그리고 `quoteCreateBody`의 `scenario: quoteScenarioBody.optional(),` 줄 뒤에 추가:

```ts
  scenario: quoteScenarioBody.optional(),
  scenarios: z.array(quoteScenarioBody).max(3).optional(),
```

(주의: `quotePatchBody`의 `scenario`는 그대로 단수 유지 — #4c-3b까지 PATCH는 단수.)

- [ ] **Step 4: 통과 확인**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: PASS (신규 2건 + 기존 전부).

- [ ] **Step 5: Commit**

```bash
git add src/routes/customers.ts src/routes/customers.test.ts
git commit -m "feat(crm): 견적 다중 시나리오 #4c-3a — POST zod scenarios 확장 + 라운드트립 테스트"
```

---

## Task 3: 프론트 `QuoteCreatePayload.scenarios`

**Files:** Modify `client/src/lib/customer-quotes.ts`

- [ ] **Step 1: 시나리오 타입 + payload 확장**

`client/src/lib/customer-quotes.ts`의 `QuoteCreatePayload`에서 `scenario?: {...};` 블록을 아래로 교체:

```ts
  scenario?: ScenarioInput;
  scenarios?: ScenarioInput[];
};

export type ScenarioInput = {
  scenarioNo?: number | null;
  isSaved?: boolean;
  purchaseMethod?: string | null;
  termMonths?: number | null;
  monthlyPayment?: string | null;
  lender?: string | null;
  depositMode?: string | null;
  depositValue?: string | null;
  downPaymentMode?: string | null;
  downPaymentValue?: string | null;
  residualMode?: string | null;
  residualValue?: string | null;
  mileageMode?: string | null;
  mileageValue?: string | null;
};
```

(주의: `QuoteCreatePayload`의 닫는 `};`가 위 `scenarios?` 다음으로 옮겨졌으니 중복 `};` 없게 확인. 기존 `scenario?: { purchaseMethod?... };`의 인라인 객체를 `ScenarioInput`으로 대체.)

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 0 errors. (saveQuoteFromWorkbench의 기존 `scenario:` 사용은 ScenarioInput과 호환.)

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/customer-quotes.ts
git commit -m "feat(crm): 견적 다중 시나리오 #4c-3a — QuoteCreatePayload scenarios 확장"
```

---

## Task 4: 읽기 어댑터 — `CustomerDetailScenario` 확장 + `KimQuoteItem.scenarios` + 단위테스트

**Files:** Modify `client/src/lib/kim-quote.ts`, `client/src/lib/kim-quote.test.ts`, `client/src/lib/customers.test.ts`

- [ ] **Step 1: 단위테스트 작성**

`client/src/lib/kim-quote.test.ts`의 describe 끝(마지막 `});` 전)에 추가:

```ts
  it("#4c-3a scenarios 배열 보존(N건) + 대표 평탄화 유지", () => {
    const k = toKimQuoteItem(makeQuote({
      primaryScenarioId: "s1",
      scenarios: [
        { id: "s1", scenarioNo: 1, purchaseMethod: "운용리스", lender: "우리금융캐피탈", termMonths: 60, monthlyPayment: "2398000", depositMode: "percent", depositValue: "30", downPaymentMode: null, downPaymentValue: null, residualMode: "max", residualValue: null, mileageMode: "basic", mileageValue: "20,000km / 년", isSaved: true },
        { id: "s2", scenarioNo: 2, purchaseMethod: "운용리스", lender: "iM캐피탈", termMonths: null, monthlyPayment: "2473200", depositMode: "amount", depositValue: "10000000", downPaymentMode: null, downPaymentValue: null, residualMode: null, residualValue: null, mileageMode: null, mileageValue: null, isSaved: true },
      ],
    }), NOW);
    expect(k.scenarios?.length).toBe(2);
    expect(k.scenarios?.[0].lender).toBe("우리금융캐피탈");
    expect(k.scenarios?.[1].depositMode).toBe("amount");
    expect(k.financeType).toBe("운용리스"); // 대표 평탄화 유지
    expect(k.lender).toBe("우리금융캐피탈");
  });
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/kim-quote.test.ts`
Expected: FAIL — `CustomerDetailScenario`에 depositMode 등 없어 타입 에러 / `k.scenarios` undefined.

- [ ] **Step 3: `CustomerDetailScenario` 확장**

`client/src/lib/kim-quote.ts`의 `CustomerDetailScenario`(38-45행)를 아래로 교체:

```ts
export type CustomerDetailScenario = {
  id: string;
  scenarioNo: number | null;
  purchaseMethod: string | null;
  lender: string | null;
  termMonths: number | null;
  monthlyPayment: string | null;
  // #4c-3a 비교카드 입력 가능 컬럼
  depositMode: string | null;
  depositValue: string | null;
  downPaymentMode: string | null;
  downPaymentValue: string | null;
  residualMode: string | null;
  residualValue: string | null;
  mileageMode: string | null;
  mileageValue: string | null;
  isSaved: boolean;
};
```

- [ ] **Step 4: `KimQuoteItem.scenarios` 추가**

`client/src/lib/kim-quote.ts`의 `KimQuoteItem`에서 `originalNeedsReplacement?: boolean;` 줄 위에 추가:

```ts
  // #4c-3a 다중 시나리오(비교 표시는 #4c-3b가 소비)
  scenarios?: CustomerDetailScenario[];
  originalNeedsReplacement?: boolean;
```

- [ ] **Step 5: `toKimQuoteItem` 매핑**

`client/src/lib/kim-quote.ts`의 `toKimQuoteItem` return 객체에서 `interiorColorHex: q.interiorColorHex ?? undefined,` 줄 뒤에 추가:

```ts
    interiorColorHex: q.interiorColorHex ?? undefined,
    scenarios: q.scenarios,
```

- [ ] **Step 6: 기존 테스트 fixture 보강**

`client/src/lib/kim-quote.test.ts`의 `makeQuote` 안 `scenarios:` 배열의 단일 객체에 누락 필드 추가(타입 통과):

```ts
    scenarios: [
      { id: "s1", scenarioNo: 1, purchaseMethod: "운용리스", lender: "iM캐피탈", termMonths: 60, monthlyPayment: "2473200", depositMode: null, depositValue: null, downPaymentMode: null, downPaymentValue: null, residualMode: null, residualValue: null, mileageMode: null, mileageValue: null, isSaved: false },
    ],
```

그리고 `client/src/lib/customers.test.ts`의 `detailRes` quotes[0].scenarios 단일 객체에도 동일 필드 추가:

```ts
      scenarios: [{ id: "s1", scenarioNo: 1, purchaseMethod: "운용리스", lender: "iM캐피탈", termMonths: 60, monthlyPayment: "2473200", depositMode: null, depositValue: null, downPaymentMode: null, downPaymentValue: null, residualMode: null, residualValue: null, mileageMode: null, mileageValue: null, isSaved: false }],
```

- [ ] **Step 7: 통과 + typecheck**

Run: `bun run test:unit client/src/lib/kim-quote.test.ts && bun run typecheck`
Expected: PASS, 0 errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/kim-quote.ts client/src/lib/kim-quote.test.ts client/src/lib/customers.test.ts
git commit -m "feat(crm): 견적 다중 시나리오 #4c-3a — 읽기 어댑터 scenarios 배열 보존 + 단위테스트"
```

---

## Task 5: 비교카드 input 식별자 부여

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx` (비교카드 JSX 약 5017~5037)

저장 시 DOM 추출이 가능하도록 카드 section과 입력에 식별자를 부여한다(controlled 전환 없음).

- [ ] **Step 1: 카드 section에 `data-scenario-card`**

`client/src/pages/CustomerDetailPage.tsx`의 비교카드 `<section className={...kim-manual-compare-card...} key={condition.id}>`(약 5017행)에 속성 추가:

```tsx
                            <section className={`kim-manual-compare-card${isConditionSaved ? " is-saved" : ""}`} data-scenario-card={condition.id} key={condition.id}>
```

- [ ] **Step 2: 금융사 select에 식별자**

금융사 `<select defaultValue={condition.lender} disabled={isConditionSaved}>`(약 5029행)에 `data-sc-field="lender"` 추가:

```tsx
                                <label className="select-value"><span>금융사</span><select data-sc-field="lender" defaultValue={condition.lender} disabled={isConditionSaved}><option>미선택</option><option>우리금융캐피탈</option><option>iM캐피탈</option><option>하나캐피탈</option></select></label>
```

- [ ] **Step 3: 보증금/선수금/잔존 input에 식별자**

각 `<input data-discount-unit=... defaultValue={condition.depositValue} ... />`(5031), `downPaymentValue`(5032), `residualValue`(5033) input에 `data-sc-field` 추가:
- 보증금 input: `data-sc-field="deposit"`
- 선수금 input: `data-sc-field="downPayment"`
- 잔존 input: `data-sc-field="residual"`

예(보증금, 5031행의 input 부분):

```tsx
<input data-sc-field="deposit" data-discount-unit={depositMode === "percent" ? "percent" : "amount"} defaultValue={condition.depositValue} disabled={isConditionSaved} readOnly={depositMode === "none"} />
```

(선수금/잔존도 동일하게 각 input 첫 속성으로 `data-sc-field="downPayment"`, `data-sc-field="residual"` 추가.)

- [ ] **Step 4: 월납입 input에 식별자**

월납입 `<input aria-label="월 납입금" defaultValue={condition.monthlyPayment} disabled={isConditionSaved} />`(약 5037행)에 `data-sc-field="monthly"` 추가:

```tsx
<input aria-label="월 납입금" data-sc-field="monthly" defaultValue={condition.monthlyPayment} disabled={isConditionSaved} />
```

- [ ] **Step 5: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 errors, 0 problems.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 견적 다중 시나리오 #4c-3a — 비교카드 추출용 식별자 부여"
```

---

## Task 6: `saveQuoteFromWorkbench`가 scenarios 추출

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx`

저장된 비교카드(`savedManualQuoteConditionIds`)를 슬롯별 DOM+mode-state로 추출해 `scenarios` 배열을 만들고 payload에 넣는다. 저장된 카드가 없으면 기존 단일 시나리오(#4c-2)로 폴백.

- [ ] **Step 1: 숫자 정규화 헬퍼 확인/추가**

`client/src/pages/CustomerDetailPage.tsx`에 `parseMonthlyPayment`가 이미 import됨(7행). 시나리오 numeric value는 `parseMonthlyPayment`(숫자만 추출, 없으면 null)로 정규화한다 — 별도 헬퍼 불필요.

- [ ] **Step 2: `saveQuoteFromWorkbench`에 scenarios 추출 추가**

`saveQuoteFromWorkbench`의 payload 구성 직전(`if (customer.id) {` 안, `const payload: QuoteCreatePayload = {` 위)에 추출 블록 추가:

```ts
    if (customer.id) {
      // #4c-3a: 저장된 비교카드 → scenarios. 없으면 단일(구매방식만, #4c-2 폴백).
      const compareForm = quoteDetailFormRef.current;
      const builtScenarios = savedManualQuoteConditionIds.map((condId) => {
        const card = compareForm?.querySelector<HTMLElement>(`[data-scenario-card="${condId}"]`);
        const fieldVal = (f: string) => card?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-sc-field="${f}"]`)?.value ?? null;
        const constCard = kimManualQuoteConditionCards.find((c) => c.id === condId);
        const depositMode = manualDepositModes[condId] ?? constCard?.depositMode ?? null;
        const downPaymentMode = manualDownPaymentModes[condId] ?? constCard?.downPaymentMode ?? null;
        const residualMode = manualResidualModes[condId] ?? constCard?.residualMode ?? null;
        const mileageMode = manualMileageModes[condId] ?? "basic";
        const mileageValue = mileageMode === "basic" ? "20,000km / 년" : (manualMileageValues[condId] ?? "20,000km / 년");
        const lenderRaw = fieldVal("lender");
        return {
          scenarioNo: Number(constCard?.round ?? 1),
          isSaved: true,
          purchaseMethod: solutionWorkbenchPurchaseMethod,
          lender: lenderRaw && lenderRaw !== "미선택" ? lenderRaw : null,
          monthlyPayment: parseMonthlyPayment(fieldVal("monthly") ?? ""),
          depositMode,
          depositValue: depositMode === "none" ? null : parseMonthlyPayment(fieldVal("deposit") ?? ""),
          downPaymentMode,
          downPaymentValue: downPaymentMode === "none" ? null : parseMonthlyPayment(fieldVal("downPayment") ?? ""),
          residualMode,
          residualValue: residualMode === "max" ? null : parseMonthlyPayment(fieldVal("residual") ?? ""),
          mileageMode,
          mileageValue,
        };
      });
      const payload: QuoteCreatePayload = {
```

- [ ] **Step 3: payload의 scenario를 scenarios로 분기**

같은 함수 payload 객체에서 `scenario: { purchaseMethod: solutionWorkbenchPurchaseMethod },` 줄을 아래로 교체:

```ts
        ...(builtScenarios.length
          ? { scenarios: builtScenarios }
          : { scenario: { purchaseMethod: solutionWorkbenchPurchaseMethod } }),
```

- [ ] **Step 4: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 errors, 0 problems. (`kimManualQuoteConditionCards`·`manual*Modes`·`manualMileageValues`·`quoteDetailFormRef`·`savedManualQuoteConditionIds`·`parseMonthlyPayment`는 전부 기존 스코프.)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 견적 다중 시나리오 #4c-3a — saveQuoteFromWorkbench 저장된 비교카드 추출"
```

---

## Task 7: 통합 검증 + brief 갱신

**Files:** Modify `ref/active-session-brief.md`

- [ ] **Step 1: 전체 검증 5종**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun test --env-file=.env.local && bun run build`
Expected: typecheck 0 · lint 0 · test:unit 통과(kim-quote +1) · test:server 통과(+2) · build OK.

- [ ] **Step 2: 브라우저 수동 검증(인증 세션)**

`bun run dev` 후 로그인 → 김민준 상세 → 견적함 `+` → 워크벤치:
- 차량/색상 선택(#4c-2) + 하단 비교카드 2~3개 금융사/보증금/월납입 입력 → 각 "N번 조건 저장"
- "견적함에 저장" → getCustomer/새로고침 후 시나리오 N건 영속(`psql` 또는 #4c-3b 표시 전까지 DB로 확인). primary=1번.

Expected: 저장된 비교카드 수만큼 scenario 행 생성, 입력값(금융사/보증금/월납입) 보존.

- [ ] **Step 3: brief 갱신 + 커밋**

`ref/active-session-brief.md` Current Focus에 #4c-3a 반영 + 다음(#4c-3b) 핸드오프.

```bash
git add ref/active-session-brief.md
git commit -m "docs(brief): #4c-3a 다중 시나리오 저장 반영 + #4c-3b 핸드오프"
```

---

## 미결 / 다음 (이 plan 범위 밖)

- **#4c-3b**: 견적함 1~3 시나리오 비교 표시 UI + 대표 전환(`PATCH primary_scenario_id`).
- 입력 불가 mock 필드(기간/자동차세/보조금/계산결과) 입력화 + 계산엔진.
- copy 버튼 기능화, #4d 원본 파일 영속.
