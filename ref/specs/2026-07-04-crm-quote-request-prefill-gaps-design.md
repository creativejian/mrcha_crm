# 앱 견적요청 승격 갭 메우기 설계 (2026-07-04)

상태: 설계 확정(유슨생 실기 지적 + 이사님 앱 도메인 규칙 전달) · 구현 전
선후관계: 견적 앱 발송 파이프라인 **전에** 처리하는 소형 갭 슬라이스(마이그레이션 0).

## 배경 (유슨생 실기 발견 4건 + 실측)

1. **prefill 절반 누락**: "견적 작성" 승격이 차량/옵션/구매방식만 나르고 **기간(period)·보증금/선수금 유형(deposit_type)·비율(deposit_ratio)·금액(rental_deposit)을 버림**. 워크벤치 기본 기간이 60이라 우연히 티가 안 났음.
2. **니즈/인박스 카드에 보증금 % 미표시**: 금액(rental_deposit>0) 병기는 기존 로직이 있으나 **비율(deposit_ratio)은 서버 select부터 미배선**.
3. **견적함 출처 구분 불가**: 승격 견적도 entry_mode=manual이라 카드에 "수기 입력 조건"으로만 표기. `source_quote_request_id`는 DB에 살아 있고 getCustomer 응답에도 실려 있으나(select 전체) 클라 타입/UI 미배선.
4. **중복 작성 유도**: 니즈 카드에 "견적 N건" 배지가 있어도 기본 버튼이 "견적 작성"이라 같은 요청에 중복 견적을 만들기 쉬움.
5. (+관찰) **워크벤치 신규 오픈 시 가격 state 잔상**: `openNewWorkbench`/`openWorkbenchForQuoteRequest`가 `pricing`/`pricingInputs` state를 리셋하지 않아, 이전 세션 최종가가 트림 로드 전까지 표시됨(로드 후 자가 교정 — 로딩 중 혼란만).

### DB 실측 (2026-07-04, public.quote_requests 97건)

- 비율이 설정된 요청(61건)은 **전부 금액 공존**: `rental_deposit = round(trim_price × deposit_ratio / 100)` 정확 일치(앱이 % 선택 시 금액 파생 저장).
- 선납금(prepayment) 6건: 비율 0·금액만(앱 UI가 금액 직접 입력). 무타입 11건(일시불).
- 승격 견적의 `source_quote_request_id`는 **진입 시점 고정** — 워크벤치에서 차량을 바꿔 저장해도 출처는 원 요청(김지안 530e 요청→520i 견적 사례, 버그 아님·이력).

### 앱 도메인 규칙 (이사님, 2026-07-04 — 발송 파이프라인에서도 재사용)

| 구매방식 | 초기비용 유형 | 데이터 형태 |
|---|---|---|
| 운용리스/장기렌트 (lease/rent) | 보증금(deposit) 또는 선수금(advance) | %(20% 등) 선택 → 금액 파생, **둘 다 저장** |
| 할부 (installment) | **선납금(prepayment)** | 금액 직접 입력(없으면 0), 비율 없음 |
| 일시불 (cash) | 없음 | deposit_type null |

## 확정 결정

1. **prefill 시드 규칙** (승격 진입 시 카드1에 시드):
   - `period` → 카드1 기간(termMonths). 12/24/36/48/60 밖 값이면 60 유지(현 버튼 옵션 밖).
   - lease/rent + `deposit` → **보증금 행**, lease/rent + `advance` → **선수금 행**.
   - **비율이 있으면 % 모드+비율값**(금액은 CRM 최종가 기준 재계산이 정합 — 요청 금액은 trim_price 기준·할인 반영 전), 비율 0·금액>0이면 금액 모드+금액.
   - 할부 + `prepayment` → **선수금 행에 금액 시드 + 구매방식이 할부일 때 행 라벨을 "선납금"으로 표기**(저장 컬럼 down_payment_* 그대로 — 스키마 무변경, 화면 어휘만 도메인 정합. 앱카드 섹션3 선수금 라벨도 동일 규칙).
   - 일시불/무타입 → 초기비용 시드 없음.
2. **카드 % 병기**: 니즈/인박스 카드 보증금 라벨을 앱카드 병기 문법으로 — "보증금 (20%) 11,800,000원"(비율+금액), "선납금 5,000,000원"(금액만), 미설정이면 유형명만.
3. **견적함 앱 출처 배지**: `source_quote_request_id` 존재 시 카드에 "앱 요청" 배지(신규 클래스, kim-* 금지). note("수기 입력 조건")는 불변.
4. **니즈 카드 버튼 전환**: 승격 견적이 있으면 기본 버튼 = **"견적 보기"**(최신 승격 견적을 `openEditQuote`로 열기 — 견적함의 그 견적) + **추가 작성은 보조 버튼**으로 유지(같은 요청 2차 견적 실무 허용, 실수 중복 경로만 차단). 서버가 `promotedQuoteIds`(최신순)를 함께 반환하도록 확장(count는 ids.length로 대체 가능하나 기존 필드 유지).
5. **가격 state 잔상 픽스**: 워크벤치 신규 오픈/초기화 경로에서 `pricingInputs`/`pricing`을 emptyQuotePricing 기준으로 리셋.

## 구현 범위

1. **서버** `src/db/queries/quote-requests.ts` + `src/routes/quote-requests.ts`:
   - `getQuoteRequestDetail`에 `period`/`depositType`/`depositRatio`/`rentalDeposit` 추가.
   - 목록 배치(`buildAppQuoteRequestRows` 공유부)에 `depositRatio` select 추가 + promo 조회를 `{id, sourceId, createdAt}`로 확장해 `promotedQuoteIds`(최신순) 반환.
   - 서버 테스트: 단건 필드 왕복·promotedQuoteIds 정렬(실 master, try/finally).
2. **클라 어댑터** `client/src/lib/quote-requests.ts`: `QuoteRequestPrefill` 확장(기간/유형/비율/금액), depositLabel % 병기, `promotedQuoteIds` 노출. 순수 라벨 헬퍼는 유닛.
3. **prefill 시드** `useQuoteWorkbench.openWorkbenchForQuoteRequest`: 위 시드 규칙 — `setManualTermMonths`·`setManualDepositModes`/`setManualDownPaymentModes` + 카드1 defaultValue(manualQuoteCards[0] 교체). + `openNewWorkbench`/`openWorkbenchForQuoteRequest`/`resetQuoteWorkbench`에 pricing state 리셋.
4. **워크벤치/앱카드 라벨**: 구매방식=할부일 때 선수금 행 라벨 "선납금"(QuoteWorkbench 카드 + AppCardPreview 섹션3).
5. **견적함 배지**: `CustomerDetailQuote`/`QuoteItem`에 `sourceQuoteRequestId` 배선 + QuoteList 카드 "앱 요청" 배지 + CSS.
6. **니즈 카드**: `promotedQuoteIds[0]` 있으면 "견적 보기"(기본) + "추가 작성"(보조) — 견적 보기 = quoteList에서 해당 QuoteItem 찾아 `openEditQuote`(견적함 미존재 시 폴백=기존 견적 작성 동작).

## 범위 밖

- 발송 파이프라인(public 수신 테이블) — 다음 슬라이스.
- 선납금 전용 스키마/행 신설 — 불필요 판정(도메인 규칙상 선수금 자리 + 라벨 전환으로 충분).
- 저장된 기존 견적의 조건 소급 — prefill은 신규 승격부터.

## 검증

- 서버 테스트(단건 확장 필드·promotedQuoteIds) + 어댑터/시드 규칙 유닛(TDD) + 검증 4종 + build.
- 브라우저 스모크: 김지안 요청(보증금/선수금/비율 케이스별) "견적 작성" → 카드1 시드 실측, 견적 있는 요청 "견적 보기" → 워크벤치 수정 진입, 견적함 "앱 요청" 배지, 신규 오픈 가격 잔상 소멸. 스모크 견적은 삭제 원복.
