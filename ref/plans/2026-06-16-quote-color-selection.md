# 견적 외장/내장 색상 선택 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적 workbench에서 트림의 외장/내장 색상을 hex 스와치 드롭다운으로 선택하고, 앱카드/견적 출력에 반영한다.

**Architecture:** `ColorPicker`는 controlled 컴포넌트(`value`는 부모 state, 내부엔 open만). `colorType`으로 외장/내장 재사용. 색상은 가격 무관이라 합산 로직과 분리, 순수 lib 없이 컴포넌트 + 부모 state 표시 연동.

**Tech Stack:** React + TypeScript, vitest + @testing-library. `getTrimDetail.colors`(기완성), `trimDetail` state(2단계).

**Spec:** `ref/specs/2026-06-16-quote-color-selection-design.md`

---

## File Structure

- **Create** `client/src/components/ColorPicker.tsx` — `colorType` 필터 단일선택 hex 스와치 드롭다운.
- **Create** `client/src/components/ColorPicker.test.tsx` — 컴포넌트 테스트.
- **Modify** `client/src/pages/CustomerDetailPage.tsx` — 외장/내장 버튼 교체, state, 앱카드 연동.
- **Modify** `client/src/index.css` — 스와치/드롭다운 스타일.

검증: `bun run typecheck` · `bun run lint` · `bunx vitest run client/src/components/ColorPicker.test.tsx`

---

## Task 1: ColorPicker 컴포넌트

**Files:**
- Create: `client/src/components/ColorPicker.tsx`
- Test: `client/src/components/ColorPicker.test.tsx`

> `TrimColor` 타입은 1단계에서 `client/src/lib/vehicles.ts`에 정의됨: `{ id, colorType: "exterior"|"interior", name, code, hexValue, sortOrder }`.

- [ ] **Step 1: Write the failing test**

Create `client/src/components/ColorPicker.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ColorPicker } from "./ColorPicker";

const colors = [
  { id: 1, colorType: "exterior" as const, name: "폴라 화이트 (149U)", code: "C11", hexValue: "#ffffff", sortOrder: 1 },
  { id: 2, colorType: "exterior" as const, name: "옵시디안 블랙 (197U)", code: "C13", hexValue: "#0c0c0c", sortOrder: 0 },
  { id: 3, colorType: "interior" as const, name: "블랙 투톤", code: "I1", hexValue: "#000000", sortOrder: 0 },
];

describe("ColorPicker", () => {
  it("colorType으로 필터하고 색상 클릭 시 onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorPicker colorType="exterior" colors={colors} value={null} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /외장/ }));
    expect(screen.queryByText("블랙 투톤")).toBeNull(); // 내장은 안 보임
    await user.click(screen.getByText("옵시디안 블랙 (197U)"));
    expect(onChange).toHaveBeenCalledWith(colors[1]);
  });

  it("value가 있으면 버튼에 색상명 표시", () => {
    render(<ColorPicker colorType="exterior" colors={colors} value={colors[0]} />);
    expect(screen.getByText("폴라 화이트 (149U)")).toBeInTheDocument();
  });

  it("해당 타입 색상이 없으면 버튼 비활성", () => {
    render(<ColorPicker colorType="interior" colors={[colors[0]]} value={null} />);
    expect(screen.getByRole("button", { name: /내장/ })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run client/src/components/ColorPicker.test.tsx`
Expected: FAIL — `Failed to resolve import "./ColorPicker"`.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/components/ColorPicker.tsx`:

```tsx
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { TrimColor } from "@/lib/vehicles";

type ColorPickerProps = {
  colorType: "exterior" | "interior";
  colors: TrimColor[];
  value: TrimColor | null;
  onChange?: (color: TrimColor) => void;
};

export function ColorPicker({ colorType, colors, value, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const items = colors.filter((c) => c.colorType === colorType).sort((a, b) => a.sortOrder - b.sortOrder);
  const label = colorType === "exterior" ? "외장" : "내장";

  function select(color: TrimColor) {
    onChange?.(color);
    setOpen(false);
  }

  return (
    <div className="kim-color-picker" ref={rootRef}>
      <button className="kim-jeff-picker-row" type="button" disabled={!items.length} onClick={() => setOpen(!open)}>
        <span>{label}</span>
        {value ? (
          <b className="kim-color-picker-value">
            <span className="kim-color-picker-swatch" style={{ background: value.hexValue ?? "transparent" }} />
            {value.name}
          </b>
        ) : (
          <b className="muted">미선택</b>
        )}
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div className="kim-color-picker-menu" role="listbox">
          {items.map((c) => (
            <button
              key={c.id}
              className={`kim-color-picker-option${value?.id === c.id ? " is-selected" : ""}`}
              type="button"
              onClick={() => select(c)}
            >
              <span className="kim-color-picker-swatch" style={{ background: c.hexValue ?? "transparent" }} />
              <span className="kim-color-picker-name">{c.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run client/src/components/ColorPicker.test.tsx`
Expected: PASS (3 it).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ColorPicker.tsx client/src/components/ColorPicker.test.tsx
git commit -m "feat: 외장/내장 색상 단일선택 ColorPicker 컴포넌트 추가"
```

---

## Task 2: CustomerDetailPage 연결 + CSS

거대 컴포넌트라 1·2단계와 동일하게 구현 + `typecheck`/`lint`/`test`/수동 확인.

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`
- Modify: `client/src/index.css`

- [ ] **Step 1: import 추가**

`import { fetchTrimDetail, type TrimDetail } from "@/lib/vehicles";`를 `TrimColor` 포함으로 교체:

```ts
import { fetchTrimDetail, type TrimColor, type TrimDetail } from "@/lib/vehicles";
```

그리고 `import { OptionPicker } from "@/components/OptionPicker";` 위(알파벳 순)에 추가:

```ts
import { ColorPicker } from "@/components/ColorPicker";
```

- [ ] **Step 2: state 추가**

`const [trimDetail, setTrimDetail] = useState<TrimDetail | null>(null);` 바로 뒤에 추가:

```ts
  const [exteriorColor, setExteriorColor] = useState<TrimColor | null>(null);
  const [interiorColor, setInteriorColor] = useState<TrimColor | null>(null);
```

- [ ] **Step 3: 트림 변경 시 색상 초기화**

`applyTrimToPricing` 안에서 `setTrimDetail(detail);` 바로 뒤에 추가:

```ts
      setExteriorColor(null);
      setInteriorColor(null);
```

- [ ] **Step 4: 외장/내장 버튼 → ColorPicker 교체**

외장 버튼(약 `5092`) 교체:

```tsx
                      <ColorPicker colorType="exterior" colors={trimDetail?.colors ?? []} value={exteriorColor} onChange={(c) => { setExteriorColor(c); markQuoteDraftChanged(); }} />
```

내장 버튼(약 `5093`) 교체:

```tsx
                      <ColorPicker colorType="interior" colors={trimDetail?.colors ?? []} value={interiorColor} onChange={(c) => { setInteriorColor(c); markQuoteDraftChanged(); }} />
```

- [ ] **Step 5: 앱카드/견적 컬러 필드 연동**

앱카드 `외장/내장 컬러` 필드가 2곳(들여쓰기만 다름)이므로 각각 `replace_all`로 교체.

`<dt>외장 컬러</dt><dd>미선택</dd>` (2곳) →
```tsx
<dt>외장 컬러</dt><dd>{exteriorColor?.name ?? "미선택"}</dd>
```

`<dt>내장 컬러</dt><dd>미선택</dd>` (2곳) →
```tsx
<dt>내장 컬러</dt><dd>{interiorColor?.name ?? "미선택"}</dd>
```

- [ ] **Step 6: CSS 추가**

`client/src/index.css`의 `.kim-option-picker-relation { ... }` 블록 **뒤**(옵션 picker CSS 끝)에 추가:

```css
.kim-color-picker {
  position: relative;
}
.kim-color-picker-value {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.kim-color-picker-swatch {
  display: inline-block;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 1px solid rgba(15, 23, 42, 0.15);
  flex: none;
}
.kim-color-picker-menu {
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
.kim-color-picker-option {
  display: flex;
  align-items: center;
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
.kim-color-picker-option:hover {
  background: #f4f1ff;
}
.kim-color-picker-option.is-selected {
  background: #ece8ff;
  font-weight: 600;
}
.kim-color-picker-name {
  flex: 1 1 auto;
  min-width: 0;
}
```

- [ ] **Step 7: typecheck / lint / 단위테스트 / build**

Run: `bun run typecheck` (0) · `bun run lint` (0) · `bun run test:unit` (전부 PASS) · `bun run build` (성공)

- [ ] **Step 8: 수동 확인(권장)**

dev에서 트림 선택 → 🎨 섹션 외장/내장 드롭다운에 hex 스와치+색상명, 선택 시 버튼·앱카드 `외장/내장 컬러`가 색상명으로 바뀌는지, 트림 변경 시 초기화되는지 확인.

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/CustomerDetailPage.tsx client/src/index.css
git commit -m "feat: 외장/내장 색상 선택 → 앱카드/견적 반영"
```

---

## Self-Review 결과

- **Spec coverage**: ② ColorPicker=Task 1, ③ state=Task 2 Step 2, ④ 버튼 교체=Step 4, 앱카드 연동=Step 5, ⑤ 테스트=Task 1, CSS=Step 6, 트림 변경 초기화=Step 3. 가격 무관(가격 input 안 건드림). 일치.
- **Placeholder scan**: 모든 step 실제 코드. TODO/TBD 없음.
- **Type consistency**: `TrimColor`(vehicles.ts) ↔ ColorPicker props/state 일치. `onChange(color: TrimColor)` ↔ `setExteriorColor`/`setInteriorColor`(`TrimColor | null` setter, 인라인에서 `c: TrimColor` 전달) 호환. `value?.id === c.id`로 선택 표시. 앱카드 `exteriorColor?.name` ↔ state 타입 일치.
- **알려진 주의**: `ColorPicker`는 controlled(value=부모 state)라 트림 변경 시 `key` 재마운트 불필요 — Step 3의 state 초기화로 미선택 복귀. inline `style={{ background }}`는 hex 동적값이라 불가피(CSS 클래스로 표현 불가).
