# Mr. Cha CRM Active Session Brief

Last updated: 2026-06-17

Purpose: `영실아 이어가자` / `CRM 이어가자` 이후 현재 작업만 빠르게 복구하기 위한 압축 문서.

## Boot

1. Read this file first.
2. Run `git status --short --branch` and `git log --oneline --decorate --max-count=5`.
3. Read `ref/current-working-state.md` only if this is insufficient.
4. Planning source files only when the task touches strategy/roadmap/AI policy/architecture/quote engine.

## Current Focus (2026-06-17)

- **master Supabase 직접 통합 — A2 Phase A/B/C 머지 완료.** schema 3분할(public 앱 19 / catalog 차량 9 / crm 운영 8)이 prod 실재. `DATABASE_URL`=master.
- **Phase A**(PR #21, `aebaf57`): `crm` 8테이블 master 생성.
- **Phase B/C**(PR #22 squash `86e4959`, main 머지): catalog adopt + 차량 read master 직결(거울 `deleted_at` 필터 제거) + 거울 sync 폐기 + `crm.quotes→catalog` FK(SET NULL).

## Phase B/C 작업 (PR #22, 머지됨)

- `47dd91b` 구현 계획 docs(`ref/plans/2026-06-17-crm-schema-phase-bc.md`).
- `1a3c970` 거울 sync 폐기 — `src/sync/*` 삭제, `POST /api/catalog/sync`·`bun run sync`·MCMaster 동기화 UI·`.catalog-sync-*` CSS·`.env.example MRCHA_MASTER_*` 제거. `GET /api/catalog/counts`+catalog read 유지. MCMaster=counts 전용.
- `ca6656f` 차량 read master 직결 — `catalog.ts`를 재introspect 기반 master 7테이블로(deleted_at 제거, status→text), `vehicles.ts`·`catalog-counts.ts` `isNull(deletedAt)` 제거.
- `4f3df87` `crm.quotes`→catalog FK(`trim_id→trims`, `exterior/interior_color_id→colors`, **ON DELETE SET NULL**), 수기 `drizzle/0001`.
- 로컬 정리: `.env.local MRCHA_MASTER_*`·`ref/db_import/` 삭제. `drizzle/_catalog_introspect/`는 gitignore+eslint 제외.

## Specs / Plans (master 통합)

- specs: `crm-db-connection-migration-design`(A2) · `crm-quotes-schema-design`(ⓐ) · `crm-customers-schema-design`(A1) · `2026-06-17-phase1-go-and-verification`(ⓑ) · `2026-06-16-master-supabase-integration` · `2026-06-16-vehicle-admin-handoff`
- plans: `2026-06-17-crm-schema-phase-a` · `2026-06-17-crm-schema-phase-bc`

## ⚠️ Caveats

- **public FK 보류**(loose id): `quotes.app_user_id/advisor_id/source_*`→public, `customers/consultations`의 public 참조. 앱 소유 경계 유지 — 필요 시 케이스별 앱팀 협의(전부 SET NULL 필수).
- **catalog FK는 SET NULL만**: 앱 catalog 삭제 비차단 + 비정규화 이름으로 견적 보존. RESTRICT/CASCADE 금지.
- `status`는 `public.car_status` enum(cross-schema)이라 introspect 불가 → catalog.ts는 `text`로 모델. status 필터는 거울 동작대로 미적용(단종 포함 노출).
- **db env**: drizzle-kit `.env.local` 자동로드 안 함 → `drizzle.config(.catalog).ts`가 `readFileSync` 직접 주입.
- `crm.quotes.primary_scenario_id→quote_scenarios` 순환 FK는 여전히 보류.
- **exposed schemas에 catalog 추가 금지**(`public, graphql_public`만).
- knip은 pre-existing findings로 exit=1(main 동일, 본 작업이 오히려 감소). lint/typecheck/test는 0.

## Next

- **견적/고객 mock ↔ crm DB 연결**(`CustomerDetailPage.tsx` mock → `crm.quotes`/`crm.customers`). 계산값(월납입/금리)·취득세(Gemini)는 별개(`lease_calc.ts` 포팅).
- public FK는 필요 시 케이스별 앱팀 협의(전부 SET NULL). `crm.quotes.primary_scenario_id→quote_scenarios` 순환 FK도 보류.
- 라우팅 2단계(하위모드·고객 딥링크) 등은 이후.

## Verification (Phase B/C, 2026-06-17)

- `typecheck` 0 · `lint` 0 · `test:unit` 52/52 · `build` OK.
- `test:server`(DATABASE_URL=master 주입) 13/13. master 스모크: brands 33·models 265·trims 1669, `getTrimDetail` options/colors 정상, `deleted_at` 에러 없음.
- catalog FK: `pg_constraint` 3건 `confdeltype='n'`(SET NULL), public FK 미추가 확인. public 19·catalog 9 불변.

## Collaboration

- (Codex 세션) User=이사님, assistant=영실. (Claude Code 세션) 호칭은 CLAUDE.md 팀 구성(송실장/유슨생).
- 판단 질문(`어때`/`괜찮을까`/`너 생각은?`): 추천·트레이드오프 먼저 + `적용할까요?`. 실행어(`응`/`해줘`/`진행해`): 즉시 실행.
- 팀 공유 결정·맥락은 git(`ref/*.md`, `AGENTS.md`)에. 로컬 메모리는 공유 안 됨.
