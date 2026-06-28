# CRM 앱 견적요청 → 견적 승격(S3) 설계

작성일: 2026-06-28
상태: **design 확정(브레인스토밍 승인). 다음 = writing-plans → 구현.**
성격: 견적요청 파이프라인 **마지막 슬라이스 S3 = 견적 승격**. 앱 견적요청을 CRM 워크벤치로 **prefill 진입**시켜 `crm.quotes`로 승격하고 `source_quote_request_id`로 출처를 잇는다.
연계: `2026-06-27-crm-app-quote-requests-inbox-design.md`(S1 인박스·`listQuoteRequests`·매칭), `2026-06-28-crm-app-requests-promote-design.md`(S2 고객 유입·link/create), 견적 워크벤치(#4c, `CustomerDetailPage`·`persistWorkbenchQuote`·`createQuote`).

## 배경

S1은 앱 견적요청을 읽고, S2는 요청자를 CRM 고객으로 유입(link/create)한다. S3는 그 요청을 **실제 견적**으로 만든다: 인박스에서 "견적 작성"을 누르면 그 고객의 워크벤치가 열리고 차량·구매방식·옵션이 미리 채워진 채(prefill) 견적을 작성한다. 작성된 견적은 `source_quote_request_id`로 원 요청을 가리킨다.

견적은 `crm.quotes.customer_id`가 NOT NULL이라 **고객이 반드시 있어야** 한다. 따라서 S3는 S2(고객 연결/생성)에 의존하며, 견적 작성은 **이미 고객에 연결된 요청**(`app_user`)에서만 시작한다.

## 결정 사항 (브레인스토밍 확정)

| 항목 | 결정 |
|---|---|
| 진입 노출 | **`app_user`(연결된 고객) 행에만 "견적 작성"**. `none`/`phone`은 S2로 고객을 먼저 만든 뒤(→`app_user`) 등장 |
| prefill 전달 | **URL 쿼리 파라미터** `?quoteRequest=<id>` (딥링크 #53 패턴, 새로고침 견고, id만 넘기고 서버가 데이터 SSOT) |
| prefill 범위 | **차량 + 구매방식 + 옵션**만. 가격(할인·취득세 등)은 견적요청에 없어 catalog 계산/상담사 입력 |
| source 저장 | `source_quote_request_id` **컬럼 값만 저장, FK 없음**(loose id — 컬럼 기존, 마이그 0, "public FK는 loose id 보류" 결정과 일치) |
| 승격 표시 | 인박스 행에 **"견적 N건" 배지**(`source_quote_request_id` 역참조 카운트). 상담사가 처리 여부를 한눈에 |
| 중복 | 같은 요청으로 견적 **여러 번 생성 허용**(비교안). 중복 방지 안 함 |

## 데이터 흐름

```
[인박스 app_user 행] "견적 작성"
  → navigate(`/customer-detail/:code?quoteRequest=<reqId>`)
  → CustomerDetailPage 마운트/URL 변경 시 ?quoteRequest 감지
  → GET /api/quote-requests/:id (단건: trimId·paymentMethod 한글·optionIds)
  → 워크벤치 자동 오픈 + prefill(차량/구매방식/옵션) + sourceQuoteRequestId state 보관
  → 상담사가 가격/할인 입력 → "작성완료"
  → POST /api/customers/:cid/quotes (payload.sourceQuoteRequestId 포함)
  → crm.quotes INSERT (source_quote_request_id 세팅)
  → 인박스 재진입(force 갱신) 시 그 요청 행에 "견적 N건" 배지
```

## 백엔드

`src/db/queries/quote-requests.ts`:

- **`getQuoteRequestDetail(id, executor)`**: prefill용 단건 조회. 반환 `{ id, trimId, paymentMethod, optionIds: number[] }`.
  - `trimId` = `quote_requests.trim_id`(catalog trim id).
  - `paymentMethod` = `quote_requests.payment_method`(**영문 lease/rent/… 그대로 반환**). 워크벤치 구매방식 라벨로의 한글 매핑은 **프론트에서**(워크벤치 옵션 목록 `kimQuotePurchaseMethodOptions`가 프론트 SSOT라). ⚠️ 그 옵션 라벨이 운용리스/장기렌트/할부/일시불과 일치하는지 착수 시 확인.
  - `optionIds` = `quote_request_options.trim_option_id` 배열(해당 요청).
  - 요청 없으면 null(404).
  - ⚠️ **데이터 의미 검증 선행**: `quote_request_options.trim_option_id` 값이 catalog `trim_options.id`(워크벤치 OptionPicker가 쓰는 id)와 같은 체계인지 착수 시 `psql`로 실측. 다르면 매핑 보강.

- **`listQuoteRequests` 승격 역참조**: 기존 `Promise.all` 병렬 batch에 `crm.quotes` 한 갈래 추가 — `source_quote_request_id IN (reqIds)` 집계 → `Map<requestId, count>`. 각 행에 `promotedQuoteCount: number`.

`src/db/queries/customer-quotes.ts`:

- **`createQuote` source 필드**: `QuoteCreateBody`에 `sourceQuoteRequestId?: string | null` 추가, INSERT `values`에 `sourceQuoteRequestId: body.sourceQuoteRequestId ?? null`. (UPDATE 경로는 무관 — 승격은 신규 INSERT만.)

`src/routes/quote-requests.ts`:
- **`GET /api/quote-requests/:id`** — `getQuoteRequestDetail`, `run`으로 404/500.

`src/routes/customers.ts`:
- 기존 `POST /:id/quotes`의 `quoteCreateBody` zod에 `sourceQuoteRequestId: z.uuid().nullable().optional()` 추가.

## 프론트

`client/src/lib/quote-requests.ts`:
- **`AppQuoteRequest`에 `promotedQuoteCount: number` 노출** + `toAppQuoteRequest` 매핑.
- **`fetchQuoteRequestDetail(id)`**: `GET /api/quote-requests/:id` → `{ trimId, paymentMethod, optionIds }`(prefill용).

`client/src/lib/customer-quotes.ts`:
- `QuoteCreatePayload`에 `sourceQuoteRequestId?: string | null` 추가.

`client/src/pages/AppRequestsPage.tsx`:
- `app_user` 행: 기존 "고객 보기" Link 옆에 **"견적 작성"** 버튼 → `navigate(`/customer-detail/${matchedCustomerCode}?quoteRequest=${r.id}`)`.
- `promotedQuoteCount > 0`이면 매칭 셀에 **"견적 N건" 배지**.

`client/src/pages/CustomerDetailPage.tsx`:
- **URL `?quoteRequest` 감지 effect**: 값이 있으면 `fetchQuoteRequestDetail` → **견적요청 전용 prefill 경로**로 워크벤치 오픈.
  - **`editPrefill`(수정 전용, 가격 포함)과 별개 경로**. 견적요청 prefill은 **차량(trimId)·옵션ids·구매방식만** 주입하고 **가격은 catalog 계산을 보존**한다(`applyTrimToPricing`의 prefill 가격 주입 분기를 타지 않음).
  - 신규 모드(`editingQuoteId=null`)지만 VehiclePicker에 trimId를 넘겨야 함 → 신규 prefill용 trimId state(예: `quoteRequestPrefill.trimId`)를 `VehiclePicker initialTrimId`로 전달(key는 "new" 유지 — 재마운트 회피). `applyTrimToPricing`이 이 prefill의 `optionIds`를 `selectedWorkbenchOptionIds`로 주입.
  - 구매방식: `paymentMethod` 한글 → `setSolutionWorkbenchPurchaseMethod`(워크벤치 옵션 라벨과 일치 확인).
  - `sourceQuoteRequestId`를 state 보관 → 신규 INSERT payload(`persistWorkbenchQuote`)에 포함. **워크벤치 닫힘/INSERT 성공/일반 `+` 신규 열기 시 clear**(일반 견적엔 source 안 붙게).
  - prefill 소비 후 URL 파라미터 제거(navigate replace) — 재실행/뒤로가기 시 재오픈 방지.

## 엣지 / 불변식

- 옵션 id가 catalog에 현재 없으면(단종 등) 그 옵션만 skip, 나머지 prefill 진행.
- prefill로 연 워크벤치에서만 `sourceQuoteRequestId` 부여. 일반 `+`로 연 워크벤치는 source 없음.
- 같은 요청 재승격 허용(중복 방지 없음) → `promotedQuoteCount`는 누적.
- 쓰기 성공 시 `invalidateCustomerDetail(cid)`(기존 불변식) + 인박스 캐시 force 갱신(`fetchAppQuoteRequestsCached(true)`로 배지 갱신).
- 견적요청 status는 앱 소유(read-only) — CRM은 안 건드림. 승격 표시는 역참조 카운트로만.

## 검증

- `bun run typecheck`/`lint`/`build`.
- `test:server`(`--env-file=.env.local`):
  - `getQuoteRequestDetail`: 옵션 있는 요청의 `optionIds`·`trimId`·`paymentMethod` 반환, 없는 요청 null.
  - `createQuote` source 라운드트립: payload에 `sourceQuoteRequestId` → INSERT 후 컬럼 값 확인(tx-롤백 패턴, 부작용 0).
  - `listQuoteRequests` 역참조: source가 붙은 견적이 있는 요청의 `promotedQuoteCount` 증가(tx 안에서 quote INSERT 후 카운트 확인, 롤백).
- `test:unit`: 어댑터 `promotedQuoteCount` 매핑, `fetchQuoteRequestDetail` 엔드포인트 호출.
- ⚠️ **브라우저 검증은 실 유입 데이터 필요**: 현재 매칭 0(profiles 전화 NULL·요청자 테스트계정) → `app_user` 행이 없어 "견적 작성" 버튼이 안 뜬다. 로직만 완성, 실 검증은 실 유입 후(유슨생).

## 범위 밖 (YAGNI / 다음)

- 금융조건(period/deposit) 시나리오 prefill(비교카드 uncontrolled DOM이라 복잡, 상담시 재계산값).
- 색상 prefill(견적요청에 없음).
- `source_quote_request_id` FK 제약(cross-schema, public 소유 — loose id 유지).
- 중복 승격 방지·승격 후 견적요청 자동 닫기(status는 앱 소유).
- 가격 자동 계산 고도화(견적 계산엔진은 별도 트랙).

## 다음

- S3 머지로 견적요청 파이프라인(S1 인박스 + S1.5 알림 + S2 유입 + S3 승격) **완성**. 이후는 실 유입 데이터 확보 시 브라우저 검증, 또는 견적 계산엔진·고객 앱(Flutter) 노출 등 별도 트랙.
