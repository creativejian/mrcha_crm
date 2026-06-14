# 차량 카탈로그 조회 API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** catalog(차량 거울) 데이터를 계층별 REST로 조회하는 read-only API를 만든다.

**Architecture:** `src/db/queries/vehicles.ts`(drizzle 쿼리, `deleted_at IS NULL` 필터·`sort_order` 정렬·화이트리스트 select) → `src/routes/vehicles.ts`(Hono 라우터 + zod 파라미터 검증) → `src/app.ts`에 `/api/vehicles` 연결. 테스트는 실제 catalog 데이터를 쓰는 `bun:test` 통합 테스트.

**Tech Stack:** Bun, Hono, @hono/zod-validator, zod, drizzle-orm(postgres-js), bun:test.

**Spec:** `ref/specs/2026-06-14-vehicle-catalog-read-api-design.md`

**Note (DB env):** 테스트/실행은 `.env.local`의 `DATABASE_URL`이 필요하다. `bun test`가 자동 로드하지 못하면 `DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') bun test ...`로 주입한다.

---

## File Structure

- Create: `src/db/queries/vehicles.ts` — 차량 조회 쿼리 함수 (catalog 타입 사용, read-only)
- Create: `src/db/queries/vehicles.test.ts` — 쿼리 함수 통합 테스트
- Create: `src/routes/vehicles.ts` — Hono 라우터 (zod 검증 + 쿼리 함수 호출)
- Create: `src/routes/vehicles.test.ts` — 라우트 통합 테스트
- Modify: `src/app.ts` — `app.route("/api/vehicles", vehicles)` 연결

---

## Task 1: 차량 조회 쿼리 함수 레이어

**Files:**
- Create: `src/db/queries/vehicles.ts`
- Test: `src/db/queries/vehicles.test.ts`

- [ ] **Step 1: Write the failing test**

`src/db/queries/vehicles.test.ts`:
```ts
import { test, expect } from "bun:test";

import { getBrands, getModelsByBrand, getTrimsByModel, getTrimDetail } from "./vehicles";

test("getBrands: 거울 브랜드를 sort_order 순으로 반환", async () => {
  const brands = await getBrands();
  expect(brands.length).toBe(33);
  expect(brands[0].name).toBe("현대");
});

test("getModelsByBrand: 해당 브랜드의 모델만 반환", async () => {
  const brands = await getBrands();
  const models = await getModelsByBrand(brands[0].id);
  expect(models.length).toBeGreaterThan(0);
  expect(models.every((m) => m.brandId === brands[0].id)).toBe(true);
});

test("getTrimsByModel: 해당 모델의 트림만 반환", async () => {
  const brands = await getBrands();
  const models = await getModelsByBrand(brands[0].id);
  const trims = await getTrimsByModel(models[0].id);
  expect(trims.length).toBeGreaterThan(0);
  expect(trims.every((t) => t.modelId === models[0].id)).toBe(true);
});

test("getTrimDetail: 트림 + 옵션/색상 배열 포함", async () => {
  const brands = await getBrands();
  const models = await getModelsByBrand(brands[0].id);
  const trims = await getTrimsByModel(models[0].id);
  const detail = await getTrimDetail(trims[0].id);
  expect(detail).not.toBeNull();
  expect(detail!.id).toBe(trims[0].id);
  expect(Array.isArray(detail!.options)).toBe(true);
  expect(Array.isArray(detail!.colors)).toBe(true);
  expect(Array.isArray(detail!.optionRelations)).toBe(true);
});

test("getTrimDetail: 없는 트림이면 null", async () => {
  const detail = await getTrimDetail(999_999_999);
  expect(detail).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') bun test src/db/queries/vehicles.test.ts`
Expected: FAIL — `Cannot find module './vehicles'` (또는 export 없음)

- [ ] **Step 3: Write the implementation**

`src/db/queries/vehicles.ts`:
```ts
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import {
  brandsInCatalog,
  colorsInCatalog,
  modelsInCatalog,
  trimNoOptionsInCatalog,
  trimOptionRelationsInCatalog,
  trimOptionsInCatalog,
  trimsInCatalog,
} from "../catalog";
import { db } from "../client";

export async function getBrands() {
  return db
    .select({
      id: brandsInCatalog.id,
      name: brandsInCatalog.name,
      logoUrl: brandsInCatalog.logoUrl,
      isDomestic: brandsInCatalog.isDomestic,
      isPopular: brandsInCatalog.isPopular,
      sortOrder: brandsInCatalog.sortOrder,
      brandCode: brandsInCatalog.brandCode,
    })
    .from(brandsInCatalog)
    .where(isNull(brandsInCatalog.deletedAt))
    .orderBy(asc(brandsInCatalog.sortOrder));
}

export async function getModelsByBrand(brandId: number) {
  return db
    .select({
      id: modelsInCatalog.id,
      brandId: modelsInCatalog.brandId,
      name: modelsInCatalog.name,
      imageUrl: modelsInCatalog.imageUrl,
      category: modelsInCatalog.category,
      status: modelsInCatalog.status,
      sortOrder: modelsInCatalog.sortOrder,
      modelCode: modelsInCatalog.modelCode,
    })
    .from(modelsInCatalog)
    .where(and(eq(modelsInCatalog.brandId, brandId), isNull(modelsInCatalog.deletedAt)))
    .orderBy(asc(modelsInCatalog.sortOrder));
}

export async function getTrimsByModel(modelId: number) {
  return db
    .select({
      id: trimsInCatalog.id,
      modelId: trimsInCatalog.modelId,
      name: trimsInCatalog.name,
      trimName: trimsInCatalog.trimName,
      canonicalName: trimsInCatalog.canonicalName,
      price: trimsInCatalog.price,
      fuelType: trimsInCatalog.fuelType,
      displacementCc: trimsInCatalog.displacementCc,
      modelYear: trimsInCatalog.modelYear,
      driveSystem: trimsInCatalog.driveSystem,
      transmissionType: trimsInCatalog.transmissionType,
      bodyStyle: trimsInCatalog.bodyStyle,
      seatingCapacity: trimsInCatalog.seatingCapacity,
      status: trimsInCatalog.status,
      sortOrder: trimsInCatalog.sortOrder,
    })
    .from(trimsInCatalog)
    .where(and(eq(trimsInCatalog.modelId, modelId), isNull(trimsInCatalog.deletedAt)))
    .orderBy(asc(trimsInCatalog.sortOrder));
}

export async function getTrimDetail(trimId: number) {
  const [trim] = await db
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
    })
    .from(trimsInCatalog)
    .where(and(eq(trimsInCatalog.id, trimId), isNull(trimsInCatalog.deletedAt)));

  if (!trim) return null;

  const options = await db
    .select({
      id: trimOptionsInCatalog.id,
      type: trimOptionsInCatalog.type,
      name: trimOptionsInCatalog.name,
      price: trimOptionsInCatalog.price,
    })
    .from(trimOptionsInCatalog)
    .where(and(eq(trimOptionsInCatalog.trimId, trimId), isNull(trimOptionsInCatalog.deletedAt)));

  const optionIds = options.map((o) => o.id);
  const optionRelations = optionIds.length
    ? await db
        .select({
          id: trimOptionRelationsInCatalog.id,
          optionId: trimOptionRelationsInCatalog.optionId,
          relatedOptionId: trimOptionRelationsInCatalog.relatedOptionId,
          type: trimOptionRelationsInCatalog.type,
        })
        .from(trimOptionRelationsInCatalog)
        .where(
          and(
            inArray(trimOptionRelationsInCatalog.optionId, optionIds),
            isNull(trimOptionRelationsInCatalog.deletedAt),
          ),
        )
    : [];

  const colors = await db
    .select({
      id: colorsInCatalog.id,
      colorType: colorsInCatalog.colorType,
      name: colorsInCatalog.name,
      code: colorsInCatalog.code,
      hexValue: colorsInCatalog.hexValue,
      sortOrder: colorsInCatalog.sortOrder,
    })
    .from(colorsInCatalog)
    .where(and(eq(colorsInCatalog.trimId, trimId), isNull(colorsInCatalog.deletedAt)))
    .orderBy(asc(colorsInCatalog.sortOrder));

  const [noOptions] = await db
    .select({
      note: trimNoOptionsInCatalog.note,
      checkedAt: trimNoOptionsInCatalog.checkedAt,
    })
    .from(trimNoOptionsInCatalog)
    .where(and(eq(trimNoOptionsInCatalog.trimId, trimId), isNull(trimNoOptionsInCatalog.deletedAt)));

  return { ...trim, options, optionRelations, colors, noOptions: noOptions ?? null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') bun test src/db/queries/vehicles.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/queries/vehicles.ts src/db/queries/vehicles.test.ts
git commit -m "feat: add catalog vehicle query layer (brands/models/trims/detail)"
```

---

## Task 2: Hono 라우터 + app 연결

**Files:**
- Create: `src/routes/vehicles.ts`
- Test: `src/routes/vehicles.test.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Write the failing test**

`src/routes/vehicles.test.ts`:
```ts
import { test, expect } from "bun:test";

import { app } from "../app";

test("GET /api/vehicles/brands → 200, 브랜드 목록", async () => {
  const res = await app.request("/api/vehicles/brands");
  expect(res.status).toBe(200);
  const body = (await res.json()) as unknown[];
  expect(body.length).toBe(33);
});

test("GET /api/vehicles/models?brandId= → 200", async () => {
  const brandsRes = await app.request("/api/vehicles/brands");
  const brands = (await brandsRes.json()) as { id: number }[];
  const res = await app.request(`/api/vehicles/models?brandId=${brands[0].id}`);
  expect(res.status).toBe(200);
});

test("GET /api/vehicles/models (brandId 없음) → 400", async () => {
  const res = await app.request("/api/vehicles/models");
  expect(res.status).toBe(400);
});

test("GET /api/vehicles/trims/:trimId (없는 id) → 404", async () => {
  const res = await app.request("/api/vehicles/trims/999999999");
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') bun test src/routes/vehicles.test.ts`
Expected: FAIL — `/api/vehicles/brands`가 404 (라우트 미연결)

- [ ] **Step 3: Write the router**

`src/routes/vehicles.ts`:
```ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import {
  getBrands,
  getModelsByBrand,
  getTrimDetail,
  getTrimsByModel,
} from "../db/queries/vehicles";

const idSchema = z.coerce.number().int().positive();

export const vehicles = new Hono();

vehicles.get("/brands", async (c) => {
  return c.json(await getBrands());
});

vehicles.get(
  "/models",
  zValidator("query", z.object({ brandId: idSchema })),
  async (c) => {
    const { brandId } = c.req.valid("query");
    return c.json(await getModelsByBrand(brandId));
  },
);

vehicles.get(
  "/trims",
  zValidator("query", z.object({ modelId: idSchema })),
  async (c) => {
    const { modelId } = c.req.valid("query");
    return c.json(await getTrimsByModel(modelId));
  },
);

vehicles.get(
  "/trims/:trimId",
  zValidator("param", z.object({ trimId: idSchema })),
  async (c) => {
    const { trimId } = c.req.valid("param");
    const detail = await getTrimDetail(trimId);
    if (!detail) return c.json({ error: "Trim not found" }, 404);
    return c.json(detail);
  },
);
```

- [ ] **Step 4: Connect the router in app.ts**

Modify `src/app.ts` — health 라우트 다음에 추가:
```ts
import { Hono } from "hono";

import { vehicles } from "./routes/vehicles";

export const app = new Hono();

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "mrcha-crm",
  }),
);

app.route("/api/vehicles", vehicles);

app.notFound((c) =>
  c.json(
    {
      error: "Not found",
    },
    404,
  ),
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') bun test src/routes/vehicles.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/routes/vehicles.ts src/routes/vehicles.test.ts src/app.ts
git commit -m "feat: add /api/vehicles read routes (brands/models/trims)"
```

---

## Task 3: 전체 검증

**Files:** (없음 — 검증만)

- [ ] **Step 1: typecheck**

Run: `bun run typecheck`
Expected: exit 0 (no output)

- [ ] **Step 2: lint**

Run: `bun run lint`
Expected: 0 problems

- [ ] **Step 3: build**

Run: `bun run build`
Expected: `✓ built`

- [ ] **Step 4: 전체 테스트**

Run: `DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') bun test`
Expected: 모든 server 테스트 PASS (기존 app.test.ts + 신규 9개)

- [ ] **Step 5: 수동 스모크 (선택)**

서버 띄우고 실제 응답 확인:
```bash
bun run dev:api &
sleep 1
curl -s http://127.0.0.1:8788/api/vehicles/brands | head -c 200
kill %1
```
Expected: 브랜드 JSON 배열 (현대/기아/...)

---

## 완료 후

- PR 생성(`feat/vehicle-catalog-read-api` 브랜치) → squash 머지.
- 다음 단계(spec 비범위): 프론트 견적 workbench 차량 선택 연결, sync 스크립트, CRM 자체 스키마.
