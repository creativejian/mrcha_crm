# CRM 실시간 상담 (앱 채팅 상담원 콘솔) — 설계 (v1 수직 슬라이스)

- 날짜: 2026-07-02
- 상태: 설계 승인됨 (구현은 다른 세션 작업 종료 후 착수)
- 목적: 앱(mr-cha-app)의 고객 채팅(AI 상담 ↔ 상담원 연결)을 CRM에서 상담원이 실시간으로 받는 콘솔로 구현. `client/src/pages/ChatPage.tsx` 목업(61줄)을 실동작으로 교체한다.

## 1. 배경 조사 요약 (2026-07-02 실측)

### 1.1 public 스키마는 이미 상담원 콘솔을 전제로 설계돼 있다

- `public.chat_sessions`: `id`, `user_id`(FK profiles, CASCADE), `mode`(text CHECK `ai`/`pending`/`human`, default `ai`), `assigned_staff_id`(FK profiles), `assigned_at`, `created_at`, `updated_at`(트리거 자동 갱신).
- `public.chat_messages`: `id`(uuidv7), `user_id`, `message`, `is_user`(bool), `sender_type`(text CHECK `user`/`ai`/`staff`/`system`, default `user`), `session_id`(nullable FK), `staff_id`, `attachment_url`, `attachment_width/height`, `a2ui_data`(jsonb), `related_questions`(jsonb), `created_at`.
- **staff용 RLS 정책 기존재**: 두 테이블 모두 "Staff can view all"(SELECT), sessions에 "Staff can update"(UPDATE), messages에 "Staff can insert"(INSERT). 대상 role = `staff`/`manager`/`admin` — 현 CRM 로그인 계정(admin 3, manager 1)과 일치.
- 두 테이블 모두 `supabase_realtime` publication 등록됨(+ replica identity full).

### 1.2 앱 구현 레퍼런스 (SSOT = 앱 레포 `/Users/tobedoit/Documents/Flutter/mr-cha-app`)

- 상태 전환: 고객이 "상담사 연결" 선택 → `mode='pending'` + system 메시지 → 스태프 인수(`takeOverSession`) → `mode='human'` + `assigned_staff_id`/`assigned_at` → 반환(`returnToAi`) → `mode='ai'`.
- **AI 침묵은 서버에 이미 구현됨**: Edge Function `ai-analyst`(Gemini `gemini-3.1-flash-lite`)가 요청 처리 전 `chat_sessions.mode`를 조회해 `human`이면 `{skipped:true}` 반환(index.ts:359-374). CRM은 아무것도 안 해도 됨.
- 실시간: Supabase Realtime postgres_changes — 세션(UPDATE/INSERT), 메시지(`user_id` eq 필터, INSERT/UPDATE). 타이핑은 broadcast 채널 `typing:$userId`(v1 제외).
- **앱 레포 안에 스태프 화면이 이미 존재**(`lib/presentation/screens/admin/admin_chat_detail_screen.dart`, `handoff_provider.dart`) — CRM ChatPage는 이 admin 섹션의 웹 포팅이며, semantics는 이 코드를 따른다(문구·assigned clear 여부 등 세부는 plan 단계에서 앱 코드 재확인).
- 상수 SSOT: `lib/core/constants/app_status.dart`(mode·라벨), `db_tables.dart`(테이블명), `storage_buckets.dart`(첨부 버킷 `quote_attachments`, public URL).

### 1.3 실데이터 quirk (렌더링 규칙에 반영)

- 메시지 8,943건 중 구세대(세션 없음) 8,805건: 고객 4,422 + AI 4,383. **AI 메시지가 `sender_type='user'` + `is_user=false`로 저장돼 있음**(sender_type은 나중에 추가된 컬럼). 신형은 staff 63·system 37·user 38건.
- 세션 8개 전부 `mode='ai'`, 배정 0 — 상담원 연결은 실가동 전. "종료" 상태는 스키마에 없음(세션 재사용 방식).

## 2. 확정 결정

| 항목 | 결정 |
|---|---|
| 아키텍처 | **프론트 supabase-js 직결** (`client/src/lib/supabase.ts` staff JWT + RLS + Realtime). 백엔드·DDL 변경 0 |
| public 쓰기 원칙 | 불가침 원칙은 DDL(drizzle schemaFilter) 경계. row 쓰기는 staff RLS 정문 통과 = 앱 admin 섹션과 동일 통로. superuser(DATABASE_URL) 쓰기는 하지 않음 |
| v1 범위 | 큐(mode 3탭+전체) + 히스토리 + Realtime 수신 + 배정/채팅 시작/AI 반환 + 상담원 전송 + 첨부 이미지 표시 + 고객 상세 이동 + Topbar 알림 |
| 큐 탭 | 전체 / 상담원 연결 요청(`pending`) / 상담원 상담중(`human`) / AI 상담중(`ai`). "응답 대기"·"종료" 탭은 목업에서 폐기(DB에 없음) |
| AI 상담 요약 | v1 제외, 후속 슬라이스(B1 업무 AI assistant.ts 패턴 재사용 예정) |

기각안: ②백엔드 Hono 경유(superuser 쓰기 = RLS 우회, `public-app.ts` read-only 철학 위반, Realtime은 결국 프론트 필요) ③하이브리드(쓰기만 백엔드 — 같은 문제 + 통로 이원화).

## 3. 데이터 계약 (모두 기존 컬럼, 변경 없음)

- **큐**: `chat_sessions` + `profiles` 조인(고객명·연락처). 앱 admin과 동일하게 `role='customer'` 유저의 세션만. 정렬 `updated_at desc`. 대기시간 = pending 세션의 `updated_at` 경과 파생값. "미배정 N" = `mode='pending' and assigned_staff_id is null` 집계.
- **히스토리**: `chat_messages`를 **`user_id` 기준** 조회(구세대 AI 대화 포함 — 상담원이 AI 맥락을 봐야 인수 가능). 최근 50건 + "이전 메시지 더 보기"(created_at 커서 페이지네이션).
- **발신자 판별 규칙**: `sender_type='staff'` → 상담원 / `'system'` → 중앙 안내줄 / 그 외 `is_user ? 고객 : AI`.
- **첨부**: `attachment_url` 있으면 img 렌더(public URL), `attachment_width/height`로 비율 예약. 상담원 발신 첨부는 v1 제외.

## 4. 상태 전환 (목업의 "배정"·"채팅 시작" 버튼 분리 유지)

| 액션 | DB 변경 | 부수 효과 |
|---|---|---|
| 배정(본인/타 상담원) | `assigned_staff_id`+`assigned_at` 설정, mode 유지 | 없음(고객 화면 무변화). 상담원 후보 = profiles role staff/manager/admin |
| 채팅 시작(인수) | `mode='human'` (+미배정이면 본인 자동 배정). 조건부 UPDATE(`where mode='pending' or 'ai'`)로 경합 완화 | system 메시지 insert(앱과 동일 문구), AI 자동 침묵(서버 기구현) |
| AI에게 반환 | `mode='ai'` (assigned clear 여부는 앱 `returnToAi`와 동일하게) | system 메시지 insert |
| 메시지 전송 | `chat_messages` insert: `user_id`=고객, `is_user=false`, `sender_type='staff'`, `session_id`, `staff_id`=본인 | 앱 고객 화면 Realtime 수신 |

동시 인수 경합: 마지막 쓰기 우선(RLS는 안 막음). 세션 UPDATE가 Realtime으로 즉시 퍼져 "이미 상담 중" 상태가 보이는 것 + 조건부 UPDATE로 v1 완화. 엄밀한 잠금은 후속.

## 5. 프론트 구조 (customer-detail 분해 관례: hook + presentation)

```
client/src/data/chat.ts            미러 상수: mode·sender_type·탭/라벨 매핑 (SSOT=앱 app_status.dart 주석 명시)
client/src/lib/chat.ts             데이터 접근: fetchSessions/fetchMessages(커서)/assignSession/
                                   takeOverSession/returnToAi/sendStaffMessage + 순수 유틸
                                   (발신자 판별·대기시간·정렬·dedupe) — 단위테스트 대상
client/src/lib/chat-realtime.ts    subscribeSessions(큐·알림), subscribeUserMessages(스레드)
                                   — quote-requests-realtime.ts 패턴 미러
client/src/components/chat/        ChatQueue / ChatThread / ChatComposer / ChatSessionHeader /
                                   ChatCustomerPanel
client/src/hooks/useChatSessions.ts, useChatThread.ts   상태+Realtime 수명주기
client/src/pages/ChatPage.tsx      컨테이너로 교체(목업 61줄 삭제)
```

## 6. Realtime 설계

- 큐: `chat_sessions` INSERT+UPDATE 구독 → 큐 갱신. staff JWT라 RLS로 전체 세션 수신.
- 스레드: `chat_messages` INSERT+UPDATE, `user_id=eq.<고객id>` 필터(앱과 동일 방식). 스레드 전환 시 채널 해제/재구독.
- 채널명은 CRM 자체 명명(`crm-chat-*`) — postgres_changes 채널명은 클라이언트 로컬 토픽이라 앱과 충돌 없음. broadcast(타이핑)는 토픽을 앱과 맞춰야 하므로 후속.
- 전송은 낙관 반영, Realtime echo와 메시지 `id`로 dedupe.
- 채널 error/close → 재구독 + 1회 refetch로 누락 보정.

## 7. Topbar 알림·고객 상세 연동

- 알림: 큐용 `chat_sessions` 구독 재사용, `mode='pending'` 신규/전환 감지 → 기존 알림 popover에 "상담원 연결 요청" 항목(S1.5 견적요청 알림 문법). 클릭 시 실시간 상담 페이지 이동.
- 고객 상세: 세션 `user_id` ↔ `crm.customers.app_user_id` 매칭(기존 고객 조회 lib 재사용). 매칭 시 버튼 활성 → 고객 상세 열기, 없으면 비활성 + "미승격 고객" 툴팁. 신규 생성/승격 연결은 후속(#118 승격 흐름 재사용).

## 8. 에러 처리

- 쓰기 실패(네트워크/RLS) → `onToast` + 낙관 반영 롤백, 전송 실패 시 입력창에 원문 복원.
- 고객이 상담 중 AI로 되돌림 → 세션 UPDATE 수신으로 화면 상태 즉시 갱신, composer 비활성.
- 로그인 만료 → 기존 CRM 인증 게이트가 처리(변경 없음).

## 9. 테스트·검증

- vitest 단위: `lib/chat.ts` 순수 유틸(발신자 판별 — 구세대 quirk 케이스 포함·대기시간·정렬·dedupe) + 데이터 접근(mock supabase client). `chat-realtime.ts`는 quote-requests-realtime.test.ts 패턴.
- `bun run typecheck`·`lint` 0 / `test:unit` / `build`.
- 실기 크로스 스모크(수동): 앱 시뮬레이터 고객 "상담사 연결" → CRM 큐 실시간 등장 → 채팅 시작 → 앱에서 AI 침묵+상담원 메시지 수신 → AI 반환 왕복.

## 10. v1 제외 (후속 경계)

AI 상담 요약(Gemini) / 타이핑 인디케이터(broadcast 토픽 앱과 정합 필요) / 상담원 첨부 업로드 / "종료" 상태(앱 스키마 협의 필요) / 팀 scope 필터(crm.staff 파운데이션 이후) / 미매칭 고객 신규 생성·승격 연결 / 엄밀한 인수 잠금.

## 11. 참고

- CRM: `client/src/pages/ChatPage.tsx`(목업), `client/src/lib/supabase.ts`, `client/src/lib/quote-requests-realtime.ts`(Realtime 선례), `src/db/public-app.ts`(public read 전용 철학)
- 앱: `lib/presentation/screens/admin/admin_chat_detail_screen.dart`, `lib/presentation/providers/handoff_provider.dart`, `lib/data/repositories/chat_session_repository.dart`, `supabase/functions/ai-analyst/index.ts`, `lib/core/constants/app_status.dart`
