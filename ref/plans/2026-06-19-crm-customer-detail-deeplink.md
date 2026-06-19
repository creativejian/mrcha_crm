# 고객 상세 라우팅 딥링크 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객 상세(드로어 + 전체화면 페이지)의 선택 고객을 React 상태가 아니라 **URL**(`/customers?customer=CODE`, `/customer-detail/:code`)이 식별하게 해, 새로고침·북마크·링크공유·브라우저 뒤로가기가 동작하도록 한다.

**Architecture:** URL을 single source of truth로. 순수 함수 `customerCodeFromLocation(pathname, search)`로 선택 코드를 파생하고, App이 그것으로 `selectedCustomer`/`isDrawerOpen`을 계산. 상태 `selectedCustomerNo`·`customerDetailPanelOpen` 제거, 버그 폴백(`?? customers[0]`) 제거, `customersLoaded` 추가. `CustomerDetailPage`/`CustomerManagementPage` 컴포넌트는 무변경(값 출처만 변경).

**Tech Stack:** React 19 + react-router(v7, `react-router` import) + TypeScript 6.0.3, vitest.

연계 스펙: `ref/specs/2026-06-19-crm-customer-detail-deeplink-design.md`

---

## File Structure

- `client/src/lib/customer-route.ts` — (신규) `customerCodeFromLocation(pathname, search)` 순수 함수.
- `client/src/lib/customer-route.test.ts` — (신규) 단위테스트.
- `client/src/App.tsx` — URL 파생 상태, 라우트 `/customer-detail/:code`, 네비게이션 핸들러 navigate화, 드로어 게이트.

---

## Task 1: URL→코드 순수함수 + 단위테스트 (TDD)

**Files:**
- Create: `client/src/lib/customer-route.ts`
- Test: `client/src/lib/customer-route.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`client/src/lib/customer-route.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { customerCodeFromLocation } from "./customer-route";

describe("customerCodeFromLocation", () => {
  it("/customer-detail/:code 의 path code를 반환", () => {
    expect(customerCodeFromLocation("/customer-detail/CU-2605-0020", "")).toBe("CU-2605-0020");
  });
  it("끝 슬래시가 있어도 path code를 반환", () => {
    expect(customerCodeFromLocation("/customer-detail/CU-2605-0020/", "")).toBe("CU-2605-0020");
  });
  it("/customers + ?customer= 쿼리값을 반환", () => {
    expect(customerCodeFromLocation("/customers", "?customer=CU-2605-0019")).toBe("CU-2605-0019");
  });
  it("/customers 에 쿼리 없으면 null", () => {
    expect(customerCodeFromLocation("/customers", "")).toBeNull();
  });
  it("/customer-detail (code 없음)은 null", () => {
    expect(customerCodeFromLocation("/customer-detail", "")).toBeNull();
  });
  it("다른 경로의 customer 쿼리는 무시(null)", () => {
    expect(customerCodeFromLocation("/quotes", "?customer=CU-2605-0001")).toBeNull();
  });
  it("URL 인코딩된 코드를 디코드", () => {
    expect(customerCodeFromLocation("/customer-detail/CU%2D2605%2D0020", "")).toBe("CU-2605-0020");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test:unit client/src/lib/customer-route.test.ts`
Expected: FAIL — `customer-route` 모듈 없음(import 에러).

- [ ] **Step 3: 순수 함수 구현**

`client/src/lib/customer-route.ts`:

```ts
// 선택 고객 코드를 URL에서 파생한다(App이 single source of truth로 사용).
// /customer-detail/:code → path의 code, /customers + ?customer= → 쿼리값, 그 외 → null.
export function customerCodeFromLocation(pathname: string, search: string): string | null {
  const detailMatch = pathname.match(/^\/customer-detail\/([^/]+)\/?$/);
  if (detailMatch) return decodeURIComponent(detailMatch[1]);
  if (pathname === "/customers") {
    const code = new URLSearchParams(search).get("customer");
    return code ? code : null;
  }
  return null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:unit client/src/lib/customer-route.test.ts`
Expected: PASS (7).

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/customer-route.ts client/src/lib/customer-route.test.ts
git commit -m "feat(crm): URL→고객코드 파생 순수함수 customerCodeFromLocation + 테스트"
```

---

## Task 2: App.tsx URL-구동 전환

**Files:**
- Modify: `client/src/App.tsx`

> 각 단계는 고유 문자열로 찾아 교체. 단계 도중엔 typecheck 에러가 날 수 있고(상태 제거↔참조 갱신 과도기), **Step 11에서 한 번에 typecheck**한다.

- [ ] **Step 1: import 추가**

`import { fetchCustomers } from "@/lib/customers";` 다음 줄에 추가:

```ts
import { fetchCustomers } from "@/lib/customers";
import { customerCodeFromLocation } from "@/lib/customer-route";
```

- [ ] **Step 2: activeView 파생에 customer-detail prefix 추가**

```ts
  const activeView: ViewKey =
    PATH_TO_VIEW[location.pathname] ??
    (location.pathname.startsWith("/mc-master/") ? "mc-master" : "advisor-dashboard");
```
→
```ts
  const activeView: ViewKey =
    PATH_TO_VIEW[location.pathname] ??
    (location.pathname.startsWith("/customer-detail")
      ? "customer-detail"
      : location.pathname.startsWith("/mc-master/")
        ? "mc-master"
        : "advisor-dashboard");
```

- [ ] **Step 3: 상태 블록 교체(상태 제거 + URL 파생)**

```ts
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersError, setCustomersError] = useState(false);
  const [selectedCustomerNo, setSelectedCustomerNo] = useState<number | null>(null);
  const [chanceOverrides, setChanceOverrides] = useState<Record<number, CustomerChanceOption>>({});
  const [manageStatusOverrides, setManageStatusOverrides] = useState<Record<number, CustomerManageStatus>>({});
  const [customerDetailPanelOpen, setCustomerDetailPanelOpen] = useState(false);
  const [customerDetailEditorOpen, setCustomerDetailEditorOpen] = useState(false);
  const selectedCustomer = customers.find((customer) => customer.no === selectedCustomerNo) ?? customers[0] ?? null;
```
→
```ts
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersError, setCustomersError] = useState(false);
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [chanceOverrides, setChanceOverrides] = useState<Record<number, CustomerChanceOption>>({});
  const [manageStatusOverrides, setManageStatusOverrides] = useState<Record<number, CustomerManageStatus>>({});
  const [customerDetailEditorOpen, setCustomerDetailEditorOpen] = useState(false);
  // 선택 고객은 URL이 single source of truth: /customer-detail/:code 또는 /customers?customer=code.
  const selectedCode = customerCodeFromLocation(location.pathname, location.search);
  const selectedCustomer = selectedCode ? customers.find((customer) => customer.customerId === selectedCode) ?? null : null;
  const isDrawerOpen = activeView === "customers" && selectedCode != null && selectedCustomer != null;
```

- [ ] **Step 4: fetch effect — customersLoaded 세팅(selectedCustomerNo 줄 제거)**

```ts
      .then((list) => {
        if (!alive) return;
        setCustomers(list);
        setSelectedCustomerNo((cur) => cur ?? list[0]?.no ?? null);
        setCustomersError(false);
      })
      .catch(() => {
        if (alive) setCustomersError(true);
      });
```
→
```ts
      .then((list) => {
        if (!alive) return;
        setCustomers(list);
        setCustomersError(false);
        setCustomersLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setCustomersError(true);
        setCustomersLoaded(true);
      });
```

- [ ] **Step 5: handleViewChange — 드로어 상태 setter 제거**

```ts
  function handleViewChange(view: string) {
    setCustomerDetailPanelOpen(false);
    setCustomerDetailEditorOpen(false);
    navigate(VIEW_TO_PATH[view as ViewKey] ?? "/");
  }
```
→
```ts
  function handleViewChange(view: string) {
    setCustomerDetailEditorOpen(false);
    navigate(VIEW_TO_PATH[view as ViewKey] ?? "/");
  }
```

- [ ] **Step 6: openCustomerDetailPanel — navigate로 드로어 오픈**

```ts
  function openCustomerDetailPanel(customer: Customer) {
    setSelectedCustomerNo(customer.no);
    navigate("/customers");
    setCustomerDetailEditorOpen(false);
    setCustomerDetailPanelOpen(true);
    showToast(`${customer.name} 고객 상세 패널을 열었습니다.`);
  }
```
→
```ts
  function openCustomerDetailPanel(customer: Customer) {
    const alreadyOpen = isDrawerOpen;
    setCustomerDetailEditorOpen(false);
    navigate(`/customers?customer=${encodeURIComponent(customer.customerId)}`, { replace: alreadyOpen });
    showToast(`${customer.name} 고객 상세 패널을 열었습니다.`);
  }
```

- [ ] **Step 7: openCustomerDetailFullScreen — code 포함 navigate**

```ts
  function openCustomerDetailFullScreen() {
    setCustomerDetailPanelOpen(false);
    setCustomerDetailEditorOpen(false);
    navigate("/customer-detail");
  }
```
→
```ts
  function openCustomerDetailFullScreen() {
    setCustomerDetailEditorOpen(false);
    if (selectedCode) navigate(`/customer-detail/${encodeURIComponent(selectedCode)}`);
  }
```

- [ ] **Step 8: ESC effect — isDrawerOpen 기반 + navigate**

```ts
  useEffect(() => {
    if (!customerDetailPanelOpen) return;

    function closeByEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (customerDetailEditorOpen) return;
      setCustomerDetailPanelOpen(false);
    }

    document.addEventListener("keydown", closeByEscape);
    return () => document.removeEventListener("keydown", closeByEscape);
  }, [customerDetailEditorOpen, customerDetailPanelOpen]);
```
→
```ts
  useEffect(() => {
    if (!isDrawerOpen) return;

    function closeByEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (customerDetailEditorOpen) return;
      navigate("/customers");
    }

    document.addEventListener("keydown", closeByEscape);
    return () => document.removeEventListener("keydown", closeByEscape);
  }, [customerDetailEditorOpen, isDrawerOpen, navigate]);
```

- [ ] **Step 9: CustomerManagementPage activeCustomerId — selectedCode 기반**

```tsx
              activeCustomerId={customerDetailPanelOpen ? (selectedCustomer?.customerId ?? null) : null}
```
→
```tsx
              activeCustomerId={isDrawerOpen ? selectedCode : null}
```

- [ ] **Step 10a: 페이지 라우트 — /customer-detail/:code + 리다이렉트 + 로딩**

```tsx
        <Route
          path="/customer-detail"
          element={
            selectedCustomer ? (
              <CustomerDetailPage
                chanceOverride={chanceOverrides[selectedCustomer.no]}
                customer={selectedCustomer}
                manageStatusOverride={manageStatusOverrides[selectedCustomer.no]}
                onBack={() => navigate("/customers")}
                onToast={showToast}
                onWorkflowChange={updateCustomerWorkflow}
                variant="page"
              />
            ) : (
              <Navigate to="/customers" replace />
            )
          }
        />
```
→
```tsx
        <Route path="/customer-detail" element={<Navigate to="/customers" replace />} />
        <Route
          path="/customer-detail/:code"
          element={
            selectedCustomer ? (
              <CustomerDetailPage
                chanceOverride={chanceOverrides[selectedCustomer.no]}
                customer={selectedCustomer}
                manageStatusOverride={manageStatusOverrides[selectedCustomer.no]}
                onBack={() => navigate("/customers")}
                onToast={showToast}
                onWorkflowChange={updateCustomerWorkflow}
                variant="page"
              />
            ) : customersLoaded ? (
              <Navigate to="/customers" replace />
            ) : (
              <div className="kim-detail-loading">고객 정보를 불러오는 중…</div>
            )
          }
        />
```

- [ ] **Step 10b: 드로어 렌더 — isDrawerOpen 게이트 + navigate 닫기**

```tsx
      {customerDetailPanelOpen && selectedCustomer && (
        <div className="customer-detail-drawer-overlay" role="presentation">
          <button aria-label="고객 상세 닫기" className="customer-detail-drawer-backdrop" onClick={() => setCustomerDetailPanelOpen(false)} type="button" />
          <aside aria-label={`${selectedCustomer.name} 고객 상세 패널`} className="customer-detail-drawer" role="dialog" aria-modal="true">
            <CustomerDetailPage
              chanceOverride={chanceOverrides[selectedCustomer.no]}
              customer={selectedCustomer}
              manageStatusOverride={manageStatusOverrides[selectedCustomer.no]}
              onBack={() => setCustomerDetailPanelOpen(false)}
              onEditorOpenChange={setCustomerDetailEditorOpen}
              onFullScreen={openCustomerDetailFullScreen}
              onToast={showToast}
              onWorkflowChange={updateCustomerWorkflow}
              variant="drawer"
            />
          </aside>
        </div>
      )}
```
→
```tsx
      {isDrawerOpen && selectedCustomer && (
        <div className="customer-detail-drawer-overlay" role="presentation">
          <button aria-label="고객 상세 닫기" className="customer-detail-drawer-backdrop" onClick={() => navigate("/customers")} type="button" />
          <aside aria-label={`${selectedCustomer.name} 고객 상세 패널`} className="customer-detail-drawer" role="dialog" aria-modal="true">
            <CustomerDetailPage
              chanceOverride={chanceOverrides[selectedCustomer.no]}
              customer={selectedCustomer}
              manageStatusOverride={manageStatusOverrides[selectedCustomer.no]}
              onBack={() => navigate("/customers")}
              onEditorOpenChange={setCustomerDetailEditorOpen}
              onFullScreen={openCustomerDetailFullScreen}
              onToast={showToast}
              onWorkflowChange={updateCustomerWorkflow}
              variant="drawer"
            />
          </aside>
        </div>
      )}
```

- [ ] **Step 11: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 errors, 0 problems. (`selectedCustomerNo`·`customerDetailPanelOpen` 잔존 참조 없어야 함 — 있으면 미사용/미정의 에러로 잡힘.)

확인:
```bash
grep -n "selectedCustomerNo\|customerDetailPanelOpen" client/src/App.tsx
```
Expected: 출력 없음.

- [ ] **Step 12: 커밋**

```bash
git add client/src/App.tsx
git commit -m "feat(crm): 고객 상세 라우팅 딥링크 — URL이 선택 고객의 source of truth"
```

---

## Task 3: 통합 검증

**Files:** 없음(검증만)

- [ ] **Step 1: 전체 검증 스위트**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run build`
Expected: typecheck 0 · lint 0 · test:unit 전부 통과(기존 + customer-route 7) · build OK.

- [ ] **Step 2: 수동 확인(인증 세션 필요)**

로그인 후 dev(`bun run dev`)에서:
1. 고객 행 클릭 → URL이 `/customers?customer=CU-2605-0020`로 바뀌고 드로어 오픈.
2. 그 URL 새로고침 → 드로어 재현(목록 위).
3. 드로어 '전체 화면' → `/customer-detail/CU-2605-0020`, 페이지 표시.
4. 그 URL 새로고침 → 페이지 유지(목록으로 안 튕김).
5. 브라우저 뒤로가기 → 드로어/페이지 닫힘(자연 동작).
6. 백드롭/ESC → `/customers`로 닫힘.
7. 없는 코드 `/customer-detail/CU-9999-9999` → `/customers`로 리다이렉트.
8. 다른 고객 행 연속 클릭(드로어 열린 채) → 히스토리 폭주 없이 전환(replace).

(#51 이후 목록/상세가 JWKS 인증 뒤라 헤드리스 e2e는 세션 필요 → 수동.)

- [ ] **Step 3: brief 갱신 + 커밋**

`ref/active-session-brief.md` Current Focus/완료/Next를 "라우팅 딥링크 완료, 다음=고객 쓰기"로 갱신.

```bash
git add ref/active-session-brief.md
git commit -m "docs: active-session-brief 갱신 — 라우팅 딥링크 완료 [skip ci]"
```

---

## Self-Review 메모

- **스펙 커버리지**: URL 3표면(드로어 쿼리/페이지 path/목록) → Step 6·7·10. URL source of truth + 폴백제거 → Step 3. 로딩/없음 → Step 10a. activeView prefix → Step 2. customersLoaded → Step 4. 순수함수+테스트 → Task 1. CustomerManagementPage activeCustomerId → Step 9. CustomerDetailPage 무변경(확인). ✅
- **플레이스홀더 스캔**: 모든 단계 실제 코드/명령 포함. ✅
- **타입 일관성**: `customerCodeFromLocation`(string,string)→string|null, `selectedCode`(string|null), `selectedCustomer`(Customer|null), `isDrawerOpen`(boolean), `customersLoaded`(boolean) 정의·사용 일치. 제거 대상(`selectedCustomerNo`/`customerDetailPanelOpen`) 전 참조처(상태 정의·fetch·핸들러2·ESC·activeCustomerId·드로어) 모두 Step에 포함 — Step 11 grep로 잔존 0 확인. ✅
- **알려진 가정**: 현재 목록 전체(20명) 로드라 find-in-list로 충분. 페이지네이션 도입 시 단건 fetch 폴백은 범위 밖. `.kim-detail-loading`은 #51에서 추가됨(재사용).
