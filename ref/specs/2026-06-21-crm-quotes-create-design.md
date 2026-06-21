# crm 견적 생성 #4c-1 (composer) 설계 — 견적 추가 INSERT

작성일: 2026-06-21
상태: **design 확정. 구현(plan) 대기.**
성격: 견적 도메인(#4) 세째 사이클의 **첫 슬라이스**. 견적함 composer "견적 작성"으로 **새 견적을 DB에 INSERT**. (#4b 기존 견적 mutate에 이은 생성 경로.)
연계: `2026-06-21-crm-quotes-write-design.md`(#4b 쓰기·PATCH 매핑·파싱 헬퍼), `2026-06-17-crm-quotes-schema-design.md`(스키마·snapshot), #55 자식 add(낙관+임시 id→서버 uuid 교체 패턴).

## #4c 분해 (2026-06-21 합의)

#4c(견적 생성)는 성격이 다른 3개라 슬라이스로 나눈다:

- **#4c-1 견적 추가(composer)** — `saveQuote` add 분기. 폼 값으로 quote 1 + scenario 1 INSERT. **이 spec.**
- **#4c-2 워크벤치 저장** — `saveQuoteFromWorkbench`. 현재 Maybach 하드코딩 mock → 가격/옵션/색상/할인/차량선택을 quotes 44컬럼+scenario로 매핑. "워크벤치를 진짜 계산기로" 제품 결정 선행. 후속.
- **#4c-3 다중 시나리오(1~3) + 대표 지정 UI** — 시나리오 비교 UI(현재 없음) + `primary_scenario_id` 지정. 후속.

## 배경 / 현황

- 견적함 composer는 `<form onSubmit={saveQuote}>`(`CustomerDetailPage.tsx:4467`) 하나가 edit/add를 같이 처리. edit 분기는 #4b로 영속화됨. **add 분기**(`quoteComposerMode !== "edit"`, `:2204~2266`)는 폼 값으로 새 `KimQuoteItem`을 만들어 `setQuotes`에 추가만 함 = **미저장**(새로고침 원복).
- `quote_code`는 현재 클라 `createKimQuoteCode`가 `yearMonth="2606"` 하드코딩 + 메모리 리스트 max 시퀀스로 생성. **서버 canonical 생성기 없음**(시드도 QT-2606-000X 직접 박음).
- 워크벤치(`saveQuoteFromWorkbench`)는 입력 무시 Maybach 고정값 mock — #4c-2.

## 범위

- **범위 안**: composer add 분기를 DB INSERT로 영속화 — quote 헤더 1 + 대표 시나리오 1(트랜잭션), **서버 `quote_code` 생성**, 낙관 추가 + 성공 시 임시 id/코드를 서버값으로 교체.
- **범위 밖**: 워크벤치 저장(#4c-2), 다중 시나리오·대표 지정 UI(#4c-3), 원본 파일 업로드(#4d), `valid_until`(D-day) 날짜 영속(#4b와 동일 보류), 차량/색상/옵션/할인 snapshot(워크벤치 도메인).
- **원본 인식 모드 주의**: composer를 "원본 인식"으로 열어 생성하면 quote 헤더(`entry_mode=original`)는 영속하되 **첨부 파일 자체는 업로드 안 함(#4d)** — 새 견적 row는 남고 파일은 로컬(메모리)만. file_* 컬럼 영속은 #4d.

## 핵심 결정 — `quote_code` 서버 생성

`quote_code`는 UNIQUE라 클라 생성은 충돌 위험. **서버가 canonical 생성**:

- 신규 `nextQuoteCode(ex)`: `now()`의 YYMM(예 `2606`) + `QT-{YYMM}-%`인 기존 코드 중 최대 #### +1 → 4자리 0패딩. 오늘(2026-06-21)이면 시드 0001~0003 다음 `QT-2606-0004`.
- **트랜잭션 안에서 코드 생성 → INSERT**(생성과 삽입 사이 경합 최소화).
- **동시성 캐비엇**: 두 INSERT가 같은 #### 계산 시 UNIQUE 충돌 가능. 단일 상담사 단계라 위험 낮음 → #4c-1은 단순 생성, 멀티 상담사 시 `ON CONFLICT` 재시도/시퀀스 도입은 후속.

## INSERT 매핑 (#4b PATCH의 거울)

composer 폼(`:4480~4606`) → `quotes` 헤더 + `quote_scenarios` 1건(트랜잭션):

| 폼 필드 (name) | DB | 비고 |
|---|---|---|
| (서버) | `quote_code` | nextQuoteCode |
| (URL) | `customer_id` | |
| (고정) | `app_status="draft"` · `revision=0` | 새 견적은 발송 전 |
| `source`(hidden) | `entry_mode` | "수기 작성"→manual / "견적 조회"→solution / "원본 인식"→original |
| `status`(hidden "작성중") | `status` | |
| `brand`/`model`/`trim` | `brand_name`/`model_name`/`trim_name` | snapshot |
| `quoteRound` | `quote_round` | 1차/2차/3차/비교/최종 |
| `stockStatus` | `stock_status` | |
| `meta` | `note` | |
| `financeType`(hidden) | scenario `purchase_method` | selectedQuotePurchaseMethod |
| `term` | scenario `term_months` | `parseTermMonths` |
| `monthlyPayment` | scenario `monthly_payment` | `parseMonthlyPayment` |
| `financeCompany` | scenario `lender` | |
| (고정) | scenario `scenario_no=1` | |
| (삽입 후) | `primary_scenario_id` = scenario.id | 순환 FK는 INSERT 후 UPDATE(스키마 §154) |

**미저장(파생, #4b와 동일)**: `title`/`meta(표시)`/`vehicleName`은 컬럼 없음 → `toKimQuoteItem` 재파생. `validLabel`(D-6)은 표시 라벨 → `valid_until` 미영속. **새 견적은 새로고침 후 D-day 배지 없음**(현행 mock보다 단출 — date 입력 UI는 후속 보강). 파싱은 #4b의 `parseTermMonths`/`parseMonthlyPayment` 재사용.

## 3계층 (#55 자식 add 패턴 + 코드/uuid 스왑)

### 1. `src/db/queries/customer-quotes.ts` (추가)

- `nextQuoteCode(ex)`: 위 규칙. 반환 `"QT-YYMM-####"`.
- `createQuote(customerId, body, ex)`: 트랜잭션 — `nextQuoteCode` → `quotes` INSERT(헤더 + app_status="draft") → `quote_scenarios` INSERT(scenario_no=1) → `quotes.primary_scenario_id` UPDATE(그 scenario id). 반환 `{ id, quoteCode, createdAt }`. body 타입은 헤더 부분 + `scenario` 서브객체(#4b `QuotePatch`와 유사하나 생성용).

### 2. `src/routes/customers.ts` (라우트 추가)

- `customers.post("/:id/quotes", zValidator("param", idParam), zValidator("json", quoteCreateBody), …)` — 201 + `{id, quoteCode, createdAt}`. `c.var.db.transaction((tx)=>createQuote(...,tx))`.
- `quoteCreateBody` = #4b `quotePatchBody`에서 토글/`bumpRevision` 뺀 생성용(entryMode/status/quoteRound/stockStatus/brandName/modelName/trimName/note + scenario). enum 검증 동일.

### 3. `client/src/lib/customer-quotes.ts` (추가)

- `createQuote(cid, body) → { id: string; quoteCode: string; createdAt: string }` (`sendJson` POST) + `invalidateCustomerDetail(cid)`.
- 생성 body 타입 `QuoteCreatePayload`(헤더 + scenario).

### 4. `CustomerDetailPage` `saveQuote` add 분기 wiring

- 낙관: 기존대로 임시 견적(`id: kim-quote-${Date.now()}`, 클라 임시 quoteCode) `setQuotes` 추가.
- `if (customer.id)` → `createQuoteApi(customer.id, payload)` 호출:
  - 성공: 응답 `{id, quoteCode}`로 그 항목의 **임시 id와 임시 quoteCode를 서버값으로 교체**(`setQuotes(map: temp→server)`).
  - 실패: 그 임시 항목 제거(롤백) + `onToast("견적 저장에 실패했습니다.")`.
- payload는 INSERT 매핑대로(entryMode/status/quoteRound/stockStatus/brand/model/trim/note + scenario{purchaseMethod/termMonths/monthlyPayment/lender}).

## 캐시·불변식

- 생성 성공 시 `invalidateCustomerDetail(customerId)` 필수(상세 캐시 stale 방지).
- 임시 id→서버 uuid 교체 전(POST 미해소) 그 항목 mutate/delete는 #4b 가드(`!id.startsWith("kim-")`)로 이미 API 생략 → 교체 후 정상.

## 검증

- `typecheck` 0 · `lint` 0
- `test:server`: `POST /:id/quotes` → 201·`quote_code` 형식(`QT-\d{4}-\d{4}`)·`getCustomer`에 새 quote+scenario 반영·없는 customer 404. **throwaway는 `try/finally`로 self-clean**(공유 master DB — 2026-06-21 테스트 오염 사고 교훈).
- `build`
- 브라우저(인증): 견적함 `+` → composer 작성 → 저장 → 목록에 추가 + **새로고침해도 유지**(이전엔 원복). quote_code가 `QT-2606-####`로 부여됨.

## 미결 / 다음

- **#4c-2 워크벤치 저장**: `saveQuoteFromWorkbench` → 실 입력(pricing/options/colors/discounts/vehicle) 매핑. 제품 결정(워크벤치 계산 realness) 선행.
- **#4c-3 다중 시나리오 + 대표 지정 UI**: scenario 1~3 비교, primary 지정. #4b PATCH의 scenario를 N건+primary로 확장.
- `valid_until`(D-day) 날짜 입력 UI는 별도.
- `quote_code` 멀티 상담사 동시 생성 시 UNIQUE 재시도/시퀀스.
- 견적 도메인 거대파일 분해는 #4c 데이터화 이후(`KimQuoteItem` 타입 변경 가능).
