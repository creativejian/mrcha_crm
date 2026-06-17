# 차량 관리 프론트 보강-A: 라우트 드릴다운 + sticky 스크롤 + 정규화명 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans(inline). Steps는 체크박스(`- [ ]`).

**Goal:** 앱 패리티 빠른 보강 — (1) 모델 클릭 시 라우트 변경(`/mc-master/:modelId`)으로 브라우저 뒤로가기 작동, (2) 브랜드 사이드바 고정 + 모델/트림 영역만 스크롤, (3) 트림 수정에 정규화명(canonical) read-only 필드.

**Architecture:** `MCMasterPage`의 드릴다운을 state(`openModel`)에서 **react-router URL 파라미터**로 전환. App.tsx에 `/mc-master/:modelId` 라우트 추가 + activeView prefix fallback. 사이드바/테이블 독립 스크롤은 CSS. 1b-i/ii 컴포넌트 재사용.

**Tech Stack:** React 19, react-router 7, TypeScript 6.0.3, vitest + @testing-library/react(+ MemoryRouter).

**선행:** 1b-i(#24)·1b-ii(#25) 머지. **다음:** 보강-B(선택모드+순서변경) → 1b-iii(옵션+색상).

**확인된 사실:** 앱 트림 수정에 `_readOnlyField('정규화명', …)` read-only 존재. App.tsx `activeView = PATH_TO_VIEW[location.pathname]`(정확 일치) → `/mc-master/123`는 fallback 필요.

---

## File Structure

- **Modify**: `client/src/App.tsx` — `/mc-master/:modelId` 라우트 + activeView prefix fallback.
- **Modify**: `client/src/pages/MCMasterPage.tsx` — useParams/useNavigate 기반 드릴다운(openModel state 제거).
- **Modify**: `client/src/pages/MCMasterPage.test.tsx` — MemoryRouter 래핑 + 라우트.
- **Modify**: `client/src/pages/mc-master/TrimEditPanel.tsx` — 정규화명 read-only 필드(수정 모드).
- **Modify**: `client/src/index.css` — 사이드바 sticky + 테이블 영역 스크롤.

---

## Task 1: App.tsx — 라우트 + activeView fallback

**Files:** Modify `client/src/App.tsx`

- [ ] **Step 1: activeView prefix fallback**

`const activeView: ViewKey = PATH_TO_VIEW[location.pathname] ?? "advisor-dashboard";` 를:
```tsx
const activeView: ViewKey =
  PATH_TO_VIEW[location.pathname] ??
  (location.pathname.startsWith("/mc-master/") ? "mc-master" : "advisor-dashboard");
```

- [ ] **Step 2: 파라미터 라우트 추가**

`<Route path="/mc-master" element={<MCMasterPage roleTab={roleTab} />} />` 바로 아래에:
```tsx
        <Route path="/mc-master/:modelId" element={<MCMasterPage roleTab={roleTab} />} />
```

- [ ] **Step 3: typecheck → 0** (MCMasterPage는 Task 2에서 router 사용 — 이 단계는 라우트만 추가라 통과)

---

## Task 2: MCMasterPage — 라우트 기반 드릴다운

**Files:** Modify `client/src/pages/MCMasterPage.tsx`

- [ ] **Step 1: openModel state → route 파생으로 교체**

- import 추가: `import { useMemo } from "react";`(기존 react import에 병합) + `import { useNavigate, useParams } from "react-router";`
- 제거: `const [openModel, setOpenModel] = useState<CatalogModel | null>(null);`
- 추가(컴포넌트 상단, hooks):
```tsx
const navigate = useNavigate();
const { modelId } = useParams();
const openModel = useMemo(
  () => (modelId ? (models.find((m) => String(m.id) === modelId) ?? null) : null),
  [models, modelId],
);
```
- 트림 로드 effect를 `modelId` 기준으로(객체 아닌 param):
```tsx
useEffect(() => {
  if (!modelId) {
    setTrims([]);
    return;
  }
  fetchTrims(Number(modelId))
    .then(setTrims)
    .catch(() => setLoadError(true));
}, [modelId]);
```
- `reloadTrims`도 modelId 기준:
```tsx
function reloadTrims() {
  if (!modelId) return;
  fetchTrims(Number(modelId))
    .then(setTrims)
    .catch(() => setLoadError(true));
}
```
- 브랜드 선택: `selectBrand`에서 navigate로 드릴다운 해제:
```tsx
function selectBrand(id: number) {
  setBrandId(id);
  navigate("/mc-master");
}
```
- submitTrim/handleDeleteTrim 안의 `openModel == null` 가드는 `modelId == null`로(또는 openModel 유지 — openModel는 modelId 있을 때 보통 존재. createTrim은 `Number(modelId)` 사용): `createTrim`은 `openModel.id` 대신 `Number(modelId)`로 변경해 deep-link에서도 안전:
```tsx
async function submitTrim(values: TrimInput) {
  if (modelId == null || trimPanel == null) return;
  setBusy(true); setPanelError(null);
  try {
    if (trimPanel.mode === "add") await createTrim(Number(modelId), values);
    else await updateTrim(trimPanel.trim.id, values);
    setTrimPanel(null); reloadTrims(); reloadModels();
  } catch (e) { setPanelError(e instanceof Error ? e.message : "저장 실패"); }
  finally { setBusy(false); }
}
```
- 렌더 분기 조건 `openModel ? ... : ...` 유지(openModel 객체로 헤더 이름 표시). 단 헤더 이름은 `openModel?.name ?? "트림"`로(deep-link 방어). 드릴다운 표시 여부는 `modelId` 기준이 더 안전 → 조건을 `modelId ?`로 바꾸고 헤더는 `openModel?.name ?? "트림"`:
```tsx
{modelId ? ( /* 트림 뷰: 헤더 back + openModel?.name ?? "트림" + TrimTable */ ) : ( /* 모델 뷰 */ )}
```
- 모델 열기: `onOpen={(m) => navigate(`/mc-master/${m.id}`)}`
- 뒤로 버튼: `onClick={() => navigate("/mc-master")}`
- BrandSidebar `onSelect={selectBrand}` 유지.

> 결과: URL이 `/mc-master/:id`로 바뀌어 브라우저 뒤로가기가 모델 목록으로 돌아간다. deep-link/새로고침 시 models에 해당 모델이 없으면 헤더는 "트림"으로 표시되고 트림은 modelId로 정상 로드(엣지, 허용).

- [ ] **Step 2: typecheck → 0** (테스트는 Task 3에서 router 래핑 후 통과 — 이 단계 typecheck는 통과, test:unit은 Task 3 후)

---

## Task 3: MCMasterPage.test — MemoryRouter 래핑

**Files:** Modify `client/src/pages/MCMasterPage.test.tsx`

- [ ] **Step 1: 라우터 래핑 헬퍼 + 테스트 갱신**

상단 import에 `import { MemoryRouter, Routes, Route } from "react-router";` 추가. 렌더 헬퍼:
```tsx
function renderPage(roleTab: "최고관리자" | "상담사") {
  return render(
    <MemoryRouter initialEntries={["/mc-master"]}>
      <Routes>
        <Route path="/mc-master" element={<MCMasterPage roleTab={roleTab} />} />
        <Route path="/mc-master/:modelId" element={<MCMasterPage roleTab={roleTab} />} />
      </Routes>
    </MemoryRouter>,
  );
}
```
기존 4개 테스트의 `render(<MCMasterPage roleTab=... />)` → `renderPage(...)`로 교체. 드릴다운 테스트는 그대로(모델 "그랜저" 버튼 클릭 → navigate → useParams → 트림 뷰). 나머지 동일.

- [ ] **Step 2: test:unit + typecheck + lint**

Run: `bun run test:unit client/src/pages/MCMasterPage.test.tsx` → PASS(4)
Run: `bun run typecheck` → 0 / `bun run lint` → 0

- [ ] **Step 3: 커밋(Task 1·2·3 한 묶음 — router 전환은 원자적)**

```bash
git add client/src/App.tsx client/src/pages/MCMasterPage.tsx client/src/pages/MCMasterPage.test.tsx
git commit -m "feat(mc-master): 모델 드릴다운을 라우트(/mc-master/:modelId)로 전환 — 브라우저 뒤로가기 (보강-A)"
```

---

## Task 4: TrimEditPanel — 정규화명 read-only

**Files:** Modify `client/src/pages/mc-master/TrimEditPanel.tsx`

- [ ] **Step 1: 수정 모드에 정규화명 필드 추가**

트림명 `<label>` 바로 아래에:
```tsx
{isEdit && (
  <label className="va-field">
    <span>정규화명 (자동 생성)</span>
    <input className="input" value={trim?.canonicalName ?? ""} readOnly disabled />
  </label>
)}
```

- [ ] **Step 2: typecheck → 0 → 커밋**

```bash
git add client/src/pages/mc-master/TrimEditPanel.tsx
git commit -m "feat(mc-master): 트림 수정에 정규화명 read-only 필드 (보강-A)"
```

---

## Task 5: index.css — 사이드바 sticky + 테이블 스크롤

**Files:** Modify `client/src/index.css`

- [ ] **Step 1: `.va-mono` 블록 뒤에 추가**

```css
.va-layout > .table-scroll,
.va-layout > .va-empty {
  max-height: calc(100vh - 210px);
  overflow-y: auto;
}
.va-brand-sidebar {
  align-self: start;
  position: sticky;
  top: 0;
  max-height: calc(100vh - 210px);
  overflow-y: auto;
}
```
> 효과: 모델/트림 테이블 영역만 세로 스크롤, 브랜드 사이드바는 고정. `210px`(상단바+카드헤더+여백)는 근사치라 실제 화면에서 미세 조정 가능.

- [ ] **Step 2: build → OK → 커밋**

Run: `bun run build` → OK
```bash
git add client/src/index.css
git commit -m "feat(mc-master): 브랜드 사이드바 고정 + 모델/트림 영역 스크롤 (보강-A)"
```

---

## Task 6: 최종 검증

- [ ] `bun run typecheck` → 0 / `bun run lint` → 0 / `bun run test:unit` → 전체 PASS / `bun run build` → OK
- [ ] (수동) dev 재시작 후: 모델 클릭 → URL `/mc-master/:id` + 트림 뷰, **브라우저 뒤로가기 → 모델 목록**, 스크롤 시 사이드바 고정, 트림 수정에 정규화명 read-only.

---

## Self-Review

- **요구 커버:** 라우트 드릴다운+뒤로가기(Task 1·2)✓ / 사이드바 고정 스크롤(Task 5)✓ / 정규화명 read-only(Task 4)✓. 선택모드+순서변경은 보강-B.
- **Placeholder scan:** 전 step 구체 코드/명령.
- **Type consistency:** openModel state 제거 → 전 참조를 modelId 파생/Number(modelId)로 교체. 테스트는 MemoryRouter+Routes로 useParams/useNavigate 충족.

## 미결 / 주의

- deep-link `/mc-master/:id` 새로고침 시 헤더 모델명이 "트림"으로 표시될 수 있음(models 미로딩). 클릭 플로우는 정상. 필요 시 후속에 단일 모델 fetch 추가.
- sticky 스크롤 `calc(100vh - 210px)`는 근사 — 실화면 확인 후 조정 가능.
- bun API 핫리로드 없음 → dev 재시작 후 동작.

## Execution Handoff
1. **Inline (추천)** — executing-plans.
</content>
