# CRM 고객 자식 CRUD 쓰기 (고객 쓰기 #2) 설계

작성일: 2026-06-19
상태: design (승인됨 2026-06-19). 다음 = writing-plans → 구현.
연계: 본체 쓰기 `2026-06-19-crm-customer-write-fields-design.md`(#1, #54 머지). 읽기 `…read-design.md`(#51). "고객 쓰기"의 두 번째 서브프로젝트.

## 목표

김민준 상세의 **고객 메모 / 해야 할 일(할일) / 예정 일정** 추가·수정·삭제·완료토글을 DB에 저장한다. 현재는 전부 프론트 `useState`로만 바뀌고(새 항목은 임시 id) 새로고침하면 사라진다. 본체 쓰기(#1) 위에 자식 컬렉션 CRUD를 완성한다.

## 범위

**포함**: `customer_memos`·`customer_tasks`·`customer_schedules` CRUD(추가/수정/삭제) + 할일·일정 완료토글. `customer_schedules.done` 컬럼 신설(완료 저장).
**제외(다음)**: 서류(#3, 파일 업로드)·견적(#4)·advisor 배정(#5). enum/lookup 제약(별도). 비컬럼 본체 필드(계약기간 등, #1 캐비엇).

## 현재 구조 (조사 결과)

- 핸들러(모두 `useState`만, API 0): 메모 `saveCustomerMemo`(3158)/`updateCustomerMemo`(3175)/`deleteCustomerMemo`(3189); 할일 `saveCheckItem`/`updateCheckItem`/`deleteCheckItem`/`toggleCheckItem`; 일정 `saveSchedule`/`updateSchedule`/`deleteSchedule`/`toggleScheduleComplete`.
- 새 항목 임시 id: `kim-customer-memo-${Date.now()}` 등(프론트 생성). DB 저장 시 서버 uuid로 교체 필요.
- 완료 추적: 할일 `completedCheckItems`(=item.id 배열), 일정 `completedScheduleKeys`(`scheduleRecordKey(item)` = **item.id** 반환 → 사실상 id 배열). → 둘 다 id 기반, 토글=PATCH done.
- 스키마: `customer_tasks`에 `done` 있음(읽기 때 `completedCheckItems` 시드됨, #51). **`customer_schedules`엔 done 없음** → 신설. `customer_memos`는 done 불필요.
- 읽기: `getCustomer`가 자식 `select * `이라 마이그레이션 후 `done` 자동 포함.

## 아키텍처

### 1. 마이그레이션 — `customer_schedules.done`
`src/db/schema.ts`의 `customerSchedules`에 `done: boolean("done").default(false).notNull()` 추가 → `bun run db:generate`(schemaFilter crm) → `drizzle/0002_*.sql` → `bun run db:migrate`. (master crm 스키마만, public·catalog 불가침.)

### 2. 백엔드 query `src/db/queries/customer-children.ts` (신규)
엔티티 read(`customers.ts`)와 분리. 9개 함수, `executor` 일원화:
- `addMemo(customerId, {body}, ex)` → `{id, createdAt}` ; `updateMemo(customerId, id, {body}, ex)` → `{id}|null` ; `deleteMemo(customerId, id, ex)` → `{id}|null`.
- `addTask(customerId, {category, due, body}, ex)` → `{id, createdAt}` ; `updateTask(customerId, id, {category?, due?, body?, done?}, ex)` → `{id}|null` ; `deleteTask(...)`.
- `addSchedule(customerId, {scheduledDate, scheduledTime, type, memo}, ex)` → `{id, createdAt}` ; `updateSchedule(customerId, id, {scheduledDate?, scheduledTime?, type?, memo?, done?}, ex)` → `{id}|null` ; `deleteSchedule(...)`.
- update/delete의 where는 **`id = childId AND customer_id = customerId`**(타 고객 자식 보호). add는 삽입행 `{id, createdAt}` 반환(임시 id 교체용).

### 3. 라우트 `src/routes/customers.ts` (+9)
`PATCH /:id` 아래에 추가:
- `POST /:id/memos` · `PATCH /:id/memos/:childId` · `DELETE /:id/memos/:childId`
- `POST /:id/tasks` · `PATCH /:id/tasks/:childId` · `DELETE /:id/tasks/:childId`
- `POST /:id/schedules` · `PATCH /:id/schedules/:childId` · `DELETE /:id/schedules/:childId`
- `zValidator("param", {id, childId} uuid)` + `zValidator("json", …)`. zod 본문: memo `{body}`, task `{category, due, body, done?}`, schedule `{scheduledDate, scheduledTime, type, memo, done?}`(POST), PATCH는 각 `.partial()`. POST 201(`{id, createdAt}`), PATCH/DELETE 200/404.

### 4. 프론트 lib `client/src/lib/customer-children.ts` (신규)
백엔드 9개와 1:1. `apiFetch`(쓰기=재시도 없음). add는 `{id, createdAt}` 반환, update/delete는 `void`(실패 시 throw). 시그니처에 customerId 포함(중첩 URL).

### 5. 와이어링 (낙관 갱신 + 실패 롤백) — Kim 핸들러 ~12개
공통: `customer.id` 없으면 PATCH/POST 생략(낙관만). 실패 시 롤백 + `onToast("저장에 실패했습니다")`.
- **추가**: 임시 id로 낙관 추가 → `add*(customer.id, …)` → 성공 시 **임시 id를 서버 uuid로 교체**(메모는 `createdAt`도 `formatActivity(res.createdAt)`로) / 실패 시 그 임시 항목 제거.
- **수정**: 직전값 캡처 → 낙관 setState → `update*` → 실패 시 롤백.
- **삭제**: 직전 목록 캡처 → 낙관 제거 → `delete*` → 실패 시 복원.
- **완료토글**: 직전 완료배열 캡처 → 낙관 토글 → `updateTask/Schedule(…, {done})` → 실패 시 롤백.
- **읽기 보강**: `lib.CustomerDetailSchedule`에 `done: boolean` 추가(어댑터 passthrough) + Kim `completedScheduleKeys` 초기값 = `detail.schedules.filter((s) => s.done).map((s) => s.id)`(할일이 #51에서 한 것과 동일 패턴).

## 검증

- `typecheck 0 · lint 0 · build`. `test:unit` 유지.
- `test:server`(`customers.test.ts` 확장): 각 자식 **POST→PATCH→DELETE 라운드트립**(생성 행을 DELETE로 정리해 prod 보존) + 404(없는 childId). `--env-file=.env.local`.
- 마이그레이션: `db:generate`로 `0002` 1파일(schedules.done ADD COLUMN)만 생성 확인 후 `db:migrate`. 적용 후 `getCustomer`에 done 포함 확인.
- 수동(로그인 세션): 메모/할일/일정 추가·수정·삭제, 할일·일정 완료토글 → 새로고침 유지. 추가 직후 임시 id가 서버 uuid로 교체돼 바로 수정·삭제·완료가 동작(임시 id로 PATCH 안 감).

## 미결 (다음 서브프로젝트)
- #3 서류(파일 업로드·스토리지), #4 견적(quotes), #5 advisor 배정·profiles. enum/lookup 도메인(별도 설계).
