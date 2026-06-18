# Mr. Cha CRM Active Session Brief

Last updated: 2026-06-18

Purpose: `영실아 이어가자` / `CRM 이어가자` 이후 현재 작업만 빠르게 복구하기 위한 압축 문서.

## Boot

1. Read this file first.
2. Run `git status --short --branch` and `git log --oneline --decorate --max-count=5`.
3. Read `ref/current-working-state.md` only if this is insufficient.
4. 설계/계획은 `ref/specs/2026-06-18-crm-auth-*.md`, `ref/plans/2026-06-18-crm-auth-*.md`.

## Current Focus (2026-06-18) — CRM 인증 (카카오 로그인 + role 게이트 + Cloudflare)

- **브랜치 `feat/crm-auth`** (main 미머지). **백엔드 완료**, **프론트 plan 실행 대기**.
- 설계: `ref/specs/2026-06-18-crm-auth-design.md`. 선행 체크리스트: `ref/crm-auth-supabase-setup.md`.
- 차량 관리(`/mc-master`)는 이전에 완료/머지(앱 패리티). 인증 후 본 작업은 CRM 도메인(고객·견적) DB 연결.

## 완료 (feat/crm-auth)

- **백엔드 인증**: JWKS edge 검증(jose) + JWT top-level `user_role` claim 게이트(`customer`/무토큰 차단, staff/manager/admin/dealer 허용). `src/auth/verify.ts`(verifyAndGate) · `src/middleware/auth.ts`(createAuthMiddleware 주입형 팩토리) · `src/app.ts`(createApp 팩토리, `/api/vehicles·catalog` 보호) · `src/auth/test-jwt.ts`. `test:server` 28 · `test:unit` 91 pass. subagent-driven 4 task + 2단계 리뷰 + final review 완료.
- **선행(Supabase/CF)**: `user_role` enum에 `dealer` 추가 ✅ · Custom Access Token Hook(`profiles.role`→`user_role` claim) 활성 ✅ · redirect allowlist(`crm.mrcha.app`) ✅ · CF Pages 프로젝트+GitHub 연결+`crm.mrcha.app` 도메인 ✅ (배포 X).
- **남은 선행**: `VITE_SUPABASE_URL`·`VITE_SUPABASE_PUBLISHABLE_KEY`(Settings→API) → `.env.local` · CF 환경변수(`SUPABASE_URL` 등, 배포 시).

## Next — 프론트 인증 plan 실행

- **`ref/plans/2026-06-18-crm-auth-frontend.md` 를 subagent-driven으로 실행** (같은 `feat/crm-auth` 브랜치). 7 task:
  ① `roleTabFromClaim` 매핑(TDD) → ② supabase 클라이언트+env → ③ `apiFetch` 토큰주입(TDD)+catalog·vehicles 교체 → ④ `lib/auth` 카카오 로그인/role claim → ⑤ `AuthProvider`/useAuth → ⑥ `LoginPage`+`RequireAuth` 가드 → ⑦ App·main 통합(mock 역할 탭 제거, role 고정).
- 완료 후 **백엔드+프론트 통합 main 머지**. 로컬 e2e(카카오 로그인→role별 화면, customer 거부)는 선행 키/env 후.

## ⚠️ Caveats

- **백엔드 단독 머지 금지** — 프론트가 토큰을 안 보내면 모든 `/api`가 401 → `/mc-master` 등 깨짐. 프론트까지 끝내고 통합 머지.
- claim 방식 → role 변경이 토큰 갱신(~1h)/재로그인까지 반영 안 됨(강등 즉시차단은 후속, `auth.admin.signOut`).
- `bun` API 핫리로드 없음. 미들웨어 `SUPABASE_URL`은 `c.env ?? process.env`. Hook RLS 정책 누락 시 claim null(=403).
- 프론트 plan **Task 7(App/Sidebar 통합)**은 큰 파일 — 불명확하면 멈추고 보고(DONE_WITH_CONCERNS).

## Verification (백엔드, 2026-06-18)

- `typecheck` 0 · `lint` 0 · `test:server` 28(--env-file=.env.local) · `test:unit` 91. 서버 테스트는 로컬 키쌍으로 JWT 서명→로컬 JWKS 검증(원격 우회).

## Collaboration

- (Codex 세션) User=이사님, assistant=영실. (Claude Code 세션) 호칭은 CLAUDE.md 팀 구성(송실장/유슨생).
- 판단 질문(`어때`/`괜찮을까`/`너 생각은?`): 추천·트레이드오프 먼저 + `적용할까요?`. 실행어(`응`/`해줘`/`진행해`): 즉시 실행.
- 팀 공유 결정·맥락은 git(`ref/*.md`, `AGENTS.md`)에. 로컬 메모리는 공유 안 됨.
