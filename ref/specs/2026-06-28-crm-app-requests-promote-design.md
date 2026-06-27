# CRM 앱 견적요청 고객 유입(S2) 설계 — 연결 / 신규 생성

작성일: 2026-06-28
상태: **design 확정(브레인스토밍 승인). 다음 = writing-plans → 구현.**
성격: 견적요청 파이프라인 세 번째 슬라이스 **S2 = 고객 유입**. 앱 요청자(`profiles`)를 CRM 고객(`crm.customers`)으로 **상담사 1클릭 연결/생성**. 견적요청 도메인의 **첫 쓰기**.
연계: `2026-06-27-crm-app-quote-requests-inbox-design.md`(S1 인박스·매칭 로직·`fetchAppQuoteRequestsCached`), `ref/business-code-system.md`(`CU-YYMM-####` 채번), `src/db/queries/customer-quotes.ts:186` `nextQuoteCode`(채번 패턴 복제 원본).

## 배경

S1 인박스는 매칭 결과(app_user_id > phone > none)를 **표시만** 한다. S2는 그걸 **실제 연결**로 만든다: 전화 매칭된 요청은 기존 고객에 연결(`app_user_id` set), 미매칭 요청은 신규 고객 생성. 이후 그 고객은 일반 CRM 흐름(상담·견적·계약)으로 들어간다.

## 결정 사항 (브레인스토밍 확정)

| 항목 | 결정 |
|---|---|
| 방식 | **상담사 1클릭**(완전자동 아님 — 오매칭·중복·테스트계정 유입 방지, 접수화면 철학과 일치) |
| 진입점 | 인박스 행, 매칭 상태별 버튼 |
| 생성 데이터 | **요청 데이터 매핑**(name·phone·차종·구매방식·source·초기상태) |
| 후속 흐름 | **인박스 머무름 + "연결됨" 표시**(연속 처리) + 토스트(고객코드) |

매칭 상태별 버튼:
- **none(미연결)** → "신규 고객 생성"
- **phone(기존 고객 추정)** → "○○○에 연결"
- **app_user(연결됨)** → 버튼 없음(완료)

## 아키텍처

두 동작 분리(각 1책임):
- **연결(link)**: 요청의 `user_id`를 대상 고객의 `app_user_id`에 set.
- **생성(create)**: `profiles` + 요청 데이터로 신규 `customers` INSERT(`app_user_id` 연결 포함, `customer_code` 채번).

읽기는 S1 그대로. 쓰기 성공 시 인박스 캐시를 force 재fetch해 매칭 표시를 갱신(app_user_id가 채워지면 다음 read에서 "연결됨").

## 백엔드

`src/db/queries/quote-requests.ts`에 추가:

- **`nextCustomerCode(executor)`**: `CU-YYMM-####`. `nextQuoteCode`(같은 파일 패턴) 복제 — 현재월 prefix + 기존 max 시퀀스 +1, `customer_code` UNIQUE라 서버 canonical 생성.
- **`linkRequestToCustomer(requestId, customerId, executor)`**: 요청에서 `user_id` 조회 → `UPDATE customers SET app_user_id = userId WHERE id = customerId`. 요청/고객 없으면 null(404). 반환 `{ id, customerCode, name }`.
- **`createCustomerFromRequest(requestId, executor)`**: 요청 + `profiles` 조회. **중복 방지**: 그 `user_id`로 이미 `customers`(app_user_id) 있으면 새로 만들지 않고 기존 반환. 없으면 INSERT(아래 매핑) + `nextCustomerCode`. 트랜잭션. 반환 `{ id, customerCode, name }`.

라우트(`src/routes/quote-requests.ts`):
- `POST /api/quote-requests/:id/link` — body `{ customerId: uuid }`. zValidator. `run`으로 404/500.
- `POST /api/quote-requests/:id/create-customer` — body 없음. 반환 생성/기존 고객.

### create 데이터 매핑

| `customers` 컬럼 | 출처 |
|---|---|
| `customer_code` | `nextCustomerCode()` |
| `name` | `profiles.full_name` ?? `"이름미상"` (name NOT NULL) |
| `phone` | `profiles.phone_number` |
| `app_user_id` | `quote_request.user_id` |
| `need_model` | 요청 trim → `[brand] [model]` (catalog join) |
| `need_trim` | 요청 trim → `trimName` |
| `need_method` | `payment_method` 한글(lease→운용리스 등, 백엔드 맵) |
| `source` | `"앱 견적비교"` (source CHECK 통과) |
| `status_group` / `status` | `"신규"` / `"상담접수"` (CHECK 실측 확정) |
| `received_at` | 요청 `created_at`(유입 시점) |

- payment 한글 맵은 S1 프론트 `PAYMENT_METHOD_LABEL`과 동일 어휘(운용리스/장기렌트/할부/일시불). 백엔드에 동일 const(작은 중복 — 백/프 도메인 분리상 허용).
- 차량명은 `listQuoteRequests`의 trim→model→brand join을 단건용 헬퍼로 재사용(옵션/색상 불필요 — `getTrimDetail`는 무거워 안 씀).

## 프론트

- **어댑터 보강**: `AppQuoteRequest`(UI 타입)에 `matchedCustomerId`/`matchedCustomerName`/`matchedCustomerCode`를 노출(S1 코드리뷰에서 YAGNI로 보류했던 필드 — S2의 link 버튼 대상·버튼 라벨·"고객 보기" 링크에 필요). `AppQuoteRequestRow`엔 이미 있으므로 `toAppQuoteRequest`가 통과만 하면 됨.
- `client/src/lib/quote-requests.ts`: `linkRequestToCustomer(requestId, customerId)` / `createCustomerFromRequest(requestId)` (`sendJson` POST). 성공 시 `fetchAppQuoteRequestsCached(true)`로 인박스 갱신 + `invalidateCustomerDetail(customerId)`(연결 고객 상세 stale 방지).
- `AppRequestsPage`: 행에 매칭 상태별 버튼 + 핸들러. 성공 시 force 재fetch(매칭 "연결됨"으로) + 토스트(`"CU-2606-#### ○○○ 생성"` / `"○○○에 연결"`). "고객 보기" 링크(`/customer-detail/:matchedCustomerCode`)로 상세 이동 가능.

## 엣지 / 불변식

- 이미 `app_user_id` 연결된 user의 요청 = "연결됨", 버튼 없음(중복 클릭 불가).
- create 중복: 같은 `user_id`로 이미 고객 있으면 기존 반환(이중 생성 방지).
- link 대상 고객이 이미 다른 `app_user_id`면? 현 범위에선 덮어쓰기(phone 매칭 고객은 보통 app_user_id null). unlink/병합은 범위 밖.
- 쓰기 후 `invalidateCustomerDetail` 필수(고객 상세 캐시 불변식) + 인박스 캐시 force 갱신.

## 검증

- `bun run typecheck`/`lint`/`build`.
- `test:server`: link 라운드트립(app_user_id set 확인), create 라운드트립(생성 후 customer 존재·`CU-` 코드·app_user_id·need_* 매핑), create 중복 방지(2회 호출 → 같은 customer), 404(없는 요청). `--env-file=.env.local`.
- `test:unit`: 프론트 lib 함수가 적절한 엔드포인트 호출 + 성공 시 캐시 갱신(mock).
- ⚠️ **브라우저 검증은 실 유입 데이터 필요**: 현재 phone 매칭 0 → "연결" 버튼 안 뜸. "생성"은 테스트 계정으로만 동작(name=제임스 등, phone null). 실 의미는 앱에서 전화 입력 회원이 견적요청해야. 로직만 완성하고 실 검증은 유입 후.

## 범위 밖 (YAGNI / 다음)

- **S3 견적 승격**(요청→워크벤치 prefill→`crm.quotes` INSERT + `source_quote_request_id`).
- 연결 해제(unlink)·고객 병합·매칭 후보 수동 검색(다른 고객 선택)·완전자동 유입.

## 다음

- S3 견적 승격이 마지막 슬라이스. 이후 파이프라인(S1 인박스 + S1.5 알림 + S2 유입 + S3 승격) 완성.
