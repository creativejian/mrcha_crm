# 견적 워크벤치 영속화 #4c-2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적함 `+`가 여는 워크벤치(이미 동작하는 계산기)의 실 입력(차량·가격·색상·옵션)을 추출해 새 견적을 DB에 INSERT하고, 재진입 시 최종 차량가·색상을 표시한다.

**Architecture:** #4c-1의 `createQuote`/`POST /:id/quotes`/`apiCreateQuote` 한 경로를 **확장**(추가 컬럼 전부 optional → composer 하위호환). DB 컬럼·읽기쿼리는 이미 완비라 **마이그레이션 없음**. 워크벤치 입력은 DOM(`readPricingInputs`)+기존 state로 추출하되, 버려지던 차량 selection·옵션 ids만 새 state 2개로 보관. 읽기 표시는 타입/어댑터를 확장해 가격/색상을 평탄화.

**Tech Stack:** Hono + zod + drizzle(postgres-js, master `crm` 스키마), React, TypeScript 6.0.3, bun test.

스펙: `ref/specs/2026-06-22-crm-quotes-workbench-persist-design.md`

---

## File Structure

- `src/db/queries/customer-quotes.ts` — `QuoteCreateBody`·`createQuote` 확장(가격/색상/옵션 헤더 INSERT). **수정.**
- `src/routes/customers.ts` — `quoteCreateBody` zod 확장. **수정.**
- `src/routes/customers.test.ts` — 워크벤치 생성 라운드트립 서버 테스트 추가. **수정.**
- `client/src/lib/customer-quotes.ts` — `QuoteCreatePayload` 확장. **수정.**
- `client/src/lib/kim-quote.ts` — `CustomerDetailQuote`·`KimQuoteItem` 가격/색상 필드 + `toKimQuoteItem` 매핑. **수정.**
- `client/src/lib/kim-quote.test.ts` — `toKimQuoteItem` 가격/색상 매핑 단위테스트. **수정 또는 생성.**
- `client/src/pages/CustomerDetailPage.tsx` — 워크벤치 입력 수집 state 2개 + `saveQuoteFromWorkbench` 재작성 + 견적함 행 가격/색상 표시. **수정.**
- `client/src/index.css` — 견적함 가격/색상 칩 스타일. **수정.**

데이터 흐름 순서(서버→프론트 lib→프론트 page)로 진행한다.

---

## Task 1: 서버 `createQuote` 쿼리 + `QuoteCreateBody` 확장

**Files:**
- Modify: `src/db/queries/customer-quotes.ts:112-159`

가격/색상/옵션 헤더 컬럼을 받아 INSERT하도록 확장한다. 추가 필드는 전부 optional이라 composer(#4c-1) 호출은 무영향. numeric 컬럼은 drizzle에서 문자열로 받으므로 타입은 `string | null`, `options`는 jsonb 객체 배열.

- [ ] **Step 1: `QuoteCreateBody` 타입 확장**

`src/db/queries/customer-quotes.ts`의 기존 `QuoteCreateBody`(112-123행)를 아래로 교체:

```ts
// 생성 바디(라우트 zod와 동형). 헤더 + 대표 시나리오 1건. #4c-2: 가격/색상/옵션 스냅샷(전부 optional, composer는 미전송).
export type QuoteCreateBody = {
  entryMode?: string | null;
  status?: string | null;
  quoteRound?: string | null;
  stockStatus?: string | null;
  brandName?: string | null;
  modelName?: string | null;
  trimName?: string | null;
  note?: string | null;
  // #4c-2 워크벤치 스냅샷
  trimId?: number | null;
  basePrice?: string | null;
  optionTotal?: string | null;
  options?: { id: number; name: string; price: number | null }[] | null;
  finalDiscount?: string | null;
  acquisitionTax?: string | null;
  acquisitionTaxMode?: string | null;
  bond?: string | null;
  delivery?: string | null;
  incidental?: string | null;
  finalVehiclePrice?: string | null;
  acquisitionCost?: string | null;
  exteriorColorId?: number | null;
  exteriorColorName?: string | null;
  exteriorColorHex?: string | null;
  interiorColorId?: number | null;
  interiorColorName?: string | null;
  interiorColorHex?: string | null;
  scenario?: QuoteScenarioPatch;
};
```

- [ ] **Step 2: `createQuote`의 `quotes` INSERT values 확장**

`src/db/queries/customer-quotes.ts`의 `createQuote` 안 `ex.insert(quotes).values({...})`(133-146행)을 아래로 교체(기존 키 유지 + 신규 키 추가):

```ts
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
    trimId: body.trimId ?? null,
    basePrice: body.basePrice ?? null,
    optionTotal: body.optionTotal ?? null,
    options: body.options ?? null,
    finalDiscount: body.finalDiscount ?? null,
    acquisitionTax: body.acquisitionTax ?? null,
    acquisitionTaxMode: body.acquisitionTaxMode ?? null,
    bond: body.bond ?? null,
    delivery: body.delivery ?? null,
    incidental: body.incidental ?? null,
    finalVehiclePrice: body.finalVehiclePrice ?? null,
    acquisitionCost: body.acquisitionCost ?? null,
    exteriorColorId: body.exteriorColorId ?? null,
    exteriorColorName: body.exteriorColorName ?? null,
    exteriorColorHex: body.exteriorColorHex ?? null,
    interiorColorId: body.interiorColorId ?? null,
    interiorColorName: body.interiorColorName ?? null,
    interiorColorHex: body.interiorColorHex ?? null,
    appStatus: "draft",
    revision: 0,
  }).returning({ id: quotes.id, quoteCode: quotes.quoteCode, createdAt: quotes.createdAt });
```

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`
Expected: 0 errors. (drizzle numeric 컬럼은 string 입력 허용, jsonb는 객체 허용.)

- [ ] **Step 4: Commit**

```bash
git add src/db/queries/customer-quotes.ts
git commit -m "feat(crm): 견적 워크벤치 #4c-2 — createQuote 가격/색상/옵션 컬럼 INSERT 확장"
```

---

## Task 2: 서버 `quoteCreateBody` zod 확장 + 라운드트립 서버 테스트

**Files:**
- Modify: `src/routes/customers.ts:62-72`
- Modify: `src/routes/customers.test.ts` (테스트 추가)

- [ ] **Step 1: 실패하는 서버 테스트 작성**

`src/routes/customers.test.ts` 끝에 추가(기존 `seedThrowawayQuote`/`makeTestAuth` 패턴 재사용, throwaway는 `try/finally`로 self-clean — 공유 master DB):

```ts
test("견적 생성(워크벤치 #4c-2): 가격/색상/옵션 payload → getCustomer 라운드트립", async () => {
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
        entryMode: "manual", status: "작성중", quoteRound: "1차", stockStatus: "재고확인중",
        brandName: "벤츠", modelName: "Maybach S-Class", trimName: "S 500 4M Long", note: "수기 입력 조건",
        trimId: 12345,
        basePrice: "243000000", optionTotal: "5000000",
        options: [{ id: 9001, name: "프리미엄 패키지", price: 5000000 }],
        finalDiscount: "6500000", acquisitionTax: "13531000", acquisitionTaxMode: "normal",
        bond: "0", delivery: "0", incidental: "0",
        finalVehiclePrice: "241500000", acquisitionCost: "255031000",
        exteriorColorId: 7001, exteriorColorName: "옵시디언 블랙", exteriorColorHex: "#0a0a0a",
        interiorColorId: 7101, interiorColorName: "마키아토 베이지", interiorColorHex: "#d8c7a8",
        scenario: { purchaseMethod: "운용리스" },
      }),
    });
    expect(created.status).toBe(201);
    quoteId = ((await created.json()) as { id: string }).id;

    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      quotes: Array<{ id: string; trimId: number | null; basePrice: string | null; optionTotal: string | null; options: Array<{ id: number; name: string; price: number | null }> | null; finalVehiclePrice: string | null; exteriorColorName: string | null; exteriorColorHex: string | null; interiorColorName: string | null; scenarios: Array<{ purchaseMethod: string | null }> }>;
    };
    const q = detail.quotes.find((x) => x.id === quoteId)!;
    expect(q.trimId).toBe(12345);
    expect(q.basePrice).toBe("243000000");
    expect(q.optionTotal).toBe("5000000");
    expect(q.options?.[0]?.name).toBe("프리미엄 패키지");
    expect(q.finalVehiclePrice).toBe("241500000");
    expect(q.exteriorColorName).toBe("옵시디언 블랙");
    expect(q.exteriorColorHex).toBe("#0a0a0a");
    expect(q.interiorColorName).toBe("마키아토 베이지");
    expect(q.scenarios[0].purchaseMethod).toBe("운용리스");
  } finally {
    if (quoteId) await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});

test("견적 생성(워크벤치 #4c-2): composer 하위호환 — 가격 필드 없이도 201", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  let quoteId: string | null = null;
  try {
    const created = await app.request(`/api/customers/${cid}/quotes`, {
      method: "POST", headers: h,
      body: JSON.stringify({ entryMode: "manual", status: "작성중", brandName: "BMW", scenario: { purchaseMethod: "할부" } }),
    });
    expect(created.status).toBe(201);
    quoteId = ((await created.json()) as { id: string }).id;
  } finally {
    if (quoteId) await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: 첫 테스트 FAIL — zod가 `trimId`/`basePrice` 등 미정의 키를 무시(strip)해 `q.trimId`가 null로 와서 `expect(12345)` 실패. (zod object는 기본 strip이라 400은 아니고 값이 안 들어감.)

- [ ] **Step 3: `quoteCreateBody` zod 확장**

`src/routes/customers.ts`의 `quoteCreateBody`(62-72행)를 아래로 교체:

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
  // #4c-2 워크벤치 스냅샷
  trimId: z.number().int().nullable().optional(),
  basePrice: z.string().nullable().optional(),
  optionTotal: z.string().nullable().optional(),
  options: z.array(z.object({ id: z.number().int(), name: z.string(), price: z.number().nullable() })).nullable().optional(),
  finalDiscount: z.string().nullable().optional(),
  acquisitionTax: z.string().nullable().optional(),
  acquisitionTaxMode: z.enum(["normal", "hybrid", "electric", "manual"]).nullable().optional(),
  bond: z.string().nullable().optional(),
  delivery: z.string().nullable().optional(),
  incidental: z.string().nullable().optional(),
  finalVehiclePrice: z.string().nullable().optional(),
  acquisitionCost: z.string().nullable().optional(),
  exteriorColorId: z.number().int().nullable().optional(),
  exteriorColorName: z.string().nullable().optional(),
  exteriorColorHex: z.string().nullable().optional(),
  interiorColorId: z.number().int().nullable().optional(),
  interiorColorName: z.string().nullable().optional(),
  interiorColorHex: z.string().nullable().optional(),
  scenario: quoteScenarioBody.optional(),
});
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: PASS (두 신규 테스트 + 기존 견적 테스트 전부).

- [ ] **Step 5: Commit**

```bash
git add src/routes/customers.ts src/routes/customers.test.ts
git commit -m "feat(crm): 견적 워크벤치 #4c-2 — POST zod 가격/색상/옵션 확장 + 라운드트립 테스트"
```

---

## Task 3: 프론트 `QuoteCreatePayload` 확장

**Files:**
- Modify: `client/src/lib/customer-quotes.ts:54-69`

서버 zod와 동형으로 payload 타입 확장. `createQuote` 함수 시그니처는 불변.

- [ ] **Step 1: `QuoteCreatePayload` 확장**

`client/src/lib/customer-quotes.ts`의 `QuoteCreatePayload`(54-69행)를 아래로 교체:

```ts
// POST 바디(서버 zod와 동형). 헤더 + 대표 시나리오 + #4c-2 가격/색상/옵션 스냅샷.
export type QuoteCreatePayload = {
  entryMode?: "manual" | "solution" | "original" | null;
  status?: string | null;
  quoteRound?: string | null;
  stockStatus?: "재고있음" | "재고없음" | "재고확인중" | null;
  brandName?: string | null;
  modelName?: string | null;
  trimName?: string | null;
  note?: string | null;
  trimId?: number | null;
  basePrice?: string | null;
  optionTotal?: string | null;
  options?: { id: number; name: string; price: number | null }[] | null;
  finalDiscount?: string | null;
  acquisitionTax?: string | null;
  acquisitionTaxMode?: "normal" | "hybrid" | "electric" | "manual" | null;
  bond?: string | null;
  delivery?: string | null;
  incidental?: string | null;
  finalVehiclePrice?: string | null;
  acquisitionCost?: string | null;
  exteriorColorId?: number | null;
  exteriorColorName?: string | null;
  exteriorColorHex?: string | null;
  interiorColorId?: number | null;
  interiorColorName?: string | null;
  interiorColorHex?: string | null;
  scenario?: {
    purchaseMethod?: string | null;
    termMonths?: number | null;
    monthlyPayment?: string | null;
    lender?: string | null;
  };
};
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/customer-quotes.ts
git commit -m "feat(crm): 견적 워크벤치 #4c-2 — QuoteCreatePayload 가격/색상/옵션 확장"
```

---

## Task 4: 읽기 타입/어댑터 확장 (`kim-quote.ts`) + 단위테스트

**Files:**
- Modify: `client/src/lib/kim-quote.ts`
- Modify/Create: `client/src/lib/kim-quote.test.ts`

`CustomerDetailQuote`(서버 응답 1건)와 `KimQuoteItem`(UI)에 가격/색상 필드를 더하고, `toKimQuoteItem`이 매핑한다. numeric은 서버에서 string으로 오므로 `finalVehiclePrice`는 `Number()`로 변환.

- [ ] **Step 1: 단위테스트 작성(없으면 파일 생성)**

`client/src/lib/kim-quote.test.ts`에 케이스 추가(파일 없으면 아래로 생성):

```ts
import { test, expect } from "bun:test";

import { toKimQuoteItem, type CustomerDetailQuote } from "./kim-quote";

function baseQuote(overrides: Partial<CustomerDetailQuote> = {}): CustomerDetailQuote {
  return {
    id: "q1", quoteCode: "QT-2606-0001", entryMode: "manual", quoteRound: "1차",
    brandName: "벤츠", modelName: "Maybach S-Class", trimName: "S 500 4M Long",
    status: "작성중", appStatus: "draft", decisionStatus: "none", stockStatus: "재고확인중",
    note: null, validUntil: null, sentAt: null, viewedAt: null, revision: 0, primaryScenarioId: null,
    basePrice: null, optionTotal: null, finalDiscount: null, acquisitionTax: null,
    bond: null, delivery: null, incidental: null, finalVehiclePrice: null, acquisitionCost: null,
    options: null, exteriorColorName: null, exteriorColorHex: null, interiorColorName: null, interiorColorHex: null,
    scenarios: [],
    ...overrides,
  };
}

test("toKimQuoteItem: 가격(string)→number, 색상 매핑", () => {
  const item = toKimQuoteItem(baseQuote({
    finalVehiclePrice: "241500000",
    exteriorColorName: "옵시디언 블랙", exteriorColorHex: "#0a0a0a",
    interiorColorName: "마키아토 베이지", interiorColorHex: "#d8c7a8",
  }), 0);
  expect(item.finalVehiclePrice).toBe(241500000);
  expect(item.exteriorColorName).toBe("옵시디언 블랙");
  expect(item.exteriorColorHex).toBe("#0a0a0a");
  expect(item.interiorColorName).toBe("마키아토 베이지");
});

test("toKimQuoteItem: 가격/색상 없으면 undefined", () => {
  const item = toKimQuoteItem(baseQuote(), 0);
  expect(item.finalVehiclePrice).toBeUndefined();
  expect(item.exteriorColorName).toBeUndefined();
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `bun test client/src/lib/kim-quote.test.ts`
Expected: FAIL — `CustomerDetailQuote`에 `finalVehiclePrice` 등 필드 없어 타입 에러 / `item.finalVehiclePrice` undefined.

- [ ] **Step 3: `CustomerDetailQuote` 타입 확장**

`client/src/lib/kim-quote.ts`의 `CustomerDetailQuote`(47-66행) `scenarios` 줄 바로 위에 필드 추가:

```ts
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
  // #4c-2 가격/색상 스냅샷(numeric은 string, 없으면 null)
  basePrice: string | null;
  optionTotal: string | null;
  finalDiscount: string | null;
  acquisitionTax: string | null;
  bond: string | null;
  delivery: string | null;
  incidental: string | null;
  finalVehiclePrice: string | null;
  acquisitionCost: string | null;
  options: { id: number; name: string; price: number | null }[] | null;
  exteriorColorName: string | null;
  exteriorColorHex: string | null;
  interiorColorName: string | null;
  interiorColorHex: string | null;
  scenarios: CustomerDetailScenario[];
};
```

- [ ] **Step 4: `KimQuoteItem` 타입 확장**

`client/src/lib/kim-quote.ts`의 `KimQuoteItem`(4-35행) `originalNeedsReplacement` 줄 위에 추가:

```ts
  // #4c-2 표시용 가격/색상
  finalVehiclePrice?: number;
  exteriorColorName?: string;
  exteriorColorHex?: string;
  interiorColorName?: string;
  interiorColorHex?: string;
  originalNeedsReplacement?: boolean;
};
```

- [ ] **Step 5: `toKimQuoteItem` 매핑 추가**

`client/src/lib/kim-quote.ts`의 `toKimQuoteItem` return 객체(116-140행)에서 `revision: q.revision,` 줄 뒤에 추가:

```ts
    revision: q.revision,
    finalVehiclePrice: q.finalVehiclePrice != null && q.finalVehiclePrice !== "" && !Number.isNaN(Number(q.finalVehiclePrice)) ? Number(q.finalVehiclePrice) : undefined,
    exteriorColorName: q.exteriorColorName ?? undefined,
    exteriorColorHex: q.exteriorColorHex ?? undefined,
    interiorColorName: q.interiorColorName ?? undefined,
    interiorColorHex: q.interiorColorHex ?? undefined,
```

- [ ] **Step 6: 테스트 실행 → 통과 확인**

Run: `bun test client/src/lib/kim-quote.test.ts`
Expected: PASS.

- [ ] **Step 7: typecheck**

Run: `bun run typecheck`
Expected: 0 errors. (서버 `getCustomer`가 `select()` 전체라 응답에 새 필드가 런타임 포함되고, 타입만 추가하면 정합.)

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/kim-quote.ts client/src/lib/kim-quote.test.ts
git commit -m "feat(crm): 견적 워크벤치 #4c-2 — 읽기 타입/어댑터 가격·색상 확장 + 단위테스트"
```

---

## Task 5: 워크벤치 입력 수집 state 2개 추가

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx:924`(state 선언 근처), `:1254-1279`(applyTrimToPricing), `:1281-1288`(applyOptionTotal)

`applyTrimToPricing`은 selection.brand/model을 버리고, `applyOptionTotal`은 selectedIds를 버린다. 저장 시점에 읽도록 state 2개를 추가해 보관한다.

- [ ] **Step 1: state 2개 선언**

`client/src/pages/CustomerDetailPage.tsx`의 `const [trimDetail, setTrimDetail] = useState<TrimDetail | null>(null);`(924행) **바로 아래**에 추가:

```ts
  // #4c-2 워크벤치 저장용: VehiclePicker가 고른 brand/model(applyTrimToPricing이 버리던 값)과 선택 옵션 ids.
  const [workbenchVehicle, setWorkbenchVehicle] = useState<VehicleSelection | null>(null);
  const [selectedWorkbenchOptionIds, setSelectedWorkbenchOptionIds] = useState<number[]>([]);
```

`VehicleSelection` 타입은 이미 `import { VehiclePicker, type VehicleSelection } from "@/components/VehiclePicker";`(10행)로 임포트돼 있음 — 추가 임포트 불필요.

- [ ] **Step 2: `applyTrimToPricing`이 selection 저장**

`client/src/pages/CustomerDetailPage.tsx`의 `applyTrimToPricing`(1254-1261행) 앞부분에서 `setTrimDetail(detail);` 뒤에 selection 보관 + 옵션 초기화 추가:

```ts
  async function applyTrimToPricing(selection: VehicleSelection) {
    const trim = selection.trim;
    if (!trim) return;
    try {
      const detail = await fetchTrimDetail(trim.id);
      setTrimDetail(detail);
      setWorkbenchVehicle(selection);
      setSelectedWorkbenchOptionIds([]);
      setExteriorColor(null);
      setInteriorColor(null);
```

(나머지 함수 본문은 그대로.)

- [ ] **Step 3: `applyOptionTotal`이 selectedIds 저장**

`client/src/pages/CustomerDetailPage.tsx`의 `applyOptionTotal`(1281-1288행)을 아래로 교체:

```ts
  function applyOptionTotal(next: { selectedIds: number[]; total: number }) {
    setSelectedWorkbenchOptionIds(next.selectedIds);
    const root = pricingPanelRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLInputElement>('input[data-pricing="option"]');
    if (el) el.value = formatMoney(next.total);
    recomputePricing();
    markQuoteDraftChanged();
  }
```

- [ ] **Step 4: typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 견적 워크벤치 #4c-2 — 차량 selection·옵션 ids 입력 수집 state"
```

---

## Task 6: `saveQuoteFromWorkbench` 재작성 (추출 + 영속 + 낙관/롤백)

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx:2288-2331`

Maybach 하드코딩을 제거하고 워크벤치 실 입력을 추출해 낙관 추가 + `apiCreateQuote` 영속 + 임시 id/코드 교체 + 실패 롤백(#4c-1 composer add 패턴 동형).

- [ ] **Step 1: 함수 전체 교체**

`client/src/pages/CustomerDetailPage.tsx`의 `saveQuoteFromWorkbench`(2288-2331행)를 아래로 교체:

```ts
  function saveQuoteFromWorkbench() {
    if (!guardQuoteDraftOutput("견적함 저장")) return;
    const source: KimQuoteItem["source"] = solutionWorkbenchEntryMode === "solution" ? "solution" : solutionWorkbenchEntryMode === "original" ? "original" : "manual";
    const sourceLabel = source === "solution" ? "솔루션 조회 조건" : source === "original" ? "원본 인식 후 보정" : "수기 입력 조건";
    const savedAt = formatKoreanShortTime();

    // 워크벤치 입력 추출
    const root = pricingPanelRef.current;
    const inputs = root ? readPricingInputs(root) : null;
    const brandName = workbenchVehicle?.brand?.name ?? null;
    const modelName = workbenchVehicle?.model?.name ?? null;
    const trimName = trimDetail?.trimName ?? trimDetail?.name ?? null;
    const selectedOptions = trimDetail
      ? trimDetail.options.filter((o) => selectedWorkbenchOptionIds.includes(o.id)).map((o) => ({ id: o.id, name: o.name, price: o.price }))
      : [];
    const vehicleName = [brandName, modelName, trimName].filter(Boolean).join(" ") || "차량 미선택";
    const num = (n: number | undefined | null) => (n == null ? null : String(n));

    const tempId = `kim-quote-workbench-${Date.now()}`;
    const tempQuoteCode = createKimQuoteCode(quotes);

    setQuotes((current) => [...current, {
      id: tempId,
      quoteCode: tempQuoteCode,
      title: vehicleName,
      meta: `${savedAt} · ${sourceLabel}`,
      status: "작성중",
      source,
      appStatus: "draft",
      brand: brandName ?? undefined,
      model: modelName ?? undefined,
      trim: trimName ?? undefined,
      quoteRound: "1차",
      vehicleName,
      financeType: solutionWorkbenchPurchaseMethod,
      term: "조건 미정",
      lender: "금융사 미정",
      stockStatus: "재고확인중",
      note: sourceLabel,
      decisionStatus: "none",
      finalVehiclePrice: pricing.finalVehiclePrice,
      exteriorColorName: exteriorColor?.name,
      exteriorColorHex: exteriorColor?.hexValue ?? undefined,
      interiorColorName: interiorColor?.name,
      interiorColorHex: interiorColor?.hexValue ?? undefined,
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
        status: "작성중",
        quoteRound: "1차",
        stockStatus: "재고확인중",
        brandName,
        modelName,
        trimName,
        note: sourceLabel,
        trimId: trimDetail?.id ?? null,
        basePrice: inputs ? num(inputs.basePrice) : null,
        optionTotal: inputs ? num(inputs.optionPrice) : null,
        options: selectedOptions.length ? selectedOptions : null,
        finalDiscount: inputs ? num(inputs.discount) : null,
        acquisitionTax: inputs ? num(inputs.acquisitionTax) : null,
        acquisitionTaxMode,
        bond: inputs ? num(inputs.bond) : null,
        delivery: inputs ? num(inputs.delivery) : null,
        incidental: inputs ? num(inputs.incidental) : null,
        finalVehiclePrice: num(pricing.finalVehiclePrice),
        acquisitionCost: num(pricing.acquisitionCost),
        exteriorColorId: exteriorColor?.id ?? null,
        exteriorColorName: exteriorColor?.name ?? null,
        exteriorColorHex: exteriorColor?.hexValue ?? null,
        interiorColorId: interiorColor?.id ?? null,
        interiorColorName: interiorColor?.name ?? null,
        interiorColorHex: interiorColor?.hexValue ?? null,
        scenario: { purchaseMethod: solutionWorkbenchPurchaseMethod },
      };
      void apiCreateQuote(customer.id, payload)
        .then(({ id, quoteCode }) => setQuotes((current) => current.map((q) => (q.id === tempId ? { ...q, id, quoteCode } : q))))
        .catch(() => { setQuotes((current) => current.filter((q) => q.id !== tempId)); onToast("견적 저장에 실패했습니다."); });
    }

    setIsQuoteSolutionWorkbenchOpen(false);
    setSolutionWorkbenchModeMenu(null);
    setRecognizedQuoteFile(null);
    markRecentUpdate("견적함");
    onToast("워크벤치 견적을 견적함에 저장했습니다.");
  }
```

주의: `pricing`/`pricingPanelRef`/`exteriorColor`/`interiorColor`/`acquisitionTaxMode`/`trimDetail`/`solutionWorkbenchPurchaseMethod`/`solutionWorkbenchEntryMode`/`recognizedQuoteFile`/`workbenchVehicle`/`selectedWorkbenchOptionIds`는 전부 컴포넌트 스코프 기존 state. `readPricingInputs`/`createKimQuoteCode`/`guardQuoteDraftOutput`/`markRecentUpdate`/`formatKoreanShortTime`/`apiCreateQuote`/`onToast`도 기존. `KimQuoteItem`은 Task 4에서 `finalVehiclePrice`/색상 필드를 가짐.

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: lint**

Run: `bun run lint`
Expected: 0 problems. (`void apiCreateQuote(...)`로 floating promise 회피 — 기존 composer 패턴과 동일.)

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 견적 워크벤치 #4c-2 — saveQuoteFromWorkbench 실입력 추출·영속화"
```

---

## Task 7: 견적함 행에 최종 차량가 + 색상 표시

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx:4215`(note 줄 위)
- Modify: `client/src/index.css`

- [ ] **Step 1: 견적함 행에 가격/색상 라인 추가**

`client/src/pages/CustomerDetailPage.tsx`의 견적함 행에서 `{quote.note ? <p className="kim-quote-row-note">{quote.note}</p> : null}`(4215행) **바로 위**에 추가:

```tsx
                    {(quote.finalVehiclePrice != null || quote.exteriorColorName || quote.interiorColorName) ? (
                      <div className="kim-quote-meta-pricing">
                        {quote.finalVehiclePrice != null ? <span className="kim-quote-final-price">최종 차량가 {formatMoney(quote.finalVehiclePrice)}</span> : null}
                        {quote.exteriorColorName ? (
                          <span className="kim-quote-color-chip">
                            {quote.exteriorColorHex ? <i aria-hidden="true" style={{ background: quote.exteriorColorHex }} /> : null}
                            외장 {quote.exteriorColorName}
                          </span>
                        ) : null}
                        {quote.interiorColorName ? (
                          <span className="kim-quote-color-chip">
                            {quote.interiorColorHex ? <i aria-hidden="true" style={{ background: quote.interiorColorHex }} /> : null}
                            내장 {quote.interiorColorName}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
```

`formatMoney`는 이미 `import { computePricing, formatMoney, parseMoney, ... } from "@/lib/quote-pricing";`(11행)로 임포트됨.

- [ ] **Step 2: CSS 추가**

`client/src/index.css` 끝에 추가(기존 `.kim-quote-meta-secondary` 톤에 맞춤):

```css
.kim-quote-meta-pricing {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin-top: 4px;
  font-size: 11.5px;
  color: #5f6872;
}
.kim-quote-final-price {
  font-weight: 600;
  color: #2b2f36;
}
.kim-quote-color-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.kim-quote-color-chip i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.18);
}
```

- [ ] **Step 3: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 errors, 0 problems.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/CustomerDetailPage.tsx client/src/index.css
git commit -m "feat(crm): 견적 워크벤치 #4c-2 — 견적함 행 최종 차량가·색상 표시"
```

---

## Task 8: 통합 검증

**Files:** 없음(검증만)

- [ ] **Step 1: 전체 검증 4종**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun test --env-file=.env.local && bun run build`
Expected: typecheck 0 · lint 0 · test:unit 통과(kim-quote 신규 포함) · test:server 통과(견적 생성 2건 추가) · build OK.

- [ ] **Step 2: 브라우저 수동 검증(인증 세션)**

`bun run dev` 후 로그인 → 김민준(`CU-2605-0020`) 상세 → 견적함 헤더 `+`(견적 작성) → 워크벤치:
- VehiclePicker로 브랜드/모델/트림 선택 → 기본가·할인 자동 채워짐
- OptionPicker로 옵션 선택 → 옵션금액·최종 차량가 갱신
- ColorPicker로 외장/내장 색상 선택
- "견적함에 저장" → 목록에 새 견적 추가(최종 차량가·색상 표시) → **새로고침해도 유지**(이전엔 원복) → `quote_code`가 `QT-2606-####`

Expected: 저장값이 재진입 후에도 그대로. (저장 실패 시 토스트 + 항목 롤백.)

- [ ] **Step 3: brief 갱신 + 최종 커밋**

`ref/active-session-brief.md`의 Current Focus를 #4c-2 완료 + 다음(#4c-3) 핸드오프로 갱신.

```bash
git add ref/active-session-brief.md
git commit -m "docs(brief): #4c-2 워크벤치 영속화 완료 반영 + #4c-3 핸드오프"
```

---

## 미결 / 다음 (이 plan 범위 밖)

- **#4c-3**: 하단 비교카드(금융조건) 영속화 + 다중 시나리오(1~3) + 대표 지정 UI. scenario `term_months/monthly_payment/lender/deposit*/residual*/interest_rate` 등.
- **워크벤치 편집 로드**: 재오픈 시 저장 견적을 가격 패널에 로드(현재 mock 기본값) + `discount_lines` 라인 상세 영속.
- **#4d**: 원본 파일 업로드 영속(Storage·file_*).
- `valid_until`(D-day)·`stock_status` 워크벤치 입력 UI.
