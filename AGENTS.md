# Mr. Cha CRM Codex Instructions

## Lightweight Continuity

When the user says `영실아 이어가자`, `CRM 이어가자`, or asks about Mr. Cha/차선생/Creative Jian in this repo, do not start by reading every global/project planning document.

Default recovery order:

1. Read `ref/active-session-brief.md`.
2. Run:
   - `git status --short --branch`
   - `git log --oneline --decorate --max-count=5`
3. If the brief is insufficient, read `ref/current-working-state.md`.
4. Read `/Users/jian/.codex/memories/START_HERE_MRCHA.md` only when repo-local context is not enough.
5. Read original planning files only when the task explicitly touches strategy, roadmap, AI policy, architecture, quote engine, or original product decisions.

Do not enumerate the 23 original planning files by default. Avoid loading large handoff documents unless needed.

## Handoff Documents

When the user asks for an 인계문서, 다음 세션 인계, 이어가기 문서, or 새 세션 프롬프트, optimize for low context usage.

Default handoff behavior:

1. Update `ref/active-session-brief.md` first.
2. Keep it short: target 60 lines or fewer unless the user explicitly asks for a detailed handoff.
3. Include only:
   - current focus
   - files touched
   - latest UI/technical decisions
   - immediate next step
   - verification status
   - known caveats
4. Do not append long historical logs.
5. Do not duplicate large sections from `current-working-state.md`.
6. Update `current-working-state.md` only for durable decisions that matter beyond the next session.
7. The next-session prompt should tell Codex to read `AGENTS.md` and `ref/active-session-brief.md` first, not the full global memory set.

## Collaboration

- Call the user `이사님`.
- The assistant is `영실`.
- If the user asks for judgment or says `~같은데`, `어때`, `괜찮을까`, `너 생각은?`, give opinion/tradeoffs/recommendation first and ask `적용할까요?`.
- If the user says `해줘`, `수정해`, `적용해`, `진행하자`, `응`, treat it as execution permission.

## Verification Budget

- Small CSS/type/spacing changes: do not run the full test suite after every change. Batch verification.
- DOM or TypeScript changes: run `bun run typecheck`.
- Any change: keep `bun run lint` at 0 problems (the repo is currently lint-clean).
- Customer management logic changes: run `bun run test:unit client/src/pages/CustomerManagementPage.test.tsx`.
- Large visual layout changes: run Playwright screenshot once, not after every minor tweak.
- **커밋 메시지 `[skip ci]` 토큰 주의**: feature 브랜치 커밋(spec/plan/brief 포함)에 넣으면 GitHub squash가 본문에 합쳐 **CF Pages 배포가 스킵**된다(2026-06-19 #51·#53서 2회 사고). 그 토큰은 머지와 무관한 **main 직접 docs 커밋에만** 사용. 스킵됐으면 마커 없는 빈 커밋 push 또는 CF 대시보드 수동 빌드로 보정.

## Current UI Focus

- Work is centered on 김민준(`CU-2605-0020`) customer detail drawer only.
- Other customer detail screens and the customer list should stay unchanged unless explicitly requested.
- The target direction is a customer state dashboard, not a dense task-entry form.

## Toolchain / State

- TypeScript **6.0.3**. `tsconfig` uses `paths` without `baseUrl` (removed; `baseUrl` is deprecated in TS6). Prefer `SyntheticEvent` over deprecated React types like `FormEvent`.
- Keep the repo lint-clean (`bun run lint` is currently at 0 problems).
- **Code conventions** (agreed 2026-06-15):
  - **No `any`**: enforced by `typescript-eslint` recommended + `strict: true`. If unavoidable, take `unknown` and narrow.
  - **Constant-ize mock/data**: values used in calc or reused (price/option/discount, etc.) go in named consts, not inline literals. Shared ones live in `client/src/data/`.
  - **Tests**: pure calc/util logic is unit-tested first (TDD). Large page components may rely on manual/screenshot verification.
  - **Verify data meanings**: don't assume DB column/enum/type semantics (e.g. `trim_options.type` basic/tuning) — check real samples via `psql "$DATABASE_URL"` before designing. (`basic` was wrongly assumed "free base spec" and broke option selection.)
- **Edge 복제본 패리티 가드(2026-07-02)**: `supabase/functions/crm-analyst/`의 `doc-types.ts`(서류 22종)와 `auth.ts`(CRM_ROLES)는 프론트/서버 원본의 Deno 복제본이다. `client/src/lib/doc-type-parity.test.ts`(test:unit)·`src/auth/roles-parity.test.ts`(test:server)가 드리프트를 잡는다 — 한쪽만 수정하면 테스트가 실패하니 반드시 양쪽 함께 갱신.
- **서버→클라 순수 모듈 import 경계(2026-07-07, 유슨생 승인·이사님 사후 확인)**: 서버(`src/`)는 `client/src/data/*`(순수 상수 — 기존 확립)와 **부작용 0 순수 클라 lib**(`client/src/lib/app-card-labels.ts`·`quote-pricing.ts`)만 import할 수 있다 — 앱카드 라벨 헬퍼 ~150줄 물리 1벌화가 이 경계로 이행됨(구 "서버 재현 복사본" 폐기, 파리티 테스트는 조립기 출력을 계속 잠금). **http/supabase/React 체인이 있는 클라 lib(`customers.ts` 등)는 서버 import 금지**(부작용 체인 — #151 사유). 역방향(클라 런타임이 `src/` import)은 금지 — 파리티 테스트 전용 import만 예외. 공유 순수 모듈의 라벨 값 변경은 업무 AI 견적 청크 content 변경 = 백필 재실행 소급 필수.
- **마크다운 CSS 공용**: AI 답변 마크다운 스타일은 공용 `.md-body` + 컨텍스트별 `--md-*` 변수(index.css)로 단일 소스다. 업무 AI/채팅 콘솔별로 룰을 복제하지 말 것(#133 strong 회귀가 한쪽만 픽스되는 사고 방지).
- **로컬 브라우저 스모크 로그인 우회**: 로그인이 카카오 OAuth뿐이라 자동화 브라우저로는 직접 로그인 불가. GoTrue admin `generate_link`(magiclink, `.env.local`의 `SUPABASE_SECRET_KEY`)로 발급한 verify URL을 **curl로 따라가** Location 헤더의 `#access_token…` 해시만 추출해 `http://127.0.0.1:5173/#<해시>`를 열면 supabase-js가 세션을 수립한다(verify 링크를 브라우저로 직접 열면 redirect 허용목록 때문에 prod(mrcha.app)가 토큰을 소비하니 주의). 테스트 계정 = 자메스관리자(`luck2here@naver.com`, admin). 스모크로 만든 데이터(서류·업무 AI 대화·배정)는 공유 master라 반드시 원복/삭제.
- DB — vehicle catalog (master 직접): the car catalog (brands/models/trims/options/colors) lives in master Supabase's **`catalog` schema** (9 tables; CRM reads 7). CRM reads it **directly** via `src/db/client.ts` (`db`, `DATABASE_URL`=master) + `src/db/queries/vehicles.ts` + `src/routes/vehicles.ts` (`/api/vehicles`), wired into the Kim quote workbench via `client/src/components/VehiclePicker.tsx`. **거울/sync는 폐기됨(A2 Phase C, 2026-06-17)** — `src/sync/*`·`bun run sync`·`POST /api/catalog/sync`·`MRCHA_MASTER_*`·`ref/db_import/` 전부 제거. master catalog엔 `deleted_at`(거울 전용)이 없어 read 쿼리는 그 필터를 안 쓴다. `catalog.ts` 정의는 `bun run db:pull:catalog` 재introspect로 갱신(`status`는 cross-schema `public.car_status`라 text로 모델). History: `ref/vehicle-mirror-db.md`(폐기 표시).
- DB — CRM domain (master 직접): master의 **`crm` 스키마에 8테이블**(`customers`+니즈 인라인·`customer_tasks`·`customer_schedules`·`customer_documents`·`customer_memos`·`consultations`·`quotes`·`quote_scenarios`). drizzle은 `schemaFilter:["crm"]`로 **crm만** 관리(public 앱 19테이블·catalog 9테이블 불가침), `db:generate`→`db:migrate`만(`db:push` 제거됨). 마이그레이션: `drizzle/0000`(crm 8테이블)·`drizzle/0001`(crm.quotes→catalog FK, ON DELETE SET NULL). public FK는 loose id 보류. `DATABASE_URL`(master)은 `.env.local`. drizzle-kit이 `.env.local`을 자동 로드 안 해 `drizzle.config(.catalog).ts`가 직접 주입.
