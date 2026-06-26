# CRM enum/lookup 가로 확장 — chance 슬라이스 설계

- 날짜: 2026-06-26
- 상태: 설계 합의 (구현 전)
- 슬라이스: enum/lookup 가로 확장(🅰)의 첫 도메인 = **chance(계약 가능성)**

## 배경 / 동기

진행상태 파일럿(#107)이 `crm.lookup_values` 단일 테이블 + 검증 인프라를 깔았다.
다음은 가로 확장 — 나머지 업무어휘 도메인을 같은 패턴으로 lookup화한다. 도메인을
훑어보니 성격이 갈린다:

- **닫힌 집합**(값이 고정, 검증 가치 명확): `chance`, `priority`
- **열린 집합**(상담사가 새 값 자유 추가): `source`, `team`, `tasks.category`, `schedules.type`
- **특수**: `doc_type`(#69 title 중복), `consultations.channel`(테이블 미사용)

열린 집합은 정식 어휘가 미정의(시드는 자유 텍스트 샘플)라 어휘 결정(제품 영역)이
선행이다. 그래서 이번 슬라이스는 **닫힌 집합 중 가장 깨끗한 `chance` 하나**만 한다.

## 핵심 결정

1. **범위 = `chance` 하나.** `CHANCE_OPTIONS`(`["높음","중간","낮음","보류","확정"]`)
   닫힌 집합, `customers.chance`는 PATCH 쓰기 컬럼(`customerWriteSchema`에 존재), 종속 없음.
   진행상태보다 단순한 깨끗한 복제.
2. **마이그레이션 0.** 기존 `crm.lookup_values` 재사용, `category="chance"` 행만 추가.
3. **범용 검증 함수 도입.** 종속 없는 닫힌 집합용 `validateLookupValue(category, value)` —
   chance에 적용 + 미래 닫힌 도메인(source/team 등) 재사용. 진행상태 종속 검증
   `validateStatusSelection`은 별개로 유지.
4. **"확정"↔계약완료 종속은 검증 안 함.** `statusGroup="계약완료"→chance="확정"`은
   `updateCustomerWorkflow`의 워크플로우 규칙이라 그대로 두고, lookup 검증은 chance 값
   유효성만 본다.

## priority — 비범위 (문서화)

`priority`(`긴급/높음/중간/낮음/보류/완료`)는 **레거시 목업 필드**다:
- PATCH 쓰기 경로 없음(`customerWriteSchema`/`CustomerWritePatch`에 `priority` 없음).
- `client/src/lib/customer-table.ts` `chanceLabel`(deriveChance)의 폴백 입력으로만 쓰임.
- 건드리면 chance 파생 로직이 회귀할 위험. → 이번 슬라이스에서 손대지 않는다.

후속 정리(레거시 제거 여부)는 chance 프론트 소비 전환 또는 enum 트랙에서 별도 판단.

## 설계

### 1. 데이터 — 마이그레이션 0

기존 `crm.lookup_values` 테이블 재사용. `category="chance"` 행 5개:
`value ∈ CHANCE_OPTIONS`, `parent_value=null`(종속 없음), `sort_order`=선언순, `active=true`.
**새 테이블/컬럼/마이그레이션 없음.**

### 2. 시드

`scripts/seed-lookups.ts`에 chance 카테고리 추가:
- 입력 = `client/src/data/customers.ts`의 `CHANCE_OPTIONS`(import).
- 생성 = `category="chance"` 5행(value=옵션, parentValue=null, sortOrder=인덱스).
- **멱등**: delete 카테고리 목록에 `"chance"` 포함(기존 `status_group`/`status`와 함께).

### 3. 검증 — `validateLookupValue` (범용)

`src/db/queries/lookups.ts`에 추가:

```ts
// 종속 없는 닫힌 집합 도메인의 단일 값 검증. value null → 통과(왕복 0).
// (category, value, active) 1행이 있으면 OK, 없으면 에러 메시지(400 본문).
export async function validateLookupValue(
  category: string,
  value: string | null | undefined,
  executor: Executor = getDefaultDb(),
): Promise<string | null>
```
- `WHERE category=$1 AND value=$2 AND active` 1행 조회(존재 여부만) → value 올 때만 1쿼리.
- chance에 적용 + 미래 닫힌 도메인 재사용.
- 진행상태 `validateStatusSelection`(종속)은 별개로 유지.

### 4. 라우트 — `customers` PATCH

`src/routes/customers.ts` PATCH 핸들러에 chance 검증 추가:
- body에 `chance` 키가 있을 때만 `validateLookupValue("chance", patch.chance, c.var.db)`.
- 위반 시 400. (진행상태 검증과 나란히, 둘 다 조건부.)

## SSOT 전략 / Caveat

진행상태 파일럿과 동일: 검증 SSOT = DB lookup, 프론트 `CHANCE_OPTIONS` 상수는 이번엔
유지(시드 입력). 일치는 시드가 그 상수에서 생성됨으로 보장. 상수 변경 시 `seed:lookups`
재실행 필수. 프론트를 `/api/lookups` 동적 소비로 전환하면 이원성 해소(후속 🅱).

## perf

chance 키가 올 때만 1쿼리(`category+value` 인덱스, 1행 존재 확인). 없으면 왕복 0.
진행상태 검증과 독립(둘 다 조건부).

## 검증 계획

- `bun run typecheck` 0 · `bun run lint` 0.
- 서버 테스트: chance 라운드트립 — 유효 chance PATCH 200, 없는 chance 값 400,
  chance=null 통과 200, chance 키 없는 PATCH는 검증 건너뜀 200.
- `bun run test:unit`(client 무변경) · `bun run build`. 시드 멱등(chance 5행 추가, 2회 동일).

## 파일 변경 목록(예정)

- `scripts/seed-lookups.ts` — chance 카테고리 추가.
- `src/db/queries/lookups.ts` — `validateLookupValue` 추가.
- `src/routes/customers.ts` — PATCH에 chance 검증 연결.
- `src/routes/customers.test.ts` — chance 라운드트립 테스트.

## 관례 준수

- 브랜치 → PR → squash 머지. 커밋 메시지에 skip-ci 토큰 금지.
- `any` 금지. 마이그레이션 없음(테이블 재사용).
