# Phase ① GO 패키지 + 공동 검증 (CRM ↔ 앱 팀)

작성일: 2026-06-17
상태: **조건부 GO의 조건(B = PostgREST embedding) 실측 통과 → view-only로 GO. 앱 팀 Phase ① 마이그레이션 작성 진행 가능.**
성격: master 통합 Phase ① 적용을 위한 GO 신호 + 적용 후 공동 검증 체크리스트 + catalog adopt 조건.
연계: `2026-06-16-master-supabase-integration.md`(아키텍처 결정), `2026-06-16-vehicle-admin-handoff.md`(Phase ① 9종 상세).

## 배경

master 통합 A안(CRM 설계 먼저). Phase ① 9종은 앱 팀 작성 대기 상태였고, CRM 설계 관점에서 9종에 누락·충돌이 없는지 점검 + 적용→검증→catalog adopt 순서를 확정해 앱 팀을 unblock하는 것이 목표. 이 문서가 통과하면 그대로 앱 팀 GO 신호 + 양 팀 공동 검증 기준이 된다.

## A. GO 판정 — 9종 정합성 점검 결과

CRM 설계가 의존하는 산출물이 9종에 전부 포함됨을 확인:
- 차량 콘솔(B3) 의존: `assign_trim_codes`·`batch_update_sort_order` RPC + 코드/단종/status/표기법 트리거 ✓
- 인증(B4) 의존: `provision_staff_role` RPC ✓
- 차량 read 전환(B1)·introspect(B2) 의존: catalog SET SCHEMA + public 호환 view ✓

→ **추가 요구 없음. 조건부 GO** (조건 = 아래 B 해소).

## B. PostgREST embedding 리스크 + 실측 결과

### 리스크 (메커니즘)
Phase ①에서 차량 테이블이 `public` 호환 view로 바뀌면, FK는 `catalog` 실테이블을 가리키고 view 자체엔 FK가 없다. PostgREST는 FK로 embedding 관계를 추론하므로, 앱의 nested `.select()`가 깨질 수 있다. PostgREST는 v9+에서 view의 base table FK를 추적해 관계를 노출하는 기능이 있으나, **multi-level view→view→view + cross-schema 조합은 회색지대** → 이론 신뢰가 아니라 실측 필요.

### 영향 범위 (앱의 nested select 전부)
- `quote_requests → trims → models → brands` (CRM 확인: `supabase_quote_repository.dart`)
- 차량 선택 `brands → models → trims`
- `ai_estimates`의 차량 참조
- 어드민 `getAllTrimsWithColors`의 `trims → colors(...)`

### 실측 결과 (2026-06-17, 영실)
Supabase 브랜치에 catalog + 호환 view를 minimal하게 만들고 앱의 실제 embedding 쿼리를 브랜치 REST로 실행 → **정상 동작 확인.** `quote_requests→trims→models→brands` nested select 통과, V7(cross-schema FK 승계)도 확인.

→ **view-only로 충분. computed relationship(완화 #2) 불필요. B 조건 해소.**

### 완화 사다리 (실측 실패 시 대비책 — 현재 미사용, 회귀 대비 보존)
1. **[채택]** view를 단순 `SELECT *`로 유지(컬럼 alias/변형 금지) → PostgREST가 base FK 추적 성공.
2. (미사용) 경로별 PostgREST computed relationship 함수 추가(`public.trims(public.quote_requests)` 같은 SETOF 함수 = 명시적 관계).
3. (미사용·최후) catalog 선택적 노출 or 해당 체인 테이블 public 잔류 재검토(앱 변경 0 전제 일부 양보).

> ⚠️ **회귀 트리거**: 향후 호환 view에 컬럼 alias/변형/조인이 들어가면 base-FK 추적이 깨질 수 있다. 그때 #2를 다시 꺼낸다. **view는 단순 `SELECT *` 불변식 유지가 GO의 숨은 전제.**

## C. 적용 순서 (앱 팀, 단일 트랜잭션 권장)

`CREATE SCHEMA catalog` → 9테이블 `SET SCHEMA`(FK 자동 승계) → 트리거 함수 12개 이동 + 본문 재한정(`public.*`→`catalog.*`) → public 호환 view(`security_invoker`) + grant → RPC 3종(provision/assign/batch) → 단종·status·표기법 트리거 → 타입 재생성. **catalog PostgREST 비노출 유지.**

## D. 적용 후 공동 검증 체크리스트 (← 전부 통과해야 catalog adopt GO)

| # | 검증 | 주체 | 통과 기준 |
|---|---|---|---|
| V1 | 앱 차량 read (라인업·견적 화면) | 앱 | 정상 표시 |
| V2 | 앱 embedding 조인 (영향 4체인: quote_requests→trims→models→brands / 차량선택 / ai_estimates / 어드민 trims→colors) | 앱 | view 전환 후 조인 정상 (B 실측의 풀 재현) |
| V3 | CRM catalog 직접 read (secret 직결) | CRM | `catalog.trims` 등 SELECT |
| V4 | 트리거 — mc_code 자동(trim_code UPDATE) | CRM(write) + 앱(케이스) | mc_code 생성 |
| V5 | 트리거 — 단종 cascade(블라인드 보존) | CRM(write) + 앱(케이스) | 모델 단종→트림 단종, 블라인드 유지 |
| V6 | 트리거 — 표기법 백스톱 | CRM(write) + 앱(케이스) | 국산 trim_name ` - ` 없으면 거부 |
| V7 | FK cross-schema 승계 | 앱/CRM | `quote_requests.trim_id`→`catalog.trims` FK 유효(SET SCHEMA OID 보존) |
| V8 | `provision_staff_role` RPC | CRM | role 부여 + `role_audit` 기록 |

### 역할 분담
- **앱 팀(영실):** Phase ① 9종 마이그레이션 작성 + **V4/V5/V6 트리거 테스트 케이스 동봉**(mc_code 생성·블라인드 보존·`-` 거부 각 1) + view 제약(단순 `SELECT *`) 준수 + data-clone 리허설 + 단일 tx 적용 + 앱 측 V1/V2/V7 확인.
- **CRM(우리):** V3(catalog 직결 read) + V8(provision_staff_role 호출) + catalog write 주체로서 V4~V6 발동 확인 + V1~V8 통과 후 catalog adopt(introspect baseline).

## E. 롤백

Phase ①은 전부 DDL(`SET SCHEMA`·`CREATE VIEW`·함수·트리거)이라 `CONCURRENTLY` 같은 비-tx 작업이 없음 → **단일 트랜잭션 적용 가능**(실패 시 자동 원복). **PITR 백업 병행.**

## F. catalog introspect baseline 타이밍

V1~V8 전부 통과 후 → CRM `db:pull` introspect → drizzle adopt(`schemaFilter ["catalog","crm"]`). 그 전엔 baseline 잡지 않음.

## 검증 방법론 제약 (중요)

- **전체 Phase ① 사전검증(V1~V8 풀 리허설)은 data-clone 브랜치에서.** fresh 브랜치는 엑셀 import 차량 데이터가 없어 재생 실패(이번 B 실측은 minimal view 단위라 가능했음).
- **브랜치 PostgREST 버전 = prod 동일** 확인이 실측 유효성의 전제(view-base-FK 추론은 버전 의존).

## 상태 / 다음

- ✅ B 실측 통과(view-only) → 조건 해소.
- ✅ **2026-06-17 검증 완료**: PR #386(9종 단일 tx) CRM 정합 리뷰 통과 + **prod BEGIN…ROLLBACK 리허설로 V4/V5/V6·status·assign·V8·grant(anon read / admin write) 전부 통과**(실데이터, 영구변경 0) + V2(브랜치)·V7 + **catalog 비노출 prod 점검 확정**(exposed = public/graphql_public). → **적용 GO 완전 확정.**
- ⏳ 앱 팀: PR #386 머지 + prod migrate → 적용 후 V1/V3 + 타입 재생성.
- ⏳ CRM: 적용 알림 → catalog adopt(introspect baseline) → A2 전환. ⓐ `crm.quotes` 설계 완료.
