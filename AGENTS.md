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
- **🔴 확인 대기 항목**: `ref/director-pending-confirmations.md`에 **머지됐지만 이사님 확인을 못 받은 행위 변경**이 누적돼 있다. 이사님이 판단·정책을 묻거나 관련 영역(고객 목록 관리 상태 배지·업무 AI stale 리포트·앱 계정 link 충돌)을 건드리면 **그 파일을 먼저 확인하고 대기 항목을 꺼낸다.** 답을 받으면 그 파일에서 지우고 결정으로 박제한다. 새 배치에서 행위 변경이 생기면 거기 추가한다(PR 본문 🟡 표시와 병행).
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
- **⚠️ Workers에서 `fetch`는 반드시 plain call(2026-07-09 prod 실버그)**: `deps.fetchImpl(url, init)`처럼 **객체 메서드로 호출**하면 `this=deps`가 되고, CF Workers의 global `fetch`는 `this`가 globalThis/undefined가 아니면 `TypeError: Illegal invocation`으로 던진다. 호출 전 **지역 변수로 뽑아** 부를 것(`const fetchImpl = deps.fetchImpl; await fetchImpl(...)` — ESM strict라 this=undefined). `gemini-post.ts:14`(`const fetchImpl = opts.fetchImpl ?? fetch`)가 안전한 형태. **로컬 bun의 fetch는 this를 안 따져 유닛·로컬 dev로 재현되지 않는다**(prod 전용 실패). `push-notify.ts`가 이걸 밟아 **#193 이후 배정 알림이 prod에서 한 번도 안 나갔고**, `try/catch` best-effort가 예외를 삼켜 두 달 가까이 조용했다(PR #202). 새 `deps` 객체에 `fetch`를 담을 땐 호출부를 반드시 plain call로.
- **⚠️ 운영 알림 트리거 테이블(2026-07-09 사고 → 해소)**: `DATABASE_URL`이 공유 master라 아래 4테이블에 INSERT/UPDATE하면 `net.http_post` → Edge Function → **운영 디스코드 알림·FCM 푸시가 실제로 나간다**(테스트가 행을 지워도 트리거는 이미 발화). 로컬 `test:server` 1회가 42건을 냈다. `test:server`의 `PUSH_NOTIFY=off`는 CRM 앱 코드 경로만 막고 **DB 트리거는 못 막는다**(트리거는 프로세스 env를 못 본다).
  | 함수 | 테이블 | 나가는 것 |
  |---|---|---|
  | `handle_new_consultation` | `public.consultations` | 디스코드 관리자 알림 |
  | `notify_advisor_quote` | `public.advisor_quotes` | 고객 FCM 푸시 (INSERT + `sent_at`이 실제로 바뀌는 UPDATE만 — `viewed_at` 스탬프는 함수 첫 분기에서 빠져나가 알림 없음) |
  | `notify_staff_chat_message` | `public.chat_messages` | 고객 FCM 푸시 |
  | `notify_chat_session_assigned` | `public.chat_sessions` | 상담사 FCM 푸시 |

  앱 팀이 네 트리거에 가드 배포 완료(`20260709103000_skip_notify_guard.sql`): `IF current_setting('app.skip_notify', true) = 'on' AND session_user = 'postgres' THEN RETURN NEW`. **그 테이블에 쓰는 테스트는 반드시 `withNotifyGuard(db, (tx) => …)`**(`src/test-utils/notify-gate.ts`)로 감싼다 — INSERT/UPDATE는 그대로 되고 알림만 스킵된다. 함정: ①값은 정확히 소문자 `'on'`(엄격 비교) ②`set_config(...,true)`=SET LOCAL이라 **트랜잭션 안에서만** 유효 — `db.insert()` 단독은 자동커밋이라 안 걸린다 ③`updateQuote(…, ex)`처럼 `Executor`를 받는 프로덕션 함수는 `tx`를 넘기면 내부 `upsertAdvisorQuote`까지 같은 트랜잭션에 들어온다.
  **라우트 테스트(`app.request()`)는 dbMiddleware가 별도 커넥션이라 SET LOCAL이 닿지 않는다** → 알림 테이블을 아예 건드리지 않게 짠다: 발송 훅은 고객에 `app_user_id`가 있을 때만 돈다(`customer-quotes.ts:214` `if (!appUserId) return`)이므로 **`app_user_id` 없는 전용 고객을 시드**하면 훅 자체가 안 탄다(`routes/customers.test.ts`의 `seedLocalCustomer`). advisor_quotes upsert 경로 검증은 `customer-quotes.send.test.ts`가 `withNotifyGuard`로 담당.
  **⚠️ 그 대가로 포기한 커버리지**: 라우트 → `updateQuote` → `syncAdvisorQuoteOnSend`(`customer-quotes.ts:210`) **통합 경로 전체는 어떤 테스트도 타지 않는다**. 라우트가 `customerId`를 잘못 넘기거나 트랜잭션 경계가 어긋나는 회귀는 안 잡힌다. 조각별로는 검증되지만(스탬프=`updateQuote`, upsert=`send.test.ts`) **"이미 커버된다"고 믿고 이 경로를 건드리지 말 것.** `app.request()`가 별도 커넥션을 여는 한 안전한 테스트 방법이 없어 의도적으로 감수한 구간이다.
  **세션 레벨 `SET`(is_local 없이)은 금지** — transaction pooler(6543)는 백엔드를 다른 커넥션에 재사용하므로 GUC가 남은 백엔드를 다른 `postgres` 커넥션(dev 서버·백필)이 잡으면 **진짜 알림이 조용히 묻힌다**. 트랜잭션 스코프만 안전. `application_name` 방식도 불가 — Supavisor pooler가 덮어쓴다(실측: 6543·5432·startup options 전부). `session_user`는 pooler·SECURITY DEFINER 경유에도 `postgres` 유지(실측). `pg_net`은 트랜잭션 안전 — 롤백하면 알림 자체가 취소된다(실측).
- **Edge 복제본 패리티 가드(2026-07-02)**: `supabase/functions/crm-analyst/`의 `doc-types.ts`(서류 22종)와 `auth.ts`(CRM_ROLES)는 프론트/서버 원본의 Deno 복제본이다. `client/src/lib/doc-type-parity.test.ts`(test:unit)·`src/auth/roles-parity.test.ts`(test:server)가 드리프트를 잡는다 — 한쪽만 수정하면 테스트가 실패하니 반드시 양쪽 함께 갱신.
- **서버→클라 순수 모듈 import 경계(2026-07-07, 유슨생 승인·이사님 사후 확인)**: 서버(`src/`)는 `client/src/data/*`(순수 상수 — 기존 확립)와 **부작용 0 순수 클라 lib**(`client/src/lib/app-card-labels.ts`·`quote-pricing.ts`)만 import할 수 있다 — 앱카드 라벨 헬퍼 ~150줄 물리 1벌화가 이 경계로 이행됨(구 "서버 재현 복사본" 폐기, 파리티 테스트는 조립기 출력을 계속 잠금). **http/supabase/React 체인이 있는 클라 lib(`customers.ts` 등)는 서버 import 금지**(부작용 체인 — #151 사유). 역방향(클라 런타임이 `src/` import)은 금지 — 파리티 테스트 전용 import만 예외. 공유 순수 모듈의 라벨 값 변경은 업무 AI 견적 청크 content 변경 = 백필 재실행 소급 필수.
- **마크다운 CSS 공용**: AI 답변 마크다운 스타일은 공용 `.md-body` + 컨텍스트별 `--md-*` 변수(index.css)로 단일 소스다. 업무 AI/채팅 콘솔별로 룰을 복제하지 말 것(#133 strong 회귀가 한쪽만 픽스되는 사고 방지).
- **로컬 브라우저 스모크 로그인 우회**: 로그인이 카카오 OAuth뿐이라 자동화 브라우저로는 직접 로그인 불가. GoTrue admin `generate_link`(magiclink, `.env.local`의 `SUPABASE_SECRET_KEY`)로 발급한 verify URL을 **curl로 따라가** Location 헤더의 `#access_token…` 해시만 추출해 `http://127.0.0.1:5173/#<해시>`를 열면 supabase-js가 세션을 수립한다(verify 링크를 브라우저로 직접 열면 redirect 허용목록 때문에 prod(mrcha.app)가 토큰을 소비하니 주의). 테스트 계정 = 자메스관리자(`luck2here@naver.com`, admin). 스모크로 만든 데이터(서류·업무 AI 대화·배정)는 공유 master라 반드시 원복/삭제.
- DB — vehicle catalog (master 직접): the car catalog (brands/models/trims/options/colors) lives in master Supabase's **`catalog` schema** (9 tables; CRM reads 7). CRM reads it **directly** via `src/db/client.ts` (`db`, `DATABASE_URL`=master) + `src/db/queries/vehicles.ts` + `src/routes/vehicles.ts` (`/api/vehicles`), wired into the Kim quote workbench via `client/src/components/VehiclePicker.tsx`. **거울/sync는 폐기됨(A2 Phase C, 2026-06-17)** — `src/sync/*`·`bun run sync`·`POST /api/catalog/sync`·`MRCHA_MASTER_*`·`ref/db_import/` 전부 제거. master catalog엔 `deleted_at`(거울 전용)이 없어 read 쿼리는 그 필터를 안 쓴다. `catalog.ts` 정의는 `bun run db:pull:catalog` 재introspect로 갱신(`status`는 cross-schema `public.car_status`라 text로 모델). History: `ref/vehicle-mirror-db.md`(폐기 표시).
- DB — CRM domain (master 직접): master의 **`crm` 스키마에 8테이블**(`customers`+니즈 인라인·`customer_tasks`·`customer_schedules`·`customer_documents`·`customer_memos`·`consultations`·`quotes`·`quote_scenarios`). drizzle은 `schemaFilter:["crm"]`로 **crm만** 관리(public 앱 19테이블·catalog 9테이블 불가침), `db:generate`→`db:migrate`만(`db:push` 제거됨). 마이그레이션: `drizzle/0000`(crm 8테이블)·`drizzle/0001`(crm.quotes→catalog FK, ON DELETE SET NULL). public FK는 loose id 보류. `DATABASE_URL`(master)은 `.env.local`. drizzle-kit이 `.env.local`을 자동 로드 안 해 `drizzle.config(.catalog).ts`가 직접 주입.
