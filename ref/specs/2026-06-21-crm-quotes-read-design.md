# crm 견적 읽기(#4a) 설계 — mock → DB read

작성일: 2026-06-21
상태: **design 확정. 구현(plan) 대기.**
성격: 견적 도메인(#4) 첫 사이클 = **읽기만**. 김민준 견적함을 mock const → DB(`crm.quotes` + `crm.quote_scenarios`) read로 전환.
연계: `2026-06-17-crm-quotes-schema-design.md`(스키마·snapshot 원칙), `2026-06-19-crm-customers-read-design.md`(read-first 3계층 패턴), #51 `toCustomerDetail`(상세 자식 로드·어댑터 패턴).

## 배경 / 현황

- DB 테이블은 이미 마이그레이션 완료(`crm.quotes` 44컬럼 + `crm.quote_scenarios` 25컬럼), **데이터 0/0**.
- 김민준(`CU-2605-0020`) 견적함은 `KimQuoteItem`(UI 전용 타입, `CustomerDetailPage.tsx:82`) + `kimMinjunQuoteHistory`(3견적 const, `:318`) 하드코딩 상태.
- 견적 도메인은 4개 하위로 분해된다: **a. 읽기** / b. 견적함 CRUD / c. 워크벤치 저장 / d. 원본 업로드. **이 spec은 a(읽기)만.**

## 범위

- **범위 안**: `getCustomer`에 quotes + 각 quote의 scenarios 중첩 로드, `GET /api/customers/:id` 응답에 quotes 포함, 프론트 `toCustomerDetail`에 quotes 매핑 + 신규 평탄화 어댑터 `toKimQuoteItem`, 김민준 견적함 state 초기값을 mock → `detail.quotes`로 교체, 시드(김민준 견적 3 + 시나리오 3).
- **범위 밖(다음 사이클)**: 견적 쓰기(메타 수정·삭제·상태토글·대표 시나리오 지정 = #4b), 워크벤치 신규 작성 저장(#4c), 원본 파일 업로드(#4d), 시나리오 비교 UI, `lease_calc` 실계산.

## 접근 — 평탄 어댑터 (접근 1)

DB는 정규화(quote 1건 = 시나리오 1~3), 화면은 기존 평탄 표시 유지. `getCustomer`가 quote + `scenarios[]`를 중첩으로 주고, lib 어댑터 `toKimQuoteItem(quote, primaryScenario)`가 **대표 시나리오를 평탄화**해 기존 `KimQuoteItem` 형태로 변환. UI 컴포넌트는 state 초기값 출처만 바뀌고 거의 무변경.

- 대안(접근 2, UI 타입 재설계)은 견적 렌더링/워크벤치 UI 대거 수정이 필요해 읽기 범위 초과로 기각.
- #51 `toCustomerDetail`과 동일한 read-first 패턴 → 검증된 흐름.

## 데이터 흐름

```
getCustomer (src/db/queries/customers.ts)
  ├ 기존 자식 5(tasks/schedules/memos/documents/consultations) + quotes 추가
  ├ quotes 먼저 로드 → scenarios를 quote_id IN (...) 로 한 번에 묶어 메모리 그룹핑 (N+1 회피)
  └ CustomerDetail 타입에 quotes: (Quote & { scenarios: Scenario[] })[] 추가
        ↓
GET /api/customers/:id  (route 무변경 — 자식 배열 그대로 직렬화)
        ↓
toCustomerDetail (client/src/lib/customers.ts)
  ├ CustomerDetailResponse / CustomerDetailData 에 quotes 추가
  └ 신규: toKimQuoteItem(quote, primaryScenario) — 평탄화 + 파생
        ↓
KimMinjunDetailContent (CustomerDetailPage.tsx)
  └ quotes state 초기값: kimMinjunQuoteHistory(mock) → detail.quotes.map(toKimQuoteItem)
```

## KimQuoteItem ↔ DB 매핑

| KimQuoteItem (UI) | DB 출처 | 비고 |
|---|---|---|
| `id` | `quotes.id` (uuid) | mock 문자열 id → uuid |
| `quoteCode` | `quotes.quote_code` | `QT-YYMM-####` |
| `source` | `quotes.entry_mode` | **이름만 다름** (값 manual/solution/original 동일) |
| `appStatus` | `quotes.app_status` | draft/queued/sent/viewed |
| `status` | `quotes.status` | mock 값 그대로 snapshot |
| `stockStatus` | `quotes.stock_status` | |
| `decisionStatus` | `quotes.decision_status` | none/considering/confirmed/contracting |
| `note` | `quotes.note` | |
| `quoteRound` | `quotes.quote_round` | "1차"/"2차" |
| `revision` | `quotes.revision` | |
| `brand` `model` `trim` | `brand_name` `model_name` `trim_name` | snapshot |
| `sentAt` `viewedAt` | `sent_at` `viewed_at` (timestamptz) | 표시 포맷은 어댑터 |
| **`financeType`** | **`scenario.purchase_method`** | ← **대표 시나리오** |
| **`term`** | **`scenario.term_months`** (smallint) | `60` → `"60개월"`, null → `"조건 미정"` |
| **`monthlyPayment`** | **`scenario.monthly_payment`** (numeric) | `2473200` → `"월 2,473,200원"`, null → undefined |
| **`lender`** | **`scenario.lender`** | null → "금융사 미정" |
| `title` `meta` `vehicleName` | **어댑터 파생** | brand/model/trim/round 조합 (DB 컬럼 없음) |
| `validLabel` | **어댑터 파생** ← `quotes.valid_until` | 현재시각 기준 D-day, 과거면 "만료됨" |
| `file*` `objectUrl` `originalNeedsReplacement` | (범위 밖) | original 업로드는 #4d |

**핵심**: 시나리오 레벨 4필드(`financeType`/`term`/`monthlyPayment`/`lender`)만 대표 시나리오에서 평탄화. 나머지는 quote 헤더 직매핑. `title`/`meta`/`vehicleName`/`validLabel`은 DB에 컬럼이 없어 어댑터에서 파생(mock도 사실 표시용 파생값).

### 파생 규칙

- **대표 시나리오**: `primary_scenario_id` 일치 → 없으면 `scenario_no` 최소 → 없으면 null(평탄 4필드 표시는 "확인 전"류).
- `term`: `term_months`가 있으면 `"${n}개월"`, null이면 `"조건 미정"`.
- `monthlyPayment`: `monthly_payment`가 있으면 `"월 ${천단위콤마}원"`, null이면 undefined(화면 "월 납입금 확인 전").
- `lender`: null이면 "금융사 미정".
- `validLabel`: `valid_until`이 미래면 `"D-${일수}"`(올림/내림 규칙은 plan에서 1택), 과거/오늘 지남이면 "만료됨", null이면 표시 안 함.
- `title`/`vehicleName`: `[brand] [model] [trim]`(빈 토큰 제외) 조합. `meta`: sentAt/appStatus 기반 표시 문자열 또는 비움(읽기 1차는 보수적으로 단순 조합).

## 시드 (scripts/seed-customers.ts 멱등 블록)

mock 3견적을 DB로 시드. 김민준 customer_id 하위에 `quotes` 3 + `quote_scenarios` 3(각 `scenario_no=1`). 멱등: quote_code 기준 delete→insert(자식 시나리오는 ON DELETE CASCADE).

- **QT-2606-0001** (운용리스 1차): entry_mode=solution, app_status=sent, decision=none, stock=재고있음, valid_until=미래(D-6). 시나리오: purchase_method=운용리스, term_months=60, lender=iM캐피탈, monthly_payment=2473200.
- **QT-2606-0002** (운용리스 2차): entry_mode=solution, app_status=viewed, decision=confirmed, stock=재고확인중, valid_until=미래(D-4), viewed_at 설정. 시나리오: 운용리스, 60, 우리금융캐피탈, 2398000.
- **QT-2606-0003** (GLC 비교, 작성중): entry_mode=manual, app_status=draft, decision=none, stock=재고확인중, valid_until=과거(만료됨). 시나리오: purchase_method="비교 견적", term_months=null, lender=null, monthly_payment=null.
- 각 quote insert 후 `primary_scenario_id`를 그 시나리오 id로 UPDATE(순환 FK 회피 — 스키마 spec §154).
- `valid_until`은 시드 시점 기준 상대 오프셋으로 계산(D-6/D-4는 +6d/+4d, 만료는 -1d). 시간 경과 시 D-day가 실제로 줄어드는 것은 정상 동작.

## 읽기 후 로컬 조작 (#51 패턴)

견적함의 기존 로컬 동작(추가/수정/삭제/상태토글/워크벤치 입력)은 **useState 그대로 유지 = 미저장**. 새로고침하면 DB 초기값으로 원복. 이번 변경의 실질은 **"초기 표시값을 mock const → DB로"**가 전부. 쓰기 영속화는 #4b부터.

## 캐시·불변식

- `lib/customers.ts` `detailCache`(TTL 60s)는 그대로. 견적은 읽기만이라 신규 invalidate 호출 없음.
- **불변식 경고**: #4b(견적 쓰기) 추가 시 그 lib 함수에도 `invalidateCustomerDetail(customerId)` 필수(상세 캐시 stale 방지).

## 검증

- `bun run typecheck` 0 · `bun run lint` 0
- `bun run test:unit`: `toKimQuoteItem` 어댑터 단위테스트 신규(평탄화·파생·null 케이스).
- `bun run test:server`: `getCustomer`/`GET :id`가 quotes(+scenarios) 포함 라운드트립.
- `bun run build`
- 시드 멱등(2회 실행 동일 결과).
- 브라우저(인증 세션): 김민준 견적함 3건이 DB값으로 뜨고 mock과 동일 표시.

## 미결 / 다음

- #4b: 견적 쓰기(메타 수정·삭제·decision/app status 토글·대표 시나리오 지정). PATCH/DELETE 라우트 + invalidate.
- #4c: 워크벤치 solution 모드 신규 작성 → quote + scenarios INSERT.
- #4d: original 모드 원본 파일 업로드(서류 #3 Storage 재사용).
- 견적 도메인 분리(거대파일 분해)는 데이터화(#4) 이후 — `KimQuoteItem` 타입 변경 가능.
