# 고객 관리 5개 mode 콘솔 레이아웃 통일 — 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `CustomerManagementPage`의 비-all 5개 mode(consulting·contract·delivery·settlement·hold)를 전체 보기(all)와 같은 콘솔 문법(1줄 컨트롤 rail + 콘솔 테이블 서피스)으로 통일한다.

**Architecture:** `isConsole = mode === "all"`이 지금 레이아웃 전체를 가르는 게이트를, "필터 세트 선택자"로 의미 축소한다(`isAllMode`로 리네임). 레이아웃 클래스는 전 mode 무조건 콘솔, mode 차이는 필터 항목 한 곳에만 남긴다. 비콘솔 전용 마크업(구식 검색/select 3벌/TOTAL/뷰 select 네이티브)은 삭제하고, 뷰 select 3개는 `renderConsoleFilter`를 일반화해 pill로 흡수한다.

**Tech Stack:** React + TypeScript, vitest + @testing-library/react, 기존 `customer-console-*` CSS(신규 CSS 0벌).

**Spec:** `ref/specs/2026-07-15-crm-console-layout-unify-design.md`

---

## 파일 구조

- Modify: `client/src/pages/CustomerManagementPage.tsx` — 유일한 소스 변경 파일. 타입(`:68`)·`renderConsoleFilter`(`:825`)·rail JSX(`:884~962`)·headbar(`:964~977`)·table(`:1128-1129`)·pagination(`:1151,1203`).
- Test: `client/src/pages/CustomerManagementPage.test.tsx` — 전 mode 콘솔 rail 스모크.
- CSS: 변경 없음(`customer-console-*` 재사용). controls.css의 `console-table`도 재사용.

**중간 상태 주의**: `isConsole` 분기를 부분만 제거하면 클래스 불일치로 화면이 깨진 채 커밋될 수 있다. Task 4의 JSX 통일은 **한 번에** 적용한다(원자적). Task 1~3에서 토대(일반화·타입·테스트)를 먼저 깔고, Task 4에서 JSX를 통일한다.

---

### Task 1: `renderConsoleFilter` 일반화 — `includeAllOption` + 빈 팝오버 가드

뷰 select(담당자별/상담상태별/긴급순 보기)는 "전체" 옵션이 없는 정렬/그룹 축이다. 필터(빈="전체")와 한 렌더러로 흡수하기 위해 `includeAllOption` 파라미터를 추가한다. 옵션이 없으면(mock 뷰 select) 팝오버를 열지 않는다.

**Files:**
- Modify: `client/src/pages/CustomerManagementPage.tsx:825~881` (renderConsoleFilter)

- [ ] **Step 1: `includeAllOption` 파라미터 + allItems 분기 + 빈 팝오버 가드 적용**

`:825` 함수 시그니처의 옵션 객체에 `includeAllOption?: boolean;`를 추가하고, `allItems` 계산과 팝오버 조건을 아래처럼 바꾼다.

기존(`:836`):
```tsx
    const allItems = [{ value: "", label: options.label }, ...options.items];
```
변경:
```tsx
    const includeAll = options.includeAllOption ?? true;
    const allItems = includeAll ? [{ value: "", label: options.label }, ...options.items] : options.items;
```

기존(`:850`):
```tsx
        {open && (
```
변경:
```tsx
        {open && allItems.length > 0 && (
```

파라미터 타입에도 추가(`:825~832` 옵션 객체 타입):
```tsx
  function renderConsoleFilter(options: {
    id: ConsoleFilterKey;
    label: string;
    value: string;
    items: { value: string; label: string }[];
    onChange: (value: string) => void;
    extraClassName?: string;
    includeAllOption?: boolean;
  }) {
```

- [ ] **Step 2: typecheck + 기존 필터 회귀 확인**

Run: `bun run typecheck && bun run test:unit client/src/pages/CustomerManagementPage.test.tsx`
Expected: PASS. 기존 all mode 필터는 `includeAllOption` 미지정 → `?? true` → 동작 불변(빈 "전체" 옵션 유지, allItems.length ≥ 1이라 팝오버 조건도 불변).

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/CustomerManagementPage.tsx
git commit -m "refactor(crm): renderConsoleFilter includeAllOption 파라미터 — 뷰 select 흡수 준비"
```

---

### Task 2: `ConsoleFilterKey`에 뷰 select id 3개 추가

뷰 select도 `renderConsoleFilter`를 타면 `openConsoleFilter` state(`ConsoleFilterKey | null`)를 공유하므로 고유 id가 필요하다.

**Files:**
- Modify: `client/src/pages/CustomerManagementPage.tsx:68`

- [ ] **Step 1: 타입 확장**

기존(`:68`):
```tsx
type ConsoleFilterKey = "statusGroup" | "status" | "advisor" | "chance" | "finalUpdate";
```
변경:
```tsx
type ConsoleFilterKey = "statusGroup" | "status" | "advisor" | "chance" | "finalUpdate" | "viewAdvisor" | "viewConsultStatus" | "viewUrgent";
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/CustomerManagementPage.tsx
git commit -m "refactor(crm): ConsoleFilterKey에 뷰 select id 3개 추가"
```

---

### Task 3: 전 mode 콘솔 rail 스모크 테스트 작성 (RED)

JSX 통일 전에 실패 테스트를 먼저 박는다. 비콘솔 mode에서 콘솔 검색·필터 pill·"전체 N명" 카운트·뷰 select pill이 나오는지.

**Files:**
- Modify: `client/src/pages/CustomerManagementPage.test.tsx`

- [ ] **Step 1: 테스트 추가**

`hides the advisor column for advisor and dealer roles` 테스트 뒤(현재 헤더=바디 정합 테스트 앞)에 추가:

```tsx
  // 5개 비-all mode도 전체 보기와 같은 콘솔 문법(1줄 rail·필터 pill·전체 N명 카운트)을 쓴다.
  // 뷰 select 3개(담당자별/상담상태별/긴급순)는 renderConsoleFilter로 흡수돼 pill(button)이 된다.
  it.each(["consulting", "contract", "delivery", "settlement", "hold"] as const)(
    "renders the console control rail for %s mode",
    (mode) => {
      render(<CustomerManagementPage mode={mode} />);
      // 콘솔 검색 래퍼(구식 <input class="input"> 아님)
      expect(document.querySelector(".customer-console-search")).not.toBeNull();
      // 공통 필터가 pill(button)로 — 구식 네이티브 select 아님
      expect(screen.getByRole("button", { name: /진행 상태 · 1차/ })).toBeInTheDocument();
      // 카운트는 "전체 N명"(구식 "TOTAL N" 아님)
      expect(screen.queryByText("TOTAL")).not.toBeInTheDocument();
      // 뷰 select 3개가 pill(button)로 흡수
      expect(screen.getByRole("button", { name: /담당자별 보기/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /상담상태별 보기/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /긴급순으로 보기/ })).toBeInTheDocument();
    },
  );
```

- [ ] **Step 2: RED 확인**

Run: `bun run test:unit client/src/pages/CustomerManagementPage.test.tsx 2>&1 | grep "console control rail"`
Expected: 5개 케이스 FAIL — 지금 비콘솔은 `.customer-console-search`가 없고(구식 `.input`), 필터가 네이티브 `<select>`(button 아님), "TOTAL" 텍스트가 있고, 뷰 select도 `<select>`(button 아님).

- [ ] **Step 3: Commit (RED 테스트)**

```bash
git add client/src/pages/CustomerManagementPage.test.tsx
git commit -m "test(crm): 전 mode 콘솔 rail 스모크 (RED)"
```

---

### Task 4: rail·headbar·table·pagination JSX 통일 (GREEN)

`isConsole` 분기를 제거하고 레이아웃을 전 mode 콘솔로. `isConsole` 변수를 `isAllMode`로 리네임(레이아웃 게이트 아니라 필터 세트 선택자임을 드러냄). 뷰 select 3개를 headbar → toolbar list-view-controls로 이동·pill화. 구식 마크업 삭제.

**Files:**
- Modify: `client/src/pages/CustomerManagementPage.tsx:816` (변수명), `:884~977` (rail+headbar), `:1128-1129` (table), `:1151,1203` (pagination)

- [ ] **Step 1: `isConsole` → `isAllMode` 리네임**

`:816`:
```tsx
  const isAllMode = mode === "all";
```

- [ ] **Step 2: rail JSX 통일 (`:884~962`)**

`:884~962`(section 열기 ~ toolbar 닫기 `</div>` 전까지)를 아래로 교체:

```tsx
    <section className="customer-console-page">
      <section className="card customer-console-card">
        <div className="customer-console-control-rail" ref={consoleFilterRailRef}>
          <div className="toolbar customer-console-toolbar">
            <div className="total-count">전체 <strong className="num">{rows.length}</strong><span>명</span></div>
            <label className="customer-console-search">
              <Search aria-hidden="true" size={15} strokeWidth={2.4} />
              <input onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }} placeholder="고객명, 연락처, 차종 검색" value={search} />
            </label>
            {renderConsoleFilter({
              id: "advisor",
              label: "담당자",
              value: advisor,
              items: consoleFilterOptions.advisor,
              onChange: setAdvisor,
              extraClassName: "filter-advisor",
            })}
            {renderConsoleFilter({
              id: "statusGroup",
              label: "진행 상태 · 1차",
              value: statusGroup,
              items: consoleFilterOptions.statusGroup,
              onChange: (value) => {
                setStatusGroup(value);
                setStatus("");
              },
              extraClassName: "filter-stage",
            })}
            {renderConsoleFilter({
              id: "status",
              label: "진행 상태 · 2차",
              value: status,
              items: consoleFilterOptions.status,
              onChange: setStatus,
              extraClassName: "filter-stage",
            })}
            <div className="list-view-controls">
              {isAllMode ? (
                <>
                  {renderConsoleFilter({
                    id: "chance",
                    label: "계약 가능성",
                    value: chanceFilter,
                    items: consoleFilterOptions.chance,
                    onChange: (value) => setChanceFilter(value as "" | ChanceOption),
                    extraClassName: "view-select filter-compact",
                  })}
                  {renderConsoleFilter({
                    id: "finalUpdate",
                    label: "관리 상태",
                    value: finalUpdateFilter,
                    items: consoleFilterOptions.finalUpdate,
                    onChange: (value) => setFinalUpdateFilter(value as "" | FinalUpdateFilterOption),
                    extraClassName: "view-select filter-compact",
                  })}
                </>
              ) : (
                <>
                  {/* 정렬/그룹 뷰 전환 — 기능은 나중(옵션 채우면 실동작), 지금은 시각 pill만(mock). */}
                  {renderConsoleFilter({ id: "viewAdvisor", label: "담당자별 보기", value: "", items: [], onChange: NOOP_VIEW_CHANGE, includeAllOption: false, extraClassName: "view-select filter-compact" })}
                  {renderConsoleFilter({ id: "viewConsultStatus", label: "상담상태별 보기", value: "", items: [], onChange: NOOP_VIEW_CHANGE, includeAllOption: false, extraClassName: "view-select filter-compact" })}
                  {renderConsoleFilter({ id: "viewUrgent", label: "긴급순으로 보기", value: "", items: [], onChange: NOOP_VIEW_CHANGE, includeAllOption: false, extraClassName: "view-select filter-compact" })}
                </>
              )}
            </div>
          </div>
```

- [ ] **Step 3: `NOOP_VIEW_CHANGE` 상수 추가**

빈 함수를 인라인으로 쓰면 매 렌더 새 함수 생성 + lint(no-empty-function) 위험이 있어 모듈 최상위 상수로 뺀다. 파일 상단 import 아래, `type ConsoleFilterKey` 근처(`:68` 위)에 추가:

```tsx
// 뷰 select(담당자별/상담상태별/긴급순 보기)는 아직 정렬 로직이 없다(mock). 시각 pill만 통일하고
// onChange는 no-op — 옵션·핸들러는 후속 슬라이스에서 채운다.
const NOOP_VIEW_CHANGE = (_value: string) => undefined;
```

- [ ] **Step 4: headbar 통일 (`:964~977`)**

`:964~977`(headbar 열기 ~ list-head-left 닫기)를 아래로 교체(TOTAL·뷰 select 네이티브 삭제, 빈 list-head-left 유지):

```tsx
          <div className="list-headbar customer-console-headbar">
            <div className="list-head-left"></div>
```

(`:978` `<div className="top-actions">` 이하는 그대로 유지.)

- [ ] **Step 5: table 클래스 통일 (`:1128-1129`)**

기존:
```tsx
        <div className={isConsole ? "console-table-scroll" : "table-scroll"}>
          <table className={`customer-table mode-${mode}${isConsole ? " console-table" : ""}`}>
```
변경:
```tsx
        <div className="console-table-scroll">
          <table className={`customer-table mode-${mode} console-table`}>
```

(주의: 배치 5 4-B에서 콘솔 래퍼의 `table-scroll`을 제거한 상태 — 통일 후에도 `console-table-scroll` 단독 유지.)

- [ ] **Step 6: pagination 통일 (`:1151`, `:1203`)**

`:1151` 기존:
```tsx
        <div className={isConsole ? "pagination-bar customer-console-pagination" : "pagination-bar"}>
```
변경:
```tsx
        <div className="pagination-bar customer-console-pagination">
```

`:1203`은 `isConsole ? (콘솔 page-size 팝오버) : (구식)` 삼항이다. 콘솔 분기를 무조건 렌더로 바꾼다 — `{isConsole ? (` 를 제거하고 콘솔 JSX만 남기고, `) : (` 이후 구식 else 블록과 닫는 `)}`를 삭제한다. 실행 시 해당 삼항의 정확한 범위(콘솔 블록 끝과 else 블록)를 확인해 콘솔 블록만 남긴다.

- [ ] **Step 7: GREEN 확인 + typecheck + lint**

Run: `bun run typecheck && bun run lint && bun run test:unit client/src/pages/CustomerManagementPage.test.tsx`
Expected: 전부 PASS. Task 3의 5개 케이스 GREEN. 기존 테스트(all 렌더·헤더=바디 정합)도 불변.

- [ ] **Step 8: 미사용 심볼 정리**

`isConsole → isAllMode` 리네임 후 `bindSelect`·`staffNames` 등이 rail에서 안 쓰이게 됐는지 확인. `bun run lint`가 unused import를 잡는다. 남은 사용처(예: 담당자 변경 팝오버 내부 `bindSelect`) 있으면 유지, 없으면 import 제거.

Run: `bun run lint`
Expected: 0 problems.

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/CustomerManagementPage.tsx client/src/pages/CustomerManagementPage.test.tsx
git commit -m "refactor(crm): 고객관리 5 mode 콘솔 레이아웃 통일 — rail·headbar·table·pagination"
```

---

### Task 5: 검증 + 격리 스택 브라우저 스크린샷

**Files:** 없음(검증 전용)

- [ ] **Step 1: 전체 검증 4종**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run build`
Expected: typecheck 0, lint 0, unit 전량 PASS(신규 5 케이스 포함), build 성공.

- [ ] **Step 2: knip 회귀 확인**

Run: `bunx knip 2>&1 | tail -20`
Expected: main과 동일(신규 unused 0). `NOOP_VIEW_CHANGE`가 unused로 잡히면 안 됨(rail에서 사용).

- [ ] **Step 3: 격리 스택 브라우저 스크린샷 6 mode**

로컬 dev(격리 스택, 사용자 dev 서버 불가침)를 띄우고 magiclink 스모크 로그인 후 6개 mode(all·consulting·contract·delivery·settlement·hold)를 캡처한다. 확인 항목:
- 5개 비-all mode가 1줄 콘솔 rail(검색·필터 pill·전체 N명 카운트·뷰 select pill)
- 콘솔 테이블 서피스(흰 헤더·연회색 바디·radius 래퍼)
- **담당자 변경 팝오버가 비콘솔 mode에서도 정상 표시**(스크린샷 4 깨짐 해소 — position:absolute 정상)
- **all mode 회귀 0**(기존 모습 그대로)

- [ ] **Step 4: 스크린샷 리뷰 후 미세 조정**

1줄 rail 밀도가 좁은 화면에서 문제면 CSS 미세 조정(기존 `customer-console-toolbar` grid). 시각 조정은 격리 스택 스크린샷 반복으로.

---

## Self-Review (작성자 체크)

- **Spec 커버리지**: 결정 1(5 mode)=Task 3·4 / 결정 2(항목 유지·시각만)=Task 4 필터 세트 조건부 / 결정 3(죽은 select 유지)=Task 4 뷰 select pill / 결정 4(1줄 A)=Task 4 rail / 결정 5(전체 N명)=Task 4 Step 2 / 결정 6(클래스 유지)=전 Task. 실버그(팝오버)=Task 4 headbar 통일 → Task 5 Step 3 확인. ✅ 전부 커버.
- **Placeholder**: 없음. 모든 코드 블록 실제 코드.
- **타입 일관성**: `isAllMode`(Task 4 전체), `ConsoleFilterKey` 뷰 id 3개(Task 2)=rail 사용처(Task 4)와 일치, `includeAllOption`(Task 1)=뷰 호출(Task 4)과 일치, `NOOP_VIEW_CHANGE`(Task 4 Step 3 정의)=사용(Step 2)과 일치.
- **범위**: 단일 파일 집중 리팩토링 — 단일 플랜 적합.

## 검증 예산
- 클라 전용(CSS/JSX). server 무관.
- typecheck·lint·unit·build + knip + 격리 스택 스크린샷 6 mode.
- jsdom은 CSS 레이아웃 검증 불가 → 팝오버 깨짐 해소·배경 톤은 **스크린샷으로만** 확인(단위 테스트는 클래스·텍스트·role까지).
