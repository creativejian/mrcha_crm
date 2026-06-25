# 견적 워크벤치 차량 로딩 perf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적 워크벤치 수정 진입의 차량 로딩을 클라 4요청(+중복)·서버 5쿼리 직렬에서 → 클라 1요청·서버 내부 병렬로 단축(~1.7s → ~0.6s).

**Architecture:** 백엔드에 번들 쿼리 `getWorkbenchVehicle(trimId)`(trimDetail+brands+models+trims를 한 요청에서 병렬 조회)와 `GET /api/vehicles/workbench` 라우트를 추가하고, `getTrimDetail`의 독립 5쿼리를 병렬화한다. 프론트 `VehiclePicker` 수정 모드를 번들 1요청으로 바꾸고, 받은 `trimDetail`을 `VehicleSelection`에 동봉해 `applyTrimToPricing`의 중복 `fetchTrimDetail`을 제거한다. 캐싱·binding 변경 없음(항상 fresh).

**Tech Stack:** Hono + drizzle-orm + zod(백엔드), React + vitest(프론트), bun:test(서버 테스트), Cloudflare Hyperdrive.

---

## File Structure

- **Modify** `src/db/queries/vehicles.ts` — `getTrimDetail` 병렬화 + 번들 `getWorkbenchVehicle` 추가.
- **Modify** `src/routes/vehicles.ts` — `GET /workbench` 라우트.
- **Modify** `src/routes/vehicles.test.ts` — `/workbench` 200/404/400 테스트.
- **Modify** `client/src/lib/vehicles.ts` — `WorkbenchVehicle` 타입 + `fetchWorkbenchVehicle`.
- **Modify** `client/src/lib/vehicles.test.ts` — `fetchWorkbenchVehicle` URL 테스트.
- **Modify** `client/src/components/VehiclePicker.tsx` — `VehicleSelection.trimDetail?` + 수정 모드 번들 1요청.
- **Modify** `client/src/components/VehiclePicker.test.tsx` — 수정 모드 `/workbench` mock.
- **Modify** `client/src/pages/CustomerDetailPage.tsx` — `applyTrimToPricing` 재fetch 생략.

---

## Task 1: 백엔드 — `getTrimDetail` 병렬화 + 번들 `getWorkbenchVehicle` + 라우트

**Files:**
- Modify: `src/db/queries/vehicles.ts`
- Modify: `src/routes/vehicles.ts`
- Test: `src/routes/vehicles.test.ts`

- [ ] **Step 1: 서버 테스트 작성 (실패)**

`src/routes/vehicles.test.ts` 끝(39행 이후, 마지막 `});` 다음)에 추가:

```ts
test("GET /api/vehicles/workbench?trimId= → 200, 번들(brands/models/trims/trimDetail)", async () => {
  const { app, auth } = await authedApp();
  const brands = (await (await app.request("/api/vehicles/brands", auth)).json()) as { id: number }[];
  const models = (await (await app.request(`/api/vehicles/models?brandId=${brands[0].id}`, auth)).json()) as { id: number }[];
  const trims = (await (await app.request(`/api/vehicles/trims?modelId=${models[0].id}`, auth)).json()) as { id: number }[];
  const res = await app.request(`/api/vehicles/workbench?trimId=${trims[0].id}`, auth);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { brands: unknown[]; models: unknown[]; trims: unknown[]; trimDetail: { id: number } };
  expect(body.brands.length).toBeGreaterThan(0);
  expect(body.models.length).toBeGreaterThan(0);
  expect(body.trims.length).toBeGreaterThan(0);
  expect(body.trimDetail.id).toBe(trims[0].id);
});

test("GET /api/vehicles/workbench (없는 trimId) → 404", async () => {
  const { app, auth } = await authedApp();
  const res = await app.request("/api/vehicles/workbench?trimId=999999999", auth);
  expect(res.status).toBe(404);
});

test("GET /api/vehicles/workbench (trimId 없음) → 400", async () => {
  const { app, auth } = await authedApp();
  const res = await app.request("/api/vehicles/workbench", auth);
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test --env-file=.env.local src/routes/vehicles.test.ts`
Expected: 새 `/workbench` 테스트 FAIL (라우트 없음 → 404 또는 400 불일치). 기존 4개는 PASS.

- [ ] **Step 3: `getTrimDetail` 병렬화 + `getWorkbenchVehicle` 구현**

`src/db/queries/vehicles.ts`의 `getTrimDetail`(73~151행) 전체를 다음으로 교체. 독립 쿼리(trim+join / options / colors / noOptions)를 `Promise.all`로 묶고, `optionRelations`만 `options.ids` 의존이라 뒤에 둔다. 반환 형태는 기존과 동일:

```ts
export async function getTrimDetail(trimId: number, executor: Executor = getDefaultDb()) {
  const [trimRows, options, colors, noOptionRows] = await Promise.all([
    executor
      .select({
        id: trimsInCatalog.id,
        modelId: trimsInCatalog.modelId,
        name: trimsInCatalog.name,
        trimName: trimsInCatalog.trimName,
        canonicalName: trimsInCatalog.canonicalName,
        price: trimsInCatalog.price,
        specs: trimsInCatalog.specs,
        fuelType: trimsInCatalog.fuelType,
        displacementCc: trimsInCatalog.displacementCc,
        modelYear: trimsInCatalog.modelYear,
        driveSystem: trimsInCatalog.driveSystem,
        transmissionType: trimsInCatalog.transmissionType,
        bodyStyle: trimsInCatalog.bodyStyle,
        seatingCapacity: trimsInCatalog.seatingCapacity,
        status: trimsInCatalog.status,
        sortOrder: trimsInCatalog.sortOrder,
        financialDiscountAmount: trimsInCatalog.financialDiscountAmount,
        partnerDiscountAmount: trimsInCatalog.partnerDiscountAmount,
        cashDiscountAmount: trimsInCatalog.cashDiscountAmount,
        brandId: brandsInCatalog.id,
        brandName: brandsInCatalog.name,
        modelName: modelsInCatalog.name,
      })
      .from(trimsInCatalog)
      .leftJoin(modelsInCatalog, eq(trimsInCatalog.modelId, modelsInCatalog.id))
      .leftJoin(brandsInCatalog, eq(modelsInCatalog.brandId, brandsInCatalog.id))
      .where(eq(trimsInCatalog.id, trimId)),
    executor
      .select({
        id: trimOptionsInCatalog.id,
        type: trimOptionsInCatalog.type,
        name: trimOptionsInCatalog.name,
        price: trimOptionsInCatalog.price,
      })
      .from(trimOptionsInCatalog)
      .where(eq(trimOptionsInCatalog.trimId, trimId)),
    executor
      .select({
        id: colorsInCatalog.id,
        colorType: colorsInCatalog.colorType,
        name: colorsInCatalog.name,
        code: colorsInCatalog.code,
        hexValue: colorsInCatalog.hexValue,
        sortOrder: colorsInCatalog.sortOrder,
      })
      .from(colorsInCatalog)
      .where(eq(colorsInCatalog.trimId, trimId))
      .orderBy(asc(colorsInCatalog.sortOrder)),
    executor
      .select({
        note: trimNoOptionsInCatalog.note,
        checkedAt: trimNoOptionsInCatalog.checkedAt,
      })
      .from(trimNoOptionsInCatalog)
      .where(eq(trimNoOptionsInCatalog.trimId, trimId)),
  ]);

  const trim = trimRows[0];
  if (!trim) return null;

  const optionIds = options.map((o) => o.id);
  const optionRelations = optionIds.length
    ? await executor
        .select({
          id: trimOptionRelationsInCatalog.id,
          optionId: trimOptionRelationsInCatalog.optionId,
          relatedOptionId: trimOptionRelationsInCatalog.relatedOptionId,
          type: trimOptionRelationsInCatalog.type,
        })
        .from(trimOptionRelationsInCatalog)
        .where(inArray(trimOptionRelationsInCatalog.optionId, optionIds))
    : [];

  return { ...trim, options, optionRelations, colors, noOptions: noOptionRows[0] ?? null };
}

// 워크벤치 수정 진입 번들: trimDetail + 그 차량의 brand/model/trim 목록을 한 요청에서 병렬 조회.
// trimDetail.brandId/modelId는 trim+join에서 이미 노출되어 models/trims를 좁힌다.
export async function getWorkbenchVehicle(trimId: number, executor: Executor = getDefaultDb()) {
  const [trimDetail, brands] = await Promise.all([
    getTrimDetail(trimId, executor),
    getBrands(executor),
  ]);
  if (!trimDetail) return null;
  const [models, trims] = await Promise.all([
    getModelsByBrand(trimDetail.brandId, executor),
    getTrimsByModel(trimDetail.modelId, executor),
  ]);
  return { brands, models, trims, trimDetail };
}
```

- [ ] **Step 4: 라우트 추가**

`src/routes/vehicles.ts` import(6행)에 `getWorkbenchVehicle` 추가:

```ts
import { getBrands, getModelsByBrand, getTrimDetail, getTrimsByModel, getWorkbenchVehicle } from "../db/queries/vehicles";
```

마지막 라우트(`/trims/:trimId`, 31행) 다음에 추가:

```ts
vehicles.get("/workbench", zValidator("query", z.object({ trimId: idSchema })), async (c) => {
  const { trimId } = c.req.valid("query");
  const data = await getWorkbenchVehicle(trimId, c.var.db);
  if (!data) return c.json({ error: "Trim not found" }, 404);
  return c.json(data);
});
```

- [ ] **Step 5: 테스트 통과 + 기존 보존 확인**

Run: `bun test --env-file=.env.local src/routes/vehicles.test.ts`
Expected: 7개 모두 PASS (기존 4 + 신규 3). `getTrimDetail` 병렬화는 반환 형태 불변이라 기존 trims/:id 404 테스트 통과.

- [ ] **Step 6: 커밋**

```bash
git add src/db/queries/vehicles.ts src/routes/vehicles.ts src/routes/vehicles.test.ts
git commit -m "perf(crm): 견적 차량 번들 엔드포인트 getWorkbenchVehicle + getTrimDetail 병렬화

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 프론트 lib — `fetchWorkbenchVehicle` + 타입

**Files:**
- Modify: `client/src/lib/vehicles.ts`
- Test: `client/src/lib/vehicles.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`client/src/lib/vehicles.test.ts` import(3행)에 `fetchWorkbenchVehicle` 추가:

```ts
import { fetchBrands, fetchModels, fetchTrims, fetchTrimDetail, fetchWorkbenchVehicle } from "./vehicles";
```

`throws on non-ok response` 테스트(64~67행) **앞**에 추가:

```ts
  it("fetchWorkbenchVehicle GETs /api/vehicles/workbench?trimId=", async () => {
    const bundle = { brands: [{ id: 1, name: "현대" }], models: [], trims: [], trimDetail: { id: 100 } };
    const spy = vi.fn(async () => new Response(JSON.stringify(bundle), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const result = await fetchWorkbenchVehicle(100);
    expect(calledUrl(spy)).toBe("/api/vehicles/workbench?trimId=100");
    expect(result).toEqual(bundle);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `bunx vitest run client/src/lib/vehicles.test.ts`
Expected: FAIL — `fetchWorkbenchVehicle` is not a function / not exported.

- [ ] **Step 3: 구현**

`client/src/lib/vehicles.ts` 끝(80행 `fetchTrimDetail` 다음)에 추가:

```ts
export type WorkbenchVehicle = {
  brands: Brand[];
  models: Model[];
  trims: Trim[];
  trimDetail: TrimDetail;
};

export function fetchWorkbenchVehicle(trimId: number): Promise<WorkbenchVehicle> {
  return getJson<WorkbenchVehicle>(`/api/vehicles/workbench?trimId=${trimId}`);
}
```

- [ ] **Step 4: 통과 확인**

Run: `bunx vitest run client/src/lib/vehicles.test.ts`
Expected: PASS (기존 5 + 신규 1 = 6).

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/vehicles.ts client/src/lib/vehicles.test.ts
git commit -m "feat(crm): fetchWorkbenchVehicle 번들 fetch + WorkbenchVehicle 타입

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: VehiclePicker 수정 모드 번들화 + `VehicleSelection.trimDetail?`

**Files:**
- Modify: `client/src/components/VehiclePicker.tsx`
- Test: `client/src/components/VehiclePicker.test.tsx`

- [ ] **Step 1: 테스트 mock 업데이트 (실패 유도)**

`client/src/components/VehiclePicker.test.tsx`의 `beforeEach` fetch mock에서, `if (url.includes("/api/vehicles/trims/"))` 분기(28~34행) **앞**에 번들 분기를 추가(신규 분기라 기존 신규-모드 테스트엔 영향 없음):

```ts
      if (url.startsWith("/api/vehicles/workbench")) {
        return new Response(
          JSON.stringify({
            brands: [{ id: 1, name: "현대", logoUrl: null, isDomestic: true, isPopular: true, sortOrder: 1, brandCode: 1 }],
            models: [{ id: 10, brandId: 1, name: "팰리세이드", imageUrl: null, category: null, status: "판매중", sortOrder: 1, modelCode: 1 }],
            trims: [{ id: 100, modelId: 10, name: "Exclusive", trimName: "Exclusive", canonicalName: null, price: 50000000, fuelType: null, displacementCc: null, modelYear: null, driveSystem: null, transmissionType: null, bodyStyle: null, seatingCapacity: null, status: "판매중", sortOrder: 1 }],
            trimDetail: { id: 100, modelId: 10, name: "Exclusive", trimName: "Exclusive", canonicalName: null, price: 50000000, specs: null, fuelType: null, displacementCc: null, modelYear: null, driveSystem: null, transmissionType: null, bodyStyle: null, seatingCapacity: null, status: "판매중", sortOrder: 1, financialDiscountAmount: null, partnerDiscountAmount: null, cashDiscountAmount: null, brandId: 1, brandName: "현대", modelName: "팰리세이드", options: [], optionRelations: [], colors: [], noOptions: null },
          }),
          { status: 200 },
        );
      }
```

그리고 `initialTrimId로 ...` 테스트(67~80행)의 `onChange` assertion에 `trimDetail` 동봉 확인을 추가:

```ts
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: expect.objectContaining({ id: 1 }),
        model: expect.objectContaining({ id: 10 }),
        trim: expect.objectContaining({ id: 100 }),
        trimDetail: expect.objectContaining({ id: 100 }),
      }),
    );
```

- [ ] **Step 2: 실패 확인**

Run: `bunx vitest run client/src/components/VehiclePicker.test.tsx`
Expected: `initialTrimId` 테스트 FAIL — onChange에 `trimDetail`이 없음(아직 동봉 안 함).

- [ ] **Step 3: VehiclePicker 구현**

import(5행)을 교체 — `fetchTrimDetail` 제거, `fetchWorkbenchVehicle` + `TrimDetail` 추가:

```tsx
import { fetchBrands, fetchModels, fetchTrims, fetchWorkbenchVehicle, type Brand, type Model, type Trim, type TrimDetail } from "@/lib/vehicles";
```

`VehicleSelection` 타입(7행)에 `trimDetail?` 추가:

```tsx
export type VehicleSelection = { brand?: Brand; model?: Model; trim?: Trim; trimDetail?: TrimDetail };
```

수정 모드 마운트 effect의 `(async () => { ... })()` 블록(36~60행)을 번들 1요청으로 교체:

```tsx
    (async () => {
      try {
        const { brands: brandList, models: modelList, trims: trimList, trimDetail } = await fetchWorkbenchVehicle(initialTrimId);
        if (cancelled) return;
        setBrands(brandList);
        setModels(modelList);
        setTrims(trimList);
        const b = brandList.find((x) => x.id === trimDetail.brandId);
        const m = modelList.find((x) => x.id === trimDetail.modelId);
        const t = trimList.find((x) => x.id === trimDetail.id);
        if (b) setBrand(b);
        if (m) setModel(m);
        if (t) setTrim(t);
        if (b && m && t) onChange?.({ brand: b, model: m, trim: t, trimDetail });
      } catch {
        if (!cancelled) setErrored("brand");
      } finally {
        if (!cancelled) setLoading(null);
      }
    })();
```

(신규 모드 `selectBrand`/`selectModel`/`selectTrim`은 변경 없음 — `fetchModels`/`fetchTrims`는 그대로 import되어 쓰인다. trimDetail 동봉도 안 함.)

- [ ] **Step 4: 통과 확인**

Run: `bunx vitest run client/src/components/VehiclePicker.test.tsx`
Expected: PASS (3개 — 신규 모드/수정 모드/에러). 수정 모드는 이제 `/api/vehicles/workbench` 1요청으로 복원 + trimDetail 동봉.

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/VehiclePicker.tsx client/src/components/VehiclePicker.test.tsx
git commit -m "perf(crm): VehiclePicker 수정 모드 번들 1요청 + trimDetail 동봉

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `applyTrimToPricing` 중복 fetch 제거 + 전체 검증

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: 중복 `fetchTrimDetail` 제거**

`applyTrimToPricing`(1301행~)의 `const detail = await fetchTrimDetail(trim.id);`(1305행)를 교체 — 수정 모드는 VehiclePicker가 동봉한 `selection.trimDetail`을 재사용, 신규 모드(동봉 없음)는 기존대로 fetch:

```tsx
    const detail = selection.trimDetail ?? await fetchTrimDetail(trim.id);
```

(나머지 — `editPrefill` 적용, 색상/옵션/가격 input 세팅 — 불변. `fetchTrimDetail` import는 신규 모드 폴백에 여전히 필요하므로 유지.)

- [ ] **Step 2: 검증**

```bash
bun run typecheck
bun run lint
bunx vitest run client/src/lib/vehicles.test.ts client/src/components/VehiclePicker.test.tsx
bun test --env-file=.env.local src/routes/vehicles.test.ts
bun run build
```
Expected: typecheck 0, lint 0, 프론트 테스트 PASS, 서버 테스트 7 PASS, build OK.

- [ ] **Step 3: 커밋**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "perf(crm): applyTrimToPricing 수정 모드 trimDetail 재사용(중복 fetch 제거)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## prod before/after 측정 (배포 후, 별도)

플랜 자동 검증은 typecheck/lint/test/build만. 실제 perf는 배포 후 토큰으로 재측정:

- 기존: `/api/vehicles/trims/:id` 단독 시간(병렬화 후 ~0.65s → ~0.25s 기대)
- 신규: `/api/vehicles/workbench?trimId=` 단일 요청 시간(brands+models+trims+trimDetail 묶음, ~0.6s 기대)
- 브라우저: 견적 수정 진입 → 차량 로딩 체감 단축 + 작성완료 빠르게 활성화. Network 탭에 `/workbench` 1요청만(4요청 아님).

---

## Self-Review 메모

- **Spec 커버리지**: getTrimDetail 병렬화 → Task1 Step3. 번들 getWorkbenchVehicle → Task1 Step3. /workbench 라우트 → Task1 Step4. fetchWorkbenchVehicle+타입 → Task2. VehiclePicker 수정 모드 1요청 → Task3. VehicleSelection.trimDetail? → Task3 Step3. 중복 제거(applyTrimToPricing) → Task4. 신규 모드 불변 → Task3 주석. 범위 외(캐싱/binding/SSOT통합/프론트캐시) → 미포함 확인.
- **타입 일관성**: `WorkbenchVehicle{brands,models,trims,trimDetail}`가 백엔드 `getWorkbenchVehicle` 반환·프론트 타입·VehiclePicker 구조분해에서 일치. `VehicleSelection.trimDetail?: TrimDetail`이 동봉(Task3)·소비(Task4 `selection.trimDetail`)에서 일치. `getTrimDetail` 반환 형태 불변(기존 소비처 안전).
- **Placeholder 없음**: 모든 코드 step 실제 코드 포함.
