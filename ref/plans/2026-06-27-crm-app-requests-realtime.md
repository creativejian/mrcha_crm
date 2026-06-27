# 앱 견적요청 실시간 알림(S1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객이 앱에서 `public.quote_requests`를 INSERT하는 순간 CRM에 실시간 알림(토스트 + Topbar 벨 뱃지 + 인박스 자동갱신)을 띄운다.

**Architecture:** App 레벨 단일 전역 Supabase Realtime 구독. INSERT를 트리거로만 쓰고 정합 데이터는 기존 `fetchAppQuoteRequests()` 재호출(S1 어댑터 재사용). 현재 `/app-requests`에 있으면 토스트·카운트 생략(자동갱신만), 인박스는 60초 폴링 폴백. Flutter 앱 `admin_shell`·`admin_list_auto_refresh` 패턴을 따른다.

**Tech Stack:** `@supabase/supabase-js` ^2 Realtime(`channel().on("postgres_changes")`), React + react-router + vitest.

**Spec:** `ref/specs/2026-06-27-crm-app-requests-realtime-design.md`

---

## File Structure

- `client/src/lib/quote-requests-realtime.ts` — **신규**. `subscribeNewQuoteRequests(onInsert)` Realtime 구독 wrapper(supabase 클라만 의존).
- `client/src/lib/quote-requests-realtime.test.ts` — **신규**. wrapper 단위테스트(supabase mock).
- `client/src/pages/AppRequestsPage.tsx` — **수정**. `{signal, onRead}` props + signal 재fetch + 60초 폴백 + 진입 시 onRead.
- `client/src/components/Topbar.tsx` — **수정**. `newAppRequestCount` prop → 벨 뱃지(>0) + popover 최상단 실 항목 1줄.
- `client/src/App.tsx` — **수정**. 전역 구독 + `newAppRequestCount`/`appRequestSignal` state + `markAppRequestsRead` + Topbar/AppRequestsPage 배선.
- `client/src/index.css` — **수정**. popover 실 항목 강조 1줄.

---

## Task 1: Realtime 구독 wrapper + 단위테스트

**Files:**
- Create: `client/src/lib/quote-requests-realtime.ts`
- Test: `client/src/lib/quote-requests-realtime.test.ts`

- [ ] **Step 1: 테스트 작성 (실패 확인용)**

Create `client/src/lib/quote-requests-realtime.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// supabase 클라 mock — channel().on().subscribe() 체인을 캡처하고 INSERT 콜백을 보관한다.
const channelHandlers: Array<() => void> = [];
const channel = {
  on: vi.fn((_event: string, _filter: unknown, cb: () => void) => {
    channelHandlers.push(cb);
    return channel;
  }),
  subscribe: vi.fn(() => channel),
};
const removeChannel = vi.fn();

vi.mock("./supabase", () => ({
  supabase: {
    channel: vi.fn(() => channel),
    removeChannel: (c: unknown) => removeChannel(c),
  },
}));

import { subscribeNewQuoteRequests } from "./quote-requests-realtime";

beforeEach(() => {
  channelHandlers.length = 0;
  vi.clearAllMocks();
});

describe("subscribeNewQuoteRequests", () => {
  it("INSERT 이벤트가 오면 onInsert를 호출한다", () => {
    const onInsert = vi.fn();
    subscribeNewQuoteRequests(onInsert);
    expect(channelHandlers).toHaveLength(1);
    channelHandlers[0](); // 서버 INSERT 이벤트 시뮬레이션
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it("정리 함수가 removeChannel을 호출한다", () => {
    const cleanup = subscribeNewQuoteRequests(vi.fn());
    expect(removeChannel).not.toHaveBeenCalled();
    cleanup();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `bun run test:unit client/src/lib/quote-requests-realtime.test.ts`
Expected: FAIL (`Cannot find module './quote-requests-realtime'`).

- [ ] **Step 3: wrapper 구현**

Create `client/src/lib/quote-requests-realtime.ts`:

```ts
import { supabase } from "./supabase";

// public.quote_requests INSERT 실시간 구독. payload(raw row)는 차량명/매칭이 없으므로 쓰지 않고
// onInsert를 "신호"로만 호출 — 호출부가 fetchAppQuoteRequests로 정합 데이터를 다시 읽는다.
// 반환값은 정리 함수(언마운트/로그아웃 시 호출).
// 인증: supabase-js v2가 현재 세션 JWT를 Realtime에 적용한다 → RLS(staff 이상 SELECT) 통과 시 이벤트 수신.
export function subscribeNewQuoteRequests(onInsert: () => void): () => void {
  const channel = supabase
    .channel("crm-app-requests-inbox")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "quote_requests" },
      () => onInsert(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:unit client/src/lib/quote-requests-realtime.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: typecheck + lint + 커밋**

Run: `bun run typecheck && bun run lint` (expect 0/0)

```bash
git add client/src/lib/quote-requests-realtime.ts client/src/lib/quote-requests-realtime.test.ts
git commit -m "feat(crm): 앱 견적요청 Realtime 구독 wrapper + 단위테스트"
```

---

## Task 2: 통합 — App 구독 + AppRequestsPage + Topbar + CSS

**Files:**
- Modify: `client/src/pages/AppRequestsPage.tsx`, `client/src/components/Topbar.tsx`, `client/src/App.tsx`, `client/src/index.css`

- [ ] **Step 1: AppRequestsPage — props(signal/onRead) + 폴백**

Replace the top of `client/src/pages/AppRequestsPage.tsx` (imports through the end of the `useEffect`) with:

```tsx
import { useEffect, useState } from "react";

import { fetchAppQuoteRequests, type AppQuoteRequest } from "@/lib/quote-requests";

const MATCH_CLASS: Record<AppQuoteRequest["matchType"], string> = {
  app_user: "app-req-match linked",
  phone: "app-req-match maybe",
  none: "app-req-match none",
};

type AppRequestsPageProps = {
  signal: number;
  onRead: () => void;
};

export function AppRequestsPage({ signal, onRead }: AppRequestsPageProps) {
  const [rows, setRows] = useState<AppQuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // 인박스 진입 시 새 요청 카운트 리셋(= 봤다).
  useEffect(() => {
    onRead();
  }, [onRead]);

  // 초기 로드 + signal(실시간 INSERT) 변경 시 재fetch + 60초 폴링 폴백(Realtime 끊김 보험).
  // 재fetch는 loading을 다시 켜지 않아 자동갱신 시 깜빡임이 없다(첫 로드만 안내 문구).
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchAppQuoteRequests()
        .then((d) => {
          if (alive) {
            setRows(d);
            setError(false);
          }
        })
        .catch(() => {
          if (alive) setError(true);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    load();
    const id = window.setInterval(load, 60000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [signal]);
```

Leave the `return ( ... )` JSX block unchanged (it already renders `rows`/`loading`/`error`).

- [ ] **Step 2: Topbar — newAppRequestCount prop + 벨 뱃지 + popover 실 항목**

In `client/src/components/Topbar.tsx`:

(a) Add to `TopbarProps` (after `onToggleSidebar: () => void;`):

```ts
  newAppRequestCount: number;
```

(b) Add `newAppRequestCount` to the destructured params in `export function Topbar({ ... })` (add it to the list, e.g. after `onToggleSidebar`).

(c) Replace the hard-coded bell count span on the bell button:

```tsx
<SolidBellIcon /><span className="notification-count num">5</span>
```

with (badge only when there are new requests):

```tsx
<SolidBellIcon />{newAppRequestCount > 0 && <span className="notification-count num">{newAppRequestCount}</span>}
```

(d) Add the real item at the top of the notification list — immediately after `<div className="notification-list">`:

```tsx
                <div className="notification-list">
                  {newAppRequestCount > 0 && (
                    <button className="notification-item app-request-new" onClick={() => { onNavigate("app-requests"); setNotificationsOpen(false); }} type="button">
                      <span className="notification-badge">견적</span>
                      <strong>새 앱 견적요청 {newAppRequestCount}건</strong>
                      <small>앱에서 들어온 새 견적요청을 확인하세요.</small>
                      <em>방금 전</em>
                    </button>
                  )}
```

(leave the existing `{visibleNotifications.map(...)}` below it unchanged).

- [ ] **Step 3: App.tsx — 전역 구독 + state + 배선**

In `client/src/App.tsx`:

(a) Add imports (near the other `@/lib` imports):

```ts
import { fetchAppQuoteRequests } from "@/lib/quote-requests";
import { subscribeNewQuoteRequests } from "@/lib/quote-requests-realtime";
```

(b) Inside `export function App()`, after the existing state declarations, add:

```ts
  const [newAppRequestCount, setNewAppRequestCount] = useState(0);
  const [appRequestSignal, setAppRequestSignal] = useState(0);
  const locationRef = useRef(location.pathname);
  const markAppRequestsRead = useCallback(() => setNewAppRequestCount(0), []);
```

(c) Keep `locationRef` current (so the subscription callback reads the live path without re-subscribing). Add this effect:

```ts
  useEffect(() => {
    locationRef.current = location.pathname;
  }, [location.pathname]);
```

(d) Add the global subscription effect (re-subscribes only when auth flips):

```ts
  useEffect(() => {
    if (!auth.authed) return;
    return subscribeNewQuoteRequests(() => {
      // 인박스 자동갱신은 항상 트리거.
      setAppRequestSignal((s) => s + 1);
      // 이미 인박스를 보고 있으면 토스트/카운트는 생략(자동갱신으로 보임).
      if (locationRef.current.startsWith("/app-requests")) return;
      setNewAppRequestCount((c) => c + 1);
      fetchAppQuoteRequests()
        .then((rows) =>
          showToast(rows[0] ? `새 앱 견적요청: ${rows[0].vehicleLabel}` : "새 앱 견적요청이 도착했습니다"),
        )
        .catch(() => showToast("새 앱 견적요청이 도착했습니다"));
    });
  }, [auth.authed, showToast]);
```

(e) Pass `newAppRequestCount` to `<Topbar ... />` (add the prop to the existing Topbar element):

```tsx
        newAppRequestCount={newAppRequestCount}
```

(f) Pass props to the AppRequestsPage route — replace:

```tsx
        <Route path="/app-requests" element={<AppRequestsPage />} />
```

with:

```tsx
        <Route path="/app-requests" element={<AppRequestsPage signal={appRequestSignal} onRead={markAppRequestsRead} />} />
```

- [ ] **Step 4: CSS — popover 실 항목 강조**

Append to `client/src/index.css`:

```css
/* 앱 견적요청 실시간 알림 — popover 상단 실 항목 강조 */
.notification-item.app-request-new { border-left: 2px solid var(--brand); }
```

- [ ] **Step 5: typecheck + lint + build**

Run: `bun run typecheck && bun run lint && bun run build`
Expected: 0 errors / 0 problems / build OK. (App.tsx now passes required props to Topbar and AppRequestsPage, so types are satisfied.)

- [ ] **Step 6: 커밋**

```bash
git add client/src/pages/AppRequestsPage.tsx client/src/components/Topbar.tsx client/src/App.tsx client/src/index.css
git commit -m "feat(crm): 앱 견적요청 실시간 알림 — 전역 구독·토스트·벨 뱃지·인박스 자동갱신"
```

---

## Task 3: 전체 검증 + brief 갱신

**Files:**
- Modify: `ref/active-session-brief.md`

- [ ] **Step 1: 검증 4종 일괄**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build`
Expected: typecheck 0 · lint 0 · test:unit 통과(+realtime wrapper 2) · test:server 통과(변동 없음) · build OK.

- [ ] **Step 2: 브라우저 확인(인증 세션, Realtime은 실 이벤트로만 검증)**

기록만 — 실행은 유슨생. `bun run dev` → 카카오 로그인(인박스 아닌 화면) → 별도로 `psql "$DATABASE_URL"`에서 `public.quote_requests`에 INSERT 1건(catalog 실존 trim_id + 임의 user_id) → **토스트 + 벨 뱃지** 확인 → 인박스 열면 **새 행 자동 추가 + 카운트 0** → 인박스에 머문 채 INSERT 시 카운트 안 늘고 목록만 갱신. 검증 후 테스트 행 삭제. ⚠️ 알림이 안 오면 Realtime RLS/setAuth 문제 — spec §"Realtime 인증/RLS" 참고.

- [ ] **Step 3: brief 갱신**

`ref/active-session-brief.md` 최신 작업 섹션에 S1.5 실시간 알림 한 줄(브랜치/PR) 추가. 60줄 이내.

- [ ] **Step 4: 커밋**

```bash
git add ref/active-session-brief.md
git commit -m "docs(crm): brief에 앱 견적요청 실시간 알림(S1.5) 반영"
```

---

## Self-Review (작성자 체크 결과)

- **Spec coverage:** 전역 구독+재fetch 트리거(Task1·2 Step3) · 토스트 차량명(Step3d) · 벨 뱃지+popover 실 항목(Task2 Step2) · 인박스 signal 재fetch+60s 폴백(Task2 Step1) · 진입 시 리셋(onRead) · 현재 `/app-requests`면 토스트·카운트 생략(Step3d) · 검증(Task3) 모두 task 존재. 마이그 0.
- **Placeholder scan:** 모든 코드/명령/기대출력 구체값. TODO/TBD 없음. Realtime RLS는 spec의 명시적 caveat(브라우저 검증 step에 연결).
- **Type consistency:** `subscribeNewQuoteRequests(onInsert: () => void): () => void` (Task1) ↔ App 호출(Step3d) 일치. `AppRequestsPageProps {signal:number; onRead:()=>void}` ↔ App Route(Step3f) 일치. `newAppRequestCount: number` ↔ Topbar prop(Step2) ↔ App 전달(Step3e) 일치. `appRequestSignal`/`markAppRequestsRead` 이름 일관. `fetchAppQuoteRequests`/`vehicleLabel`(S1) 재사용 확인.
- **주의:** 구독 effect deps `[auth.authed, showToast]` — `showToast`는 App에서 `useCallback`이라 안정(재구독 안 일어남). `locationRef`로 현재 경로를 읽어 location 변경 시 재구독 방지.

## 미결 / 다음

- 브라우저 검증 = 유슨생(인증 세션 + 실 INSERT). Realtime RLS 실측이 핵심.
- 후속(선택): UPDATE/DELETE 반영, 브라우저 네이티브 알림·소리, Topbar mock 알림 전체 데이터화.
- S2 고객 유입(전화매칭 연결 + 신규 `crm.customers` 생성, 채번 `nextCustomerCode()` `CU-YYMM-####`) → S3 견적 승격.
