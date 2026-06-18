# CRM 인증 — 프론트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** crm.mrcha.app SPA에 카카오 로그인(supabase-js) + 세션 토큰을 모든 `/api` 호출에 주입 + 로그인 role(JWT `user_role` claim)을 화면 권한으로 연결한다. mock 역할 탭 수동 전환을 제거하고 로그인 role로 고정한다.

**Architecture:** `lib/supabase`(클라이언트) → `lib/auth`(카카오 로그인/세션/role claim) → `lib/api`(fetch 래퍼가 Bearer 주입) → `AuthProvider`(전역 role/세션) → `RequireAuth`(가드) + `LoginPage`. role claim은 `roleTabFromClaim`으로 RoleTab에 매핑. 백엔드(`feat/crm-auth`)가 이미 `/api/*`를 게이트하므로, 프론트는 토큰을 붙여야 API가 동작한다.

**Tech Stack:** React + react-router, @supabase/supabase-js, vitest. 설계: `ref/specs/2026-06-18-crm-auth-design.md` §3·§4.2·§4.3. 선행(Supabase Hook 등): `ref/crm-auth-supabase-setup.md`.

**선행 의존**: Supabase Custom Access Token Hook(role→`user_role` claim)·redirect allowlist·env(`VITE_SUPABASE_URL`·`VITE_SUPABASE_PUBLISHABLE_KEY`). 코드는 선행 없이 구현 가능, 실 로그인 e2e만 선행 후. 순수 로직(매핑)은 단위테스트로 검증.

---

## File Structure

- `client/src/lib/supabase.ts` (신규) — supabase 클라이언트 1개
- `client/src/data/roles.ts` (수정) — `roleTabFromClaim` 매핑 추가
- `client/src/data/roles.test.ts` (신규) — 매핑 단위테스트
- `client/src/lib/auth.ts` (신규) — signInWithKakao / signOut / getRoleClaim
- `client/src/lib/api.ts` (신규) — `apiFetch` (Bearer 주입) + `apiJson`
- `client/src/lib/api.test.ts` (신규) — 토큰 주입 단위테스트
- `client/src/lib/catalog.ts`·`client/src/lib/vehicles.ts` (수정) — `fetch` → `apiFetch`
- `client/src/auth/AuthProvider.tsx` (신규) — context (session/roleTab/loading) + `useAuth`
- `client/src/pages/LoginPage.tsx` (신규) — 카카오 버튼 / 권한없음 화면
- `client/src/auth/RequireAuth.tsx` (신규) — 가드
- `client/src/App.tsx` (수정) — `useAuth` roleTab 사용, mock roleTab state 제거
- `client/src/main.tsx` (수정) — `AuthProvider` + `RequireAuth`로 감싸기
- `client/src/components/Sidebar.tsx` (수정) — 역할 탭 수동 전환 제거
- `.env.local` / vite env — `VITE_SUPABASE_URL`·`VITE_SUPABASE_PUBLISHABLE_KEY`

---

### Task 1: roleTabFromClaim 매핑 (TDD, 순수)

**Files:** Modify `client/src/data/roles.ts`; Create `client/src/data/roles.test.ts`

- [ ] **Step 1: 실패 테스트** — Create `client/src/data/roles.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { roleTabFromClaim } from "./roles";

describe("roleTabFromClaim", () => {
  it("DB role을 RoleTab으로 매핑한다", () => {
    expect(roleTabFromClaim("admin")).toBe("최고관리자");
    expect(roleTabFromClaim("manager")).toBe("팀장");
    expect(roleTabFromClaim("staff")).toBe("상담사");
    expect(roleTabFromClaim("dealer")).toBe("딜러");
  });

  it("customer·미지정·알 수 없는 값은 null(접근 거부)", () => {
    expect(roleTabFromClaim("customer")).toBeNull();
    expect(roleTabFromClaim(null)).toBeNull();
    expect(roleTabFromClaim(undefined)).toBeNull();
    expect(roleTabFromClaim("guest")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test:unit client/src/data/roles.test.ts` — Expected: FAIL (roleTabFromClaim 미존재).

- [ ] **Step 3: 구현** — append to `client/src/data/roles.ts`:

```ts
// JWT user_role claim(DB user_role enum) → 화면 권한 RoleTab. customer/미지정/미상은 null = 접근 거부.
const ROLE_CLAIM_TO_TAB: Record<string, RoleTab> = {
  admin: "최고관리자",
  manager: "팀장",
  staff: "상담사",
  dealer: "딜러",
};

export function roleTabFromClaim(userRole: string | null | undefined): RoleTab | null {
  return userRole ? (ROLE_CLAIM_TO_TAB[userRole] ?? null) : null;
}
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test:unit client/src/data/roles.test.ts` — Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add client/src/data/roles.ts client/src/data/roles.test.ts
git commit -m "feat(auth): roleTabFromClaim 매핑(DB role→RoleTab, customer 거부)"
```

---

### Task 2: supabase 클라이언트 + 환경변수

**Files:** Create `client/src/lib/supabase.ts`; Modify `package.json`; add env to `.env.local`

- [ ] **Step 1: 설치** — Run: `bun add @supabase/supabase-js`

- [ ] **Step 2: 클라이언트** — Create `client/src/lib/supabase.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  // 빌드/런타임에 env 누락을 빨리 드러낸다(로그인 화면 진입 전).
  throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY 가 설정되지 않았습니다.");
}

// detectSessionInUrl 기본 true — OAuth 콜백 복귀 시 토큰 자동 교환.
export const supabase = createClient(url, publishableKey);
```

- [ ] **Step 3: env 추가** — `.env.local`에 다음 키를 추가(값은 Supabase Settings→API에서). 이미 있으면 건너뜀:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

`client/src/vite-env.d.ts`가 없으면 생성해 타입 선언:

```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 4: 타입체크 + 커밋** — Run: `bun run typecheck` (0). Then:

```bash
git add client/src/lib/supabase.ts client/src/vite-env.d.ts package.json bun.lock
git commit -m "feat(auth): supabase 클라이언트 + VITE env 타입 선언"
```

> `.env.local`은 보통 gitignore이므로 커밋 대상 아님 — 값은 로컬/CF에만.

---

### Task 3: apiFetch 래퍼 + 단위테스트 (TDD)

**Files:** Create `client/src/lib/api.ts`, `client/src/lib/api.test.ts`

- [ ] **Step 1: 실패 테스트** — Create `client/src/lib/api.test.ts` (supabase getSession을 mock해 토큰 주입을 검증):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

import { apiFetch } from "./api";
import { supabase } from "./supabase";

afterEach(() => vi.restoreAllMocks());

describe("apiFetch", () => {
  it("세션이 있으면 Authorization: Bearer 헤더를 붙인다", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: "tok123" } },
    } as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await apiFetch("/api/catalog/brands");

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok123");
  });

  it("세션이 없으면 Authorization 헤더가 없다", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null } } as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await apiFetch("/api/catalog/brands");

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test:unit client/src/lib/api.test.ts` — Expected: FAIL (api 미존재).

- [ ] **Step 3: 구현** — Create `client/src/lib/api.ts`:

```ts
import { supabase } from "./supabase";

// 모든 /api 호출에 현재 세션 access_token을 Bearer로 주입한다.
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test:unit client/src/lib/api.test.ts` — Expected: PASS (2).

- [ ] **Step 5: catalog.ts·vehicles.ts의 fetch를 apiFetch로 교체**

`client/src/lib/catalog.ts`와 `client/src/lib/vehicles.ts`에서 `fetch(` 호출을 모두 `apiFetch(`로 바꾼다(상단에 `import { apiFetch } from "./api";` 추가). `jsonOrThrow`/반환 구조는 그대로. 두 파일의 모든 GET/POST/PATCH/DELETE가 대상.

- [ ] **Step 6: 검증 + 커밋** — Run: `bun run typecheck && bun run lint && bun run test:unit` (모두 PASS, 기존 91 + api 2). Then:

```bash
git add client/src/lib/api.ts client/src/lib/api.test.ts client/src/lib/catalog.ts client/src/lib/vehicles.ts
git commit -m "feat(auth): apiFetch 토큰 주입 래퍼 + catalog·vehicles fetch 교체"
```

---

### Task 4: lib/auth (카카오 로그인 / 세션 / role claim)

**Files:** Create `client/src/lib/auth.ts`

- [ ] **Step 1: 구현** — Create `client/src/lib/auth.ts`:

```ts
import { supabase } from "./supabase";

// 카카오 OAuth 로그인. 로그인 후 현재 origin으로 복귀(redirect allowlist에 등록 필요).
export async function signInWithKakao(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "kakao",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// JWT의 top-level user_role claim을 읽는다(Custom Access Token Hook이 주입). 없으면 null.
export async function getRoleClaim(): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  const role = data?.claims?.user_role;
  return typeof role === "string" && role !== "null" ? role : null;
}
```

- [ ] **Step 2: 타입체크 + 커밋** — Run: `bun run typecheck` (0). If `getClaims` 타입 이슈가 있으면 `data?.claims`를 `Record<string, unknown>`로 좁혀 처리(`any` 금지). Then:

```bash
git add client/src/lib/auth.ts
git commit -m "feat(auth): 카카오 로그인/로그아웃 + user_role claim 읽기"
```

> `getClaims()`는 비대칭키(ES256/RS256) JWT를 WebCrypto로 로컬 검증한다(JWKS 캐시, 네트워크 왕복 없음). 이 함수에 단위테스트는 두지 않는다(supabase OAuth는 e2e 영역) — 매핑/주입 등 순수 로직만 테스트.

---

### Task 5: AuthProvider + useAuth

**Files:** Create `client/src/auth/AuthProvider.tsx`

- [ ] **Step 1: 구현** — Create `client/src/auth/AuthProvider.tsx`:

```tsx
import { type ReactNode, createContext, useContext, useEffect, useState } from "react";

import type { RoleTab } from "@/data/roles";
import { roleTabFromClaim } from "@/data/roles";
import { getRoleClaim } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type AuthState = {
  loading: boolean;
  authed: boolean; // 세션 존재 여부
  roleTab: RoleTab | null; // null = 세션은 있으나 권한 없음(customer 등)
};

const AuthContext = createContext<AuthState>({ loading: true, authed: false, roleTab: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ loading: true, authed: false, roleTab: null });

  useEffect(() => {
    let alive = true;
    async function resolve(authed: boolean) {
      const roleTab = authed ? roleTabFromClaim(await getRoleClaim()) : null;
      if (alive) setState({ loading: false, authed, roleTab });
    }
    supabase.auth.getSession().then(({ data }) => resolve(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void resolve(!!session);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
```

- [ ] **Step 2: 타입체크 + 커밋** — Run: `bun run typecheck` (0). Then:

```bash
git add client/src/auth/AuthProvider.tsx
git commit -m "feat(auth): AuthProvider(세션/role 상태) + useAuth"
```

---

### Task 6: LoginPage + RequireAuth 가드

**Files:** Create `client/src/pages/LoginPage.tsx`, `client/src/auth/RequireAuth.tsx`

- [ ] **Step 1: LoginPage** — Create `client/src/pages/LoginPage.tsx`:

```tsx
import { signInWithKakao, signOut } from "@/lib/auth";

// 미인증: 카카오 버튼. 인증됐으나 권한 없음(customer 등): 거부 + 로그아웃.
export function LoginPage({ deniedReason }: { deniedReason?: boolean }) {
  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Mr. Cha CRM</h1>
        {deniedReason ? (
          <>
            <p>이 계정은 CRM 접근 권한이 없습니다.</p>
            <button type="button" className="btn" onClick={() => void signOut()}>
              다른 계정으로 로그인
            </button>
          </>
        ) : (
          <button type="button" className="btn primary" onClick={() => void signInWithKakao()}>
            카카오로 로그인
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: RequireAuth** — Create `client/src/auth/RequireAuth.tsx`:

```tsx
import type { ReactNode } from "react";

import { useAuth } from "./AuthProvider";
import { LoginPage } from "@/pages/LoginPage";

// loading: 스플래시 / 미인증: 로그인 / 인증+권한없음: 거부 / 인증+권한: children
export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, authed, roleTab } = useAuth();
  if (loading) return <div className="login-page">불러오는 중…</div>;
  if (!authed) return <LoginPage />;
  if (!roleTab) return <LoginPage deniedReason />;
  return <>{children}</>;
}
```

- [ ] **Step 3: 최소 스타일** — `client/src/index.css`에 `.login-page`/`.login-card` 간단 중앙정렬 스타일을 추가(기존 토큰 사용, 과하지 않게):

```css
.login-page {
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
}
.login-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
}
```

- [ ] **Step 4: 타입체크 + 커밋** — Run: `bun run typecheck` (0). Then:

```bash
git add client/src/pages/LoginPage.tsx client/src/auth/RequireAuth.tsx client/src/index.css
git commit -m "feat(auth): LoginPage(카카오/거부) + RequireAuth 가드"
```

---

### Task 7: App/main 통합 — mock 역할 탭 제거, 로그인 role 고정

**Files:** Modify `client/src/main.tsx`, `client/src/App.tsx`, `client/src/components/Sidebar.tsx`

- [ ] **Step 1: main.tsx — AuthProvider + RequireAuth로 감싸기**

Modify `client/src/main.tsx` (BrowserRouter 안, App을 RequireAuth로):

```tsx
import "@fontsource-variable/geist";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <RequireAuth>
          <App />
        </RequireAuth>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 2: App.tsx — roleTab을 useAuth에서**

`client/src/App.tsx`에서:
1. `const [roleTab, setRoleTab] = useState<RoleTab>("최고관리자");` (line ~89) 를 제거하고, 대신 상단에서 `const { roleTab } = useAuth();` 로 가져온다. `RequireAuth`가 이미 `roleTab` null을 막으므로 여기선 non-null로 단정 가능하지만, 타입 안전하게 `const roleTab = useAuth().roleTab ?? "상담사";`처럼 fallback을 두거나(가드가 보장하므로 `!` 사용) — `any` 없이 처리.
2. `function handleRoleTabChange(role: RoleTab) { setRoleTab(role); }` (line ~125-127) 제거.
3. `roleTab`을 쓰는 곳(Sidebar/Topbar/CustomerManagementPage/MCMasterPage props, `isAdmin`)은 그대로 둔다 — 값 출처만 바뀜.
4. `Sidebar`에 넘기던 `onRoleTabChange={handleRoleTabChange}` prop을 제거한다.

import 추가: `import { useAuth } from "./auth/AuthProvider";`

- [ ] **Step 3: Sidebar.tsx — 역할 탭 수동 전환 UI 제거**

`client/src/components/Sidebar.tsx`에서 `onRoleTabChange` prop과 그 prop을 쓰는 역할 탭(최고관리자/팀장/상담사/딜러 전환) 버튼 UI를 제거한다. `roleTab` prop은 표시용으로 남길 수 있으면 남기되(현재 로그인 역할 라벨), 전환 동작은 제거. (Sidebar가 `onRoleTabChange`를 필수로 받고 있으면 prop 타입에서 제거하고 관련 마크업 삭제.)

> 이 단계는 기존 큰 컴포넌트를 만지므로, `bun run typecheck`로 깨진 참조를 모두 잡는다. 역할 탭 마크업이 어디까지인지 불명확하면 멈추고 보고(DONE_WITH_CONCERNS).

- [ ] **Step 4: 전체 검증**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run build`
Expected: typecheck 0, lint 0, test 통과, build OK.

- [ ] **Step 5: 커밋**

```bash
git add client/src/main.tsx client/src/App.tsx client/src/components/Sidebar.tsx
git commit -m "feat(auth): App/main에 AuthProvider·가드 통합 + mock 역할 탭 제거(로그인 role 고정)"
```

---

## 완료 기준 / 검증

- `roleTabFromClaim`·`apiFetch` 단위테스트 통과, typecheck/lint/test/build 그린.
- **로컬 e2e**(선행 Hook/redirect/env 완료 후): 카카오 로그인 → staff/admin/manager/dealer는 해당 화면, customer는 거부 화면 → `/mc-master` 등 API 호출이 Bearer로 200.
- **통합 머지**: 백엔드(이미 `feat/crm-auth`) + 프론트가 한 브랜치 → main 머지하면 보호+토큰주입이 동시에 들어가 프론트가 깨지지 않음.

## 알려진 한계 / 후속
- role 변경은 토큰 갱신(~1h)까지 반영 안 됨(claim 방식). 강등 즉시 차단은 후속(세션 무효화).
- 역할별 화면 세분화(딜러 전용 화면 등)는 spec §6 후속.
- `getRoleClaim`/OAuth는 e2e 영역이라 단위테스트 대상 아님 — 매핑/주입만 테스트.
