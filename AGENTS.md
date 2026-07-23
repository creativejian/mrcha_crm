# Mr. Cha CRM Codex Instructions

## Lightweight Continuity

When the user says `영실아 이어가자`, `CRM 이어가자`, or asks about Mr. Cha/차선생/Creative Jian in this repo, do not start by reading every global/project planning document.

Default recovery order:

1. Read `ref/active-session-brief.md`.
2. Run:
   - `git status --short --branch`
   - `git log --oneline --decorate --max-count=5`
3. If the brief is insufficient, read on demand — durable state `ref/current-working-state.md` / past session history `ref/session-archive.md` / design rationale `ref/specs/*`, `ref/plans/*`.
4. Read `/Users/jian/.codex/memories/START_HERE_MRCHA.md` only when repo-local context is not enough.
5. Read original planning files only when the task explicitly touches strategy, roadmap, AI policy, architecture, quote engine, or original product decisions.

Do not enumerate the 23 original planning files by default. Avoid loading large handoff documents unless needed.

## Handoff Documents

When the user asks for an 인계문서, 다음 세션 인계, 이어가기 문서, or 새 세션 프롬프트, optimize for low context usage.

Default handoff behavior:

1. Update `ref/active-session-brief.md` first — **replace, don't append**.
2. Keep it short: target 60 lines or fewer unless the user explicitly asks for a detailed handoff.
   ⚠️ 이 파일은 매 세션 자동 로드된다. 2026-07-21에 누적으로 142k자까지 자라 세션 시작
   컨텍스트의 14%를 점유했고(전체 자동 로드분의 71%), 이 규칙을 정면으로 어기고 있었다.
   직전 세션 요약만 남기고 그 이전 블록은 `ref/session-archive.md` 맨 위로 옮긴다.
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
- Large visual layout changes: 실화면을 **눈으로 1회** 확인한다(매 미세 조정마다 하지 않는다). 로그인이 카카오 OAuth뿐이라 브라우저를 띄우려면 아래 "로컬 브라우저 스모크 로그인 우회"의 magiclink 절차를 쓴다.
  ⚠️ **자동 스크린샷/픽셀 비교 하네스는 폐기됐다**(2026-07-22 배치 13). 구 `visual:crm`·`screenshot:crm`과 spec 3종은 전부 `page.goto("/")` 직후 CRM 화면을 기대해, 2026-06-18 로그인 게이트(#36) 도입 후 **약 두 달간 실행 자체가 불가능**했는데도 이 문구가 계속 그 도구를 가리키고 있었다(= 아무도 안 돌리는 규칙). `playwright.config.ts`만 재도입용으로 남겼다 — 되살릴 때는 **로그인 처리(storageState)부터** 붙일 것.
- **커밋 메시지 `[skip ci]` 토큰 주의**: feature 브랜치 커밋(spec/plan/brief 포함)에 넣으면 GitHub squash가 본문에 합쳐 **CF Pages 배포가 스킵**된다(2026-06-19 #51·#53서 2회 사고). 그 토큰은 머지와 무관한 **main 직접 docs 커밋에만** 사용. 스킵됐으면 마커 없는 빈 커밋 push 또는 CF 대시보드 수동 빌드로 보정.

### 리팩토링 배치 감사 — 트리거 기반·경량 (2026-07-22 배치 15 이후 · 유슨생 승인)

**구 관례(미감사 5~6건이 쌓이면 자동으로 풀 감사)는 폐지한다.** 배치 15를 마지막 풀 감사로 종료했다.

- **근거(실측)**: 배치 14는 87표를 써서 **상 0·중 0·하 14**, 배치 15는 48 에이전트·5.39M 토큰으로 **상 0·중 5·하 9·행위 변경 0**을 냈다 — **두 배치 연속 사용자 가시 오작동 0건**. `ADJUSTED` 비중이 압도적인 것은 결함을 그만큼 찾았다는 뜻이 아니라 **앵글의 과장을 검증이 되돌린 횟수**다(파이프라인 상당분이 자기 노이즈 청소). 반면 그때까지 레포엔 `.github`·`.husky`가 없어 **자동 그물이 0**이었고(→ ③으로 해소), 감사 자체가 사고를 냈다(배치 14 워킹트리 오염 5건·실 DB 픽스처 잔재·main 직접 푸시).
- **① 트리거 기반**: 누적 건수로 착수하지 않는다. ⓐ실 데이터를 변형하는 변경 ⓑ외부 계약(앱팀·DB·모델)을 건드리는 변경 ⓒ검증 없이 급히 나간 변경 — **이 중 하나가 포함될 때만** 풀 감사.
- **② 기본형은 경량**: 2앵글(정합성·회귀그물) + **실측 렌즈 1개**. 적대 검증은 **심각도 상/중에만** 붙인다(하는 기록만).
- **③ CI 도입이 감사보다 값어치 있다** → ✅ **완료(2026-07-22, `.github/workflows/ci.yml`)**. push(main)·PR마다 **typecheck · lint · test:unit · build** 4종이 자동으로 돈다. 앞 단계가 실패해도 나머지를 계속 돌려 한 번에 전부 보고한다.
  - ⚠️ **`test:server`를 CI에 추가하지 말 것** — 공유 master DB에 실제로 붙어 픽스처 행·운영 알림·실 Gemini 9콜이 나간다(로컬 전용). 워크플로우 주석에 같은 경고를 박아뒀다.
  - ⚠️ **knip·format:check도 제외** — 둘 다 도입 시점부터 red인 선재 상태라(knip 7/9 · format:check 스타일 warn 20건) 넣으면 CI가 항상 빨갛다. **기준선을 0으로 만든 뒤에** 추가한다.
  - CI는 env를 쓰지 않는다(4종 전부 환경변수 없이 통과 실측). 실제 배포 빌드는 Cloudflare Pages가 자기 환경에서 따로 수행하므로 CI 산출물과 무관하다.
- **풀 감사를 돌릴 때 유지할 것**: 에이전트별 **worktree 격리** + 변이 **5단계 자가검증**(전 GREEN 확인 → 주입 → 재실행 → 원복 → `git status` clean). 배치 15에서 41개 에이전트 전원이 원복해 **메인 워킹트리 무손상**을 확인했다(배치 14 오염의 재발 0).
- 판정 SSOT는 `ref/plans/YYYY-MM-DD-crm-refactor-batch-N.md`에 남긴다.

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
- **⚠️ `update_human_handoff_settings` RPC = 계약 프리즈(2026-07-22 앱 팀 요청·CRM 수용)**: 실시간 상담 운영 설정 저장은 **브라우저 supabase-js에서 관리자 로그인 세션(authenticated)으로** 호출한다(`client/src/lib/handoff-settings.ts:166`, 서버 경로 0건). 함수가 `auth.uid()`·JWT `user_role` claim에 의존하는 SECURITY DEFINER라, **secret key(service_role) 서버 호출로 바꾸면 즉시 42501로 죽고**(uid NULL·claim 없음) 게이트를 풀면 인가가 DB에서 앱 코드로 내려가며 감사 로그(`human_handoff_setting_audits.changed_by`)도 위조 가능해진다. Supabase Security Advisor의 `Signed-In Users Can Execute SECURITY DEFINER Function`(lint 0029) 경고는 **의도된 정상 상태**이니 그걸 없애려고 호출 방식·시그니처·게이트를 바꾸지 말 것. Advisor 기준선 = Warnings 4 / Info 2(초과 시에만 조사). **`p_timezone`은 반드시 명시 전달**(`HANDOFF_TIMEZONE` = `'Asia/Seoul'`, `client/src/data/chat.ts`) — DB DEFAULT에 기대지 않는다. 그 값은 단순 저장값이 아니라 앱 `private.handoff_availability_at`이 `AT TIME ZONE`으로 쓰는 **운영시간 판정 기준 시각**이라, DEFAULT가 흘려 UTC가 된 상태에서 인자를 생략하면 저장 한 번에 판정이 **9시간 밀린다**(에러 없이 조용히). 앱 팀도 DEFAULT 프리즈(계약 파일 명문화)와 **시그니처 회귀 검증**(앱 PR #737 — 원격 DB `pg_get_function_arguments()`를 계약값과 대조해 어긋나면 커밋 차단)을 완료해, 양쪽 다 걸린 상태다(2026-07-22 종결). **시그니처 전체 동결은 유지** — CRM이 명시 전달로 바뀌었다고 DEFAULT가 자유로워진 게 아니다(psql 수동 조작·향후 다른 소비자가 5개 인자로 부를 경로가 남아 있다). 회귀 그물 = `handoff-settings.test.ts`의 "p_timezone 명시 전달" 케이스. 회신·근거 = `ref/2026-07-22-app-security-advisor-reply.md`.
- **⚠️ `public.profiles`는 read 전용(2026-07-10 앱 팀과 합의한 계약)**: 앱이 휴대폰 인증 우회를 막으려 `REVOKE UPDATE ON public.profiles FROM anon, authenticated`를 적용했다. **CRM 서버는 `postgres` 롤이라 그 REVOKE의 대상이 아니다 — DB가 우리를 막아주지 않는다.** `src/db/profiles-write-guard.test.ts`(tripwire)가 drizzle·supabase-js·원시 SQL 3경로를 스캔해 잡는다. 정규식을 고쳐 우회하지 말 것. 쓰기가 필요하면 **앱 팀에 Edge Function 서버 경로를 요청**한다(그쪽 확약). 특히 `role`은 `public.custom_access_token_hook`이 JWT `user_role` claim으로 복사하고 그게 **CRM의 유일한 인증 게이트**다(`src/auth/verify.ts`) — 위조되면 곧 CRM 관리자 접근이다. `phone_verified_at`·`phone_verified_provider`·`phone_number`는 앱 Edge Function(`profile-authentication`, admin key) 전용.
- **채팅 system 문구·kind — 문자열 계약 해제, kind가 새 계약(2026-07-11 메타 플래그 전환 완결)**: 전 생성 주체(앱/CRM `insertSystemMessage`/DB cron 함수)가 `public.chat_messages.metadata.system_kind`를 부착하고, 앱 판별은 전부 **kind-first**(kind 있으면 문구를 보지 않음 — 앱 #640·#642·#643, CRM #217. 과거 행(kind null)만 문구 폴백, 백필 없이 영구 커버). ①**새 계약 = kind 값**: `client/src/data/chat.ts` `CHAT_SYSTEM_KIND_TAKEOVER`/`RETURN`(`handoff_takeover`/`handoff_return`) — 앱 `chat_message_metadata.dart` `ChatSystemKind`와 일치 실측, **임의 변경 금지** ②**문구(`CHAT_SYSTEM_MSG_*`)는 변경 가능**하되: 캐시된 구 앱 번들(문구 판별)이 소진될 **며칠 유예 후** 반영 + 앱 표시 문구(kind 스위치) 동기화를 위해 **앱팀 사전 공유 한 줄** ③잔여 = Edge '견적함에 저장' SSE 시그널(슬라이스 2b, 앱 몫·비긴급 — 그 문구만 아직 앱이 contains 매칭).
- **Edge 복제본 패리티 가드(2026-07-02)**: `supabase/functions/crm-analyst/`의 `doc-types.ts`(서류 22종)와 `auth.ts`(CRM_ROLES)는 프론트/서버 원본의 Deno 복제본이다. `client/src/lib/doc-type-parity.test.ts`(test:unit)·`src/auth/roles-parity.test.ts`(test:server)가 드리프트를 잡는다 — 한쪽만 수정하면 테스트가 실패하니 반드시 양쪽 함께 갱신.
- **서버→클라 순수 모듈 import 경계(2026-07-07, 유슨생 승인·이사님 사후 확인)**: 서버(`src/`)는 `client/src/data/*`(순수 상수 — 기존 확립)와 **부작용 0 순수 클라 lib**(`client/src/lib/app-card-labels.ts`·`quote-pricing.ts`·`solution-quote.ts` — 솔루션 어휘 SSOT, 2026-07-14 · `quote-write-access.ts` — 견적 쓰기 권한 SSOT, 2026-07-21 · `advisor-assign-access.ts` — 담당자 배정 권한 SSOT, 2026-07-21)만 import할 수 있다 — 앱카드 라벨 헬퍼 ~150줄 물리 1벌화가 이 경계로 이행됨(구 "서버 재현 복사본" 폐기, 파리티 테스트는 조립기 출력을 계속 잠금). **http/supabase/React 체인이 있는 클라 lib(`customers.ts` 등)는 서버 import 금지**(부작용 체인 — #151 사유). 역방향(클라 런타임이 `src/` import)은 금지 — 파리티 테스트 전용 import만 예외. 공유 순수 모듈의 라벨 값 변경은 업무 AI 견적 청크 content 변경 = 백필 재실행 소급 필수.
- **⚠️ 임베딩 모델 계약(2026-07-22 `#312`·`#313`·배치 14)**: 현행 모델의 SSOT는 `EMBEDDING_MODEL`(`src/lib/gemini-embed.ts`) = **`gemini-embedding-2`**. ①**모델 공간은 호환 불가** — 001↔2는 같은 문장 코사인 **0.03**(거의 직교). 차원이 3072로 같아 섞여도 **에러가 나지 않고 유사도만 무작위**가 되어 검색이 조용히 죽는다(증상으로 못 잡는다) ②그래서 `embeddingContentHash`가 **해시에 모델명을 섞는다** — 모델 상수 한 줄 교체 = 전 코퍼스 해시 변경 = 백필이 자동 전량 재임베딩. `crm.embeddings`에 모델 컬럼이 없어 이게 **혼입 방지 단일 방어선**이고, 불변식은 `src/test-utils/embedding-model-consistency.test.ts`가 매 `test:server`마다 검사한다 ③**이 해시를 임베딩 밖에서 재사용 금지** — AI 힌트 캐시 키는 `aiHintSourceHash`(순수 sha256, `lib/ai-hint.ts`)로 분리돼 있다(`#312`가 묶어 두는 바람에 모델 교체가 전 고객 힌트를 무효화했다) ④**유사도 임계값은 모델과 한 쌍** — `SIMILARITY_THRESHOLD`(`routes/assistant.ts`)는 모델을 바꿀 때마다 **반드시 재실측**한다(구 0.75를 그대로 뒀더니 관련 질문 8종 중 5종이 NO_HITS로 죽었다) ⑤**앱 임베딩(`public.*`)을 참조하는 기능은 착수 전에 양쪽 모델 일치부터 확인**한다.
- **생성 모델 배치(2026-07-22 · 배치 15 정정)**: 임베딩과 달리 **앱과 달라도 무방**하다(계약 아님 — 모델 일치를 맞출 이유가 없다). ⚠️ **근거 정정(배치 15 M4)**: 구 서술 "생성은 저장물이 없어서"는 **거짓**이다 — 생성 산출물은 실제로 영속 저장된다(`crm.customers.ai_summary` 22행 + `crm.assistant_messages(role='assistant')` 100행 = 실측 122행). 진짜 근거는 **두 저장처 모두 crm 스키마 CRM 소유라 앱과 공유되지 않는다**는 것이다. 저장물이 있으므로 **모델을 바꿔도 기존 힌트 문구는 자동으로 갱신되지 않는다** — `aiHintSourceHash`는 재료 기반(모델 무관)이라 `runAiHintJob`이 전원 `unchanged`로 조기 반환한다(실측: 앱 미연결 20/20이 신 스킴 보유). 문구를 새 모델로 갈아끼우려면 **`ai_summary_source_hash` 클리어 → 백필**이 필요하고, 갈아끼우기 전 **구 문구를 백업**한다(재생성으로 복원 불가 — `#319` 때 실제로 수행). 현재 **의도적으로 둘로 갈라져 있다**: ①`GEN_MODEL`(`src/lib/gemini-generate.ts`) = **`gemini-3.5-flash-lite`** — 업무 AI 답변(SSE)·**도구 라우팅**·AI 힌트 3용도 공용 ②`MODEL_NAME`(`supabase/functions/crm-analyst/gemini.ts`) = **`gemini-3.6-flash`** — 서류 vision 분류만 상위 티어(오분류가 곧 사람의 재확인 시간이고, 업로드당 1회·출력 20토큰이라 비용 차가 월 수천 원 수준). ⚠️ **`GEN_MODEL`을 바꾸면 라우팅 판단도 함께 바뀐다** — **골든 테스트는** 라우터를 페이크 주입하고, **라우트 테스트는 실 라우터를 부르되 결과에 의존하지 않아**(업스트림을 죽여도 29/29 통과 — 폴백이 삼킨다) 어느 쪽도 이 변화를 못 잡으므로(배치 14 K2-d · 배치 15 M7) **실기 골든 4종**(마이바흐→라우팅 없음 · 김지안 견적→`customer_quotes` · 앱 유입→`search_customers{source}` · 잡담→범위 밖)을 눈으로 확인한다. ⚠️ **단 골든 4종만으로는 부족하다(배치 15 실측)** — 이 4종은 구 `gemini-3.1-flash-lite`도 **똑같이 4/4 통과**해 두 모델을 구분하지 못했다. 회귀 감시로는 유효하나 "상향이 라우팅을 바꿨다"의 증거로는 쓸 수 없으니, 모델을 바꿀 때는 **그 변경이 실제로 노리는 질문 유형을 골든에 추가**할 것. 덧붙여 `test:server` 1회는 실 Gemini 라우팅 **9콜**을 발사한다(계측 실측 — 무기록 외부 의존·비용). Edge 상수는 Deno 복제본이라 import 불가 — **두 상수는 독립**이고 한쪽을 올려도 다른 쪽을 따라 올릴 필요가 없다. Edge 수정 시 **`supabase functions deploy crm-analyst` 재배포 필수**(CF Pages 배포와 별개). ⚠️ **슬러그를 반드시 명시**한다 — 생략하면 로컬 `supabase/functions/` 전체(`crm-analyst`+`crm-gemini-proxy`)가 함께 나간다. 앱 함수(`ai-analyst`·`send-push`·`notify-admin`·`profile-authentication` 등)는 **우리 레포에 소스가 없어 배포 대상이 될 수 없다**(구조적으로 안전). 배포 후 `supabase functions list`의 `updated_at`으로 **그 함수만 갱신됐는지 실측 확인**할 것.
- **⚠️ 금융사 SSOT는 파트너 목록의 하드코딩 미러다(2026-07-23)**: `SOLUTION_LENDERS`(`client/src/lib/solution-quote.ts`)는 제프 금융사 목록을 손으로 옮긴 상수다. **실시간 fetch로 바꾸지 말 것** — ①`SolutionLenderCode`가 이 상수에서 파생된 **컴파일타임 타입**이라 런타임 값으로는 못 만든다(딜러·지원집합 호출의 타입 안전이 여기서 나온다) ②`label`은 저장 견적(`crm.quotes.scenarios[].lender`)에 박히는 **데이터 계약**이다 ③`CRM_EXTRA_LENDERS`로 CRM이 **상위집합**을 소유하는 설계라 파트너 목록으로 덮으면 그 확장점이 죽는다 ④파트너가 죽어도 금융사 드롭다운은 떠야 한다(계산·딜러·매트릭스만 파트너 의존). 금융사 추가/삭제는 **상수 한 줄 + 배포**가 의도된 유지 경로다. **드리프트 그물 2겹**: ⓐ런타임 — 워크벤치가 support-matrix를 받을 때 `lenderCode` 집합을 양방향 대조해 어긋나면 콘솔 경고 1회(화면 동작은 불변, fail-open 유지) ⓑ수동 — **`bun run check:lenders`**(파트너 직접 조회, 어긋나면 exit 1). 판정은 순수 `detectLenderDrift`(solution-quote) 한 벌을 둘이 공유한다. ⚠️ **CI에는 넣을 수 없다** — CI는 파트너 네트워크·시크릿이 없다(env 없이 도는 게 CI 설계 전제). ⚠️ **개명(label 변경)은 이 그물로 못 잡는다** — 매트릭스가 code만 싣는다(개명돼도 호출은 code 기준이라 계산은 안 깨지고 표시만 낡는다). 요청문 = `ref/2026-07-23-jeff-lender-name-request.md`(저우선·미발송).
- **같은 파일 참조는 라인 번호가 아니라 식별자로**: 주석에 `위 :436에서`처럼 bare 라인 번호를 적으면 **같은 커밋 안에서도 밀린다**(배치 14 K3-c: 레포의 그 관용구 5건이 5건 전부 스테일이었고, 한 건은 총 80줄 파일에서 `:265`를 가리켰다). `위 targetLender.value 대입에서`처럼 심볼·케이스 이름으로 가리킬 것. 다른 파일은 `파일명:심볼` 형태.
- **마크다운 CSS 공용**: AI 답변 마크다운 스타일은 공용 `.md-body` + 컨텍스트별 `--md-*` 변수(index.css)로 단일 소스다. 업무 AI/채팅 콘솔별로 룰을 복제하지 말 것(#133 strong 회귀가 한쪽만 픽스되는 사고 방지).
- **로컬 브라우저 스모크 로그인 우회**: 로그인이 카카오 OAuth뿐이라 자동화 브라우저로는 직접 로그인 불가. GoTrue admin `generate_link`(magiclink, `.env.local`의 `SUPABASE_SECRET_KEY`)로 발급한 verify URL을 **curl로 따라가** Location 헤더의 `#access_token…` 해시만 추출해 `http://127.0.0.1:5173/#<해시>`를 열면 supabase-js가 세션을 수립한다(verify 링크를 브라우저로 직접 열면 redirect 허용목록 때문에 prod(mrcha.app)가 토큰을 소비하니 주의). 테스트 계정 = 자메스관리자(`luck2here@naver.com`, admin). 스모크로 만든 데이터(서류·업무 AI 대화·배정)는 공유 master라 반드시 원복/삭제.
- DB — vehicle catalog (master 직접): the car catalog (brands/models/trims/options/colors) lives in master Supabase's **`catalog` schema** (9 tables; CRM reads 7). CRM reads it **directly** via `src/db/client.ts` (`db`, `DATABASE_URL`=master) + `src/db/queries/vehicles.ts` + `src/routes/vehicles.ts` (`/api/vehicles`), wired into the Kim quote workbench via `client/src/components/VehiclePicker.tsx`. **거울/sync는 폐기됨(A2 Phase C, 2026-06-17)** — `src/sync/*`·`bun run sync`·`POST /api/catalog/sync`·`MRCHA_MASTER_*`·`ref/db_import/` 전부 제거. master catalog엔 `deleted_at`(거울 전용)이 없어 read 쿼리는 그 필터를 안 쓴다. `catalog.ts` 정의는 `bun run db:pull:catalog` 재introspect로 갱신(`status`는 cross-schema `public.car_status`라 text로 모델). History: `ref/vehicle-mirror-db.md`(폐기 표시).
- DB — CRM domain (master 직접): master의 **`crm` 스키마에 14테이블**(초기 8 = `customers`+니즈 인라인·`customer_tasks`·`customer_schedules`·`customer_documents`·`customer_memos`·`consultations`·`quotes`·`quote_scenarios` + 이후 증설 6 = `embeddings`(0012)·`assistant_messages`(0014)·`staff_settings`(0024)·`consultation_dismissals`(0026)·`customer_deletions`(0027)·`customer_deliveries`(0036, 출고 2단계) — 2026-07-13 실측 정정+2026-07-20 갱신, 구 "8테이블" 서술은 초기 상태). drizzle은 `schemaFilter:["crm"]`로 **crm만** 관리(public 앱 19테이블·catalog 9테이블 불가침), `db:generate`→`db:migrate`만(`db:push` 제거됨). 마이그레이션: `drizzle/0000`(crm 8테이블)·`drizzle/0001`(crm.quotes→catalog FK, ON DELETE SET NULL). public FK는 loose id 보류. `DATABASE_URL`(master)은 `.env.local`. drizzle-kit이 `.env.local`을 자동 로드 안 해 `drizzle.config(.catalog).ts`가 직접 주입.
