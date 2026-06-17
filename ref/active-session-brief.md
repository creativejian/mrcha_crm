# Mr. Cha CRM Active Session Brief

Last updated: 2026-06-17

Purpose: `영실아 이어가자` / `CRM 이어가자` 이후 현재 작업만 빠르게 복구하기 위한 압축 문서.

## Boot

1. Read this file first.
2. Run `git status --short --branch` and `git log --oneline --decorate --max-count=5`.
3. Read `ref/current-working-state.md` only if this is insufficient.
4. Planning source files only when the task touches strategy/roadmap/AI policy/architecture/quote engine.

## Current Focus (2026-06-17)

- **차량 관리(`/mc-master`) 구축 중** — 앱 `/admin/vehicles` 편집 기능을 CRM으로 이관(이후 앱은 read-only). 쓰기=CRM 백엔드가 master `catalog`에 직접(트리거가 코드·sort_order·단종·검증 처리). 최고관리자만 편집, 라이트 테마.
- **완료·머지**: 1a 백엔드 API(#23) · 1b-i 모델 CRUD(#24) · 1b-ii 트림 CRUD(#25) · 보강-A 라우트드릴다운·sticky·정규화명(#26) · 보강-B 선택모드(일괄삭제·드래그 reorder)+트림 컬럼확장(#27).
- **남음: 1b-iii — 옵션 패널 CRUD**(basic/tuning, 트림별). 색상은 트림 리스트에 칩 표시까지 됨(편집은 앱도 없음).

## 차량 관리 현황 (전부 머지)

- 백엔드: `src/db/queries/catalog-admin.ts`(모델·트림·옵션 CRUD + 집계 + reorder + canonical) + `src/routes/catalog.ts`(`/api/catalog/models·trims·options·*/reorder·*/trim-colors`). 쓰기는 `db`(postgres). `batch_update_sort_order`(public RPC)로 순서변경.
- 프론트: `client/src/pages/MCMasterPage.tsx` + `pages/mc-master/`(BrandSidebar·ModelTable·ModelEditPanel·TrimTable·TrimEditPanel·reorder.ts) + `lib/catalog.ts` + `data/vehicle-taxonomy.ts`. 라우트 `/mc-master/:modelId`.
- 트림 리스트: 색상칩·고유번호·연식·기본가격·가격변경일·자사/제휴/타사 할인(+율)·할인변경일·상태.

## A2 master 통합 (선행, 머지 완료)

- schema 3분할 prod 실재: public 앱19 / catalog 차량9 / crm 운영8. `DATABASE_URL`=master.
- Phase A(#21) crm 8테이블 · Phase B/C(#22) catalog 직결(거울 `deleted_at` 제거)·거울 sync 폐기·`crm.quotes→catalog` FK(SET NULL).

## ⚠️ Caveats

- **삭제는 선택 모드 일괄삭제만**(per-row 삭제 없음, 앱과 동일). 드래그 reorder는 HTML5 native(고스트 기본). 더 매끈하게는 @dnd-kit 도입 옵션.
- **catalog FK SET NULL만**(앱 삭제 비차단). public FK는 loose id 보류(앱 경계). `quotes.primary_scenario_id→quote_scenarios` 순환 FK 보류.
- `status`는 `public.car_status`(cross-schema) → catalog.ts는 `text`. status 필터 미적용(단종 노출).
- **bun API 핫리로드 없음** → 새 `/api/catalog/*` 라우트는 dev 서버 재시작 후 동작.
- db env: drizzle-kit이 `.env.local` 자동로드 안 함 → `drizzle.config(.catalog).ts`가 readFileSync 주입. exposed schemas에 catalog 금지.
- knip pre-existing exit=1(main 동일). lint/typecheck/test는 0.

## Next

- **1b-iii 옵션 패널** — 트림 행 옵션 아이콘 → basic/tuning 옵션 CRUD(`/api/catalog/trims/:id/options`·`/options/:id` 이미 백엔드 존재). + 옵션수/무옵션 배지.
- 이후: 견적/고객 mock(`CustomerDetailPage.tsx`) ↔ `crm.quotes`/`crm.customers` 연결. 할인·취득세·`lease_calc.ts`는 별개.

## Verification (2026-06-17)

- `typecheck` 0 · `lint` 0 · `test:unit` 70/70 · `test:server`(master) 17/17 · `build` OK.
- reorder tx 롤백 테스트(prod 무변경) 포함. 화면 검증은 dev 재시작 후 수동(헤드리스 브라우저 미설치).

## Collaboration

- (Codex 세션) User=이사님, assistant=영실. (Claude Code 세션) 호칭은 CLAUDE.md 팀 구성(송실장/유슨생).
- 판단 질문(`어때`/`괜찮을까`/`너 생각은?`): 추천·트레이드오프 먼저 + `적용할까요?`. 실행어(`응`/`해줘`/`진행해`): 즉시 실행.
- 팀 공유 결정·맥락은 git(`ref/*.md`, `AGENTS.md`)에. 로컬 메모리는 공유 안 됨.
</content>
