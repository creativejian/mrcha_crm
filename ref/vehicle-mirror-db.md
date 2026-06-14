# 차량 거울 DB (catalog schema)

Last updated: 2026-06-14

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
- 코드생성 트리거 12 + 함수 12 DROP(거울은 master 코드값을 보존).
- import 후 `public`에 들어간 차량 테이블을 `ALTER ... SET SCHEMA catalog`로 통째 이동(데이터 오염 0).
- 행수: brands 33 / models 265 / trims 1,669 / trim_options 10,495 / trim_option_relations 6,236 / trim_no_options 57 / colors 10,483.

## ⚠️ RLS 주의 (핸드오프 불일치 — 파트너 통보 필요)

- 핸드오프는 "RLS 미포함"이라 했으나 **실제 dump엔 RLS 정책이 포함**돼 있어, 거울엔 없는 `public.profiles`/`user_role` 참조로 첫 import가 실패했다.
- 해결: RLS 구문(`CREATE POLICY` + `ENABLE ROW LEVEL SECURITY`)만 제거한 정제본(`.clean.sql`)으로 import. 데이터는 100% 보존.
- **다음 dump도 같은 문제가 날 수 있으니 파트너에 통보할 것.**
- 현재 catalog는 RLS off지만 **PostgREST 비노출 schema**(기본 노출은 public/graphql_public)라 anon 키로 접근 불가. CRM은 서버에서 service-role(`DATABASE_URL`)로 읽으므로 안전. catalog를 API로 노출할 때만 RLS+정책 필요.

## soft-delete

- 거울 7테이블에 `deleted_at timestamptz`를 추가(master엔 없는 **거울 전용 컬럼**).
- master에서 삭제된 차량/옵션/색상은 거울에서 hard delete 대신 `deleted_at` 마킹 → **견적 FK 보호 + 이력 보존**.
- 조회 시 `WHERE deleted_at IS NULL`로 현재 판매 분만 필터.

## 동기화 (PostgREST) — 미구현, 다음 단계

- env: `MRCHA_MASTER_SUPABASE_URL`, `MRCHA_MASTER_PUBLISHABLE_KEY`(`.env.local`, CRM 전용 publishable 키, 파트너/앱 키와 공유 금지).
- 화이트리스트 fetch(`select=*` 금지) → upsert(`deleted_at=NULL`로 부활) + 응답에 없는 row `deleted_at=NOW()` soft-delete.
- 주기: 사람이 버튼으로 ~2주 full sync.
- conflict target: 대부분 `id`, **단 `trim_no_options`는 `trim_id`**.
- 10K+ 테이블(trim_options/colors/relations)은 Range 페이징, total 일치 확인 후에만 soft-delete 마킹.

## 진행 상황 / 다음 작업

완료:
1. ✅ DB 연결 레이어 (`src/db/client.ts`, postgres.js + drizzle, PR #9)
2. ✅ catalog 차량 타입 (`src/db/catalog.ts`, drizzle introspect, drizzle 관리 밖 read-only, PR #9)
3. ✅ 차량 조회 API (`/api/vehicles` brands/models/trims/trims:id — `src/db/queries/vehicles.ts` + `src/routes/vehicles.ts`, PR #10). `deleted_at IS NULL` 필터, sort_order, 화이트리스트, zod 검증.

4. ✅ 프론트 연결 — `VehiclePicker`(브랜드→모델→트림 드롭다운, `client/src/lib/vehicles.ts` 순수 fetch)를 김민준 견적 workbench(Jeff body)에 연결, PR #11. 실데이터 선택 동작 확인.

다음:
5. VehiclePicker 선택값 → 가격/옵션/색상 자동 반영 (견적 가격 계산)
6. sync 스크립트 (위 PostgREST 규칙)
7. CRM 자체 스키마 (customers/consultations/quotes, public, drizzle migrate. quotes가 `catalog.trims` FK 참조)

참고: 로컬 실행은 `bun run dev`로 API(8788)+client(5173) 둘 다 띄워야 `/api/vehicles`가 동작한다. (PORT 빈값 함정은 `src/local-dev.ts`에서 `Number(process.env.PORT) || 8788`로 견고화됨, PR #12)
