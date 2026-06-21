# crm 견적 쓰기(#4b) 설계 — 기존 견적 mutate 영속화

작성일: 2026-06-21
상태: **design 확정. 구현(plan) 대기.**
성격: 견적 도메인(#4) 둘째 사이클 = **기존 견적 쓰기**. 김민준 견적함의 로컬(useState) 조작 중 **이미 존재하는 견적의 변경**(메타 수정·삭제·decision/app status 토글)을 DB에 영속화.
연계: `2026-06-21-crm-quotes-read-design.md`(#4a 읽기·어댑터·시드), `2026-06-17-crm-quotes-schema-design.md`(스키마·snapshot 원칙), #54/#55 고객 쓰기(낙관+롤백·`id AND customer_id` 가드·`invalidateCustomerDetail` 불변식 패턴).

## 배경 / 현황

- #4a로 김민준 견적함이 `detail.quotes.map(toKimQuoteItem)`(DB read)에서 뜬다. 그러나 **모든 조작은 `useState`라 새로고침하면 DB 초기값으로 원복**(미저장).
- 견적함의 실제 쓰기 동작은 `CustomerDetailPage.tsx`의 `setQuotes` 7곳:

| 라인 | 동작 | 분류 |
|---|---|---|
| `saveQuote`(edit branch) | **메타 수정** (현행: 수정=재발송) | **#4b** |
| `saveQuote`(add branch) | 견적 추가(생성) | #4c |
| `saveQuoteFromWorkbench` | 워크벤치 신규 저장(생성) | #4c |
| `attachQuoteFileToQuote` | 원본 파일 첨부 | #4d |
| `deleteQuote` | **삭제** | **#4b** |
| `sendQuoteToApp` | **앱 발송 토글** | **#4b** |
| `updateQuoteDecisionStatus` | **decision 토글** | **#4b** |

- 견적 도메인 4분해: a.읽기(#4a, 머지) / **b.기존 견적 쓰기(#4b, 이 spec)** / c.생성·워크벤치 저장(#4c) / d.원본 업로드(#4d).

## 범위

- **범위 안**: 기존 견적의 변경 영속화 — ⓐ메타 수정(quote 헤더 + 대표 시나리오 1건), ⓑ삭제, ⓒdecision_status 토글, ⓓapp_status 발송 토글. 백엔드 3계층(query/route/lib) + Kim 핸들러 4개 wiring(낙관+롤백).
- **범위 밖(다음 사이클)**: 견적 생성(추가/워크벤치 = #4c), 원본 파일 업로드(#4d), **대표 시나리오 지정 + 다중 시나리오 편집/비교 UI**(트리거 부재 → #4c), `valid_until`(D-day) 날짜 편집, 차량/색상/옵션/할인 snapshot 재계산(워크벤치 도메인).

## 핵심 발견 (설계 전제)

1. **현행 "메타 수정 = 재발송"**: `saveQuote`의 edit 분기는 quote 메타를 갱신하면서 **자동으로 `app_status="sent"` + `sent_at=now` + (이미 발송된 적 있으면 `revision++` → "수정 발송")**까지 수행한다. #4b는 이 동작을 **그대로 보존**(분리는 UX 변경이라 별도 합의 영역).
2. **대표 시나리오 단일**: #4a는 평탄화된 단일 금융조건만 표시/편집한다. 다중 시나리오 비교/선택 UI가 없으므로 composer 편집의 finance 4필드(`financeType/term/monthlyPayment/lender`)는 **대표 시나리오 1건**에 매핑된다. 다중 시나리오 PATCH·대표 지정은 UI가 생기는 #4c.
3. **`viewed`는 앱 주도**: `app_status="viewed"`는 앱 고객이 견적을 여는 순간 발생. CRM(상담사)은 발송(`sent`)까지만 쓰고 `viewed`는 읽기전용.

## 접근 — 단일 PATCH + DELETE (수렴)

4개 쓰기 동작(메타 수정·발송·decision·삭제) 중 앞 3개는 모두 **같은 quote에 대한 부분 변경**이다 → **하나의 PATCH 엔드포인트(부분 바디)** + DELETE로 수렴.

```
PATCH  /api/customers/:id/quotes/:quoteId   (부분 바디)
DELETE /api/customers/:id/quotes/:quoteId
```

- PATCH 바디 = quote 헤더 부분 필드 + 선택적 `scenario` 서브객체(대표 시나리오 1건 갱신).
- 단일 필드 토글(decision/app status)도 같은 PATCH의 부분집합으로 호출(별도 라우트 불필요).
- 대안(동작별 라우트 4개)은 자식 CRUD보다 과분할 → 기각.

## PATCH 바디 ↔ DB 매핑

quote 헤더(전부 optional, 보낸 것만 갱신):

| 바디 키 | DB 컬럼 | 비고 |
|---|---|---|
| `status` | `quotes.status` | mock "고객 확인 전" 등 snapshot |
| `entryMode` | `quotes.entry_mode` | source(manual/solution/original) |
| `quoteRound` | `quotes.quote_round` | "1차"/"2차" |
| `stockStatus` | `quotes.stock_status` | 재고있음/없음/확인중 |
| `brandName`/`modelName`/`trimName` | 동명 컬럼 | snapshot 재기록 |
| `appStatus` | `quotes.app_status` | 발송 시 "sent"(viewed 미수용) |
| `sentAt` | `quotes.sent_at` | 발송 시각 |
| `decisionStatus` | `quotes.decision_status` | none/considering/confirmed/contracting |
| `note` | `quotes.note` | |
| `bumpRevision` | `quotes.revision` | true면 서버에서 `revision = revision + 1` (재발송) |

대표 시나리오(`scenario` 서브객체, 있으면 대표 시나리오 1건 UPDATE):

| 바디 키 | DB 컬럼 | 비고 |
|---|---|---|
| `purchaseMethod` | `quote_scenarios.purchase_method` | financeType |
| `termMonths` | `quote_scenarios.term_months` | "60개월"→60 파싱은 프론트 lib |
| `monthlyPayment` | `quote_scenarios.monthly_payment` | numeric, "월 …원"→숫자 파싱은 프론트 lib |
| `lender` | `quote_scenarios.lender` | |

**미저장(파생)**: `title`/`meta`/`vehicleName`은 DB 컬럼 없음 → 새로고침 시 `toKimQuoteItem`이 brand/model/trim에서 재파생. `validLabel`은 표시 라벨이라 `valid_until` 날짜 편집은 #4b 제외(현행 파생 표시 유지).

## 3계층 (#55 자식 CRUD 패턴 그대로)

### 1. `src/db/queries/customer-quotes.ts` (신규)

- `updateQuote(db, customerId, quoteId, patch)`: `id AND customer_id` 가드. quote 헤더 부분 갱신 + `patch.scenario`가 있으면 **대표 시나리오 1건**(`primary_scenario_id` → 없으면 `scenario_no` 최소) UPDATE. 두 UPDATE는 **트랜잭션**(부분 실패 방지). `bumpRevision`은 SQL `revision = revision + 1`. **affected row 수 반환(0이면 라우트가 404)**.
- `deleteQuote(db, customerId, quoteId)`: `id AND customer_id` 가드 DELETE. scenarios는 `ON DELETE CASCADE`로 자동 삭제. **affected row 수 반환(0이면 404)**.
- 대표 시나리오 식별 헬퍼는 #4a `pickPrimaryScenario`와 동일 규칙(primary_scenario_id → scenario_no 최소).

### 2. `src/routes/customers.ts` (라우트 추가)

- `customers.patch("/:id/quotes/:childId", zValidator(param, childParam), zValidator(json, quotePatchBody), …)` — 200(갱신)/404(`id AND customer_id` 불일치).
- `customers.delete("/:id/quotes/:childId", zValidator(param, childParam), …)` — 200/404.
- `quotePatchBody` = quote 헤더 키(전부 `.optional()`) + `scenario`(`.optional()` 객체). enum 필드(app_status/decision_status/entry_mode/stock_status)는 zod enum 검증. 기존 자식 라우트(memos/tasks/schedules/documents) 옆에 배치.

### 3. `client/src/lib/customer-quotes.ts` (신규)

- `updateQuote(cid, quoteId, patch)`, `deleteQuote(cid, quoteId)` — `customer-children.ts`와 동일하게 `sendVoid` 사용, **성공 시 `invalidateCustomerDetail(cid)`**(상세 캐시 불변식 — 안 하면 재진입 stale).
- 파싱 헬퍼: `termMonths`("60개월"→60), `monthlyPayment`("월 2,473,200원"/콤마→numeric 문자열). 단위테스트 대상.

### 4. `CustomerDetailPage` Kim 핸들러 wiring (4개)

- `saveQuote`(edit), `deleteQuote`, `sendQuoteToApp`, `updateQuoteDecisionStatus`에 **낙관 갱신 후 API 호출, 실패 시 롤백**(#55 패턴). 토스트는 성공/실패 분기.
- **임시 id 가드**: 생성은 #4c라 #4b 동안 추가된 새 견적(`id.startsWith("kim-quote-")`)은 아직 DB 미존재 → 그 항목의 PATCH/DELETE는 **API 생략**(로컬만). #55의 `kim-` 가드와 동형.
- 메타 수정은 헤더+시나리오를 한 PATCH 바디로(현행 재발송 동작 포함: appStatus="sent", sentAt, `bumpRevision`은 **이미 발송 이력이 있는 견적의 재발송일 때**만 — 정확한 판정은 mock의 현행 동작에 맞춰 plan에서 확정).

## 캐시·불변식

- **모든 쓰기 성공 경로에서 `invalidateCustomerDetail(customerId)` 필수**(lib 함수 내부에서). 빠지면 60s 동안 재진입 stale.
- 낙관 갱신 + 실패 롤백으로 체감 즉시 + 정합 유지.

## 검증

- `bun run typecheck` 0 · `bun run lint` 0
- `bun run test:unit`: 프론트 파싱 헬퍼(termMonths/monthlyPayment) 단위테스트(정상·null·콤마·단위 케이스).
- `bun run test:server`: `PATCH /:id/quotes/:childId`(헤더만·scenario 포함·bumpRevision·404·교차고객 가드), `DELETE`(200·404·cascade). 라운드트립으로 `getCustomer`가 변경 반영하는지.
- `bun run build`
- 브라우저(인증 세션): 메타 수정·삭제·발송·decision 토글 후 **새로고침해도 유지**(이전엔 원복).

## 미결 / 다음

- **#4c 생성·워크벤치 저장**: composer add + `saveQuoteFromWorkbench` → quote + scenarios INSERT. **대표 시나리오 지정·다중 시나리오 비교 UI도 여기서**(그때 PATCH 바디의 scenario를 N건으로 확장, primary 지정 라우트/필드 추가).
- **#4d 원본 업로드**: `attachQuoteFileToQuote` → 서류 #3 Storage 재사용(`file_*` 컬럼).
- `valid_until`(D-day) 편집 UI(date 입력) — 필요 시 별도.
- 견적 도메인 거대파일 분해는 #4c 데이터화 이후(`KimQuoteItem` 타입 변경 가능).
