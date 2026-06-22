# crm 견적 다중 시나리오 #4c-3a 설계 — 비교카드 입력화 + N 시나리오 저장 + 읽기

작성일: 2026-06-22
상태: **design 확정. 구현(plan) 대기.**
성격: 견적 도메인(#4) 세째 사이클의 **세번째 슬라이스 첫 조각(#4c-3a)**. 워크벤치 하단 비교카드(금융조건 3슬롯)를 실 입력으로 추출해 **시나리오 N건(1~3) 저장** + 읽기 어댑터 확장. (#4c-2가 quote 헤더+대표 시나리오 1건을 영속화한 데 이은 다중 시나리오.)
연계: `2026-06-22-crm-quotes-workbench-persist-design.md`(#4c-2 createQuote/낙관/DOM 추출 패턴 — 확장·재사용), `2026-06-21-crm-quotes-write-design.md`(#4b 파싱 헬퍼), `2026-06-17-crm-quotes-schema-design.md`(quote_scenarios 스키마).

## #4c-3 분해 (2026-06-22 합의)

#4c-3(다중 시나리오)은 커서 2조각으로 나눈다:

- **#4c-3a 입력화 + 저장 + 읽기** — 비교카드 실 입력 추출 → 시나리오 N건 저장 → 읽기 어댑터에 scenarios 배열 보존. **이 spec.**
- **#4c-3b 비교 표시 + 대표 지정 UI** — 견적함에서 1~3 시나리오 비교 표시 + `primary_scenario_id` 전환 UI. 후속.

## 배경 / 현황

- 워크벤치 하단 비교카드(`kimManualQuoteConditionCards` 3슬롯, `CustomerDetailPage.tsx` 약 4925~5060)는 **대부분 mock**: 금융사/기간/자동차세/보조금/계산결과(반납·인수·출고전·금리)는 `defaultValue`+`disabled`/`readOnly`, onChange 없음. 보증금/선납/잔존/약정거리는 **mode만 state**(`manualDepositModes`/`manualDownPaymentModes`/`manualResidualModes`/`manualMileageModes`+`manualMileageValues`), 값은 미저장.
- "조건 저장" 버튼(`saveManualQuoteCondition`)은 **`savedManualQuoteConditionIds`에 id 플래그만** 추가 — 실제 데이터 추출/저장 없음.
- 읽기 어댑터 `toKimQuoteItem`(client/src/lib/kim-quote.ts)은 **대표 시나리오 1건만 평탄화**, 나머지 scenarios 버림. `KimQuoteItem`에 scenarios 배열 없음.
- **DB `quote_scenarios`는 N건 + 비교카드 전 컬럼 이미 완비**(scenario_no·is_saved·saved_at·purchase_method·lender·term_months·deposit_mode/value·down_payment_mode/value·residual_mode/value·mileage_mode/value·car_tax_included·subsidy_applicable/amount·monthly_payment·total_return_cost·total_takeover_cost·due_at_delivery·interest_rate). **마이그레이션 불필요.**
- #4c-2 `createQuote`는 quote 헤더 + 대표 시나리오 **1건**(scenario_no=1, 구매방식만) INSERT 후 `primary_scenario_id` UPDATE.

## 범위 (2026-06-22 비교카드 정밀 조사로 확정)

비교카드 정밀 조사 결과 **필드 절반이 입력 불가 mock**(기간/자동차세/보조금 버튼은 `onClick` 없음·active 고정; 계산결과 반납·인수·출고전·금리는 `value={상수}` readOnly). "전체 필드 저장"하려면 onClick+state+readOnly 제거 큰 wiring이 필요 → **#4c-3a는 "지금 실제 입력되는 필드만" 저장**(입력화 wiring 0, 식별자 부여 + 추출만).

- **범위 안**: 입력 가능한 필드만 시나리오 N건(1~3)으로 저장 — **금융사·보증금(mode+value)·선수금(mode+value)·잔존(mode+value)·약정거리(mode+value)·월납입** + 워크벤치 상단 구매방식(전 시나리오 공유). + 읽기 어댑터에 scenarios 배열 보존.
- **범위 밖**:
  - **입력 불가 mock 필드**: 기간(60 고정)·자동차세·보조금·계산결과(반납/인수/출고전/금리)는 **#4c-3a 미저장(null)**. 이들의 입력화(onClick/state/readOnly 제거)는 후속(특히 계산결과는 계산엔진/dolim 솔루션 연동과 함께).
  - **#4c-3b**: 견적함 비교 표시 UI(1~3 시나리오 나열/탭), 대표(primary) 전환 UI. (#4c-3a는 저장·읽기 인프라까지, 표시는 대표 1건 현행 유지.)
  - copy 버튼("1번 복사") 기능화, `valid_until` 등 #4c-2와 동일 보류.

## 핵심 결정 1 — DOM 일괄 추출 (controlled 전환 ❌)

#4c-2 가격패널처럼 **저장 시점에 슬롯별 일괄 추출**:
- input 값: 비교카드 폼 DOM에서 슬롯·필드 식별자로 읽기. 현재 `defaultValue`라 **식별자(`data-scenario-{round}-{field}`) 부여가 입력화의 실제 작업**(controlled onChange wiring 불필요).
- mode 값: 기존 state(`manualDepositModes`/`manualDownPaymentModes`/`manualResidualModes`/`manualMileageModes`+`manualMileageValues`)에서 슬롯 id로.
- numeric: 표시 문자열("2,398,000") → 숫자만 문자열("2398000")로 정규화(#4b `parseMonthlyPayment` 계열 재사용).

## 핵심 결정 2 — "저장된 카드만" 시나리오, primary=round 1

- `savedManualQuoteConditionIds`에 든 카드만 시나리오로 INSERT(빈 2/3번 카드 제외). 최소 1건(상단 워크벤치만 채우고 비교카드 미저장이면 #4c-2처럼 대표 1건).
- `scenario_no` = 카드 round(1/2/3), `is_saved`=true, `saved_at`=now.
- **primary = round 1**(없으면 첫 저장 건) → `primary_scenario_id`.

## 핵심 결정 3 — createQuote scenario 단수 → 복수 (하위호환)

- 서버 `createQuote`/zod body에 `scenarios?: ScenarioInput[]`(1~3건) 추가. **`scenarios` 있으면 그걸로 N건 INSERT, 없으면 기존 `scenario`(단수)를 `[scenario]`로** → composer(#4c-1)·#4c-2 무변경 하위호환.
- `createQuote` 흐름: quote INSERT → scenarios 각 건 INSERT(scenario_no, is_saved, saved_at) → primary(round 1) 건의 id로 `primary_scenario_id` UPDATE.

## 시나리오 컬럼 매핑 (비교카드 → quote_scenarios)

**저장하는 컬럼(입력 가능 필드):**

| 비교카드 소스 | DB 컬럼 | 추출 경로 |
|---|---|---|
| 워크벤치 상단 구매방식(`solutionWorkbenchPurchaseMethod`) | `purchase_method` | 상단 state, 전 시나리오 공유 |
| 금융사 select | `lender` | 카드 DOM `[data-sc-field="lender"]` |
| 보증금 mode+value | `deposit_mode`/`deposit_value` | mode=`manualDepositModes[id]`, value=카드 DOM `[data-sc-field="deposit"]`(숫자 정규화) |
| 선수금 mode+value | `down_payment_mode`/`down_payment_value` | mode=`manualDownPaymentModes[id]`, value=DOM `[data-sc-field="downPayment"]` |
| 잔존 mode+value | `residual_mode`/`residual_value` | mode=`manualResidualModes[id]`, value=DOM `[data-sc-field="residual"]`(mode=max면 null) |
| 약정거리 mode+value | `mileage_mode`/`mileage_value` | `manualMileageModes[id]`/`manualMileageValues[id]`(state) |
| 월납입금 input | `monthly_payment` | 카드 DOM `[data-sc-field="monthly"]`(숫자 정규화) |
| (카드 round) | `scenario_no` | 1/2/3 |
| (고정) | `is_saved`=true · `saved_at`=now | |

**미저장(입력 불가 mock — null):** `term_months`(기간 60 고정), `car_tax_included`(자동차세), `subsidy_applicable`/`subsidy_amount`(보조금), `total_return_cost`/`total_takeover_cost`/`due_at_delivery`/`interest_rate`(계산결과). 입력화는 후속.

식별자: 비교카드 각 카드 section에 `data-scenario-card={condition.id}`, 입력에 `data-sc-field="{lender|deposit|downPayment|residual|monthly}"` 부여(현재 name 없음). 약정거리는 이미 state라 DOM 불필요.

## 읽기 어댑터 (kim-quote.ts)

- `CustomerDetailScenario` 타입을 위 전 컬럼으로 확장(numeric은 서버 string). getCustomer가 `select()` 전체라 응답에 이미 포함.
- `toKimQuoteItem`: 대표 1건 평탄화(현행 유지) + **`KimQuoteItem.scenarios: CustomerDetailScenario[]` 배열 보존**(#4c-3b 비교 표시가 소비). 표시 UI는 #4c-3b — #4c-3a는 데이터만 노출.

## 3계층 변경

### 1. `src/db/queries/customer-quotes.ts`
- `QuoteScenarioPatch`(또는 신규 `ScenarioInput`)를 **입력 가능 컬럼**으로 확장: 기존(purchaseMethod/termMonths/monthlyPayment/lender) + `depositMode`/`depositValue`/`downPaymentMode`/`downPaymentValue`/`residualMode`/`residualValue`/`mileageMode`/`mileageValue`/`isSaved` (전부 optional). 미저장 mock 컬럼은 추가 안 함.
- `QuoteCreateBody`에 `scenarios?: ScenarioInput[]` 추가.
- `createQuote`: `scenarios ?? (scenario ? [scenario] : [])` 정규화 → 각 건 INSERT(scenario_no/is_saved/saved_at 포함) → round 1(또는 첫 건) primary UPDATE.

### 2. `src/routes/customers.ts`
- `quoteScenarioBody` zod를 입력 가능 컬럼으로 확장(numeric=string, mode=string, isSaved=boolean). `quoteCreateBody`에 `scenarios: z.array(quoteScenarioBody).max(3).optional()` 추가. `quotePatchBody`는 #4c-3b까지 단수 유지.

### 3. `client/src/lib/customer-quotes.ts`
- `QuoteCreatePayload`에 `scenarios?: ScenarioInput[]` + 시나리오 타입 확장(서버 동형).

### 4. `client/src/lib/kim-quote.ts`
- `CustomerDetailScenario`에 입력 가능 컬럼 추가(deposit/downPayment/residual/mileage mode+value, isSaved·savedAt) + `KimQuoteItem.scenarios: CustomerDetailScenario[]` 배열 + `toKimQuoteItem`이 scenarios 보존(대표 평탄화 현행 유지). 미저장 mock 컬럼은 응답에 null로 와도 타입 생략(초과 프로퍼티 무해).

### 5. `CustomerDetailPage` 워크벤치 wiring
- 비교카드 input에 `data-scenario-{round}-{field}` 식별자 부여(추출용).
- `saveQuoteFromWorkbench`가 `savedManualQuoteConditionIds`를 돌며 슬롯별 DOM+mode-state 추출 → `scenarios` 배열 구성 → payload에. 저장된 카드 0건이면 기존 단일 대표 시나리오(#4c-2)로 폴백.

## 캐시·불변식

- 생성 성공 시 `invalidateCustomerDetail`(createQuote가 이미 호출).
- numeric 전송 규약(#4b/#4c-2와 동일): 클라→서버 숫자만 문자열, 서버→클라 string.

## 검증

- `typecheck` 0 · `lint` 0
- `test:server`: createQuote에 `scenarios` 3건 → getCustomer에 3건(scenario_no·금융 컬럼) 라운드트립 + primary=round1 확인 + **composer 단수 `scenario` 하위호환** 201. throwaway `try/finally` self-clean.
- `test:unit`: `toKimQuoteItem`이 scenarios 배열 보존(N건) + 대표 평탄화 유지.
- `build`
- 브라우저(인증): 워크벤치 하단 비교카드 2~3개 입력·"조건 저장" → "견적함에 저장" → getCustomer/새로고침 후 시나리오 N건 영속(표시는 #4c-3b 전까지 대표 1건).

## 미결 / 다음

- **#4c-3b**: 견적함 1~3 시나리오 비교 표시 UI + 대표 전환(`PATCH primary_scenario_id`).
- **입력 불가 mock 필드 입력화**: 기간(버튼 onClick+state)·자동차세·보조금(토글 state)·계산결과(readOnly 제거+controlled) → 저장 컬럼 추가. 계산결과는 계산엔진/dolim 솔루션 연동과 함께.
- copy 버튼("N번 복사") 기능화.
- #4d 원본 파일 영속.
