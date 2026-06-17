# Mr. Cha CRM Active Session Brief

Last updated: 2026-06-17

Purpose: `영실아 이어가자` / `CRM 이어가자` 이후 현재 작업만 빠르게 복구하기 위한 압축 문서.

## Boot

1. Read this file first.
2. Run `git status --short --branch` and `git log --oneline --decorate --max-count=5`.
3. Read `ref/current-working-state.md` only if this is insufficient.
4. Planning source files only when the task touches strategy/roadmap/AI policy/architecture/quote engine.

## Current Focus (2026-06-17)

- **master Supabase 직접 통합 — 협상 완결 → 설계 → 구현 시작.** schema 3분할(public 앱 / catalog 차량 / crm 운영)이 **prod에 실재**.
- **앱 팀: Phase ① prod 적용 완료** (catalog + 차량 9테이블 SET SCHEMA + public 호환 view + RPC(provision_staff_role·assign_trim_codes) + 트리거(단종·status·표기법). V1 anon read·V2 embedding 라이브 통과).
- **CRM: A2 Phase A 머지 완료**(PR #21, `aebaf57`) — `crm` 스키마 8테이블 master에 생성(public 28·catalog 9 불가침). `DATABASE_URL` master repoint 완료.
- **남은:** catalog adopt(introspect) + 외부 FK(crm→catalog/public) + Phase C(거울 폐기 + 차량 API 전환).

## 오늘 작업 (전부 main)

- main docs/spec 커밋: ⓑ Phase① GO패키지(`1d67ed8`) · ⓐ 견적스키마(`3698772`) · db:push 가드레일(`1a29ca8`) · A2 전환 design(`a34f1f5`) · brief(`4942e61`) · batch/exposed 정정(`d819fc1`) · A1 고객스키마 design(`8396668`).
- **PR #21 머지(`aebaf57`)**: A2 Phase A — `schema.ts` crm 8테이블 + drizzle config `.env.local` 직접 로드 + plan.
- **master DB: crm 8테이블 생성됨** — customers(니즈 1:1 인라인)·customer_tasks·schedules·documents·memos·consultations·quotes·quote_scenarios.

## Specs / Plans (master 통합)

- specs: `2026-06-17-phase1-go-and-verification`(ⓑ) · `crm-quotes-schema-design`(ⓐ) · `crm-customers-schema-design`(A1) · `crm-db-connection-migration-design`(A2) · `2026-06-16-master-supabase-integration` · `2026-06-16-vehicle-admin-handoff`(Phase① 9종)
- plans: `2026-06-17-crm-schema-phase-a`

## ⚠️ Caveats

- **A2 전환 순서**(진행도): db:push 제거✅ → schemaFilter `["crm"]`✅ → DATABASE_URL master repoint✅ → crm migrate✅ → **[남음] catalog adopt → 거울 폐기**. (repoint 역전 금지 규칙은 이미 통과)
- **db env**: drizzle-kit이 `.env.local` 자동로드 안 함 → `drizzle.config(.catalog).ts`가 `readFileSync`로 직접 주입(plain `db:migrate`/`db:pull:catalog` 작동, `--env-file` 불필요).
- catalog 외부 FK(`crm.quotes→catalog.trims` 등)는 adopt 후 추가(Phase B 잔여). crm 테이블은 FK 없이도 작동.
- 거울+sync(`src/sync/`, PR#18~19)는 Phase C에서 폐기 예정.
- 계산값(월납입/금리)·취득세(Gemini 추출)는 별개(`lease_calc.ts` 포팅).
- **exposed schemas에 catalog 추가 금지**(prod 비노출 확정 — `public, graphql_public`만).

## 이전 완료 (압축 — 상세는 spec/current-working-state)

- 차량 파이프라인: 거울 import → 조회 API(`/api/vehicles`) → 프론트 선택(가격/옵션/색상 PR#13~17) → sync(PR#18~19). **거울/sync는 Phase C 폐기 예정.**
- 클라이언트 라우팅 react-router(PR#20).
- 김민준 워크벤치 견적 UI: `client/src/pages/CustomerDetailPage.tsx`. mock 저장 → `crm.quotes` DB화 예정.

## Next

- **catalog adopt**(`db:pull:catalog` introspect baseline) + 외부 FK + **Phase C**(`src/sync/` 폐기 + 차량 API `client.ts`/`queries/vehicles.ts`/`routes/vehicles.ts` → master catalog 직접) — 별도 plan.
- 견적/고객 mock ↔ crm DB 연결.
- 라우팅 2단계(하위모드·고객 딥링크) 등은 이후.

## Verification (2026-06-17)

- Phase A: `typecheck` 0 · `lint` 0 · `db:generate`(crm 8테이블, public 무관 SQL) · `db:migrate`(master crm 생성, public 28·catalog 9 불변 검증).
- `vehicles.test.ts` 5건은 pre-existing 환경 fail(`DATABASE_URL` 미주입, main 동일) — Phase A 회귀 0. Phase C(거울 폐기)에서 catalog 직접 read로 정리.

## Collaboration

- (Codex 세션) User=이사님, assistant=영실. (Claude Code 세션) 호칭은 CLAUDE.md 팀 구성(송실장/유슨생).
- 판단 질문(`어때`/`괜찮을까`/`너 생각은?`): 추천·트레이드오프 먼저 + `적용할까요?`. 실행어(`응`/`해줘`/`진행해`): 즉시 실행.
- 팀 공유 결정·맥락은 git(`ref/*.md`, `AGENTS.md`)에. 로컬 메모리는 공유 안 됨.
