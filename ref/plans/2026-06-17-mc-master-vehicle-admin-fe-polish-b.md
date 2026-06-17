# 차량 관리 프론트 보강-B: 선택 모드(일괄삭제 + 드래그 순서변경) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans(inline). Steps는 체크박스(`- [ ]`).

**Goal:** 모델/트림 테이블에 앱과 동일한 **선택 모드** 추가 — 우상단 `선택` 토글 → 행 체크박스(+전체선택) + `선택 삭제 (N)` 일괄삭제 + **드래그 앤 드롭 순서변경**(`batch_update_sort_order`).

**Architecture:** 백엔드에 reorder 엔드포인트(`batch_update_sort_order` RPC 래핑) + lib 함수 추가. 프론트는 순수 reorder 유틸(`moveItem`) + ModelTable/TrimTable에 선택·드래그 prop 추가 + MCMasterPage가 선택 상태/일괄삭제/순서변경 핸들러 보유. DnD는 HTML5 draggable(라이브러리 없음).

**Tech Stack:** drizzle-orm(sql) + postgres-js, Hono+zod, React 19, react-router, vitest, lucide-react(GripVertical, Trash2, X).

**선행:** 보강-A(#26) 머지. **다음:** 1b-iii(옵션+색상).

**확인된 RPC:** `public.batch_update_sort_order(p_table text, p_ids int[], p_sort_orders int[])` — CRM(postgres) 호출 가능. p_table='models'|'trims'. 내부에서 temp 값으로 UNIQUE 충돌 회피. ids/sort_orders는 같은 길이 배열, 위치가 곧 순서.

---

## File Structure

- **Modify**: `src/db/queries/catalog-admin.ts` — `reorderCatalog(table, orderedIds)` 추가.
- **Modify**: `src/routes/catalog.ts` — `POST /api/catalog/models/reorder`·`/trims/reorder`.
- **Modify**: `src/db/queries/catalog-admin.test.ts` — reorder tx 롤백 테스트.
- **Create**: `client/src/pages/mc-master/reorder.ts` — 순수 `moveItem` 유틸.
- **Create**: `client/src/pages/mc-master/reorder.test.ts` — moveItem 단위테스트.
- **Modify**: `client/src/lib/catalog.ts` — `reorderModels(ids)`·`reorderTrims(ids)` + 테스트.
- **Modify**: `client/src/pages/mc-master/ModelTable.tsx` — 선택·드래그 prop.
- **Modify**: `client/src/pages/mc-master/TrimTable.tsx` — 선택·드래그 prop.
- **Modify**: `client/src/pages/MCMasterPage.tsx` — 선택 상태/토글/일괄삭제/순서변경 배선.
- **Modify**: `client/src/pages/MCMasterPage.test.tsx` — 선택 모드 테스트.
- **Modify**: `client/src/index.css` — `.va-select-*`/드래그 스타일.

---

## Task 1: 백엔드 reorder (query + route + tx 테스트)

**Files:** Modify `src/db/queries/catalog-admin.ts`, `src/routes/catalog.ts`, `src/db/queries/catalog-admin.test.ts`

- [ ] **Step 1: catalog-admin.ts에 reorder 추가**

import에 `sql` 추가(`import { asc, count, eq, max, min, sql } from "drizzle-orm";`). 파일 끝에:
```ts
// 순서변경: orderedIds 위치(1..N)를 sort_order로. public.batch_update_sort_order RPC가
// temp 값으로 UNIQUE(brand_id/model_id, sort_order) 충돌을 회피한다. table='models'|'trims'.
export async function reorderCatalog(
  table: "models" | "trims",
  orderedIds: number[],
  executor: Executor = db,
): Promise<void> {
  if (orderedIds.length === 0) return;
  const sortOrders = orderedIds.map((_, i) => i + 1);
  await executor.execute(
    sql`select public.batch_update_sort_order(${table}, ${sql.param(orderedIds)}::int[], ${sql.param(sortOrders)}::int[])`,
  );
}
```
> 배열 바인딩이 안 먹으면(드라이버) `sql.param` 대신 `${orderedIds}` 직접 + `::int[]` 캐스트를 시도하거나, postgres-js 배열 인코딩을 확인. Step 4 테스트로 검증.

- [ ] **Step 2: 라우트 추가(`src/routes/catalog.ts`)**

import에 `reorderCatalog` 추가. 모델 delete 라우트 아래·트림 섹션 위 등 적절히:
```ts
catalog.post(
  "/models/reorder",
  zValidator("json", z.object({ ids: z.array(id).min(1) })),
  async (c) => run(c, async () => {
    await reorderCatalog("models", c.req.valid("json").ids);
    return { ok: true };
  }),
);
catalog.post(
  "/trims/reorder",
  zValidator("json", z.object({ ids: z.array(id).min(1) })),
  async (c) => run(c, async () => {
    await reorderCatalog("trims", c.req.valid("json").ids);
    return { ok: true };
  }),
);
```

- [ ] **Step 3: typecheck + lint**

Run: `bun run typecheck` → 0 / `bun run lint` → 0

- [ ] **Step 4: tx 롤백 테스트(`catalog-admin.test.ts`)에 reorder 검증 추가**

기존 테스트의 tx 안, 트림 생성 후 트림 2개 만들어 reorder 검증하거나, 별도 test. 간단히: 한 모델 아래 트림 2개 생성 → `reorderCatalog("trims", [t2.id, t1.id], tx)` → tx에서 sort_order 뒤바뀜 확인. (prod 무변경)
```ts
// 기존 test 내부 trim 생성부 뒤에 트림 하나 더 생성 후:
//   const t2 = await createTrim({ modelId: model.id, trimName: "테스트트림2", price: 60000000, modelYear: 2026, fuelType: "가솔린" }, tx);
//   await reorderCatalog("trims", [t2.id, trim.id], tx);
//   const ordered = await tx.select({ id: trimsInCatalog.id, so: trimsInCatalog.sortOrder })
//     .from(trimsInCatalog).where(eq(trimsInCatalog.modelId, model.id)).orderBy(asc(trimsInCatalog.sortOrder));
//   expect(ordered[0].id).toBe(t2.id); // t2가 sort_order 1
```
(import에 `asc` 필요 시 추가.)

Run: `DATABASE_URL="$DBURL" bun test src/db/queries/catalog-admin.test.ts` → PASS, psql 잔존 0.

> 배열 바인딩 실패 시 여기서 드러남 → Step 1 주석대로 조정.

- [ ] **Step 5: 커밋**

```bash
git add src/db/queries/catalog-admin.ts src/routes/catalog.ts src/db/queries/catalog-admin.test.ts
git commit -m "feat(catalog-admin): 순서변경 reorder API(batch_update_sort_order 래핑) (보강-B)"
```

---

## Task 2: lib reorder + 순수 moveItem 유틸

**Files:** Create `client/src/pages/mc-master/reorder.ts`, `reorder.test.ts`; Modify `client/src/lib/catalog.ts`, `client/src/lib/catalog.test.ts`

- [ ] **Step 1: moveItem 유틸 + 테스트**

`client/src/pages/mc-master/reorder.ts`:
```ts
// 배열에서 from→to로 항목 이동(드래그 순서변경의 순수 로직).
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
```
`reorder.test.ts`:
```ts
import { expect, it } from "vitest";
import { moveItem } from "./reorder";

it("from→to 이동", () => {
  expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
  expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
});
it("동일/범위밖이면 원본", () => {
  expect(moveItem([1, 2], 1, 1)).toEqual([1, 2]);
  expect(moveItem([1, 2], 5, 0)).toEqual([1, 2]);
});
```

- [ ] **Step 2: lib reorder 함수 + 테스트**

`catalog.ts`에:
```ts
export async function reorderModels(ids: number[]): Promise<void> {
  await jsonOrThrow(
    await fetch("/api/catalog/models/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  );
}
export async function reorderTrims(ids: number[]): Promise<void> {
  await jsonOrThrow(
    await fetch("/api/catalog/trims/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  );
}
```
`catalog.test.ts`에:
```ts
import { reorderModels, reorderTrims } from "./catalog";
it("reorderModels/Trims: POST ids", async () => {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", spy);
  await reorderModels([3, 1, 2]);
  expect(spy.mock.calls[0][0]).toBe("/api/catalog/models/reorder");
  expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ ids: [3, 1, 2] });
  await reorderTrims([2, 1]);
  expect(spy.mock.calls[1][0]).toBe("/api/catalog/trims/reorder");
});
```

- [ ] **Step 3: typecheck + test + lint + 커밋**

Run: `bun run typecheck` → 0 / `bun run test:unit client/src/pages/mc-master/reorder.test.ts client/src/lib/catalog.test.ts` → PASS / `bun run lint` → 0
```bash
git add client/src/pages/mc-master/reorder.ts client/src/pages/mc-master/reorder.test.ts client/src/lib/catalog.ts client/src/lib/catalog.test.ts
git commit -m "feat(mc-master): reorder lib + moveItem 순수 유틸 (보강-B)"
```

---

## Task 3: ModelTable·TrimTable 선택 + 드래그

**Files:** Modify `client/src/pages/mc-master/ModelTable.tsx`, `client/src/pages/mc-master/TrimTable.tsx`

공통 패턴: props에 `selectMode`, `selected: Set<number>`, `onToggle(id)`, `onToggleAll()`, `dragId`/`onDragStart(id)`·`onDragEnter(id)`·`onDrop()` 추가. 선택 모드일 때 첫 칸에 체크박스(헤더=전체선택) + 행 `draggable` + 드래그 핸들. 편집(연필/삭제) 칸은 선택 모드에서 숨김(앱과 동일하게 선택 모드/편집 분리).

- [ ] **Step 1: ModelTable 선택·드래그 prop 추가**

`ModelTable` props 확장 + 렌더:
```tsx
import { GripVertical, Pencil, Trash2 } from "lucide-react";
// props 추가: selectMode: boolean; selected: Set<number>; onToggle: (id: number) => void;
//   onToggleAll: () => void; onDragStart: (id: number) => void; onDragEnter: (id: number) => void; onDrop: () => void;
```
헤더 첫 칸: `selectMode && <th className="va-col-sel"><input type="checkbox" checked={...} onChange={onToggleAll} aria-label="전체 선택" /></th>`.
행: `<tr draggable={selectMode} onDragStart={() => onDragStart(m.id)} onDragEnter={() => onDragEnter(m.id)} onDragEnd={onDrop} onDragOver={(e) => e.preventDefault()}>` 첫 칸 `selectMode && <td className="va-col-sel"><GripVertical .../> <input type="checkbox" checked={selected.has(m.id)} onChange={() => onToggle(m.id)} aria-label={`${m.name} 선택`} /></td>`. 편집 칸은 `{canEdit && !selectMode && (...)}`로.
전체선택 checked = `models.length>0 && models.every(m=>selected.has(m.id))`.

- [ ] **Step 2: TrimTable 동일 패턴 적용**(트림명/필드 유지, 첫 칸 선택·드래그, 편집 칸 선택모드 숨김).

- [ ] **Step 3: typecheck → 0 → 커밋**

```bash
git add client/src/pages/mc-master/ModelTable.tsx client/src/pages/mc-master/TrimTable.tsx
git commit -m "feat(mc-master): ModelTable·TrimTable 선택 체크박스 + 드래그 핸들 (보강-B)"
```

---

## Task 4: MCMasterPage 선택 모드 배선

**Files:** Modify `client/src/pages/MCMasterPage.tsx`, `client/src/index.css`

- [ ] **Step 1: 선택 상태 + 핸들러**

import: `moveItem`(./mc-master/reorder), `reorderModels, reorderTrims`(@/lib/catalog), `CheckSquare, X`(lucide). 상태:
```tsx
const [selectMode, setSelectMode] = useState(false);
const [selected, setSelected] = useState<Set<number>>(new Set());
const dragId = useRef<number | null>(null);
```
(`useRef` import 추가.) 뷰 전환(모델↔트림, 브랜드 변경)·드릴다운 시 selectMode/selected 리셋은 핸들러에서 처리(effect 동기 setState 금지). 즉 `selectBrand`·`navigate` 호출부와 `선택` 토글에서 `setSelectMode(false); setSelected(new Set())`를 적절히.

토글/선택/드래그 핸들러(모델·트림 공용 패턴, 현재 뷰의 목록과 reorder 함수만 다름):
```tsx
const rows: Array<CatalogModel | CatalogTrim> = modelId ? trims : models;
function toggle(idv: number) {
  setSelected((s) => { const n = new Set(s); n.has(idv) ? n.delete(idv) : n.add(idv); return n; });
}
function toggleAll() {
  setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
}
function onDragStart(idv: number) { dragId.current = idv; }
function onDragEnter(overId: number) {
  const cur = dragId.current;
  if (cur == null || cur === overId) return;
  if (modelId) {
    const from = trims.findIndex((t) => t.id === cur), to = trims.findIndex((t) => t.id === overId);
    setTrims((list) => moveItem(list, from, to));
  } else {
    const from = models.findIndex((m) => m.id === cur), to = models.findIndex((m) => m.id === overId);
    setModels((list) => moveItem(list, from, to));
  }
}
async function onDrop() {
  dragId.current = null;
  try {
    if (modelId) await reorderTrims(trims.map((t) => t.id));
    else await reorderModels(models.map((m) => m.id));
  } catch (e) { window.alert(e instanceof Error ? e.message : "순서변경 실패"); reloadModelsAndTrims(); }
}
async function bulkDelete() {
  const ids = [...selected];
  if (ids.length === 0) return;
  if (!window.confirm(`선택한 ${ids.length}개와 하위 데이터가 모두 삭제됩니다. 계속할까요?`)) return;
  try {
    for (const idv of ids) modelId ? await deleteTrim(idv) : await deleteModel(idv);
    setSelected(new Set());
    if (modelId) { reloadTrims(); reloadModels(); } else reloadModels();
  } catch (e) { window.alert(e instanceof Error ? e.message : "삭제 실패"); }
}
```
(`reloadModelsAndTrims` = reloadModels + (modelId? reloadTrims): 간단 inline.)

- [ ] **Step 2: panel-head에 `선택`/`선택 삭제 (N)` 버튼 + 테이블에 prop 전달**

`추가` 버튼 옆(canEdit): `선택` 토글(OutlinedButton 느낌 `.btn`), 선택 모드 + selected.size>0이면 `선택 삭제 (N)`(빨강). `선택` 클릭 → `setSelectMode(v=>!v); setSelected(new Set())`.
ModelTable/TrimTable에 `selectMode/selected/onToggle/onToggleAll/onDragStart/onDragEnter/onDrop` 전달.

- [ ] **Step 3: index.css 선택/드래그 스타일**

```css
.va-col-sel { width: 64px; text-align: center; white-space: nowrap; }
.va-col-sel .lucide { color: #b8bcc2; cursor: grab; vertical-align: middle; margin-right: 4px; }
.va-model-table tr[draggable="true"], .va-trim-table tr[draggable="true"] { cursor: grab; }
.va-danger-btn { color: #b42318; border-color: rgba(180,35,24,0.3); }
.va-danger-btn:hover { background: #fee4e2; }
```

- [ ] **Step 4: typecheck + lint + build → 0/0/OK → 커밋**

```bash
git add client/src/pages/MCMasterPage.tsx client/src/index.css
git commit -m "feat(mc-master): 선택 모드 — 일괄삭제 + 드래그 순서변경 배선 (보강-B)"
```

---

## Task 5: 테스트 + 최종 검증

**Files:** Modify `client/src/pages/MCMasterPage.test.tsx`

- [ ] **Step 1: 선택 모드 테스트**

```tsx
it("선택 모드: 체크박스 + 선택 삭제 노출", async () => {
  const user = userEvent.setup();
  renderPage("최고관리자");
  await screen.findByText("그랜저");
  await user.click(screen.getByRole("button", { name: /^선택$/ }));
  expect(screen.getByRole("checkbox", { name: "전체 선택" })).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "그랜저 선택" }));
  expect(screen.getByRole("button", { name: /선택 삭제/ })).toBeInTheDocument();
});
```
(fetch mock에 reorder/delete 분기는 기본 `[]`/200으로 충분.)

- [ ] **Step 2: 전체 게이트**

Run: `bun run typecheck` → 0 / `bun run lint` → 0 / `bun run test:unit` → 전체 PASS / `bun run build` → OK
Run(서버): `DATABASE_URL="$DBURL" bun run test:server` → reorder tx 테스트 포함 PASS

- [ ] **Step 3: (수동) dev 재시작 후** 선택 토글 → 체크박스/드래그 핸들, 드래그로 순서변경(새로고침 유지), 선택 삭제 동작 확인.

- [ ] **Step 4: 커밋**

```bash
git add client/src/pages/MCMasterPage.test.tsx
git commit -m "test(mc-master): 선택 모드 렌더 테스트 (보강-B)"
```

---

## Self-Review

- **요구 커버:** 선택 토글 + 체크박스(전체선택)✓ / 일괄삭제✓ / 드래그 순서변경(batch_update_sort_order)✓ / 모델·트림 양쪽✓. 앱 패리티 완료 → 다음 1b-iii.
- **Placeholder scan:** 백엔드/lib/유틸 완전 코드. 테이블·페이지 배선은 prop/핸들러 구체 코드. DnD는 HTML5 draggable + moveItem(순수, 단위테스트).
- **Type consistency:** `reorderCatalog(table, ids)` ↔ 라우트 ↔ lib `reorderModels/Trims(ids)` ↔ MCMasterPage. `selected:Set<number>`·`dragId:useRef` 일관. rows 공용(CatalogModel|CatalogTrim 모두 `id`/현재 뷰별 sort).

## 미결 / 주의

- 배열 바인딩(`int[]`)이 드라이버에서 안 먹으면 Task 1 Step 1 주석대로 조정(캐스트/인코딩).
- DnD는 화면 검증 불가(헤드리스 브라우저 미설치) → moveItem 순수 단위테스트 + 사용자 수동 확인.
- 선택 모드/드래그는 편집(연필/삭제) 칸과 배타(선택 모드 시 편집칸 숨김) — 앱과 동일.
- 일괄삭제는 클라이언트 순차 delete(소량 전제). 대량이면 후속에 bulk 엔드포인트.
- bun API 핫리로드 없음 → dev 재시작 후 동작.

## Execution Handoff
1. **Inline (추천)** — executing-plans.
</content>
