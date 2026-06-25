# 견적 워크벤치 수정 진입 prefetch + 스켈레톤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적함에서 수정 진입 전 hover로 차량 데이터를 미리 받아(prefetch) 클릭 시 즉시 열고, 캐시 miss 시엔 빈 화면 대신 스켈레톤을 보여 체감을 개선한다.

**Architecture:** `trimId → WorkbenchVehicle` 단일 키 프론트 캐시(TTL 60s + inflight dedupe)를 두고, 견적 행 hover가 `prefetchWorkbenchVehicle`로 워밍, VehiclePicker 수정 모드가 `fetchWorkbenchVehicleCached`로 소비한다(hit면 네트워크 0). 로딩 중엔 차량 선택 + 옵션/컬러 영역에 스켈레톤. 서버/엔드포인트 변경 없음(#104의 `/workbench` 재사용), mc-master 비건드림.

**Tech Stack:** React, TypeScript, vitest. 기존 `fetchWorkbenchVehicle`(#104).

---

## File Structure

- **Create** `client/src/lib/vehicles-cache.ts` — `trimId` 단일 키 캐시 + `prefetchWorkbenchVehicle`/`fetchWorkbenchVehicleCached`.
- **Create** `client/src/lib/vehicles-cache.test.ts` — 캐시 hit/dedupe/prefetch 테스트.
- **Modify** `client/src/components/VehiclePicker.tsx` — 수정 모드가 캐시 경유 fetch + 로딩 중 picker 값 스켈레톤.
- **Modify** `client/src/pages/CustomerDetailPage.tsx` — 견적 행 hover prefetch + 옵션/컬러 카드 스켈레톤.
- **Modify** `client/src/index.css` — 스켈레톤 스타일.

---

## Task 1: prefetch 캐시 모듈 `vehicles-cache.ts`

**Files:**
- Create: `client/src/lib/vehicles-cache.ts`
- Test: `client/src/lib/vehicles-cache.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `client/src/lib/vehicles-cache.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

// apiFetch(./api)가 supabase.auth.getSession()을 호출하므로 supabase를 mock한다.
vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { fetchWorkbenchVehicleCached, prefetchWorkbenchVehicle } from "./vehicles-cache";

const bundle = { brands: [], models: [], trims: [], trimDetail: { id: 1 } };
const ok = () => vi.fn(async () => new Response(JSON.stringify(bundle), { status: 200 }));

afterEach(() => { vi.restoreAllMocks(); });

describe("vehicles-cache", () => {
  it("같은 trimId 두 번째 호출은 캐시 hit(fetch 1회)", async () => {
    const spy = ok();
    vi.stubGlobal("fetch", spy);
    await fetchWorkbenchVehicleCached(101);
    await fetchWorkbenchVehicleCached(101);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("동시 호출은 inflight dedupe(fetch 1회)", async () => {
    const spy = ok();
    vi.stubGlobal("fetch", spy);
    await Promise.all([fetchWorkbenchVehicleCached(102), fetchWorkbenchVehicleCached(102)]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("prefetch가 캐시를 채워 이후 fetch가 0", async () => {
    const spy = ok();
    vi.stubGlobal("fetch", spy);
    prefetchWorkbenchVehicle(103);
    await new Promise((r) => setTimeout(r, 0)); // prefetch 워밍 완료 대기
    await fetchWorkbenchVehicleCached(103);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("TTL 만료 후 재fetch", async () => {
    vi.useFakeTimers();
    const spy = ok();
    vi.stubGlobal("fetch", spy);
    await fetchWorkbenchVehicleCached(104);
    await vi.advanceTimersByTimeAsync(61_000);
    await fetchWorkbenchVehicleCached(104);
    expect(spy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bunx vitest run client/src/lib/vehicles-cache.test.ts`
Expected: FAIL — `Cannot find module './vehicles-cache'`.

- [ ] **Step 3: 구현**

Create `client/src/lib/vehicles-cache.ts`:

```ts
import { fetchWorkbenchVehicle, type WorkbenchVehicle } from "./vehicles";

// 견적 워크벤치 수정 진입 prefetch 캐시. trimId 단일 키.
// mc-master catalog-cache의 makeCache와 로직이 닮았으나, /api/vehicles 전용으로 격리(mc-master 경로를
// 건드리지 않기 위해) 별도 구현한다. TTL 60s 신선도 + 동시 호출 inflight dedupe.
const TTL_MS = 60_000;
const cache = new Map<number, { value: WorkbenchVehicle; at: number }>();
const inflight = new Map<number, Promise<WorkbenchVehicle>>();

// 캐시 hit(신선)면 즉시, 아니면 fetch+저장. 동시 호출은 inflight 1요청 공유. 실패 시 캐시 미저장.
export function fetchWorkbenchVehicleCached(trimId: number): Promise<WorkbenchVehicle> {
  const entry = cache.get(trimId);
  if (entry && Date.now() - entry.at < TTL_MS) return Promise.resolve(entry.value);
  const existing = inflight.get(trimId);
  if (existing) return existing;
  const p = fetchWorkbenchVehicle(trimId)
    .then((value) => {
      cache.set(trimId, { value, at: Date.now() });
      return value;
    })
    .finally(() => inflight.delete(trimId));
  inflight.set(trimId, p);
  return p;
}

// 견적 행 hover가 호출. 백그라운드 워밍(결과/에러 무시).
export function prefetchWorkbenchVehicle(trimId: number): void {
  void fetchWorkbenchVehicleCached(trimId).catch(() => {});
}
```

- [ ] **Step 4: 통과 확인**

Run: `bunx vitest run client/src/lib/vehicles-cache.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/vehicles-cache.ts client/src/lib/vehicles-cache.test.ts
git commit -m "feat(crm): 견적 워크벤치 prefetch 캐시(vehicles-cache) trimId 단일키 TTL+dedupe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: prefetch 배선 — VehiclePicker 캐시 소비 + 견적 행 hover

**Files:**
- Modify: `client/src/components/VehiclePicker.tsx`
- Modify: `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: VehiclePicker가 캐시 경유**

`client/src/components/VehiclePicker.tsx` import(현재 `fetchWorkbenchVehicle`을 `@/lib/vehicles`에서 가져옴)를 두 줄로 — `fetchWorkbenchVehicle` 제거, 캐시 함수 추가:

```tsx
import { fetchBrands, fetchModels, fetchTrims, type Brand, type Model, type Trim, type TrimDetail } from "@/lib/vehicles";
import { fetchWorkbenchVehicleCached } from "@/lib/vehicles-cache";
```

수정 모드 마운트 effect의 `const { brands: brandList, ... } = await fetchWorkbenchVehicle(initialTrimId);`를 캐시 버전으로 교체(나머지 동일):

```tsx
        const { brands: brandList, models: modelList, trims: trimList, trimDetail } = await fetchWorkbenchVehicleCached(initialTrimId);
```

- [ ] **Step 2: 견적 행 hover prefetch**

`client/src/pages/CustomerDetailPage.tsx` import 구역(다른 `@/lib` import와 같은 그룹)에 추가:

```tsx
import { prefetchWorkbenchVehicle } from "@/lib/vehicles-cache";
```

견적 행 `<div className={`kim-quote-row ...`} key={quote.id} onDragEnter={...}>`(약 4200~4203행)에 `onMouseEnter`를 추가(기존 `key` 다음 줄):

```tsx
                  onMouseEnter={() => { if (quote.trimId) prefetchWorkbenchVehicle(quote.trimId); }}
```

- [ ] **Step 3: 검증**

```bash
bun run typecheck
bun run lint
bunx vitest run client/src/components/VehiclePicker.test.tsx client/src/lib/vehicles-cache.test.ts
```
Expected: typecheck 0, lint 0, 테스트 PASS. (VehiclePicker 테스트는 fetch mock의 `/api/vehicles/workbench` 분기를 그대로 타므로 캐시 경유여도 통과. 단 캐시가 모듈 스코프라 테스트 간 trimId가 같으면 hit될 수 있음 — VehiclePicker 테스트는 trimId=100 1회만 마운트하므로 영향 없음.)

- [ ] **Step 4: 커밋**

```bash
git add client/src/components/VehiclePicker.tsx client/src/pages/CustomerDetailPage.tsx
git commit -m "perf(crm): 견적 행 hover prefetch + VehiclePicker 캐시 소비(수정 진입 즉시화)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 스켈레톤 — 차량 선택 + 옵션/컬러 로딩 골격

**Files:**
- Modify: `client/src/components/VehiclePicker.tsx`
- Modify: `client/src/pages/CustomerDetailPage.tsx`
- Modify: `client/src/index.css`

거대 컴포넌트 UI라 단위테스트 대신 typecheck + 후속 브라우저 확인.

- [ ] **Step 1: VehiclePicker 차량 선택 값 스켈레톤**

수정 모드 초기 로딩(initialTrimId 있고 아직 brand 미복원이며 로딩 중)에 picker 값 자리를 골격으로. `VehiclePicker` 컴포넌트 본문에서 `return (` 직전에 파생 플래그를 추가:

```tsx
  const editLoading = initialTrimId != null && loading != null && !brand;
```

picker 3곳의 값 `<b>`(제조사/모델/트림)를 editLoading일 때 골격으로 바꾼다. 제조사 버튼:

```tsx
          <b className={brand ? "" : "muted"}>{editLoading ? <span className="kim-vehicle-skeleton" /> : (brand?.name ?? "선택")}</b>
```

모델 버튼:

```tsx
          <b className={model ? "" : "muted"}>{editLoading ? <span className="kim-vehicle-skeleton" /> : (model?.name ?? "선택")}</b>
```

트림 버튼:

```tsx
          <b className={trim ? "" : "muted"}>{editLoading ? <span className="kim-vehicle-skeleton" /> : (trim ? trim.trimName ?? trim.name : "선택")}</b>
```

- [ ] **Step 2: 옵션/컬러 카드 스켈레톤**

`client/src/pages/CustomerDetailPage.tsx`의 옵션/컬러 섹션(약 4858~4863행)에서, **수정 모드 로딩 중**(`editingQuoteId`가 있는데 `trimDetail` 미도착)일 때 OptionPicker/ColorPicker 대신 스켈레톤을 보인다. 신규 모드(차량 미선택)는 기존대로 빈 OptionPicker:

```tsx
                    <div className="kim-jeff-section">
                      <h4>🎨 옵션 / 컬러</h4>
                      {editingQuoteId && !trimDetail ? (
                        <div className="kim-jeff-skeleton-group" aria-hidden="true">
                          <div className="kim-jeff-skeleton-row" />
                          <div className="kim-jeff-skeleton-row" />
                          <div className="kim-jeff-skeleton-row" />
                        </div>
                      ) : (
                        <>
                          <OptionPicker key={trimDetail?.id ?? "none"} options={trimDetail?.options ?? []} relations={trimDetail?.optionRelations ?? []} initialSelectedIds={selectedWorkbenchOptionIds} onChange={applyOptionTotal} />
                          <ColorPicker colorType="exterior" colors={trimDetail?.colors ?? []} value={exteriorColor} onChange={(c) => { setExteriorColor(c); markQuoteDraftChanged(); }} />
                          <ColorPicker colorType="interior" colors={trimDetail?.colors ?? []} value={interiorColor} onChange={(c) => { setInteriorColor(c); markQuoteDraftChanged(); }} />
                        </>
                      )}
                    </div>
```

- [ ] **Step 3: 스켈레톤 CSS**

`client/src/index.css` 끝(또는 `.kim-vehicle-picker` 관련 규칙 근처)에 추가. 기존 연회색 톤 + 약한 shimmer:

```css
.kim-vehicle-skeleton {
  display: inline-block;
  width: 84px;
  height: 13px;
  border-radius: 5px;
  background: linear-gradient(90deg, #ececec 25%, #f4f4f4 37%, #ececec 63%);
  background-size: 400% 100%;
  animation: kim-skeleton-shimmer 1.2s ease-in-out infinite;
  vertical-align: middle;
}

.kim-jeff-skeleton-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.kim-jeff-skeleton-row {
  height: 38px;
  border-radius: 6px;
  background: linear-gradient(90deg, #ececec 25%, #f4f4f4 37%, #ececec 63%);
  background-size: 400% 100%;
  animation: kim-skeleton-shimmer 1.2s ease-in-out infinite;
}

@keyframes kim-skeleton-shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}
```

- [ ] **Step 4: 검증**

```bash
bun run typecheck
bun run lint
bun run build
bunx vitest run client/src/components/VehiclePicker.test.tsx
```
Expected: typecheck 0, lint 0, build OK, VehiclePicker 테스트 PASS(스켈레톤은 수정 모드 로딩 중에만 — 테스트의 즉시 resolve mock에선 거의 안 거치나, 마크업 유효성은 typecheck/렌더로 확인).

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/VehiclePicker.tsx client/src/pages/CustomerDetailPage.tsx client/src/index.css
git commit -m "perf(crm): 차량 로딩 중 차량 선택+옵션/컬러 스켈레톤(캐시 miss 폴백)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## prod 브라우저 확인 (배포 후, 별도)

- 견적함에서 견적 행에 **마우스 올린 뒤** 수정 진입 → 차량 선택/옵션/컬러가 **즉시**(네트워크 0, 캐시 hit). Network 탭에 hover 시점 `/workbench` 1요청, 수정 클릭 시 추가 요청 없음.
- hover 없이 바로 수정 진입(또는 prefetch 진행 중) → 빈 화면 대신 **스켈레톤** 표시 후 채워짐.
- 같은 견적 재진입(60s 내) → 즉시.

---

## Self-Review 메모

- **Spec 커버리지**: 캐시(TTL+dedupe) → Task1. hover trigger → Task2 Step2. VehiclePicker 캐시 소비 → Task2 Step1. 스켈레톤(차량+옵션+컬러) → Task3. 무효화 불필요 → 코드 없음(설계 근거). 신규 모드 불변 → Task3 Step2 조건(`editingQuoteId && !trimDetail`).
- **타입 일관성**: `fetchWorkbenchVehicleCached`/`prefetchWorkbenchVehicle` 시그니처가 Task1 정의·Task2 사용에서 일치. `WorkbenchVehicle`(#104) 재사용. `quote.trimId`(KimQuoteItem.trimId, number|undefined)를 prefetch 키로(undefined 가드).
- **Placeholder 없음**: 모든 코드 step에 실제 코드.
- **신규 모드 회귀 주의**: 옵션/컬러 스켈레톤 조건이 `editingQuoteId && !trimDetail`이라, 신규 모드(editingQuoteId=null)는 항상 OptionPicker 분기 → 기존 동작 보존.
