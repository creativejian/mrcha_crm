# 옵션 excludes 비활성화 UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 옵션 excludes 관계를 "자동 해제"에서 미스터차 앱식 "비활성화 + 색 그룹 + 설명"으로 바꾼다.

**Architecture:** 관계 강제 로직을 순수 함수로 확장(TDD) — `resolveSelection`에서 excludes 자동해제를 빼고, `disabledOptionIds`/`excludeGroups`/`excludePartners`를 추가. `OptionPicker`는 그 결과로 색 점·비활성화·설명 텍스트·상단 안내를 렌더.

**Tech Stack:** React + TypeScript, vitest + @testing-library.

**Spec:** `ref/specs/2026-06-15-quote-option-exclude-ux-design.md`

---

## File Structure

- **Modify** `client/src/lib/option-selection.ts` — `resolveSelection` 수정 + `disabledOptionIds`/`excludeGroups`/`excludePartners` 추가.
- **Modify** `client/src/lib/option-selection.test.ts` — excludes 자동해제 테스트 교체 + 신규 함수 테스트.
- **Modify** `client/src/components/OptionPicker.tsx` — 색 점/비활성화/설명/상단 안내.
- **Modify** `client/src/components/OptionPicker.test.tsx` — 자동해제 테스트를 비활성화로 교체 + 설명 표시 테스트.
- **Modify** `client/src/index.css` — 색 점/disabled/설명/안내 스타일.

검증: `bun run typecheck` · `bun run lint` · `bunx vitest run client/src/lib/option-selection.test.ts client/src/components/OptionPicker.test.tsx`

---

## Task 1: 순수 로직 확장 (option-selection)

**Files:**
- Modify: `client/src/lib/option-selection.ts`
- Test: `client/src/lib/option-selection.test.ts`

- [ ] **Step 1: 테스트 교체/추가**

`client/src/lib/option-selection.test.ts`에서 import 줄을 교체:

```ts
import {
  disabledOptionIds,
  excludeGroups,
  excludePartners,
  optionTotal,
  resolveSelection,
  type OptionLite,
  type OptionRelation,
} from "./option-selection";
```

기존 `it("excludes: 켤 때 배타 옵션 자동 해제 (대칭)", ...)` 블록을 아래로 **교체**(자동해제 제거 검증):

```ts
  it("excludes는 resolveSelection에서 처리하지 않는다(비활성화로 대체)", () => {
    const rels: OptionRelation[] = [{ optionId: 2, relatedOptionId: 3, type: "excludes" }];
    // 충돌은 UI 비활성화로 막으므로 resolveSelection은 자동해제하지 않는다
    expect([...resolveSelection(rels, new Set([2]), 3, true)].sort()).toEqual([2, 3]);
  });
```

그리고 `describe("optionTotal", ...)` 블록 **뒤**에 신규 describe들을 추가:

```ts
describe("disabledOptionIds", () => {
  const rels: OptionRelation[] = [{ optionId: 2, relatedOptionId: 3, type: "excludes" }];
  it("선택된 옵션의 배타 상대가 비활성화 (대칭)", () => {
    expect([...disabledOptionIds(rels, new Set([2]))]).toEqual([3]);
    expect([...disabledOptionIds(rels, new Set([3]))]).toEqual([2]);
  });
  it("둘 다 미선택이면 비활성화 없음", () => {
    expect([...disabledOptionIds(rels, new Set())]).toEqual([]);
  });
});

describe("excludeGroups", () => {
  const options: OptionLite[] = [
    { id: 1, type: "basic", price: null },
    { id: 2, type: "tuning", price: 100 },
    { id: 3, type: "tuning", price: 200 },
    { id: 4, type: "tuning", price: 300 },
    { id: 5, type: "tuning", price: 400 },
  ];
  it("같은 배타군은 같은 그룹번호, 무관 옵션은 맵에 없음", () => {
    const rels: OptionRelation[] = [
      { optionId: 2, relatedOptionId: 3, type: "excludes" },
      { optionId: 4, relatedOptionId: 5, type: "excludes" },
    ];
    const g = excludeGroups(options, rels);
    expect(g.get(2)).toBe(g.get(3));
    expect(g.get(4)).toBe(g.get(5));
    expect(g.get(2)).not.toBe(g.get(4));
    expect(g.has(1)).toBe(false);
    expect(g.get(2)).toBe(0);
    expect(g.get(4)).toBe(1);
  });
  it("연쇄 배타(1-2, 2-3)는 한 그룹", () => {
    const rels: OptionRelation[] = [
      { optionId: 2, relatedOptionId: 3, type: "excludes" },
      { optionId: 3, relatedOptionId: 4, type: "excludes" },
    ];
    const g = excludeGroups(options, rels);
    expect(g.get(2)).toBe(g.get(3));
    expect(g.get(3)).toBe(g.get(4));
  });
});

describe("excludePartners", () => {
  it("배타 상대 목록 (대칭, includes 제외)", () => {
    const rels: OptionRelation[] = [
      { optionId: 2, relatedOptionId: 3, type: "excludes" },
      { optionId: 2, relatedOptionId: 4, type: "excludes" },
      { optionId: 5, relatedOptionId: 6, type: "includes" },
    ];
    expect(excludePartners(rels, 2).sort()).toEqual([3, 4]);
    expect(excludePartners(rels, 3)).toEqual([2]);
    expect(excludePartners(rels, 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run client/src/lib/option-selection.test.ts`
Expected: FAIL — `disabledOptionIds`/`excludeGroups`/`excludePartners` not exported, 그리고 교체한 resolveSelection 테스트도 현 구현(자동해제)에서 `[2,3]`이 아닌 `[3]`이라 실패.

- [ ] **Step 3: 구현 수정/추가**

`client/src/lib/option-selection.ts`에서 `resolveSelection`의 excludes 블록(주석 `// excludes: 대칭으로 배타 옵션 제거`와 그 for 루프)을 **삭제**해 아래 형태로 만든다:

```ts
export function resolveSelection(
  relations: OptionRelation[],
  selected: ReadonlySet<number>,
  toggledId: number,
  on: boolean,
): Set<number> {
  const next = new Set(selected);
  if (!on) {
    next.delete(toggledId);
    return next;
  }
  next.add(toggledId);
  // includes: 단방향, 한 단계만 추가 (excludes는 UI 비활성화로 처리)
  for (const rel of relations) {
    if (rel.type === "includes" && rel.optionId === toggledId) next.add(rel.relatedOptionId);
  }
  return next;
}
```

그리고 `optionTotal` 함수 **뒤**에 신규 함수 3개를 추가:

```ts
// 선택된 옵션과 excludes 관계인(아직 선택 안 된) 옵션 = 비활성화 대상. 대칭.
export function disabledOptionIds(relations: OptionRelation[], selectedIds: ReadonlySet<number>): Set<number> {
  const disabled = new Set<number>();
  for (const rel of relations) {
    if (rel.type !== "excludes") continue;
    if (selectedIds.has(rel.optionId) && !selectedIds.has(rel.relatedOptionId)) disabled.add(rel.relatedOptionId);
    if (selectedIds.has(rel.relatedOptionId) && !selectedIds.has(rel.optionId)) disabled.add(rel.optionId);
  }
  return disabled;
}

// excludes를 무방향 그래프로 보고 connected component로 묶어 optionId→그룹번호.
// 그룹번호는 options 순서 기준 0,1,2… 안정 부여. excludes 미참여 옵션은 맵에 없음.
export function excludeGroups(options: OptionLite[], relations: OptionRelation[]): Map<number, number> {
  const parent = new Map<number, number>();
  function find(x: number): number {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  }
  for (const rel of relations) {
    if (rel.type !== "excludes") continue;
    if (!parent.has(rel.optionId)) parent.set(rel.optionId, rel.optionId);
    if (!parent.has(rel.relatedOptionId)) parent.set(rel.relatedOptionId, rel.relatedOptionId);
    parent.set(find(rel.optionId), find(rel.relatedOptionId));
  }
  const rootToIdx = new Map<number, number>();
  const result = new Map<number, number>();
  for (const o of options) {
    if (!parent.has(o.id)) continue;
    const root = find(o.id);
    if (!rootToIdx.has(root)) rootToIdx.set(root, rootToIdx.size);
    result.set(o.id, rootToIdx.get(root)!);
  }
  return result;
}

// optionId와 excludes 관계인 상대 id들(대칭, 중복 제거).
export function excludePartners(relations: OptionRelation[], optionId: number): number[] {
  const partners = new Set<number>();
  for (const rel of relations) {
    if (rel.type !== "excludes") continue;
    if (rel.optionId === optionId) partners.add(rel.relatedOptionId);
    else if (rel.relatedOptionId === optionId) partners.add(rel.optionId);
  }
  return [...partners];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run client/src/lib/option-selection.test.ts`
Expected: PASS (resolveSelection·optionTotal·disabledOptionIds·excludeGroups·excludePartners).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/option-selection.ts client/src/lib/option-selection.test.ts
git commit -m "feat: 옵션 excludes 비활성화 로직(disabledOptionIds/excludeGroups/excludePartners)"
```

---

## Task 2: OptionPicker 색 점/비활성화/설명 + CSS

**Files:**
- Modify: `client/src/components/OptionPicker.tsx`
- Modify: `client/src/components/OptionPicker.test.tsx`
- Modify: `client/src/index.css`

- [ ] **Step 1: 테스트 교체/추가**

`client/src/components/OptionPicker.test.tsx`에서 기존 `it("excludes 토글 시 상대 자동 해제", ...)` 블록을 아래로 **교체**:

```tsx
  it("excludes 옵션 선택 시 배타 상대가 비활성화", async () => {
    const user = userEvent.setup();
    render(
      <OptionPicker options={options} relations={[{ id: 1, optionId: 2, relatedOptionId: 3, type: "excludes" }]} />,
    );
    await user.click(screen.getByRole("button", { name: /옵션/ }));
    await user.click(screen.getByRole("checkbox", { name: /선루프/ })); // 2 on
    expect(screen.getByRole("checkbox", { name: /고급 시트/ })).toBeDisabled(); // 3 비활성화
  });

  it("배타 옵션에 중복 선택 불가 설명을 표시", async () => {
    const user = userEvent.setup();
    render(
      <OptionPicker options={options} relations={[{ id: 1, optionId: 2, relatedOptionId: 3, type: "excludes" }]} />,
    );
    await user.click(screen.getByRole("button", { name: /옵션/ }));
    expect(screen.getAllByText(/중복 선택 불가/).length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run client/src/components/OptionPicker.test.tsx`
Expected: FAIL — 현 구현은 자동해제(상대가 disabled 아님)·설명 텍스트 없음.

- [ ] **Step 3: OptionPicker 구현 수정**

`client/src/components/OptionPicker.tsx`의 import 줄을 교체:

```ts
import { disabledOptionIds, excludeGroups, excludePartners, optionTotal, resolveSelection } from "@/lib/option-selection";
```

`const selectedCount = ...` 줄 **뒤**에 파생 계산을 추가:

```ts
  const disabled = disabledOptionIds(relations, selectedIds);
  const groups = excludeGroups(options, relations);
  const nameById = new Map(options.map((o) => [o.id, o.name] as const));
  const hasExcludeGroups = groups.size > 0;
```

`renderOption` 함수를 아래로 **교체**(색 점·disabled·설명):

```tsx
  function renderOption(o: TrimOption) {
    const group = groups.get(o.id);
    const partners = excludePartners(relations, o.id);
    return (
      <div key={o.id} className="kim-option-picker-row-wrap">
        <button
          className={`kim-option-picker-option${selectedIds.has(o.id) ? " is-selected" : ""}`}
          type="button"
          role="checkbox"
          aria-checked={selectedIds.has(o.id)}
          disabled={disabled.has(o.id)}
          onClick={() => toggle(o.id)}
        >
          {group !== undefined ? <span className={`kim-option-picker-dot kim-option-picker-dot--${group % 6}`} /> : null}
          <span className="kim-option-picker-name">{o.name}</span>
          <em>+{formatMoney(o.price ?? 0)}원</em>
        </button>
        {partners.length ? (
          <span className="kim-option-picker-relation">
            ⇄ {partners.map((id) => nameById.get(id)).filter(Boolean).join(", ")}와 중복 선택 불가
          </span>
        ) : null}
      </div>
    );
  }
```

그리고 `<div className="kim-option-picker-menu">` 여는 태그 **바로 다음 줄**에 상단 안내를 추가:

```tsx
          {hasExcludeGroups ? (
            <div className="kim-option-picker-hint">
              <span className="kim-option-picker-dot kim-option-picker-dot--0" />
              <span className="kim-option-picker-dot kim-option-picker-dot--1" />
              <span className="kim-option-picker-dot kim-option-picker-dot--2" />
              같은 색 = 중복 선택 불가
            </div>
          ) : null}
```

- [ ] **Step 4: CSS 추가**

`client/src/index.css`의 `.kim-option-picker-option em { ... }` 블록 **뒤**(즉 `.kim-option-picker-msg` 앞)에 추가하고, 색 점 정렬을 위해 옵션 row에 name 규칙을 더한다:

```css
.kim-option-picker-name {
  flex: 1 1 auto;
  min-width: 0;
}
.kim-option-picker-option:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.kim-option-picker-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.kim-option-picker-dot--0 { background: #e5484d; }
.kim-option-picker-dot--1 { background: #3b82f6; }
.kim-option-picker-dot--2 { background: #22a06b; }
.kim-option-picker-dot--3 { background: #f5a524; }
.kim-option-picker-dot--4 { background: #8b5cf6; }
.kim-option-picker-dot--5 { background: #06b6d4; }
.kim-option-picker-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px 8px;
  font-size: 11px;
  color: #9298a0;
}
.kim-option-picker-relation {
  display: block;
  padding: 0 10px 6px 22px;
  font-size: 11px;
  color: #9298a0;
  line-height: 1.4;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run client/src/components/OptionPicker.test.tsx`
Expected: PASS.

- [ ] **Step 6: typecheck / lint / 전체 단위테스트 / build**

Run: `bun run typecheck` (0) · `bun run lint` (0) · `bun run test:unit` (전부 PASS) · `bun run build` (성공)

- [ ] **Step 7: 수동 확인(권장)**

dev에서 G70 등 배타관계 트림 선택 → 옵션 드롭다운에 색 점·상단 안내·"⇄ …중복 선택 불가" 설명이 보이고, 외장컬러 하나 선택 시 같은 색 나머지가 회색 비활성화되는지, 풀면 다시 활성화되는지 확인.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/OptionPicker.tsx client/src/components/OptionPicker.test.tsx client/src/index.css
git commit -m "feat: 옵션 excludes 비활성화 UX(색 그룹·설명·상단 안내)"
```

---

## Self-Review 결과

- **Spec coverage**: ① resolveSelection 변경+3함수=Task 1, ② OptionPicker 색점/비활성화/설명/안내=Task 2 Step 3, ③ 색 팔레트=Task 2 Step 4 CSS, ④ CSS=Task 2 Step 4, ⑤ 테스트=Task 1·2. includes 유지(resolveSelection includes 블록 보존). 일치.
- **Placeholder scan**: 모든 step에 실제 코드. TODO/TBD 없음.
- **Type consistency**: `disabledOptionIds`/`excludeGroups`/`excludePartners`(Task 1) 시그니처 ↔ Task 2 호출 일치. `OptionRelation`/`OptionLite`는 함수 인자 타입, OptionPicker는 `TrimOption`/`TrimOptionRelation`(구조 호환: id/optionId/relatedOptionId/type/price 포함)을 전달. `excludeGroups` 그룹번호 `% 6` ↔ CSS `--0`~`--5` 일치.
- **알려진 주의**: `renderOption`이 `<button>`에서 `<div>` wrapper로 바뀌므로 `basics.map(renderOption)`/`tunings.map(renderOption)`은 그대로 동작(각 요소 `key`는 wrapper div에 있음). 색 점 정렬은 `.kim-option-picker-name { flex:1 }`로 이름이 늘어나며 가격 `em`이 우측 유지.
