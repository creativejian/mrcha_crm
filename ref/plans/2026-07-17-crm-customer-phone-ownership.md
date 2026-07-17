# 고객 전화번호 소유권 분리 — 구현 계획 (2026-07-17)

spec = `ref/specs/2026-07-17-crm-customer-phone-ownership-design.md` (결정 9개·마이그·범위 밖 박제).
브랜치 `feat/crm-phone-ownership`. 진행 상태는 이 문서 최상단에 갱신한다.

## 진행 상태

- [ ] T1 순수 전이 헬퍼(TDD)
- [ ] T2 스키마+마이그 0034(실 DB 적용)
- [ ] T3 서버 읽기 합성 + 쓰기 게이트 + 정규화
- [ ] T4 link SSOT 통합 + 승격 phone 복사 제거
- [ ] T5 클라(상세 잠금·추가 연락처·목록 병기·검색·매칭 제외)
- [ ] T6 전체 검증 + PR

## T1 — 순수 전이 헬퍼 (src/lib/customer-phone.ts, TDD)

```
normalizePhoneDigits(raw: string | null | undefined): string | null  // 숫자만, 빈 결과 null
resolvePhoneOnLink(input: { currentPhone; currentSecondary; appPhone }): {
  phone: null; phoneSecondary: string | null; droppedPhone: string | null }
```

규칙(spec §3-4): 같으면 버림 / 다르면 secondary 이동(빈 경우) / secondary가 같은 값이면 버림 /
secondary 점유+다른 값이면 droppedPhone 반환 / currentPhone null이면 no-op. 비교는 정규화 후.
테스트 = `src/lib/customer-phone.test.ts`(순수 — DB 없음). RED 실관찰 후 GREEN.

## T2 — 스키마 + 마이그 0034

- `schema.ts` customers: `phoneSecondary: text("phone_secondary")` + CHECK
  `customers_phone_app_exclusive_check` = `app_user_id IS NULL OR phone IS NULL`.
- `bun run db:generate` 후 마이그 파일에 **CHECK 이전에 백필 UPDATE 수동 삽입**:
  `UPDATE "crm"."customers" SET "phone" = NULL WHERE "app_user_id" IS NOT NULL AND "phone" IS NOT NULL;`
- `bun run db:migrate`(schemaFilter crm — 실 master 적용). psql로 컬럼·CHECK·제임스 phone NULL 실측.

## T3 — 서버 읽기 합성 + 쓰기 게이트 + 정규화

- `db/queries/customers.ts`: `listCustomers`/`getCustomer`에 `public.profiles` LEFT JOIN
  (`eq(customers.appUserId, profiles.id)`), select에서 `phone: coalesce(profiles.phone_number, customers.phone)`
  로 오버라이드(getTableColumns spread 뒤 키 재정의). `phoneSecondary`는 spread에 자동 포함.
- `routes/customers.ts`:
  - `customerWriteSchema`·`customerCreateSchema`의 phone류 zod transform(숫자만·빈 결과 null) + `phoneSecondary` 추가.
  - PATCH: `patch.phone !== undefined`면 `getCustomerAppUserId` 조회 → appUserId 있으면 409
    `"앱 등록 번호는 수정할 수 없습니다."` (phoneSecondary는 게이트 없음).
- `CustomerWritePatch`(쿼리 모듈)에 `phoneSecondary` 추가.
- 테스트: 409 게이트 / secondary 왕복 / 정규화(하이픈 입력→digits 저장) / GET 합성
  (미연결 profile id를 실 DB에서 조회해 픽스처에 연결 — `not in (select app_user_id …)`).
  픽스처 접두사는 기존 `CU-ROUTE-` 재사용(registry 기등록).

## T4 — link SSOT 통합 + 승격 복사 제거

- `db/queries/app-user-link.ts`: `applyAppUserLink(userId, customerId, ex)` 신설 —
  가드(assertAppUserLinkable) → profiles.phone_number 조회 → T1 전이 계산 →
  `UPDATE customers SET app_user_id, phone=NULL, phone_secondary, updated_at` →
  `{ id, customerCode, name, appUserId, droppedPhone }` 반환.
- `linkRequestToCustomer`·`linkConsultationToCustomer`가 이걸 공유(0713 감사가 지적한
  비대칭 — 견적요청은 phone 불변/상담은 빈 칸 보강 — 자연 해소). 상담 link의 보강 로직 삭제.
- `createCustomerFromRequest`: `phone: profile?.phoneNumber ?? null` → `phone: null`.
- `createCustomerFromConsultation`: 폼 우선 라인 삭제 → `phone: null`(주석 갱신 — 표시는 read-through).
- 라우트 응답에 `droppedPhone` 동봉(양 인박스 링크 응답).
- 기존 테스트 중 "phone 채움/보강"을 단언하는 것들 → 새 계약으로 갱신(RED 확인 후).

## T5 — 클라

- `lib/customers.ts`: `CustomerRow`·`CustomerDetailData`에 `phoneSecondary` / `toCustomer` 매핑 /
  `CustomerWritePatch`에 `phoneSecondary`.
- `data/customers.ts` Customer 타입에 `phoneSecondary?`.
- 상세: `types.ts` StatusFieldKey에 `"phoneSecondary"` · `status-meta.ts` 행 추가(라벨 "추가 연락처") ·
  `useCustomerWorkflow` statusValues 초기값+저장(`savePatch({ phoneSecondary })`) ·
  `openStatusEditor`에서 phone && appUserId → 토스트 차단(자동 접수 경로와 동일 문법) ·
  StatusWorkflow의 PhoneStatusInput 분기에 phoneSecondary 포함.
- 목록: 고객 셀 연락처 줄 병기(`주 · 추가`) + `CustomerManagementPage.tsx:183` searchable에 secondary.
- `lib/consultation-inbox.ts`: byPhone 인덱스에 `!c.appUserId` 조건(합성 phone이 앱 번호라 제외 필수).
- 유닛: toCustomer 매핑 / 인박스 제외 / 검색 포함.

## T6 — 검증 + PR

typecheck 0 · lint 0 · test:unit · test:server(`bun run test:server`만 — EMBED 게이트) · build ·
잔재 0. PR 본문 🟡 행위 변경: ①승격/연결이 phone을 저장하지 않음(표시는 합성) ②PATCH phone
앱 연결 고객 409 ③목록 연락처가 앱 고객은 앱 번호 표시 ④상담 link 빈 칸 보강 제거.
[skip ci] 금지(squash 전파).

## 함정 메모

- 서버 테스트는 반드시 `bun run test:server`(직접 bun test 금지 — EMBED_ON_WRITE 게이트).
- 픽스처 실채번·이름은 registry(`fixture-codes.ts`) 선등록 확인.
- profiles는 read 전용(#211) — 이번 작업은 read(JOIN)만.
- crm.customers는 알림 트리거 테이블 아님(guard 불필요).
- 클라 phone 저장 핸들러는 010 prefix prepend(8자리 입력) — secondary도 동일 재사용.
