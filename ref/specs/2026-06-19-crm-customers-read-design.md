# CRM 고객 읽기 DB 연결 (1차) 설계

작성일: 2026-06-19
상태: design (승인됨 2026-06-19). 다음 = writing-plans → 구현.
연계: `2026-06-17-crm-customers-schema-design.md`(테이블 설계), `2026-06-17-crm-db-connection-migration-design.md`(인프라 전환, 완료). crm 8테이블은 이미 schema.ts 정의·마이그레이션 적용 완료.

## 목표

`crm.customers`(+자식 테이블)를 **읽어** 고객 목록(`CustomerManagementPage`)과 상세 drawer(`CustomerDetailPage`)를 목업이 아닌 실제 DB로 표시한다. CRM 도메인의 첫 DB 연결 — catalog 도메인과 동일한 3계층(queries→routes→lib) 패턴을 세운다.

## 범위

**포함**: 고객 목록/상세 읽기 경로, 목업 21명 시드, 프론트 API 연결.
**제외(다음 서브프로젝트)**:
- 쓰기 일체(상태/계약가능성/상담메모/니즈 인라인 수정 DB 저장) — 현행 프론트 상태 갱신 유지.
- advisor 이름 표시 — DB는 `advisorId`(uuid, loose FK→public.profiles)뿐이고 목업 이름↔profiles uuid 매핑이 없어 **이번엔 보류**(목록 담당은 "미배정"/team만). 실제 배정·profiles 연동은 쓰기 단계.
- 정산 필드(settlementStatus/fee/cost/margin), Topbar 전역검색(목업 사용), 견적(quotes).

## 아키텍처

catalog 도메인과 동일 구조. 매핑은 **프론트 adapter**(백엔드는 DB 도메인 형태 camelCase 반환, 프론트 `lib/customers.ts`가 기존 `Customer` 타입으로 변환).

### 1. 백엔드 쿼리 `src/db/queries/customers.ts`
- `listCustomers(executor)` — `crm.customers` 목록. 목록의 "상담 메모"(목업 `nextAction`)는 `customer_tasks`의 최신 미완료 1건을 LEFT JOIN LATERAL로 동봉. `executor` 일원화(Hyperdrive 호환).
- `getCustomer(id, executor)` — 상세 1건 + 자식(tasks/schedules/memos/documents/consultations) 묶음. drawer용.

### 2. 라우트 `src/routes/customers.ts` (+ `src/app.ts` 마운트)
- `GET /api/customers` — 목록.
- `GET /api/customers/:id` — 상세(없으면 404).
- 기존 auth(JWKS 게이트)·db 미들웨어 자동 적용. catalog의 zValidator(`z.object({ id })`)·에러 패턴 재사용.

### 3. 시드 `scripts/seed-customers.ts` (bun 실행, 멱등)
- `client/src/data/customers.ts`의 21명 → `crm.customers` insert. `customerCode` unique → `onConflictDoNothing`.
- 분해: `vehicle→needModel`, `method→needMethod`, `nextAction→customer_tasks` 1건(미완료).
- `customerType/customerTypeDetail/phone/team/source/statusGroup/status/priority/aiSummary`는 직접 매핑.
- 날짜: `receivedAt`은 목업 절대값("2026-05-14 12:56") 그대로. `"오늘/어제"` 상대 표현(assignedAt/date)은 시드 기준일 기반 절대 timestamp로 변환.
- `advisorId`는 null(loose), `team`만 시드.

### 4. 프론트 `client/src/lib/customers.ts` + `CustomerManagementPage`
- `fetchCustomers()`/`fetchCustomer(id)` (apiFetch GET — 5xx 재시도 자동).
- DB 응답 → 기존 `Customer` 타입 매핑 adapter(`no`는 표시 제거됨이라 무시 가능, advisor "미배정" 폴백).
- `CustomerManagementPage`: `initialCustomers`(목업) → API 로드. 로딩/에러 상태 추가. 리스트 UI·인라인 컨트롤은 현행 유지(저장은 프론트 상태만).

## 매핑 표 (목업 Customer ↔ DB)

| 목업 필드 | DB 소스 | 비고 |
|---|---|---|
| customerId | customers.customerCode | |
| name/phone/team/source/priority/aiSummary | 동명 컬럼 | |
| customerType/customerTypeDetail | 동명 | |
| statusGroup/status | 동명 | |
| receivedAt | customers.received_at | 절대값 |
| assignedAt | customers.assigned_at | 상대→절대 변환 |
| date(최종업데이트) | customers.last_activity_at | |
| vehicle | customers.need_model | |
| method | customers.need_method | |
| nextAction(상담메모) | customer_tasks 최신 미완료 1건 body | LEFT JOIN LATERAL |
| advisor | (보류) | advisorId만, 표시 "미배정" |
| no | — | 표시 제거됨, 무시 |
| talkCount | — | 자동화 전 제거됨 |
| settlementStatus/fee/cost/margin | — | 정산, 범위 외 |

## 검증

- typecheck 0 · lint 0 · build · test:unit(현행 99 유지).
- `test:server`에 customers 라우트 테스트 추가(목록 200·건수, 상세 200/404). `--env-file=.env.local`.
- 시드 실행 후 목록 21명 표시·상세 drawer(김민준) DB 데이터로 표시 확인.

## 미결 (다음 서브프로젝트)

- 고객 쓰기(상태/메모/니즈 PATCH) + advisor 배정·profiles 연동.
- Topbar 전역검색 DB 연결, 정산 도메인, 견적(quotes) 읽기/쓰기.
- 페이지네이션/필터를 서버사이드로(현재 클라이언트). 21명 규모는 클라이언트로 충분, 데이터 증가 시 전환.
