# CRM 앱 견적요청 실시간 알림(S1.5) 설계 — Supabase Realtime

작성일: 2026-06-27
상태: **design 확정(브레인스토밍 승인). 다음 = writing-plans → 구현.**
성격: 견적요청 파이프라인 두 번째 슬라이스 **S1.5 = 실시간 알림**. S1(읽기 인박스, PR #114 머지)에 능동 알림을 더한다. 마이그레이션 0.
연계: `2026-06-27-crm-app-quote-requests-inbox-design.md`(S1 — `fetchAppQuoteRequests`/`toAppQuoteRequest` 재사용), Flutter 앱 `lib/presentation/screens/admin/admin_shell.dart`·`admin_list_auto_refresh.dart`(검증된 어드민 실시간 알림 패턴 — 본 설계의 직접 참고).

## 배경

S1은 인박스를 "열어야 보이는" 수동 목록이다. 고객이 앱에서 견적요청을 INSERT하는 순간 CRM 상담사에게 능동적으로 알려야 빠른 응대(전환율)가 된다. `public.quote_requests`는 **이미 `supabase_realtime` publication에 등록**(실측)돼 있어 CRM은 DB 작업 0으로 구독만 붙이면 된다. CRM 프론트엔 supabase 클라이언트(`client/src/lib/supabase.ts`, 현재 auth 전용)·Topbar 알림 UI(벨 + 견적 탭, mock)가 이미 존재한다.

## Flutter 앱 참고 (검증된 패턴)

앱 어드민은 동일 문제를 이미 풀었다. 본 설계는 그 패턴을 따른다:

- **전역 셸에서 구독**(`admin_shell._newItemChannel`): `quote_requests` INSERT → 사이드바 배지 카운트 누적. (= 우리 App.tsx 위치)
- **payload 안 쓰고 재fetch가 트리거**(`callback: (_) => refreshData()`). raw row엔 차량명/매칭이 없으므로 이벤트는 신호로만 쓰고 기존 read를 재호출.
- **해당 탭으로 이동하면 카운트 리셋**(`didUpdateWidget`) = "봤다".
- **현재 그 목록 탭에 있으면 카운트 안 셈**(`if (_currentPath == tabPath) return;`) — 이미 자동갱신으로 보이므로.
- **목록 화면: Realtime 구독 + 60초 폴링 폴백**(`admin_list_auto_refresh` mixin) — Realtime 끊김(네트워크/백그라운드) 보험.

## 범위

**포함**
- App 레벨 단일 전역 Realtime 구독(로그인 시).
- 새 INSERT 시: ① 토스트(차량명 포함) ② Topbar 벨 뱃지 카운트 ③ 인박스 자동갱신.
- 인박스 진입 시 카운트 리셋. 인박스에 머무는 동안 들어온 건은 카운트 제외.
- 인박스 60초 폴링 폴백.
- Topbar 벨 popover 상단에 "새 앱 견적요청 N건 → 보기" 실 항목 1줄(클릭 → `/app-requests`).

**제외(YAGNI / 다음)**
- 읽음 상태 DB/localStorage 영속(세션 휘발). 브라우저 네이티브 알림·소리(앱은 `WebNotificationService`로 함 — 후속). Topbar mock 알림 5건 전체 데이터화. `quote_requests` UPDATE/DELETE 반영(상태 변경 등 — INSERT만). S2(유입)·S3(승격).

## 결정 사항 (브레인스토밍 확정)

| 항목 | 결정 |
|---|---|
| 읽음 처리 | **인박스 진입 시 카운트 0** (세션 휘발, 새로고침 시 리셋) |
| 토스트 | **차량명 포함**(예 "새 앱 견적요청: 기아 쏘렌토"). 재fetch 첫 행 `vehicleLabel` |
| 벨 popover | **상단에 실 항목 1줄 추가**(N건 → 보기, 클릭 시 인박스). mock 5건은 아래 유지 |
| 인박스에 있을 때 | **현재 `/app-requests`면** 토스트·카운트++ 생략(이미 자동갱신으로 보임, 앱 패턴), `signal++`만 |
| 폴백 | 인박스 화면에 **60초 폴링**(Realtime 끊김 보험) |

## 아키텍처

App 레벨 **단일 전역 Realtime 구독**. INSERT를 **트리거로만** 사용하고, 정합 데이터(차량명/매칭 join)는 **기존 `fetchAppQuoteRequests()` 재호출**로 얻는다(S1 어댑터 재사용, payload 파싱 불필요).

```
supabase Realtime (public.quote_requests INSERT)
        ↓  (이벤트 = 신호)
App 전역 구독 (로그인 시)
  ├ fetchAppQuoteRequests() 재호출 → rows
  ├ 토스트: showToast("새 앱 견적요청: " + rows[0].vehicleLabel)   (단, 현재 /app-requests면 토스트 생략)
  ├ newAppRequestCount++   (단, 현재 /app-requests면 생략)
  └ appRequestSignal++     (인박스 자동갱신 트리거)
        ↓
Topbar (newAppRequestCount prop) → 벨 뱃지 + popover 실 항목 1줄(→ /app-requests)
AppRequestsPage (appRequestSignal prop) → signal 변하면 재fetch / 진입 시 count=0 / 60s 폴링 폴백
```

## 컴포넌트 (각 1책임)

1. `client/src/lib/quote-requests-realtime.ts` **(신규)** — `subscribeNewQuoteRequests(onInsert: () => void): () => void`. `supabase.channel("crm-app-requests-inbox").on("postgres_changes", { event: "INSERT", schema: "public", table: "quote_requests" }, () => onInsert()).subscribe()`; 반환값은 정리 함수(`supabase.removeChannel`). supabase 클라만 의존, 테스트는 mock.
2. `App.tsx` **(수정)** — 구독 `useEffect`(로그인 시만, cleanup으로 해제). state `newAppRequestCount`·`appRequestSignal`. onInsert 콜백 → 현재 경로가 `/app-requests`가 아니면 `fetchAppQuoteRequests().then(rows => showToast(차량명))` + `count++`; 항상 `signal++`. `markAppRequestsRead`(count=0)·`appRequestSignal`을 인박스/Topbar에 배선.
3. `Topbar.tsx` **(수정)** — `newAppRequestCount` prop 추가 → 벨 아이콘 뱃지(>0일 때) + popover 최상단 "새 앱 견적요청 N건 → 보기"(클릭 → `onNavigate`/navigate `/app-requests`). 기존 mock 목록 아래 유지.
4. `AppRequestsPage.tsx` **(수정)** — `signal`(deps)·`onRead` props. signal 변하면 재fetch(자동갱신). 마운트 시 `onRead()`(count 리셋). 60초 `setInterval` 폴링 폴백(언마운트 시 clear).
5. `client/src/index.css` **(수정)** — 벨 뱃지 스타일.

## Realtime 인증 / RLS (구현 시 실측 — caveat)

- `public.quote_requests` RLS 정책 `Users and staff can view relevant quote requests`로 staff/manager/admin은 SELECT 가능. **Realtime postgres_changes는 구독자의 SELECT(RLS) 권한이 있어야 이벤트를 받는다** → CRM 로그인 계정의 `profiles.role`이 staff+ 여야 함.
- supabase-js v2는 인증 세션 토큰을 Realtime에 적용해야 RLS가 통과한다(`supabase.realtime.setAuth(accessToken)` 또는 `onAuthStateChange` 자동 적용). **plan에서 현재 클라가 자동 setAuth하는지 실측**하고, 안 되면 AuthProvider 세션 확립 후 `realtime.setAuth` 호출을 추가한다.
- ⚠️ 이 부분이 안 되면 알림이 조용히 안 온다 → **브라우저에서 실 INSERT로 반드시 검증**.

## 검증

- `bun run typecheck` 0 · `bun run lint` 0 · `bun run build`.
- `test:unit`: `subscribeNewQuoteRequests`(supabase mock — `.channel().on().subscribe()` 호출·콜백 발화·cleanup이 `removeChannel` 호출) + 카운트 증가/리셋/현재경로 제외 순수 로직.
- **브라우저(필수, Realtime은 실 이벤트로만 검증)**: 인증 세션으로 CRM 접속(인박스 아닌 화면) → 다른 클라이언트/`psql`로 `public.quote_requests` INSERT 1건 → **토스트 + 벨 뱃지 카운트** 확인 → 인박스 열면 **새 행 자동 추가 + 카운트 0** 확인. 인박스에 머문 채 INSERT → 카운트 안 늘고 목록만 갱신 확인.
- 테스트 INSERT는 catalog 실존 `trim_id` + 임의 `user_id`(FK→profiles) 사용. 검증 후 그 행 삭제(정리).

## 미결 / 다음

- 브라우저 검증 = 유슨생(인증 세션). 머지 시 squash `[skip ci]` 주의.
- 후속(선택): UPDATE/DELETE 반영(상태 변경 자동갱신), 브라우저 네이티브 알림·소리, Topbar mock 알림 전체 데이터화.
- S2 고객 유입(전화매칭 연결 + 신규 `crm.customers` 생성, 채번 `nextCustomerCode()` `CU-YYMM-####`) → S3 견적 승격.
