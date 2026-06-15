# 차량 선택 → 견적 가격 반영 (1단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적 workbench에서 트림을 선택하면 그 트림의 실제 가격/할인이 가격 패널 합산에 자동 반영되게 한다.

**Architecture:** 입력 input은 uncontrolled 유지(기존 Jeff money UX와 충돌 회피), 합산 표시만 React state로 파생, 계산식은 순수함수 lib로 분리. 트림 선택 시 `fetchTrimDetail`로 받아 입력 `.value`를 명령형으로 채우고 재계산.

**Tech Stack:** React + TypeScript, vitest(클라이언트 단위테스트), Hono read API(`/api/vehicles/trims/:id`, 기완성).

**Spec:** `ref/specs/2026-06-15-quote-price-injection-design.md`

---

## File Structure

- **Create** `client/src/lib/quote-pricing.ts` — 순수 계산(파싱/포맷/합산). DOM·React 비의존.
- **Create** `client/src/lib/quote-pricing.test.ts` — 위 함수 단위테스트(vitest).
- **Modify** `client/src/lib/vehicles.ts` — `TrimDetail` 타입 + `fetchTrimDetail` 추가.
- **Modify** `client/src/lib/vehicles.test.ts` — `fetchTrimDetail` 테스트 추가.
- **Modify** `client/src/pages/CustomerDetailPage.tsx` — 가격 패널 연결(입력 식별자/summary state/재계산/트림 자동채움).

검증 명령(이 저장소 기준):
- 타입: `bun run typecheck`
- 린트: `bun run lint` (0 problems 유지)
- 클라이언트 단위테스트: `bunx vitest run client/src/lib/quote-pricing.test.ts client/src/lib/vehicles.test.ts`

---

## Task 1: 견적 가격 순수 계산 lib

**Files:**
- Create: `client/src/lib/quote-pricing.ts`
- Test: `client/src/lib/quote-pricing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/quote-pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { computePricing, formatMoney, parseMoney } from "./quote-pricing";

describe("parseMoney", () => {
  it("콤마/원 기호를 제거하고 숫자로 변환", () => {
    expect(parseMoney("243,000,000")).toBe(243000000);
    expect(parseMoney("6,500,000원")).toBe(6500000);
  });
  it("빈값·비숫자는 0", () => {
    expect(parseMoney("")).toBe(0);
    expect(parseMoney("미선택")).toBe(0);
  });
});

describe("formatMoney", () => {
  it("천단위 콤마", () => {
    expect(formatMoney(243000000)).toBe("243,000,000");
    expect(formatMoney(0)).toBe("0");
  });
});

describe("computePricing", () => {
  it("현재 mock 시나리오와 일치", () => {
    expect(
      computePricing({
        basePrice: 243000000,
        optionPrice: 0,
        discount: 6500000,
        acquisitionTax: 13531000,
        bond: 0,
        delivery: 0,
        incidental: 0,
      }),
    ).toEqual({
      finalVehiclePrice: 236500000,
      registrationCost: 13531000,
      otherCost: 0,
      acquisitionCost: 250031000,
    });
  });
  it("할인·취득세·기타비용 변동 반영", () => {
    const r = computePricing({
      basePrice: 100000000,
      optionPrice: 5000000,
      discount: 3000000,
      acquisitionTax: 7000000,
      bond: 500000,
      delivery: 300000,
      incidental: 200000,
    });
    expect(r.finalVehiclePrice).toBe(102000000);
    expect(r.registrationCost).toBe(7500000);
    expect(r.otherCost).toBe(500000);
    expect(r.acquisitionCost).toBe(109500000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run client/src/lib/quote-pricing.test.ts`
Expected: FAIL — `Failed to resolve import "./quote-pricing"` (파일 없음).

- [ ] **Step 3: Write minimal implementation**

Create `client/src/lib/quote-pricing.ts`:

```ts
// 견적 가격 패널 순수 계산. DOM/React 비의존 — 단위 테스트 가능.
// 합산 공식(1단계, 포함/불포함 분류는 정적): ref/specs/2026-06-15-quote-price-injection-design.md

export function parseMoney(value: string): number {
  const digits = value.replace(/[^\d]/g, "");
  if (digits === "") return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export type PricingInputs = {
  basePrice: number;
  optionPrice: number;
  discount: number;
  acquisitionTax: number;
  bond: number;
  delivery: number;
  incidental: number;
};

export type PricingResult = {
  finalVehiclePrice: number;
  registrationCost: number;
  otherCost: number;
  acquisitionCost: number;
};

export function computePricing(inputs: PricingInputs): PricingResult {
  const finalVehiclePrice = inputs.basePrice + inputs.optionPrice - inputs.discount;
  const registrationCost = inputs.acquisitionTax + inputs.bond;
  const otherCost = inputs.delivery + inputs.incidental;
  const acquisitionCost = finalVehiclePrice + registrationCost;
  return { finalVehiclePrice, registrationCost, otherCost, acquisitionCost };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run client/src/lib/quote-pricing.test.ts`
Expected: PASS (3 describe, 4 it 모두 통과).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/quote-pricing.ts client/src/lib/quote-pricing.test.ts
git commit -m "feat: 견적 가격 계산 순수함수(quote-pricing) 추가"
```

---

## Task 2: 트림 상세 fetch (fetchTrimDetail)

**Files:**
- Modify: `client/src/lib/vehicles.ts` (타입 정의는 `Trim` 타입 뒤, 함수는 `fetchTrims` 뒤)
- Test: `client/src/lib/vehicles.test.ts`

- [ ] **Step 1: Write the failing test**

Edit `client/src/lib/vehicles.test.ts` — 첫 import 줄에 `fetchTrimDetail` 추가:

```ts
import { fetchBrands, fetchModels, fetchTrims, fetchTrimDetail } from "./vehicles";
```

그리고 `describe("vehicles api", ...)` 안, `throws on non-ok response` 테스트 **앞**에 추가:

```ts
  it("fetchTrimDetail GETs /api/vehicles/trims/:id", async () => {
    const detail = {
      id: 100,
      modelId: 10,
      name: "S 500",
      price: 50000000,
      financialDiscountAmount: 1000000,
      partnerDiscountAmount: null,
      cashDiscountAmount: null,
      options: [],
      optionRelations: [],
      colors: [],
      noOptions: null,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(detail), { status: 200 })));
    const result = await fetchTrimDetail(100);
    expect(fetch).toHaveBeenCalledWith("/api/vehicles/trims/100");
    expect(result).toEqual(detail);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run client/src/lib/vehicles.test.ts`
Expected: FAIL — `fetchTrimDetail` is not exported / not a function.

- [ ] **Step 3: Write minimal implementation**

Edit `client/src/lib/vehicles.ts` — `Trim` 타입 정의 바로 뒤에 타입 추가:

```ts
export type TrimOption = { id: number; type: "basic" | "tuning"; name: string; price: number | null };
export type TrimOptionRelation = { id: number; optionId: number; relatedOptionId: number; type: "includes" | "excludes" };
export type TrimColor = {
  id: number;
  colorType: "exterior" | "interior";
  name: string;
  code: string | null;
  hexValue: string | null;
  sortOrder: number;
};
export type TrimDetail = Trim & {
  specs: unknown;
  financialDiscountAmount: number | null;
  partnerDiscountAmount: number | null;
  cashDiscountAmount: number | null;
  options: TrimOption[];
  optionRelations: TrimOptionRelation[];
  colors: TrimColor[];
  noOptions: { note: string | null; checkedAt: string } | null;
};
```

그리고 `fetchTrims` 함수 바로 뒤에 fetch 함수 추가:

```ts
export function fetchTrimDetail(trimId: number): Promise<TrimDetail> {
  return getJson<TrimDetail>(`/api/vehicles/trims/${trimId}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run client/src/lib/vehicles.test.ts`
Expected: PASS (기존 4 + 신규 1 = 5 통과).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/vehicles.ts client/src/lib/vehicles.test.ts
git commit -m "feat: 트림 상세 조회 fetchTrimDetail + TrimDetail 타입 추가"
```

---

## Task 3: 가격 패널 연결 (CustomerDetailPage)

거대 컴포넌트(5479줄)이고 명령형 DOM/Jeff money UX와 얽혀 통합 단위테스트가 비싸므로, 이 Task는 구현 + `typecheck`/`lint`/수동 확인으로 검증한다(spec ⑤ 합의).

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`

> 참고: `useState`/`useRef`는 이 파일에서 이미 사용 중이라 React import는 그대로 둔다(`quoteDetailFormRef = useRef`, 다수 `useState` 존재).

- [ ] **Step 1: import 추가**

`import { VehiclePicker } from "@/components/VehiclePicker";` (현재 4번째 줄)를 다음으로 교체:

```ts
import { VehiclePicker, type VehicleSelection } from "@/components/VehiclePicker";
```

그리고 import 블록 끝(다른 `@/lib` import들과 같은 구역)에 추가:

```ts
import { fetchTrimDetail } from "@/lib/vehicles";
import { computePricing, formatMoney, parseMoney, type PricingInputs, type PricingResult } from "@/lib/quote-pricing";
```

- [ ] **Step 2: state + ref 추가**

견적 관련 `useState` 묶음 끝(현재 `previewSentQuoteId` 선언, 약 1374줄) 바로 뒤에 추가. 초기값은 현재 mock 화면값과 동일하게 둬서 첫 렌더가 안 바뀌게 한다:

```ts
  const [pricing, setPricing] = useState<PricingResult>({
    finalVehiclePrice: 236500000,
    registrationCost: 13531000,
    otherCost: 0,
    acquisitionCost: 250031000,
  });
  const pricingPanelRef = useRef<HTMLElement>(null);
```

- [ ] **Step 3: 재계산/자동채움 헬퍼 추가**

`markQuoteDraftChanged` 함수(약 1491줄) 바로 뒤에 추가:

```ts
  function readPricingInputs(root: HTMLElement): PricingInputs {
    const read = (key: string) =>
      parseMoney(root.querySelector<HTMLInputElement>(`input[data-pricing="${key}"]`)?.value ?? "");
    return {
      basePrice: read("base"),
      optionPrice: read("option"),
      discount: read("discount"),
      acquisitionTax: read("acquisitionTax"),
      bond: read("bond"),
      delivery: read("delivery"),
      incidental: read("incidental"),
    };
  }

  function recomputePricing() {
    const root = pricingPanelRef.current;
    if (!root) return;
    setPricing(computePricing(readPricingInputs(root)));
  }

  async function applyTrimToPricing(selection: VehicleSelection) {
    const trim = selection.trim;
    if (!trim) return;
    try {
      const detail = await fetchTrimDetail(trim.id);
      const root = pricingPanelRef.current;
      if (!root) return;
      const setInput = (key: string, value: number) => {
        const el = root.querySelector<HTMLInputElement>(`input[data-pricing="${key}"]`);
        if (el) el.value = formatMoney(value);
      };
      setInput("base", detail.price);
      setInput("option", 0);
      setInput("discount", detail.financialDiscountAmount ?? 0);
      recomputePricing();
      markQuoteDraftChanged();
    } catch (error) {
      console.warn("트림 상세 로드 실패", error);
    }
  }
```

- [ ] **Step 4: blur에서도 재계산(최종 보정)**

`handleJeffMoneyInputBlur`(약 1451줄) 안의 `markQuoteDraftChanged();` 바로 뒤에 한 줄 추가. 명령형 value 교체(replace-preview)로 input 이벤트가 안 떠도 포커스 이탈 시 합산이 맞도록 보정한다:

```ts
  function handleJeffMoneyInputBlur(event: ReactFocusEvent<HTMLDivElement>) {
    const target = jeffMoneyInputFromTarget(event.target);
    if (!target) return;
    clearJeffMoneyInputPreview(target);
    markQuoteDraftChanged();
    recomputePricing();
  }
```

- [ ] **Step 5: JSX 연결 — 패널 ref/onInput, VehiclePicker onChange, 입력 식별자, summary state**

(5-1) `<section className="kim-jeff-top-panel">`(약 4825줄)을 교체:

```tsx
                <section className="kim-jeff-top-panel" ref={pricingPanelRef} onInput={recomputePricing}>
```

(5-2) `<VehiclePicker />`(약 4829줄)를 교체:

```tsx
                      <VehiclePicker onChange={(selection) => { void applyTrimToPricing(selection); }} />
```

(5-3) 가격 grid 입력 3개(약 4848~4850줄)에 `data-pricing` 부여:

```tsx
                  <div className="kim-jeff-price-grid">
                    <div className="kim-jeff-price-cell"><strong>기본 가격</strong><div className="kim-jeff-money-input"><input data-pricing="base" defaultValue="243,000,000" /><em>원</em></div></div>
                    <div className="kim-jeff-price-cell"><strong>(+) 옵션 금액</strong><div className="kim-jeff-money-input"><input data-pricing="option" defaultValue="0" /><em>원</em></div></div>
                    <div className="kim-jeff-price-cell"><strong>(-) 최종 할인</strong><div className="kim-jeff-money-input"><input data-pricing="discount" defaultValue="6,500,000" /><em>원</em></div></div>
                  </div>
```

(5-4) 취득원가 설정 입력 4개(약 4856~4859줄)에 `data-pricing` 부여 — 각 행의 `<input ... />`에만 속성 추가(나머지 segment/라벨 동일):

```tsx
                      <div className="kim-jeff-form-row"><span>취득세</span><div className="kim-jeff-segment"><button className="active" type="button">일반</button><button type="button">하이브리드 감면</button><button type="button">전기차 감면</button></div><div className="kim-jeff-money-input"><input data-pricing="acquisitionTax" defaultValue="13,531,000" /><em>원</em></div></div>
                      <div className="kim-jeff-form-row"><span>공채</span><div className="kim-jeff-segment"><button className="active" type="button">포함</button><button type="button">불포함</button></div><div className="kim-jeff-money-input"><input data-pricing="bond" defaultValue="0" /><em>원</em></div></div>
                      <div className="kim-jeff-form-row"><span>탁송료</span><div className="kim-jeff-segment"><button type="button">포함</button><button className="active" type="button">불포함</button></div><div className="kim-jeff-money-input"><input data-pricing="delivery" defaultValue="0" /><em>원</em></div></div>
                      <div className="kim-jeff-form-row"><span>부대비용</span><div className="kim-jeff-segment"><button type="button">포함</button><button className="active" type="button">불포함</button></div><div className="kim-jeff-money-input"><input data-pricing="incidental" defaultValue="0" /><em>원</em></div></div>
```

(5-5) summary 4개 span(약 4863~4866줄)을 state 파생으로 교체:

```tsx
                      <div className="kim-jeff-summary-row"><span>최종 차량가(계산서 발행금액)</span><b><span>{formatMoney(pricing.finalVehiclePrice)}</span><em>원</em></b></div>
                      <div className="kim-jeff-summary-row"><span>등록비용(취득원가 포함)</span><b><span>{formatMoney(pricing.registrationCost)}</span><em>원</em></b></div>
                      <div className="kim-jeff-summary-row no-divider"><span>기타비용(취득원가 불포함, 고객 부담)</span><b><span>{formatMoney(pricing.otherCost)}</span><em>원</em></b></div>
                      <div className="kim-jeff-summary-row emphasized"><span>취득원가</span><b><span>{formatMoney(pricing.acquisitionCost)}</span><em>원</em></b></div>
```

- [ ] **Step 6: typecheck**

Run: `bun run typecheck`
Expected: 에러 0. (`VehicleSelection`/`PricingInputs`/`PricingResult` 타입과 ref `HTMLElement` 일치 확인.)

- [ ] **Step 7: lint**

Run: `bun run lint`
Expected: 0 problems(기존 잔여 경고 외 신규 0). `void applyTrimToPricing(...)`로 floating-promise 회피 확인.

- [ ] **Step 8: 클라이언트 단위테스트 회귀 확인**

Run: `bunx vitest run client/src/lib/quote-pricing.test.ts client/src/lib/vehicles.test.ts`
Expected: 전부 PASS.

- [ ] **Step 9: 수동 확인(권장)**

dev 서버를 띄워(워크벤치까지 진입) 트림 선택 시: 기본 가격이 trim.price로, (-) 최종 할인이 financialDiscountAmount로 바뀌고 최종 차량가/취득원가 summary가 재계산되는지, 취득세 input을 손으로 바꾸면 등록비용/취득원가가 따라 바뀌는지 확인. (실행 방법은 최근 커밋 `e1f3e96`의 dev 실행 주의 참고. 자동화 어려우면 이 단계는 사용자 확인으로 위임.)

- [ ] **Step 10: Commit**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat: 트림 선택 → 견적 가격 패널 자동 반영(1단계)"
```

---

## Self-Review 결과

- **Spec coverage**: ① 데이터 레이어=Task 2, ② 계산 레이어=Task 1, ③ 연결=Task 3(Step 1~5), ④ 매핑(base/discount/option)=Task 3 Step 3, ⑤ 테스트=Task 1·2 + Task 3 수동. 비범위(옵션/컬러/취득세 공식/segment 토글/컴포넌트 추출)는 손대지 않음 — 일치.
- **Placeholder scan**: 모든 코드 step에 실제 코드 포함. TODO/TBD 없음.
- **Type consistency**: `PricingInputs`/`PricingResult`(Task 1) ↔ Task 3 `pricing` state/`readPricingInputs` 반환 일치. `VehicleSelection`(VehiclePicker export) ↔ `applyTrimToPricing` 인자 일치. `data-pricing` 키 7개(base/option/discount/acquisitionTax/bond/delivery/incidental)가 `readPricingInputs`·JSX·`applyTrimToPricing`에서 동일.
- **알려진 주의**: 합산 discount 소스는 가격 grid `(-) 최종 할인`(`data-pricing="discount"`)이며, 💰 할인 섹션 input(4842)은 1단계 비범위라 미연결(다음 단계에서 %/금액과 함께).
