# 실시간 상담 운영 설정 (상담 운영 페이지) 설계 (2026-07-11)

## 배경

앱 이슈 [#582](https://github.com/dl-auto/mr-cha-app/issues/582) — 실시간 상담의 운영 제어권을
앱의 임시 로컬 테스트 UI(운영시간 하드코딩 + Riverpod 메모리 AUTO/ON/OFF)에서 **Supabase SSOT +
CRM 최고관리자 콘솔**로 이전한다. 3자 책임 경계:

- **Supabase**: 설정 SSOT(`public.human_handoff_settings`), 최종 판정·원자적 전이 RPC, 감사, 자동 timeout cron
- **CRM**: 최고관리자 운영 설정 UI + 상담사 화면 현재 운영 상태 표시 ← **이 슬라이스**
- **앱**: 판정 결과 표시·유선 상담 접수 UX(3단계 — 앱 팀 별도 진행)

앱 팀이 2026-07-11 13:30 KST Supabase 몫 배포 완료(마이그 `20260711170000_human_handoff_operation_settings.sql`).
**CRM이 같은 날 실측 검증 완료**: 시드(automatic·월~금 09:00~18:00)·REVOKE(authenticated SELECT만)·
RLS(감사는 admin 전용)·Realtime publication 포함·판정 RPC 실호출(토요일 `outside_hours` +
`next_open_at`=월요일 09:00 KST + `{schedule}` 치환 완료본) 전부 회신과 일치.

## 확정 결정

1. **UI 위치 = 프로필 팝오버 "차선생 앱 설정" 그룹 + 전용 페이지 라우트(이사님·유슨생, 2026-07-11)**:
   팝오버의 기존 On/Off 토글(#194 — `crm.staff_settings.live_receiving`, 상담사 **개인 수신**)은
   불변. 그 아래 "차선생 앱 설정" 그룹(MC 마스터 선례) 맨 아래에 **"상담 운영"** 메뉴 행을 추가하고
   전용 설정 페이지로 이동한다. 3상태 모드 + 요일 7행 스케줄 + 문구 2종 + 사유 + 감사 이력은
   팝오버에 담을 수 없다 — 페이지가 맞다.
2. **개인 수신 vs 전사 운영 모드는 다른 것**: #194 토글 = 이 상담사가 배정 후보에서 빠질지(CRM 내부).
   이 슬라이스 = 고객 앱에서 상담사 연결 자체가 가능한지(전사·고객 대면). 물리적으로 분리해 혼동 차단.
3. **저장 경로 = 브라우저 supabase-js RPC 단일**(`update_human_handoff_settings`): admin 검사 +
   UPDATE + 감사 INSERT가 서버에서 한 트랜잭션. 테이블 직접 쓰기는 REVOKE(우리가 요구, 앱 팀 이행).
   CRM 서버(src/) 변경 0 — postgres 롤 우회 경로를 아예 만들지 않는다.
4. **노출 = 최고관리자 전용**: 메뉴는 `isAdminRole` 그룹 안, 라우트는 finance 패턴
   (`isAdmin ? <Page/> : <Navigate to="/" replace/>`). RPC도 admin 검사(42501→403)라 3중 fail-closed.
   상담사가 볼 것은 ChatPage 배지(읽기 전용)로 별도 제공.
5. **상담사 배지 = ChatPage `chat-tabs` 행**: 전역 상태이므로 세션 헤더가 아닌 탭 행 오른쪽.
   판정은 시각 의존이라 Realtime 설정 변경 이벤트 시 + 60초 인터벌로 판정 RPC 재호출
   (운영시간 경계 통과를 화면 갱신 없이 반영).

## Supabase 계약 (실측 확정치 — 앱 팀 배포분)

### `public.human_handoff_settings` (singleton, `id=1` CHECK)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `mode` | text | `automatic / force_on / force_off` CHECK |
| `timezone` | text | 기본 `Asia/Seoul` |
| `schedule` | jsonb | 아래 구조 |
| `force_message` | text | force_off 시 고객 안내 |
| `outside_hours_message` | text | `{schedule}` 플레이스홀더 → 판정 시 스케줄 설명으로 치환 |
| `updated_by` / `updated_at` | uuid / timestamptz | |

schedule JSONB — 키는 `mon`~`sun` **정확히 7개**, 휴무일은 `null`, 시각은 `"HH:MM"` 24시간제:

```json
{ "mon": {"start": "09:00", "end": "18:00"}, …, "sat": null, "sun": null }
```

- `end`는 **exclusive**(18:00 정각부터 불가) · `start == end` = 그 요일 24시간 운영 ·
  `start > end` = 자정 넘김(시작 요일 기준)
- 직접 쓰기: anon/authenticated 전부 REVOKE(SELECT만 허용) — 변경은 RPC 단일 경로
- Realtime: `supabase_realtime` publication 포함(실측)

### `public.human_handoff_setting_audits`

`changed_by`(FK 없는 스냅샷) · `reason` · `old_value`/`new_value`(행 전체 jsonb) · `created_at`.
직접 INSERT 불가, RPC 내부 기록. **조회는 admin 전용 RLS** — 페이지의 이력 섹션이 그대로 소비.

### RPC 3종 (모두 authenticated 허용·anon 차단)

| RPC | 인자 | 반환 |
|---|---|---|
| `get_human_handoff_availability()` | 없음 | TABLE: `available` bool, `mode`, `reason`(available/force_off/outside_hours), `schedule_description`, `next_open_at` timestamptz(outside_hours만 non-NULL), `message`(불가 시만·`{schedule}` 치환 완료본), `settings_updated_at` |
| `request_human_handoff(p_session_id uuid)` | 세션 id | (앱 전용 — CRM 미사용) |
| `update_human_handoff_settings(p_mode, p_schedule, p_force_message, p_outside_hours_message, p_reason, p_timezone DEFAULT 'Asia/Seoul')` | reason 필수 | 변경 후 `human_handoff_settings` 행 전체. SECURITY DEFINER — admin 검사(JWT `user_role` claim, 폴백 `private.is_admin()`) + UPDATE + 감사 INSERT 원자. 권한 실패 ERRCODE 42501 → PostgREST **403** |

- RETURNS TABLE이라 supabase-js에서 배열 1행 — `.single()` 사용.
- 새 system_kind **없음**(서버 RPC는 chat_messages 미삽입 — 문구 계약 무접점, 앱 팀 확인).

## 구성

### 1. 상수 — `client/src/data/chat.ts` (추가)

- `HANDOFF_MODES = ["automatic", "force_on", "force_off"] as const` + `HandoffMode`
- `HANDOFF_MODE_LABELS: Record<HandoffMode, string>` — `운영시간 적용 / 강제 ON / 강제 OFF`
- `HANDOFF_DAY_KEYS = ["mon", …, "sun"] as const`(월요일 시작 표시 순서) + `HANDOFF_DAY_LABELS`(월~일)

### 2. lib — `client/src/lib/handoff-settings.ts` (신규)

supabase-js 접근 + 순수 변환. `.rpc()` 첫 사용 사례.

- 타입: `DaySchedule = { start: string; end: string } | null`, `WeekSchedule = Record<DayKey, DaySchedule>`,
  `HandoffSettings`, `HandoffAvailability`, `HandoffAudit`
- `fetchHandoffSettings()`: 설정 행 SELECT `.single()`
- `fetchHandoffAvailability()`: `rpc("get_human_handoff_availability").single()`
- `saveHandoffSettings(draft, reason)`: `rpc("update_human_handoff_settings", {...}).single()` → 변경 후 행 반환
- `fetchHandoffAudits(limit=20)`: 감사 최근 N행(`created_at desc`)
- `subscribeHandoffSettings(onChange)`: postgres_changes UPDATE 구독 —
  `chat-realtime.ts` 패턴(채널명 `crm-handoff-settings-${++seq}` 고유화, cleanup=removeChannel)
- 순수 함수(유닛 테스트 대상): `parseWeekSchedule(jsonb)`(방어 파싱 — 키 누락/형식 이탈 시 null 처리),
  `scheduleDraftErrors(draft)`(HH:MM 검증 — time input이 보장하지만 프로그램 경로 방어),
  `availabilityBadge(availability)`(배지 라벨·톤 파생 — reason→`상담 접수 중/강제 ON 접수 중/운영시간 외/강제 OFF`)

### 3. 페이지 — `client/src/pages/HandoffOperationPage.tsx` (신규)

위→아래 단일 컬럼(설정 콘솔 톤 — mc-master 계열 문법):

1. **현재 상태 카드**: 판정 RPC 결과 — "지금 고객 앱: 상담사 연결 가능/불가" + 사유 + (outside_hours면)
   다음 오픈 시각(KST 포맷). 저장 성공 시 재판정.
2. **운영 모드**: 3세그먼트 버튼(automatic/force_on/force_off — select 아님, Safari 함정 무관).
   force_off 선택 상태에는 경고 톤(운영시간 안이어도 전면 차단임을 명시).
3. **운영시간**: 요일 7행 — 운영 체크박스 + `<input type="time">` 시작/종료(휴무면 disabled).
   자정 넘김·24시간 의미론 힌트 텍스트. `automatic`이 아닐 때도 편집 가능(모드와 독립 저장).
4. **고객 안내 문구**: textarea 2개(`force_message`/`outside_hours_message`) + `{schedule}`
   플레이스홀더 안내.
5. **저장**: 변경 사유 input(**필수** — RPC `p_reason`) + 저장 버튼. draft 전체를 RPC 한 방으로.
   성공 → 반환 행으로 state 동기화 + 판정 재호출 + 이력 재조회 + 토스트. 403 → "최고관리자만
   변경할 수 있습니다" 표면화.
6. **변경 이력**: 감사 최근 20행 — 시각(KST)·변경자·사유·before/after 요약(모드 전이 중심).

파생 규칙: draft는 로드 시 설정 행에서 시드, dirty 비교로 저장 버튼 활성화. Realtime 변경 수신 시
**dirty가 아니면** 재시드(다른 관리자 변경 반영), dirty면 배너로 알림만(편집 중 덮어쓰기 금지).

### 4. 배선 — `App.tsx` + `Topbar.tsx`

- `ViewKey`에 `"handoff-operation"` + `VIEW_TO_PATH` `/handoff-operation` + `viewMeta`
  `["상담 운영 설정", "고객 앱 실시간 상담사 연결의 운영시간과 강제 ON/OFF, 안내 문구를 관리합니다."]`
- `<Route path="/handoff-operation" element={isAdmin ? <HandoffOperationPage onToast={showToast}/> : <Navigate to="/" replace/>} />`
- Topbar "차선생 앱 설정" 그룹 맨 아래(AI 커스텀 다음)
  `navigateFromSettings("handoff-operation")` 메뉴 행 + `SettingSolidIcon` 신규 name.
- 사이드바 항목 없음(mc-master와 동일 — 프로필 팝오버 전용 진입).

### 5. ChatPage 배지

`chat-tabs` 행 오른쪽 `HandoffStatusBadge`(chat 컴포넌트 폴더): 마운트 판정 RPC + Realtime
구독 시 재판정 + 60s 인터벌. 라벨 = `availabilityBadge` 파생(접수 중=green / 강제 ON=green
강조 / 운영시간 외=neutral / 강제 OFF=red). admin이면 클릭 → `/handoff-operation` 이동
(비admin은 정적 표시). 판정 실패 시 배지 숨김(상담 콘솔 본기능 무영향 — fail-open 표시).

## 범위 밖 (의도)

- `request_human_handoff` 소비(앱 몫 3단계), 공휴일/임시 휴무(이슈에 "추후 확장"으로 명시),
  timezone 편집 UI(Asia/Seoul 고정 표시), 감사 페이지네이션(최근 20 고정).
  > ⚠️ **"RPC DEFAULT 사용"은 폐기됨(#314, 2026-07-22)** — 저장은 `p_timezone`을 **명시 전달**한다.
  > DEFAULT에 기대면 그 값이 흘렀을 때(UTC) 앱 운영시간 판정이 에러 없이 9시간 밀린다.
  > 계약은 `AGENTS.md`, 회귀 그물은 `handoff-settings.test.ts`. (표시가 고정인 것은 그대로 유효.)
- 앱 3단계 전까지 이 설정은 **고객 앱 행위에 영향 없음**(앱이 아직 로컬 판정) — CRM이 먼저
  배포해도 안전. 단 스모크 시점에 앱 3단계 배포 여부 재확인.

## 검증

- 유닛: lib 순수 함수(스케줄 파싱 방어·draft 검증·배지 파생) TDD.
- 4종: typecheck 0 · lint 0 · test:unit · build.
- 격리 스택 브라우저 스모크(magiclink admin): 페이지 진입(시드 표시) → 모드 force_off 저장 →
  psql 대조(행 + 감사 1행) → 판정 카드·ChatPage 배지 갱신 확인 → 원복 저장 → **psql로 설정
  세 컬럼(updated_by/updated_at 포함) 원값 복원 + 스모크 감사 행 삭제**(감사는 postgres 롤
  DELETE 가능 — 공유 master 잔재 0 원칙).
- 스모크 중 force_off는 앱 3단계 전이라 고객 영향 0(위 범위 밖 참조) — 시점 재확인 후 진행.
