# 차량 거울 DB (catalog schema)

Last updated: 2026-06-14

> **⚠️ 폐기됨 (2026-06-17, A2 Phase C).** 자체 Supabase 거울 + sync 모델은 **master Supabase의 `catalog` 스키마 직접 read**로 대체됐다. `src/sync/*`·`bun run sync`·`POST /api/catalog/sync`·`MRCHA_MASTER_*` 키·`ref/db_import/` 덤프는 모두 제거됐다. master catalog엔 거울 전용 `deleted_at`이 없어 read 쿼리는 그 필터를 쓰지 않는다. 현재 차량 데이터는 `src/db/client.ts`(=master) + `src/db/queries/vehicles.ts` + `src/routes/vehicles.ts`로 읽고, `crm.quotes`는 `catalog.trims`/`catalog.colors`에 FK(ON DELETE SET NULL)를 건다. 이 문서는 거울 시절 구조·결정의 **히스토리 참고용**이며, 아래 "거울/sync" 서술은 더 이상 유효하지 않다. 상세: `ref/specs/2026-06-17-crm-db-connection-migration-design.md`, `ref/plans/2026-06-17-crm-schema-phase-bc.md`.

CRM은 차량 카탈로그(브랜드/모델/트림/옵션/색상)를 **거울 DB**로 보유한다. 이 문서는 그 구조·결정·동기화 규칙을 팀과 공유하기 위한 단일 소스다.

## master / 거울 관계

- **master(원천) = Mr.Cha 앱 Supabase.** 차량 데이터는 거기서 author한다(어드민 CRUD + 코드생성 트리거). project_ref·키는 `.env.local`의 `MRCHA_MASTER_*` 와 `ref/db_import/CRM_handoff_*.md`(gitignore) 참조.
- CRM은 master에서 **직접** 거울 복사한다. Flutter 앱을 거치지 않음 → 파트너 팀과 **형제**(mirror-of-mirror 아님).
- 단방향: master → CRM (read만). **CRM은 차량을 수정하지 않는다.**

## CRM에서의 위치: `catalog` schema

- 차량 7테이블은 **`catalog` schema에 격리**: `brands, models, trims, trim_options, trim_option_relations, trim_no_options, colors`.
- public이 아니라 catalog인 이유: **drizzle는 public만 관리** → `bun run db:push`가 차량 테이블을 DROP하는 사고를 원천 차단.
- 견적/상담(public)은 `catalog.trims` 등을 **cross-schema FK**로 참조 가능.
- 차량 PK = `bigint`(master 그대로). CRM 자체 도메인(customers 등)은 `uuid`.
- `car_status` enum도 catalog에 있음.

## 초기 import (2026-06-14 완료)

- 자산: `ref/db_import/`(gitignore — 대용량 dump + CRM 전용 publishable 키).
- 적용 순서(FK): `brands_models_trims` → `mirror_drop_triggers` → `options_colors`.
- 코드생성 트리거 12 + 함수 12 DROP(거울은 master 코드값을 보존). **(2026-06-16 실데이터 재확인: catalog 사용자 정의 트리거 0 — FK 무결성 시스템 트리거만 남음, 코드생성/`updated_at` 함수 0. sync upsert가 master 값을 재생성/덮어쓰지 않음 보장.)**
- import 후 `public`에 들어간 차량 테이블을 `ALTER ... SET SCHEMA catalog`로 통째 이동(데이터 오염 0).
- 행수: brands 33 / models 265 / trims 1,669 / trim_options 10,495 / trim_option_relations 6,236 / trim_no_options 57 / colors 10,483.
- **`trim_options.type` 의미** (2026-06-15 실데이터 확인): `basic`(제조사 정규 옵션 — 6,737개 중 99.6%가 **유료**, 선루프·패키지·외장컬러 등) / `tuning`(애프터마켓, 3,758개, 더 저렴). **둘 다 유료 선택·합산 대상** — "basic=무료 기본사양"은 오해이니 주의.
- **`trim_option_relations.type` 의미**: `excludes`(중복 선택 불가, 5,862개 — 외장컬러·패키지군 등 배타. 견적 UI는 미스터차 앱처럼 비활성화+색그룹으로 처리) / `includes`(A 선택 시 B 자동 포함, 374개, 한 단계). 견적 옵션 UX 상세: `ref/specs/2026-06-15-quote-option-selection-design.md`, `…-quote-option-exclude-ux-design.md`.
- **`colors` 의미** (2026-06-16 실데이터 확인): 트림별 **기본 색상 팔레트** — exterior 7,914 / interior 2,569, 전부 hex+code, 색상명은 한글 82%/영문 18%(브랜드 원본 언어 그대로, 예 `폴라 화이트 (149U)`). **가격 컬럼 없음**(기본 제공). 유료 매트 도장(무광 등)은 `trim_options`의 외장컬러 옵션으로 **별개**(겹치지 않음). 견적 색상 선택은 `colors`에서, 유료 도장은 옵션에서. 색상 UX 상세: `ref/specs/2026-06-16-quote-color-selection-design.md` (PR #17).

## ⚠️ RLS 주의 (핸드오프 불일치 — 파트너 통보 필요)

- 핸드오프는 "RLS 미포함"이라 했으나 **실제 dump엔 RLS 정책이 포함**돼 있어, 거울엔 없는 `public.profiles`/`user_role` 참조로 첫 import가 실패했다.
- 해결: RLS 구문(`CREATE POLICY` + `ENABLE ROW LEVEL SECURITY`)만 제거한 정제본(`.clean.sql`)으로 import. 데이터는 100% 보존.
- **다음 dump도 같은 문제가 날 수 있으니 파트너에 통보할 것.**
- 현재 catalog는 RLS off지만 **PostgREST 비노출 schema**(기본 노출은 public/graphql_public)라 anon 키로 접근 불가. CRM은 서버에서 service-role(`DATABASE_URL`)로 읽으므로 안전. catalog를 API로 노출할 때만 RLS+정책 필요.

## soft-delete

- 거울 7테이블에 `deleted_at timestamptz`를 추가(master엔 없는 **거울 전용 컬럼**).
- master에서 삭제된 차량/옵션/색상은 거울에서 hard delete 대신 `deleted_at` 마킹 → **견적 FK 보호 + 이력 보존**.
- 조회 시 `WHERE deleted_at IS NULL`로 현재 판매 분만 필터.

## 동기화 (sync 코어 = `bun run sync`) — 1단계 구현 완료 (PR #18, 2026-06-16)

- 구현: `src/sync/` — `sync-diff.ts`(순수 `idsToSoftDelete`/`chunk`/`projectRow`, TDD bun test) · `sync-tables.ts`(7테이블 화이트리스트 메타, `deleted_at` 제외, PK 정보) · `master-client.ts`(REST fetch + Range 페이징) · `sync.ts`(오케스트레이션 + 요약). CLI `bun run sync`.
- env: `MRCHA_MASTER_SUPABASE_URL`, `MRCHA_MASTER_PUBLISHABLE_KEY`(`.env.local`, CRM 전용 publishable 키, 파트너/앱 키와 공유 금지).
- 동작: 화이트리스트 fetch(`select=*` 금지, snake_case→camelCase 투영) → drizzle `onConflictDoUpdate`(`deleted_at=NULL`로 부활) + master에 없는 활성 row `deleted_at=NOW()` soft-delete.
- **full-sync**(증분 불가): master는 hard-delete(`deleted_at` 없음) + `updated_at`은 `trims`에만. 주기는 사람이 ~2주 수동 실행.
- conflict target: 대부분 `id`, **단 `trim_no_options`는 `trim_id`**.
- 10K+ 테이블(trim_options/colors/relations)은 Range 1000 페이징, `rows==total` 검증 통과 시에만 soft-delete 마킹(불완전 fetch로 오삭제 방지).
- 실전 검증(2026-06-16): 520i(id 701) 가격 변경 → sync → catalog 가격+`updated_at` 메타까지 정확 반영, 원복도 추종, 다른 행/soft-delete 영향 0. 설계/계획: `ref/specs|plans/2026-06-16-catalog-sync*`.
- **2단계 완료 (PR #19)**: `runSync()` 재사용 분리(`import.meta.main` 가드) → Hono `GET /api/catalog/counts`·`POST /api/catalog/sync`(409 동시실행 가드) → `MCMasterPage`(엠씨 마스터) 건수 카드 + [마스터 동기화] 버튼(최고관리자) + 결과 패널. 무저장 MVP(public 0). `getCatalogCounts` 순차 await(pool 소진 방지). 설계/계획: `ref/specs|plans/2026-06-16-catalog-sync-ui*`.
- **3단계(미구현)**: sync 이력 테이블 + "마지막 동기화 N분 전"(public 첫 마이그레이션).

## 진행 상황 / 다음 작업

완료:
1. ✅ DB 연결 레이어 (`src/db/client.ts`, postgres.js + drizzle, PR #9)
2. ✅ catalog 차량 타입 (`src/db/catalog.ts`, drizzle introspect, drizzle 관리 밖 read-only, PR #9)
3. ✅ 차량 조회 API (`/api/vehicles` brands/models/trims/trims:id — `src/db/queries/vehicles.ts` + `src/routes/vehicles.ts`, PR #10). `deleted_at IS NULL` 필터, sort_order, 화이트리스트, zod 검증.

4. ✅ 프론트 연결 — `VehiclePicker`(브랜드→모델→트림 드롭다운, `client/src/lib/vehicles.ts` 순수 fetch)를 김민준 견적 workbench(Jeff body)에 연결, PR #11. 실데이터 선택 동작 확인.

5. ✅ 가격/옵션 반영 — 가격 패널(PR #13), 옵션 선택+합산(PR #14), excludes 비활성화 UX(PR #15), 가격 mock 상수화(PR #16). 김민준 workbench 한정.

6. ✅ 색상(외장/내장) 선택 — `ColorPicker`(hex 스와치 단일선택, colors=기본 팔레트·가격무관) → 🎨 버튼+앱카드 반영, PR #17.

7. ✅ catalog 거울 동기화 sync 코어(1단계) — `bun run sync`(`src/sync/`), full-sync upsert+soft-delete, 실전 검증 완료. PR #18. (위 "동기화" 섹션 참조)

다음:
8. 구매방식별 할인 매핑(financial/partner/cash) + 취득세 공식 자동계산 — 이사님 할인 다중행·취득세 4탭 UI(`1a4228a`) 위에 실제 계산 연결. (master secret key 필요 — 보류)
9. ✅ sync 2단계 — mc-master 동기화 UI + counts/sync API (PR #19). 다음은 sync 3단계(이력 "마지막 동기화 N분 전").
10. CRM 자체 스키마 (customers/consultations/quotes, public, drizzle migrate. quotes가 `catalog.trims` FK 참조)

참고: 로컬 실행은 `bun run dev`로 API(8788)+client(5173) 둘 다 띄워야 `/api/vehicles`가 동작한다. (PORT 빈값 함정은 `src/local-dev.ts`에서 `Number(process.env.PORT) || 8788`로 견고화됨, PR #12)
