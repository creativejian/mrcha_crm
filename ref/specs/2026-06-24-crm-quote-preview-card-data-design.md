# 견적 워크벤치 미리보기 카드 데이터화 (추가 안내 (B) 미리보기/앱 노출)

Date: 2026-06-24
Status: 설계 승인됨 (구현 대기)
관련: #101 추가 안내 사항 저장 (A), `quotes.guidance` jsonb

## 배경 / 문제

견적 워크벤치 우측의 **앱 견적카드 미리보기**(`kim-app-card-preview`)는 "고객 앱에 이렇게 보일 것"을 상담사에게 보여주는 카드다. 그러나 현재 카드는 **차량명(Maybach 하드코딩)·가격·구매방식·금융사·취득원가까지 거의 전부 mock**이다. 실제 워크벤치에서 G80을 선택해도 카드는 Maybach를 표시한다.

#101에서 추가 안내(`guidance`: 재고/예상출고/고객지역/핵심포인트/추천이유/서비스)는 이미 DB에 저장되지만, 카드 자체가 mock이라 추가 안내만 따로 연결할 수 없다 — **카드 전체 데이터화가 선행돼야** 한다.

또한 카드 마크업은 **상시 미리보기(`CustomerDetailPage.tsx` ~5000행)** 와 **확대 모달(`isQuoteAppCardPreviewOpen`, ~5092행)** 두 곳에 **완전히 동일하게 복제**돼 있다(들여쓰기만 차이). 데이터화하면 두 곳을 동기화해야 하므로 한쪽만 고치는 버그 위험이 있다.

## 목표

- 미리보기 카드의 mock 필드를 워크벤치 실데이터로 연결해, 카드가 실제 선택 차량/가격/조건/추가 안내를 정확히 반영한다.
- 카드 마크업 중복을 단일 컴포넌트로 제거해 두 곳(상시 + 모달)이 같은 데이터를 쓰도록 한다.
- 소스가 없는 필드(계산엔진 미연결)는 가짜 숫자 대신 정직한 안내 텍스트로 표시한다.

## 범위

### In scope
- 카드 전체 데이터화: 차량명·연식·기본가·할인·구매방식·약정·금융사·월납입·보증금·선수금·주행거리·취득원가 구성·외장/내장 컬러·출고시기(재고/예상출고/고객지역).
- 카드 단일 컴포넌트 추출 (상시 + 모달 공용).
- `pricingInputs` state 추가 (basePrice/discount reactive화).

### Out of scope
- **핵심포인트(keyPoint)·추천이유(recommendReason)·서비스1~4**: 카드에 자리가 없어 이번 범위 제외(레이아웃 확장은 별도 슬라이스).
- **계산엔진 연결**: 금리·총비용·잔존가치 금액 환산 — 소스 없음, 안내 텍스트 처리.
- **실제 고객 앱(Flutter, 별도 레포)** 반영.
- 카드 일반화(전체 고객용) 및 `kim` prefix 리네임 — brief의 "리네임은 마지막" 준수, 김민준 카드 그대로 추출.

## 데이터 소스 매핑

| 카드 필드 | 모델 필드 | 소스 | 비고 |
|---|---|---|---|
| 브랜드/모델/트림 | `vehicle` | `workbenchVehicle`·`trimDetail` | `workbenchVehicleLabel` 패턴 |
| 연식 | `modelYear` | `trimDetail.modelYear` | 없으면 줄 생략/폴백 |
| 기본가 | `basePrice` | `pricingInputs.basePrice` | inputs state 신규 |
| 할인 | `discount` | `pricingInputs.discount` | inputs state 신규 |
| 구매방식 | `purchaseMethod` | `solutionWorkbenchPurchaseMethod` | 시나리오와 동일 출처 |
| 약정개월 | `termMonths` | 대표 시나리오 `termMonths` | |
| 월 납입금 | `monthly` | 대표 시나리오 `monthlyPayment` | |
| 금리 | `rate = null` | (소스 없음) | "—" 안내 |
| 보증금 | `deposit` | 대표 시나리오 `depositMode/Value` | |
| 선수금 | `downPayment` | 대표 시나리오 `downPaymentMode/Value` | |
| 잔존가치 | `residual` | 대표 시나리오 `residualMode/Value` | percent 금액 환산 불가 시 "—" |
| 주행거리 | `mileage` | 대표 시나리오 `mileageValue` | |
| 금융사 | `lender` | 대표 시나리오 `lender` | |
| 외장/내장 컬러 | `exterior/interiorColor` | 이미 동적 state | 변경 없음 |
| 재고 여부 | `stockNotice` | `guidance.stockNotice` | |
| 예상 출고 | `expectedDelivery` | `guidance.expectedDelivery` | |
| 고객 지역 | `customerRegion` | `guidance.customerRegion` | |
| 최종 차량가 | `finalVehiclePrice` | `pricing` (PricingResult) | |
| 등록비용 합계 | `registrationCost` | `pricing` | |
| 취득원가 | `acquisitionCost` | `pricing` | |
| 총비용 | `null` | (소스 없음) | 안내 텍스트 |
| D-6 / 미확인 견적 | (현행 유지) | 앱 발송 상태값 | 미리보기 맥락이라 mock 유지 |

## 아키텍처

### 1. 카드 viewmodel — `buildAppCardModel()`
컴포넌트 내부 파생값(또는 `useMemo`). 흩어진 워크벤치 state를 카드 표시용 객체 1개로 조립한다. 소스 없는 필드는 `null` → 카드 렌더 시 안내 텍스트로 표현. 단위 변환(시나리오 mode→표시 문자열)은 `kim-quote.ts`의 기존 헬퍼(`formatScenarioMoneyMode`, `formatTerm`, `formatMonthly`) 재사용.

### 2. `pricingInputs` state 추가
현재 `recomputePricing()`은 `setPricing(computePricing(readPricingInputs(root)))`만 호출하고 inputs 자체는 보관하지 않는다. `basePrice`/`discount`/`optionPrice`는 `PricingResult`에 없으므로, recompute 시 `setPricingInputs(inputs)`도 호출해 카드가 reactive하게 기본가/할인을 표시하도록 한다.

### 3. 카드 컴포넌트 추출 — `<KimAppCardPreview model={...} />`
상시(~5000) + 모달(~5092) 중복 마크업을 단일 컴포넌트로 추출한다. props는 조립된 model 객체 1개(+ 필요한 표시 옵션). 모달은 동일 컴포넌트를 래퍼(`in-modal`) 안에서 재사용한다.

### 4. 시나리오 기준 = 저장된 대표 조건 (reactive)
금융조건(금융사/월납입/보증금/선수금/잔존/주행)은 비교카드의 **uncontrolled DOM 입력**이라 렌더 중 읽을 수 없다. 비교카드는 "조건 저장" 시 `savedManualQuoteConditionIds`에 추가되고 입력이 disabled(값 고정)된다.

→ **"조건 저장" 시점(또는 `savedManualQuoteConditionIds` 변경 effect)에 `extractWorkbenchScenarios()`로 추출해 `cardScenario` state로 보관**한다(reactive). 카드는 이 state를 읽는다.
- 대표 = 저장된 첫 조건(round1; 추후 `primaryScenarioId` 도입 시 그쪽 우선).
- 저장된 조건이 없으면 추천조건/금융 블록은 `"조건 저장 후 표시"` placeholder.

### 5. 소스 없는 필드 = 안내 텍스트
금리·총비용·(환산 불가) 잔존금액 → `"—"` 또는 `"계산 후 안내"`. 계산엔진 연결 슬라이스에서 교체.

## 검증 계획

- `bun run typecheck` 0, `bun run lint` 0.
- `bun run build` OK (컴포넌트 추출/번들 영향 확인).
- `bun run test:unit` — `buildAppCardModel` 순수 변환 부분은 단위테스트 우선(TDD): mock state in → 카드 모델 out, 소스 없는 필드 null, 시나리오 미저장 시 placeholder.
- 브라우저 검증(카카오 세션): 워크벤치에서 차량/색상/가격/구매방식/조건 변경 → 상시 카드 + 확대 모달 둘 다 실시간 반영, 추가 안내(재고/예상출고/고객지역) 표시, "조건 저장" 후 추천조건 반영.

## 캐비엇

- **시나리오 reactive 타이밍**: `cardScenario`는 "조건 저장" 기준이라, 미저장 입력 중에는 카드 금융 블록이 갱신되지 않는다(의도된 동작 — 확정 조건만 미리보기).
- **DOM 읽기 의존**: `extractWorkbenchScenarios`/`readPricingInputs`는 워크벤치 DOM ref에 의존. 컴포넌트 추출 시 ref 스코프가 깨지지 않도록 카드 컴포넌트는 데이터를 props로만 받고 DOM을 직접 읽지 않는다(읽기는 부모 워크벤치에서).
- **D-6/미확인 견적**: 발송 전 미리보기라 실제 D-day가 없다. 현행 mock 유지(미리보기 맥락). 발송 후 실제 상태 표시는 후속.
- `kim-app-condition-grid` 등 죽은 CSS 정리는 별도 CSS 정리 사이클에서.
