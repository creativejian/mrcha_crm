# CRM 고객 니즈 영역 = 앱 견적요청 카드 목록 설계

작성일: 2026-06-29
상태: **design 확정(브레인스토밍 승인). 다음 = writing-plans → 구현.**
성격: 고객 상세 "고객의 니즈" 영역을, 그 고객이 앱에서 보낸 **앱 견적요청(`quote_requests`)을 카드로 쌓아** 여러 관심 차종을 한눈에 보이게 한다. 각 카드에서 "견적 작성"으로 견적함(`crm.quotes`)에 승격(S3 재사용). 견적함은 분리 유지.
연계: S3 견적 승격(`2026-06-28-crm-quote-promotion-design.md` — 워크벤치 prefill·`source_quote_request_id`), S1 인박스(`listQuoteRequests`·어댑터), 앱고객 표시 버그 fix(PR #121 — 일반화로 드러난 후속).

## 배경

앱 견적요청으로 자동 생성된 고객(예: 김지안)은 한 user가 **여러 차종**을 요청할 수 있다(김지안 = 쏘렌토·BMW7·BMW5·530e 4건). 그런데 고객의 `need_model`/`need_trim`은 **생성 시점 1건만** 담아, 상세 니즈 영역에 차종 하나만 보인다(나머지는 인박스에만). 상담사가 "이 고객이 어떤 차들을 알아봤는지"를 고객 상세에서 한눈에 못 본다.

"고객의 니즈" 영역은 의미상 **"고객이 원하는 차"**이고, 앱 견적요청도 "이 차 알아봐 주세요"라 성격이 같다. 그래서 이 영역에 그 고객의 앱 요청을 **카드로 쌓는다**. 견적함은 "상담사가 만들어 나간 견적"으로 분리 유지(요청 ↔ 견적 단계 구분).

## 결정 사항 (브레인스토밍 확정)

| 항목 | 결정 |
|---|---|
| 데이터 소스 | **`app_user_id` 있으면** 그 user의 `quote_requests` 카드 목록, **없으면**(수기 등록 고객) 기존 수기 `need_model/trim` 단일 카드 폴백 |
| 카드 내용 | 차종·트림·구매방식·옵션수·조건(기간/보증금) — 인박스 어댑터(`AppQuoteRequest`) 재사용. **read-only**(요청은 앱 소유) |
| 카드 액션 | 각 카드 **"견적 작성"** → 워크벤치 prefill(S3 재사용) → 견적함 승격. 이미 견적 만든 요청은 **"견적 N건" 배지**(`promotedQuoteCount`) |
| 문의사항(`need_memo`) | **고객 단위로 유지**(카드 아래). 요청별 문의사항 아님 — 상담사 메모. 안 빠짐 |
| 색상(`need_colors`) | 고객 단위 값 → 유지(요청엔 없음). 견적별 색상은 워크벤치에서 선택 |
| 견적함 | 분리 유지(`crm.quotes`, 상담사 견적). 카드에서 승격된 견적만 들어감 |
| 처리 표시 | "견적 N건" 배지만(쌓여도 처리 여부 구분). 카드 접기/필터는 후속 |

## 아키텍처

니즈 영역 렌더 분기:
- **앱 유입 고객**(`detail.appUserId` 존재): 그 user의 앱 요청을 fetch → 카드 목록(read) + 고객 문의사항(`need_memo`) + 색상(`need_colors`).
- **수기 등록 고객**(`appUserId` null): 기존 수기 need 카드(현행 유지, 회귀 없음).

요청 read는 인박스(`listQuoteRequests`) 로직을 user 필터로 재사용. 견적 작성은 S3 워크벤치 prefill을 재사용하되, 니즈 카드는 **같은 고객 상세 안**이라 인박스처럼 URL(`?quoteRequest=`)을 거치지 않고 직접 워크벤치 오픈+prefill해도 된다(구현 시 택일 — 동작 동일).

## 백엔드 — `src/db/queries/quote-requests.ts`, `routes`, `customers`

1. **`listQuoteRequestsByUser(appUserId, executor)`**: 기존 `listQuoteRequests`의 batch read(profiles join·trim 차량명·옵션수·매칭·`promotedQuoteCount`)를 그대로 쓰되, 요청 조회에 `eq(quoteRequests.userId, appUserId)` 필터 추가. (공통 로직을 internal 헬퍼로 추출해 `listQuoteRequests`(전체)와 `listQuoteRequestsByUser`(필터)가 공유 — 중복 회피.)
2. 라우트 `GET /api/customers/:id/quote-requests` — 그 고객의 `app_user_id` 조회 → 있으면 `listQuoteRequestsByUser`, 없으면 `[]`. (`customers.ts` 라우트.)
3. `getCustomer`(detail)에 **`appUserId` 노출** — 니즈 영역이 "앱 유입 여부"를 알아 분기. (현재 detail에 미노출.)

## 프론트 — `lib/quote-requests.ts`, `CustomerDetailPage`

1. `lib/quote-requests.ts`: **`fetchCustomerQuoteRequests(customerId)`** — `GET /api/customers/:id/quote-requests` → `AppQuoteRequest[]`(어댑터 재사용).
2. `lib/customers.ts`: `CustomerDetailData`/`toCustomerDetail`에 `appUserId` 추가(백엔드 노출분).
3. `CustomerDetailPage` 니즈 영역:
   - `detail.appUserId` 있으면 `fetchCustomerQuoteRequests`로 카드 목록 렌더(기존 니즈 카드 스타일 재사용), 없으면 기존 수기 need 카드.
   - 각 카드 "견적 작성" → 워크벤치 prefill(S3 경로 재사용). `promotedQuoteCount > 0`이면 "견적 N건" 배지.
   - 카드 목록 아래 문의사항(`need_memo`)·색상(`need_colors`) 고객 단위 유지.

## 엣지 / 불변식

- `app_user_id` 있는데 요청 0건(이론상 드묾): 빈 안내("앱 견적요청 없음") 또는 수기 need 폴백 — 구현 시 빈 안내로.
- 요청은 read-only(앱 소유). CRM은 요청을 수정/삭제하지 않음.
- 견적 작성 성공 시 그 요청의 `promotedQuoteCount` 갱신(재fetch) → 배지 반영.
- 수기 고객(app_user_id null)은 기존 동작 완전 유지(회귀 없음).
- `need_memo`/`need_colors`는 고객 단위라 앱/수기 무관하게 유지.

## 검증

- `bun run typecheck`/`lint`/`build`.
- `test:server`: `listQuoteRequestsByUser`가 그 user 요청만 반환(다른 user 제외) + `listQuoteRequests`(전체) 회귀 없음. `GET /api/customers/:id/quote-requests`(app_user 고객 N건, 수기 고객 0건). (실 DB — 김지안 user 4건 활용 가능.)
- `test:unit`: `fetchCustomerQuoteRequests` 엔드포인트 호출, 어댑터 재사용.
- **브라우저 수동(유슨생)**: 김지안 상세 니즈 영역에 4개 차종 카드 + 문의사항 유지 + "견적 작성"→워크벤치. 김민준(수기) 기존 단일 니즈 카드 회귀 없음.

## 범위 밖 (YAGNI / 후속)

- 처리된(견적 만든) 카드 접기/필터/정렬.
- 수기 등록 고객의 여러 차종 입력(현재 1칸).
- 요청별 문의사항(앱 `quote_requests`에 필드 추가되면).
- 관리상태 통일(별도 follow-up — 목록 활동기반 vs 상세 "정상").

## 다음

- 이 슬라이스로 "한 고객의 여러 앱 요청"이 상세에 보이고 각각 견적 승격 가능 → 견적요청 파이프라인의 고객 상세 통합 완성. 이후 관리상태 통일·처리 카드 정리 등 후속.
