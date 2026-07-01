# Mr. Cha CRM Active Session Brief

Last updated: 2026-07-01

Purpose: `CRM 이어가자`, `CRM 시작하자`, `영실아 이어가자` 이후 현재 CRM 작업만 빠르게 복구하기 위한 압축 문서다. 완료된 세부 로그는 git/PR과 `ref/specs|plans`를 기준으로 확인한다.

## Boot

1. Read CRM `AGENTS.md`.
2. Read this file.
3. Run `git status --short --branch` and `git log --oneline --decorate --max-count=5`.
4. Read `ref/current-working-state.md` only if this is insufficient.
5. Do not read planning source files unless the task touches strategy, roadmap, AI policy, architecture, or quote engine decisions.

## Current Focus

- 최신 진행: `crm-analyst` 서류 자동분류. CRM 전용 Supabase Edge Function으로 서류함 업로드 시 파일명 regex 분류를 Gemini vision 분류로 격상(실패·불확실 시 regex 폴백)했다. brainstorming→spec→plan→subagent-driven 풀사이클로 **Task 1~7(코드 전체) 완료·최종 리뷰 READY TO DEPLOY**, 남은 건 Task 8 배포뿐이다. 브랜치 `feat/crm-analyst-doc-classify`(미push, 최신 main 위 rebase됨). 상세는 아래 요약.
- 재개 후보 2: 고객 상세 거대 컴포넌트 분해. 로컬 통합 브랜치 `refactor/crm-detail-decomposition`에서 주요 영역 추출과 브라우저 검증까지 진행했고, 마무리/정리/PR 단계가 남아 있다.
- 완료된 고객/견적/서류/니즈/상세 저장 관련 세부 이력은 main git/PR 기록과 관련 specs/plans를 기준으로 본다.

## crm-analyst 서류 자동분류 (Task 1~7 완료 · Task 8 배포만 남음)

- **spec** `ref/specs/2026-07-01-crm-analyst-document-classify-design.md` · **plan** `ref/plans/2026-07-01-crm-analyst-doc-classify.md`(8 Task, TDD).
- **결정**: ①함수 소스=CRM 레포 신설(`supabase/functions/crm-analyst/`, git 응집도) ②자동확정+사후수정(현 '파일 캐비닛' 흐름 유지) ③regex=폴백 체인(vision→unknown/에러→regex→기타서류) ④모델 `gemini-3.1-flash-lite`(앱 동일) ⑤호출흐름 A(프론트 직접 invoke). Edge=vision+unknown만, regex 폴백은 프론트 lib(책임 분리).
- **✅ Task 1~7 완료(Edge Function 백엔드 + 프론트 통합)**: 스캐폴드+deno config+eslint ignore · `doc-types.ts`(22종/프롬프트/responseSchema, 프론트 `DOC_TYPE_OPTIONS`와 byte-identical) · `auth.ts`(staff JWT 게이트, `src/auth/verify.ts` 재현) · `gemini.ts`(vision 호출+에러분류+재시도) · `index.ts`(Hono 조립 CORS+인증+분류, **미들웨어 `*`로 인증 우회 방지**, CORS allowHeaders에 x-client-info·apikey) · 프론트 `document-classify.ts`(AI 분류+regex 폴백, base64 32KB 청크) · `useCustomerDocuments` 교체+파일별 병렬화(optimistic "분류 중…"→"AI분류", tempId에 index 포함). 각 Task spec+quality 2단계 리뷰 + 전체 최종 리뷰(opus) 통과. 검증 typecheck0·lint0·test:unit**272**·deno test**13** 전부 green.
- **⏳ 남은 Task 8 배포(사용자, supabase 로그인 필요)**: `supabase login` → `supabase link --project-ref <master ref>` → `supabase secrets set GEMINI_API_KEY=<앱과 동일 키>`(SUPABASE_URL은 자동 주입) → **`supabase functions deploy crm-analyst`**(함수명 필수 — 공유 master라 앱 함수 보호) → staff 브라우저 검증(서류 드롭→"분류 중…"→"AI분류"·22종 정확도·오분류 수정 회귀). 미배포(404)·GEMINI 미설정(500)이어도 프론트는 regex 폴백이라 업로드는 계속 동작(점진 배포 안전).
- **follow-up**: ①`nextSortOrder` race(`src/db/queries/customer-documents.ts` `max(sort_order)+1` 비트랜잭션 — 병렬 업로드 시 sort_order 중복, **표시순서만·데이터 무결성 OK**, 백엔드 트랜잭션 fast-follow) ②재무제표 당해/전기 프롬프트 시간앵커(당해=최근연도 명시 or Date 주입 — 배포 후 실측 튜닝) ③`deno.lock`(root+`supabase/functions/`) untracked — 커밋 vs .gitignore 결정(재현성은 import_map 버전핀 hono@4.6.14/jose@6.2.3로 이미 확보).
- **다음 슬라이스(후속)**: 슬라이스B 업무 AI 채팅(현 `Topbar.tsx` 하드코딩 mock → Gemini + pgvector RAG). 별도 brainstorming→spec→plan.

## 고객 상세 분해 요약

- 목표: `KimMinjunDetailContent`를 영역별 hook + presentation component로 분해하고 `kim` 전용명을 범용화한다.
- 완료된 추출 영역: 헤더, 메모, 할일, 일정, 서류, 상태/워크플로우, 구매조건, 니즈, 견적함 목록, 견적 워크벤치.
- 부모는 cross-cutting 상태와 핸들러만 보유한다: `openEditor`, `setOpenEditor`, `toggleEditor`, `savePatch`, `markRecentUpdate`, `kimEditorMatches` 등.
- 견적 워크벤치는 9b~9e를 단일 훅으로 통합하는 방향으로 확정했다. 내부 결합이 강해 4분할은 props 폭발 위험이 컸다.
- 브라우저 검증: 구매조건/니즈, 견적함/워크벤치, 앱카드, PDF원본, 작성완료 INSERT/UPDATE, 발송, 딥링크/prefill까지 검증 완료로 기록되어 있다.
- 남은 일: 부모 리네임, 잔여 `kim` 정리, cleanup 묶음, 통합 PR.

## 최근 완료 요약

- 니즈 앱 카드 늦은 로딩: 고객별 cache+TTL+dedupe와 hover prefetch로 완료.
- 상세 수정 즉시 반영: savePatch/task mutation 성공 시 목록 reload 경로 보강 완료.
- 상세 구매조건 7필드 저장: `crm.customers` 컬럼과 CHECK/상수 SSOT, 낙관/롤백 저장 경로 완료.
- 고객 니즈 영역 앱 견적요청 카드 목록: 앱 유입 고객은 여러 견적요청 카드, 수기 고객은 기존 단일 need 카드 유지.
- 고객 상세 전체 고객 일반화, 서류 업로드/미리보기/분류, 견적 읽기/쓰기/생성/원본 업로드, 워크벤치 저장/발송 흐름은 main에 머지된 완료 항목으로 본다.
- 의존성 minor/patch 일괄 bump(#127, @types/node major는 24 라인 유지).

## Files / References

- Main UI: `client/src/pages/CustomerDetailPage.tsx`
- Customer detail components/hooks: `client/src/components/customer-detail/`
- CRM AI: `supabase/functions/crm-analyst/`(Task 1~7 완료, 배포 대기) + 프론트 `client/src/lib/document-classify.ts`
- crm-analyst references: `ref/specs/2026-07-01-crm-analyst-document-classify-design.md`, `ref/plans/2026-07-01-crm-analyst-doc-classify.md`
- Auth/spec references: `ref/specs/2026-06-18-crm-auth-design.md`, `ref/plans/2026-06-18-crm-auth-*.md`
- Decomposition references: `ref/specs/2026-06-29-crm-detail-decomposition-design.md`, `ref/plans/2026-06-29-crm-detail-decomposition.md`
- Purchase conditions references: `ref/specs/2026-06-30-crm-purchase-conditions-persist-design.md`, `ref/plans/2026-06-30-crm-purchase-conditions-persist.md`

## Verification / Next

- DOM or TypeScript changes: run `bun run typecheck`.
- Broader CRM changes: run `bun run typecheck`, `bun run lint`, `bun run test:unit`, and `bun run build` when feasible.
- Edge Function(Deno) changes: `deno test/lint/check --config supabase/functions/deno.json ...`.
- Large visual layout changes: use browser/screenshot verification after stabilization, not after every spacing tweak.
- Current likely next step: `crm-analyst` 서류 자동분류는 **Task 8 배포만 남음**(위 요약). 배포 후 브라우저 검증 → 그 다음 슬라이스B(업무 AI 채팅) 또는 고객 상세 분해 마무리 중 선택.

## Collaboration

- User is `이사님`; assistant is `영실`.
- Judgment questions: give recommendation first, ask `적용할까요?`.
- Execution words like `응`, `해줘`, `적용해`, `진행하자`: implement directly.
