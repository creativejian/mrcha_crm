# 차량 선택 프론트 연결 (VehiclePicker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적 workbench(Jeff body)의 하드코딩 차량 선택 버튼을, `/api/vehicles`에서 브랜드→모델→트림을 계층 선택하는 `VehiclePicker` 드롭다운으로 교체한다.

**Architecture:** 순수 fetch 레이어(`client/src/lib/vehicles.ts`) → 독립 컴포넌트 `VehiclePicker`(브랜드 마운트 로드, 상위 선택 시 하위 lazy 로드, 단계별 로딩/에러) → `CustomerDetailPage` Jeff body의 하드코딩 picker 교체. 페칭 라이브러리 없음(YAGNI).

**Tech Stack:** React 19, Vite(`/api` proxy → 8788), vitest + @testing-library/react + jsdom, lucide-react.

**Spec:** `ref/specs/2026-06-14-vehicle-picker-frontend-design.md`

---

## File Structure

- Create: `client/src/lib/vehicles.ts` — fetch 함수 + 응답 타입
- Create: `client/src/lib/vehicles.test.ts` — fetch 함수 테스트(fetch mock)
- Create: `client/src/components/VehiclePicker.tsx` — 3단계 드롭다운 컴포넌트
- Create: `client/src/components/VehiclePicker.test.tsx` — 컴포넌트 테스트(fetch mock)
- Modify: `client/src/pages/CustomerDetailPage.tsx` — Jeff body picker(4828-4830) 교체 + import
- Modify: `client/src/index.css` — VehiclePicker 드롭다운 스타일(파일 끝에 추가)

---

## Task 1: 데이터 페칭 레이어

**Files:**
- Create: `client/src/lib/vehicles.ts`
- Test: `client/src/lib/vehicles.test.ts`

- [ ] **Step 1: Write the failing test**

`client/src/lib/vehicles.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchBrands, fetchModels, fetchTrims } from "./vehicles";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("vehicles api", () => {
  it("fetchBrands GETs /api/vehicles/brands", async () => {
    const data = [{ id: 1, name: "현대" }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })));
    const brands = await fetchBrands();
    expect(fetch).toHaveBeenCalledWith("/api/vehicles/brands");
    expect(brands).toEqual(data);
  });

  it("fetchModels passes brandId in query", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    await fetchModels(5);
    expect(fetch).toHaveBeenCalledWith("/api/vehicles/models?brandId=5");
  });

  it("fetchTrims passes modelId in query", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    await fetchTrims(7);
    expect(fetch).toHaveBeenCalledWith("/api/vehicles/trims?modelId=7");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    await expect(fetchBrands()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:unit client/src/lib/vehicles.test.ts`
Expected: FAIL — `Cannot find module './vehicles'`

- [ ] **Step 3: Write the implementation**

`client/src/lib/vehicles.ts`:
```ts
export type Brand = {
  id: number;
  name: string;
  logoUrl: string | null;
  isDomestic: boolean;
  isPopular: boolean;
  sortOrder: number | null;
  brandCode: number | null;
};

export type Model = {
  id: number;
  brandId: number;
  name: string;
  imageUrl: string | null;
  category: string | null;
  status: string;
  sortOrder: number | null;
  modelCode: number | null;
};

export type Trim = {
  id: number;
  modelId: number;
  name: string;
  trimName: string | null;
  canonicalName: string | null;
  price: number;
  fuelType: string | null;
  displacementCc: number | null;
  modelYear: number | null;
  driveSystem: string | null;
  transmissionType: string | null;
  bodyStyle: string | null;
  seatingCapacity: number | null;
  status: string;
  sortOrder: number | null;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`vehicle fetch failed: ${res.status} ${url}`);
  }
  return (await res.json()) as T;
}

export function fetchBrands(): Promise<Brand[]> {
  return getJson<Brand[]>("/api/vehicles/brands");
}

export function fetchModels(brandId: number): Promise<Model[]> {
  return getJson<Model[]>(`/api/vehicles/models?brandId=${brandId}`);
}

export function fetchTrims(modelId: number): Promise<Trim[]> {
  return getJson<Trim[]>(`/api/vehicles/trims?modelId=${modelId}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:unit client/src/lib/vehicles.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/vehicles.ts client/src/lib/vehicles.test.ts
git commit -m "feat: add client vehicles fetch layer"
```

---

## Task 2: VehiclePicker 컴포넌트

**Files:**
- Create: `client/src/components/VehiclePicker.tsx`
- Test: `client/src/components/VehiclePicker.test.tsx`
- Modify: `client/src/index.css` (파일 끝에 추가)

- [ ] **Step 1: Write the failing test**

`client/src/components/VehiclePicker.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VehiclePicker } from "./VehiclePicker";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/vehicles/brands") {
        return new Response(
          JSON.stringify([{ id: 1, name: "현대", logoUrl: null, isDomestic: true, isPopular: true, sortOrder: 1, brandCode: 1 }]),
          { status: 200 },
        );
      }
      if (url.startsWith("/api/vehicles/models")) {
        return new Response(
          JSON.stringify([{ id: 10, brandId: 1, name: "팰리세이드", imageUrl: null, category: null, status: "판매중", sortOrder: 1, modelCode: 1 }]),
          { status: 200 },
        );
      }
      if (url.startsWith("/api/vehicles/trims")) {
        return new Response(
          JSON.stringify([{ id: 100, modelId: 10, name: "Exclusive", trimName: "Exclusive", canonicalName: null, price: 50000000, fuelType: null, displacementCc: null, modelYear: null, driveSystem: null, transmissionType: null, bodyStyle: null, seatingCapacity: null, status: "판매중", sortOrder: 1 }]),
          { status: 200 },
        );
      }
      return new Response("[]", { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VehiclePicker", () => {
  it("브랜드 선택 → 모델 로드 → 모델 선택 → 트림 로드", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VehiclePicker onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /제조사/ }));
    await user.click(await screen.findByRole("button", { name: "현대" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ brand: expect.objectContaining({ name: "현대" }) }));

    await user.click(screen.getByRole("button", { name: /모델/ }));
    await user.click(await screen.findByRole("button", { name: "팰리세이드" }));

    await user.click(screen.getByRole("button", { name: /트림/ }));
    expect(await screen.findByRole("button", { name: "Exclusive" })).toBeInTheDocument();
  });

  it("브랜드 로드 실패 시 에러 표시", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    const user = userEvent.setup();
    render(<VehiclePicker />);
    await user.click(screen.getByRole("button", { name: /제조사/ }));
    expect(await screen.findByText("불러오기 실패")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:unit client/src/components/VehiclePicker.test.tsx`
Expected: FAIL — `Cannot find module './VehiclePicker'`

- [ ] **Step 3: Write the component**

`client/src/components/VehiclePicker.tsx`:
```tsx
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { fetchBrands, fetchModels, fetchTrims, type Brand, type Model, type Trim } from "@/lib/vehicles";

export type VehicleSelection = { brand?: Brand; model?: Model; trim?: Trim };

type Level = "brand" | "model" | "trim";

export function VehiclePicker({ onChange }: { onChange?: (selection: VehicleSelection) => void }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [trims, setTrims] = useState<Trim[]>([]);
  const [brand, setBrand] = useState<Brand>();
  const [model, setModel] = useState<Model>();
  const [trim, setTrim] = useState<Trim>();
  const [open, setOpen] = useState<Level | null>(null);
  const [loading, setLoading] = useState<Level | null>(null);
  const [errored, setErrored] = useState<Level | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading("brand");
    setErrored(null);
    fetchBrands()
      .then((data) => setBrands(data))
      .catch(() => setErrored("brand"))
      .finally(() => setLoading(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function selectBrand(next: Brand) {
    setBrand(next);
    setModel(undefined);
    setTrim(undefined);
    setModels([]);
    setTrims([]);
    setOpen(null);
    setErrored(null);
    onChange?.({ brand: next });
    setLoading("model");
    fetchModels(next.id)
      .then((data) => setModels(data))
      .catch(() => setErrored("model"))
      .finally(() => setLoading(null));
  }

  function selectModel(next: Model) {
    setModel(next);
    setTrim(undefined);
    setTrims([]);
    setOpen(null);
    setErrored(null);
    onChange?.({ brand, model: next });
    setLoading("trim");
    fetchTrims(next.id)
      .then((data) => setTrims(data))
      .catch(() => setErrored("trim"))
      .finally(() => setLoading(null));
  }

  function selectTrim(next: Trim) {
    setTrim(next);
    setOpen(null);
    onChange?.({ brand, model, trim: next });
  }

  function renderMenu(level: Level, items: { id: number; label: string }[], onPick: (id: number) => void) {
    if (open !== level) return null;
    if (loading === level) {
      return (
        <div className="kim-vehicle-picker-menu">
          <span className="kim-vehicle-picker-msg">불러오는 중…</span>
        </div>
      );
    }
    if (errored === level) {
      return (
        <div className="kim-vehicle-picker-menu">
          <span className="kim-vehicle-picker-msg">불러오기 실패</span>
        </div>
      );
    }
    return (
      <div className="kim-vehicle-picker-menu" role="listbox">
        {items.map((item) => (
          <button key={item.id} className="kim-vehicle-picker-option" type="button" onClick={() => onPick(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="kim-vehicle-picker" ref={rootRef}>
      <div className="kim-vehicle-picker-anchor">
        <button className="kim-jeff-picker-row" type="button" onClick={() => setOpen(open === "brand" ? null : "brand")}>
          <span>제조사</span>
          <b className={brand ? "" : "muted"}>{brand?.name ?? "선택"}</b>
          <ChevronDown size={15} />
        </button>
        {renderMenu(
          "brand",
          brands.map((b) => ({ id: b.id, label: b.name })),
          (id) => {
            const picked = brands.find((b) => b.id === id);
            if (picked) selectBrand(picked);
          },
        )}
      </div>

      <div className="kim-vehicle-picker-anchor">
        <button className="kim-jeff-picker-row" type="button" disabled={!brand} onClick={() => setOpen(open === "model" ? null : "model")}>
          <span>모델</span>
          <b className={model ? "" : "muted"}>{model?.name ?? "선택"}</b>
          <ChevronDown size={15} />
        </button>
        {renderMenu(
          "model",
          models.map((m) => ({ id: m.id, label: m.name })),
          (id) => {
            const picked = models.find((m) => m.id === id);
            if (picked) selectModel(picked);
          },
        )}
      </div>

      <div className="kim-vehicle-picker-anchor">
        <button className="kim-jeff-picker-row" type="button" disabled={!model} onClick={() => setOpen(open === "trim" ? null : "trim")}>
          <span>트림</span>
          <b className={trim ? "" : "muted"}>{trim ? trim.trimName ?? trim.name : "선택"}</b>
          <ChevronDown size={15} />
        </button>
        {renderMenu(
          "trim",
          trims.map((t) => ({ id: t.id, label: t.trimName ?? t.name })),
          (id) => {
            const picked = trims.find((t) => t.id === id);
            if (picked) selectTrim(picked);
          },
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add CSS**

`client/src/index.css` 파일 끝에 추가:
```css
/* VehiclePicker (차량 선택 드롭다운) */
.kim-vehicle-picker {
  display: flex;
  flex-direction: column;
}
.kim-vehicle-picker-anchor {
  position: relative;
}
.kim-vehicle-picker-anchor:last-child .kim-jeff-picker-row::after {
  display: none;
}
.kim-jeff-picker-row:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.kim-vehicle-picker-menu {
  position: absolute;
  top: calc(100% - 4px);
  left: 0;
  right: 0;
  z-index: 30;
  max-height: 240px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e4e4e2;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  padding: 4px;
}
.kim-vehicle-picker-option {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.kim-vehicle-picker-option:hover {
  background: #f4f1ff;
}
.kim-vehicle-picker-msg {
  display: block;
  padding: 10px;
  font-size: 12px;
  color: #7f858c;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test:unit client/src/components/VehiclePicker.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add client/src/components/VehiclePicker.tsx client/src/components/VehiclePicker.test.tsx client/src/index.css
git commit -m "feat: add VehiclePicker (brand/model/trim catalog dropdown)"
```

---

## Task 3: CustomerDetailPage Jeff body picker 교체

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: Add the import**

`CustomerDetailPage.tsx` 상단 import 영역(다른 컴포넌트/lib import 근처)에 추가:
```tsx
import { VehiclePicker } from "@/components/VehiclePicker";
```
(주의: 파일에 이미 `@/` alias import가 있으면 그 그룹에 맞춰 넣는다. 없고 상대경로만 쓰면 `../components/VehiclePicker`로 맞춘다.)

- [ ] **Step 2: Replace the hardcoded picker**

`CustomerDetailPage.tsx`의 Jeff body 차량 선택 섹션(현재):
```tsx
                    <div className="kim-jeff-section">
                      <h4>🚘 차량 선택</h4>
                      <button className="kim-jeff-picker-row" type="button"><span>제조사</span><b>벤츠</b><ChevronDown size={15} /></button>
                      <button className="kim-jeff-picker-row" type="button"><span>모델</span><b>Maybach S-Class</b><ChevronDown size={15} /></button>
                      <button className="kim-jeff-picker-row" type="button"><span>트림</span><b>S 500 4M Long</b><ChevronDown size={15} /></button>
                    </div>
```
을 다음으로 교체:
```tsx
                    <div className="kim-jeff-section">
                      <h4>🚘 차량 선택</h4>
                      <VehiclePicker />
                    </div>
```
(옵션/컬러·할인 등 나머지 섹션은 건드리지 않는다.)

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat: wire VehiclePicker into Kim quote workbench (replace hardcoded picker)"
```

---

## Task 4: 전체 검증

**Files:** (없음 — 검증만)

- [ ] **Step 1: typecheck**

Run: `bun run typecheck`
Expected: exit 0

- [ ] **Step 2: lint**

Run: `bun run lint`
Expected: 0 problems

- [ ] **Step 3: build**

Run: `bun run build`
Expected: `✓ built`

- [ ] **Step 4: unit tests (전체)**

Run: `bun run test:unit`
Expected: 모든 client 테스트 PASS (기존 15 + vehicles 4 + VehiclePicker 2)

- [ ] **Step 5: 수동 스모크 (선택)**

`bun run dev`로 서버 띄우고 김민준(`CU-2605-0020`) drawer → 견적 workbench 열어 차량 선택 드롭다운이 실제 브랜드(현대/기아…)로 동작하는지 확인. (DB 연결 필요 — `.env.local`의 DATABASE_URL)

---

## 완료 후

- PR 생성(`feat/vehicle-picker-frontend` 브랜치) → squash 머지.
- 다음(spec 비범위): picker 선택값 → 가격/옵션/색상 자동 반영, 옵션/색상 드롭다운, 견적 저장 연동.
