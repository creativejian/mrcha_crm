# Mr. Cha CRM Active Session Brief

Last updated: 2026-06-17

Purpose: `영실아 이어가자` / `CRM 이어가자` 이후 현재 작업만 빠르게 복구하기 위한 압축 문서.

## Boot

1. Read this file first.
2. Run `git status --short --branch` and `git log --oneline --decorate --max-count=5`.
3. Read `ref/current-working-state.md` only if this is insufficient.
4. Planning source files only when the task touches strategy/roadmap/AI policy/architecture/quote engine.

## Current Focus (2026-06-17)

- **master Supabase 직접 통합 — CRM 데이터 아키텍처 brainstorming 진행 중** (A안: CRM 설계 먼저).
- 5갈래 분해(앱 팀 Phase ① 의존 여부로 가름): ⓐ crm 운영 스키마 / A2 DB 연결 전환 / 차량 콘솔 / CRM 인증 / catalog adopt.
- 앱 팀: **Phase ① PR #386** 진행 중(9종 단일 트랜잭션 마이그레이션 267줄). V2(embedding)·V7(FK) 실측 통과, V1·V3~V8은 적용 시점 게이트.

## 오늘 작업 (4커밋, 전부 origin push)

- `1d67ed8` ⓑ Phase ① GO 패키지 — embedding 리스크 실측 통과 → **view-only로 GO**(computed relationship 불필요), 공동 검증 V1~V8 + 역할분담.
- `3698772` ⓐ crm 견적 스키마 design — `crm.quotes`(견적 1건 = 금융 시나리오 1~3 묶음) + `crm.quote_scenarios` + `crm.customers`(최소 골격). snapshot 원칙, app 견적 nullable 출처 참조.
- `1a29ca8` db:push 제거 + tech-stack 정정 (master public 앱 테이블 DROP 방어).
- `a34f1f5` A2 DB 연결 전환 설계 (전환 순서 역순 금지).

## Specs (master 통합 관련)

- `ref/specs/2026-06-17-phase1-go-and-verification.md` (ⓑ GO/검증)
- `ref/specs/2026-06-17-crm-quotes-schema-design.md` (ⓐ 견적 스키마)
- `ref/specs/2026-06-17-crm-db-connection-migration-design.md` (A2 전환)
- `ref/specs/2026-06-16-master-supabase-integration.md` (아키텍처 합의)
- `ref/specs/2026-06-16-vehicle-admin-handoff.md` (Phase ① 9종 상세)

## ⚠️ Caveats

- **A2 전환 순서 역순 금지**: ⓪db:push 제거(완료) → schema `crm` pgSchema + `schemaFilter:["crm"]` → `DATABASE_URL` master repoint → catalog adopt → 거울 폐기. **repoint를 먼저 하면 앱 테이블 DROP 사고.**
- catalog FK(`crm.quotes→catalog.trims` 등)는 catalog adopt(Phase B) 후라야 정의 가능.
- 거울+sync(`src/sync/`, PR #18~19)는 master 통합으로 **폐기 예정**.
- 계산값(월납입/금리)·취득세(Gemini 추출)는 별개(`lease_calc.ts` 포팅).

## 이전 완료 (압축 — 상세는 각 spec / current-working-state)

- 차량 파이프라인: 거울 import → 조회 API(`/api/vehicles`) → 프론트 선택(가격/옵션/excludes/색상, PR #13~17) → sync(PR #18~19). **master 통합으로 거울/sync 폐기 예정.**
- 클라이언트 라우팅 react-router (PR #20).
- 김민준 워크벤치 견적 UI: `client/src/pages/CustomerDetailPage.tsx`(+`index.css`). 견적 mock 저장(DB 미연결) → ⓐ로 DB화 예정.

## Next

- **PR #386 CRM 정합 리뷰**(적용 전): FK 대상(catalog.trims/colors/trim_options) · view 단순 `SELECT *` 불변식 · RPC 시그니처(provision_staff_role/assign_trim_codes) · catalog PostgREST 비노출 · 트리거 12 vs 13.
- `crm.customers` 전체 운영 모델(A1 다음 라운드: 진행상태·담당·유입·메모·계약/출고).
- 구현(drizzle migration·워크벤치↔DB)은 Phase ① 적용 + catalog adopt 후.

## Verification (2026-06-17)

- 오늘 변경 = 문서 + `package.json`(db:push 제거). JSON valid 확인. 코드(`client/src`·`src`) 변경 0 → typecheck/lint/test 영향 없음.

## Collaboration

- (Codex 세션) User=이사님, assistant=영실. (Claude Code 세션) 호칭은 CLAUDE.md 팀 구성(송실장/유슨생).
- 판단 질문(`어때`/`괜찮을까`/`너 생각은?`): 추천·트레이드오프 먼저 + `적용할까요?`. 실행어(`응`/`해줘`/`진행해`): 즉시 실행.
- 팀 공유 결정·맥락은 git(`ref/*.md`, `AGENTS.md`)에. 로컬 메모리는 공유 안 됨.
