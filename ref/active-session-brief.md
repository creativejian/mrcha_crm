# Mr. Cha CRM Active Session Brief

Last updated: 2026-07-02

Purpose: `CRM 이어가자`, `CRM 시작하자`, `영실아 이어가자` 이후 현재 CRM 작업만 빠르게 복구하기 위한 압축 문서다. 완료된 세부 로그는 git/PR과 `ref/specs|plans`를 기준으로 확인한다.

## Boot

1. Read CRM `AGENTS.md`.
2. Read this file.
3. Run `git status --short --branch` and `git log --oneline --decorate --max-count=5`.
4. Read `ref/current-working-state.md` only if this is insufficient.
5. Do not read planning source files unless the task touches strategy, roadmap, AI policy, architecture, or quote engine decisions.

## Current Focus

- 최신 진행: `crm-analyst` 서류 자동분류 **완료**(Edge Function 배포 + PR #129 머지). 후속으로 담당자 배정 DB 영속 버그 수정 머지(#130 — `crm.customers.advisor_name` 추가, `saveAdvisorField`→`savePatch` 연결, 목록 `advisor` 하드코딩 제거). 상세는 아래 요약.
- 고객 상세 거대 컴포넌트 분해: **완료로 종결**. 9영역 추출이 이미 main 반영(`CustomerDetailPage.tsx` 5437→303줄), stale 브랜치 `refactor/crm-detail-decomposition` 삭제됨. 잔여는 `kim`→범용 리네임(순수 이름 정리·기능 무변경·저우선)뿐.
- 슬라이스B 업무 AI 채팅 **완료·머지**(PR #132, 2026-07-02): pgvector RAG(`crm.embeddings` 3072)로 Topbar 업무 AI 실동작. 상세는 아래 요약.
- 다음 후보: ①**crm.staff/팀 파운데이션**(권한 scope 실제화 — `resolveCustomerScope` manager=팀/staff=본인, 리스트/상세 scope에도 재사용; B1이 남긴 최우선 의존) ②채팅 히스토리 영속 ③`kim`→범용 리네임(데이터화 슬라이스 때).
- 완료된 고객/견적/서류/니즈/상세 저장 관련 세부 이력은 main git/PR 기록과 관련 specs/plans를 기준으로 본다.

## crm-analyst 서류 자동분류 (완료 — 배포 + #129 머지)

- **spec** `ref/specs/2026-07-01-crm-analyst-document-classify-design.md` · **plan** `ref/plans/2026-07-01-crm-analyst-doc-classify.md`(8 Task, TDD).
- **결정**: ①함수 소스=CRM 레포 신설(`supabase/functions/crm-analyst/`, git 응집도) ②자동확정+사후수정(현 '파일 캐비닛' 흐름 유지) ③regex=폴백 체인(vision→unknown/에러→regex→기타서류) ④모델 `gemini-3.1-flash-lite`(앱 동일) ⑤호출흐름 A(프론트 직접 invoke). Edge=vision+unknown만, regex 폴백은 프론트 lib(책임 분리).
- **✅ Task 1~7 완료(Edge Function 백엔드 + 프론트 통합)**: 스캐폴드+deno config+eslint ignore · `doc-types.ts`(22종/프롬프트/responseSchema, 프론트 `DOC_TYPE_OPTIONS`와 byte-identical) · `auth.ts`(staff JWT 게이트, `src/auth/verify.ts` 재현) · `gemini.ts`(vision 호출+에러분류+재시도) · `index.ts`(Hono 조립 CORS+인증+분류, **미들웨어 `*`로 인증 우회 방지**, CORS allowHeaders에 x-client-info·apikey) · 프론트 `document-classify.ts`(AI 분류+regex 폴백, base64 32KB 청크) · `useCustomerDocuments` 교체+파일별 병렬화(optimistic "분류 중…"→"AI분류", tempId에 index 포함). 각 Task spec+quality 2단계 리뷰 + 전체 최종 리뷰(opus) 통과. 검증 typecheck0·lint0·test:unit**272**·deno test**13** 전부 green.
- **✅ Task 8 배포 완료**: master(`wmkbmlespgzkeekliwio`)에 `supabase functions deploy crm-analyst`로 배포(공유 master라 함수명 지정해 앱 함수 불가침). GEMINI_API_KEY는 프로젝트 전역 secret 재사용. staff 브라우저 검증 OK. (미배포/GEMINI 미설정이어도 프론트 regex 폴백이라 업로드는 계속 동작.)
- **follow-up**: ①`nextSortOrder` race(`src/db/queries/customer-documents.ts` `max(sort_order)+1` 비트랜잭션 — 병렬 업로드 시 sort_order 중복, **표시순서만·데이터 무결성 OK**, 백엔드 트랜잭션 fast-follow) ②재무제표 당해/전기 프롬프트 시간앵커(당해=최근연도 명시 or Date 주입 — 배포 후 실측 튜닝) ③`deno.lock`(root+`supabase/functions/`) untracked — 커밋 vs .gitignore 결정(재현성은 import_map 버전핀 hono@4.6.14/jose@6.2.3로 이미 확보).
- **다음 슬라이스(후속)**: 슬라이스B 완료(#132, 아래 요약).

## 슬라이스 B1 업무 AI 채팅 (완료 — #132 머지)

- **spec** `ref/specs/2026-07-02-crm-work-ai-chat-design.md` · **plan** `ref/plans/2026-07-02-crm-work-ai-chat.md`(12 Task, TDD, subagent-driven).
- pgvector RAG 수직 슬라이스: `crm.embeddings`(vector 3072 + halfvec HNSW, customer FK cascade; 마이그 0012·0013) ← 백필 `src/scripts/backfill-embeddings.ts`(코퍼스=메모/할일/상담이력/니즈3필드). `POST /api/assistant/ask`(staff JWT, `src/routes/assistant.ts`, `assistantDeps` 주입) = `resolveCustomerScope`→질문임베딩→pgvector top-k(halfvec cosine)→Gemini `gemini-3.1-flash-lite` 생성→`{answer,sources}`. 프론트 `client/src/lib/assistant.ts`+Topbar 팝오버 실연결(단일샷·평문). 임베딩 모델 `gemini-embedding-001`(3072).
- 검증: 백엔드 144·프론트 274·typecheck0·lint0·build·백필 29/29·RAG 실 Gemini end-to-end·브라우저 스모크 통과.
- **scope=admin(v1)**: `resolveCustomerScope`(`src/lib/assistant-scope.ts`)가 `"all"` 반환하는 seam. manager=팀/staff=본인은 **후속 crm.staff/팀 파운데이션 슬라이스가 이 함수 본문만 교체**(호출부 불변, 리스트/상세 scope에도 재사용). 팀 개념 데이터 전무(profiles=team 없음·불가침, staff 계정 0)라 파운데이션 선행 필요.
- **프로덕션**: `GEMINI_API_KEY` CF Pages 시크릿(Production) 설정 완료. 임베딩 데이터는 공유 master라 이미 적재(백필 실행됨). `c.env.GEMINI_API_KEY ?? process.env`로 읽음.
- **follow-up(별도)**: ①채팅 히스토리 영속(현재 `aiTurns` 메모리라 리로드 시 소실 — 의도된 v1; localStorage or `crm.assistant_messages`) ②멀티턴·스트리밍 ③content_hash 재임베딩 skip·백필 배치청킹·유사도 임계값(현재 top-k 항상 반환) ④견적 코퍼스 확장.

## 고객 상세 분해 요약

- 목표: `KimMinjunDetailContent`를 영역별 hook + presentation component로 분해하고 `kim` 전용명을 범용화한다.
- 완료된 추출 영역: 헤더, 메모, 할일, 일정, 서류, 상태/워크플로우, 구매조건, 니즈, 견적함 목록, 견적 워크벤치.
- 부모는 cross-cutting 상태와 핸들러만 보유한다: `openEditor`, `setOpenEditor`, `toggleEditor`, `savePatch`, `markRecentUpdate`, `kimEditorMatches` 등.
- 견적 워크벤치는 9b~9e를 단일 훅으로 통합하는 방향으로 확정했다. 내부 결합이 강해 4분할은 props 폭발 위험이 컸다.
- 브라우저 검증: 구매조건/니즈, 견적함/워크벤치, 앱카드, PDF원본, 작성완료 INSERT/UPDATE, 발송, 딥링크/prefill까지 검증 완료로 기록되어 있다.
- 남은 일: 없음(분해·검증·main 반영 완료, stale 브랜치 삭제). 선택적 후속 = `kim`→범용 리네임(기능 무변경, 저우선).
- **`kim` 리네임 적기(2026-07-01 확정)**: 지금 단독 실행 ❌(export 심볼 100+·파일 13·참조 800+ 대규모 churn, 저가치). **적기 = "mock→DB 데이터화/전체표준 일반화" 슬라이스 착수 시.** 이유: 김민준 시드 심볼(`kimMinjun*`·`kimMaybach*`·`kimManual*Cards`·`KimAppCardPreview`)이 그때 실 DB 데이터로 대체돼 이름이 어차피 바뀌므로, 범용 유틸(`formatKim*`·`parseKim*`·`kim*Options`)의 kim 제거를 한 PR로 얹으면 churn 흡수. 데이터화 슬라이스 시작할 때 이 항목 먼저 꺼낼 것. `data/prototype.ts`·`QuotesPage`·`ChatPage`의 "김민준" 목업 문자열은 건드리지 말고 심볼만 정규식으로.

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
- Backend(Hono) 테스트는 `bun run test:server`(bun:test, `--env-file=.env.local`로 실 master DB), 프론트는 `bun run test:unit`(vitest).
- Current likely next step: `crm-analyst`·배정·상세분해·**슬라이스B 업무 AI(#132)** 모두 완료·머지됨. 다음 후보 = **crm.staff/팀 파운데이션**(권한 scope 실제화 — B1의 `resolveCustomerScope` seam 본문 교체, 리스트/상세 scope 공용) > 채팅 히스토리 영속 > `kim` 리네임(데이터화 때). 신규 brainstorming→spec→plan.

## Collaboration

- User is `이사님`; assistant is `영실`.
- Judgment questions: give recommendation first, ask `적용할까요?`.
- Execution words like `응`, `해줘`, `적용해`, `진행하자`: implement directly.
