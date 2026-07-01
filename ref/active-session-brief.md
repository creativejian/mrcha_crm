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

- 최신 재개 후보 1: `crm-analyst` brainstorming. CRM 전용 Supabase Edge Function을 신설해 staff/admin용 업무 AI와 서류 자동분류를 도입하는 방향까지 결정했고, spec 전 단계에서 중단됐다.
- 최신 재개 후보 2: 고객 상세 거대 컴포넌트 분해. 로컬 통합 브랜치 `refactor/crm-detail-decomposition`에서 주요 영역 추출과 브라우저 검증까지 진행했고, 마무리/정리/PR 단계가 남아 있다.
- 완료된 고객/견적/서류/니즈/상세 저장 관련 세부 이력은 main git/PR 기록과 관련 specs/plans를 기준으로 본다.

## crm-analyst 결정 요약

- 고객용 앱 `ai-analyst`와 분리된 CRM 전용 `crm-analyst` Edge Function을 만든다.
- Provider는 앱과 같은 Gemini를 우선한다.
- 공통 기반: 함수 스캐폴드, staff 인증 게이트, Gemini fetch/retry/error 유틸, SSE 골격 재사용.
- 첫 슬라이스는 서류 자동분류다. 프론트가 업로드 전 `crm-analyst`를 직접 invoke해 `docType`을 확정하고 기존 CF Workers 업로드 경로는 유지한다.
- 대상은 현 `classifyKimDocumentFile` 파일명 regex 분류 자리와 22종 `DOC_TYPE_OPTIONS` enum 프롬프트다.
- 다음 brainstorming에서 정할 것: 자동확정 vs 제안, regex 폴백 여부, 동기/비동기, staff gate 상세, 저신뢰 처리, 비용.

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

## Files / References

- Main UI: `client/src/pages/CustomerDetailPage.tsx`
- Customer detail components/hooks: `client/src/components/customer-detail/`
- CRM AI 후보: `supabase/functions/crm-analyst` 신설 예정
- Auth/spec references: `ref/specs/2026-06-18-crm-auth-design.md`, `ref/plans/2026-06-18-crm-auth-*.md`
- Decomposition references: `ref/specs/2026-06-29-crm-detail-decomposition-design.md`, `ref/plans/2026-06-29-crm-detail-decomposition.md`
- Purchase conditions references: `ref/specs/2026-06-30-crm-purchase-conditions-persist-design.md`, `ref/plans/2026-06-30-crm-purchase-conditions-persist.md`

## Verification / Next

- DOM or TypeScript changes: run `bun run typecheck`.
- Broader CRM changes: run `bun run typecheck`, `bun run lint`, `bun run test:unit`, and `bun run build` when feasible.
- Large visual layout changes: use browser/screenshot verification after stabilization, not after every spacing tweak.
- Current likely next step: 이사님이 `CRM 이어가자`라고 하면 먼저 `crm-analyst` brainstorming을 이어갈지, 고객 상세 분해 마무리를 이어갈지 확인한다.

## Collaboration

- User is `이사님`; assistant is `영실`.
- Judgment questions: give recommendation first, ask `적용할까요?`.
- Execution words like `응`, `해줘`, `적용해`, `진행하자`: implement directly.
