# 차량 관리 프론트 1b-ii: 트림 리스트 + 트림 CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans(inline). Steps는 체크박스(`- [ ]`)로 추적.

**Goal:** `/mc-master`에서 모델을 클릭하면 그 모델의 **트림 리스트**로 들어가 트림 추가/수정/삭제를 할 수 있게 한다(옵션·색상은 1b-iii).

**Architecture:** Phase 1a 백엔드 트림 API(`GET /api/catalog/trims?modelId=`, `POST /trims`, `PATCH /trims/:id`, `DELETE /trims/:id`)를 호출하는 프론트. `MCMasterPage`에 드릴다운 상태(선택 모델)를 추가해 모델 테이블 ↔ 트림 리스트를 전환. 1b-i 패턴/컴포넌트(드로어 패널·테이블·배지·게이트) 재사용.

**Tech Stack:** React 19, TypeScript 6.0.3, vite, vitest + @testing-library/react, lucide-react.

**Spec:** `ref/specs/2026-06-17-mc-master-vehicle-admin-design.md`. **선행:** 1b-i(#24, 머지) — 브랜드 사이드바·모델 CRUD.

**검증된 트림 필드(앱 trim_add/edit_panel):** 트림명*, 가격(원)*, 연식*, 연료*(select), 구동방식(select), 변속기(select), 배기량(cc), 차체, 인승, 상태(select). `canonical_name`은 서버(Phase 1a createTrim)가 계산. `name=trim_name`. 할인 3종·색상·옵션은 범위 밖.
**옵션 목록(앱):** 연료 = 가솔린/디젤/하이브리드/전기/LPG/가솔린 LPG/전기 수소. 구동 = RWD/FWD/AWD/4WD. 변속 = A/T·M/T.

---

## File Structure

- **Modify**: `client/src/data/vehicle-taxonomy.ts` — FUEL_TYPES·DRIVE_SYSTEMS·TRANSMISSION_TYPES const + 테스트.
- **Modify**: `client/src/lib/catalog.ts` — CatalogTrim 타입 + fetchTrims/createTrim/updateTrim/deleteTrim + 테스트.
- **Create**: `client/src/pages/mc-master/TrimTable.tsx` — 트림 테이블(트림명·고유번호·연식·가격·상태 + 연필/삭제).
- **Create**: `client/src/pages/mc-master/TrimEditPanel.tsx` — 추가/수정 겸용 360px 패널.
- **Modify**: `client/src/pages/mc-master/ModelTable.tsx` — 모델명 클릭 → 드릴다운(`onOpen`).
- **Modify**: `client/src/pages/MCMasterPage.tsx` — 드릴다운 상태 + 트림 뷰 + 트림 CRUD 핸들러.
- **Modify**: `client/src/pages/MCMasterPage.test.tsx` — 드릴다운/트림 렌더 테스트.
- **Modify**: `client/src/index.css` — `.va-trim-*` 보조 클래스.

---

## Task 1: taxonomy — 연료·구동·변속 옵션

**Files:**
- Modify: `client/src/data/vehicle-taxonomy.ts`
- Modify: `client/src/data/vehicle-taxonomy.test.ts`

- [ ] **Step 1: 테스트 추가(append)**

`vehicle-taxonomy.test.ts`:
```ts
import { DRIVE_SYSTEMS, FUEL_TYPES, TRANSMISSION_TYPES } from "./vehicle-taxonomy";

it("연료/구동/변속 옵션", () => {
  expect(FUEL_TYPES).toContain("가솔린");
  expect(FUEL_TYPES).toContain("전기");
  expect(DRIVE_SYSTEMS).toEqual(["RWD", "FWD", "AWD", "4WD"]);
  expect(TRANSMISSION_TYPES).toEqual(["A/T", "M/T"]);
});
```

- [ ] **Step 2: 구현(append)**

`vehicle-taxonomy.ts` 끝에:
```ts
// 트림 폼 옵션(앱 trim_add_panel). DB는 자유 텍스트라 문자열 저장.
export const FUEL_TYPES = ["가솔린", "디젤", "하이브리드", "전기", "LPG", "가솔린 LPG", "전기 수소"] as const;
export const DRIVE_SYSTEMS = ["RWD", "FWD", "AWD", "4WD"] as const;
export const TRANSMISSION_TYPES = ["A/T", "M/T"] as const;
```

- [ ] **Step 3: 통과 + 커밋**

Run: `bun run test:unit client/src/data/vehicle-taxonomy.test.ts` → PASS
```bash
git add client/src/data/vehicle-taxonomy.ts client/src/data/vehicle-taxonomy.test.ts
git commit -m "feat(mc-master): taxonomy 연료·구동·변속 옵션 (1b-ii)"
```

---

## Task 2: catalog lib — 트림 fetch/CRUD

**Files:**
- Modify: `client/src/lib/catalog.ts`
- Modify: `client/src/lib/catalog.test.ts`

- [ ] **Step 1: 타입 + fetch 추가(append, jsonOrThrow 재사용)**

`catalog.ts` 끝에:
```ts
export type CatalogTrim = {
  id: number;
  name: string;
  trimName: string;
  canonicalName: string | null;
  price: number;
  modelYear: number | null;
  fuelType: string | null;
  driveSystem: string | null;
  displacementCc: number | null;
  transmissionType: string | null;
  bodyStyle: string | null;
  seatingCapacity: number | null;
  status: VehicleStatus;
  mcCode: string | null;
  sortOrder: number | null;
};

export type TrimInput = {
  trimName: string;
  price: number;
  modelYear: number;
  fuelType: string;
  driveSystem?: string | null;
  displacementCc?: number | null;
  transmissionType?: string | null;
  bodyStyle?: string | null;
  seatingCapacity?: number | null;
  status?: VehicleStatus;
};

export async function fetchTrims(modelId: number): Promise<CatalogTrim[]> {
  return jsonOrThrow(await fetch(`/api/catalog/trims?modelId=${modelId}`));
}

export async function createTrim(modelId: number, input: TrimInput): Promise<CatalogTrim> {
  return jsonOrThrow(
    await fetch("/api/catalog/trims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId, ...input }),
    }),
  );
}

export async function updateTrim(id: number, input: Partial<TrimInput>): Promise<CatalogTrim> {
  return jsonOrThrow(
    await fetch(`/api/catalog/trims/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteTrim(id: number): Promise<{ id: number }> {
  return jsonOrThrow(await fetch(`/api/catalog/trims/${id}`, { method: "DELETE" }));
}
```

- [ ] **Step 2: 테스트 추가(append)**

`catalog.test.ts`:
```ts
import { createTrim, deleteTrim, fetchTrims, updateTrim } from "./catalog";

it("fetchTrims: modelId 쿼리", async () => {
  const spy = vi.fn(async (_url: string) => new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", spy);
  await fetchTrims(34);
  expect(spy.mock.calls[0][0]).toBe("/api/catalog/trims?modelId=34");
});

it("createTrim: POST에 modelId 병합", async () => {
  const spy = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ id: 1 }), { status: 200 }));
  vi.stubGlobal("fetch", spy);
  await createTrim(34, { trimName: "520i", price: 70000000, modelYear: 2026, fuelType: "가솔린" });
  expect(spy.mock.calls[0][1]?.method).toBe("POST");
  expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toMatchObject({ modelId: 34, trimName: "520i" });
});

it("updateTrim/deleteTrim 경로", async () => {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ id: 1 }), { status: 200 }));
  vi.stubGlobal("fetch", spy);
  await updateTrim(1, { price: 1 });
  expect(spy.mock.calls[0][0]).toBe("/api/catalog/trims/1");
  await deleteTrim(1);
  expect(spy.mock.calls[1][1]?.method).toBe("DELETE");
});
```

- [ ] **Step 3: typecheck + test + lint + 커밋**

Run: `bun run typecheck` → 0 / `bun run test:unit client/src/lib/catalog.test.ts` → PASS / `bun run lint` → 0
```bash
git add client/src/lib/catalog.ts client/src/lib/catalog.test.ts
git commit -m "feat(mc-master): catalog lib 트림 fetch/CRUD (1b-ii)"
```

---

## Task 3: TrimTable 컴포넌트

**Files:**
- Create: `client/src/pages/mc-master/TrimTable.tsx`

- [ ] **Step 1: 구현**

```tsx
import { Pencil, Trash2 } from "lucide-react";

import { statusBadgeTone, statusLabel } from "@/data/vehicle-taxonomy";
import type { CatalogTrim } from "@/lib/catalog";

export function TrimTable({
  trims,
  canEdit,
  onEdit,
  onDelete,
}: {
  trims: CatalogTrim[];
  canEdit: boolean;
  onEdit: (t: CatalogTrim) => void;
  onDelete: (t: CatalogTrim) => void;
}) {
  if (trims.length === 0) return <div className="va-empty">트림이 없습니다. ‘트림 추가’로 등록하세요.</div>;
  return (
    <div className="table-scroll">
      <table className="customer-table va-trim-table">
        <thead>
          <tr>
            <th>트림명</th>
            <th>고유번호</th>
            <th className="va-col-center">연식</th>
            <th>가격</th>
            <th className="va-col-center">상태</th>
            {canEdit && <th className="va-col-center" aria-label="편집" />}
          </tr>
        </thead>
        <tbody>
          {trims.map((t) => (
            <tr key={t.id}>
              <td>{t.trimName}</td>
              <td className="va-mono">{t.mcCode ?? "—"}</td>
              <td className="va-col-center">{t.modelYear ?? "—"}</td>
              <td>{t.price.toLocaleString()}원</td>
              <td className="va-col-center">
                <span className={`badge ${statusBadgeTone(t.status)}`}>{statusLabel(t.status)}</span>
              </td>
              {canEdit && (
                <td className="va-col-center">
                  <div className="va-row-actions">
                    <button type="button" className="tiny-btn" aria-label={`${t.trimName} 수정`} onClick={() => onEdit(t)}>
                      <Pencil size={14} />
                    </button>
                    <button type="button" className="tiny-btn va-danger" aria-label={`${t.trimName} 삭제`} onClick={() => onDelete(t)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
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

- [ ] **Step 2: typecheck → 0 → 커밋**

```bash
git add client/src/pages/mc-master/TrimTable.tsx
git commit -m "feat(mc-master): TrimTable (1b-ii)"
```

---

## Task 4: TrimEditPanel 컴포넌트

**Files:**
- Create: `client/src/pages/mc-master/TrimEditPanel.tsx`

- [ ] **Step 1: 구현**

```tsx
import { useState } from "react";
import { X } from "lucide-react";

import { DRIVE_SYSTEMS, FUEL_TYPES, TRANSMISSION_TYPES, VEHICLE_STATUSES, type VehicleStatus, statusLabel } from "@/data/vehicle-taxonomy";
import type { CatalogTrim, TrimInput } from "@/lib/catalog";

const num = (s: string): number | null => {
  const n = Number(s.replace(/[^0-9]/g, ""));
  return s.trim() === "" || Number.isNaN(n) ? null : n;
};

export function TrimEditPanel({
  trim,
  onClose,
  onSubmit,
  busy,
  error,
}: {
  trim: CatalogTrim | null;
  onClose: () => void;
  onSubmit: (values: TrimInput) => void;
  busy: boolean;
  error: string | null;
}) {
  const isEdit = trim !== null;
  const [trimName, setTrimName] = useState(trim?.trimName ?? "");
  const [price, setPrice] = useState(trim ? String(trim.price) : "");
  const [modelYear, setModelYear] = useState(String(trim?.modelYear ?? 2026));
  const [fuelType, setFuelType] = useState(trim?.fuelType ?? "가솔린");
  const [driveSystem, setDriveSystem] = useState(trim?.driveSystem ?? "FWD");
  const [transmissionType, setTransmissionType] = useState(trim?.transmissionType ?? "A/T");
  const [displacementCc, setDisplacementCc] = useState(trim?.displacementCc != null ? String(trim.displacementCc) : "");
  const [bodyStyle, setBodyStyle] = useState(trim?.bodyStyle ?? "");
  const [seatingCapacity, setSeatingCapacity] = useState(trim?.seatingCapacity != null ? String(trim.seatingCapacity) : "");
  const [status, setStatus] = useState<VehicleStatus>(trim?.status ?? "판매중");

  const priceNum = num(price);
  const yearNum = num(modelYear);
  const canSubmit = trimName.trim().length > 0 && priceNum != null && yearNum != null;

  return (
    <div className="customer-detail-drawer-overlay" role="presentation">
      <button type="button" aria-label="패널 닫기" className="customer-detail-drawer-backdrop" onClick={onClose} />
      <aside className="customer-detail-drawer va-edit-drawer" role="dialog" aria-modal="true" aria-label={isEdit ? "트림 수정" : "트림 추가"}>
        <div className="panel-head">
          <h2>{isEdit ? "트림 수정" : "트림 추가"}</h2>
          <button type="button" className="tiny-btn" aria-label="닫기" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="panel-body va-form">
          <label className="va-field"><span>트림명 *</span>
            <input className="input" value={trimName} onChange={(e) => setTrimName(e.currentTarget.value)} placeholder="예: 520i" />
          </label>
          <label className="va-field"><span>가격(원) *</span>
            <input className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.currentTarget.value)} placeholder="예: 70000000" />
          </label>
          <label className="va-field"><span>연식 *</span>
            <input className="input" inputMode="numeric" value={modelYear} onChange={(e) => setModelYear(e.currentTarget.value)} />
          </label>
          <label className="va-field"><span>연료 *</span>
            <select className="select" value={fuelType} onChange={(e) => setFuelType(e.currentTarget.value)}>
              {FUEL_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="va-field"><span>구동방식</span>
            <select className="select" value={driveSystem} onChange={(e) => setDriveSystem(e.currentTarget.value)}>
              {DRIVE_SYSTEMS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="va-field"><span>변속기</span>
            <select className="select" value={transmissionType} onChange={(e) => setTransmissionType(e.currentTarget.value)}>
              {TRANSMISSION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="va-field"><span>배기량(cc)</span>
            <input className="input" inputMode="numeric" value={displacementCc} onChange={(e) => setDisplacementCc(e.currentTarget.value)} />
          </label>
          <label className="va-field"><span>차체</span>
            <input className="input" value={bodyStyle} onChange={(e) => setBodyStyle(e.currentTarget.value)} placeholder="예: 세단" />
          </label>
          <label className="va-field"><span>인승</span>
            <input className="input" inputMode="numeric" value={seatingCapacity} onChange={(e) => setSeatingCapacity(e.currentTarget.value)} />
          </label>
          <label className="va-field"><span>상태</span>
            <select className="select" value={status} onChange={(e) => setStatus(e.currentTarget.value as VehicleStatus)}>
              {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </label>
          {error && <div className="notice-box error">{error}</div>}
          <div className="va-form-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>취소</button>
            <button
              type="button"
              className="btn primary"
              disabled={!canSubmit || busy}
              onClick={() =>
                onSubmit({
                  trimName: trimName.trim(),
                  price: priceNum as number,
                  modelYear: yearNum as number,
                  fuelType,
                  driveSystem,
                  transmissionType,
                  displacementCc: num(displacementCc),
                  bodyStyle: bodyStyle.trim() || null,
                  seatingCapacity: num(seatingCapacity),
                  status,
                })
              }
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

- [ ] **Step 2: typecheck → 0 → 커밋**

```bash
git add client/src/pages/mc-master/TrimEditPanel.tsx
git commit -m "feat(mc-master): TrimEditPanel (1b-ii)"
```

---

## Task 5: ModelTable 드릴다운 + MCMasterPage 트림 뷰 배선

**Files:**
- Modify: `client/src/pages/mc-master/ModelTable.tsx`
- Modify: `client/src/pages/MCMasterPage.tsx`
- Modify: `client/src/index.css`

- [ ] **Step 1: ModelTable 모델명 클릭 → onOpen**

`ModelTable` props에 `onOpen: (m: CatalogModel) => void` 추가. 모델명 `<td>`의 이름 텍스트를 버튼으로:
```tsx
// import에 변화 없음. <td className="va-model-name"> 내부 <span>{m.name}</span> 를:
<button type="button" className="va-link" onClick={() => onOpen(m)}>{m.name}</button>
```
(이미지 썸네일은 유지, 이름만 링크 버튼.)

- [ ] **Step 2: MCMasterPage에 드릴다운 + 트림 CRUD 추가**

`MCMasterPage.tsx` 변경:
- import 추가: `fetchTrims, createTrim, updateTrim, deleteTrim, type CatalogTrim, type TrimInput`(@/lib/catalog), `TrimTable`(./mc-master/TrimTable), `TrimEditPanel`(./mc-master/TrimEditPanel), `ArrowLeft, Plus`(lucide-react).
- 상태 추가:
```tsx
const [openModel, setOpenModel] = useState<CatalogModel | null>(null);
const [trims, setTrims] = useState<CatalogTrim[]>([]);
const [trimPanel, setTrimPanel] = useState<{ mode: "add" } | { mode: "edit"; trim: CatalogTrim } | null>(null);
const [trimBusy, setTrimBusy] = useState(false);
const [trimError, setTrimError] = useState<string | null>(null);
```
- effect: `openModel` 바뀌면 트림 로드:
```tsx
useEffect(() => {
  if (openModel == null) return;
  fetchTrims(openModel.id).then(setTrims).catch(() => setLoadError(true));
}, [openModel]);
```
- 브랜드 바뀌면 드릴다운 해제: 기존 brandId effect 안에서 `setOpenModel(null)` 추가.
- 핸들러:
```tsx
function reloadTrims() {
  if (openModel == null) return;
  fetchTrims(openModel.id).then(setTrims).catch(() => setLoadError(true));
}
async function submitTrim(values: TrimInput) {
  if (openModel == null || trimPanel == null) return;
  setTrimBusy(true); setTrimError(null);
  try {
    if (trimPanel.mode === "add") await createTrim(openModel.id, values);
    else await updateTrim(trimPanel.trim.id, values);
    setTrimPanel(null); reloadTrims(); reloadModels(); // 모델 집계(트림수/가격범위) 갱신
  } catch (e) { setTrimError(e instanceof Error ? e.message : "저장 실패"); }
  finally { setTrimBusy(false); }
}
async function handleDeleteTrim(t: CatalogTrim) {
  if (!window.confirm(`'${t.trimName}' 트림과 하위 옵션·색상이 모두 삭제됩니다. 계속할까요?`)) return;
  try { await deleteTrim(t.id); reloadTrims(); reloadModels(); }
  catch (e) { window.alert(e instanceof Error ? e.message : "삭제 실패"); }
}
```
- 렌더: panel-head 제목/액션과 본문을 `openModel` 유무로 분기.
  - 제목: openModel 있으면 `← {openModel.name}`(뒤로 버튼 = `setOpenModel(null)`), 액션은 `트림 추가`(canEdit). 없으면 기존 `차량 관리` + `모델 추가`.
  - 본문 우측(테이블 영역): openModel 있으면 `<TrimTable .../>`, 없으면 `<ModelTable ... onOpen={setOpenModel} />`. 사이드바는 항상.
  - 패널: 기존 ModelEditPanel + `trimPanel && <TrimEditPanel .../>`.

구체 렌더(테이블 영역 교체):
```tsx
<div className="va-layout">
  <BrandSidebar brands={brands} selectedId={brandId} onSelect={setBrandId} />
  {openModel ? (
    <TrimTable trims={trims} canEdit={canEdit} onEdit={(t) => { setTrimError(null); setTrimPanel({ mode: "edit", trim: t }); }} onDelete={handleDeleteTrim} />
  ) : (
    <ModelTable models={models} canEdit={canEdit} onOpen={setOpenModel} onEdit={(m) => { setPanelError(null); setPanel({ mode: "edit", model: m }); }} onDelete={handleDelete} />
  )}
</div>
```
panel-head 분기:
```tsx
<div className="panel-head">
  {openModel ? (
    <>
      <div className="va-head-back">
        <button type="button" className="tiny-btn" aria-label="뒤로" onClick={() => setOpenModel(null)}><ArrowLeft size={15} /></button>
        <h2>{openModel.name}</h2>
      </div>
      {canEdit && <button type="button" className="btn primary" onClick={() => { setTrimError(null); setTrimPanel({ mode: "add" }); }}><Plus size={15} /> 트림 추가</button>}
    </>
  ) : (
    <>
      <div><h2>차량 관리</h2><p className="va-subtitle">차선생 앱·견적 솔루션이 쓰는 기준 데이터입니다. 편집 즉시 master에 반영됩니다.</p></div>
      {canEdit && brandId != null && <button type="button" className="btn primary" onClick={() => { setPanelError(null); setPanel({ mode: "add" }); }}><Plus size={15} /> 모델 추가</button>}
    </>
  )}
</div>
```
하단 패널:
```tsx
{trimPanel && (
  <TrimEditPanel
    trim={trimPanel.mode === "edit" ? trimPanel.trim : null}
    busy={trimBusy}
    error={trimError}
    onClose={() => setTrimPanel(null)}
    onSubmit={submitTrim}
  />
)}
```

- [ ] **Step 3: index.css 보조 클래스(append)**

```css
.va-link { border: 0; background: transparent; padding: 0; font: inherit; color: #5836ff; cursor: pointer; }
.va-link:hover { text-decoration: underline; }
.va-head-back { display: flex; align-items: center; gap: 8px; }
.va-mono { font-variant-numeric: tabular-nums; color: #5f6872; }
```

- [ ] **Step 4: typecheck + lint + build**

Run: `bun run typecheck` → 0 / `bun run lint` → 0 / `bun run build` → OK

- [ ] **Step 5: 커밋**

```bash
git add client/src/pages/MCMasterPage.tsx client/src/pages/mc-master/ModelTable.tsx client/src/index.css
git commit -m "feat(mc-master): 모델 드릴다운 → 트림 리스트 + 트림 CRUD 배선 (1b-ii)"
```

---

## Task 6: 테스트

**Files:**
- Modify: `client/src/pages/MCMasterPage.test.tsx`

- [ ] **Step 1: 드릴다운/트림 테스트 추가**

fetch mock에 `/api/catalog/trims` 분기 추가(모델별 트림 1건), 테스트:
```ts
// mock fetch에 추가:
//   if (url.startsWith("/api/catalog/trims")) return new Response(JSON.stringify(TRIMS), { status: 200 });
// const TRIMS = [{ id: 100, name: "캐스퍼 1.0", trimName: "캐스퍼 1.0", canonicalName: null, price: 15000000, modelYear: 2026, fuelType: "가솔린", driveSystem: "FWD", displacementCc: 998, transmissionType: "A/T", bodyStyle: null, seatingCapacity: 4, status: "판매중", mcCode: null, sortOrder: 1 }];

it("모델 클릭 시 트림 리스트로 드릴다운", async () => {
  const user = userEvent.setup();
  render(<MCMasterPage roleTab="최고관리자" />);
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  expect(await screen.findByText("캐스퍼 1.0")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /트림 추가/ })).toBeInTheDocument();
});
```
(상단 import에 `import userEvent from "@testing-library/user-event";` 추가.)

- [ ] **Step 2: 실행 + 커밋**

Run: `bun run test:unit client/src/pages/MCMasterPage.test.tsx` → PASS
```bash
git add client/src/pages/MCMasterPage.test.tsx
git commit -m "test(mc-master): 트림 드릴다운 렌더 테스트 (1b-ii)"
```

---

## Task 7: 최종 검증

- [ ] `bun run typecheck` → 0 / `bun run lint` → 0 / `bun run test:unit` → 전체 PASS / `bun run build` → OK
- [ ] (수동) dev 재시작 후 모델 클릭 → 트림 리스트 → 트림 추가/수정/삭제 + 뒤로 동작 확인.

---

## Self-Review

- **Spec coverage(1b-ii):** 트림 리스트(트림명·고유번호·연식·가격·상태)✓ / 트림 추가·수정(전 필드, canonical 서버계산)·삭제(확인)✓ / 모델 드릴다운·뒤로✓ / 최고관리자 게이트✓ / 트림 변경 시 모델 집계 갱신(reloadModels)✓. 옵션·색상은 1b-iii.
- **Placeholder scan:** lib·taxonomy·컴포넌트 완전 코드. Task 5는 기존 MCMasterPage(1b-i) 위 변경이라 추가 상태/핸들러/렌더 분기를 구체 코드로 제시.
- **Type consistency:** `CatalogTrim`/`TrimInput` lib 정의→TrimTable·TrimEditPanel·MCMasterPage 동일. `ModelTable`에 `onOpen` 추가를 호출처(MCMasterPage) 반영. `num()` 헬퍼는 패널 내부.

## 미결 / 주의

- bun API 핫리로드 없음 → dev 재시작 후 동작(1a 라우트는 이미 master 검증).
- 트림 수정 시 canonical 재계산 안 함(생성 시만, 1a 설계). 트림명 변경 시 표시상 canonical 불일치 가능 — Phase 2 고려.
- 국산차 트림명 형식(`' - '`) 위반 시 서버가 한글 에러(1a `dbErrorMessage`) → 패널 error 영역 표시.
- 옵션 아이콘/색상 칩은 1b-iii에서 트림 행에 추가.

## Execution Handoff

1. **Inline (추천)** — executing-plans, task별 체크포인트.
2. **Subagent-Driven**.
</content>
