# CRM 앱 견적요청 인박스(S1) 설계 — public.quote_requests 직접 read

작성일: 2026-06-27
상태: **design 초안. 확정 후 writing-plans → 구현.**
성격: 앱 견적요청→CRM 파이프라인(방향 C 하이브리드)의 **첫 슬라이스 S1 = 읽기 전용 인박스**. 마이그레이션 0.
연계: brainstorming 합의(메모리 `next-task-quote-request-pipeline`), `2026-06-19-crm-customers-read-design.md`(read-first 3계층), `2026-06-21-crm-quotes-read-design.md`(어댑터·N+1 회피 패턴), `2026-06-17-crm-quotes-schema-design.md`(`source_quote_request_id`·`app_user_id` 연결컬럼).

## 배경 / 파이프라인 위치

앱(Flutter, 별도 레포) 고객이 앱에서 만든 견적요청(`public.quote_requests`)을 CRM 상담사가 보고, 추후 CRM 고객·견적으로 승격하는 파이프라인. **방향 C(하이브리드)**: CRM은 앱 public 데이터를 **직접 read(복사/sync 금지 — 차량 catalog와 동일 철학)**, 승격 시점에만 `crm.quotes`로 복제(`source_quote_request_id` 연결).

3슬라이스로 분해(브레인스토밍 확정):

- **S1 앱 요청 인박스(읽기)** ← 이 spec. 별도 '앱 요청' 사이드메뉴. 가볍고 마이그 0.
- S2 고객 유입(전화매칭 연결 + 신규 `crm.customers` 생성 + `app_user_id`). — 범위 밖.
- S3 견적 승격(요청→워크벤치 prefill→`crm.quotes`). — 범위 밖.

S1 위치가 **고객 상세가 아니라 별도 큐**인 이유: 앱 요청자는 매칭 전까지 CRM 고객과 미연결이라 어느 고객 상세에도 속하지 않는다.

## 실측 (2026-06-27, master DB)

### `public.quote_requests` (97건 / user 3명)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid NN | FK→`profiles.id` |
| `trim_id` | bigint | FK→`catalog.trims.id`. **97건 전부 non-null** → 차량명 항상 조회 가능 |
| `payment_method` | text | lease 66·rent 16·cash 8·installment 7 |
| `period` | int | 계약기간(개월). cash/일시불은 빈값 |
| `deposit_type` | text | deposit 67·advance 13·prepayment 6·빈값 11 |
| `deposit_ratio` | numeric | 보증금/선수금 비율(%). 0·20·30 등 |
| `rental_deposit` | bigint | 보증금/선수금 금액(원) |
| `trim_price` | bigint | 차량 기본가(원, 요청 시점 스냅샷) |
| `status` | text | CHECK open/closed/completed. open 94·completed 2·closed 1 |
| `created_at` | timestamptz | 범위 2026-03-05 ~ 06-25 |

### `public.quote_request_options` (옵션 보유 요청 32건)

`id`(bigint) · `quote_request_id`(uuid) · `trim_option_id`(bigint, FK→catalog SET NULL) · `option_name`(text NN) · `option_type`(text CHECK basic/tuning) · `price_at_request`(bigint NN) · `created_at`.

### `public.profiles` (9명)

`id`(uuid, FK→auth.users) · `full_name` · `phone_number`(CHECK `^010[0-9]{8}$` = 정확히 11자리 숫자) · `role`(user_role) · email/username/avatar_url.

- ⚠️ **9명 전부 `phone_number` NULL**. 요청자 3명은 제임스(admin·92건)/김지안(admin·4)/강현준(manager·1) = **테스트 계정**.
- ⚠️ 따라서 **전화 매칭 현재 0건**. 실 유입(앱 회원가입 전화 입력)이 생기면 자동 매칭.

### enum 의미 — Flutter 앱 SSOT 확정 (추측 금지)

`lib/core/utils/purchase_method.dart`, `deposit_type.dart`에서 확인:

- **payment_method**: `lease`=운용리스 · `rent`=장기렌트 · `installment`=할부 · `cash`=일시불
- **deposit_type**: `deposit`=보증금(계약종료 시 반환) · `advance`=선수금(월납입 차감) · `prepayment`=선납금(할부 선납) · 빈값=초기비용/미지정
- **status**(`lib/core/utils/quote_status.dart`, 2026-06 관리자 라벨 통일): `open`=진행중 · `closed`=마감 · `completed`=완료

### 매칭키 / 연결컬럼

- 매칭키: `profiles.phone_number` ↔ `crm.customers.phone`. **양쪽 모두 `010`+8 숫자 11자리로 형식 동일 → 정규화 불필요**.
- `crm.customers.app_user_id`(uuid)·`crm.quotes.source_quote_request_id`(uuid) **이미 존재**(S2/S3용). 현재 `app_user_id` 전부 null.
- `catalog.trims`(+models/brands) join으로 `trim_id`→차량명. 기존 `src/db/queries/vehicles.ts` read 경로와 동일 테이블.

### 실시간 알림 토대 (S1.5 대비, 실측 확인)

- `public.quote_requests`가 **이미 `supabase_realtime` publication에 등록됨**(앱팀이 켜둠) → CRM은 **DB 작업 0**으로 `postgres_changes`(INSERT) 구독 가능.
- RLS 정책 `Users and staff can view relevant quote requests`로 staff/manager/admin은 전체 조회 → 카카오 세션(user_role claim)으로 Realtime 구독 시 INSERT 이벤트 수신.
- CRM 프론트에 supabase 클라이언트(`client/src/lib/supabase.ts`, auth 전용·Realtime 미사용)·Topbar 알림 UI(벨 + "견적" 탭, 현재 mock) 이미 존재.

## 범위

**포함**
- 백엔드 read 쿼리 + `GET /api/quote-requests` 라우트(목록).
- 프론트 사이드메뉴 '앱 요청' + 목록 페이지 + lib 어댑터.
- enum→한글 매핑, 금액 포맷, 전화/`app_user_id` 기반 매칭결과 표시.

**제외(다음 슬라이스)**
- S2 고객 유입(전화매칭 연결·신규 `customers` 생성·`app_user_id` 세팅) = 일체의 **쓰기**.
- S3 견적 승격(요청→워크벤치 prefill→`crm.quotes` INSERT).
- 옵션 상세 펼침/모달(1차는 옵션 **개수**만), 서버사이드 페이지네이션/필터(97건은 클라 충분), status 변경 쓰기, `ai_estimates` 연동.

## 아키텍처 — 읽기 3계층 (검증된 패턴)

catalog/customers-read와 동일. 매핑은 **프론트 어댑터**(백엔드는 DB 도메인 camelCase 반환, lib가 한글/포맷 변환).

### 1. 백엔드 쿼리 `src/db/queries/quote-requests.ts` (신규)

`listQuoteRequests(executor)`:

1. `quote_requests` 목록 + `profiles` join(`full_name`·`phone_number`) — 요청자 정보. `created_at DESC` 정렬.
2. `trim_id` 묶음 → `catalog.trims`+`models`+`brands` join으로 차량명 batch 조회(IN, **N+1 회피**). brand/model/trimName 반환.
3. `quote_request_options`를 `quote_request_id IN (...)` 한 번에 조회 → 메모리 그룹핑(요청별 options[]).
4. 전화 매칭: `profiles.phone_number`로 `crm.customers`(phone) LEFT JOIN하여 매칭 고객(name·customerCode·id)을 동봉. `app_user_id` 직접연결도 함께 확인(우선순위: app_user_id > phone).

- `executor` 일원화(Hyperdrive 호환). public/crm/catalog **3스키마 cross-read**(같은 master DB라 단일 쿼리/연결로 가능).
- ⚠️ cross-schema FK가 없으므로 trim/options는 별도 select 후 메모리 결합(`crm.quotes` 읽기와 동일 방식).

### 2. 라우트 `src/routes/quote-requests.ts` (신규) + `src/app.ts` 마운트

- `GET /api/quote-requests` — 인박스 목록. 기존 auth(JWKS)·db 미들웨어 자동. catalog 라우트 에러 패턴(`run`/`dbErrorMessage`) 재사용.
- (S2/S3에서 같은 라우트 파일에 POST 추가 예정.)

### 3. 프론트 `client/src/lib/quote-requests.ts` (신규) + 목록 페이지 + 사이드메뉴

- `fetchQuoteRequests()`(apiFetch GET — 5xx 재시도 자동) + 어댑터 `toAppQuoteRequest(row)`:
  - `paymentMethod`(lease…)→한글 라벨, `depositType`→한글, `status`→한글.
  - `trimPrice`/`rentalDeposit` 금액 포맷(기존 `price-format.ts` 재사용).
  - `matchResult`: app_user_id 연결 → "연결됨 ○○○" / phone 일치 → "기존 고객 ○○○(추정)" / 그 외 "신규(미연결)".
- 신규 페이지(예 `client/src/pages/AppRequestsPage.tsx`) — 목록 테이블. 사이드메뉴에 '앱 요청' 항목 + 라우트(`/app-requests`) 추가.
- 컬럼: 요청일 · 요청자 · 차량(브랜드·모델·트림) · 구매방식 · 조건(기간·보증금유형/금액) · 옵션 N개 · 상태 · 매칭결과.

## 매핑 표 (DB → UI)

| UI | DB 출처 | 변환 |
|---|---|---|
| 요청일 | `quote_requests.created_at` | 날짜+시간 포맷 |
| 요청자 | `profiles.full_name` | 없으면 "이름없음" |
| 차량 | `catalog` brand+model+trim_name | `[브랜드] [모델] · [트림]` 조합 |
| 구매방식 | `payment_method` | lease→운용리스 등(Flutter SSOT) |
| 기간 | `period` | `60`→"60개월", 빈값→"—" |
| 보증금유형 | `deposit_type` | deposit→보증금 등 |
| 보증금금액 | `rental_deposit` | 금액 포맷, 0/빈값→"—" |
| 차량가 | `trim_price` | 금액 포맷 |
| 옵션 | `quote_request_options` count | "N개"/"없음" |
| 상태 | `status` | open→진행중·closed→마감·completed→완료 |
| 매칭결과 | app_user_id / phone↔customers | "연결/기존고객/신규" |

## enum 라벨 SSOT 위치

- payment_method 한글은 기존 crm 어휘(`PURCHASE_METHOD_OPTIONS`, tech-enum #111)와 **정합**되게(운용리스/장기렌트/할부/일시불). 앱키(lease)→crm 한글 매핑 함수를 `client/src/data/` 또는 `lib/quote-requests.ts`에 둔다(plan에서 위치 1택).
- deposit_type/status 라벨도 동일 위치에 상수화(인라인 리터럴 금지 — 코드 관례).

## 검증

- `bun run typecheck` 0 · `bun run lint` 0 · `bun run build`.
- `test:server`: `GET /api/quote-requests` 200 · 건수(97 또는 시드 기준) · options 동봉 · profiles join 동작. `--env-file=.env.local`.
- `test:unit`: `toAppQuoteRequest` 어댑터(enum 매핑 4종·deposit 3종·매칭 판정 3분기·금액 포맷·null 케이스).
- 브라우저(인증 세션): '앱 요청' 메뉴 → 97건 목록, 차량명/구매방식 한글/매칭결과(현 데이터는 전부 "신규(미연결)") 표시.

## 미결 / 결정 필요

1. **매칭결과 표시 깊이**: app_user_id+phone 2단(추천) vs phone만. 현 데이터로는 어느 쪽이든 전부 "미연결"이지만, S2 대비 2단 권장.
2. **데모 데이터**: profiles 전화가 전부 null이라 매칭이 화면에 전혀 안 뜬다. `profiles`는 앱팀 소유(auth.users FK)라 CRM에서 시드 부적절 → **S1은 현 데이터 그대로 read**(매칭 0 표시 정상), 매칭 시연은 S2(유입) 또는 실 앱 가입 후. spec은 이 전제로 진행.
3. **정렬/기본필터**: created_at DESC 고정(추천). status 필터는 후속.

## 다음 (S1.5/S2/S3)

- **S1.5 실시간 알림 (결정: S1 다음 전담 슬라이스)**: 고객이 앱에서 `quote_requests` INSERT → CRM에 실시간 알림. **방식=Supabase Realtime**(`postgres_changes` INSERT 구독, publication 이미 켜짐 → DB 작업 0, polling 불필요). **표현 범위(결정)**: ①우상단 토스트 ②Topbar 벨 뱃지 카운트 ③인박스 목록 열려있으면 자동 갱신(새 행 prepend). 구현 토대: S1의 `fetchAppQuoteRequests`/`toAppQuoteRequest` 재사용, `client/src/lib/supabase.ts` 클라이언트로 `supabase.channel().on('postgres_changes', {event:'INSERT', schema:'public', table:'quote_requests'})`. 캐비엇: 구독 훅의 연결/재연결/언마운트 정리, RLS는 카카오 세션 staff role로 통과, Topbar 알림 mock→실데이터 wiring. **별도 brainstorming→spec→plan 사이클**.
- S2: 전화매칭 1클릭 연결(`app_user_id` set) + 미매칭 요청 신규 `crm.customers` 생성(완전자동 vs 상담사 1클릭은 S2에서 결정). 쓰기 경로 → `invalidateCustomerDetail` 등 캐시 불변식 적용.
- S3: 요청 행 "견적 작성" → 워크벤치 prefill(차량/구매방식/옵션) → `crm.quotes` INSERT + `source_quote_request_id` 연결.

### ⚠️ S2 customer_code 채번 (읽기→쓰기 전환 참고, `ref/business-code-system.md`)

신규 `crm.customers` 생성 시 `customer_code`는 **`CU-YYMM-####`** (PREFIX=종류, YYMM=고객 생성 월, ####=그달 1부터 4자리 순번). 채번은 견적의 기존 패턴을 그대로 복제:

- `src/db/queries/customer-quotes.ts:186` `nextQuoteCode()`(QT-YYMM- + 그달 max+1, UNIQUE 컬럼 canonical) → **`nextCustomerCode()` 신설**. 동시성은 트랜잭션.
- **결정 포인트**: 승격 시 `CU`의 `YYMM`은 **승격(고객 생성) 시점 월**(체계상 "고객 생성 순번") vs 앱 요청 `created_at` 월. → 승격 시점 권장.
- 출처 표현: 앱 유입은 `CU` 발급 + **`source="앱 견적비교"/"앱 AI상담"/"앱 상담원 연결"`**(이미 존재하는 유입경로 어휘, open-set #110) + `app_user_id` 연결. **`DL` prefix는 디엘오토솔루션 legacy 전용이라 앱 유입에 쓰지 않음**.
- 주의: `CU`(엔티티 종류)와 `source`(유입경로)는 역할이 분리됨 — 경로는 `source` 컬럼이 담당.
