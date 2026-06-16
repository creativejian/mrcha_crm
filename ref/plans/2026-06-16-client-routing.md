# 클라이언트 라우팅 도입 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 로 task-by-task 구현. 스텝은 체크박스(`- [ ]`)로 추적.

**Goal:** react-router로 URL↔화면을 동기화해 리로드 초기화·뒤로가기·딥링크를 지원한다.

**Architecture:** `main.tsx`를 `<BrowserRouter>`로 감싸고, App.tsx의 `activeView` state를 `useLocation` 파생으로 바꾼 뒤 `renderView()`를 `<Routes>` 트리로 교체한다. Sidebar/Topbar/페이지 컴포넌트의 `activeView`/`onViewChange` 인터페이스는 유지(App 내부만 navigate/location으로 채움).

**Tech Stack:** react-router 7.17 (React 19.2 호환, 패키지 `react-router`), vitest+@testing-library(`MemoryRouter`).

**설계 근거:** `ref/specs/2026-06-16-client-routing-design.md` (승인됨).

**검증된 사실:**
- react-router 7.17.0, peer `react >=18`. import는 `react-router`에서 (v7 단일 패키지): `BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, MemoryRouter`.
- App.tsx `renderView()` 현재 props (그대로 Route element로 이전):
  - `CustomerManagementPage`: `activeCustomerId, chanceOverrides, customers, manageStatusOverrides, mode, roleTab, onChanceOverridesChange, onCustomersChange, onOpenCustomer`
  - `CustomerDetailPage`: `chanceOverride, customer, manageStatusOverride, onBack, onToast, onWorkflowChange, variant`
- 클라 테스트 패턴: `vi.stubGlobal("fetch", ...)`, `render`, `screen` (VehiclePicker.test.tsx).

---

## File Structure

- **수정** `client/src/main.tsx` — `<BrowserRouter>` 래핑
- **수정** `client/src/App.tsx` — `VIEW_TO_PATH` 매핑, `activeView` location 파생, `handleViewChange`=navigate, `renderView`→`<Routes>`, 권한 Navigate 가드
- **신규** `client/src/App.test.tsx` — 라우팅 테스트(MemoryRouter)
- **의존성** `react-router` 추가

---

## Task 1: react-router 설치 + BrowserRouter

**Files:**
- Modify: `client/src/main.tsx`
- 의존성: `package.json`

- [ ] **Step 1: react-router 설치**

```bash
bun add react-router
```
Expected: `package.json` dependencies에 `"react-router": "^7.17.0"` 추가

- [ ] **Step 2: main.tsx를 BrowserRouter로 래핑**

`client/src/main.tsx` 전체 교체:

```tsx
import "@fontsource-variable/geist";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 3: typecheck (App은 아직 useLocation 미사용 → 통과해야)**

Run: `bun run typecheck`
Expected: 0 errors

- [ ] **Step 4: 커밋**

```bash
git add package.json bun.lock client/src/main.tsx
git commit -m "feat(routing): react-router 설치 + BrowserRouter 래핑"
```

---

## Task 2: App.tsx URL 파생 + Routes 트리

**Files:**
- Modify: `client/src/App.tsx`

App.tsx 한 파일의 일관 변경이라 단계별 Edit 후 typecheck/lint로 검증(라우팅 동작은 Task 3 테스트).

- [ ] **Step 1: react-router import 추가**

`client/src/App.tsx` 최상단 `import { useEffect, useRef, useState } from "react";` 다음 줄에 추가:

```tsx
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
```

- [ ] **Step 2: VIEW_TO_PATH / PATH_TO_VIEW 매핑 추가**

`type ViewKey = ...;` 선언 바로 다음에 추가:

```tsx
const VIEW_TO_PATH: Record<ViewKey, string> = {
  "advisor-dashboard": "/",
  "dashboard-preview": "/dashboard-preview",
  "admin-dashboard": "/admin-dashboard",
  chat: "/chat",
  customers: "/customers",
  "customer-detail": "/customer-detail",
  pipeline: "/pipeline",
  quotes: "/quotes",
  delivery: "/delivery",
  insights: "/insights",
  "knowledge-base": "/knowledge-base",
  "ai-settings": "/ai-settings",
  "mc-master": "/mc-master",
  "org-members": "/org-members",
  partners: "/partners",
  finance: "/finance",
};
const PATH_TO_VIEW: Record<string, ViewKey> = Object.fromEntries(
  Object.entries(VIEW_TO_PATH).map(([view, path]) => [path, view as ViewKey]),
);
```

- [ ] **Step 3: activeView state를 location 파생으로 교체**

`const [activeView, setActiveView] = useState<ViewKey>("advisor-dashboard");`를 아래로 교체:

```tsx
  const location = useLocation();
  const navigate = useNavigate();
  const activeView: ViewKey = PATH_TO_VIEW[location.pathname] ?? "advisor-dashboard";
```

- [ ] **Step 4: handleRoleTabChange — 강제 이동 제거**

```tsx
  function handleRoleTabChange(role: RoleTab) {
    setRoleTab(role);
  }
```
> 차단 화면 이동은 Route element의 `<Navigate/>`가 처리(Step 7).

- [ ] **Step 5: navigate로 전환 (handleViewChange / 고객 상세 진입)**

`handleViewChange`:
```tsx
  function handleViewChange(view: string) {
    setCustomerDetailPanelOpen(false);
    setCustomerDetailEditorOpen(false);
    navigate(VIEW_TO_PATH[view as ViewKey] ?? "/");
  }
```

`openCustomerDetailPanel`의 `setActiveView("customers");` → `navigate("/customers");`

`openCustomerDetailFullScreen`:
```tsx
  function openCustomerDetailFullScreen() {
    setCustomerDetailPanelOpen(false);
    setCustomerDetailEditorOpen(false);
    navigate("/customer-detail");
  }
```

- [ ] **Step 6: isAdmin 추가**

`renderView` 함수 정의 바로 위에 추가:

```tsx
  const isAdmin = roleTab === "최고관리자";
```

- [ ] **Step 7: renderView를 Routes 트리로 교체**

`function renderView() { ... }` 전체를 교체:

```tsx
  function renderView() {
    return (
      <Routes>
        <Route path="/" element={<AdvisorDashboardPage />} />
        <Route path="/dashboard-preview" element={<DashboardPreviewPage />} />
        <Route path="/admin-dashboard" element={isAdmin ? <AdminDashboardPage /> : <Navigate to="/" replace />} />
        <Route path="/chat" element={<ChatPage onNavigate={handleViewChange} onToast={showToast} />} />
        <Route
          path="/customers"
          element={
            <CustomerManagementPage
              activeCustomerId={customerDetailPanelOpen ? selectedCustomer.customerId : null}
              chanceOverrides={chanceOverrides}
              customers={customers}
              manageStatusOverrides={manageStatusOverrides}
              mode={customerMode}
              roleTab={roleTab}
              onChanceOverridesChange={setChanceOverrides}
              onCustomersChange={setCustomers}
              onOpenCustomer={openCustomerDetailPanel}
            />
          }
        />
        <Route
          path="/customer-detail"
          element={
            <CustomerDetailPage
              chanceOverride={chanceOverrides[selectedCustomer.no]}
              customer={selectedCustomer}
              manageStatusOverride={manageStatusOverrides[selectedCustomer.no]}
              onBack={() => navigate("/customers")}
              onToast={showToast}
              onWorkflowChange={updateCustomerWorkflow}
              variant="page"
            />
          }
        />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/quotes" element={<QuotesPage onToast={showToast} />} />
        <Route path="/delivery" element={<DeliveryPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
        <Route path="/ai-settings" element={<AISettingsPage />} />
        <Route path="/mc-master" element={<MCMasterPage roleTab={roleTab} />} />
        <Route path="/org-members" element={<OrgMembersPage />} />
        <Route path="/partners" element={<PartnersPage />} />
        <Route path="/finance" element={isAdmin ? <FinancePage mode={financeMode} /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }
```

- [ ] **Step 8: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: typecheck 0, lint 0 problems. (`setActiveView` 잔여 참조가 있으면 typecheck가 잡아줌 → 모두 navigate로 바뀌었는지 확인)

- [ ] **Step 9: 커밋**

```bash
git add client/src/App.tsx
git commit -m "feat(routing): App.tsx activeView를 URL 파생 + Routes 트리로 전환"
```

---

## Task 3: 라우팅 테스트

**Files:**
- Create: `client/src/App.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`client/src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { App } from "./App";

// 일부 화면(mc-master 등)이 마운트 시 fetch를 호출하므로 전역 mock.
// catalog counts는 객체를 기대하므로(undefined.toLocaleString 방지) 0건 객체로 응답.
const ZERO_COUNTS = { brands: 0, models: 0, trims: 0, trimOptions: 0, colors: 0, trimNoOptions: 0, trimOptionRelations: 0 };
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/catalog/counts")) {
        return new Response(JSON.stringify(ZERO_COUNTS), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

it("/quotes → 견적 관리 화면(제목)", () => {
  renderAt("/quotes");
  expect(screen.getByRole("heading", { level: 1, name: "견적 관리" })).toBeInTheDocument();
});

it("/mc-master → 엠씨 마스터 화면(제목)", () => {
  renderAt("/mc-master");
  expect(screen.getByRole("heading", { level: 1, name: "엠씨 마스터" })).toBeInTheDocument();
});

it("알 수 없는 경로 → 대시보드로 리다이렉트", () => {
  renderAt("/unknown-path");
  expect(screen.getByRole("heading", { level: 1, name: "대시보드" })).toBeInTheDocument();
});
```

> 제목은 App의 `<header><h1>`에 `viewMeta[activeView][0]`로 렌더된다(quotes="견적 관리", mc-master="엠씨 마스터", advisor-dashboard="대시보드"). 사이드바 메뉴는 `<button>`이라 `heading` role과 구분된다.

- [ ] **Step 2: 테스트 실행 (Task 2 적용 후 통과 기대)**

Run: `bun run test:unit client/src/App.test.tsx`
Expected: 3 pass

> 만약 `heading level 1`이 안 잡히면 App.tsx의 제목 `<h1>` 실제 구조(약 228줄 `<h1>{title}</h1>`)를 확인해 매처를 `screen.getByText`로 조정.

- [ ] **Step 3: 커밋**

```bash
git add client/src/App.test.tsx
git commit -m "test(routing): MemoryRouter 경로별 화면 렌더 + 404 리다이렉트"
```

---

## Task 4: 통합 검증

- [ ] **Step 1: 정적 검증 + 전체 테스트 + 빌드**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run build`
Expected: typecheck 0, lint 0, test:unit 전체 PASS(App 라우팅 + 기존), build 성공

> `test:unit`만 실행(라우팅은 클라 전용). 서버 테스트는 이 작업과 무관하나, 최종 전체는 `bun run test`로 한 번 더 확인 가능(`.env.local` 필요).

- [ ] **Step 2: 브라우저 수동 확인**

`bun run dev` 후:
- 사이드바 메뉴 이동 → **주소가 `/quotes`, `/mc-master` 등으로 변경**
- 특정 화면에서 **새로고침 → 같은 화면 유지**(초기화 안 됨)
- 브라우저 **뒤로/앞으로가기** 동작
- 주소창에 `/mc-master` 직접 입력 → 엠씨 마스터 진입
- 역할 탭을 **상담사**로 바꾼 뒤 `/finance` 시도 → `/`(대시보드)로 가드

- [ ] **Step 3: finishing-a-development-branch로 PR**

superpowers:finishing-a-development-branch.

---

## Self-Review (작성자 체크)

- **spec 커버리지:** ①main.tsx=Task1, ②App.tsx(매핑/파생/navigate/Routes/가드/404)=Task2, ③인터페이스 유지=Task2(Sidebar/Topbar 미수정), ④MVP 범위=Task2(모드/고객 state 유지), ⑤에러/엣지=Task2 Step7(Navigate·404), ⑥테스트=Task3. 모두 매핑.
- **placeholder:** 없음. VIEW_TO_PATH 전체 16개 ViewKey 명시, Route element props 전체 명시, 테스트 코드 완전.
- **타입 일관성:** `ViewKey`(기존) ↔ `VIEW_TO_PATH` 키 16개 일치(ViewKey union 전부). `PATH_TO_VIEW` 역매핑. `handleViewChange(view: string)` 시그니처 유지(Sidebar/Topbar 인터페이스). `isAdmin` = `roleTab === "최고관리자"`. Route path ↔ VIEW_TO_PATH 값 일치.
- **범위:** 단일 plan 적정. 하위모드/딥링크/코드스플리팅 비범위.
- **known risk:** App.tsx에 `setActiveView` 잔여 참조가 있으면 Step 8 typecheck가 잡는다(state 제거했으므로 미정의 참조 = 에러). 모두 navigate로 전환됐는지 확인.
