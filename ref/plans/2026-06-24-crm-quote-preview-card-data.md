# 견적 미리보기 카드 데이터화 (B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적 워크벤치 우측 앱 견적카드 미리보기(상시 + 확대 모달)의 mock 필드를 워크벤치 실데이터로 연결하고, 카드 마크업 중복을 단일 컴포넌트로 제거한다.

**Architecture:** 흩어진 워크벤치 state를 순수 함수 `buildAppCardModel()`로 카드 표시용 모델 1개로 조립한다. 카드 마크업은 `<KimAppCardPreview model />` 단일 프레젠테이션 컴포넌트로 추출해 상시 + 모달 두 곳에서 재사용한다. 금융조건은 uncontrolled DOM 입력이라 "조건 저장" 시점에 effect로 추출해 `cardScenario` state에 보관(reactive). 소스 없는 필드(금리/총비용)는 안내 텍스트로 표시한다.

**Tech Stack:** React 18, TypeScript 6.0.3, Bun (test/lint/build), 기존 헬퍼 `formatMoney`(quote-pricing), `formatTerm`/`formatScenarioMoneyMode`(kim-quote).

---

## File Structure

- **Create** `client/src/lib/kim-app-card.ts` — `AppCardModel`/`AppCardModelInput` 타입 + 순수 함수 `buildAppCardModel`. 카드 표시 변환 로직의 단일 소스.
- **Create** `client/src/lib/kim-app-card.test.ts` — `buildAppCardModel` 단위테스트.
- **Create** `client/src/components/KimAppCardPreview.tsx` — model 1개를 받아 카드를 렌더하는 프레젠테이션 컴포넌트(DOM/state 직접 접근 없음).
- **Modify** `client/src/pages/CustomerDetailPage.tsx` — `pricingInputs`/`cardScenario` state 추가, `recomputePricing` 보강, 조건 저장 effect, `appCardModel` 조립, 상시(~5000행)·모달(~5092행) 카드 마크업을 컴포넌트로 교체.

---

## Task 1: 카드 viewmodel 순수 함수 `buildAppCardModel`

**Files:**
- Create: `client/src/lib/kim-app-card.ts`
- Test: `client/src/lib/kim-app-card.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `client/src/lib/kim-app-card.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildAppCardModel, type AppCardModelInput } from "./kim-app-card";
import { DEFAULT_QUOTE_GUIDANCE } from "@/data/quote-guidance";

const base: AppCardModelInput = {
  brandName: "벤츠",
  modelName: "Maybach S-Class",
  trimName: "S 500 4M Long",
  modelYear: 2026,
  basePrice: 166000000,
  discount: 5000000,
  finalVehiclePrice: 161000000,
  registrationCost: 7000000,
  acquisitionCost: 168000000,
  exteriorColorName: "옵시디언 블랙",
  interiorColorName: "마키아토 베이지",
  guidance: { ...DEFAULT_QUOTE_GUIDANCE, stockNotice: "즉시 출고 가능", expectedDelivery: "1주일 이내", customerRegion: "인천" },
  purchaseMethod: "운용리스",
  scenario: {
    scenarioNo: 1,
    purchaseMethod: "운용리스",
    termMonths: 60,
    monthlyPayment: "2398000",
    lender: "우리금융캐피탈",
    depositMode: "percent",
    depositValue: "30",
    downPaymentMode: "none",
    downPaymentValue: null,
    residualMode: "max",
    residualValue: null,
    mileageMode: "basic",
    mileageValue: "20,000km / 년",
  },
};

describe("buildAppCardModel", () => {
  it("실데이터 입력을 카드 라벨로 변환한다", () => {
    const m = buildAppCardModel(base);
    expect(m.brand).toBe("벤츠");
    expect(m.modelLabel).toBe("Maybach S-Class");
    expect(m.trimLabel).toBe("S 500 4M Long");
    expect(m.yearLabel).toBe("2026년식");
    expect(m.basePriceLabel).toBe("166,000,000");
    expect(m.discountLabel).toBe("5,000,000");
    expect(m.purchaseMethod).toBe("운용리스");
    expect(m.termLabel).toBe("60개월");
    expect(m.monthlyLabel).toBe("2,398,000원");
    expect(m.lenderLabel).toBe("우리금융캐피탈");
    expect(m.depositLabel).toBe("30%");
    expect(m.downPaymentLabel).toBe("없음");
    expect(m.residualLabel).toBe("최대");
    expect(m.mileageLabel).toBe("20,000km / 년");
    expect(m.exteriorColorLabel).toBe("옵시디언 블랙");
    expect(m.interiorColorLabel).toBe("마키아토 베이지");
    expect(m.stockNotice).toBe("즉시 출고 가능");
    expect(m.expectedDelivery).toBe("1주일 이내");
    expect(m.customerRegion).toBe("인천");
    expect(m.finalVehiclePriceLabel).toBe("161,000,000");
    expect(m.acquisitionCostLabel).toBe("168,000,000");
    expect(m.hasScenario).toBe(true);
  });

  it("소스 없는 필드(금리/총비용)는 안내 텍스트로 표시한다", () => {
    const m = buildAppCardModel(base);
    expect(m.rateLabel).toBe("—");
    expect(m.totalCostLabel).toBe("계산 후 안내");
  });

  it("시나리오가 없으면 placeholder/미정으로 표시하고 hasScenario=false", () => {
    const m = buildAppCardModel({ ...base, scenario: null });
    expect(m.hasScenario).toBe(false);
    expect(m.monthlyLabel).toBe("계산 후 안내");
    expect(m.termLabel).toBe("조건 미정");
    expect(m.depositLabel).toBe("조건 미정");
    expect(m.lenderLabel).toBe("금융사 미정");
  });

  it("차량/연식/색상 미선택은 폴백 라벨을 쓴다", () => {
    const m = buildAppCardModel({ ...base, brandName: null, modelName: null, trimName: null, modelYear: null, exteriorColorName: null, interiorColorName: null });
    expect(m.brand).toBe("차량 미선택");
    expect(m.modelLabel).toBe("차량 미선택");
    expect(m.trimLabel).toBe("");
    expect(m.yearLabel).toBe("");
    expect(m.exteriorColorLabel).toBe("미선택");
    expect(m.interiorColorLabel).toBe("미선택");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bunx vitest run client/src/lib/kim-app-card.test.ts`
Expected: FAIL — `Cannot find module './kim-app-card'`

- [ ] **Step 3: `kim-app-card.ts` 구현**

Create `client/src/lib/kim-app-card.ts`:

```ts
import type { QuoteGuidance } from "@/data/quote-guidance";
import type { ScenarioInput } from "./customer-quotes";
import { formatScenarioMoneyMode, formatTerm } from "./kim-quote";
import { formatMoney } from "./quote-pricing";

// 미리보기 카드 조립 입력. 워크벤치 state에서 추출한 스냅샷(순수 변환을 위해 원시값만 받는다).
export type AppCardModelInput = {
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  modelYear: number | null;
  basePrice: number;
  discount: number;
  finalVehiclePrice: number;
  registrationCost: number;
  acquisitionCost: number;
  exteriorColorName: string | null;
  interiorColorName: string | null;
  guidance: QuoteGuidance;
  purchaseMethod: string;
  scenario: ScenarioInput | null;
};

// 카드 표시용 라벨 모델. KimAppCardPreview가 이 값을 그대로 렌더한다.
export type AppCardModel = {
  brand: string;
  modelLabel: string;
  trimLabel: string;
  yearLabel: string;
  basePriceLabel: string;
  discountLabel: string;
  purchaseMethod: string;
  termLabel: string;
  monthlyLabel: string;
  rateLabel: string;
  residualLabel: string;
  totalCostLabel: string;
  depositLabel: string;
  downPaymentLabel: string;
  mileageLabel: string;
  lenderLabel: string;
  exteriorColorLabel: string;
  interiorColorLabel: string;
  stockNotice: string;
  expectedDelivery: string;
  customerRegion: string;
  finalVehiclePriceLabel: string;
  registrationCostLabel: string;
  acquisitionCostLabel: string;
  hasScenario: boolean;
};

// 계산엔진 미연결 필드(금리/총비용)는 가짜 숫자 대신 정직한 안내 텍스트로 표시한다.
const CALC_PENDING = "계산 후 안내";
const NO_SOURCE = "—";

function monthlyLabelOf(raw: string | null | undefined): string {
  if (!raw) return CALC_PENDING;
  const n = Number(raw);
  return Number.isNaN(n) ? CALC_PENDING : `${formatMoney(n)}원`;
}

export function buildAppCardModel(input: AppCardModelInput): AppCardModel {
  const s = input.scenario;
  return {
    brand: input.brandName ?? "차량 미선택",
    modelLabel: input.modelName ?? "차량 미선택",
    trimLabel: input.trimName ?? "",
    yearLabel: input.modelYear != null ? `${input.modelYear}년식` : "",
    basePriceLabel: formatMoney(input.basePrice),
    discountLabel: formatMoney(input.discount),
    purchaseMethod: input.purchaseMethod,
    termLabel: formatTerm(s?.termMonths ?? null),
    monthlyLabel: monthlyLabelOf(s?.monthlyPayment),
    rateLabel: NO_SOURCE,
    residualLabel: formatScenarioMoneyMode(s?.residualMode ?? null, s?.residualValue ?? null) ?? CALC_PENDING,
    totalCostLabel: CALC_PENDING,
    depositLabel: formatScenarioMoneyMode(s?.depositMode ?? null, s?.depositValue ?? null) ?? "조건 미정",
    downPaymentLabel: formatScenarioMoneyMode(s?.downPaymentMode ?? null, s?.downPaymentValue ?? null) ?? "없음",
    mileageLabel: s?.mileageValue ?? "20,000km / 년",
    lenderLabel: s?.lender ?? "금융사 미정",
    exteriorColorLabel: input.exteriorColorName ?? "미선택",
    interiorColorLabel: input.interiorColorName ?? "미선택",
    stockNotice: input.guidance.stockNotice,
    expectedDelivery: input.guidance.expectedDelivery,
    customerRegion: input.guidance.customerRegion,
    finalVehiclePriceLabel: formatMoney(input.finalVehiclePrice),
    registrationCostLabel: formatMoney(input.registrationCost),
    acquisitionCostLabel: formatMoney(input.acquisitionCost),
    hasScenario: s != null,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bunx vitest run client/src/lib/kim-app-card.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/kim-app-card.ts client/src/lib/kim-app-card.test.ts
git commit -m "feat(crm): 앱 견적카드 viewmodel buildAppCardModel + 테스트

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 카드 프레젠테이션 컴포넌트 `KimAppCardPreview`

**Files:**
- Create: `client/src/components/KimAppCardPreview.tsx`

거대 JSX 컴포넌트라 단위테스트 대신 typecheck + 후속 브라우저 검증(brief 관례). 기존 카드 마크업(상시: `CustomerDetailPage.tsx` 5000~5067, 모달: 5092~5159)과 동일 구조를 옮기되, mock 표현식을 `model.*`로 치환하고 D-6/미확인 견적은 현행 유지한다.

- [ ] **Step 1: 컴포넌트 작성**

Create `client/src/components/KimAppCardPreview.tsx`:

```tsx
import type { AppCardModel } from "@/lib/kim-app-card";

// 고객 앱 견적카드 미리보기. 워크벤치 우측 상시 + 확대 모달에서 동일 컴포넌트를 재사용한다.
// model 1개만 받고 DOM/state를 직접 읽지 않는다(조립은 부모 워크벤치 책임).
// 주의: D-6 / "미확인 견적"은 발송 상태값(미리보기 맥락)이라 현행 mock 유지.
export function KimAppCardPreview({ model, inModal = false }: { model: AppCardModel; inModal?: boolean }) {
  return (
    <aside className={`kim-app-card-preview${inModal ? " in-modal" : ""}`} aria-label="앱 견적카드 미리보기">
      <div className="kim-app-card">
        <div className="kim-app-card-status">
          <strong>🔔 미확인 견적</strong>
          <span>● D-6</span>
        </div>
        <div className="kim-app-card-body">
          <div className="kim-app-card-hero">
            <div>
              <span>{model.brand}</span>
              <strong>{model.modelLabel}<br />{model.trimLabel}</strong>
              <p>{[model.yearLabel, `${model.basePriceLabel}원`, "기본 제공 옵션"].filter(Boolean).join(" ㅣ ")}</p>
            </div>
            <div>
              <b>{model.purchaseMethod}</b>
              <b>{model.termLabel}</b>
            </div>
          </div>

          <div className="kim-app-pay-box">
            <span>월 납입금</span>
            <strong>{model.monthlyLabel}</strong>
            <em>금리 {model.rateLabel}</em>
            <p>잔존가치 {model.residualLabel} · 총 비용 {model.totalCostLabel}</p>
          </div>

          <div className="kim-app-discount-box">
            <span>최대 할인 적용</span>
            <strong>-{model.discountLabel}원</strong>
          </div>

          <div className="kim-app-mini-grid">
            <div><span>보증금</span><strong>{model.depositLabel}</strong></div>
            <div><span>주행거리</span><strong>{model.mileageLabel}</strong></div>
          </div>

          <div className="kim-app-detail-block">
            <header>🚗 출고 시기 정보</header>
            <dl>
              <dt>외장 컬러</dt><dd>{model.exteriorColorLabel}</dd>
              <dt>내장 컬러</dt><dd>{model.interiorColorLabel}</dd>
              <dt>재고 여부</dt><dd className="green">{model.stockNotice}</dd>
              <dt>예상 출고</dt><dd>{model.expectedDelivery}</dd>
              <dt>고객 지역</dt><dd>{model.customerRegion}</dd>
            </dl>
          </div>

          <div className="kim-app-detail-block">
            <header>📌 취득원가 구성</header>
            <dl>
              <dt>최종 차량가</dt><dd className="green">{model.finalVehiclePriceLabel}원</dd>
              <dt>등록비용 합계</dt><dd className="green">{model.registrationCostLabel}원</dd>
              <dt>취득원가</dt><dd className="blue">{model.acquisitionCostLabel}원</dd>
            </dl>
          </div>

          <div className="kim-app-detail-block">
            <header>🧾 추천 견적 조건</header>
            {model.hasScenario ? (
              <dl>
                <dt>금융사</dt><dd>{model.lenderLabel}</dd>
                <dt>보증금</dt><dd>{model.depositLabel}</dd>
                <dt>선수금</dt><dd>{model.downPaymentLabel}</dd>
                <dt>최종 월 납입금</dt><dd className="blue">{model.monthlyLabel}</dd>
              </dl>
            ) : (
              <p className="kim-app-detail-empty">조건 저장 후 표시됩니다</p>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 0 errors (컴포넌트는 아직 미사용이지만 타입은 통과해야 함)

- [ ] **Step 3: 커밋**

```bash
git add client/src/components/KimAppCardPreview.tsx
git commit -m "feat(crm): 앱 견적카드 단일 프레젠테이션 컴포넌트 KimAppCardPreview

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: CustomerDetailPage 배선 + 카드 두 곳 교체

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: import 추가**

`KimMinjunDetailContent`가 정의된 파일 상단 import 구역에 추가한다(컴포넌트/lib import는 lucide-react/react import 아래 기존 import들과 같은 그룹).

```tsx
import { KimAppCardPreview } from "@/components/KimAppCardPreview";
import { buildAppCardModel, type AppCardModel } from "@/lib/kim-app-card";
```

또한 `PricingInputs` 타입은 이미 `import { computePricing, formatMoney, parseMoney, type PricingInputs, type PricingResult } from "@/lib/quote-pricing";`로 import돼 있다(추가 불필요). `ScenarioInput`도 이미 `@/lib/customer-quotes`에서 import돼 있다(추가 불필요).

- [ ] **Step 2: `pricingInputs` / `cardScenario` state 추가**

`const [pricing, setPricing] = useState<PricingResult>(kimMaybachQuotePricingResult);` (line ~891) 바로 아래에 추가:

```tsx
  const [pricingInputs, setPricingInputs] = useState<PricingInputs>(kimMaybachQuotePricingMock);
  const [cardScenario, setCardScenario] = useState<ScenarioInput | null>(null);
```

- [ ] **Step 3: `recomputePricing`이 inputs도 보관하도록 보강**

`recomputePricing` (line ~1179) 본문을 교체:

```tsx
  function recomputePricing() {
    const root = pricingPanelRef.current;
    if (!root) return;
    const inputs = readPricingInputs(root);
    setPricingInputs(inputs);
    setPricing(computePricing(inputs));
  }
```

- [ ] **Step 4: 조건 저장 시 대표 시나리오 추출 effect 추가**

`extractWorkbenchScenarios` 함수 정의(line ~2177) **아래**(같은 컴포넌트 스코프, 다른 effect들과 같은 영역)에 effect 추가. 저장된 조건이 바뀔 때만 대표(첫) 시나리오를 추출해 보관한다. 저장 후 비교카드 입력은 disabled(값 고정)라 1회 캡처로 안정적:

```tsx
  useEffect(() => {
    if (!savedManualQuoteConditionIds.length) {
      setCardScenario(null);
      return;
    }
    setCardScenario(extractWorkbenchScenarios()[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 저장된 조건 목록 변경 시에만 대표 시나리오 재추출(저장 후 입력 disabled라 안정적, extract는 DOM 읽기)
  }, [savedManualQuoteConditionIds]);
```

- [ ] **Step 5: `appCardModel` 조립**

`workbenchVehicleLabel` 파생값(line ~1007) 근처(같은 컴포넌트 본문, 카드 렌더보다 위)에 카드 모델 조립을 추가:

```tsx
  const appCardModel: AppCardModel = buildAppCardModel({
    brandName: workbenchVehicle?.brand?.name ?? null,
    modelName: workbenchVehicle?.model?.name ?? trimDetail?.modelName ?? null,
    trimName: trimDetail?.trimName ?? trimDetail?.name ?? null,
    modelYear: trimDetail?.modelYear ?? null,
    basePrice: pricingInputs.basePrice,
    discount: pricingInputs.discount,
    finalVehiclePrice: pricing.finalVehiclePrice,
    registrationCost: pricing.registrationCost,
    acquisitionCost: pricing.acquisitionCost,
    exteriorColorName: exteriorColor?.name ?? null,
    interiorColorName: interiorColor?.name ?? null,
    guidance,
    purchaseMethod: solutionWorkbenchPurchaseMethod,
    scenario: cardScenario,
  });
```

- [ ] **Step 6: 상시 카드 마크업 교체**

상시 미리보기 카드 전체(`<aside className="kim-app-card-preview" ...> ... </aside>`, line ~5000~5067)를 다음으로 교체:

```tsx
                  <KimAppCardPreview model={appCardModel} />
```

- [ ] **Step 7: 모달 카드 마크업 교체**

모달 안 카드(`<aside className="kim-app-card-preview in-modal" ...> ... </aside>`, line ~5092~5159)를 다음으로 교체:

```tsx
                    <KimAppCardPreview model={appCardModel} inModal />
```

- [ ] **Step 8: 사용하지 않게 된 mock 참조 정리 확인**

교체 후 `kimMaybachQuotePricingResult`는 여전히 `useState<PricingResult>(kimMaybachQuotePricingResult)` / `useState<PricingInputs>(kimMaybachQuotePricingMock)` 초기값으로 쓰이므로 **삭제하지 않는다**. 카드에서만 쓰던 직접 참조가 사라졌는지 확인:

Run: `grep -n "kimMaybachQuotePricingResult\|kimMaybachQuotePricingMock" client/src/pages/CustomerDetailPage.tsx`
Expected: 초기 state 기본값(line ~891)과 pricing 입력 패널 defaultValue(line ~4834~4875)만 남고, 카드 영역(5000~5160)에는 더 이상 나타나지 않음.

- [ ] **Step 9: 검증 (typecheck / lint / test / build)**

```bash
bun run typecheck
bun run lint
bunx vitest run client/src/lib/kim-app-card.test.ts
bun run build
```
Expected: typecheck 0 errors, lint 0 problems, kim-app-card 테스트 PASS, build OK.

- [ ] **Step 10: 커밋**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 미리보기 카드 데이터화 + KimAppCardPreview 두 곳 교체 (B)

차량명/가격/구매방식/금융조건/취득원가/출고시기를 워크벤치 실데이터로
연결. 금융조건은 조건 저장 시점 effect로 cardScenario 추출(reactive).
basePrice/discount는 recompute 시 pricingInputs state 보관. 소스 없는
금리/총비용은 안내 텍스트.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 브라우저 검증 (배포 후 / 카카오 세션, 별도)

플랜 자동 검증으로는 typecheck/lint/test/build만 확인된다. 다음은 카카오 로그인 세션이 필요해 별도 수동 검증한다:

- 워크벤치에서 차량 선택 변경 → 상시 카드 + 확대 모달 두 곳 모두 차량명/연식/기본가 실시간 반영(Maybach 하드코딩 사라짐).
- 외장/내장 컬러 변경 → 카드 출고시기 블록 반영(기존 동작 유지).
- 추가 안내(재고/예상출고/고객지역) 변경 → 카드 출고시기 블록 반영.
- 가격 입력(기본가/할인) 변경 → 카드 기본가/할인/취득원가 구성 반영.
- 비교카드 "조건 저장" → 추천 견적 조건 블록에 금융사/보증금/선수금/월납입 반영. 저장 해제 시 "조건 저장 후 표시" placeholder.
- 금리/총비용 칸이 "—" / "계산 후 안내"로 표시(가짜 숫자 없음).

---

## Self-Review 메모

- **Spec 커버리지**: 데이터 매핑 표 전 항목 → Task 1(`buildAppCardModel`) + Task 3(조립). 컴포넌트 추출 → Task 2. pricingInputs state → Task 3 Step2~3. 시나리오 reactive → Task 3 Step4. 소스 없는 필드 안내 텍스트 → Task 1(`CALC_PENDING`/`NO_SOURCE`). 범위 외(핵심포인트/추천이유/서비스, 계산엔진, Flutter) → 미포함 확인.
- **타입 일관성**: `AppCardModel`/`AppCardModelInput` 필드명이 Task 1 정의와 Task 2 사용, Task 3 조립에서 일치. `ScenarioInput` 필드(depositMode/Value 등)는 `customer-quotes.ts` 실제 타입과 일치.
- **Placeholder 없음**: 모든 코드 step에 실제 코드 포함.
