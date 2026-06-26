# CRM enum/lookup 도메인 정리 — 진행상태 파일럿 설계

- 날짜: 2026-06-26
- 상태: 설계 합의 (구현 전)
- 슬라이스: enum/lookup 도메인 정리의 **첫 슬라이스 = 인프라 + 진행상태 파일럿**

## 배경 / 동기

crm 스키마의 업무 어휘는 현재 전부 `text` 컬럼이라 검증이 없다. 특히 진행상태는
`customers.status_group`(1차) → `customers.status`(2차) **종속 관계**가 있는데, DB는
아무 문자열이나 받는다. 종속·유효성의 진실원본은 프론트 상수
`client/src/data/customers.ts`의 `customerStatusGroups`(9개 그룹 × 2~5개 2차) 하나뿐이고,
백엔드/DB는 이를 강제하지 못한다.

이 슬라이스는 업무 어휘를 DB lookup 테이블로 옮기는 패턴을, 가장 복잡한(종속 있는)
진행상태 하나로 먼저 검증한다. 패턴이 검증되면 나머지 8개+ 도메인은 복제로 확장한다.

## 핵심 결정

1. **lookup 테이블만, 관리 UI는 후속.** 업무 어휘를 DB로 옮겨 종속·검증을 DB 기반으로
   정리한다. "이사님이 배포 없이 직접 수정"하는 관리 화면은 수요 확인 후 별도 슬라이스.
   - ⚠️ **선행 확인 필요(미해결)**: 이 방향(lookup 도입, 풀 관리 UI는 보류)이 이사님
     제품 의중과 맞는지 최종 확인. 본 슬라이스는 관리 UI 없이도 의미가 있으나(검증 강화),
     UI 수요가 "지금 당장"이면 범위가 커진다.
2. **이번 범위 = 인프라 + 진행상태 파일럿.** 단순 도메인부터가 아니라 가장 어려운
   종속 케이스를 먼저 풀어 패턴을 확정한다.
3. **단일 lookup 테이블(접근법 🅰).** 카테고리별 분리 테이블(🅲)이 아니라 단일
   `crm.lookup_values` + `category` 컬럼. 나머지 도메인 확장 비용 최소화.
4. **perf 중립.** Workers+Hyperdrive에서 무거운 건 연결 생성이지 쿼리가 아니다.
   검증은 status_group/status가 PATCH에 포함될 때만, **기존 연결에서 lookup 1쿼리**로
   수행 → 추가 왕복은 조건부 +1로 미미. 프론트 소비(후속 슬라이스)는 mc-master의
   `catalog-cache` TTL 패턴 재사용.

## 범위

### 이번 슬라이스 (in)
- `crm.lookup_values` 테이블 + 마이그레이션 `0005`(crm only, additive).
- 진행상태(`status_group`, `status`) lookup 시드.
- `customers` PATCH의 백엔드 검증을 lookup 기반으로(유효성 + 종속).
- 검증 헬퍼 쿼리 모듈 + 서버 테스트.

### 후속 슬라이스 (out, 별도 PR)
- 프론트 `customerStatusGroups` 상수 → `GET /api/lookups` 동적 소비 전환(클라 TTL 캐시).
- 나머지 도메인 lookup화: `priority`/`chance`, `source`, `team`, `customer_tasks.category`,
  `customer_schedules.type`, `customer_documents.doc_type`, `consultations.channel`.
- 기술 내부값 enum 전환: `customer_type`, `quotes.entry_mode`·`acquisition_tax_mode`·
  `app_status`·`decision_status`, `quote_scenarios.*_mode`·`purchase_method`.
- 서류 `customer_documents.title` vs `doc_type` 중복 컬럼 정리(#69에서 진실원본=`doc_type`).
- 관리 UI(어휘 추가/수정/순서변경/활성화).

### 비범위 (no)
- `customers.status_group`/`status` 컬럼 값 자체는 **변경하지 않는다**(데이터 마이그레이션 없음).
  lookup의 `value`가 현행 text 값과 동일하므로 기존 행은 그대로 유효하다.

## 설계

### 1. 데이터 모델

```ts
// src/db/schema.ts
export const lookupValues = crm.table("lookup_values", {
  id: uuid("id").defaultRandom().primaryKey(),
  category: text("category").notNull(),      // "status_group" | "status"
  value: text("value").notNull(),            // 현행 text 값 그대로: "계약완료" / "출고완료"
  label: text("label"),                      // 표시명. null이면 value 사용 (지금은 동일)
  parentValue: text("parent_value"),         // 종속: status→부모 group value, status_group→null
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
// unique index (category, value)
```

설계 포인트:
- `value`는 **현행 text 그대로** → `customers` 컬럼·기존 데이터 무변경, 데이터 마이그레이션 0.
  lookup은 "이 값이 유효한가 / 종속이 맞는가"를 판정·열거하는 사전(dictionary).
- 종속은 `parent_value` 키로 표현(FK 아님). 단일 테이블이라 다른 도메인은 `category`만 추가.
- `active`/`sort_order`/`label`은 후속(관리 UI·표시명 분리)의 토대. 이번엔 시드가 채우기만.

### 2. 종속 + 백엔드 검증

- 검증 쿼리 모듈 신설: `src/db/queries/lookups.ts`
  - `listLookup(executor, category)` — 카테고리의 active 값 목록(sortOrder 순). 후속 소비용.
  - `validateStatusSelection(executor, { statusGroup, status })` — 진행상태 종속 검증.
- `customers` PATCH 흐름(`src/routes/customers.ts`, `customerWriteSchema` 통과 후):
  - body에 `statusGroup`/`status`가 **포함될 때만** `validateStatusSelection` 호출.
    - `statusGroup` 값이 `category='status_group'` AND `active`에 존재하는지.
    - `status` 값이 `category='status'` AND `active` AND `parent_value=statusGroup`인지(종속).
    - 위반 시 400(명확한 메시지: 어느 값이/어느 종속이 어긋났는지).
  - 같은 요청 연결에서 lookup 1쿼리(`category IN ('status_group','status')` 한 번 읽어 메모리
    판정) → 추가 왕복 조건부 +1. status를 안 바꾸는 PATCH는 추가 왕복 0.
- zod 자체로는 비동기 DB 종속 검증이 불가하므로, 검증은 라우트 핸들러에서 수행한다
  (`customerWriteSchema`는 형태 검증만 유지).

### 3. 시드

- `scripts/seed-lookups.ts` + `package.json` `"seed:lookups"`.
- 입력 = `client/src/data/customers.ts`의 `customerStatusGroups`(시드 스크립트가 client
  상수를 import하는 패턴은 `seed-customers.ts`에 이미 존재).
- 생성: `status_group` 9행(parent_value=null, sortOrder=선언순) + `status` ~31행
  (parent_value=그룹 value, sortOrder=그룹 내 선언순), 전부 active=true.
- **멱등**: `category IN ('status_group','status')` 삭제 후 재삽입(또는 (category,value) upsert).

### 4. 마이그레이션

- `bun run db:generate` → `drizzle/0005_*`(lookup_values 테이블, crm only, additive).
- `bun run db:migrate`로 master 적용. `db:push` 금지 규약 유지, `schemaFilter:["crm"]` 불변.

## SSOT 전략 / Caveat

- 이번 슬라이스에서 **백엔드 검증의 진실원본 = DB lookup**(검증을 DB로 수행).
- 프론트 드롭다운·종속 표시는 이번엔 `customerStatusGroups` 상수를 **그대로 유지**
  (소비 전환은 후속 슬라이스). 둘의 일치는 **시드가 그 상수에서 생성**됨으로 보장.
- ⚠️ Caveat: 상수만 바꾸고 `seed:lookups`를 재실행하지 않으면 프론트(새 값 표시) vs
  백엔드(옛 값만 통과)가 어긋나 검증 실패할 수 있다. 상수 변경 시 시드 재실행 필수.
  후속 슬라이스에서 프론트를 `/api/lookups` 소비로 전환하면 이 이원성은 해소된다.

## perf 분석

- lookup 데이터는 작다(진행상태 ~40행, 전체 도메인 합쳐도 수백). (category,value) 인덱스.
- 검증 추가 왕복 = status 변경 PATCH에 한해 **같은 연결 1쿼리** → 연결 생성 비용 공유라 미미.
- 후속 프론트 소비는 `/api/lookups` 1회 + 클라 TTL 캐시(거의 안 바뀌어 적중률 높음).

## 검증 계획

- `bun run typecheck` 0 · `bun run lint` 0.
- 종속 판정은 **순수 함수로 분리**(active value 목록 + {group,status}를 받아 판정,
  DB 미접근) → `bun run test:unit`으로 유효/없는값/종속불일치/미입력 케이스 단위테스트.
- 서버 테스트(`bun test --env-file=.env.local`): 진행상태 lookup 라운드트립
  — 유효 group+status PATCH 200, 없는 status 400, 종속 안 맞는 status(group과 불일치) 400,
  status 미포함 PATCH는 검증 건너뜀 200.
- `bun run build`. 시드 멱등성 확인(2회 실행 동일 결과).

## 파일 변경 목록(예정)

- `src/db/schema.ts` — `lookupValues` 테이블 추가.
- `drizzle/0005_*.sql` — 생성된 마이그레이션.
- `src/db/queries/lookups.ts` — `listLookup`, `validateStatusSelection`(신규).
- `src/routes/customers.ts` — PATCH 핸들러에 진행상태 검증 연결.
- `scripts/seed-lookups.ts` + `package.json`(`seed:lookups`) — 시드.
- 서버 테스트 파일 — 검증 라운드트립.

## 관례 준수

- 인프라/서버 변경이라 브랜치 → PR → squash 머지. 커밋 메시지에 skip-ci 토큰 금지.
- `any` 금지, `unknown`+좁히기. 마이그레이션은 `db:generate`→`db:migrate`만, crm only.
