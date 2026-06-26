# CRM enum/lookup 열린 집합 — source/category/type 설계

- 날짜: 2026-06-26
- 상태: 설계 합의 (구현 전)
- 슬라이스: enum/lookup 가로 확장(🅰) — 열린 집합 3종(유입경로·할일분류·일정종류)

## 배경 / 동기

이사님 제품 결정으로 열린 집합 어휘를 정식 목록(lookup)으로 굳힌다. 결정 결과:
- **관리 화면(CRUD UI): 안 만듦** — lookup은 백엔드 검증 + 코드/시드 관리(파일럿과 동일 정신).
- 어휘는 **현행 운영 코드 목록** 기준(이사님 즉석 목록이 아니라 실제 운영값).
- **team은 이번 제외** — PATCH 쓰기 경로·재배정 UI가 없어 성격이 달라 별도 슬라이스.

3종 모두 닫힌 입력 UI라 chance·doctype 패턴(상수 SSOT 이동 + 시드 + `validateLookupValue`)을
적용한다. 단 source는 "기타" 자유입력이 살아있어 닫힌화 작업이 추가된다.

## 핵심 결정

1. **범위 = source · tasks.category · schedules.type** (team 제외).
2. **현행 코드 옵션 그대로** lookup화(옵션 교체 없음) → 기존 데이터·기본값 충돌 0.
3. **source "기타" 자유입력 제거** → 완전 닫힌화(검증 가능). 자동/수동 표시는 코드 유지.
4. `validateLookupValue`(chance 도입) 재사용, 마이그레이션 없음(lookup_values 재사용).

### ⚠️ 리뷰 확인 포인트
- **source 옵션 = 현행 13종**(자동 5 + 수동 8, `재구매/검색/기타` 포함). 이사님 문서의
  10종과 다름 — category/type처럼 현행 코드 기준. 리뷰에서 확정.

## 현행 옵션 (그대로 시드)

- **source** (`kim-status-fields.ts`): 자동 `앱 견적비교·앱 AI상담·앱 상담원 연결·디엘(상담)·디엘(견적서)` + 수동 `대표전화·카카오·소개·추천·재구매·유튜브·검색·기타` = 13종
- **tasks.category** (`kimCheckCategoryOptions`): `체크·견적·안내·요청·내부·심사` = 6종
- **schedules.type** (`kimScheduleTypeOptions`): `재연락·결정확인·체크·견적·안내·요청·내부·심사` = 8종

## 설계

### 1. 옵션 상수 SSOT 이동

`client/src/data/customers.ts`에 추가(현행 값 그대로):
- `SOURCE_OPTIONS`(13종) — `kim-status-fields.ts`가 이걸 import해서 자동/수동 분리에 사용
  (자동/수동 구분 상수 `SOURCE_AUTOMATIC_OPTIONS`도 data로 옮겨 SSOT 단일화).
- `TASK_CATEGORY_OPTIONS`(6종) — `CustomerDetailPage`의 `kimCheckCategoryOptions` 대체.
- `SCHEDULE_TYPE_OPTIONS`(8종) — `kimScheduleTypeOptions` 대체.

### 2. source "기타" 자유입력 제거

- `kim-status-fields.ts`의 source custom 분기(`{ selected: "기타", custom: value }`,
  `allOptions.includes` 폴백)를 제거 → 항상 닫힌 선택으로 정규화.
- `CustomerDetailPage`의 source 편집 렌더에서 "기타" 선택 시 자유 textarea/input을 제거,
  13종 선택만 가능하게. (자동/수동 그룹 표시는 유지.)

### 3. seed

`scripts/seed-lookups.ts`에 3카테고리 추가:
- `category="source"`(13종), `="task_category"`(6종), `="schedule_type"`(8종)
- 입력 = data 상수(`SOURCE_OPTIONS`·`TASK_CATEGORY_OPTIONS`·`SCHEDULE_TYPE_OPTIONS`).
- 멱등 delete 카테고리 목록에 3개 추가.

### 4. 검증 (`validateLookupValue` 재사용)

- **source**: `customers` PATCH에 source 키가 올 때 `validateLookupValue("source", …)`.
- **category**: task POST·PATCH에 category 키가 올 때 `validateLookupValue("task_category", …)`.
- **type**: schedule POST·PATCH에 type 키가 올 때 `validateLookupValue("schedule_type", …)`.
- 전부 null이면 통과(왕복 0). 자동분류·현행 옵션은 목록과 일치라 통과, 잘못된 값만 400.

## SSOT 전략 / Caveat

검증 SSOT = DB lookup. data 상수 = 시드 입력 + 프론트 옵션(UI). 일치는 시드가 그 상수에서
생성됨으로 보장. 상수 변경 시 `seed:lookups` 재실행. (관리 UI 없으니 어휘 변경은 코드/시드.)

## perf

각 검증은 해당 키가 올 때만 1쿼리. 없으면 왕복 0. 진행상태/chance/doc_type 검증과 독립.

## 검증 계획

- `bun run typecheck` 0 · `bun run lint` 0.
- 서버 테스트: source/category/type 라운드트립 — 유효값 200, 없는값 400, null 통과.
- `bun run test:unit`(상수 이동·source UI 변경 동작 확인) · `bun run build`.
- 시드 멱등(source 13 + task_category 6 + schedule_type 8 = 27행 추가, 총 93행, 2회 동일).

## 파일 변경 목록(예정)

- `client/src/data/customers.ts` — `SOURCE_OPTIONS`·`SOURCE_AUTOMATIC_OPTIONS`·`TASK_CATEGORY_OPTIONS`·`SCHEDULE_TYPE_OPTIONS` export.
- `client/src/lib/kim-status-fields.ts` — source 상수 import 전환 + "기타" custom 제거.
- `client/src/pages/CustomerDetailPage.tsx` — category/type 로컬 상수 → import, source 편집 "기타" 자유입력 제거.
- `scripts/seed-lookups.ts` — source/task_category/schedule_type 시드.
- `src/routes/customers.ts` — customers PATCH source + task/schedule POST·PATCH 검증.
- `src/routes/customers.test.ts` — 3종 라운드트립 테스트.

## 관례 준수

- 브랜치 → PR → squash 머지. 커밋 메시지에 skip-ci 토큰 금지.
- `any` 금지. 마이그레이션 없음(lookup_values 재사용).
