# CRM 고객 상세 라우팅 딥링크 설계

작성일: 2026-06-19
상태: design (승인됨 2026-06-19). 다음 = writing-plans → 구현.
연계: `2026-06-19-crm-customer-detail-read-design.md`(상세 읽기 연결, 완료 #51). 본 스펙은 그 화면을 **URL로 딥링크 가능**하게 만든다.

## 목표

고객 상세(드로어 + 전체화면 페이지)를 **URL이 식별하도록** 바꾼다. 현재는 어떤 고객인지가 `selectedCustomerNo`(React 상태)에만 있어, `/customer-detail` 새로고침 시 목록으로 튕기고, 특정 고객 링크 공유/북마크가 안 된다. 이후 고객 쓰기·견적이 안정된 고객 URL 위에서 동작하도록 기반을 정리한다.

## 현재 구조 (조사 결과)

- 고객 식별 = `selectedCustomerNo` 상태. `selectedCustomer = customers.find(no === selectedCustomerNo) ?? customers[0] ?? null` (App.tsx:101) — `?? customers[0]` 폴백이 새로고침 시 엉뚱한 고객을 보여주는 원인.
- 두 진입점: ①**드로어**(주 진입) — 행 클릭 → `openCustomerDetailPanel`이 `/customers`로 가서 App 루트의 오버레이(App.tsx:312~329)를 `customerDetailPanelOpen` 상태로 띄움. URL은 `/customers` 유지. ②**전체화면 페이지** — 드로어 '전체 화면' → `navigate('/customer-detail')`(App.tsx:166~170), 라우트가 `CustomerDetailPage variant="page"` 렌더(App.tsx:242~258).
- `activeView`는 `PATH_TO_VIEW[location.pathname]` 파생, mc-master만 `/mc-master/` prefix 특례(App.tsx:82~84). mc-master는 `/mc-master/:modelId` 선례 보유.
- `CustomerDetailPage`(#51)는 `customer` prop의 `id`로 상세를 자체 fetch. 즉 **코드로 찾은 customer 객체만 넘기면 그대로 동작**.

## 범위 (2번 = 드로어 + 페이지 모두 URL-구동)

**포함**: 드로어/페이지 양쪽 고객 식별을 URL로 이전, 콜드 딥링크 로딩/없음 처리, 버그 폴백 제거.
**제외(다음)**: 페이지네이션 도입 시 단건 fetch 폴백(현재 20명 전체 로드라 find-in-list로 충분), 드로어 UX/비주얼 변경, 고객 쓰기, enum/lookup.

## URL 설계 (식별자 = `customerCode`)

| 상황 | URL |
|---|---|
| 목록만 | `/customers` |
| 목록 + 드로어 열림 | `/customers?customer=CU-2605-0020` |
| 전체화면 페이지 | `/customer-detail/CU-2605-0020` |

식별자로 uuid 대신 `customerCode`를 쓴다 — 읽기 쉽고 안정적이며 `no`가 여기서 파생됨(`toCustomer`). 라우트는 `/customer-detail/:code`(+ `/customer-detail`는 `/customers`로 리다이렉트).

## 상태 모델 — URL이 single source of truth

- **`selectedCustomerNo` 제거** → URL에서 `selectedCode` 파생. App은 `<Routes>` 위라 `useParams`를 못 쓰므로 **`useLocation`의 `pathname`+`search`를 순수 함수로 파싱**한다(드로어/페이지 공통, single source):
  - `customerCodeFromLocation(pathname, search)`: `/customer-detail/:code` → path의 code, `/customers` + `?customer=` → 쿼리값, 그 외 → null.
  - `selectedCustomer = customers.find(c => c.customerId === selectedCode) ?? null`. **`?? customers[0]` 폴백 제거.**
- **`customerDetailPanelOpen` 제거** → `isDrawerOpen = activeView === "customers" && selectedCode != null && selectedCustomer != null`.
- **`customersLoaded` 플래그 추가**: `fetchCustomers` then/catch에서 true. 로딩 vs "없음" 구분용.
- `customerDetailEditorOpen`(인라인 편집 중 ESC 가드)는 유지. ESC 닫기는 `setCustomerDetailPanelOpen(false)` → `navigate("/customers")`로 치환, 에디터 열림 시 가드 유지.
- `chanceOverrides`/`manageStatusOverrides`는 `customer.no` 키 그대로 유지(파생된 customer에서 `no` 사용). `updateCustomerWorkflow(customerNo, …)` 시그니처 불변.
- 보너스: URL-구동이라 **브라우저 뒤로가기**가 드로어 닫기/페이지 이탈로 자연 동작.

## 네비게이션 핸들러

- `openCustomerDetailPanel(customer)` → `navigate("/customers?customer=" + customer.customerId)`. **드로어가 이미 열린 상태에서 다른 고객 클릭은 `{ replace: true }`**(히스토리 폭주 방지).
- 드로어 닫기(백드롭/ESC/onBack) → `navigate("/customers")`.
- `openCustomerDetailFullScreen()` → `navigate("/customer-detail/" + selectedCode)`.
- 페이지 onBack('전체 보기') → `navigate("/customers")`.
- `handleViewChange`는 드로어 상태 setter 대신 단순 `navigate(path)`(드로어는 URL 파생이라 사이드바 이동 시 자동으로 닫힘).
- `activeView` 파생에 `/customer-detail` prefix 처리 추가:
  `location.pathname.startsWith("/customer-detail") → "customer-detail"`.

## 로딩 / 없음 처리

- **페이지** `/customer-detail/:code`:
  - `!customersLoaded` → 로딩 placeholder.
  - 로드 후 `selectedCustomer` 있음 → 렌더.
  - 로드 후 없음 → `<Navigate to="/customers" replace />`.
- **드로어** `/customers?customer=code`:
  - 리스트는 정상 렌더(로딩/에러 자체 처리).
  - `customersLoaded && selectedCustomer` → 드로어 오픈. 로드 후 코드가 없는 고객이면 드로어 미오픈(쿼리 잔존은 무해, 선택적으로 `replace`로 정리).

## 영향 파일 / 재사용

- **`App.tsx`**(집중): `selectedCode`/`selectedCustomer`/`isDrawerOpen` URL 파생, `customersLoaded`, 라우트 `/customer-detail/:code`(+리다이렉트), activeView prefix, 핸들러 navigate화, 드로어 게이트.
- **`CustomerManagementPage`**: `activeCustomerId`를 `isDrawerOpen ? selectedCode : null`에서. (props 시그니처 불변, 값 출처만 변경.)
- **`CustomerDetailPage` 컴포넌트 무변경** — `customer`(코드로 찾은 객체, `id` 보유)·`variant` 그대로. #51 상세 fetch가 동일 동작 → 딥링크와 읽기 연결 호환.
- **`customerCodeFromLocation(pathname, search)` 순수 함수**(상태 모델 참조)로 분리해 단위테스트 — App에서 호출.

## 검증

- `typecheck 0 · lint 0 · build`. `test:unit`: URL 파생 순수함수 신규(TDD) + 기존 유지.
- **수동(인증 세션 필요)**: 로그인 후 ①행 클릭 → URL `?customer=CODE`로 바뀌고 드로어 오픈, ②그 URL 새로고침 → 드로어 재현, ③'전체 화면' → `/customer-detail/CODE`, ④그 URL 새로고침 → 페이지 유지(목록으로 안 튕김), ⑤브라우저 뒤로가기로 드로어 닫힘, ⑥없는 코드 → `/customers` 리다이렉트. (#51 이후 목록/상세가 JWKS 인증 뒤라 헤드리스 e2e는 세션 필요.)

## 미결 (다음 서브프로젝트)

- 페이지네이션 도입 시 목록 밖 고객 딥링크용 **단건 fetch**(`GET /api/customers/by-code/:code` 또는 기존 `/:id` 활용) 폴백.
- 고객 쓰기(상태/메모/니즈/할일/일정 PATCH) + advisor 배정.
- enum/lookup 도메인 정리(별도 설계 사이클).
