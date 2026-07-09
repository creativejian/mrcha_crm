# 견적 워크벤치 카드 UI 상태 통합(CardUiState) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`로 태스크 단위 실행. 스텝은 체크박스(`- [ ]`)로 추적한다.

**Goal:** 견적 워크벤치 비교카드(`견적 작성 1/2/3`)의 UI 상태를 속성별 `Record` 8벌에서 카드별 `CardUiState` 객체 1벌로 통합해, 카드 속성 추가·복원·추출 누락을 컴파일러가 잡게 한다.

**Architecture:** `client/src/components/customer-detail/quote-workbench-meta.ts`에 순수 타입·상수·헬퍼(`CardUiState`·`DEFAULT_CARD_UI`·`cardUiOf`·`cardUiFromScenario`·`cardUiFromSeed`)를 TDD로 먼저 세우고, `useQuoteWorkbench.ts`의 state 8개를 `Record<string, CardUiState>` 1개로 교체한다. 소비처(`QuoteWorkbench.tsx`)는 같은 커밋에서 함께 옮긴다(typecheck이 그물). 마지막으로 `ManualCard`의 모드 3필드를 제거해 이중 소스를 없앤다.

**Tech Stack:** React 19 + TypeScript 6.0.3, vitest(`bun run test:unit`), bun.

**행위 무변경 계약:** 이 작업은 순수 리팩토링이다. 저장 payload(`extractWorkbenchScenarios` → `crm.quote_scenarios`)와 화면 표시가 **바이트 단위로 동일**해야 한다. 기능 추가·기본값 변경은 범위 밖.

---

## 배경 — 왜 하는가

카드 하나의 속성이 8개의 별도 state에 흩어져 있다(`useQuoteWorkbench.ts:80-88`).

| 화면 줄 | 현재 state |
|---|---|
| 기간 | `manualTermMonths: Record<string, number>` |
| 보증금 | `manualDepositModes: Record<string, ManualDepositMode>` |
| 선수금 | `manualDownPaymentModes: Record<string, ManualDepositMode>` |
| 잔존가치 | `manualResidualModes: Record<string, ManualResidualMode>` |
| 약정거리 모드 | `manualMileageModes: Record<string, ManualMileageMode>` |
| 약정거리 값 | `manualMileageValues: Record<string, string>` |
| 자동차세 | `manualCarTaxIncluded: Record<string, boolean>` |
| 보조금 | `manualSubsidyApplicable: Record<string, boolean>` |

카드 하나를 다루는 모든 동작이 8곳을 동시에 건드려야 하고, `Record`에 키가 없으면 `undefined`가 읽는 쪽 `?? 60` / `?? "basic"` / `?? false` 폴백에 조용히 흡수된다 — **컴파일러가 누락을 못 잡는다.** #163(0705 배치 A)이 정확히 이 경로에서 실버그를 냈다(모드 잔상이 `extractWorkbenchScenarios`를 타고 저장 payload 오염 + 수정 진입 시 `acquisitionTaxMode` 미복원).

**추가로 발견된 이중 소스:** `depositMode`·`downPaymentMode`·`residualMode`는 `Record`에도 있고 `ManualCard`에도 있다.

- `useQuoteWorkbench.ts:738-740` — `manualDepositModes[condId] ?? card.depositMode ?? null`
- `QuoteWorkbench.tsx:429-431` — `manualDepositModes[condition.id] ?? condition.depositMode`

두 소스는 항상 함께 세팅되므로 현재 값은 일치하지만(아래 "행위 동등성 근거" 참조), 구조적으로는 한쪽만 갱신하면 갈라진다. Task 5에서 `ManualCard`에서 제거해 `CardUiState`를 단일 소스로 만든다.

## 행위 동등성 근거 (`DEFAULT_CARD_UI`가 안전한 이유)

`Record`에 키가 없을 때 현재 코드가 쓰는 폴백과, 새 `DEFAULT_CARD_UI`가 일치함을 확인했다.

| 필드 | 현재 폴백 | `emptyQuoteConditionCards`(빈 카드) | `DEFAULT_CARD_UI` |
|---|---|---|---|
| `termMonths` | `?? 60` | (없음) | `60` |
| `depositMode` | `?? card.depositMode` | `"none"` | `"none"` |
| `downPaymentMode` | `?? card.downPaymentMode` | `"none"` | `"none"` |
| `residualMode` | `?? card.residualMode` | `"max"` | `"max"` |
| `mileageMode` | `?? "basic"` | (없음) | `"basic"` |
| `mileageValue` | `?? "20,000km / 년"` | (없음) | `"20,000km / 년"` |
| `carTaxIncluded` | `?? false` | (없음) | `false` |
| `subsidyApplicable` | `?? false` | (없음) | `false` |

카드에 `Record`와 다른 모드가 들어가는 경로는 3개뿐이고 셋 다 두 소스를 함께 세팅한다:

1. `openEditQuote` (`:1113-1122`) — `buildManualCardsFromScenarios`(카드) + `setManualDepositModes` 등 8줄(Record). 같은 `editScenarios`에서 파생.
2. `openWorkbenchForQuoteRequest` (`:134-148`) — 카드1 `depositMode: seed.depositMode ?? "none"` + `if (seed.depositMode) setManualDepositModes(...)`. `seed.depositMode`가 없으면 카드는 `"none"`, Record는 비어 폴백 `"none"` → **동일**.
3. `openNewWorkbench`/`resetQuoteWorkbench` — 빈 카드 + `clearCardUiState()`(Record 비움) → 위 표대로 동일.

## File Structure

- **Modify** `client/src/components/customer-detail/quote-workbench-meta.ts` — `CardUiState` 타입, `DEFAULT_CARD_UI`·`MILEAGE_BASIC_VALUE` 상수, 순수 헬퍼 4종(`cardUiOf`·`effectiveMileageValue`·`cardUiFromScenario`·`cardUiMapFromScenarios`·`cardUiFromSeed`·`cardIdOfScenarioNo`). Task 5에서 `ManualCard` 모드 3필드 제거.
- **Modify** `client/src/components/customer-detail/quote-workbench-meta.test.ts` — 위 헬퍼 단위테스트 추가.
- **Modify** `client/src/components/customer-detail/hooks/useQuoteWorkbench.ts` — state 8개 → 1개, setter 8개는 이름 유지한 채 `patchCardUi` 위임, `clearCardUiState`/`openEditQuote`/`openWorkbenchForQuoteRequest`/`extractWorkbenchScenarios`/effect deps 교체.
- **Modify** `client/src/components/customer-detail/QuoteWorkbench.tsx` — props 8개 → `cardUi` 1개, 렌더 폴백 → `cardUiOf`.

**범위 밖(건드리지 않는다):** 금액 입력칸의 uncontrolled DOM ↔ state 이중성(`fieldVal`). `discount_lines` 스냅샷(#168)에서 의도적으로 채택한 설계다. `discountLines`·`acquisitionTaxMode`·`primaryDiscountUnit`은 카드별이 아니라 견적 전체 1개씩이므로 `CardUiState`에 넣지 않는다(`clearCardUiState`가 계속 함께 청소).

---

## Task 1: CardUiState 타입 + DEFAULT_CARD_UI + cardUiOf

**Files:**
- Modify: `client/src/components/customer-detail/quote-workbench-meta.ts`
- Test: `client/src/components/customer-detail/quote-workbench-meta.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`quote-workbench-meta.test.ts` 맨 아래에 추가한다. import 줄도 함께 갱신한다.

```ts
import { cardUiOf, DEFAULT_CARD_UI, effectiveMileageValue, MILEAGE_BASIC_VALUE, type CardUiState } from "./quote-workbench-meta";

// 카드 UI 상태 기본값 — 통합 전 8개 Record의 읽기 폴백(?? 60 / ?? "none" / ?? "max" / ?? "basic" / ?? false)과
// 빈 카드(emptyQuoteConditionCards)의 모드 값이 동일함을 잠근다. 이 값이 바뀌면 저장 payload가 바뀐다.
describe("DEFAULT_CARD_UI", () => {
  it("통합 전 읽기 폴백과 동일한 기본값을 갖는다", () => {
    expect(DEFAULT_CARD_UI).toEqual({
      termMonths: 60,
      depositMode: "none",
      downPaymentMode: "none",
      residualMode: "max",
      mileageMode: "basic",
      mileageValue: "20,000km / 년",
      carTaxIncluded: false,
      subsidyApplicable: false,
    });
  });

  it("약정거리 기본 문자열은 MILEAGE_BASIC_VALUE 상수와 같다", () => {
    expect(DEFAULT_CARD_UI.mileageValue).toBe(MILEAGE_BASIC_VALUE);
  });
});

describe("cardUiOf", () => {
  it("맵에 카드가 없으면 기본값을 돌려준다", () => {
    expect(cardUiOf({}, "manual-condition-2")).toEqual(DEFAULT_CARD_UI);
  });

  it("맵에 카드가 있으면 그 값을 그대로 돌려준다", () => {
    const ui: CardUiState = { ...DEFAULT_CARD_UI, termMonths: 36, carTaxIncluded: true };
    expect(cardUiOf({ "manual-condition-1": ui }, "manual-condition-1")).toBe(ui);
  });
});

describe("effectiveMileageValue", () => {
  it("basic 모드면 저장된 값과 무관하게 기본 주행거리를 쓴다", () => {
    const ui: CardUiState = { ...DEFAULT_CARD_UI, mileageMode: "basic", mileageValue: "40,000km / 년" };
    expect(effectiveMileageValue(ui)).toBe("20,000km / 년");
  });

  it("custom 모드면 저장된 값을 쓴다", () => {
    const ui: CardUiState = { ...DEFAULT_CARD_UI, mileageMode: "custom", mileageValue: "40,000km / 년" };
    expect(effectiveMileageValue(ui)).toBe("40,000km / 년");
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `bun run test:unit client/src/components/customer-detail/quote-workbench-meta.test.ts`
Expected: FAIL — `cardUiOf`, `DEFAULT_CARD_UI`, `effectiveMileageValue`, `MILEAGE_BASIC_VALUE` 가 export되지 않음(TS 에러).

- [ ] **Step 3: 최소 구현을 쓴다**

`quote-workbench-meta.ts`의 `export type ManualMileageMode = ...` 줄 **바로 아래**에 추가한다(`ManualCard` 타입 선언 위).

```ts
// 약정거리 "기본" 모드의 고정 표시값 — 화면·추출·복원이 공유하는 유일 리터럴.
export const MILEAGE_BASIC_VALUE = "20,000km / 년";

// 비교카드 한 장의 UI 상태. 통합 전에는 속성별 Record 8벌로 흩어져 있었고, 키 누락이
// 읽는 쪽 폴백(?? 60 등)에 조용히 흡수돼 저장 payload를 오염시켰다(#163). 카드 = 객체 1개가 SSOT.
export type CardUiState = {
  termMonths: number;
  depositMode: ManualDepositMode;
  downPaymentMode: ManualDepositMode;
  residualMode: ManualResidualMode;
  mileageMode: ManualMileageMode;
  mileageValue: string;
  carTaxIncluded: boolean;
  subsidyApplicable: boolean;
};

// 통합 전 8개 Record의 읽기 폴백과 동일한 값(테스트로 잠금). 변경 = 저장 payload 변경.
export const DEFAULT_CARD_UI: CardUiState = {
  termMonths: 60,
  depositMode: "none",
  downPaymentMode: "none",
  residualMode: "max",
  mileageMode: "basic",
  mileageValue: MILEAGE_BASIC_VALUE,
  carTaxIncluded: false,
  subsidyApplicable: false,
};

export function cardUiOf(map: Record<string, CardUiState>, conditionId: string): CardUiState {
  return map[conditionId] ?? DEFAULT_CARD_UI;
}

// basic 모드는 저장된 mileageValue를 무시하고 고정값을 쓴다(추출·렌더 공통 규칙).
export function effectiveMileageValue(ui: CardUiState): string {
  return ui.mileageMode === "basic" ? MILEAGE_BASIC_VALUE : ui.mileageValue;
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `bun run test:unit client/src/components/customer-detail/quote-workbench-meta.test.ts`
Expected: PASS (기존 `restoreDiscountLines`/`discountLineWon` 테스트 포함 전부 green)

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/customer-detail/quote-workbench-meta.ts client/src/components/customer-detail/quote-workbench-meta.test.ts
git commit -m "refactor(crm): CardUiState 타입 + DEFAULT_CARD_UI + cardUiOf 순수 헬퍼"
```

---

## Task 2: 시나리오 → CardUiState 복원 헬퍼

수정 진입(`openEditQuote`)이 `Object.fromEntries` 8줄로 하던 복원을 순수 함수 하나로 옮긴다.

**Files:**
- Modify: `client/src/components/customer-detail/quote-workbench-meta.ts`
- Test: `client/src/components/customer-detail/quote-workbench-meta.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`quote-workbench-meta.test.ts`에 추가한다(import에 `cardIdOfScenarioNo`, `cardUiFromScenario`, `cardUiMapFromScenarios`, `type EditScenario` 추가).

```ts
// 테스트 픽스처 — EditScenario 전 필드. CardUiState가 읽는 8필드 외에는 복원 대상이 아니다.
function scenarioFixture(over: Partial<EditScenario> = {}): EditScenario {
  return {
    scenarioNo: 1,
    lender: "우리금융캐피탈",
    monthlyPayment: "1,200,000",
    termMonths: 36,
    depositMode: "percent",
    depositValue: "10",
    downPaymentMode: "amount",
    downPaymentValue: "3,000,000",
    residualMode: "amount",
    residualValue: "40,000,000",
    mileageMode: "custom",
    mileageValue: "30,000km / 년",
    carTaxIncluded: true,
    subsidyApplicable: true,
    subsidyAmount: "1,000,000",
    totalReturnCost: "10,000,000",
    totalTakeoverCost: "20,000,000",
    dueAtDelivery: "5,000,000",
    interestRate: "5.3",
    ...over,
  };
}

describe("cardIdOfScenarioNo", () => {
  it("시나리오 번호를 카드 id로 바꾼다", () => {
    expect(cardIdOfScenarioNo(1)).toBe("manual-condition-1");
    expect(cardIdOfScenarioNo(3)).toBe("manual-condition-3");
  });
});

describe("cardUiFromScenario", () => {
  it("저장된 시나리오의 8필드를 카드 UI 상태로 복원한다", () => {
    expect(cardUiFromScenario(scenarioFixture())).toEqual({
      termMonths: 36,
      depositMode: "percent",
      downPaymentMode: "amount",
      residualMode: "amount",
      mileageMode: "custom",
      mileageValue: "30,000km / 년",
      carTaxIncluded: true,
      subsidyApplicable: true,
    });
  });
});

describe("cardUiMapFromScenarios", () => {
  it("시나리오 번호를 카드 id로 매핑한 맵을 만든다", () => {
    const map = cardUiMapFromScenarios([
      scenarioFixture({ scenarioNo: 1, termMonths: 36 }),
      scenarioFixture({ scenarioNo: 3, termMonths: 48 }),
    ]);
    expect(Object.keys(map)).toEqual(["manual-condition-1", "manual-condition-3"]);
    expect(map["manual-condition-1"].termMonths).toBe(36);
    expect(map["manual-condition-3"].termMonths).toBe(48);
  });

  it("시나리오가 없으면 빈 맵(모든 카드가 기본값으로 폴백)", () => {
    expect(cardUiMapFromScenarios([])).toEqual({});
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `bun run test:unit client/src/components/customer-detail/quote-workbench-meta.test.ts`
Expected: FAIL — `cardIdOfScenarioNo`, `cardUiFromScenario`, `cardUiMapFromScenarios` 미정의.

- [ ] **Step 3: 최소 구현을 쓴다**

`quote-workbench-meta.ts`의 `EditScenario` 타입 선언 **아래**에 추가한다(`EditScenario`를 참조하므로 순서 주의).

```ts
// 비교카드 id 규약 — 시나리오 번호(scenario_no)와 1:1. 복원·저장 양쪽이 이 함수를 쓴다.
export function cardIdOfScenarioNo(scenarioNo: number): string {
  return `manual-condition-${scenarioNo}`;
}

export function cardUiFromScenario(s: EditScenario): CardUiState {
  return {
    termMonths: s.termMonths,
    depositMode: s.depositMode,
    downPaymentMode: s.downPaymentMode,
    residualMode: s.residualMode,
    mileageMode: s.mileageMode,
    mileageValue: s.mileageValue,
    carTaxIncluded: s.carTaxIncluded,
    subsidyApplicable: s.subsidyApplicable,
  };
}

export function cardUiMapFromScenarios(scenarios: EditScenario[]): Record<string, CardUiState> {
  return Object.fromEntries(scenarios.map((s) => [cardIdOfScenarioNo(s.scenarioNo), cardUiFromScenario(s)]));
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `bun run test:unit client/src/components/customer-detail/quote-workbench-meta.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/customer-detail/quote-workbench-meta.ts client/src/components/customer-detail/quote-workbench-meta.test.ts
git commit -m "refactor(crm): 시나리오→CardUiState 복원 헬퍼(cardUiFromScenario·cardUiMapFromScenarios)"
```

---

## Task 3: 앱 견적요청 시드 → CardUiState 헬퍼

`openWorkbenchForQuoteRequest`가 `if (seed.termMonths != null) setManualTermMonths(...)` 식으로 세 번 조건 분기하던 것을 순수 함수 하나로 옮긴다.

**Files:**
- Modify: `client/src/components/customer-detail/quote-workbench-meta.ts`
- Test: `client/src/components/customer-detail/quote-workbench-meta.test.ts`

`ScenarioCardSeed` 타입은 `client/src/lib/quote-request-seed.ts`에 이미 있다(`termMonths: number | null`, `depositMode: "percent" | "amount" | null`, `depositValue: string | null`, `downPaymentMode`, `downPaymentValue`).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { cardUiFromSeed } from "./quote-workbench-meta";
import { type ScenarioCardSeed } from "@/lib/quote-request-seed";

// 앱 견적요청 승격(카드1 시드). 시드 없는 필드는 DEFAULT_CARD_UI를 유지해야
// 통합 전(= Record에 키를 안 넣어 읽기 폴백을 타던) 동작과 같다.
describe("cardUiFromSeed", () => {
  const emptySeed: ScenarioCardSeed = {
    termMonths: null, depositMode: null, depositValue: null, downPaymentMode: null, downPaymentValue: null,
  };

  it("빈 시드면 전부 기본값", () => {
    expect(cardUiFromSeed(emptySeed)).toEqual(DEFAULT_CARD_UI);
  });

  it("기간만 있으면 기간만 덮어쓴다", () => {
    expect(cardUiFromSeed({ ...emptySeed, termMonths: 48 })).toEqual({ ...DEFAULT_CARD_UI, termMonths: 48 });
  });

  it("보증금·선수금 모드를 덮어쓴다(값 문자열은 카드 표시값이라 여기 없음)", () => {
    expect(cardUiFromSeed({ ...emptySeed, depositMode: "percent", depositValue: "10", downPaymentMode: "amount", downPaymentValue: "3,000,000" }))
      .toEqual({ ...DEFAULT_CARD_UI, depositMode: "percent", downPaymentMode: "amount" });
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `bun run test:unit client/src/components/customer-detail/quote-workbench-meta.test.ts`
Expected: FAIL — `cardUiFromSeed` 미정의.

- [ ] **Step 3: 최소 구현을 쓴다**

`quote-workbench-meta.ts` 상단 import에 추가:

```ts
import { type ScenarioCardSeed } from "@/lib/quote-request-seed";
```

`cardUiMapFromScenarios` 아래에 추가:

```ts
// 앱 견적요청 승격 → 카드1 UI 상태. 시드가 없는 필드는 기본값 유지(통합 전 "Record에 키를 안 넣던" 동작과 동일).
// 금액 문자열(depositValue/downPaymentValue)은 카드의 표시 초기값(uncontrolled defaultValue)이라 여기 없다.
export function cardUiFromSeed(seed: ScenarioCardSeed): CardUiState {
  return {
    ...DEFAULT_CARD_UI,
    ...(seed.termMonths != null ? { termMonths: seed.termMonths } : {}),
    ...(seed.depositMode ? { depositMode: seed.depositMode } : {}),
    ...(seed.downPaymentMode ? { downPaymentMode: seed.downPaymentMode } : {}),
  };
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `bun run test:unit client/src/components/customer-detail/quote-workbench-meta.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/customer-detail/quote-workbench-meta.ts client/src/components/customer-detail/quote-workbench-meta.test.ts
git commit -m "refactor(crm): 앱 견적요청 시드→CardUiState 헬퍼(cardUiFromSeed)"
```

---

## Task 4: 훅 state 8개 → cardUi 1개 (컴포넌트 동시 교체)

훅 state를 바꾸면 `QuoteWorkbench.tsx`가 즉시 컴파일 실패하므로 **한 커밋에서 함께** 옮긴다. `handlers`의 setter 이름 8개는 그대로 유지해 컴포넌트 이벤트 배선은 손대지 않는다.

**Files:**
- Modify: `client/src/components/customer-detail/hooks/useQuoteWorkbench.ts`
- Modify: `client/src/components/customer-detail/QuoteWorkbench.tsx`

- [ ] **Step 1: 훅 import에 새 헬퍼를 추가한다**

`useQuoteWorkbench.ts:18-40`의 `from "../quote-workbench-meta"` import 블록에 다음을 알파벳 순 위치에 끼워 넣는다.

```ts
  cardIdOfScenarioNo,
  cardUiFromSeed,
  cardUiMapFromScenarios,
  cardUiOf,
  effectiveMileageValue,
  MILEAGE_BASIC_VALUE,
  type CardUiState,
```

- [ ] **Step 2: state 선언 8개를 1개로 교체한다**

`useQuoteWorkbench.ts:80-88`에서 `manualTermMonths`·`manualDepositModes`·`manualDownPaymentModes`·`manualResidualModes`·`manualMileageModes`·`manualMileageValues`·`manualCarTaxIncluded`·`manualSubsidyApplicable` 8줄을 삭제하고, `manualQuoteCards` 선언 **아래**에 넣는다.

```ts
  // 비교카드 UI 상태(카드 id → CardUiState). 통합 전 속성별 Record 8벌 — 카드 하나를 다루는 모든
  // 동작이 8곳을 건드려야 했고 키 누락을 컴파일러가 못 잡았다(#163 저장 payload 오염).
  const [cardUi, setCardUi] = useState<Record<string, CardUiState>>({});
```

- [ ] **Step 3: setter 8개를 patchCardUi 위임으로 교체한다**

`useQuoteWorkbench.ts:610-649`의 `setManualDepositMode` ~ `setManualSubsidyFor` 8개 함수를 통째로 아래로 교체한다.

```ts
  // 카드 UI 상태 부분 갱신 — 없던 카드는 기본값에서 시작(cardUiOf). 모든 카드 setter의 유일 진입점.
  function patchCardUi(conditionId: string, patch: Partial<CardUiState>) {
    setCardUi((prev) => ({ ...prev, [conditionId]: { ...cardUiOf(prev, conditionId), ...patch } }));
    markQuoteDraftChanged();
  }

  function setManualDepositMode(conditionId: string, mode: ManualDepositMode) {
    patchCardUi(conditionId, { depositMode: mode });
  }

  function setManualDownPaymentMode(conditionId: string, mode: ManualDepositMode) {
    patchCardUi(conditionId, { downPaymentMode: mode });
  }

  function setManualResidualMode(conditionId: string, mode: ManualResidualMode) {
    patchCardUi(conditionId, { residualMode: mode });
  }

  // 기본 모드로 되돌리면 표시값도 고정값으로 리셋(통합 전 setManualMileageValues 동반 호출과 동일).
  function setManualMileageMode(conditionId: string, mode: ManualMileageMode) {
    patchCardUi(conditionId, mode === "basic" ? { mileageMode: mode, mileageValue: MILEAGE_BASIC_VALUE } : { mileageMode: mode });
  }

  function setManualMileageValue(conditionId: string, value: string) {
    patchCardUi(conditionId, { mileageValue: value });
  }

  function setManualTermMonthsFor(conditionId: string, months: number) {
    patchCardUi(conditionId, { termMonths: months });
  }

  function setManualCarTaxFor(conditionId: string, included: boolean) {
    patchCardUi(conditionId, { carTaxIncluded: included });
  }

  function setManualSubsidyFor(conditionId: string, applicable: boolean) {
    patchCardUi(conditionId, { subsidyApplicable: applicable });
  }
```

- [ ] **Step 4: clearCardUiState를 한 줄로 줄인다**

`useQuoteWorkbench.ts:528-543`을 교체한다.

```ts
  // 워크벤치 열기/승격/초기화 시 카드 UI 상태 잔상 제거 — 카드 모드·할인 행·취득세 모드는
  // extractWorkbenchScenarios/persist가 읽어 화면 잔상이 아니라 저장까지 오염되므로 가격과 함께 반드시 청소한다.
  // (수정 진입은 시나리오에서 전량 재구성하므로 cardUi는 복원 setter가 대체 — discountLines/취득세만 별도 처리.)
  function clearCardUiState() {
    setCardUi({});
    setDiscountLines([]);
    setAcquisitionTaxMode("normal");
    setPrimaryDiscountUnit("amount");
  }
```

- [ ] **Step 5: 앱 견적요청 시드 3줄을 교체한다**

`useQuoteWorkbench.ts:145-148`의 `clearCardUiState();` 다음 세 줄(`if (seed.termMonths != null) …` / `if (seed.depositMode) …` / `if (seed.downPaymentMode) …`)을 아래로 교체한다.

```ts
      clearCardUiState(); // 이전 세션 잔상(잔존가치/약정거리 모드·할인 행·취득세 등) 청소 후 시드만 얹는다
      setCardUi({ [emptyQuoteConditionCards[0].id]: cardUiFromSeed(seed) });
```

- [ ] **Step 6: 파생값 workbenchFirstTermMonths를 교체한다**

`useQuoteWorkbench.ts:225`를 교체한다.

```ts
  const workbenchFirstTermMonths = manualQuoteCards[0] ? cardUiOf(cardUi, manualQuoteCards[0].id).termMonths : 60;
```

- [ ] **Step 7: extractWorkbenchScenarios의 소비를 교체한다**

`useQuoteWorkbench.ts:738-742`의 여섯 줄(`const depositMode = …` ~ `const mileageValue = …`)을 아래로 교체한다. 이 시점에는 `card.depositMode` 폴백이 아직 타입상 존재하지만 **읽지 않는다**(Task 5에서 필드 자체를 제거).

```ts
      const ui = cardUiOf(cardUi, condId);
```

이어서 `scenarios.push({...})` 안의 필드를 교체한다.

```ts
        termMonths: ui.termMonths,
```
```ts
        depositMode: ui.depositMode,
        depositValue: ui.depositMode === "none" ? null : parseMonthlyPayment(fieldVal("deposit") ?? ""),
        downPaymentMode: ui.downPaymentMode,
        downPaymentValue: ui.downPaymentMode === "none" ? null : parseMonthlyPayment(fieldVal("downPayment") ?? ""),
        residualMode: ui.residualMode,
        residualValue: ui.residualMode === "max" ? null : parseMonthlyPayment(fieldVal("residual") ?? ""),
        mileageMode: ui.mileageMode,
        mileageValue: effectiveMileageValue(ui),
        carTaxIncluded: ui.carTaxIncluded,
        subsidyApplicable: ui.subsidyApplicable,
        subsidyAmount: ui.subsidyApplicable ? nz(parseMonthlyPayment(fieldVal("subsidy") ?? "")) : null,
```

- [ ] **Step 8: 미리보기 동기화 effect의 deps를 줄인다**

`useQuoteWorkbench.ts:784-788`의 deps 배열을 교체한다(eslint-disable 주석 2줄은 그대로 유지).

```ts
  }, [savedManualQuoteConditionIds, manualQuoteCards, cardUi, solutionWorkbenchPurchaseMethod]);
```

- [ ] **Step 9: openEditQuote 복원 8줄을 한 줄로 줄인다**

`useQuoteWorkbench.ts:1114-1122`에서 `setSavedManualQuoteConditionIds(...)` 다음의 `setManualDepositModes` ~ `setManualSubsidyApplicable` 8줄을 삭제하고 한 줄로 교체한다. `setSavedManualQuoteConditionIds` 줄도 `cardIdOfScenarioNo`를 쓰도록 바꾼다.

```ts
    setSavedManualQuoteConditionIds(editScenarios.map((s) => cardIdOfScenarioNo(s.scenarioNo)));
    setCardUi(cardUiMapFromScenarios(editScenarios));
```

- [ ] **Step 10: 훅 반환값을 교체한다**

`useQuoteWorkbench.ts:1168-1176`의 반환 필드 8개(`manualTermMonths`, `manualDepositModes`, `manualDownPaymentModes`, `manualResidualModes`, `manualMileageModes`, `manualMileageValues`, `manualCarTaxIncluded`, `manualSubsidyApplicable`)를 삭제하고, `manualQuoteCards` 아래에 한 줄 넣는다.

```ts
    cardUi,
```

`handlers` 블록의 setter 이름 8개는 **변경하지 않는다**.

- [ ] **Step 11: QuoteWorkbench.tsx의 destructure를 교체한다**

`QuoteWorkbench.tsx:39-47`에서 `manualTermMonths`, `manualDepositModes`, `manualDownPaymentModes`, `manualResidualModes`, `manualMileageModes`, `manualMileageValues`, `manualCarTaxIncluded`, `manualSubsidyApplicable` 8줄을 삭제하고, `manualQuoteCards` 아래에 넣는다.

```ts
    cardUi,
```

- [ ] **Step 12: QuoteWorkbench.tsx의 렌더 폴백을 교체한다**

파일 상단 import에 추가한다(`from "./quote-workbench-meta"` 블록).

```ts
import { cardUiOf, effectiveMileageValue } from "./quote-workbench-meta";
```

`QuoteWorkbench.tsx:429-435`의 일곱 줄을 교체한다.

```ts
                    const ui = cardUiOf(cardUi, condition.id);
                    const depositMode = ui.depositMode;
                    const downPaymentMode = ui.downPaymentMode;
                    const residualMode = ui.residualMode;
                    const mileageMode = ui.mileageMode;
                    const mileageValue = effectiveMileageValue(ui);
                    const carTaxOn = ui.carTaxIncluded;
                    const subsidyOn = ui.subsidyApplicable;
```

`:450`의 기간 세그먼트에서 `manualTermMonths[condition.id] ?? 60`을 교체한다.

```tsx
                          <label><span>기간</span><div className="kim-jeff-segment wide">{[12, 24, 36, 48, 60].map((m) => <button key={m} className={ui.termMonths === m ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualTermMonthsFor(condition.id, m)} type="button">{m}개월</button>)}</div></label>
```

- [ ] **Step 13: 검증 3종을 돌린다**

Run: `bun run typecheck && bun run lint && bun run test:unit`
Expected: typecheck 0 에러, lint 0 problems, unit 전부 PASS(기존 개수 + Task 1~3 신규분).

`manualTermMonths` 등 옛 심볼이 남아 있으면 typecheck이 잡는다. 남은 참조를 확인한다.

Run: `grep -rn "manualTermMonths\|manualDepositModes\|manualDownPaymentModes\|manualResidualModes\|manualMileageModes\|manualMileageValues\|manualCarTaxIncluded\|manualSubsidyApplicable" client/src/`
Expected: 출력 없음.

- [ ] **Step 14: 커밋**

```bash
git add client/src/components/customer-detail/hooks/useQuoteWorkbench.ts client/src/components/customer-detail/QuoteWorkbench.tsx
git commit -m "refactor(crm): 워크벤치 카드 UI 상태 Record 8벌 → CardUiState 1벌 통합"
```

---

## Task 5: ManualCard의 모드 3필드 제거 (이중 소스 해소)

`depositMode`·`downPaymentMode`·`residualMode`가 `ManualCard`에 남아 있으면 `CardUiState`와 이중 소스다. 이제 아무도 읽지 않으므로 제거한다. 금액 표시값(`depositValue`·`downPaymentValue`·`residualValue`)은 uncontrolled input의 `defaultValue`라 **남긴다**.

**Files:**
- Modify: `client/src/components/customer-detail/quote-workbench-meta.ts`
- Modify: `client/src/components/customer-detail/hooks/useQuoteWorkbench.ts`

- [ ] **Step 1: ManualCard 타입에서 모드 3필드를 뺀다**

`quote-workbench-meta.ts:44-52`의 `ManualCard` 타입을 교체한다.

```ts
// 비교카드의 표시 데이터(금액 문자열은 uncontrolled input의 defaultValue).
// 모드(보증금/선수금/잔존가치)는 여기 두지 않는다 — CardUiState가 단일 소스.
export type ManualCard = {
  id: string; title: string; round: string; copyLabel: string;
  lender: string; monthlyPayment: string;
  totalReturn: string; totalTakeover: string; dueAtDelivery: string; interestRate: string;
  depositValue: string;
  downPaymentValue: string;
  residualValue: string;
  subsidyAmount: string;
};
```

- [ ] **Step 2: emptyQuoteConditionCards 3장에서 모드 필드를 뺀다**

`quote-workbench-meta.ts:112` 이하 배열의 카드 3장 각각에서 `depositMode: "none" as ManualDepositMode,`, `downPaymentMode: "none" as ManualDepositMode,`, `residualMode: "max" as ManualResidualMode,` 줄을 삭제한다(총 9줄). `depositValue`·`downPaymentValue`·`residualValue`·`subsidyAmount`는 유지한다.

- [ ] **Step 3: buildManualCardsFromScenarios에서 모드 대입을 뺀다**

`useQuoteWorkbench.ts:349-364`의 반환 객체에서 `depositMode: sc.depositMode,`, `downPaymentMode: sc.downPaymentMode,`, `residualMode: sc.residualMode,` 3줄을 삭제한다. **값 포맷 분기에서 `sc.depositMode`를 읽는 것은 그대로 둔다**(시나리오에서 직접 읽으므로 이중 소스가 아니다).

교체 후 해당 필드들:

```ts
        depositValue: sc.depositMode === "percent" ? sc.depositValue : (sc.depositValue ? formatMoney(Number(sc.depositValue)) : "0"),
        downPaymentValue: sc.downPaymentMode === "percent" ? sc.downPaymentValue : (sc.downPaymentValue ? formatMoney(Number(sc.downPaymentValue)) : "0"),
        residualValue: sc.residualMode === "max" ? "-" : (sc.residualMode === "percent" ? sc.residualValue : (sc.residualValue ? formatMoney(Number(sc.residualValue)) : "0")),
```

- [ ] **Step 4: 앱 견적요청 승격의 카드1 시드에서 모드를 뺀다**

`useQuoteWorkbench.ts:134-144`의 `setManualQuoteCards([...])` 첫 카드를 교체한다(모드는 Task 4 Step 5의 `setCardUi`가 이미 담당).

```ts
      setManualQuoteCards([
        {
          ...emptyQuoteConditionCards[0],
          depositValue: seed.depositValue ?? "0",
          downPaymentValue: seed.downPaymentValue ?? "0",
        },
        emptyQuoteConditionCards[1],
        emptyQuoteConditionCards[2],
      ]);
```

- [ ] **Step 5: 검증 3종을 돌린다**

Run: `bun run typecheck && bun run lint && bun run test:unit`
Expected: 전부 green. `ManualDepositMode`/`ManualResidualMode` import가 `quote-workbench-meta.ts`에서 미사용이 되면 lint가 잡는다 — 타입은 `CardUiState`가 계속 쓰므로 남아 있어야 정상이다.

Run: `grep -n "card.depositMode\|condition.depositMode\|card.residualMode\|condition.residualMode\|card.downPaymentMode\|condition.downPaymentMode" client/src/`
Expected: 출력 없음.

- [ ] **Step 6: 커밋**

```bash
git add client/src/components/customer-detail/quote-workbench-meta.ts client/src/components/customer-detail/hooks/useQuoteWorkbench.ts
git commit -m "refactor(crm): ManualCard 모드 3필드 제거 — CardUiState가 단일 소스"
```

---

## Task 6: 전체 검증 + 브라우저 스모크

행위 무변경이 이 작업의 유일한 성공 기준이다. 저장 payload 경로(`extractWorkbenchScenarios` → `crm.quote_scenarios`)를 건드렸으므로 **실제 저장까지 확인**한다.

**Files:** 없음(검증만)

- [ ] **Step 1: 검증 4종 + 빌드**

```bash
bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build
```
Expected: typecheck 0 · lint 0 problems · unit 전부 PASS · server 전부 PASS · build 성공.

`test:server`는 이번 변경과 무관하지만(클라 전용) 회귀 그물로 함께 돌린다.

- [ ] **Step 2: 격리 스택으로 dev 서버를 띄운다**

사용자의 dev 서버를 건드리지 않기 위해 별도 포트를 쓴다(저장소 관례 — #158 스모크와 동일).

```bash
PORT=8799 bun run src/local-dev.ts
```
별도 터미널에서 vite를 포트 5174로 띄우고, 로그인은 GoTrue admin `generate_link`(magiclink) → curl로 Location 헤더의 `#access_token…` 해시 추출 → `http://127.0.0.1:5174/#<해시>` 로 세션 수립한다(AGENTS.md "로컬 브라우저 스모크 로그인 우회"). 테스트 계정 = 자메스관리자(`luck2here@naver.com`).

- [ ] **Step 3: 스모크 5종을 수행한다**

각 항목은 **통합 전과 동일한 결과**여야 한다.

1. **신규 저장** — 고객 상세 → 견적함 `+` → 차량 선택 → 카드1에 금융사·월납입금 입력, 기간 `36개월`, 보증금 `%`, 자동차세 `포함`, 보조금 `해당` → `작성완료`.
   확인: `psql "$DATABASE_URL" -c "select scenario_no, term_months, deposit_mode, down_payment_mode, residual_mode, mileage_mode, mileage_value, car_tax_included, subsidy_applicable from crm.quote_scenarios where quote_id = '<신규 견적 id>' order by scenario_no;"`
   Expected: 화면에서 고른 값과 정확히 일치. `mileage_value = '20,000km / 년'`(기본 모드).
2. **수정 재진입** — 방금 저장한 견적을 `수정`으로 다시 연다.
   Expected: 카드1의 기간 `36개월`·보증금 `%`·자동차세 `포함`·보조금 `해당` 세그먼트가 전부 복원된다. 카드2/3은 기본값(`60개월`·`없음`·`최대`·`기본`·`불포함`·`비해당`).
3. **약정거리 왕복** — 카드1 약정거리를 `변경`→`40,000km / 년` 선택 후 다시 `기본` 클릭.
   Expected: select가 `20,000km / 년`으로 되돌아가고 비활성화된다.
4. **초기화 잔상** — 카드1을 여러 값으로 바꾼 뒤 `초기화` 클릭.
   Expected: 카드 3장 모두 기본 세그먼트. 취득세 `일반`, 추가 할인 행 0개.
5. **앱 견적요청 승격 시드** — 앱 견적요청이 있는 고객(예: 김지안)의 니즈 카드에서 `견적 작성`.
   Expected: 카드1의 기간·보증금/선수금 모드가 요청 조건대로 시드되고, 카드2/3은 기본값.

- [ ] **Step 4: 스모크 데이터를 원복한다**

공유 master DB이므로 스모크로 만든 견적은 반드시 지운다. **psql 직접 삭제 금지** — 서버 삭제 훅(임베딩 동기 정리)을 우회해 고아 임베딩이 남는다. 반드시 CRM UI의 견적 삭제 버튼(또는 `DELETE /api/customers/:id/quotes/:quoteId`)으로 지운다.

Run: `psql "$DATABASE_URL" -c "select count(*) from crm.quotes where customer_id = '<고객 id>';"`
Expected: 스모크 시작 전 개수와 동일.

- [ ] **Step 5: 브랜치를 푸시하고 PR을 연다**

```bash
git push -u origin refactor/crm-card-ui-state
gh pr create --title "refactor(crm): 견적 워크벤치 카드 UI 상태 CardUiState 통합" --body "$(cat <<'EOF'
## 요약

견적 워크벤치 비교카드(`견적 작성 1/2/3`)의 UI 상태를 속성별 `Record` 8벌에서 카드별 `CardUiState` 객체 1벌로 통합했다. **행위 무변경 순수 리팩토링.**

- 카드 속성 추가 시 기본값·복원·저장추출 세 곳을 컴파일러가 강제한다(통합 전에는 `Record` 키 누락이 `?? 60` 폴백에 조용히 흡수 — #163 저장 payload 오염의 구조적 원인).
- `clearCardUiState()` 8줄 → `setCardUi({})` 한 줄. `openEditQuote` 복원 8줄 → `cardUiMapFromScenarios` 한 줄. 미리보기 effect deps 11개 → 4개.
- `ManualCard`의 `depositMode`/`downPaymentMode`/`residualMode` 제거 — `CardUiState`와의 이중 소스 해소.
- 기본값은 `DEFAULT_CARD_UI` 하나로 모으고 테스트로 잠갔다(통합 전 읽기 폴백과 동일 값).

## 범위 밖

- 금액 입력칸의 uncontrolled DOM ↔ state 이중성(`fieldVal`) — `discount_lines` 스냅샷(#168)에서 의도적으로 채택한 설계.
- `discountLines`·`acquisitionTaxMode`·`primaryDiscountUnit` — 카드별이 아니라 견적 전체 1개씩. `clearCardUiState`가 계속 함께 청소.

## 왜 지금

계산엔진이 읽을 입력이 정확히 이 카드 조건들이다. 지금 정리해두면 계산엔진 PR이 순수하게 계산 로직만 담는다.

## 검증

- typecheck 0 · lint 0 · test:unit · test:server · build
- 브라우저 스모크 5종(신규 저장→psql 대조 · 수정 재진입 복원 · 약정거리 왕복 · 초기화 잔상 · 견적요청 승격 시드), 스모크 견적 원복 완료

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review 결과

- **커버리지:** 8개 Record의 선언·setter·청소·시드·복원·추출·effect deps·훅 반환·컴포넌트 소비 전부 태스크에 매핑됨. 이중 소스(`ManualCard` 모드 3필드)는 Task 5.
- **타입 일관성:** `CardUiState`(Task 1) → `cardUiFromScenario`/`cardUiMapFromScenarios`(Task 2) → `cardUiFromSeed`(Task 3) → `patchCardUi`/`cardUiOf`(Task 4) → `ManualCard` 축소(Task 5). 이름 충돌 없음. `MILEAGE_BASIC_VALUE`는 Task 1에서 정의하고 Task 4 `setManualMileageMode`에서 소비.
- **알려진 순서 의존:** Task 4 Step 7은 `card.depositMode` 폴백을 "읽지 않게" 바꾸고, 필드 제거는 Task 5. Task 4 커밋 시점에는 미사용 필드가 잠깐 남아 있다(컴파일 정상).
- **`emptyQuoteConditionCards[0].id`** 는 `"manual-condition-1"` 리터럴과 같지만, Task 4 Step 5는 배열에서 읽어 카드 정의와 시드가 어긋나지 않게 한다.
