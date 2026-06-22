# crm 견적 워크벤치 영속화 #4c-2 설계 — 차량+가격+색상 INSERT

작성일: 2026-06-22
상태: **design 확정. 구현(plan) 대기.**
성격: 견적 도메인(#4) 세째 사이클의 **두번째 슬라이스**. 견적함 헤더 `+`("견적 작성")가 여는 **워크벤치**의 실 입력(차량 선택·옵션·색상·할인·취득원가)을 추출해 **새 견적을 DB에 INSERT**. (#4c-1 composer add INSERT 인프라를 재사용.)
연계: `2026-06-21-crm-quotes-create-design.md`(#4c-1 createQuote/nextQuoteCode/낙관+임시 id 교체 패턴 — **그대로 재사용·확장**), `2026-06-21-crm-quotes-write-design.md`(#4b PATCH 매핑·파싱 헬퍼), `2026-06-17-crm-quotes-schema-design.md`(스키마·snapshot).

## 배경 / 현황

- **진입점 사실**: 견적함 헤더 `+` 버튼(aria "견적 작성")은 composer가 아니라 **워크벤치**를 연다(`CustomerDetailPage.tsx:4140` `setIsQuoteSolutionWorkbenchOpen(true)`). 즉 사용자의 자연스러운 "새 견적"은 워크벤치다. composer(#4c-1)는 별도 진입(`···`→견적수정은 edit, 원본 드래그 1곳만 add)이라 일반 사용자 경로가 아니다.
- **워크벤치는 이미 "진짜 계산기"**: 상단 가격 패널(`:4851~4923`)에 `VehiclePicker`(catalog 차량 선택 → `applyTrimToPricing`이 `fetchTrimDetail`로 기본가/할인 자동 채움), `OptionPicker`(`applyOptionTotal`로 옵션금액), `ColorPicker`(외장/내장), 할인 라인, 취득세/공채/탁송/부대 입력이 다 있고 `computePricing`으로 최종 차량가/취득원가를 **실제 계산**한다.
- **저장만 mock**: `saveQuoteFromWorkbench`(`:2288~2331`)는 위 입력을 **전부 무시**하고 Maybach 고정값(brand "벤츠"/model "Maybach S-Class"/trim "S 500 4M Long"/term "60개월"/월 2,398,000원/우리금융캐피탈)만 박고 `setQuotes`에 추가만 함 — **`apiCreateQuote` 호출 없음 = 미저장**(새로고침 원복). 유일한 실 입력은 `financeType ← solutionWorkbenchPurchaseMethod`.
- **DB 컬럼은 이미 전부 존재** — 마이그레이션 불필요. `quotes`에 `base_price/options(jsonb)/option_total/discount_lines(jsonb)/final_discount/acquisition_tax/acquisition_tax_mode/bond/delivery/incidental/final_vehicle_price/acquisition_cost/trim_id/exterior_color_id·name·hex/interior_color_id·name·hex/valid_until/file_*`. `createQuote`/payload/zod가 이 컬럼들을 **안 쓸 뿐**.
- **읽기 쿼리도 이미 완비**: `getCustomer`는 `quotes`/`quote_scenarios`를 `select()` 전체로 가져옴(가격/색상/옵션 포함). 막힌 건 **타입(`CustomerDetailQuote`)·어댑터(`toKimQuoteItem`)·UI 타입(`KimQuoteItem`)에 가격/색상 필드가 없는 것**.

## 범위

- **범위 안**: 워크벤치 상단 계산기의 실 입력(차량·가격·색상·옵션·할인·취득원가)을 추출해 quote 헤더로 영속화 INSERT + 대표 시나리오 1건(구매방식). 견적함 행에 **최종 차량가 + 외장/내장 색상** 표시. 읽기 타입/어댑터 확장.
- **범위 밖**:
  - **금융조건 = 하단 비교카드**(기간/월납입/금융사/보증금/선납/잔존/약정거리/금리/총비용 — 현재 거의 하드코딩 mock)의 영속화와 **다중 시나리오(1~3)·대표 지정 UI**는 **#4c-3**. 대표 시나리오는 #4c-2에선 **구매방식만** 채우고 나머지 scenario 금융 컬럼은 null.
  - 워크벤치 **재오픈 시 저장 견적 편집 로드**(현재 가격 패널은 mock 기본값 유지) — 후속.
  - 원본 파일 업로드 영속(file_* / Storage) — **#4d**.
  - `valid_until`(D-day) 날짜 입력 UI, `stock_status` 입력 UI — 워크벤치에 컨트롤 없음 → 기본값(`stock_status="재고확인중"`, valid_until 미영속). #4b/#4c-1과 동일 보류.

## 핵심 결정 1 — 워크벤치 입력 수집 정비

워크벤치는 입력을 **DOM + 부분 state + 무시**로 흩어 보관한다. 저장 시점에 추출 가능하게 정비:

| 데이터 | 현재 보관 | 저장 시점 추출 | 조치 |
|---|---|---|---|
| trimId / trimName | `trimDetail.id`/`.trimName` (state) | 그대로 | — |
| **brandName / modelName** | **버림**(`applyTrimToPricing`이 selection.brand/model 수신만) | — | **신규 state**(예 `workbenchVehicle: VehicleSelection`)에 selection 저장 |
| **selectedOptionIds** | **버림**(`applyOptionTotal`이 selectedIds 수신만) | — | **신규 state**에 selectedIds 저장 → `trimDetail.options`로 `[{id,name,price}]` 재구성 |
| base/option/discount/취득세/bond/delivery/incidental | DOM `[data-pricing=*]` | `readPricingInputs(pricingPanelRef.current)` | 재사용 |
| finalVehiclePrice / acquisitionCost | `pricing` (state, computePricing 결과) | 그대로 | — |
| acquisitionTaxMode | state | 그대로 | — |
| ~~discountLines (라인 상세)~~ | `discountLines` state(+DOM 값) | — | **#4c-2 제외** — 라인별 재구성이 DOM selector 의존적이고, 편집 로드·표시를 안 하는 #4c-2에선 저장해도 미사용(YAGNI). 최종 합계 `final_discount`만 저장. 라인 상세는 편집 로드(후속). |
| 외장/내장 색상 | `exteriorColor`/`interiorColor` state(id/name/hexValue) | 그대로 | — |
| purchaseMethod | `solutionWorkbenchPurchaseMethod` state | 그대로 | — |

**원칙**: 새 state는 최소(차량 selection·옵션 ids 2개)만 추가하고, 나머지는 기존 state/DOM 추출기(`readPricingInputs`)를 재사용한다.

## 핵심 결정 2 — `createQuote` 확장(공통 경로) vs 별도 함수

#4c-1 `createQuote`/`POST /:id/quotes`/`apiCreateQuote`를 **확장**해 한 경로로 통일한다(별도 워크벤치 전용 엔드포인트 ❌). composer와 워크벤치 모두 같은 INSERT를 쓰되, **워크벤치가 더 많은 컬럼을 채울 뿐**. 추가 컬럼은 전부 optional이라 composer 호출은 무영향.

## INSERT 매핑 (워크벤치 → quotes 헤더 + scenario 1)

| 워크벤치 소스 | DB 컬럼 | 비고 |
|---|---|---|
| (서버) `nextQuoteCode` | `quote_code` | #4c-1 재사용 |
| (URL) | `customer_id` | |
| (고정) | `app_status="draft"` · `revision=0` | 새 견적 발송 전 |
| `solutionWorkbenchEntryMode` | `entry_mode` | manual/solution/original |
| (고정 "작성중") | `status` | |
| `workbenchVehicle.brand/model` + `trimDetail` | `brand_name`/`model_name`/`trim_name` | snapshot |
| `trimDetail.id` | `trim_id` | **catalog FK 스냅샷**(loose bigint, Phase B FK) |
| `readPricingInputs.basePrice` | `base_price` | numeric→문자열 숫자 |
| `selectedOptions` 재구성 | `options` (jsonb) | `[{id,name,price}]` |
| `readPricingInputs.optionPrice` | `option_total` | |
| `readPricingInputs.discount` | `final_discount` | 최종 합계만. `discount_lines`(라인 상세 jsonb)는 **#4c-2 제외**(편집 로드 후속) |
| `readPricingInputs.acquisitionTax` | `acquisition_tax` | |
| `acquisitionTaxMode` | `acquisition_tax_mode` | normal/hybrid/electric/manual |
| `readPricingInputs.bond/delivery/incidental` | `bond`/`delivery`/`incidental` | |
| `pricing.finalVehiclePrice` | `final_vehicle_price` | |
| `pricing.acquisitionCost` | `acquisition_cost` | |
| `exteriorColor.id/name/hexValue` | `exterior_color_id`/`_name`/`_hex` | |
| `interiorColor.id/name/hexValue` | `interior_color_id`/`_name`/`_hex` | |
| (고정 "1차") | `quote_round` | #4c-2는 단일 견적이라 "1차" 기본. 차수/비교는 #4c-3 |
| (고정 "재고확인중") | `stock_status` | UI 없음 |
| `sourceLabel`(진입모드) | `note` | |
| `solutionWorkbenchPurchaseMethod` | scenario `purchase_method` | 대표 시나리오 |
| (null) | scenario `term_months`/`monthly_payment`/`lender` 등 | **#4c-3**(비교카드) |
| (고정) | scenario `scenario_no=1` → `primary_scenario_id` | INSERT 후 UPDATE(#4c-1과 동일) |

**미저장(파생)**: `title`/`meta(표시)`/`vehicleName`은 `toKimQuoteItem` 재파생. `validLabel`(D-6)·`valid_until` 미영속(새 견적 새로고침 후 D-day 배지 없음). 원본 파일 #4d.

**⚠️ catalog FK 캐비엇(구현 중 발견)**: `quotes.trim_id`·`exterior_color_id`·`interior_color_id`는 schema.ts 주석("FK: Phase B")과 달리 **실제 DB에 catalog FK가 이미 걸려 있다**(`quotes_*_catalog_*_fk`, ON DELETE SET NULL — `drizzle/0001`). 따라서 이 id들은 **catalog에 실존하는 값만 INSERT 가능**(없으면 500). 워크벤치는 `VehiclePicker`/`ColorPicker`로 실 catalog에서 고르므로 정상 경로는 안전(`trimDetail.id`=catalog.trims.id, `TrimColor.id`=catalog.colors.id). 반면 이름/hex/가격/옵션 jsonb는 FK 없는 snapshot이라 자유. **서버 테스트는 가짜 id를 못 넣어 trim_id/color_id를 null로 두고 snapshot 필드만 검증**한다. (catalog 삭제 시 id는 SET NULL, 이름/hex snapshot은 잔존.)

## 읽기 표시 확장 (저장 확인용)

- `client/src/lib/kim-quote.ts`:
  - `CustomerDetailScenario`는 변경 없음(scenario 금융은 #4c-3). `CustomerDetailQuote`에 가격/색상 필드 추가: `basePrice, optionTotal, finalDiscount, acquisitionTax, bond, delivery, incidental, finalVehiclePrice, acquisitionCost`(numeric은 서버에서 string), `options`(jsonb), `exteriorColorName/Hex`, `interiorColorName/Hex`. (id·acquisitionTaxMode·discountLines는 표시 불필요라 보류.)
  - `KimQuoteItem`에 표시용 필드 추가: `finalVehiclePrice?`(number, 표시 시 `formatMoney`), `exteriorColorName?`/`exteriorColorHex?`, `interiorColorName?`/`interiorColorHex?`.
  - `toKimQuoteItem`이 위 필드 매핑(numeric string→`formatMoney` 등).
- `CustomerDetailPage` 견적함 행(`:4152~`): `quote.finalVehiclePrice` 있으면 최종 차량가 한 줄, 외장/내장 색상 칩(hex 점 + 이름) 표시. 값 없으면(구 데이터) 미표시.

## 3계층 변경

### 1. `src/db/queries/customer-quotes.ts` (`QuoteCreateBody`/`createQuote` 확장)
- `QuoteCreateBody`에 가격/색상/옵션 헤더 필드 추가(전부 optional). `createQuote`의 `quotes` INSERT values에 매핑(numeric은 string, jsonb는 객체 그대로). scenario INSERT는 그대로(구매방식만 채워 호출). `nextQuoteCode`/`primary_scenario_id` UPDATE 로직 불변.

### 2. `src/routes/customers.ts` (zod 확장)
- `quoteCreateBody` zod에 추가 필드 동형 확장: numeric은 `z.string()`(또는 number→문자열 정규화), `options`/`discountLines`는 `z.array(z.object({...})).nullable()`, 색상은 string/number nullable, `acquisition_tax_mode`는 enum. 기존 필드·composer 호출 하위호환.

### 3. `client/src/lib/customer-quotes.ts` (`QuoteCreatePayload` 확장)
- payload 타입에 추가 필드(서버 zod 동형). `createQuote` 함수 시그니처 불변(payload만 풍부).

### 4. `CustomerDetailPage` 워크벤치 wiring
- 신규 state 2개(차량 selection·옵션 ids), `applyTrimToPricing`/`applyOptionTotal`에서 저장.
- `saveQuoteFromWorkbench` 재작성: Maybach 하드코딩 제거 → 위 매핑대로 값 추출 → **낙관 `setQuotes`(임시 id `kim-quote-workbench-…` + 클라 임시 코드) + `apiCreateQuote` 영속 + 성공 시 임시 id/코드를 서버값으로 교체 + 실패 롤백 + onToast** (#4c-1 composer add 분기와 동일 패턴). `markRecentUpdate("견적함")` 유지.

## 캐시·불변식

- 생성 성공 시 `invalidateCustomerDetail(customerId)` 필수(`createQuote`가 이미 호출 — #4c-1).
- 임시 id→서버 uuid 교체 전 그 항목 mutate/delete는 기존 `!id.startsWith("kim-")` 가드로 API 생략.
- numeric 전송 규약: 클라→서버 문자열 숫자(#4b `parseMonthlyPayment` 계열), 서버→클라 string(drizzle numeric). 표시는 `formatMoney`.

## 검증

- `typecheck` 0 · `lint` 0
- `test:server`: `POST /:id/quotes` 확장 payload(가격/색상/옵션) → 201 → `getCustomer`에 가격/색상/옵션 라운드트립 반영. composer 기존 호출(추가 필드 없이) 하위호환 200. **throwaway는 `try/finally` self-clean**(공유 master DB).
- `test:unit`: `toKimQuoteItem`이 가격/색상 매핑(numeric string→표시), 값 없을 때 undefined.
- `build`(pdf-lib 등 코드스플릿 영향 없음)
- 브라우저(인증): 견적함 `+` → 워크벤치에서 **차량 선택(가격 자동 채움)·옵션·색상·할인 입력** → "견적함에 저장" → 목록에 추가 + **새로고침해도 유지**(이전엔 원복) + 최종 차량가·색상 표시. quote_code `QT-2606-####`.

## 미결 / 다음

- **#4c-3 다중 시나리오 + 대표 지정 UI**: 하단 비교카드(금융조건) 영속화 + scenario 1~3 비교 + `primary_scenario_id` 지정 UI. 워크벤치 비교카드는 현재 mock이라 입력화 선행.
- **워크벤치 편집 로드**: 재오픈 시 저장 견적을 가격 패널에 로드(현재 mock 기본값).
- **#4d 원본 파일 영속**: 서류 Storage 재사용, file_* 영속.
- `valid_until`(D-day)·`stock_status` 입력 UI.
- 견적 도메인 거대파일 분해는 #4c 데이터화 이후.
