# Mr. Cha CRM Active Session Brief

Last updated: 2026-06-18

Purpose: `영실아 이어가자` / `CRM 이어가자` 이후 현재 작업만 빠르게 복구하기 위한 압축 문서.

## Boot

1. Read this file first.
2. Run `git status --short --branch` and `git log --oneline --decorate --max-count=5`.
3. Read `ref/current-working-state.md` only if this is insufficient.
4. 인증 설계/플랜: `ref/specs/2026-06-18-crm-auth-design.md`, `ref/plans/2026-06-18-crm-auth-*.md`. CRM 도메인 스펙: `ref/specs/2026-06-17-crm-*`.

## Current Focus (2026-06-18) — CRM 인증 + CF 배포 **완료**. 다음=CRM 도메인(고객·견적) DB 연결

- 카카오 로그인 + role 게이트 + CF Pages 배포까지 **전부 main 머지·배포 완료**. **crm.mrcha.app 라이브**.
- 현재 DB 연결은 mc-master(차량 catalog)만. **다음 작업: CRM 도메인(고객·견적) DB 연결** (crm 8테이블, 스펙 `ref/specs/2026-06-17-crm-*`).

## 완료 (이번 세션, 전부 main 머지)

- **인증 통합 (#36)**: 백엔드 JWKS 게이트(top-level `user_role`, customer/무토큰 차단) + 프론트 카카오 로그인/AuthProvider/RequireAuth/`apiFetch` 토큰주입/role 고정(mock 역할탭 제거). `src/auth/*`·`src/middleware/auth.ts`·`src/app.ts`(createApp) · `client/src/lib/{supabase,api,auth}.ts`·`client/src/auth/*`.
- **CF 배포 정상화**: #37 SPA 라우팅(`functions/[[path]].ts`가 `/api`만 Hono, 나머지 정적+`_redirects`) · #38 prod VITE env(`.env.production` 커밋 + `wrangler.jsonc` vars `SUPABASE_URL`) · #39 onError 진단 · #40 연결 복원력.
- **DATABASE_URL → transaction pooler(6543)** (CF production+preview secret). CF Workers 동시 연결 한계 해결.
- **mc-master 연결 안정화 (#40)**: `apiFetch` GET 5xx 재시도(backoff+jitter, 쓰기 제외) + `MCMasterPage` loadError 성공시 리셋. 첫 로드 비결정적 500 복구(검증 6/6 배너0).
- **Cloudflare Hyperdrive 도입 (#41 #42)** — 동시 연결 **근본책 완료**. db를 요청 컨텍스트화(`createDbClient`/`getDefaultDb`+`dbMiddleware`가 `c.var.db` 주입, query는 `executor` 일원화). **핵심 교훈 2가지**: ①Workers는 요청 간 DB 소켓 재사용 불가 → Hyperdrive 경로는 **요청마다 생성 + `waitUntil(client.end())`**(메모이즈 ❌, 재사용 시 'Worker hung'). fallback(로컬/테스트)만 싱글톤. ②Hyperdrive origin은 **direct connection**(`db.<ref>.supabase.co:5432`, user `postgres`)이어야 함 — session pooler는 `pool_size 15` EMAXCONNSESSION로 막힘. binding `HYPERDRIVE`(id `a09fec47…`), 캐싱 disabled, `origin_connection_limit 20`. 검증: prod 25동시×6=150/150 200, hang0 500 0. 스펙 `ref/specs/2026-06-18-crm-hyperdrive-design.md`.

## Next

- **CRM 도메인 DB 연결** (고객·견적, crm 8테이블). 스펙 `ref/specs/2026-06-17-crm-*`.
- (후속, 선택) **prepare:true 전환** — direct origin(5432)은 prepared statement 지원. 현재 두 경로 모두 `prepare:false`(6543 fallback 호환). plan 캐싱 perf 원하면 Hyperdrive 경로만 true.

## ⚠️ Caveats

- CF Pages env: VITE_* 공개값은 `.env.production`(커밋)으로 빌드 주입, 비밀(DATABASE_URL)은 CF secret. 환경변수는 `wrangler.jsonc`로 관리(대시보드는 secret만 가능).
- **DATABASE_URL secret 변경 후 재배포 필수** — 기존 배포는 옛 값. (단 Hyperdrive **origin** 변경은 `wrangler hyperdrive update <id>`로 server-side라 재배포 불요. binding id 불변.)
- `src/db/client.ts`는 fallback 시 `process.env.DATABASE_URL` 읽음 — CF는 nodejs_compat로 process.env 채움. CF prod 정상 경로는 `c.env.HYPERDRIVE.connectionString`(요청별 생성).
- postgres-js `max:1`(tx 롤백 깸)·`fetch_types:false`(타입파싱 깸)는 **금지**(검증됨).
- **Hyperdrive 코드 불변식**: Hyperdrive 경로는 요청별 `createDbClient`+응답 후 `client.end()`. db를 모듈/요청 간 메모이즈하면 'Worker hung' 재발. 메모이즈는 fallback(getDefaultDb)만.
- CF prod 배포는 엣지 롤아웃에 ~1분 — 머지 직후 e2e는 옛/새 isolate 혼재로 일부 실패할 수 있음. `/api/health`의 `hyperdrive:true` 일관 확인 후 재검증.
- `DATABASE_URL`(fallback, 6543 transaction pooler)은 Hyperdrive origin(direct 5432)과 **별개**. 둘 다 유지.
- role 변경은 토큰 갱신(~1h)/재로그인까지 반영 안 됨(claim 방식).

## Verification (2026-06-18)

- `typecheck` 0 · `lint` 0 · `test:unit` 99 · `test:server` 28(--env-file=.env.local) · `build` OK.
- crm.mrcha.app: 카카오 로그인 화면 · SPA 라우팅(`/`,`/quotes` 200) · `/api` 게이트(401) · **mc-master 첫 로드 6/6 정상**.
- **Hyperdrive(#41 #42)**: prod `/api/catalog/models` **25동시×6=150/150 200**(hang 0, 500 0), mc-master 첫 로드 6엔드포인트 동시 전부 200. `/api/health` → `hyperdrive:true`.

## Collaboration

- (Codex 세션) User=이사님, assistant=영실. (Claude Code 세션) 호칭은 CLAUDE.md 팀 구성(송실장/유슨생).
- 판단 질문(`어때`/`괜찮을까`/`너 생각은?`): 추천·트레이드오프 먼저 + `적용할까요?`. 실행어(`응`/`해줘`/`진행해`): 즉시 실행.
- 팀 공유 결정·맥락은 git(`ref/*.md`, `AGENTS.md`)에. 로컬 메모리는 공유 안 됨.
