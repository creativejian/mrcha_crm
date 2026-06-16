# 클라이언트 라우팅 도입 (URL ↔ 화면) 설계

작성일: 2026-06-16
상태: 설계 승인됨 (writing-plans 대기)

## 배경 / 목적

현재 화면 전환은 `App.tsx`의 `activeView` state(15개 ViewKey) 조건부 렌더링이라 URL이 바뀌지 않는다. 그래서 **리로드하면 초기화면으로 튀고**, 브라우저 뒤로가기/북마크/딥링크가 안 된다. react-router를 도입해 URL ↔ 화면을 동기화한다.

- 앞으로 route가 늘어날 전제(`/customers/:id` 등) → 선언적 `<Routes>`로 확장 기반을 만든다.

## 결정사항 (확정)

- **react-router 도입** (v7, React 19.2 호환 — 정확 버전/패키지는 구현 계획에서 context7로 확정).
- **평면 화면 path만 (MVP)**: 사이드바 주요 화면을 path로. 하위모드(`customerMode`/`financeMode`)·선택 고객·고객상세 드로어는 **기존 state 유지(URL 미반영)**. 리로드 시 해당 화면은 복원, 모드/선택은 기본값.
- **Routes 트리**: `renderView()` if 체인 → `<Routes><Route>`. 명령적 분기보다 파라미터/중첩 확장에 유리.
- **인터페이스 유지**: Sidebar/Topbar/페이지 컴포넌트의 `activeView`/`onViewChange` prop은 그대로. App.tsx 내부만 URL 기반으로 교체 → 변경 표면 최소.
- **권한 가드**: 차단 화면(admin-dashboard/finance)은 Route element에서 `isAdmin ? <Page/> : <Navigate to="/" replace/>`.

## 범위

**포함**
- `react-router` 의존성 추가
- `main.tsx`: `<BrowserRouter>` 래핑
- `App.tsx`: `VIEW_TO_PATH` 매핑, `activeView` location 파생, `handleViewChange`=navigate, `renderView`→`<Routes>`, 권한 Navigate 가드, 404 fallback
- 라우팅 테스트(`App.test.tsx`)

**비범위 (다음 단계)**
- 하위모드(`customerMode`/`financeMode`) URL 반영 (`?mode=` / 중첩)
- 고객상세 딥링크(`/customers/:고객번호`) + 드로어 URL
- 코드 스플리팅(lazy route) — 현재 번들 작음, YAGNI

## 아키텍처

```
main.tsx: <BrowserRouter><App/></BrowserRouter>
App.tsx:
  location = useLocation(); navigate = useNavigate();
  activeView = PATH_TO_VIEW[location.pathname] ?? "advisor-dashboard";   // state 제거, URL 파생
  handleViewChange(view) = navigate(VIEW_TO_PATH[view])                  // Sidebar/Topbar가 호출(인터페이스 유지)
  renderView() = <Routes> ...각 Route element=<Page .../> </Routes>
```

Sidebar/Topbar/페이지는 `activeView`(파생값)·`onViewChange`(navigate 래퍼)를 그대로 받으므로 **수정 불필요**.

## ① main.tsx — BrowserRouter

```tsx
import { BrowserRouter } from "react-router";
// ...
createRoot(...).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

## ② App.tsx — URL 파생 + Routes

**path 매핑** (ViewKey ↔ kebab path, `advisor-dashboard`만 `/`):

| ViewKey | path | ViewKey | path |
|---|---|---|---|
| advisor-dashboard | `/` | knowledge-base | `/knowledge-base` |
| dashboard-preview | `/dashboard-preview` | ai-settings | `/ai-settings` |
| admin-dashboard | `/admin-dashboard` | mc-master | `/mc-master` |
| chat | `/chat` | org-members | `/org-members` |
| customers | `/customers` | partners | `/partners` |
| customer-detail | `/customer-detail` | finance | `/finance` |
| pipeline | `/pipeline` | delivery | `/delivery` |
| quotes | `/quotes` | | |

```ts
const VIEW_TO_PATH: Record<ViewKey, string> = {
  "advisor-dashboard": "/", "dashboard-preview": "/dashboard-preview", "admin-dashboard": "/admin-dashboard",
  chat: "/chat", customers: "/customers", "customer-detail": "/customer-detail", pipeline: "/pipeline",
  quotes: "/quotes", delivery: "/delivery", insights: "/insights", "knowledge-base": "/knowledge-base",
  "ai-settings": "/ai-settings", "mc-master": "/mc-master", "org-members": "/org-members",
  partners: "/partners", finance: "/finance",
};
const PATH_TO_VIEW: Record<string, ViewKey> = Object.fromEntries(
  Object.entries(VIEW_TO_PATH).map(([v, p]) => [p, v as ViewKey]),
);
```

**파생/네비게이션**:
- `const activeView: ViewKey = PATH_TO_VIEW[location.pathname] ?? "advisor-dashboard";` (`useState<ViewKey>` 제거)
- `handleViewChange(view)`: 드로어 닫기 + `navigate(VIEW_TO_PATH[view as ViewKey] ?? "/")`
- `openCustomerDetailFullScreen`: `navigate("/customer-detail")`
- `openCustomerDetailPanel`: `navigate("/customers")` + panel open
- `onBack`(customer-detail): `navigate("/customers")`
- chat `onNavigate`: `handleViewChange`로 통일
- `handleRoleTabChange`: `setRoleTab`만 (차단 화면 강제 이동 로직 제거 → Route element Navigate가 처리)

**renderView → Routes** (props는 기존 그대로 전달):
```tsx
<Routes>
  <Route path="/" element={<AdvisorDashboardPage />} />
  <Route path="/dashboard-preview" element={<DashboardPreviewPage />} />
  <Route path="/admin-dashboard" element={isAdmin ? <AdminDashboardPage /> : <Navigate to="/" replace />} />
  <Route path="/chat" element={<ChatPage onNavigate={handleViewChange} onToast={showToast} />} />
  <Route path="/customers" element={<CustomerManagementPage /* 기존 props */ />} />
  <Route path="/customer-detail" element={<CustomerDetailPage /* 기존 props, variant="page" */ />} />
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
```
`const isAdmin = roleTab === "최고관리자";`

`title`/`desc` 파생은 `activeView`(location 파생) 기반이라 그대로 동작.

## ③ 인터페이스 유지

Sidebar/Topbar는 `activeView`(파생)·`onViewChange`(=`handleViewChange`) prop을 그대로 받는다. customerMode 하위메뉴(`onCustomerModeChange` + `navigate("customers")`)도 그대로 — App의 `handleViewChange`가 navigate로 처리.

## ④ 범위 유지 (MVP)

- `customerMode`/`financeMode`: state 유지(URL 미반영). 리로드 시 기본값.
- 선택 고객(`selectedCustomerNo`)·고객상세 드로어(`customerDetailPanelOpen`): state 유지. `/customer-detail` 직접 진입/리로드 시 기본 첫 고객 표시(현재도 초기값 `customers[0]`).
- 즉 "리로드하면 화면이 초기화면으로 튀는" 핵심 불편만 해결. 모드/선택 복원은 후속.

## ⑤ 에러 / 엣지

- 알 수 없는 path → `<Route path="*">` → `/` redirect.
- 비최고관리자가 `/admin-dashboard`·`/finance` 직접 진입/잔류 → Route element가 `<Navigate to="/" replace/>`. 역할 탭 전환 시에도 element 재평가로 자동 이동.
- 드로어 열림 중 메뉴 이동 → `handleViewChange`가 드로어 닫고 navigate (기존 동작 유지).

## ⑥ 테스트

- `client/src/App.test.tsx` (vitest, `MemoryRouter`):
  - `initialEntries={["/quotes"]}` → 견적 관리 화면 렌더(QuotesPage 고유 텍스트).
  - `initialEntries={["/mc-master"]}` → 엠씨 마스터 렌더(fetch mock 필요 — counts).
  - `initialEntries={["/unknown"]}` → `/`(대시보드) 렌더.
- 권한 가드(비최고관리자 `/finance`→`/`)는 roleTab이 App 내부 state(기본 최고관리자)라 단위테스트가 무거움 → **수동/브라우저 검증**(역할 탭 전환 후 finance 접근). 자동 테스트는 path→화면·404만.
- 기존 `CustomerManagementPage.test.tsx` 등은 컴포넌트 단위라 영향 없음(Router 비의존).

## 영향 파일

- 수정: `client/src/main.tsx`(BrowserRouter), `client/src/App.tsx`(URL 파생 + Routes)
- 신규: `client/src/App.test.tsx`
- 의존성: `react-router` 추가(`package.json`)

## 검증

- `bun run typecheck` / `bun run lint` 0
- `bun run test`(App 라우팅 + 기존)
- `bun run build` 성공
- 브라우저: 메뉴 이동 시 주소 변경, **리로드 시 같은 화면 유지**, 뒤로/앞으로가기, 직접 URL 진입(`/mc-master`), 역할 탭 전환 시 finance/리포트 가드

## 다음 단계 (이 작업 후)

1. 하위모드 URL 반영(`?mode=`) + 고객상세 딥링크(`/customers/:고객번호`)
2. sync 이력 / 할인·취득세 등 기존 백로그
