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
  **라우트 테스트(`app.request()`)는 `withNotifyGuard`로 감쌀 수 없다** — 라우트가 **자기 트랜잭션**(`c.var.db.transaction()`)을 열기 때문에 바깥 트랜잭션과 무관하다. 대신 **`setTestDb(guardedDb(getDefaultDb()))`**(PR #209): `guardedDb`가 감싼 db는 여는 **모든 트랜잭션 첫 문장**에서 GUC를 켠다. `beforeAll`에 설치하고 **`afterAll(() => setTestDb(null))`로 반드시 원복**(`routes/customers.send.test.ts` 참조). seam은 `dbMiddleware`의 `!connStr` 브랜치 **+ `NODE_ENV==='test'`**에만 산다 — **로컬 dev도 `!connStr`을 타므로 NODE_ENV 게이트를 절대 빼지 말 것**(빼면 로컬 dev 실알림이 조용히 죽는다). prod(`HYPERDRIVE`)는 seam을 아예 읽지 않는다.
  **⚠️ 구 서술 정정(2026-07-09)**: "`app.request()`는 dbMiddleware가 별도 커넥션이라 SET LOCAL이 안 닿는다"는 **사실이 아니었다**. 테스트엔 `HYPERDRIVE`가 없어 라우트도 테스트도 같은 `getDefaultDb()` 싱글톤을 쓴다. 진짜 봉쇄는 커넥션이 아니라 SET LOCAL 주입 seam의 부재였다. 그 오해 때문에 라우트 → `updateQuote` → `syncAdvisorQuoteOnSend` 통합 경로가 오래 무테스트였다(이제 `routes/customers.send.test.ts`가 커버). **`guardedDb`는 `db.transaction()` 경로만 커버한다** — autocommit 단발 쿼리(`db.insert()` 등)로 알림 테이블에 쓰면 여전히 `withNotifyGuard`가 필요하다.
  **세션 레벨 `SET`(is_local 없이)은 금지** — transaction pooler(6543)는 백엔드를 다른 커넥션에 재사용하므로 GUC가 남은 백엔드를 다른 `postgres` 커넥션(dev 서버·백필)이 잡으면 **진짜 알림이 조용히 묻힌다**. 트랜잭션 스코프만 안전. `application_name` 방식도 불가 — Supavisor pooler가 덮어쓴다(실측: 6543·5432·startup options 전부). `session_user`는 pooler·SECURITY DEFINER 경유에도 `postgres` 유지(실측). `pg_net`은 트랜잭션 안전 — 롤백하면 알림 자체가 취소된다(실측).
- **⚠️ 테스트 픽스처는 공유 master에 진짜 행을 만든다(2026-07-10)**: 정상 종료하면 `afterAll`이 지우지만 **실행이 끊기면 남는다.** `CU-EMBRT-…/배선테스트`가 07-09에 남아 이사님 고객 목록에 유령으로 떴다. 이제 두 겹으로 잡는다 — ①`src/test-utils/fixture-codes.test.ts`가 **실 DB 테스트**(`getDefaultDb` 참조)의 `CU-`/`QT-`/`PUSH-` 코드 리터럴이 registry(`fixture-codes.ts`)에 있는지 검사 ②`src/test-utils/fixture-residue.test.ts`가 매 `test:server`마다 실 DB 잔재를 조회해 실패시킨다. **새 픽스처 접두사는 registry에 먼저 등록한다**(정규식을 고쳐 회피하지 말 것). 잔재 정리는 `bun run check:residue -- --clean`(**crm 스키마만** — `public.advisor_quotes` 고아 카드는 보고만 하고 자동 삭제하지 않는다, 앱 소유).
- **⚠️ 고객 전화번호 소유권 계약(2026-07-17 #276·마이그 0034 — `customers.phone` 만지기 전 필독)**: `crm.customers.phone`은 **앱 미연결 고객의 주 번호만** 담는다 — CHECK `customers_phone_app_exclusive_check`(`app_user_id IS NOT NULL → phone IS NULL`)가 DB에서 강제. 앱 연결 고객의 주 번호는 컬럼에 없고 `listCustomers`/`getCustomer`가 `coalesce(profiles.phone_number, phone)`으로 **read-through 합성**한다 → **API 응답 `phone` ≠ DB 컬럼**(psql은 NULL인데 화면에 번호가 있는 게 정상). `phone_secondary` = 추가 연락처(항상 편집·**매칭 금지** — 회사/배우자 번호 가능). 연결 시 기존 phone 전이는 `applyAppUserLink`(app-user-link.ts) 단일 SSOT(같으면 폐기/다르면 secondary 보존/점유 시 droppedPhone 응답) — **새 승격·연결 경로에서 phone을 쓰면 CHECK가 거부한다**(구 "폼 우선"·"빈 연락처 보강" 폐기). `PATCH phone`은 앱 연결 고객 409, phone류는 서버 zod digits 정규화. phone 매칭 후보 = 앱 미연결 고객만(클라 인박스는 합성 phone을 받아 `!appUserId` 명시 제외 필수). `app_user_id` FK는 **의도적 미도입**(CASCADE=고객 하드삭제 설계 #212 우회·RESTRICT=앱 소유권 침범·연결 유저는 앱 FK가 profiles 삭제 원천 차단이라 실익 0 — 재검토는 앱이 유저 하드 삭제 구현 시). spec = `ref/specs/2026-07-17-crm-customer-phone-ownership-design.md`.
- **⚠️ `public.profiles`는 read 전용(2026-07-10 앱 팀과 합의한 계약)**: 앱이 휴대폰 인증 우회를 막으려 `REVOKE UPDATE ON public.profiles FROM anon, authenticated`를 적용했다. **CRM 서버는 `postgres` 롤이라 그 REVOKE의 대상이 아니다 — DB가 우리를 막아주지 않는다.** `src/db/profiles-write-guard.test.ts`(tripwire)가 drizzle·supabase-js·원시 SQL 3경로를 스캔해 잡는다. 정규식을 고쳐 우회하지 말 것. 쓰기가 필요하면 **앱 팀에 Edge Function 서버 경로를 요청**한다(그쪽 확약). 특히 `role`은 `public.custom_access_token_hook`이 JWT `user_role` claim으로 복사하고 그게 **CRM의 유일한 인증 게이트**다(`src/auth/verify.ts`) — 위조되면 곧 CRM 관리자 접근이다. `phone_verified_at`·`phone_verified_provider`·`phone_number`는 앱 Edge Function(`profile-authentication`, admin key) 전용.
- **채팅 system 문구·kind — 문자열 계약 해제, kind가 새 계약(2026-07-11 메타 플래그 전환 완결)**: 전 생성 주체(앱/CRM `insertSystemMessage`/DB cron 함수)가 `public.chat_messages.metadata.system_kind`를 부착하고, 앱 판별은 전부 **kind-first**(kind 있으면 문구를 보지 않음 — 앱 #640·#642·#643, CRM #217. 과거 행(kind null)만 문구 폴백, 백필 없이 영구 커버). ①**새 계약 = kind 값**: `client/src/data/chat.ts` `CHAT_SYSTEM_KIND_TAKEOVER`/`RETURN`(`handoff_takeover`/`handoff_return`) — 앱 `chat_message_metadata.dart` `ChatSystemKind`와 일치 실측, **임의 변경 금지** ②**문구(`CHAT_SYSTEM_MSG_*`)는 변경 가능**하되: 캐시된 구 앱 번들(문구 판별)이 소진될 **며칠 유예 후** 반영 + 앱 표시 문구(kind 스위치) 동기화를 위해 **앱팀 사전 공유 한 줄** ③잔여 = Edge '견적함에 저장' SSE 시그널(슬라이스 2b, 앱 몫·비긴급 — 그 문구만 아직 앱이 contains 매칭).
- **Edge 복제본 패리티 가드(2026-07-02)**: `supabase/functions/crm-analyst/`의 `doc-types.ts`(서류 22종)와 `auth.ts`(CRM_ROLES)는 프론트/서버 원본의 Deno 복제본이다. `client/src/lib/doc-type-parity.test.ts`(test:unit)·`src/auth/roles-parity.test.ts`(test:server)가 드리프트를 잡는다 — 한쪽만 수정하면 테스트가 실패하니 반드시 양쪽 함께 갱신.
- **서버→클라 순수 모듈 import 경계(2026-07-07, 유슨생 승인·이사님 사후 확인)**: 서버(`src/`)는 `client/src/data/*`(순수 상수 — 기존 확립)와 **부작용 0 순수 클라 lib**(`client/src/lib/app-card-labels.ts`·`quote-pricing.ts`·`solution-quote.ts` — 솔루션 어휘 SSOT, 2026-07-14 · `quote-write-access.ts` — 견적 쓰기 권한 SSOT, 2026-07-21)만 import할 수 있다 — 앱카드 라벨 헬퍼 ~150줄 물리 1벌화가 이 경계로 이행됨(구 "서버 재현 복사본" 폐기, 파리티 테스트는 조립기 출력을 계속 잠금). **http/supabase/React 체인이 있는 클라 lib(`customers.ts` 등)는 서버 import 금지**(부작용 체인 — #151 사유). 역방향(클라 런타임이 `src/` import)은 금지 — 파리티 테스트 전용 import만 예외. 공유 순수 모듈의 라벨 값 변경은 업무 AI 견적 청크 content 변경 = 백필 재실행 소급 필수.
- **마크다운 CSS 공용**: AI 답변 마크다운 스타일은 공용 `.md-body` + 컨텍스트별 `--md-*` 변수(index.css)로 단일 소스다. 업무 AI/채팅 콘솔별로 룰을 복제하지 말 것(#133 strong 회귀가 한쪽만 픽스되는 사고 방지).
- **로컬 브라우저 스모크 로그인 우회**: 로그인이 카카오 OAuth뿐이라 자동화 브라우저로는 직접 로그인 불가. GoTrue admin `generate_link`(magiclink, `.env.local`의 `SUPABASE_SECRET_KEY`)로 발급한 verify URL을 **curl로 따라가** Location 헤더의 `#access_token…` 해시만 추출해 `http://127.0.0.1:5173/#<해시>`를 열면 supabase-js가 세션을 수립한다(verify 링크를 브라우저로 직접 열면 redirect 허용목록 때문에 prod(mrcha.app)가 토큰을 소비하니 주의). 테스트 계정 = 자메스관리자(`luck2here@naver.com`, admin). 스모크로 만든 데이터(서류·업무 AI 대화·배정)는 공유 master라 반드시 원복/삭제.
- DB — vehicle catalog (master 직접): the car catalog (brands/models/trims/options/colors) lives in master Supabase's **`catalog` schema** (9 tables; CRM reads 7). CRM reads it **directly** via `src/db/client.ts` (`db`, `DATABASE_URL`=master) + `src/db/queries/vehicles.ts` + `src/routes/vehicles.ts` (`/api/vehicles`), wired into the Kim quote workbench via `client/src/components/VehiclePicker.tsx`. **거울/sync는 폐기됨(A2 Phase C, 2026-06-17)** — `src/sync/*`·`bun run sync`·`POST /api/catalog/sync`·`MRCHA_MASTER_*`·`ref/db_import/` 전부 제거. master catalog엔 `deleted_at`(거울 전용)이 없어 read 쿼리는 그 필터를 안 쓴다. `catalog.ts` 정의는 `bun run db:pull:catalog` 재introspect로 갱신(`status`는 cross-schema `public.car_status`라 text로 모델). History: `ref/vehicle-mirror-db.md`(폐기 표시).
- DB — CRM domain (master 직접): master의 **`crm` 스키마에 14테이블**(초기 8 = `customers`+니즈 인라인·`customer_tasks`·`customer_schedules`·`customer_documents`·`customer_memos`·`consultations`·`quotes`·`quote_scenarios` + 이후 증설 6 = `embeddings`(0012)·`assistant_messages`(0014)·`staff_settings`(0024)·`consultation_dismissals`(0026)·`customer_deletions`(0027)·`customer_deliveries`(0036, 출고 2단계) — 2026-07-13 실측 정정+2026-07-20 갱신, 구 "8테이블" 서술은 초기 상태). drizzle은 `schemaFilter:["crm"]`로 **crm만** 관리(public 앱 19테이블·catalog 9테이블 불가침), `db:generate`→`db:migrate`만(`db:push` 제거됨). 마이그레이션: `drizzle/0000`(crm 8테이블)·`drizzle/0001`(crm.quotes→catalog FK, ON DELETE SET NULL). public FK는 loose id 보류. `DATABASE_URL`(master)은 `.env.local`. drizzle-kit이 `.env.local`을 자동 로드 안 해 `drizzle.config(.catalog).ts`가 직접 주입.
