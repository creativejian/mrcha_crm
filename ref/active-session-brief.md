# Mr. Cha CRM Active Session Brief

Last updated: 2026-06-18

Purpose: `영실아 이어가자` / `CRM 이어가자` 이후 현재 작업만 빠르게 복구하기 위한 압축 문서.

## Boot

1. Read this file first.
2. Run `git status --short --branch` and `git log --oneline --decorate --max-count=5`.
3. Read `ref/current-working-state.md` only if this is insufficient.
4. Planning source files only when the task touches strategy/roadmap/AI policy/architecture/quote engine.

## Current Focus (2026-06-18)

- **차량 관리(`/mc-master`) = 앱 `/admin/vehicles` 완전 패리티 달성 → Phase 1 완료.** 쓰기=CRM 백엔드가 master `catalog`에 직접(트리거가 코드·sort_order·단종·검증 처리). 최고관리자만 편집, 라이트 테마.
- **다음 = CRM 도메인(고객·견적) DB 연결** (아래 Next).
- **완료·머지**: 1a~보강B(#23~#27) · 그룹핑+목록/순서 탭·할인 편집·상태 라벨·테이블 정리(#28) · mc_code 할당(#29) · 옵션 패널(배지·무옵션 확정·관계 표식)(#30) · 트림 모델 이동 + 단종 배너(#31).
- **Phase 2(앱·CRM 둘 다 미구현 = 패리티 갭 아님)**: 브랜드 CRUD · 색상 편집 · 옵션 관계(includes/excludes) **편집** · 모델/트림 이미지 업로드.

## 차량 관리 현황 (Phase 1 완료, 전부 머지)

- 백엔드 `catalog-admin.ts` + `routes/catalog.ts`(`/api/catalog/...`): 모델·트림·옵션 CRUD + 집계 + reorder(`batch_update_sort_order` RPC) + canonical + 할인 + `assignMcCodes`(미부여 trim_code 채번 활성+`trim_code_history` max+1→`auto_mc_code` 트리거) + `listModelOptionSummary`(배지) + `setTrimNoOption`/`unsetTrimNoOption` + `moveTrims`(model_id 변경+대상 max+1로 sort_order 재부여). 쓰기는 `db`(postgres).
- 프론트 `MCMasterPage.tsx` + `pages/mc-master/`(BrandSidebar·ModelTable·ModelEditPanel·TrimTable·GroupedTrimTable·TrimEditPanel·**OptionPanel**·**MoveTrimsDialog**·trim-grouping·trim-cells·trim-format·**option-badge**·**option-relations**·reorder) + `lib/catalog.ts` + `data/vehicle-taxonomy.ts`. 라우트 `/mc-master/:modelId`.
- 국산차 트림: `목록 보기`(서브라인 접이식 그룹 — `' - '` split·첫 그룹만 펼침·등급만) / `순서 관리`(평면, 선택 시 드래그+일괄삭제+`모델 이동`) 탭. 수입차는 탭 없이 평면. 트림 헤더 `고유번호 할당`(mc_code null일 때만).
- 트림 수정 패널: 트림명·상태(+단종 배너)·가격·연식·연료·구동·배기량·변속기·차체·인승·자사/제휴/타사 할인(정규화명 RO·앱 순서). 옵션 패널: 기본/튜닝 탭 CRUD(가격 만원)·무옵션 확정 토글·관계 표식(색점·⇄/⇒, 편집은 Phase 2). 트림 행 배지: 옵션 있음(파랑수)/무옵션확정(✓)/미정(?). 색상 칩 hover 말풍선.

## A2 master 통합 (선행, 머지 완료)

- schema 3분할 prod 실재: public 앱19 / catalog 차량9 / crm 운영8. `DATABASE_URL`=master.
- Phase A(#21) crm 8테이블 · Phase B/C(#22) catalog 직결(거울 `deleted_at` 제거)·거울 sync 폐기·`crm.quotes→catalog` FK(SET NULL).

## ⚠️ Caveats

- **삭제는 선택 모드 일괄삭제만**(per-row 삭제 없음, 앱과 동일). 드래그 reorder는 HTML5 native(고스트 기본). 더 매끈하게는 @dnd-kit 도입 옵션.
- **catalog FK SET NULL만**(앱 삭제 비차단). public FK는 loose id 보류(앱 경계). `quotes.primary_scenario_id→quote_scenarios` 순환 FK 보류.
- `status`는 `public.car_status`(cross-schema) → catalog.ts는 `text`. status 필터 미적용(단종 노출). **상태 라벨=앱 원값(사전예약·블라인드)**. 단종 모델 트림 상태 제약: 서버 트리거 + **클라 배너(TrimEditPanel)+저장 비활성** 이중 방어.
- mc_code: `prevent_trim_code_change`는 최초 부여만 허용(기존값 변경 차단). sort_order는 추가/이동 시 트리거·코드가 `max+1`로 부여, 드래그 1회로 전체 `1..N` 정돈(`batch_update_sort_order`).
- 모델 이동: **같은 브랜드만**(대상). sort_order만 대상 max+1 재부여(앱은 미재부여=충돌위험, CRM 보강). trim_code/mc_code/canonical은 트리거가 변경 차단→유지(mc_code stale, 앱 동일).
- **bun API 핫리로드 없음** → 새 `/api/catalog/*` 라우트(할인 PATCH·assign-codes·option-summary·no-option·trims/move 등)는 dev 서버 재시작 후 동작.
- db env: drizzle-kit이 `.env.local` 자동로드 안 함 → `drizzle.config(.catalog).ts`가 readFileSync 주입. exposed schemas에 catalog 금지.
- knip pre-existing exit=1(main 동일). lint/typecheck/test는 0.

## Next — CRM 도메인(고객·견적) DB 연결

- **고객/견적 mock UI를 master `crm` 스키마(8테이블)에 백엔드 API로 연결.** 차량 관리가 끝났으니 이게 다음 본 작업(세션명 `database-migration`).
- **설계 스펙 이미 있음**(읽고 시작): `ref/specs/2026-06-17-crm-customers-schema-design.md` · `crm-quotes-schema-design.md` · `crm-db-connection-migration-design.md`.
- 추천 순서: ① 고객(`crm.customers`, 니즈 인라인) 읽기/쓰기 연결(`CustomerManagementPage`/`CustomerDetailPage` mock 대체) → ② 견적(`crm.quotes`/`quote_scenarios`).
- 차량 카탈로그(`/api/vehicles` read)·`/mc-master`(write)는 완료 → 견적이 트림/옵션/색상 선택을 참조. 할인·취득세·`lease_calc.ts` 포팅은 별개 트랙.
- 차량 관리 Phase 2(브랜드/색상/관계 편집·이미지)는 앱에도 없어 후순위. 앱 패리티 기준: `/Users/tobedoit/Documents/Flutter/mr-cha-app`.

## Verification (2026-06-18)

- `typecheck` 0 · `lint` 0 · `test:unit` 84/84 · `test:server`(master) 20/20 · `build` OK.
- tx 롤백 테스트(prod 무변경): reorder · assignMcCodes(실제 mc_code 생성) · 옵션 요약/무옵션 토글 · moveTrims(이동+sort_order 재부여). 서버 테스트는 `bun test --env-file=.env.local`. 4연속 추가 sort_order 충돌 없음 실증 완료. 화면 검증은 dev 재시작 후 수동(헤드리스 미설치).

## Collaboration

- (Codex 세션) User=이사님, assistant=영실. (Claude Code 세션) 호칭은 CLAUDE.md 팀 구성(송실장/유슨생).
- 판단 질문(`어때`/`괜찮을까`/`너 생각은?`): 추천·트레이드오프 먼저 + `적용할까요?`. 실행어(`응`/`해줘`/`진행해`): 즉시 실행.
- 팀 공유 결정·맥락은 git(`ref/*.md`, `AGENTS.md`)에. 로컬 메모리는 공유 안 됨.
</content>
