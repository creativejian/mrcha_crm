# CRM 실시간 상담 수신 On/Off 영속 + 배정 드롭다운 필터 (배정 알림 슬라이스 2)

작성일: 2026-07-08 · 세션 0708-FCM-notification-02 · 유슨생(Claude Code)

배정 알림 FCM 슬라이스 1(PR #193, 고객 담당자 배정 → 상담사 푸시)의 후속. spec `ref/specs/2026-07-08-crm-assignment-push-notification-design.md` §슬라이스 2를 정식 설계로 확정한다.

## 1. 문제

CRM Topbar 계정 설정의 **실시간 상담 수신 On/Off 토글**(`liveConsulting = useState(true)`)은 로컬 상태뿐이라 **어디에도 영속되지 않는다** — 새로고침/재로그인/새 세션마다 항상 On으로 초기화된다. 앱도 로컬 테스트 토글만 제공하며, 앱 브리프(`reference/design/app-ui-ux-active-session-brief.md`)가 **"실시간 상담 운영 설정의 정식 주체는 CRM으로 확정"**이라 명시했다.

토글이 영속되지 않으니 **실시간 상담 콘솔의 배정 드롭다운**(`ChatSessionHeader`)이 수신 Off 상담사를 걸러낼 수 없다. 관리자가 자리를 비운(Off) 상담사에게 대기 상담을 배정하는 사고를 막지 못한다.

## 2. 확정 결정 (브레인스토밍 2026-07-08)

1. **의미론 = 상담사(로그인 사용자) 개인별 수신 상태.** 현재 토글 문구("On 상태에서는 관리자가 상담 배정을 시작합니다")가 이를 뒷받침. `canManageLiveConsulting = !dealer`(상담사·팀장·관리자 각자 자기 토글).
2. **저장소 = `crm` 스키마 자체(신설 `crm.staff_settings`).** 이 상태는 **CRM 콘솔 내부용**으로만 쓰며 앱(Flutter)은 읽지 않는다 → `public.profiles` 컬럼 추가(앱 마이그레이션 협의 필요)를 배제하고 crm 단독 저장. 상담사 개인 설정을 담을 crm 테이블이 현재 없어 신설한다.
3. **읽기/쓰기 경로 = CRM 백엔드 API.** crm 스키마는 프론트 supabase-js로 접근하지 않는다(이 프로젝트의 확립된 패턴 — 프론트 supabase-js 직결은 chat 도메인의 public 테이블만). 자기 수신 상태는 신규 `GET/PATCH /api/me/live-consulting`.
4. **배정 필터 = 백엔드 통합(경로 A).** 실시간 상담 배정 select를 supabase-js 직결 `fetchStaffOptions` → 백엔드 `GET /api/staff` 기반으로 전환한다. `GET /api/staff` 응답에 `liveReceiving`를 추가하고, 실시간 상담 배정만 Off 제외한다. `fetchStaffOptions`(supabase-js)와 `GET /api/staff`(백엔드)는 사실상 중복 경로였으므로 이 통합이 중복 제거 = 단순화도 겸한다.
5. **배정 알림 훅(슬라이스 1)은 수정 불필요.** Off면 배정 후보에서 빠져 배정 자체가 안 되므로 알림이 자연 억제된다. 트리거/훅은 수신 상태를 몰라도 된다.

## 3. 데이터 모델 — `crm.staff_settings` 신설

```
crm.staff_settings
  staff_user_id   uuid         PRIMARY KEY   -- profiles.id loose FK (public FK는 loose 보류 관례)
  live_receiving  boolean      NOT NULL DEFAULT true
  updated_at      timestamptz  NOT NULL DEFAULT now()
```

- 상담사당 1행. 쓰기는 upsert(`ON CONFLICT (staff_user_id) DO UPDATE`).
- 테이블명을 `staff_settings`로 둬 미래 상담사 개인 설정(알림 선호 등) 확장 여지를 남긴다.
- 마이그레이션은 `bun run db:generate` → `bun run db:migrate`, 항상 `schemaFilter:["crm"]`(public 앱·catalog 불가침). `db:push` 금지.

## 4. 백엔드 계약

### 4.1 자기 수신 상태 (`src/routes/me.ts` 신설, `/api/me` 네임스페이스)

- **`GET /api/me/live-consulting`** → `{ receiving: boolean }`
  - `c.var.user.id`(본인 — `AuthedUser.id`, JWT sub 기반)로 `staff_settings` 조회. 행 없으면 `{ receiving: true }`(기본값).
- **`PATCH /api/me/live-consulting`** body `{ receiving: boolean }`(zod) → upsert 후 `{ receiving }`. (`http.ts`의 쓰기 헬퍼 `sendJson`이 POST/PATCH/DELETE만 지원 — PUT 없음. PATCH가 이 저장소의 쓰기 관례.)
  - self만 접근하므로 역할 scope 무관. auth 미들웨어만 통과하면 됨.
- `/api/me/*`에 `auth` + `dbMiddleware` 배선(app.ts).

### 4.2 `GET /api/staff` 확장 (비파괴)

- 응답 각 행에 `liveReceiving: boolean` 추가. `staff_settings` LEFT JOIN, 행 없으면(null) `true`로 coalesce.
- 기존 필드(`id`, `name`, `role`)·정렬(이름순+id 타이브레이커)·이름 없는 계정 제외는 불변.
- 고객 담당자 배정(`useStaffDirectory`)은 이 필드를 **무시**(필터 안 함). 실시간 상담 배정만 소비.

## 5. 프론트 변경

### 5.1 Topbar (`client/src/components/Topbar.tsx`)

- 마운트 시(딜러 제외) `GET /api/me/live-consulting`로 `liveConsulting` 초기값 로드.
- 확인 다이얼로그 확정(`setLiveConsulting(...)` 지점)에서 `PATCH` 호출 — **낙관적 반영 + 실패 시 이전 상태 롤백**. Topbar에 `onToast` prop이 없어 롤백은 **조용히**(수신 토글은 재시도 가능한 보조 동작 — `staff.ts` 배정 주석과 동일 정신). 마운트 로드는 유저가 토글한 뒤 늦게 resolve해도 유저 선택을 덮어쓰지 않도록 `touchedRef` 가드.
- **GET 실패 fallback = 수신 중(true).** 기존 동작과 동일해 회귀 0. 배정은 관리자 수동이라 "로드 실패 시 전원 배정 불가(false)"는 과하다.

### 5.2 실시간 상담 배정 경로 통합

- **ChatPage(`client/src/pages/ChatPage.tsx`)**: `fetchStaffOptions`(supabase-js) 소비 제거 → `staff.ts`의 `fetchStaffDirectory`(`GET /api/staff`) 재사용. `getStaffId`(자기 id)는 유지.
- **`client/src/lib/chat.ts`**: `fetchStaffOptions`·`StaffOption` 타입 제거. `getStaffId`·`assignSession`·`takeOverSession` 등은 유지.
- **`client/src/lib/staff.ts`**: `StaffEntry`에 `liveReceiving: boolean` 추가. `fetchStaffDirectory` 세션 캐시는 유지하되 `liveReceiving`가 가변 필드임을 주석에 명시(§6 stale 허용).
- **ChatSessionHeader(`client/src/components/chat/ChatSessionHeader.tsx`)**: props 타입 `StaffOption[]` → `StaffEntry[]`.
  - 배정 select 후보 = `staffOptions.filter(s => s.liveReceiving)`.
  - `assignedName` 해석 = **전체 `staffOptions`**(필터 전) — Off인데 이미 배정된 상담사의 이름 표시가 깨지지 않도록.

## 6. 엣지·범위

- **`takeOver`("채팅 시작", Off 상담사 자발적 인수)는 막지 않는다.** 자기가 지금 받겠다는 명시적 액션이므로 슬라이스 범위 밖.
- **self 배정**: Off면 후보에서 자연 제외. On인 자기를 자기가 배정하는 건 정상(막지 않음).
- **캐시 stale 허용**: `fetchStaffDirectory`는 세션 1회 캐시라 `liveReceiving`가 완전 실시간은 아니다(상담사가 콘솔 열어둔 중간에 Off 해도 관리자 재진입 전까지 stale). 관리자 배정은 수동이고 콘솔 재진입/새로고침 시 최신이라 허용. 완전 실시간 필터는 follow-up(no-cache 배정용 fetch 분기).
- **배정 알림 훅 무수정**(§2-5).

## 7. 검증

- `bun run typecheck` 0 · `bun run lint` 0.
- `bun run test:server`: 신규 `GET/PATCH /api/me/live-consulting`(무토큰 401·기본 true·upsert 왕복), `GET /api/staff` `liveReceiving`(설정 없는 계정 true·Off 계정 false).
- `bun run test:unit`: live-consulting lib(fetch/save). **Topbar·ChatSessionHeader는 거대·통합 컴포넌트라 유닛 대신 브라우저 스모크로 검증**(프로젝트 관례 — "거대 페이지 컴포넌트는 수동/스크린샷") — Topbar 로드/롤백, 배정 select 필터(Off 제외·assignedName 전체 해석)는 아래 스모크로.
- `bun run build`.
- 마이그레이션 `psql "$DATABASE_URL"` 실측(테이블 생성·upsert).
- 브라우저 스모크(magiclink): 토글 Off 저장 → 재로그인 복원, 실시간 상담 콘솔에서 Off 상담사 배정 후보 제외, 이미 배정된 Off 상담사 이름 유지. 스모크로 만든 staff_settings 행은 원복.

## 8. Follow-up

- 배정 콘솔 완전 실시간 필터(캐시 우회 or Realtime 구독) — 실사용 관찰 후.
- 미래 앱이 이 상태를 읽어야 하면(고객 "상담사 연결" 가능 여부 게이팅) `public` 이관 재설계 필요 — 그때 앱 마이그레이션 협의(현재는 CRM 내부용 확정).
- `crm.staff_settings`에 다른 상담사 개인 설정(알림 선호 등) 추가 시 이 테이블 재사용.
