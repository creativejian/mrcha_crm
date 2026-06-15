# 견적 옵션 선택 → 옵션 금액 합산 (2단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적 workbench에서 트림의 tuning 옵션을 선택하면 그 금액이 가격 패널 `(+) 옵션 금액`에 반영되고, includes/excludes 관계가 강제된다.

**Architecture:** 관계 강제 연쇄는 순수 함수 lib로 분리(TDD), 옵션 선택 UI는 `OptionPicker` 독립 컴포넌트(React state). 가격 접점은 1단계 패턴 재사용 — 옵션 `total`만 `data-pricing="option"` input에 명령형 반영 후 기존 `recompute`로 합산.

**Tech Stack:** React + TypeScript, vitest + @testing-library(클라이언트), 기존 `fetchTrimDetail`(1단계).

**Spec:** `ref/specs/2026-06-15-quote-option-selection-design.md`

---

## File Structure

- **Create** `client/src/lib/option-selection.ts` — `resolveSelection`(관계 강제), `optionTotal`(합산). 순수·DOM 비의존.
- **Create** `client/src/lib/option-selection.test.ts` — 위 함수 단위테스트.
- **Create** `client/src/components/OptionPicker.tsx` — 다중선택 드롭다운(tuning 체크 + basic 표시), `onChange({selectedIds,total})`.
- **Create** `client/src/components/OptionPicker.test.tsx` — 컴포넌트 테스트.
- **Modify** `client/src/pages/CustomerDetailPage.tsx` — `TrimDetail` state 보관 + OptionPicker 연결.
- **Modify** `client/src/index.css` — 옵션 드롭다운/체크리스트 스타일.

검증 명령:
- 타입: `bun run typecheck`
- 린트: `bun run lint`
- 단위테스트: `bunx vitest run client/src/lib/option-selection.test.ts client/src/components/OptionPicker.test.tsx`

---

## Task 1: 관계 강제 순수 lib (option-selection)

**Files:**
- Create: `client/src/lib/option-selection.ts`
- Test: `client/src/lib/option-selection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/option-selection.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { optionTotal, resolveSelection, type OptionLite, type OptionRelation } from "./option-selection";

const opts: OptionLite[] = [
  { id: 1, type: "basic", price: null },
  { id: 2, type: "tuning", price: 1500000 },
  { id: 3, type: "tuning", price: 2000000 },
  { id: 4, type: "tuning", price: null },
];

describe("resolveSelection", () => {
  it("관계 없으면 단순 토글 on/off", () => {
    expect([...resolveSelection([], new Set(), 2, true)]).toEqual([2]);
    expect([...resolveSelection([], new Set([2, 3]), 2, false)]).toEqual([3]);
  });

  it("excludes: 켤 때 배타 옵션 자동 해제 (대칭)", () => {
    const rels: OptionRelation[] = [{ optionId: 2, relatedOptionId: 3, type: "excludes" }];
    // 데이터가 2→3 단방향이어도, 3을 켜면 2가 빠져야 한다
    expect([...resolveSelection(rels, new Set([2]), 3, true)]).toEqual([3]);
    expect([...resolveSelection(rels, new Set([3]), 2, true)]).toEqual([2]);
  });

  it("includes: 켤 때 포함 옵션 자동 추가 (단방향, 한 단계)", () => {
    const rels: OptionRelation[] = [
      { optionId: 2, relatedOptionId: 3, type: "includes" },
      { optionId: 3, relatedOptionId: 4, type: "includes" },
    ];
    // 2 켜면 3까지만(4는 연쇄 안 함)
    expect([...resolveSelection(rels, new Set(), 2, true)].sort()).toEqual([2, 3]);
  });

  it("끌 때는 연쇄 해제 안 함", () => {
    const rels: OptionRelation[] = [{ optionId: 2, relatedOptionId: 3, type: "includes" }];
    expect([...resolveSelection(rels, new Set([2, 3]), 2, false)]).toEqual([3]);
  });

  it("입력 Set을 변경하지 않는다", () => {
    const selected = new Set([2]);
    resolveSelection([], selected, 3, true);
    expect([...selected]).toEqual([2]);
  });
});

describe("optionTotal", () => {
  it("tuning만 합산, basic 제외, price null은 0", () => {
    expect(optionTotal(opts, new Set([1, 2, 4]))).toBe(1500000); // 1=basic 제외, 4=null→0
    expect(optionTotal(opts, new Set([2, 3]))).toBe(3500000);
    expect(optionTotal(opts, new Set())).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run client/src/lib/option-selection.test.ts`
Expected: FAIL — `Failed to resolve import "./option-selection"`.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/lib/option-selection.ts`:

```ts
// 옵션 선택 관계 강제(includes/excludes) + 합산. 순수 함수 — 단위 테스트 가능.
// 규칙: ref/specs/2026-06-15-quote-option-selection-design.md

export type OptionRelation = { optionId: number; relatedOptionId: number; type: "includes" | "excludes" };
export type OptionLite = { id: number; type: "basic" | "tuning"; price: number | null };

// toggledId를 on(true)/off(false)로 바꿨을 때 관계를 적용한 새 선택 집합을 반환(원본 불변).
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
  // excludes: 대칭으로 배타 옵션 제거
  for (const rel of relations) {
    if (rel.type !== "excludes") continue;
    if (rel.optionId === toggledId) next.delete(rel.relatedOptionId);
    else if (rel.relatedOptionId === toggledId) next.delete(rel.optionId);
  }
  // includes: 단방향, 한 단계만 추가 (excludes 뒤에 적용해 우선)
  for (const rel of relations) {
    if (rel.type === "includes" && rel.optionId === toggledId) next.add(rel.relatedOptionId);
  }
  return next;
}

// 선택된 옵션 중 tuning의 price 합(basic 제외, price null → 0).
export function optionTotal(options: OptionLite[], selectedIds: ReadonlySet<number>): number {
  return options
    .filter((o) => o.type === "tuning" && selectedIds.has(o.id))
    .reduce((sum, o) => sum + (o.price ?? 0), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run client/src/lib/option-selection.test.ts`
Expected: PASS (2 describe, 6 it).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/option-selection.ts client/src/lib/option-selection.test.ts
git commit -m "feat: 옵션 관계 강제 순수함수(option-selection) 추가"
```

---

## Task 2: OptionPicker 컴포넌트

**Files:**
- Create: `client/src/components/OptionPicker.tsx`
- Test: `client/src/components/OptionPicker.test.tsx`

> `TrimOption`/`TrimOptionRelation` 타입은 1단계에서 `client/src/lib/vehicles.ts`에 정의됨.

- [ ] **Step 1: Write the failing test**

Create `client/src/components/OptionPicker.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OptionPicker } from "./OptionPicker";

const options = [
  { id: 1, type: "basic" as const, name: "기본 사양 A", price: null },
  { id: 2, type: "tuning" as const, name: "선루프", price: 1500000 },
  { id: 3, type: "tuning" as const, name: "고급 시트", price: 2000000 },
];

describe("OptionPicker", () => {
  it("tuning 체크 시 onChange로 total 통지", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OptionPicker options={options} relations={[]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /옵션/ }));
    await user.click(screen.getByRole("checkbox", { name: /선루프/ }));
    expect(onChange).toHaveBeenCalledWith({ selectedIds: [2], total: 1500000 });
  });

  it("basic은 읽기전용 표시(체크박스 아님)", async () => {
    const user = userEvent.setup();
    render(<OptionPicker options={options} relations={[]} />);
    await user.click(screen.getByRole("button", { name: /옵션/ }));
    expect(screen.getByText("기본 사양 A")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /기본 사양 A/ })).toBeNull();
  });

  it("excludes 토글 시 상대 자동 해제", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <OptionPicker
        options={options}
        relations={[{ optionId: 2, relatedOptionId: 3, type: "excludes" }]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /옵션/ }));
    await user.click(screen.getByRole("checkbox", { name: /고급 시트/ })); // 3 on
    await user.click(screen.getByRole("checkbox", { name: /선루프/ })); // 2 on → 3 해제
    expect(onChange).toHaveBeenLastCalledWith({ selectedIds: [2], total: 1500000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run client/src/components/OptionPicker.test.tsx`
Expected: FAIL — `Failed to resolve import "./OptionPicker"`.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/components/OptionPicker.tsx`:

```tsx
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { optionTotal, resolveSelection } from "@/lib/option-selection";
import { formatMoney } from "@/lib/quote-pricing";
import type { TrimOption, TrimOptionRelation } from "@/lib/vehicles";

type OptionPickerProps = {
  options: TrimOption[];
  relations: TrimOptionRelation[];
  onChange?: (next: { selectedIds: number[]; total: number }) => void;
};

export function OptionPicker({ options, relations, onChange }: OptionPickerProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 트림(options 레퍼런스)이 바뀌면 선택 초기화
  useEffect(() => {
    setSelectedIds(new Set());
  }, [options]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const basics = options.filter((o) => o.type === "basic");
  const tunings = options.filter((o) => o.type === "tuning");
  const total = optionTotal(options, selectedIds);
  const tuningSelectedCount = tunings.filter((o) => selectedIds.has(o.id)).length;

  function toggle(id: number) {
    const next = resolveSelection(relations, selectedIds, id, !selectedIds.has(id));
    setSelectedIds(next);
    onChange?.({ selectedIds: [...next], total: optionTotal(options, next) });
  }

  return (
    <div className="kim-option-picker" ref={rootRef}>
      <button
        className="kim-jeff-picker-row"
        type="button"
        disabled={!options.length}
        onClick={() => setOpen(!open)}
      >
        <span>옵션</span>
        <b className={tuningSelectedCount ? "" : "muted"}>
          기본 {basics.length} · 추가 {tuningSelectedCount}
          {total > 0 ? ` · +${formatMoney(total)}원` : ""}
        </b>
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div className="kim-option-picker-menu">
          {basics.length ? (
            <div className="kim-option-picker-group">
              <span className="kim-option-picker-label">기본 포함</span>
              {basics.map((o) => (
                <div key={o.id} className="kim-option-picker-basic">
                  {o.name}
                </div>
              ))}
            </div>
          ) : null}
          {tunings.length ? (
            <div className="kim-option-picker-group">
              <span className="kim-option-picker-label">추가 옵션</span>
              {tunings.map((o) => (
                <button
                  key={o.id}
                  className={`kim-option-picker-option${selectedIds.has(o.id) ? " is-selected" : ""}`}
                  type="button"
                  role="checkbox"
                  aria-checked={selectedIds.has(o.id)}
                  onClick={() => toggle(o.id)}
                >
                  <span>{o.name}</span>
                  <em>+{formatMoney(o.price ?? 0)}원</em>
                </button>
              ))}
            </div>
          ) : null}
          {!basics.length && !tunings.length ? <span className="kim-option-picker-msg">옵션 없음</span> : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run client/src/components/OptionPicker.test.tsx`
Expected: PASS (3 it).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/OptionPicker.tsx client/src/components/OptionPicker.test.tsx
git commit -m "feat: 옵션 다중선택 OptionPicker 컴포넌트 추가"
```

---

## Task 3: CustomerDetailPage 연결 + CSS

거대 컴포넌트라 1단계와 동일하게 구현 + `typecheck`/`lint`/`test`/수동 확인으로 검증.

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`
- Modify: `client/src/index.css`

- [ ] **Step 1: import 추가**

`import { fetchTrimDetail } from "@/lib/vehicles";`(1단계에서 추가됨)를 타입 포함으로 교체:

```ts
import { fetchTrimDetail, type TrimDetail } from "@/lib/vehicles";
```

그리고 `OptionPicker` import 추가(다른 `@/components` import 근처 — 현재 `VehiclePicker` import 줄 아래):

```ts
import { OptionPicker } from "@/components/OptionPicker";
```

- [ ] **Step 2: trimDetail state 추가**

1단계에서 추가한 `pricingPanelRef` 선언 바로 뒤에 추가:

```ts
  const [trimDetail, setTrimDetail] = useState<TrimDetail | null>(null);
```

- [ ] **Step 3: 트림 선택 시 detail 보관 + 옵션 합산 핸들러**

`applyTrimToPricing` 안에서 `const detail = await fetchTrimDetail(trim.id);` 바로 다음 줄에 추가:

```ts
      setTrimDetail(detail);
```

그리고 `applyTrimToPricing` 함수 정의 **바로 뒤**에 옵션 합산 핸들러 추가:

```ts
  function applyOptionTotal(next: { selectedIds: number[]; total: number }) {
    const root = pricingPanelRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLInputElement>('input[data-pricing="option"]');
    if (el) el.value = formatMoney(next.total);
    recomputePricing();
    markQuoteDraftChanged();
  }
```

- [ ] **Step 4: 옵션 버튼을 OptionPicker로 교체**

🎨 옵션/컬러 섹션의 정적 "옵션" 버튼(현재 약 `4884`)을 교체. 외장/내장 버튼은 그대로 둔다:

기존:
```tsx
                      <button className="kim-jeff-picker-row" type="button"><span>옵션</span><b>기본 제공 옵션</b><ChevronDown size={15} /></button>
```

교체:
```tsx
                      <OptionPicker options={trimDetail?.options ?? []} relations={trimDetail?.optionRelations ?? []} onChange={applyOptionTotal} />
```

- [ ] **Step 5: 옵션 드롭다운 CSS 추가**

`client/src/index.css`의 `.kim-vehicle-picker-msg { ... }` 블록(약 `15024`) **바로 뒤**에 추가:

```css
.kim-option-picker {
  position: relative;
}
.kim-option-picker-menu {
  position: absolute;
  top: calc(100% - 4px);
  left: 0;
  right: 0;
  z-index: 30;
  max-height: 260px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e4e4e2;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  padding: 6px;
}
.kim-option-picker-group + .kim-option-picker-group {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid #f0f0ee;
}
.kim-option-picker-label {
  display: block;
  padding: 2px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  color: #9298a0;
}
.kim-option-picker-basic {
  padding: 6px 10px;
  font-size: 12.5px;
  color: #7f858c;
}
.kim-option-picker-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.kim-option-picker-option:hover {
  background: #f4f1ff;
}
.kim-option-picker-option.is-selected {
  background: #ece8ff;
  font-weight: 600;
}
.kim-option-picker-option em {
  font-style: normal;
  font-size: 12px;
  color: #5f6872;
}
.kim-option-picker-msg {
  display: block;
  padding: 10px;
  font-size: 12px;
  color: #7f858c;
}
```

- [ ] **Step 6: typecheck**

Run: `bun run typecheck`
Expected: 에러 0. (`TrimDetail` state, `OptionPicker` props, `applyOptionTotal` 타입 일치.)

- [ ] **Step 7: lint**

Run: `bun run lint`
Expected: 0 problems. (OptionPicker의 `useEffect([options])` exhaustive-deps 경고 없음 확인.)

- [ ] **Step 8: 단위테스트 회귀**

Run: `bunx vitest run client/src/lib/option-selection.test.ts client/src/components/OptionPicker.test.tsx`
Expected: 전부 PASS.

- [ ] **Step 9: 수동 확인(권장)**

dev 서버에서 트림 선택 → 옵션 버튼 클릭 → tuning 체크 시 `(+) 옵션 금액`과 최종 차량가/취득원가가 변하는지, excludes 옵션 동시선택 시 한쪽 자동 해제, includes 선택 시 연관 옵션 자동 체크, 트림 변경 시 옵션 초기화 확인. (자동화 어려우면 사용자 확인으로 위임.)

- [ ] **Step 10: Commit**

```bash
git add client/src/pages/CustomerDetailPage.tsx client/src/index.css
git commit -m "feat: 옵션 선택 → 옵션 금액 가격 반영(2단계)"
```

---

## Self-Review 결과

- **Spec coverage**: ② 순수 lib=Task 1, ③ OptionPicker=Task 2, ① TrimDetail 보관=Task 3 Step 2~3, ④ 연결(option input 반영)=Task 3 Step 3~4, ⑤ 테스트=Task 1·2 + Task 3 수동. CSS=Task 3 Step 5. 비범위(컬러/할인 매핑/취득세/다단계 includes)는 손대지 않음 — 일치.
- **Placeholder scan**: 모든 코드 step에 실제 코드. TODO/TBD 없음.
- **Type consistency**: `OptionRelation`/`OptionLite`(Task 1)는 lib 내부 타입. `OptionPicker`는 `TrimOption`/`TrimOptionRelation`(vehicles.ts) props를 받고 `resolveSelection`/`optionTotal`에 그대로 전달 — 구조 호환(`id`/`type`/`price`, `optionId`/`relatedOptionId`/`type`). `onChange({selectedIds:number[], total:number})`는 Task 2 정의 ↔ Task 3 `applyOptionTotal` 인자 일치. `data-pricing="option"`은 1단계와 동일 키.
- **알려진 주의**: OptionPicker가 받는 `TrimOption.type`은 `"basic"|"tuning"`, `optionTotal`의 `OptionLite.type`도 동일 — `filter`가 정상 동작. 트림 변경 시 옵션 초기화는 OptionPicker 내부(`useEffect[options]`)와 부모의 option input 0 리셋(`applyTrimToPricing`)이 함께 일관 처리.
