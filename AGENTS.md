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
- DB — vehicle catalog (master 직접): the car catalog (brands/models/trims/options/colors) lives in master Supabase's **`catalog` schema** (9 tables; CRM reads 7). CRM reads it **directly** via `src/db/client.ts` (`db`, `DATABASE_URL`=master) + `src/db/queries/vehicles.ts` + `src/routes/vehicles.ts` (`/api/vehicles`), wired into the Kim quote workbench via `client/src/components/VehiclePicker.tsx`. **거울/sync는 폐기됨(A2 Phase C, 2026-06-17)** — `src/sync/*`·`bun run sync`·`POST /api/catalog/sync`·`MRCHA_MASTER_*`·`ref/db_import/` 전부 제거. master catalog엔 `deleted_at`(거울 전용)이 없어 read 쿼리는 그 필터를 안 쓴다. `catalog.ts` 정의는 `bun run db:pull:catalog` 재introspect로 갱신(`status`는 cross-schema `public.car_status`라 text로 모델). History: `ref/vehicle-mirror-db.md`(폐기 표시).
- DB — CRM domain (master 직접): master의 **`crm` 스키마에 8테이블**(`customers`+니즈 인라인·`customer_tasks`·`customer_schedules`·`customer_documents`·`customer_memos`·`consultations`·`quotes`·`quote_scenarios`). drizzle은 `schemaFilter:["crm"]`로 **crm만** 관리(public 앱 19테이블·catalog 9테이블 불가침), `db:generate`→`db:migrate`만(`db:push` 제거됨). 마이그레이션: `drizzle/0000`(crm 8테이블)·`drizzle/0001`(crm.quotes→catalog FK, ON DELETE SET NULL). public FK는 loose id 보류. `DATABASE_URL`(master)은 `.env.local`. drizzle-kit이 `.env.local`을 자동 로드 안 해 `drizzle.config(.catalog).ts`가 직접 주입.
