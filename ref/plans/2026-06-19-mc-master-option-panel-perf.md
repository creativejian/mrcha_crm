# mc-master 옵션 패널 캐시 + 번쩍임 제거 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 국산차 트림 옵션 패널을 trimId 단위 프런트 캐시 + hover 프리패치로 즉시 표시하고, 로딩 중 빈 패널/「옵션 없음 확정」 번쩍임을 제거한다.

**Architecture:** 기존 `catalog-cache.ts`의 제네릭 `makeCache`를 재사용해 trimId 키 옵션 상세 캐시를 추가한다. `OptionPanel`은 동기 캐시 getter로 초기 state를 채워(캐시 hit이면 첫 페인트부터 리스트), 캐시 miss 시 트림 요약(`summary`)의 카운트로 탭 라벨·스켈레톤을 표시한다. 옵션 배지 hover 시 프리패치한다.

**Tech Stack:** React 19, TypeScript 6, Vitest + @testing-library/react, bun.

**Spec:** `ref/specs/2026-06-19-mc-master-option-panel-perf-design.md`

**참고 타입(기존, 변경 없음):**
- `CatalogOption = { id: number; type: OptionType; name: string; price: number | null }` (`client/src/lib/catalog.ts:178`)
- `OptionRelation = { optionId: number; relatedOptionId: number; type: "includes" | "excludes" }` (`:180`)
- `OptionsBundle = { options: CatalogOption[]; relations: OptionRelation[] }` (`:181`)
- `TrimOptionSummary = { trimId: number; basic: number; tuning: number; noOption: boolean }` (`:183`)
- `OptionType = "basic" | "tuning"` (`:177`)

---

## Task 1: catalog-cache에 trimId 단위 옵션 상세 캐시 추가

**Files:**
- Test: `client/src/pages/mc-master/catalog-cache.test.ts` (create)
- Modify: `client/src/pages/mc-master/catalog-cache.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/mc-master/catalog-cache.test.ts`:

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// apiFetch(@/lib/api)가 supabase.auth.getSession()을 호출하므로 supabase를 mock한다.
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { fetchOptionsCached, getCachedOptions, prefetchOptions } from "./catalog-cache";

const BUNDLE = {
  options: [{ id: 1, type: "basic", name: "파노라마 선루프", price: 1200000 }],
  relations: [],
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(BUNDLE), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.restoreAllMocks());

// 모듈 스코프 캐시라 테스트마다 고유 trimId로 격리한다.
it("첫 호출은 네트워크, 결과 반환 + 동기 캐시 채움", async () => {
  const trimId = 9001;
  expect(getCachedOptions(trimId)).toBeUndefined();
  const bundle = await fetchOptionsCached(trimId);
  expect(bundle.options[0].name).toBe("파노라마 선루프");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(getCachedOptions(trimId)?.options).toHaveLength(1);
});

it("두 번째 호출은 신선 캐시라 네트워크 생략", async () => {
  const trimId = 9002;
  await fetchOptionsCached(trimId);
  await fetchOptionsCached(trimId);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("force는 다시 네트워크", async () => {
  const trimId = 9003;
  await fetchOptionsCached(trimId);
  await fetchOptionsCached(trimId, { force: true });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("prefetchOptions는 캐시를 채운다", async () => {
  const trimId = 9004;
  prefetchOptions(trimId);
  // prefetch는 fire-and-forget이라 마이크로태스크가 끝날 때까지 대기
  await vi.waitFor(() => expect(getCachedOptions(trimId)).toBeDefined());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:unit client/src/pages/mc-master/catalog-cache.test.ts`
Expected: FAIL — `fetchOptionsCached`/`getCachedOptions`/`prefetchOptions`가 export되지 않음.

- [ ] **Step 3: Implement the cache**

In `client/src/pages/mc-master/catalog-cache.ts`, add `OptionsBundle` and `fetchOptions` to the existing import from `@/lib/catalog` (the import block at the top — add the two names alongside the existing ones):

```ts
import {
  type CatalogBrand,
  type CatalogModel,
  type CatalogTrim,
  type OptionsBundle,
  type TrimColor,
  type TrimOptionSummary,
  fetchBrands,
  fetchModels,
  fetchOptionSummary,
  fetchOptions,
  fetchTrimColors,
  fetchTrims,
} from "@/lib/catalog";
```

Then, directly after the `prefetchTrims` function (around `:107`, before `prefetchCatalog`), add:

```ts
// ── 트림별 옵션 상세(options + relations) ────────────────────────────────────────
// 옵션 패널 전용. 모델 단위 optionSummary(배지)와 별개로 trimId 키 캐시 — 패널은 열 때마다
// fetchOptions를 직접 쳐서 prod에서 클릭마다 왕복이었다. 캐시+hover 프리패치로 즉시 표시.
const optionsCache = makeCache<OptionsBundle>(fetchOptions);

// 동기 getter — OptionPanel이 마운트 첫 페인트에 캐시값으로 리스트를 즉시 그린다(왕복 0).
export const getCachedOptions = (trimId: number): OptionsBundle | undefined => optionsCache.get(trimId);
export const fetchOptionsCached = (trimId: number, opts?: { force?: boolean }): Promise<OptionsBundle> =>
  optionsCache.load(trimId, opts);

// 옵션 배지 hover 시 프리패치 → 클릭 즉시 캐시 hit.
export function prefetchOptions(trimId: number): void {
  void optionsCache.load(trimId).catch(() => undefined);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:unit client/src/pages/mc-master/catalog-cache.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
Expected: 0 errors

```bash
git add client/src/pages/mc-master/catalog-cache.ts client/src/pages/mc-master/catalog-cache.test.ts
git commit -m "perf(mc-master): 트림 단위 옵션 상세 캐시 추가 (catalog-cache)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 옵션 배지 hover 프리패치 배선

**Files:**
- Test: `client/src/pages/mc-master/trim-cells.test.tsx` (create)
- Modify: `client/src/pages/mc-master/trim-cells.tsx:52-75` (`OptionBadgeButton`)
- Modify: `client/src/pages/mc-master/GroupedTrimTable.tsx`
- Modify: `client/src/pages/mc-master/TrimTable.tsx`
- Modify: `client/src/pages/MCMasterPage.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/mc-master/trim-cells.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { OptionBadgeButton } from "./trim-cells";

it("배지 hover 시 onPrefetch 호출", async () => {
  const user = userEvent.setup();
  const onPrefetch = vi.fn();
  render(<OptionBadgeButton summary={undefined} onClick={() => {}} onPrefetch={onPrefetch} />);
  await user.hover(screen.getByRole("button"));
  expect(onPrefetch).toHaveBeenCalledTimes(1);
});

it("onPrefetch 없이도 렌더된다(옵션 prop)", () => {
  render(<OptionBadgeButton summary={undefined} onClick={() => {}} />);
  expect(screen.getByRole("button")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:unit client/src/pages/mc-master/trim-cells.test.tsx`
Expected: FAIL — `OptionBadgeButton`이 `onPrefetch` prop을 받지 않음(타입 에러 또는 호출 안 됨).

- [ ] **Step 3: Add `onPrefetch` to OptionBadgeButton**

In `client/src/pages/mc-master/trim-cells.tsx`, replace the `OptionBadgeButton` function (`:52-75`) with:

```tsx
// 트림 행 옵션 배지 버튼(클릭 → 옵션 패널). summary 없으면 '미정'. hover 시 옵션 상세 프리패치.
export function OptionBadgeButton({
  summary,
  onClick,
  onPrefetch,
}: {
  summary: TrimOptionSummary | undefined;
  onClick: () => void;
  onPrefetch?: () => void;
}) {
  const basic = summary?.basic ?? 0;
  const tuning = summary?.tuning ?? 0;
  const state = optionBadgeState(basic, tuning, summary?.noOption ?? false);
  const label =
    state === "has"
      ? `옵션 관리 (기본 ${basic} · 튜닝 ${tuning})`
      : state === "confirmed-none"
        ? "옵션 없음 확정"
        : "옵션 미입력";
  const text = state === "has" ? String(basic + tuning) : state === "confirmed-none" ? "✓" : "?";
  return (
    <button
      type="button"
      className="tiny-btn va-option-btn"
      onClick={onClick}
      onMouseEnter={() => onPrefetch?.()}
      onFocus={() => onPrefetch?.()}
      aria-label={label}
      title={label}
    >
      <ListChecks size={14} />
      <span className={`va-option-badge va-option-${state}`}>{text}</span>
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:unit client/src/pages/mc-master/trim-cells.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Thread `onPrefetchOptions` through GroupedTrimTable**

In `client/src/pages/mc-master/GroupedTrimTable.tsx`, add the prop to the destructured params and its type (after `onOpenOptions`):

```tsx
  onEdit,
  onOpenOptions,
  onPrefetchOptions,
}: {
  trims: CatalogTrim[];
  canEdit: boolean;
  colorsByTrim: Map<number, TrimColor[]>;
  optionByTrim: Map<number, TrimOptionSummary>;
  expanded: Set<string>;
  onToggleGroup: (key: string) => void;
  onEdit: (t: CatalogTrim) => void;
  onOpenOptions: (t: CatalogTrim) => void;
  onPrefetchOptions: (trimId: number) => void;
}) {
```

And update the `OptionBadgeButton` usage (`:74`):

```tsx
                      <OptionBadgeButton
                        summary={optionByTrim.get(t.id)}
                        onClick={() => onOpenOptions(t)}
                        onPrefetch={() => onPrefetchOptions(t.id)}
                      />
```

- [ ] **Step 6: Thread `onPrefetchOptions` through TrimTable**

In `client/src/pages/mc-master/TrimTable.tsx`, add the prop to the destructured params and its type (after `onOpenOptions`):

```tsx
  onEdit,
  onOpenOptions,
  onPrefetchOptions,
  onToggle,
```

In the type block (after `onOpenOptions: (t: CatalogTrim) => void;`):

```tsx
  onOpenOptions: (t: CatalogTrim) => void;
  onPrefetchOptions: (trimId: number) => void;
```

And update the `OptionBadgeButton` usage (`:79`):

```tsx
                <OptionBadgeButton
                  summary={optionByTrim.get(t.id)}
                  onClick={() => onOpenOptions(t)}
                  onPrefetch={() => onPrefetchOptions(t.id)}
                />
```

- [ ] **Step 7: Wire `prefetchOptions` in MCMasterPage**

In `client/src/pages/MCMasterPage.tsx`, add `prefetchOptions` to the existing import from `./mc-master/catalog-cache` (find the import line with `prefetchTrims`/`prefetchCatalog` and add `prefetchOptions`).

Then pass it to both tables. `GroupedTrimTable` (after `onOpenOptions={setOptionPanelTrim}` at `:348`):

```tsx
                  onOpenOptions={setOptionPanelTrim}
                  onPrefetchOptions={prefetchOptions}
```

`TrimTable` (after `onOpenOptions={setOptionPanelTrim}` at `:364`):

```tsx
                  onOpenOptions={setOptionPanelTrim}
                  onPrefetchOptions={prefetchOptions}
```

- [ ] **Step 8: Run full unit suite + typecheck**

Run: `bun run typecheck`
Expected: 0 errors

Run: `bun run test:unit`
Expected: PASS (existing + new tests)

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/mc-master/trim-cells.tsx client/src/pages/mc-master/trim-cells.test.tsx client/src/pages/mc-master/GroupedTrimTable.tsx client/src/pages/mc-master/TrimTable.tsx client/src/pages/MCMasterPage.tsx
git commit -m "perf(mc-master): 옵션 배지 hover 프리패치 배선

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: OptionPanel 캐시 초기값 + 카운트 주입 + 스켈레톤 + 「옵션 없음 확정」 번쩍임 제거

**Files:**
- Test: `client/src/pages/mc-master/OptionPanel.test.tsx` (create)
- Modify: `client/src/pages/mc-master/OptionPanel.tsx`
- Modify: `client/src/pages/MCMasterPage.tsx:423-431` (OptionPanel 렌더)
- Modify: `client/src/index.css` (스켈레톤 스타일)

**Prop 변경:** `OptionPanel`의 `initialNoOption: boolean` prop을 `summary: TrimOptionSummary | undefined`로 교체한다(요약에 `noOption`·`basic`·`tuning`이 모두 있어 noOption 초기값과 카운트 주입을 한 prop으로 처리).

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/mc-master/OptionPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { fetchOptionsCached } from "./catalog-cache";
import { OptionPanel } from "./OptionPanel";

const TRIM = {
  id: 8000,
  name: "캐스퍼 1.0",
  trimName: "캐스퍼 1.0",
  canonicalName: null,
  price: 15000000,
  modelYear: 2026,
  fuelType: "가솔린",
  driveSystem: "FWD",
  displacementCc: 998,
  transmissionType: "A/T",
  bodyStyle: null,
  seatingCapacity: 4,
  status: "판매중",
  mcCode: null,
  sortOrder: 1,
};

afterEach(() => vi.restoreAllMocks());

it("캐시 hit: 첫 렌더부터 옵션 리스트(비동기 대기 없이)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ options: [{ id: 1, type: "basic", name: "파노라마 선루프", price: 1200000 }], relations: [] }), {
        status: 200,
      }),
    ),
  );
  await fetchOptionsCached(TRIM.id); // 모듈 캐시 채움
  render(
    <OptionPanel
      trim={TRIM}
      canEdit
      summary={{ trimId: TRIM.id, basic: 1, tuning: 0, noOption: false }}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(screen.getByText("파노라마 선루프")).toBeInTheDocument(); // findBy 아님 — 캐시라 동기
});

it("캐시 miss 로딩 중: summary 카운트로 탭 라벨, 「옵션 없음 확정」 미표시", () => {
  // never-resolve fetch로 loaded=false 상태를 고정
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  render(
    <OptionPanel
      trim={{ ...TRIM, id: 8001 }}
      canEdit
      summary={{ trimId: 8001, basic: 3, tuning: 2, noOption: false }}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: /기본 옵션 \(3\)/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /튜닝 옵션 \(2\)/ })).toBeInTheDocument();
  // :265 보강 — 로딩 중에는 「옵션 없음으로 확정」 토글이 보이면 안 된다
  expect(screen.queryByRole("button", { name: /옵션 없음으로 확정/ })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:unit client/src/pages/mc-master/OptionPanel.test.tsx`
Expected: FAIL — `OptionPanel`이 `summary` prop을 받지 않고, 캐시 hit 시 첫 렌더에 옵션이 없으며, 로딩 중 「옵션 없음 확정」이 표시됨.

- [ ] **Step 3: Update OptionPanel imports**

In `client/src/pages/mc-master/OptionPanel.tsx`, update the `@/lib/catalog` import: remove `fetchOptions`, add `type TrimOptionSummary`. The block (`:4-15`) becomes:

```tsx
import {
  type CatalogOption,
  type CatalogTrim,
  type OptionRelation,
  type OptionType,
  type TrimOptionSummary,
  createOption,
  deleteOption,
  setNoOption,
  unsetNoOption,
  updateOption,
} from "@/lib/catalog";
import { excludeGroups } from "@/lib/option-selection";
import { fetchOptionsCached, getCachedOptions } from "./catalog-cache";
import { EditDrawer } from "./EditDrawer";
import { EXCLUDE_PALETTE, excludesText, includesText } from "./option-relations";
import { formatThousands, manwonText, parseManwon } from "./trim-format";
```

- [ ] **Step 4: Change props + cache-seeded state**

Replace the function signature and state block (`:23-46`) with:

```tsx
export function OptionPanel({
  trim,
  canEdit,
  summary,
  onClose,
  onChanged,
}: {
  trim: CatalogTrim;
  canEdit: boolean;
  summary: TrimOptionSummary | undefined;
  onClose: () => void;
  onChanged: () => void;
}) {
  const cached = getCachedOptions(trim.id);
  const [options, setOptions] = useState<CatalogOption[]>(cached?.options ?? []);
  const [relations, setRelations] = useState<OptionRelation[]>(cached?.relations ?? []);
  const [loaded, setLoaded] = useState(cached != null);
  const [tab, setTab] = useState<OptionType>("basic");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [noOption, setNoOptionState] = useState(summary?.noOption ?? false);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
```

- [ ] **Step 5: Use cached fetch in useEffect + reload**

Replace the `useEffect` (`:48-63`) `fetchOptions(trim.id)` call with `fetchOptionsCached(trim.id)`:

```tsx
  useEffect(() => {
    let alive = true;
    fetchOptionsCached(trim.id)
      .then((b) => {
        if (!alive) return;
        setOptions(b.options);
        setRelations(b.relations);
        setLoaded(true);
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : "불러오기 실패");
      });
    return () => {
      alive = false;
    };
  }, [trim.id]);
```

Replace `reload` (`:79-86`) to force-refresh the cache after edits:

```tsx
  function reload() {
    fetchOptionsCached(trim.id, { force: true })
      .then((b) => {
        setOptions(b.options);
        setRelations(b.relations);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "불러오기 실패"));
  }
```

- [ ] **Step 6: Inject counts into tab labels**

After the `current` derivation (`:65-67`), add count vars:

```tsx
  const basic = options.filter((o) => o.type === "basic");
  const tuning = options.filter((o) => o.type === "tuning");
  const current = tab === "basic" ? basic : tuning;
  // 로딩 중(캐시 miss)에는 트림 요약 카운트로 탭 라벨을 채워 '(0)' 깜빡임을 막는다.
  const basicCount = loaded ? basic.length : (summary?.basic ?? basic.length);
  const tuningCount = loaded ? tuning.length : (summary?.tuning ?? tuning.length);
```

Update the two tab button labels (`:178`, `:188`):

```tsx
          기본 옵션 ({basicCount})
```
```tsx
          튜닝 옵션 ({tuningCount})
```

- [ ] **Step 7: Add list skeleton + guard the "no option" box**

Replace the empty-state line (`:201`) and the start of the list with a skeleton for the loading state:

```tsx
      {loaded && current.length === 0 && <div className="va-empty">옵션이 없습니다.</div>}

      {!loaded && current.length === 0 && (
        <ul className="va-opt-list" aria-hidden="true">
          {Array.from({ length: Math.max(1, tab === "basic" ? (summary?.basic ?? 2) : (summary?.tuning ?? 2)) }).map(
            (_, i) => (
              <li key={i} className="va-opt-row va-opt-skeleton">
                <span className="va-skel-bar" />
              </li>
            ),
          )}
        </ul>
      )}
```

Guard the "옵션 없음으로 확정" block (`:265`) so it only appears after load completes:

```tsx
      {canEdit && loaded && options.length === 0 && (
```

- [ ] **Step 8: Update MCMasterPage OptionPanel render (summary prop + key)**

In `client/src/pages/MCMasterPage.tsx`, replace the OptionPanel block (`:423-431`) with:

```tsx
      {optionPanelTrim && (
        <OptionPanel
          key={optionPanelTrim.id}
          trim={optionPanelTrim}
          canEdit={canEdit}
          summary={optionByTrim.get(optionPanelTrim.id)}
          onClose={() => setOptionPanelTrim(null)}
          onChanged={reloadOptionSummary}
        />
      )}
```

- [ ] **Step 9: Add skeleton CSS**

In `client/src/index.css`, add near the other `.va-opt-*` rules:

```css
.va-opt-skeleton {
  pointer-events: none;
}
.va-opt-skeleton .va-skel-bar {
  display: block;
  height: 14px;
  width: 60%;
  border-radius: 4px;
  background: linear-gradient(90deg, #efefee 25%, #f6f6f5 37%, #efefee 63%);
  background-size: 400% 100%;
  animation: va-skel-pulse 1.2s ease-in-out infinite;
}
@keyframes va-skel-pulse {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
}
```

- [ ] **Step 10: Run tests + typecheck**

Run: `bun run test:unit client/src/pages/mc-master/OptionPanel.test.tsx`
Expected: PASS (2 tests)

Run: `bun run typecheck`
Expected: 0 errors

- [ ] **Step 11: Commit**

```bash
git add client/src/pages/mc-master/OptionPanel.tsx client/src/pages/mc-master/OptionPanel.test.tsx client/src/pages/MCMasterPage.tsx client/src/index.css
git commit -m "fix(mc-master): 옵션 패널 캐시 초기값+카운트 주입+스켈레톤 (번쩍임 제거)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 전체 검증

**Files:** none (verification only)

- [ ] **Step 1: 4종 검증**

Run: `bun run typecheck`
Expected: 0 errors

Run: `bun run lint`
Expected: 0 problems

Run: `bun run test:unit`
Expected: PASS — 기존 + 신규(catalog-cache 4, trim-cells 2, OptionPanel 2)

Run: `bun run build`
Expected: OK

- [ ] **Step 2: 수동 시각 확인 (안내)**

헤드리스 e2e는 JWKS 로그인 세션이 필요하므로 시각 확인은 수동이다. 로그인 후 `bun run dev`(또는 배포본)에서:
- 국산차 브랜드 → 모델 → 트림 뷰의 옵션 배지 클릭 시 패널이 즉시 리스트로 뜨는지(빈 패널/「옵션 없음 확정」 번쩍임 없음).
- 같은 트림 재열람·배지 hover 후 클릭이 즉시인지(캐시 hit).
- 옵션 추가/삭제 후 패널·트림 행 배지가 즉시 갱신되는지(force 정합성).

- [ ] **Step 3: PR 생성**

```bash
git push -u origin perf/mc-master-option-panel-cache
gh pr create --title "perf(mc-master): 옵션 패널 캐시 + 번쩍임 제거" --body "$(cat <<'EOF'
## 요약
국산차 트림 옵션 패널이 #48~#50 캐시 최적화의 사각지대였음 — 열 때마다 `fetchOptions`를 캐시 없이 직접 호출해 prod에서 클릭마다 CF→Hyperdrive→DB 왕복, 로딩 인디케이터가 없어 빈 패널/「옵션 없음 확정」 박스가 번쩍였다.

## 변경
- **B1** `catalog-cache.ts`: trimId 키 옵션 상세 캐시(`makeCache` 재사용) + `getCachedOptions`/`fetchOptionsCached`/`prefetchOptions`
- **A** `OptionPanel`: 캐시 동기 초기값(캐시 hit이면 첫 페인트부터 리스트), `summary` 카운트 주입으로 탭 `(0)` 깜빡임 제거, 리스트 스켈레톤, 「옵션 없음 확정」을 `loaded` 후로 가드, `key={trim.id}` 재마운트
- 옵션 배지 hover→`prefetchOptions` 프리패치(모델 hover 패턴과 동일)
- 편집 후 `reload(force)` + `onChanged`(요약 force)로 상세·요약 캐시 동시 갱신

## 검증
typecheck 0 · lint 0 · test:unit(신규 8) · build OK. 시각은 수동(로그인 필요).

설계: `ref/specs/2026-06-19-mc-master-option-panel-perf-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review 결과

- **Spec coverage:** B1 캐시(Task 1) · 캐시 초기값/카운트/스켈레톤/`:265`(Task 3) · hover 프리패치(Task 2) · 무효화 force(Task 3 Step 5) · key 재마운트(Task 3 Step 8) — 모두 태스크 매핑됨. spec의 `initialNoOption`+`initialCounts`는 `summary` 단일 prop으로 통합(상단 명시).
- **Placeholder scan:** 없음 — 모든 코드 블록이 실제 코드.
- **Type consistency:** `fetchOptionsCached`/`getCachedOptions`/`prefetchOptions` 시그니처가 Task 1 정의와 Task 2·3 사용처에서 일치. `summary: TrimOptionSummary | undefined`가 OptionPanel(Task 3)·MCMasterPage(Task 3 Step 8)에서 일치. `onPrefetchOptions: (trimId: number) => void`가 테이블(Task 2 Step 5·6)·MCMasterPage(Step 7)에서 일치.
