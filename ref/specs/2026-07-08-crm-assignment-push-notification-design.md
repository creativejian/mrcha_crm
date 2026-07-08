# CRM 배정 알림 FCM 푸시 설계 (슬라이스 1)

Last updated: 2026-07-08

## 1. 배경 / 문제

CRM에서 관리자·팀장이 상담사에게 업무를 **배정**할 때, 그 상담사에게 앱 푸시 알림을 보내려 한다. 상담사(role: staff/manager/admin)도 앱에 로그인해야 CRM 관련 알림을 받을 수 있고, 앱 `device_tokens`는 role 무관 저장이라 상담사 발송이 가능하다.

배정 이벤트는 두 가지다:

1. **실시간 상담 배정** — 실시간 상담 콘솔에서 관리자가 대기 상담을 특정 상담사에게 지정("배정…" 드롭다운).
2. **고객 담당자 배정** — 고객 상세에서 팀/담당자를 지정해 장기 담당 상담사를 배정.

## 2. 핵심 발견 (기존 인프라 재사용)

앱 세션이 이미 **서버 측 FCM 발송 인프라**를 구축해 prod에 배포했다(2026-07-07):

- `public.device_tokens` (앱 로그인 시 upsert, `user_id·token·platform`, token UNIQUE, RLS 본인행). **현재 0행**(실기기 로그인 전).
- `send-push` Edge Function (`POST .../functions/v1/send-push`): `{user_id, title, body, link, tag}` → device_tokens 조회 → FCM HTTP v1 발송 → **만료 토큰(UNREGISTERED/INVALID_ARGUMENT) 정리**.
- `_shared/fcm.ts`: 서비스 계정 JWT(RS256, jose) → OAuth2 토큰(1h 캐시) → FCM v1. 시크릿 = **Supabase Edge `FCM_SERVICE_ACCOUNT`** (CF Pages 아님).
- 기존 트리거 2종(`notify_advisor_quote`, `notify_staff_chat_message`) = **"DB 트리거 → `net.http_post` → send-push"가 이 시스템의 확립된 푸시 발송 패턴**. pg_net 설치·인프라 정상(notify-admin이 prod 200 OK).

→ CRM은 **FCM을 직접 발송하지 않는다.** 배정 시 `send-push`에 `{user_id, title, body}`만 전달하면 device_tokens 조회·발송·정리를 send-push가 전부 처리한다. (브리프의 "A안 = CRM이 FCM v1 직접 발송"은 **폐기** — 발송 로직 중복. 서비스 계정 시크릿도 CRM에 불필요.)

### 견적 발송→고객은 이 슬라이스 범위 밖 (이미 완성)

CRM "앱 발송"은 `advisor_quotes` upsert → 앱 트리거 `on_advisor_quote_sent` → send-push → 고객에게 "견적이 도착했습니다" + 딥링크 `/my_quotes/detail/{req_id}`로 **이미 완전히 배선**돼 있다. **CRM 코드 0줄.** 실기기 로그인 후 자동 동작(검증만 남음). 이 슬라이스와 무관.

## 3. 범위

**이 슬라이스(1)에 포함:**
- 실시간 상담 배정 → 상담사 푸시 (chat_sessions 트리거 = **앱 몫**)
- 고객 담당자 배정 → 상담사 푸시 (customers 백엔드 holdWork = **CRM 몫**)

**범위 밖 (별도 슬라이스/이미 완료):**
- **슬라이스 2**: 실시간 상담 수신 On/Off 영속 + 배정 드롭다운 필터. 현재 이 토글은 CRM Topbar `liveConsulting = useState(true)`(로컬)·앱 로컬 테스트 토글뿐 **어디에도 영속 안 됨**. 앱 브리프가 "SSOT는 CRM으로 확정"이라 명시. **저장소 결정(profiles 컬럼[앱 마이그·앱 handoff 게이팅이 읽을 경우] vs crm 자체 테이블)과 앱 handoff 연동 협의**가 필요해 별도 브레인스토밍한다. 이 슬라이스와 독립: 슬라이스 2 완성 시 Off 상담사는 드롭다운에서 빠져 배정 자체가 안 됨 → 알림도 자연 억제. **배정 알림 트리거/훅은 수신 상태를 몰라도 되며 수정 불필요.**
- 견적 발송→고객 (이미 앱 트리거가 커버, 위 §2).
- 배정 해제/회수 알림, 문구 다국어.

## 4. 결정 요약

| 이벤트 | 배정 경로 | 발송 방식 | self 제외 | 담당 |
|---|---|---|---|---|
| 실시간 상담 배정 | 프론트 supabase-js 직결(`chat.ts`) | **DB 트리거** → `net.http_post` → send-push | `NEW.assigned_staff_id ≠ auth.uid()` (takeOver=본인 인수 제외) | **앱 레포** (유슨생) |
| 고객 담당자 배정 | CRM 백엔드 PATCH(`customers.ts`) | **백엔드 `holdWork`** → fetch(send-push) | `advisorId ≠ c.var.user.sub` (배정 **기능**은 self 허용, **알림**만 제외) | **CRM 레포** |

- 발송 방식이 두 이벤트에서 다른 이유: **각 배정이 실제로 일어나는 지점에 발송을 둔다.** 실시간 상담은 프론트 직결이라 트리거가 유일한 서버 포착점(+`auth.uid()`로 self 판별 자연 성립). 고객 담당자는 백엔드 경유라 CRM 관례(embed-on-write와 동일한 `holdWork`)를 쓰고, drizzle 커스텀 SQL 트리거 첫 사례를 회피한다.
- **self 제외는 "알림"에만 적용, "배정 기능"에는 적용 안 함 (두 이벤트 공통):** 관리자가 자기를 담당자/상담사로 지정하는 **배정 기능 자체는 항상 정상 동작**(막지 않음 — 정상 워크플로우, 배정 드롭다운에 관리자 자신도 후보). 다만 **자기가 자기를 배정한 경우 알림은 보내지 않는다**(자기 행동에 자기 알림은 무의미). 실시간 상담은 `auth.uid()`, 고객 담당자는 `c.var.user.sub`로 배정 실행자를 식별해 대상과 같으면 **알림만** 스킵(저장은 정상). 실시간 상담의 takeOver("채팅 시작")도 self라 자연히 알림 제외.
- **공통 발송 계약**: 둘 다 `send-push`에 `{user_id, title, body}`만 전달(link 생략). 대상 `user_id`는 두 경우 모두 `profiles.id = auth.users.id = device_tokens.user_id` 동일 키 공간.

## 5. 설계

### 5.1 실시간 상담 배정 트리거 (앱 몫 — `public.chat_sessions`)

기존 `supabase/migrations/..._push_triggers.sql` 연장선에 함수+트리거 추가(견적·채팅 트리거와 동일 패턴). **계약(앱이 이대로 구현):**

- **트리거**: `AFTER UPDATE ON public.chat_sessions FOR EACH ROW`, 함수 `notify_chat_session_assigned`, `SECURITY DEFINER SET search_path='public, net'`.
- **발화 조건 (함수 초입 가드):**
  ```
  IF NEW.assigned_staff_id IS NULL THEN RETURN NEW; END IF;                       -- 배정 해제/미배정 무시
  IF NEW.assigned_staff_id IS NOT DISTINCT FROM OLD.assigned_staff_id THEN
    RETURN NEW; END IF;                                                            -- 배정 무변화(다른 컬럼만 변경) 무시
  IF NEW.assigned_staff_id IS NOT DISTINCT FROM auth.uid() THEN RETURN NEW; END IF;-- self(takeOver/본인 배정) 제외
  ```
  - `auth.uid()`가 배정 실행자를 반환하는 근거: chat_sessions는 프론트 supabase-js 직결(staff JWT)이라 PostgREST 요청의 `request.jwt.claims`가 세팅됨. SECURITY DEFINER는 실행 권한만 바꾸고 이 세션 설정은 유지 → `auth.uid()` = 배정을 실행한 staff. "채팅 시작"(takeOver: `assigned_staff_id = 본인`, `mode='human'`)은 self라 제외되고, "배정…"(assign: 남 지정)만 알림.
- **고객명 조달**: `NEW.user_id` → `public.profiles.full_name`(where `id = NEW.user_id`), 없으면 `'고객'`. **public 내 조회만**(crm 크로스 스키마 병합 안 함 — 확정). 실시간 상담 큐 표시명도 profiles 기반이라 일관.
- **발송**: `net.http_post`로 send-push 호출:
  ```
  body := jsonb_build_object(
    'user_id', NEW.assigned_staff_id,
    'title',   '새 실시간 상담이 배정되었습니다',
    'body',    <고객명>,
    'tag',     'chat-assign-' || NEW.id::text
  )
  ```
  - `link` 미포함 → send-push가 기본 `"/"` 사용 → 앱 `sanitizePushLink`가 무시 → **알림만 표시, 탭해도 홈**(딥링크 없음 = 유슨생 결정: "CRM에서 확인").
- **권한**: `REVOKE EXECUTE ... FROM PUBLIC, anon` (기존 트리거 함수와 동일).

### 5.2 고객 담당자 배정 훅 (CRM 몫 — `crm.customers`)

**위치**: `src/routes/customers.ts` PATCH `/:id` 배정 분기(현재 `:98-131`). 기존에 `advisorName` 변경 시 `assignedAt` 스탬프를 찍는 로직이 있고, 저장 성공 후 `if (row) { ... scheduleEmbedOnWrite(...) }` 훅 블록이 있다. **이 블록에 배정 푸시를 추가**한다.

- **발송 조건**: 아래 3개 모두 참일 때. (이 조건은 **알림 발송에만** 적용 — PATCH 배정 저장 로직은 불변, self여도 정상 저장.)
  1. `advisorId`가 이번 PATCH로 실제 세팅/변경됨(NULL→값 또는 값 변경). — 배정 분기에서 "실제 담당자 변경" 신호를 계산해 라우트로 내려야 함(현재 `assignedAt` 스탬프 조건과 동일한 판정 재사용).
  2. `advisorId IS NOT NULL` (배정 해제는 알림 없음).
  3. `advisorId !== c.var.user.sub` (배정 실행자 본인 = 대상이면 **알림만** 스킵 — 자기 배정은 저장은 되되 알림 불필요).
- **발송**: `holdWork(c, sendAssignmentPush(...))` — 응답 비차단(embed-on-write와 동일한 `holdWork` 사용). throw 안 함(저장 응답 불변, 실패는 로그만).
  ```
  holdWork(c, sendAssignmentPush(c, {
    userId: advisorId,
    title: "담당 고객으로 배정되었습니다",
    body:  customer.name,
  }).then(로그, 에러로그))
  ```
- **문구 body** = `crm.customers.name`(배정 대상 고객명). 이미 라우트가 아는 값(또는 저장 row에서).

### 5.3 send-push 발송 헬퍼 (CRM 신규 — `src/lib/push-notify.ts`)

CRM 백엔드가 send-push Edge Function을 호출하는 순수 헬퍼. deps 주입형(테스트 격리, `embed-on-write.ts`/`gemini-post.ts` 관례).

- **시그니처**: `sendAssignmentPush(c, { userId, title, body }): Promise<void>`
- **URL**: `${SUPABASE_URL}/functions/v1/send-push` — `SUPABASE_URL`은 기존 `env?.SUPABASE_URL ?? process.env.SUPABASE_URL` 관례(`storage.ts`)로 읽음. (하드코딩 대신 조립 — 트리거는 URL 하드코딩이지만 CRM은 이미 SUPABASE_URL을 env로 씀.)
- **인증**: send-push는 `app.post("*")`에 auth 미들웨어 없음(트리거가 `Content-Type`만으로 호출해 200). CRM도 인증 헤더 없이 POST. (send-push가 `verify_jwt=false`로 배포된 전제 — §8 확인 항목.)
- **호출**: `fetch(url, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ user_id, title, body }) })`. `fetchImpl` 주입 가능. 재시도는 불필요(배정 알림은 best-effort, send-push 자체가 만료 정리 담당). 실패는 로그만(`[push] 배정 알림 발송 실패 ...`).
- **관측 로그**: 성공 시 `[push] 배정 알림 → user=<id> "<title>"` (prod tail로 발송 관측).

### 5.4 문구

| 이벤트 | title | body |
|---|---|---|
| 실시간 상담 배정 | `새 실시간 상담이 배정되었습니다` | 고객명 |
| 고객 담당자 배정 | `담당 고객으로 배정되었습니다` | 고객명 |

- `link` 없음(알림만). `tag`로 그룹핑/중복 억제(`chat-assign-<session_id>` / `customer-assign-<customer_id>`).

## 6. 분업

| 구분 | 작업 | 담당 |
|---|---|---|
| 앱 (public) | `notify_chat_session_assigned` 함수+트리거 (§5.1 계약) → `db push` | **유슨생 (앱 폴더)** |
| 앱 (Edge) | `FCM_SERVICE_ACCOUNT` 시크릿 설정 확인 (§8) | **유슨생 (앱 폴더)** |
| CRM (백엔드) | `src/lib/push-notify.ts` + `customers.ts` 배정 훅 (§5.2/5.3) | CRM |
| 공통 | send-push·device_tokens·pg_net | **이미 존재, 추가 없음** |

## 7. 검증

- **device_tokens 0행** → 실제 FCM 수신 e2e는 실기기(상담사 앱) 로그인 후에만 가능(유슨생/앱). 그 전까지 send-push는 `{"message":"no tokens","sent":0}`를 반환(정상).
- **CRM 백엔드 훅 단위 테스트** (`bun run test:server`): 배정 PATCH에서 (a)조건 충족 시 `sendAssignmentPush` 호출 (b)self(배정자=대상) 시 알림 미호출 — **단 배정 저장은 정상(row.advisorId 세팅됨) 회귀 가드** (c)advisorId 미변경 시 미호출 (d)배정 해제(null) 시 미호출. `fetchImpl` mock으로 send-push payload(`{user_id,title,body}`) 검증.
- **트리거 발화 검증** (앱, 실기기 전): staff JWT로 chat_sessions.assigned_staff_id UPDATE → `net._http_response`에 send-push 응답(`"no tokens"`) 확인 = 트리거 발화·send-push 도달 실증. self UPDATE 시 응답 없음(가드 검증).
- **회귀**: 기존 견적 발송(`advisor_quotes` 트리거)·기타 customers PATCH 경로 불변. `bun run typecheck`·`lint 0`·`test:unit`·`build`.
- **master 오염 주의**: 검증용 배정·토큰은 공유 master라 반드시 원복/삭제(브리프 관례).

## 8. 열린 확인 / follow-up

- **[확인] `FCM_SERVICE_ACCOUNT` 시크릿** — send-push가 이걸 읽어 FCM 발송. 미설정 시 트리거는 발화해도 send-push가 500. 이 파이프라인 전체의 유일한 미확인 지점. 유슨생이 앱 폴더에서 확인(`supabase secrets list`).
- **[확인] send-push `verify_jwt`** — 인증 없이 호출 가능해야(트리거·CRM 둘 다 헤더 없이). notify-admin이 prod 200 OK인 정황상 false로 추정되나 config.toml 확인 권장.
- self 제외는 알림에만 적용(§4): 두 이벤트 공통으로 **배정 기능은 self 허용**, 배정 실행자=대상이면 **알림만** 스킵(실시간=`auth.uid()`, 고객 담당자=`c.var.user.sub`). 저장 로직은 불변.
- 배정 알림 문구/조건 튜닝(실사용 관찰), 배정 해제·재배정 시 이전 담당자 회수 알림(현재 미포함).
- **슬라이스 2 선행 의존**: 실시간 상담 수신 On/Off 영속이 붙으면, 그때 트리거에 "수신 On" 방어 가드를 추가할지 재검토(1차 방어는 드롭다운 필터).
