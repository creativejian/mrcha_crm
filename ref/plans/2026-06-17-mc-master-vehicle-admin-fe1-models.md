# 차량 관리 프론트 1b-i: 브랜드 사이드바 + 모델 관리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans(inline). Steps는 체크박스(`- [ ]`)로 추적.

**Goal:** `/mc-master`를 counts 페이지에서 **브랜드 사이드바 + 모델 테이블 + 모델 추가/수정/삭제** 화면으로 바꿔, 차량 관리의 모델 레벨을 동작하게 한다(트림/옵션은 1b-ii/iii).

**Architecture:** Phase 1a 백엔드 API(`/api/catalog/brands·models`)를 호출하는 React UI. CRM 라이트 콘솔 디자인 시스템(`.card`·`.table-scroll`·`.customer-detail-drawer`·`.input`/`.select`/`.btn`·`.badge`)을 재사용. 편집 컨트롤은 `roleTab==="최고관리자"`에서만 노출. `MCMasterPage`를 admin 셸로 재구성하고 하위 컴포넌트로 분리.

**Tech Stack:** React 19, TypeScript 6.0.3, vite, vitest + @testing-library/react, lucide-react.

**Spec:** `ref/specs/2026-06-17-mc-master-vehicle-admin-design.md`. **Backend(머지됨, #23):** `/api/catalog/brands`(getBrands), `/api/catalog/models?brandId=`(목록+집계), `POST /models`, `PATCH /models/:id`(category·status), `DELETE /models/:id`.

**status enum SSOT:** `판매중/출시예정/사전예약/단종/블라인드`. **앱 UI 라벨:** 사전예약→"예약판매", 블라인드→"숨김"(표시만, 저장값은 enum).

---

## File Structure

- **Create**: `client/src/data/vehicle-taxonomy.ts` — status 라벨/배지톤 + 카테고리 옵션(named const).
- **Create**: `client/src/data/vehicle-taxonomy.test.ts` — 라벨/카테고리 단위테스트(vitest).
- **Modify**: `client/src/lib/catalog.ts` — 모델/브랜드 타입 + fetch(목록·CRUD).
- **Modify**: `client/src/lib/catalog.test.ts` — fetch 단위테스트 추가.
- **Create**: `client/src/pages/mc-master/BrandSidebar.tsx` — 국산/수입 그룹 브랜드 목록(read-only 선택).
- **Create**: `client/src/pages/mc-master/ModelTable.tsx` — 모델 테이블(연필 → 편집).
- **Create**: `client/src/pages/mc-master/ModelEditPanel.tsx` — 추가/수정 겸용 360px 우측 패널.
- **Modify**: `client/src/pages/MCMasterPage.tsx` — admin 셸 재구성(roleTab 복원, 사이드바+테이블+패널 조합).
- **Modify**: `client/src/pages/MCMasterPage.test.tsx` — admin 렌더/권한 게이트 테스트.
- **Modify**: `client/src/App.tsx` — `<MCMasterPage roleTab={roleTab} />` 복원.
- **Modify**: `client/src/index.css` — `.va-*`(vehicle-admin) 클래스(테이블/사이드바/패널, 기존 토큰 재사용).

---

## Task 1: vehicle-taxonomy 상수 (status·category)

**Files:**
- Create: `client/src/data/vehicle-taxonomy.ts`
- Create: `client/src/data/vehicle-taxonomy.test.ts`

- [ ] **Step 1: 실패 테스트**

`client/src/data/vehicle-taxonomy.test.ts`:
```ts
import { expect, it } from "vitest";

import { MODEL_CATEGORIES, VEHICLE_STATUSES, statusBadgeTone, statusLabel } from "./vehicle-taxonomy";

it("status enum 5종", () => {
  expect(VEHICLE_STATUSES).toEqual(["판매중", "출시예정", "사전예약", "단종", "블라인드"]);
});

it("표시 라벨: 사전예약→예약판매, 블라인드→숨김", () => {
  expect(statusLabel("판매중")).toBe("판매중");
  expect(statusLabel("사전예약")).toBe("예약판매");
  expect(statusLabel("블라인드")).toBe("숨김");
});

it("배지 톤 매핑", () => {
  expect(statusBadgeTone("판매중")).toBe("green");
  expect(statusBadgeTone("단종")).toBe("gray");
});

it("카테고리 옵션 비어있지 않음", () => {
  expect(MODEL_CATEGORIES.length).toBeGreaterThan(0);
  expect(MODEL_CATEGORIES).toContain("중형 세단");
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/data/vehicle-taxonomy.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현**

`client/src/data/vehicle-taxonomy.ts`:
```ts
// 차량 status enum(DB 저장값, public.car_status)과 모델 카테고리 옵션 SSOT.
// 표시 라벨은 앱 admin과 동일(사전예약→예약판매, 블라인드→숨김). 저장은 항상 enum 값.
export const VEHICLE_STATUSES = ["판매중", "출시예정", "사전예약", "단종", "블라인드"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

const STATUS_LABEL: Record<VehicleStatus, string> = {
  판매중: "판매중",
  출시예정: "출시예정",
  사전예약: "예약판매",
  단종: "단종",
  블라인드: "숨김",
};
export function statusLabel(s: VehicleStatus): string {
  return STATUS_LABEL[s];
}

export type BadgeTone = "green" | "yellow" | "red" | "gray" | "purple";
const STATUS_TONE: Record<VehicleStatus, BadgeTone> = {
  판매중: "green",
  출시예정: "yellow",
  사전예약: "purple",
  단종: "gray",
  블라인드: "gray",
};
export function statusBadgeTone(s: VehicleStatus): BadgeTone {
  return STATUS_TONE[s];
}

// 모델 카테고리 — 앱 model_add_panel 분류(그룹 × 차종)를 평면 옵션으로. 자유 텍스트 컬럼이라 문자열 저장.
const SIZE_GROUPS = ["경형", "소형", "준중형", "중형", "준대형", "대형", "스포츠카", "버스"] as const;
const BODY_TYPES = ["세단", "해치백", "SUV", "RV", "MPV", "쿠페", "컨버터블", "트럭", "밴"] as const;
export const MODEL_CATEGORIES: string[] = SIZE_GROUPS.flatMap((g) => BODY_TYPES.map((b) => `${g} ${b}`));
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit client/src/data/vehicle-taxonomy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: 커밋**

```bash
git add client/src/data/vehicle-taxonomy.ts client/src/data/vehicle-taxonomy.test.ts
git commit -m "feat(mc-master): vehicle-taxonomy 상수(status 라벨·배지톤·카테고리) (1b-i)"
```

---

## Task 2: catalog lib — 브랜드·모델 fetch/CRUD

**Files:**
- Modify: `client/src/lib/catalog.ts`
- Modify: `client/src/lib/catalog.test.ts`

- [ ] **Step 1: 타입 + fetch 추가 (파일 끝에 append)**

`client/src/lib/catalog.ts` 하단에:
```ts
import type { VehicleStatus } from "@/data/vehicle-taxonomy";

export type CatalogBrand = {
  id: number;
  name: string;
  logoUrl: string | null;
  isDomestic: boolean;
  isPopular: boolean;
  sortOrder: number;
  brandCode: number | null;
};

export type CatalogModel = {
  id: number;
  name: string;
  category: string | null;
  status: VehicleStatus;
  sortOrder: number | null;
  modelCode: number | null;
  imageUrl: string | null;
  trimCount: number;
  minPrice: number | null;
  maxPrice: number | null;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `요청 실패: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchBrands(): Promise<CatalogBrand[]> {
  return jsonOrThrow(await fetch("/api/catalog/brands"));
}

export async function fetchModels(brandId: number): Promise<CatalogModel[]> {
  return jsonOrThrow(await fetch(`/api/catalog/models?brandId=${brandId}`));
}

export async function createModel(input: {
  brandId: number;
  name: string;
  category: string | null;
  status: VehicleStatus;
}): Promise<CatalogModel> {
  return jsonOrThrow(
    await fetch("/api/catalog/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function updateModel(
  id: number,
  input: { category?: string | null; status?: VehicleStatus },
): Promise<CatalogModel> {
  return jsonOrThrow(
    await fetch(`/api/catalog/models/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteModel(id: number): Promise<{ id: number }> {
  return jsonOrThrow(await fetch(`/api/catalog/models/${id}`, { method: "DELETE" }));
}
```

- [ ] **Step 2: 테스트 추가 (append)**

`client/src/lib/catalog.test.ts` 하단에:
```ts
import { createModel, deleteModel, fetchBrands, fetchModels, updateModel } from "./catalog";

it("fetchModels: brandId 쿼리 전달", async () => {
  const data = [{ id: 1, name: "5 Series", category: "준대형 세단", status: "판매중", trimCount: 13, minPrice: 1, maxPrice: 2 }];
  const spy = vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }));
  vi.stubGlobal("fetch", spy);
  const r = await fetchModels(7);
  expect(spy.mock.calls[0][0]).toBe("/api/catalog/models?brandId=7");
  expect(r[0].name).toBe("5 Series");
});

it("createModel: POST + body", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ id: 9 }), { status: 200 }));
  vi.stubGlobal("fetch", spy);
  await createModel({ brandId: 7, name: "X", category: null, status: "판매중" });
  expect(spy.mock.calls[0][1]?.method).toBe("POST");
});

it("updateModel: 서버 에러 메시지로 throw", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "모델을 찾을 수 없습니다." }), { status: 404 })));
  await expect(updateModel(1, { status: "단종" })).rejects.toThrow("모델을 찾을 수 없습니다.");
});

it("fetchBrands / deleteModel 호출 경로", async () => {
  const spy = vi.fn(async () => new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", spy);
  await fetchBrands();
  expect(spy.mock.calls[0][0]).toBe("/api/catalog/brands");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 200 })));
  await deleteModel(1);
});
```
(파일 상단 import에 `vi` 포함 확인 — 기존 `import { afterEach, expect, it, vi } from "vitest";` 유지.)

- [ ] **Step 3: typecheck + 테스트 + lint**

Run: `bun run typecheck` → 0
Run: `bun run test:unit client/src/lib/catalog.test.ts` → PASS
Run: `bun run lint` → 0

- [ ] **Step 4: 커밋**

```bash
git add client/src/lib/catalog.ts client/src/lib/catalog.test.ts
git commit -m "feat(mc-master): catalog lib 브랜드·모델 fetch/CRUD (1b-i)"
```

---

## Task 3: BrandSidebar 컴포넌트

**Files:**
- Create: `client/src/pages/mc-master/BrandSidebar.tsx`

- [ ] **Step 1: 구현**

`client/src/pages/mc-master/BrandSidebar.tsx`:
```tsx
import type { CatalogBrand } from "@/lib/catalog";

export function BrandSidebar({
  brands,
  selectedId,
  onSelect,
}: {
  brands: CatalogBrand[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const domestic = brands.filter((b) => b.isDomestic);
  const imported = brands.filter((b) => !b.isDomestic);

  const group = (label: string, list: CatalogBrand[]) => (
    <div className="va-brand-group" key={label}>
      <div className="va-brand-group-label">{label}</div>
      {list.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`va-brand-item${b.id === selectedId ? " is-active" : ""}`}
          onClick={() => onSelect(b.id)}
        >
          {b.logoUrl ? <img src={b.logoUrl} alt="" className="va-brand-logo" /> : <span className="va-brand-logo" />}
          <span>{b.name}</span>
        </button>
      ))}
    </div>
  );

  return (
    <nav className="va-brand-sidebar" aria-label="브랜드">
      {domestic.length > 0 && group("국산차", domestic)}
      {imported.length > 0 && group("수입차", imported)}
    </nav>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck` → 0 (아직 미사용이라 lint 경고 가능 — Task 6에서 연결 후 lint).

- [ ] **Step 3: 커밋**

```bash
git add client/src/pages/mc-master/BrandSidebar.tsx
git commit -m "feat(mc-master): BrandSidebar(국산/수입 그룹) (1b-i)"
```

---

## Task 4: ModelTable 컴포넌트

**Files:**
- Create: `client/src/pages/mc-master/ModelTable.tsx`

- [ ] **Step 1: 구현**

`client/src/pages/mc-master/ModelTable.tsx`:
```tsx
import { Pencil } from "lucide-react";

import { statusBadgeTone, statusLabel } from "@/data/vehicle-taxonomy";
import type { CatalogModel } from "@/lib/catalog";

function priceRange(min: number | null, max: number | null): string {
  if (min == null || max == null) return "—";
  const fmt = (n: number) => `${n.toLocaleString()}원`;
  return min === max ? fmt(min) : `${fmt(min)} ~ ${fmt(max)}`;
}

export function ModelTable({
  models,
  canEdit,
  onEdit,
}: {
  models: CatalogModel[];
  canEdit: boolean;
  onEdit: (model: CatalogModel) => void;
}) {
  if (models.length === 0) return <div className="va-empty">브랜드를 선택하세요.</div>;
  return (
    <div className="table-scroll">
      <table className="customer-table va-model-table">
        <thead>
          <tr>
            <th>모델명</th>
            <th>카테고리</th>
            <th>가격 범위</th>
            <th className="va-col-center">상태</th>
            <th className="va-col-center">트림 수</th>
            {canEdit && <th aria-label="편집" />}
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id}>
              <td className="va-model-name">
                {m.imageUrl && <img src={m.imageUrl} alt="" className="va-model-thumb" />}
                <span>{m.name}</span>
              </td>
              <td>{m.category ?? "—"}</td>
              <td>{priceRange(m.minPrice, m.maxPrice)}</td>
              <td className="va-col-center">
                <span className={`badge ${statusBadgeTone(m.status)}`}>{statusLabel(m.status)}</span>
              </td>
              <td className="va-col-center">{m.trimCount}</td>
              {canEdit && (
                <td className="va-col-center">
                  <button type="button" className="tiny-btn" aria-label={`${m.name} 수정`} onClick={() => onEdit(m)}>
                    <Pencil size={14} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

> `.badge`에 `gray`/`purple` 톤이 없으면 Task 6 CSS에서 추가. `priceRange`는 순수 함수라 Task 7에서 단위테스트 대상으로 export 고려(여기선 내부 사용).

- [ ] **Step 2: typecheck**

Run: `bun run typecheck` → 0

- [ ] **Step 3: 커밋**

```bash
git add client/src/pages/mc-master/ModelTable.tsx
git commit -m "feat(mc-master): ModelTable(모델명·카테고리·가격범위·상태·트림수) (1b-i)"
```

---

## Task 5: ModelEditPanel (추가/수정 겸용)

**Files:**
- Create: `client/src/pages/mc-master/ModelEditPanel.tsx`

- [ ] **Step 1: 구현**

`client/src/pages/mc-master/ModelEditPanel.tsx`:
```tsx
import { useState } from "react";
import { X } from "lucide-react";

import { MODEL_CATEGORIES, VEHICLE_STATUSES, type VehicleStatus, statusLabel } from "@/data/vehicle-taxonomy";
import type { CatalogModel } from "@/lib/catalog";

// model=null → 추가 모드, model 있음 → 수정 모드(이름 RO, category·status만).
export function ModelEditPanel({
  model,
  onClose,
  onSubmit,
  busy,
  error,
}: {
  model: CatalogModel | null;
  onClose: () => void;
  onSubmit: (values: { name: string; category: string | null; status: VehicleStatus }) => void;
  busy: boolean;
  error: string | null;
}) {
  const isEdit = model !== null;
  const [name, setName] = useState(model?.name ?? "");
  const [category, setCategory] = useState(model?.category ?? "");
  const [status, setStatus] = useState<VehicleStatus>(model?.status ?? "판매중");

  const canSubmit = isEdit || name.trim().length > 0;

  return (
    <div className="customer-detail-drawer-overlay" role="presentation">
      <button type="button" aria-label="패널 닫기" className="customer-detail-drawer-backdrop" onClick={onClose} />
      <aside className="customer-detail-drawer va-edit-drawer" role="dialog" aria-modal="true" aria-label={isEdit ? "모델 수정" : "모델 추가"}>
        <div className="panel-head">
          <h2>{isEdit ? "모델 수정" : "모델 추가"}</h2>
          <button type="button" className="tiny-btn" aria-label="닫기" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="panel-body va-form">
          <label className="va-field">
            <span>모델명{isEdit ? " (수정 불가)" : " *"}</span>
            <input className="input" value={name} disabled={isEdit} onChange={(e) => setName(e.currentTarget.value)} placeholder="예: 5 Series" />
          </label>
          <label className="va-field">
            <span>카테고리</span>
            <select className="select" value={category} onChange={(e) => setCategory(e.currentTarget.value)}>
              <option value="">미분류</option>
              {MODEL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="va-field">
            <span>상태</span>
            <select className="select" value={status} onChange={(e) => setStatus(e.currentTarget.value as VehicleStatus)}>
              {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </label>
          {status === "단종" && isEdit && model?.status !== "단종" && (
            <div className="notice-box"><span>단종 처리 시 하위 트림도 모두 단종됩니다.</span></div>
          )}
          {error && <div className="notice-box error">{error}</div>}
          <div className="va-form-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>취소</button>
            <button
              type="button"
              className="btn primary"
              disabled={!canSubmit || busy}
              onClick={() => onSubmit({ name: name.trim(), category: category || null, status })}
            >
              {busy ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck` → 0

- [ ] **Step 3: 커밋**

```bash
git add client/src/pages/mc-master/ModelEditPanel.tsx
git commit -m "feat(mc-master): ModelEditPanel(추가/수정 겸용 360px 패널) (1b-i)"
```

---

## Task 6: MCMasterPage 재구성 + 삭제 + 권한 게이트 + CSS

**Files:**
- Modify: `client/src/pages/MCMasterPage.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/index.css`

- [ ] **Step 1: `MCMasterPage.tsx` 전체 교체**

```tsx
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import type { RoleTab } from "@/data/roles";
import type { VehicleStatus } from "@/data/vehicle-taxonomy";
import {
  type CatalogBrand,
  type CatalogModel,
  createModel,
  deleteModel,
  fetchBrands,
  fetchModels,
  updateModel,
} from "@/lib/catalog";
import { BrandSidebar } from "./mc-master/BrandSidebar";
import { ModelEditPanel } from "./mc-master/ModelEditPanel";
import { ModelTable } from "./mc-master/ModelTable";

type PanelState = { mode: "add" } | { mode: "edit"; model: CatalogModel } | null;

export function MCMasterPage({ roleTab }: { roleTab: RoleTab }) {
  const canEdit = roleTab === "최고관리자";
  const [brands, setBrands] = useState<CatalogBrand[]>([]);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [panel, setPanel] = useState<PanelState>(null);
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetchBrands()
      .then((b) => {
        setBrands(b);
        setBrandId((cur) => cur ?? b[0]?.id ?? null);
      })
      .catch(() => setLoadError(true));
  }, []);

  function reloadModels(id: number) {
    fetchModels(id).then(setModels).catch(() => setLoadError(true));
  }

  useEffect(() => {
    if (brandId != null) reloadModels(brandId);
  }, [brandId]);

  async function submitPanel(values: { name: string; category: string | null; status: VehicleStatus }) {
    if (brandId == null || panel == null) return;
    setBusy(true);
    setPanelError(null);
    try {
      if (panel.mode === "add") {
        await createModel({ brandId, name: values.name, category: values.category, status: values.status });
      } else {
        await updateModel(panel.model.id, { category: values.category, status: values.status });
      }
      setPanel(null);
      reloadModels(brandId);
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(model: CatalogModel) {
    if (brandId == null) return;
    if (!window.confirm(`'${model.name}' 모델과 하위 트림·옵션·색상이 모두 삭제됩니다. 계속할까요?`)) return;
    try {
      await deleteModel(model.id);
      reloadModels(brandId);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "삭제 실패");
    }
  }

  return (
    <section className="card va-card">
      <div className="panel-head">
        <div>
          <h2>차량 관리</h2>
          <p className="va-subtitle">차선생 앱·견적 솔루션이 쓰는 브랜드/모델/트림 기준 데이터입니다. 편집 즉시 master에 반영됩니다.</p>
        </div>
        {canEdit && brandId != null && (
          <button type="button" className="btn primary" onClick={() => { setPanelError(null); setPanel({ mode: "add" }); }}>
            <Plus size={15} /> 모델 추가
          </button>
        )}
      </div>
      <div className="panel-body va-body">
        {loadError && <div className="notice-box error">불러오기 실패</div>}
        <div className="va-layout">
          <BrandSidebar brands={brands} selectedId={brandId} onSelect={setBrandId} />
          <ModelTable
            models={models}
            canEdit={canEdit}
            onEdit={(m) => { setPanelError(null); setPanel({ mode: "edit", model: m }); }}
            onDelete={handleDelete}
          />
        </div>
      </div>
      {panel && (
        <ModelEditPanel
          model={panel.mode === "edit" ? panel.model : null}
          busy={busy}
          error={panelError}
          onClose={() => setPanel(null)}
          onSubmit={submitPanel}
        />
      )}
    </section>
  );
}
```

> `ModelTable`에 `onDelete` prop 추가 필요 — Task 4 컴포넌트에 삭제 버튼(휴지통)을 연필 옆에 추가:
> ```tsx
> // ModelTable props에 onDelete: (m: CatalogModel) => void 추가, import { Pencil, Trash2 } from "lucide-react";
> // 편집 셀에 연필 + 삭제 버튼:
> //   <button className="tiny-btn" ... onClick={() => onEdit(m)}><Pencil size={14} /></button>
> //   <button className="tiny-btn va-danger" aria-label={`${m.name} 삭제`} onClick={() => onDelete(m)}><Trash2 size={14} /></button>
> ```
> (Task 4를 이 형태로 작성하거나 여기서 수정.)

- [ ] **Step 2: `App.tsx` — roleTab prop 복원**

`<Route path="/mc-master" element={<MCMasterPage />} />` → `<Route path="/mc-master" element={<MCMasterPage roleTab={roleTab} />} />`.

- [ ] **Step 3: `index.css` — `.va-*` 클래스 추가(파일 끝)**

```css
/* ── 차량 관리(mc-master) ───────────────────────────────────────────── */
.va-subtitle { margin: 4px 0 0; font-size: 12px; color: var(--muted); }
.va-body { padding: 0; }
.va-layout { display: grid; grid-template-columns: 168px minmax(0, 1fr); min-height: 420px; }
.va-brand-sidebar { border-right: 1px solid var(--line); padding: 12px 8px; display: flex; flex-direction: column; gap: 14px; }
.va-brand-group-label { font-size: 11px; font-weight: 780; color: var(--muted); padding: 0 8px 4px; }
.va-brand-item { display: flex; align-items: center; gap: 8px; width: 100%; height: 34px; padding: 0 8px; border: 0; background: transparent; border-radius: 7px; font-size: 13px; color: var(--text); cursor: pointer; }
.va-brand-item:hover { background: #f3f3f2; }
.va-brand-item.is-active { background: #f1edff; color: #5836ff; font-weight: 600; }
.va-brand-logo { width: 22px; height: 22px; border-radius: 50%; object-fit: contain; background: #fff; border: 1px solid var(--line-soft); flex: 0 0 auto; }
.va-model-table { width: 100%; }
.va-col-center { text-align: center; }
.va-model-name { display: flex; align-items: center; gap: 8px; }
.va-model-thumb { width: 48px; height: 28px; object-fit: contain; border-radius: 4px; }
.va-empty { padding: 48px 16px; text-align: center; color: var(--muted); font-size: 13px; }
.va-edit-drawer { width: min(380px, calc(100vw - 80px)); min-width: 0; }
.va-form { display: flex; flex-direction: column; gap: 14px; }
.va-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--muted); }
.va-field .input, .va-field .select { width: 100%; }
.va-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.tiny-btn.va-danger:hover { background: #fee4e2; color: #b42318; border-color: rgba(180,35,24,0.3); }
.badge.gray { background: #ececed; color: #5f6872; }
.badge.purple { background: #ece8ff; color: #5836ff; }
```

- [ ] **Step 4: 검증**

Run: `bun run typecheck` → 0
Run: `bun run lint` → 0
Run: `bun run build` → OK

- [ ] **Step 5: 커밋**

```bash
git add client/src/pages/MCMasterPage.tsx client/src/pages/mc-master/ModelTable.tsx client/src/App.tsx client/src/index.css
git commit -m "feat(mc-master): 차량 관리 화면 재구성 — 브랜드 사이드바+모델 테이블+추가/수정/삭제 (1b-i)"
```

---

## Task 7: 테스트 + 스크린샷 검증

**Files:**
- Modify: `client/src/pages/MCMasterPage.test.tsx`

- [ ] **Step 1: 테스트 교체(권한 게이트 + 렌더)**

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MCMasterPage } from "./MCMasterPage";

const BRANDS = [{ id: 1, name: "현대", logoUrl: null, isDomestic: true, isPopular: true, sortOrder: 1, brandCode: 1 }];
const MODELS = [{ id: 10, name: "그랜저", category: "준대형 세단", status: "판매중", sortOrder: 1, modelCode: 1, imageUrl: null, trimCount: 5, minPrice: 40000000, maxPrice: 55000000 }];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/catalog/brands") return new Response(JSON.stringify(BRANDS), { status: 200 });
      if (url.startsWith("/api/catalog/models")) return new Response(JSON.stringify(MODELS), { status: 200 });
      return new Response("[]", { status: 200 });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

it("브랜드·모델 렌더", async () => {
  render(<MCMasterPage roleTab="최고관리자" />);
  expect(await screen.findByText("그랜저")).toBeInTheDocument();
  expect(screen.getByText("현대")).toBeInTheDocument();
});

it("최고관리자는 모델 추가/수정 버튼 노출", async () => {
  render(<MCMasterPage roleTab="최고관리자" />);
  await screen.findByText("그랜저");
  expect(screen.getByRole("button", { name: /모델 추가/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "그랜저 수정" })).toBeInTheDocument();
});

it("상담사는 편집 버튼 숨김", async () => {
  render(<MCMasterPage roleTab="상담사" />);
  await screen.findByText("그랜저");
  expect(screen.queryByRole("button", { name: /모델 추가/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "그랜저 수정" })).toBeNull();
});
```

- [ ] **Step 2: 단위테스트 실행**

Run: `bun run test:unit client/src/pages/MCMasterPage.test.tsx` → PASS (3)

- [ ] **Step 3: 스크린샷 수동 확인(dev 기동)**

`bun run dev` 후 `localhost:5173/mc-master`에서 브랜드 선택→모델 테이블, 모델 추가/수정 패널, 삭제 확인 동작 육안 확인. (Playwright 캡처는 선택.)

- [ ] **Step 4: 커밋**

```bash
git add client/src/pages/MCMasterPage.test.tsx
git commit -m "test(mc-master): 차량 관리 모델 화면 렌더·권한 게이트 테스트 (1b-i)"
```

---

## Task 8: 최종 검증

- [ ] Run: `bun run typecheck` → 0
- [ ] Run: `bun run lint` → 0
- [ ] Run: `bun run test:unit` → 전체 PASS
- [ ] Run: `bun run build` → OK

---

## Self-Review

- **Spec coverage(1b-i 부분):** 브랜드 사이드바(국산/수입)✓ / 모델 테이블(모델명·카테고리·가격범위·상태·트림수)✓ / 모델 추가·수정(category·status, 이름 RO)·삭제(확인)✓ / 라이트 테마(CRM 클래스 재사용)✓ / 최고관리자 게이트✓ / status 라벨 매핑✓ / 라이브 반영 경고✓. 트림 드릴다운·옵션·색상편집은 1b-ii/iii.
- **Placeholder scan:** consts·lib 완전 코드. ModelTable의 onDelete는 Step 1 노트로 명시(Task 4 작성 시 포함). 시각 폴리시는 기존 CRM 클래스 재사용 + `.va-*` 추가로 구체.
- **Type consistency:** `CatalogModel`/`CatalogBrand`/`VehicleStatus` lib·consts에서 정의→컴포넌트·테스트 동일 사용. `MCMasterPage` props `{roleTab}` 복원을 App.tsx·테스트 반영.

## 미결 / 주의

- `ModelTable`은 Task 4에서 `onEdit`만, Task 6에서 `onDelete` 추가 — Task 4 작성 시 onDelete 포함해 한 번에(자기검토 반영).
- 트림 수 클릭 드릴다운은 1b-ii(이 단계 모델 행은 편집만).
- counts 요약은 제거(테이블의 트림수로 대체). 필요 시 후속 폴리시에서 상단 요약 재추가.
- 서버측 권한 강제는 이후(현재 UI 게이트). 라이브 master 편집이므로 삭제 확인 필수.

## Execution Handoff

1. **Inline (추천)** — executing-plans, task별 체크포인트.
2. **Subagent-Driven**.
</content>
