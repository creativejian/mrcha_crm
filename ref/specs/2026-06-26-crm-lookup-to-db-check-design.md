# CRM lookup_values → DB CHECK 전면 전환 설계

- 날짜: 2026-06-26
- 상태: 설계 합의(구현 전). **⚠️ 구현 착수 전 이사님 공유 권고** (머지된 5슬라이스 #107~#111 인프라를 되돌리는 큰 변경 + 팀 공유 결정).
- 슬라이스: enum/lookup 정리 — **아키텍처 재정렬**(이전 lookup 슬라이스의 진화, 폐기 아님)
- 결정자: 유슨생(이 지적 제기 당사자). 방향=C 전면 전환, 범위=어휘 9 + 기술값 5.

## 배경 / 동기

유슨생 지적: **"관리 UI를 안 만들기로 확정했으면, 업무어휘를 lookup 테이블 + 앱 검증으로 두는 현 방식보다 crm 스키마 DB 제약(CHECK)으로 처리하는 게 더 단순·견고하다."**

실측으로 확인한 현 구조의 문제:

1. **어휘는 이미 코드에 산다.** `client/src/data/customers.ts`에 `CHANCE_OPTIONS`/`SOURCE_OPTIONS`/`DOC_TYPE_OPTIONS`/`TASK_CATEGORY_OPTIONS`/`SCHEDULE_TYPE_OPTIONS`/`PURCHASE_METHOD_OPTIONS`/`customerStatusGroups`(종속 포함)가 SSOT. `lookup_values` 93행은 **그 코드를 시드로 복제한 DB 그림자**다.
2. **lookup의 유일한 고유 강점(런타임 동적 수정)을 안 쓴다.** 관리 UI 미제작 확정 → 어휘 변경은 항상 개발자 코드/시드 수정. 동적 이점이 죽었다.
3. **매 검증마다 DB 왕복** — 코드에 있는 값을 DB lookup에서 다시 읽는다.
4. **정작 DB 레벨 무결성 방어는 0.** 실측: crm 스키마 enum 0개, CHECK 0개, 18개 어휘/기술 컬럼 전부 `text`.
5. **방어 부재의 실증:** 검증을 우회하는 직접 INSERT로 garbage 4건이 master DB에 적재됐다 — `seed-customers.ts`의 `비교 견적`(재시드마다 부활) + 과거 `test:server` 잔재 3개(`없는분류`/`없는종류`/`존재하지않는종류`). lookup/zod(라우트 검증)는 이 우회 경로를 못 막는다. **DB CHECK였으면 처음부터 거부됐다.**

**전제(확정):** crm 스키마는 **CRM 백엔드만** 쓴다(외부 Flutter 앱 등은 읽기/미접근). → 종속(그룹-상태 일치)은 앱이 항상 검증하고, DB는 "값이 사전에 있나"만 단일컬럼 CHECK로 봉인하면 충분.

## 핵심 결정

1. **`lookup_values` 테이블·`queries/lookups.ts`·`seed-lookups.ts` 폐기.** 어휘 = `client/src/data` 코드 SSOT 단일.
2. **검증 2층:** 앱(zod enum + 코드 순수함수) + **DB CHECK(최종 방어선)**. 단일 패러다임.
3. **범위 14컬럼:** 어휘 9 + 기술값 5. `priority`(레거시 읽기전용)·`customer_type_detail`(자유입력)·`consultations.status`(빈 도메인) 보류.
4. **종속은 DB가 강제 안 함.** `status_group`→`status` 종속은 앱(`checkStatusSelection`, `customerStatusGroups` 코드맵)이 검증. DB CHECK는 각 컬럼 값의 사전 소속만. (crm=CRM 백엔드 전용이라 안전.)
5. **종속 정밀화(부수 이득):** 코드맵은 lookup이 못 한 것을 해결한다 — 같은 2차값이 여러 1차에 중복(`추후재컨택`=관리중·상담완료·불발)일 때, lookup은 `(category,value)` unique라 첫 그룹만 알았지만, 코드맵은 `Map<status, Set<group>>`로 **다부모 종속을 정확히** 표현한다. brief에 적힌 "후속 복합키 승격" 과제가 여기서 자연 해소.
6. **데이터 정리 선행:** garbage 4건 삭제 + `test:server` 잔재 생성 경로 차단(테스트 수정). 안 하면 CHECK ADD가 실패한다.

## 데이터 확인 (실측, 적용 전 전제)

| 컬럼 | DB distinct | 사전(코드 상수) | 판정 |
|------|-------------|-----------------|------|
| customers.status_group | 9종 | `customerStatusGroups` 키 9 | ✅ 일치 |
| customers.status | 14종(사용) | `customerStatusGroups` flat | ✅ 일치 |
| customers.chance | 높음, null | `CHANCE_OPTIONS` 5 | ✅ |
| customers.source | 9종 | `SOURCE_OPTIONS` 13 | ✅ |
| customers.customer_type | 3종 | 개인/개인사업자/법인사업자 | ✅ |
| customer_tasks.category | 견적/안내/**없는분류**/체크 | `TASK_CATEGORY_OPTIONS` 6 | ⚠️ garbage 1 |
| customer_schedules.type | 견적/**없는종류** | `SCHEDULE_TYPE_OPTIONS` 8 | ⚠️ garbage 1 |
| customer_documents.doc_type | 기타서류/사업자등록증/**존재하지않는종류** | `DOC_TYPE_OPTIONS` 22 | ⚠️ garbage 1 |
| quote_scenarios.purchase_method | **비교 견적**(QT-2606-0007)/운용리스/중고리스 | `PURCHASE_METHOD_OPTIONS` 6 | ⚠️ garbage 1 |
| quotes.entry_mode | manual/solution | manual/solution/original | ✅ |
| quotes.app_status | draft/sent/viewed | draft/queued/sent/viewed | ✅ |
| quotes.decision_status | confirmed/none/null | none/considering/confirmed/contracting | ✅ |
| quotes.acquisition_tax_mode | normal/null | normal/hybrid/electric/manual | ✅ |
| quotes.status(앱표시) | 고객 확인 전/고객 열람/null | 고객 확인 전/고객 열람 | ✅ |

**garbage 4건은 전부 test:server 잔재(각 1건), 삭제 안전.** 정리 후 14컬럼 전부 사전 내 → CHECK ADD 안전.

## 설계

### 1. 범위 (대상 14컬럼)

- **어휘 9:** `customers`(status_group, status, chance, source, customer_type), `customer_tasks.category`, `customer_schedules.type`, `customer_documents.doc_type`, `quote_scenarios.purchase_method`
- **기술값 5:** `quotes`(entry_mode, app_status, decision_status, acquisition_tax_mode, status[앱표시])
- **보류:** `customers.priority`(레거시·PATCH 쓰기경로 없음·상수 미정의), `customers.customer_type_detail`(2단계 자유입력), `consultations.status`(빈 도메인)

CHECK 값은 nullable 컬럼이면 `col IS NULL OR col IN (...)` 형태(기존 null 데이터 보존).

### 2. 데이터 정리 선행

순서가 중요(아래 ③ 마이그레이션 전):

1. **재발원 수정** — `seed-customers.ts`가 `비교 견적`을 INSERT(재시드마다 부활)하므로 정식값으로 수정. (나머지 3개는 과거 test 잔재로, 현재 라우트 검증이 막아 재생성되지 않음 — 1회 삭제로 끝.)
2. **garbage 4건 삭제**(1회성, 공유 master DB라 실행 시 사용자 확인):
   - `customer_tasks` category=`없는분류` 1행
   - `customer_schedules` type=`없는종류` 1행
   - `customer_documents` doc_type=`존재하지않는종류` 1행
   - `quotes` quote_code=`QT-2606-0007`(scenario `비교 견적`, ON DELETE CASCADE)

### 3. 마이그레이션 (crm only, `drizzle/0007`)

- **`lookup_values` 테이블 DROP** (schema.ts에서 정의 제거 → `db:generate`가 DROP TABLE 생성).
- **14컬럼에 단일컬럼 CHECK 추가.** drizzle `check()` 헬퍼를 schema 테이블 정의에 추가, 값 목록은 코드 상수에서 `sql.join`으로 생성(중복 회피·SSOT 유지). 예:
  ```ts
  // schema.ts (개념)
  check("customers_chance_check",
    sql`${customers.chance} IS NULL OR ${customers.chance} IN (${sql.join(CHANCE_OPTIONS.map((v) => sql`${v}`), sql`, `)})`)
  ```
  status_group/status는 `customerStatusGroups`에서 파생(키=group 9종, flat+dedup=status 전체).
- `db:generate` → `db:migrate`, `schemaFilter:["crm"]`. **`db:push` 금지.**
- **폴백:** drizzle-kit이 `check()`를 마이그레이션으로 깔끔히 생성하지 못하면, `0007` 마이그 SQL을 수동 작성(schema엔 check 정의 유지해 drift 최소화). plan에서 `db:generate` 산출물 검증.
- ⚠️ **공유 master DB 스키마 변경**(다른 세션도 같은 DB). 적용 시 사용자 확인.

### 4. 앱 검증 재설계

- **`src/db/queries/lookups.ts` 삭제** (`validateLookupValue`/`validateStatusSelection`/`listLookup` 전부 DB 쿼리 기반 → 폐기).
- **`src/lib/status-lookup.ts` 확장(순수, DB 미접근):**
  - `checkStatusSelection`의 `statusParent: Map<string,string>` → `statusParents: Map<string, ReadonlySet<string>>`로 **다부모 정밀화**. (단독 status=Map에 있나 / 둘 다=group이 부모집합에 포함되나.)
  - `buildStatusMaps(groups)` → `{ activeGroups: Set<string>, statusParents: Map<string, Set<string>> }`. 모듈 상수로 1회 빌드.
- **`src/lib/lookup-validate.ts`(신규, 순수):**
  - `LOOKUP_SETS: Record<string, ReadonlySet<string>>` = chance/source/doc_type/task_category/schedule_type (코드 상수 → Set).
  - `validateLookupValue(category, value): string | null` (동기, DB 인자 없음). 기존 시그니처·400 메시지 형식 보존해 라우트 변경 최소화.
  - `validateStatusSelection(sel): string | null` (동기) = 모듈 상수 maps + `checkStatusSelection`.
- **`src/routes/customers.ts`:** `await validate*(…, db)` → 동기 `validate*(…)`. DB executor 인자·`await` 제거. 라우트 로직(위반 400) 동일.
- 기술값 5: entry/app/decision/tax는 이미 라우트 zod enum(유지). `quotes.status`(앱표시)는 현재 자유 string이면 zod `z.enum(["고객 확인 전","고객 열람"]).nullable()` 추가 검토(plan에서 라우트 본문 확인).

### 5. 시드 / schema 정리

- `scripts/seed-lookups.ts` 삭제, `package.json` `seed:lookups` 스크립트 제거.
- `src/db/schema.ts` `lookupValues` 정의 + `uniqueIndex` 제거(③에서 DROP 마이그 생성).

## perf / 마이그레이션 영향

- **검증 DB 왕복 0** — 전부 in-memory 코드 상수(현재 status 키 올 때 1쿼리·lookup 1쿼리 → 0). 순수 이득.
- CHECK는 INSERT/UPDATE 시 O(1) `IN` 평가. 무시 가능.
- 마이그레이션: DROP TABLE 1 + ADD CONSTRAINT 14. 기존 20행 customers·견적은 정리 후 전부 사전 내라 ALTER 안전.

## 검증 계획

- `bun run typecheck` 0 · `bun run lint` 0.
- `bun run test:server`: 기존 검증 라운드트립이 코드 기반 validate로도 동일하게 400/200. garbage 미생성 확인. status 다부모 종속 단위테스트(추후재컨택=3그룹 전부 허용).
- `bun run test:unit`: `status-lookup`·`lookup-validate` 순수함수 단위(유효/무효/종속).
- `bun run build` OK.
- 마이그레이션: `db:generate` 산출물(DROP + 14 CHECK) 리뷰 → master 적용 → 14컬럼 CHECK 존재 + garbage INSERT 거부 실측.

## 파일 변경 목록(예정)

- (데이터) garbage 4건 삭제 — 코드 아님.
- 삭제: `src/db/queries/lookups.ts`, `scripts/seed-lookups.ts`.
- 수정: `src/db/schema.ts`(lookupValues 제거 + 14 check 추가), `src/lib/status-lookup.ts`(다부모), `src/routes/customers.ts`(동기 validate), `src/routes/customers.test.ts`·관련 server 테스트(잔재 차단·정밀 종속), `package.json`(seed:lookups 제거).
- 신규: `src/lib/lookup-validate.ts`, `drizzle/0007_*.sql`(+meta), 단위테스트.

## 리스크 / 롤백

- **drizzle check() 마이그 생성 불확실** → 폴백(수동 0007 SQL). plan에서 산출물 검증.
- **공유 master DB 변경**(lookup DROP + CHECK) → 적용 전 사용자 확인. 롤백=`0007` 역마이그(CHECK DROP + lookup 재생성 + 재시드)지만, lookup 재구축 비용 큼 → **적용 전 신중**. 단 CHECK는 additive 방어라 앱은 적용 후에도 동작(검증 재설계가 코드 기반이라 lookup 없어도 OK).
- **순서 의존:** test 수정 → garbage 삭제 → 마이그 → 검증 재설계. 검증 재설계(코드 validate)는 lookup DROP과 독립이라 먼저 머지 가능하나, 한 PR로 묶어 일관 적용 권장.

## 관례 준수

- 브랜치(`feat/crm-lookup-to-db-check`) → PR → squash 머지. skip-ci 토큰 금지. `any` 금지.
- DB 변경은 `db:generate`→`db:migrate`만(`db:push` 금지), `schemaFilter:["crm"]`.
- 팀 공유 결정 — 구현 착수 전 이사님 공유, AGENTS.md/brief 반영.
