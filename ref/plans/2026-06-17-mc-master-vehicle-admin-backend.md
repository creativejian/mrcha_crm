# 차량 관리 백엔드 API (A2 Phase 1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans(inline) 또는 subagent-driven-development. Steps는 체크박스(`- [ ]`)로 추적.

**Goal:** CRM 백엔드에 master `catalog` 쓰기 API(모델·트림·옵션 CRUD + 브랜드/모델/트림/옵션 조회)를 추가해, 프론트 차량 관리 UI(Phase 1b)가 호출할 동작하는 API를 만든다.

**Architecture:** Hono 라우트 `/api/catalog/*`가 `src/db/queries/catalog-admin.ts`의 drizzle 함수를 호출, `db`(postgres superuser, master)로 `catalog.*` 테이블에 직접 INSERT/UPDATE/DELETE. master DB 트리거(코드·`sort_order`·`mc_code`·단종 cascade·검증)가 비즈니스 로직을 처리하므로 CRM은 재구현하지 않는다. 쓰기 테스트는 `db.transaction` + 강제 롤백으로 prod를 변경하지 않는다.

**Tech Stack:** drizzle-orm pg-core, postgres-js, Hono, @hono/zod-validator, zod, TypeScript 6.0.3, bun, vitest.

**Spec:** `ref/specs/2026-06-17-mc-master-vehicle-admin-design.md`. (Phase 1b 프론트는 별도 plan — 이 API 완성·검증 후 작성.)

**검증된 사실(앱 `admin_methods.dart`/`show_add_panel.dart` 기준):**
- 트림 insert: `name=trim_name=입력 트림명`, `canonical_name`=앱 caller가 계산(트리거 아님). 국산=`"{brand} {model} {trimName}"`, 수입=`"{brand} {model} {modelYear} {fuelType} {trimName}"`(`.trim()`).
- `sort_order`·`model_code`는 트리거 자동(insert 시 넣지 않음). `mc_code`는 Phase 1 범위 밖(미할당 = null 정상).
- status 저장값(`public.car_status`): `판매중/출시예정/사전예약/단종/블라인드`. 옵션 type: `basic/tuning`.
- 모델 수정 = `category, status`만. 옵션 수정 = `name, price`만. 색상·할인·재정렬·코드할당은 Phase 1 범위 밖.

> ⚠️ 쓰기는 **라이브 master**에 반영된다. 자동 테스트는 전부 `db.transaction` 롤백으로 prod 무변경. 수동 스모크도 self-cleaning.

---

## File Structure

- **Create**: `src/db/queries/canonical-name.ts` — 순수 함수 `buildCanonicalName`(db import 없음 → 순수 단위테스트).
- **Create**: `src/db/queries/canonical-name.test.ts` — vitest 단위테스트.
- **Create**: `src/db/queries/catalog-admin.ts` — 모델/트림/옵션 CRUD + 집계 조회. `db`(또는 tx executor) 사용.
- **Create**: `src/db/queries/catalog-admin.test.ts` — tx 롤백 통합테스트(`bun test`, DATABASE_URL 필요).
- **Modify**: `src/routes/catalog.ts` — admin 라우트 + zod 추가(기존 `/counts` 유지).
- **Modify**: `src/db/catalog.ts` — 상단 주석에 "차량 관리 admin 쓰기 경로 한정 write 허용" 명시.

---

## Task 1: canonical_name 순수 함수

**Files:**
- Create: `src/db/queries/canonical-name.ts`
- Create: `src/db/queries/canonical-name.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/db/queries/canonical-name.test.ts`:
```ts
import { expect, test } from "vitest";

import { buildCanonicalName } from "./canonical-name";

test("국산: brand model trimName", () => {
  expect(
    buildCanonicalName({ brand: "현대", model: "그랜저", isDomestic: true, modelYear: 2026, fuelType: "가솔린", trimName: "프리미엄 - 익스클루시브" }),
  ).toBe("현대 그랜저 프리미엄 - 익스클루시브");
});

test("수입: brand model year fuel trimName", () => {
  expect(
    buildCanonicalName({ brand: "BMW", model: "5 Series", isDomestic: false, modelYear: 2026, fuelType: "가솔린", trimName: "520i" }),
  ).toBe("BMW 5 Series 2026 가솔린 520i");
});

test("앞뒤 공백 trim + 빈 brand/model 허용", () => {
  expect(
    buildCanonicalName({ brand: "", model: "", isDomestic: false, modelYear: 2026, fuelType: "가솔린", trimName: "X" }),
  ).toBe("2026 가솔린 X");
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit src/db/queries/canonical-name.test.ts`
Expected: FAIL (`buildCanonicalName` 미정의).

- [ ] **Step 3: 구현**

`src/db/queries/canonical-name.ts`:
```ts
// 트림 canonical_name 파생 — 앱 caller(show_add_panel.dart)와 동일 규칙.
// 국산: "{brand} {model} {trimName}", 수입: "{brand} {model} {modelYear} {fuelType} {trimName}".
// 다중 공백을 1칸으로 접고 앞뒤 공백 제거(빈 brand/model 방어).
export function buildCanonicalName(input: {
  brand: string;
  model: string;
  isDomestic: boolean;
  modelYear: number;
  fuelType: string;
  trimName: string;
}): string {
  const parts = input.isDomestic
    ? [input.brand, input.model, input.trimName]
    : [input.brand, input.model, String(input.modelYear), input.fuelType, input.trimName];
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit src/db/queries/canonical-name.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/db/queries/canonical-name.ts src/db/queries/canonical-name.test.ts
git commit -m "feat(catalog-admin): canonical_name 파생 순수 함수 (A2 Phase 1a)"
```

---

## Task 2: catalog-admin 쿼리 — 모델 CRUD + 집계 조회

**Files:**
- Create: `src/db/queries/catalog-admin.ts`
- Modify: `src/db/catalog.ts` (주석)

- [ ] **Step 1: `src/db/catalog.ts` 주석 갱신**

상단 주석 블록의 `// READ-ONLY: master(앱)가 소유. CRM은 읽기만 한다.` 줄을 아래로 교체:
```ts
// master(앱)가 소유. CRM은 견적용 읽기(queries/vehicles.ts)와 차량 관리 admin 쓰기(queries/catalog-admin.ts)에서 이 테이블 객체를 쓴다.
// 스키마 정의 자체는 db:pull:catalog 재introspect 산출물이라 직접 수정하지 않는다(테이블/컬럼 구조 변경 시 재introspect).
```

- [ ] **Step 2: 모델 쿼리 구현**

`src/db/queries/catalog-admin.ts`:
```ts
import { and, asc, count, eq, max, min, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

import { brandsInCatalog, colorsInCatalog, modelsInCatalog, trimOptionsInCatalog, trimsInCatalog } from "../catalog";
import { db } from "../client";
import { buildCanonicalName } from "./canonical-name";

// 쓰기 함수는 기본 db, 테스트에선 tx를 넘겨 롤백한다.
type Executor = typeof db | PgTransaction<never, never, never>;

export const VEHICLE_STATUSES = ["판매중", "출시예정", "사전예약", "단종", "블라인드"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

// ── 모델 ──────────────────────────────────────────────────────────────────────
export async function listModelsByBrand(brandId: number) {
  return db
    .select({
      id: modelsInCatalog.id,
      name: modelsInCatalog.name,
      category: modelsInCatalog.category,
      status: modelsInCatalog.status,
      sortOrder: modelsInCatalog.sortOrder,
      modelCode: modelsInCatalog.modelCode,
      imageUrl: modelsInCatalog.imageUrl,
      trimCount: count(trimsInCatalog.id),
      minPrice: min(trimsInCatalog.price),
      maxPrice: max(trimsInCatalog.price),
    })
    .from(modelsInCatalog)
    .leftJoin(trimsInCatalog, eq(trimsInCatalog.modelId, modelsInCatalog.id))
    .where(eq(modelsInCatalog.brandId, brandId))
    .groupBy(modelsInCatalog.id)
    .orderBy(asc(modelsInCatalog.sortOrder));
}

export async function createModel(
  input: { brandId: number; name: string; category: string | null; status: VehicleStatus },
  executor: Executor = db,
) {
  // model_code·sort_order는 트리거 자동 부여 (insert 시 생략).
  const [row] = await executor
    .insert(modelsInCatalog)
    .values({ brandId: input.brandId, name: input.name, category: input.category, status: input.status })
    .returning();
  return row;
}

export async function updateModel(
  id: number,
  input: { category?: string | null; status?: VehicleStatus },
  executor: Executor = db,
) {
  const patch: Record<string, unknown> = {};
  if (input.category !== undefined) patch.category = input.category;
  if (input.status !== undefined) patch.status = input.status;
  const [row] = await executor.update(modelsInCatalog).set(patch).where(eq(modelsInCatalog.id, id)).returning();
  return row ?? null;
}

export async function deleteModel(id: number, executor: Executor = db) {
  const [row] = await executor.delete(modelsInCatalog).where(eq(modelsInCatalog.id, id)).returning({ id: modelsInCatalog.id });
  return row ?? null;
}
```

> `min/max(price)`는 bigint 컬럼이라 drizzle이 string으로 반환할 수 있다. 라우트에서 `Number(...)`로 정규화(Step은 Task 5). `Executor` 타입은 db와 tx 양쪽이 `.insert/.update/.delete`를 갖도록 느슨히 둔다.

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`
Expected: 0 errors. (이 파일만으로는 라우트 미연결 — export만 추가.)

- [ ] **Step 4: 커밋**

```bash
git add src/db/queries/catalog-admin.ts src/db/catalog.ts
git commit -m "feat(catalog-admin): 모델 CRUD + 집계 조회 쿼리 (A2 Phase 1a)"
```

---

## Task 3: catalog-admin 쿼리 — 트림 CRUD (canonical 적용)

**Files:**
- Modify: `src/db/queries/catalog-admin.ts`

- [ ] **Step 1: 트림 조회/CRUD 추가 (파일 끝에 append)**

```ts
// ── 트림 ──────────────────────────────────────────────────────────────────────
// canonical 계산용 모델+브랜드 정보(브랜드명·모델명·국산여부).
async function modelCanonicalContext(modelId: number, executor: Executor = db) {
  const [row] = await executor
    .select({ brand: brandsInCatalog.name, model: modelsInCatalog.name, isDomestic: brandsInCatalog.isDomestic })
    .from(modelsInCatalog)
    .innerJoin(brandsInCatalog, eq(brandsInCatalog.id, modelsInCatalog.brandId))
    .where(eq(modelsInCatalog.id, modelId));
  return row ?? null;
}

export async function listTrimsByModel(modelId: number) {
  const trims = await db
    .select({
      id: trimsInCatalog.id,
      name: trimsInCatalog.name,
      trimName: trimsInCatalog.trimName,
      canonicalName: trimsInCatalog.canonicalName,
      price: trimsInCatalog.price,
      modelYear: trimsInCatalog.modelYear,
      fuelType: trimsInCatalog.fuelType,
      driveSystem: trimsInCatalog.driveSystem,
      displacementCc: trimsInCatalog.displacementCc,
      transmissionType: trimsInCatalog.transmissionType,
      bodyStyle: trimsInCatalog.bodyStyle,
      seatingCapacity: trimsInCatalog.seatingCapacity,
      status: trimsInCatalog.status,
      mcCode: trimsInCatalog.mcCode,
      sortOrder: trimsInCatalog.sortOrder,
    })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.modelId, modelId))
    .orderBy(asc(trimsInCatalog.sortOrder));
  return trims;
}

export async function createTrim(
  input: {
    modelId: number;
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
  },
  executor: Executor = db,
) {
  const ctx = await modelCanonicalContext(input.modelId, executor);
  if (!ctx) throw new Error("모델을 찾을 수 없습니다.");
  const canonicalName = buildCanonicalName({
    brand: ctx.brand,
    model: ctx.model,
    isDomestic: ctx.isDomestic,
    modelYear: input.modelYear,
    fuelType: input.fuelType,
    trimName: input.trimName,
  });
  const [row] = await executor
    .insert(trimsInCatalog)
    .values({
      modelId: input.modelId,
      name: input.trimName,
      trimName: input.trimName,
      canonicalName,
      price: input.price,
      modelYear: input.modelYear,
      fuelType: input.fuelType,
      driveSystem: input.driveSystem ?? null,
      displacementCc: input.displacementCc ?? null,
      transmissionType: input.transmissionType ?? null,
      bodyStyle: input.bodyStyle ?? null,
      seatingCapacity: input.seatingCapacity ?? null,
      status: input.status ?? "판매중",
    })
    .returning();
  return row;
}

export async function updateTrim(
  id: number,
  input: Partial<{
    trimName: string;
    price: number;
    modelYear: number;
    fuelType: string;
    driveSystem: string | null;
    displacementCc: number | null;
    transmissionType: string | null;
    bodyStyle: string | null;
    seatingCapacity: number | null;
    status: VehicleStatus;
  }>,
  executor: Executor = db,
) {
  const patch: Record<string, unknown> = {};
  if (input.trimName !== undefined) {
    patch.trimName = input.trimName;
    patch.name = input.trimName;
  }
  for (const k of ["price", "modelYear", "fuelType", "driveSystem", "displacementCc", "transmissionType", "bodyStyle", "seatingCapacity", "status"] as const) {
    if (input[k] !== undefined) {
      const col = { price: "price", modelYear: "modelYear", fuelType: "fuelType", driveSystem: "driveSystem", displacementCc: "displacementCc", transmissionType: "transmissionType", bodyStyle: "bodyStyle", seatingCapacity: "seatingCapacity", status: "status" }[k];
      patch[col] = input[k];
    }
  }
  const [row] = await executor.update(trimsInCatalog).set(patch).where(eq(trimsInCatalog.id, id)).returning();
  return row ?? null;
}

export async function deleteTrim(id: number, executor: Executor = db) {
  const [row] = await executor.delete(trimsInCatalog).where(eq(trimsInCatalog.id, id)).returning({ id: trimsInCatalog.id });
  return row ?? null;
}
```

> `trimName` 변경 시 `name`도 같이 갱신(앱과 동일). `canonical_name`은 트림명/연식/연료 변경 시 재계산이 이상적이나, 앱도 수정 시 canonical 재계산을 보장하지 않으므로 Phase 1은 **생성 시에만** canonical 설정(수정 시 미변경). 필요 시 Phase 2에서 재계산 추가.

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: 커밋**

```bash
git add src/db/queries/catalog-admin.ts
git commit -m "feat(catalog-admin): 트림 CRUD (canonical 적용) (A2 Phase 1a)"
```

---

## Task 4: catalog-admin 쿼리 — 옵션 CRUD + 옵션수/색상 조회

**Files:**
- Modify: `src/db/queries/catalog-admin.ts`

- [ ] **Step 1: 옵션 + 트림 부가정보 조회 추가 (파일 끝에 append)**

```ts
// ── 옵션 ──────────────────────────────────────────────────────────────────────
export async function listOptionsByTrim(trimId: number) {
  return db
    .select({ id: trimOptionsInCatalog.id, type: trimOptionsInCatalog.type, name: trimOptionsInCatalog.name, price: trimOptionsInCatalog.price })
    .from(trimOptionsInCatalog)
    .where(eq(trimOptionsInCatalog.trimId, trimId))
    .orderBy(asc(trimOptionsInCatalog.id));
}

export async function createOption(
  input: { trimId: number; type: "basic" | "tuning"; name: string; price: number | null },
  executor: Executor = db,
) {
  const [row] = await executor
    .insert(trimOptionsInCatalog)
    .values({ trimId: input.trimId, type: input.type, name: input.name, price: input.price })
    .returning();
  return row;
}

export async function updateOption(
  id: number,
  input: { name?: string; price?: number | null },
  executor: Executor = db,
) {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.price !== undefined) patch.price = input.price;
  const [row] = await executor.update(trimOptionsInCatalog).set(patch).where(eq(trimOptionsInCatalog.id, id)).returning();
  return row ?? null;
}

export async function deleteOption(id: number, executor: Executor = db) {
  const [row] = await executor.delete(trimOptionsInCatalog).where(eq(trimOptionsInCatalog.id, id)).returning({ id: trimOptionsInCatalog.id });
  return row ?? null;
}

// 트림 색상(읽기 전용 칩) — Phase 1 표시용.
export async function listColorsByTrim(trimId: number) {
  return db
    .select({ id: colorsInCatalog.id, colorType: colorsInCatalog.colorType, name: colorsInCatalog.name, hexValue: colorsInCatalog.hexValue })
    .from(colorsInCatalog)
    .where(eq(colorsInCatalog.trimId, trimId))
    .orderBy(asc(colorsInCatalog.sortOrder));
}
```

> `sql`/`and` import가 Task 2에서 미사용으로 남으면 lint가 잡는다 → 실제 미사용 import는 정리(Step 2). `colorType` 필터는 프론트에서 exterior/interior 분리.

- [ ] **Step 2: 미사용 import 정리 + typecheck + lint**

`catalog-admin.ts` import에서 실제 미사용(예: `and`, `sql`)을 제거.
Run: `bun run typecheck` → 0
Run: `bun run lint` → 0

- [ ] **Step 3: 커밋**

```bash
git add src/db/queries/catalog-admin.ts
git commit -m "feat(catalog-admin): 옵션 CRUD + 색상 조회 (A2 Phase 1a)"
```

---

## Task 5: 라우트 + zod (`/api/catalog/*`)

**Files:**
- Modify: `src/routes/catalog.ts`

- [ ] **Step 1: 라우트 전체 교체**

`src/routes/catalog.ts`:
```ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getBrands } from "../db/queries/vehicles";
import { getCatalogCounts } from "../db/queries/catalog-counts";
import {
  VEHICLE_STATUSES,
  createModel,
  createOption,
  createTrim,
  deleteModel,
  deleteOption,
  deleteTrim,
  listColorsByTrim,
  listModelsByBrand,
  listOptionsByTrim,
  listTrimsByModel,
  updateModel,
  updateOption,
  updateTrim,
} from "../db/queries/catalog-admin";

export const catalog = new Hono();

const id = z.coerce.number().int().positive();
const status = z.enum(VEHICLE_STATUSES);
const optionType = z.enum(["basic", "tuning"]);

// 트리거/제약 위반 등 DB 에러를 한글 메시지로.
function dbErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/trim_name/.test(msg) && /(format|hyphen| - )/i.test(msg)) return "국산차 트림명은 '서브라인 - 등급' 형식이어야 합니다.";
  if (/foreign key|violates foreign key|23503/.test(msg)) return "참조 중인 데이터가 있어 삭제할 수 없습니다(견적 등).";
  if (/단종|status/.test(msg)) return "단종 모델의 트림은 단종/블라인드 상태만 가능합니다.";
  return msg;
}
async function guard<T>(c: { json: (b: unknown, s?: 200 | 400 | 404 | 500) => Response }, fn: () => Promise<T>) {
  try {
    return c.json(await fn());
  } catch (e) {
    return c.json({ error: dbErrorMessage(e) }, 500);
  }
}

catalog.get("/counts", async (c) => c.json(await getCatalogCounts()));
catalog.get("/brands", async (c) => c.json(await getBrands()));

// 모델
catalog.get("/models", zValidator("query", z.object({ brandId: id })), async (c) =>
  c.json((await listModelsByBrand(c.req.valid("query").brandId)).map((m) => ({ ...m, trimCount: Number(m.trimCount), minPrice: m.minPrice == null ? null : Number(m.minPrice), maxPrice: m.maxPrice == null ? null : Number(m.maxPrice) }))),
);
catalog.post(
  "/models",
  zValidator("json", z.object({ brandId: id, name: z.string().min(1), category: z.string().nullable().default(null), status: status.default("판매중") })),
  async (c) => guard(c, () => createModel(c.req.valid("json"))),
);
catalog.patch(
  "/models/:id",
  zValidator("param", z.object({ id })),
  zValidator("json", z.object({ category: z.string().nullable().optional(), status: status.optional() })),
  async (c) => guard(c, async () => (await updateModel(c.req.valid("param").id, c.req.valid("json"))) ?? Promise.reject(new Error("모델 없음"))),
);
catalog.delete("/models/:id", zValidator("param", z.object({ id })), async (c) => guard(c, () => deleteModel(c.req.valid("param").id)));

// 트림
catalog.get("/trims", zValidator("query", z.object({ modelId: id })), async (c) => {
  const trims = await listTrimsByModel(c.req.valid("query").modelId);
  return c.json(trims.map((t) => ({ ...t, price: Number(t.price) })));
});
catalog.post(
  "/trims",
  zValidator(
    "json",
    z.object({
      modelId: id,
      trimName: z.string().min(1),
      price: z.number().int().nonnegative(),
      modelYear: z.number().int(),
      fuelType: z.string().min(1),
      driveSystem: z.string().nullable().optional(),
      displacementCc: z.number().int().nullable().optional(),
      transmissionType: z.string().nullable().optional(),
      bodyStyle: z.string().nullable().optional(),
      seatingCapacity: z.number().int().nullable().optional(),
      status: status.optional(),
    }),
  ),
  async (c) => guard(c, () => createTrim(c.req.valid("json"))),
);
catalog.patch(
  "/trims/:id",
  zValidator("param", z.object({ id })),
  zValidator(
    "json",
    z.object({
      trimName: z.string().min(1).optional(),
      price: z.number().int().nonnegative().optional(),
      modelYear: z.number().int().optional(),
      fuelType: z.string().min(1).optional(),
      driveSystem: z.string().nullable().optional(),
      displacementCc: z.number().int().nullable().optional(),
      transmissionType: z.string().nullable().optional(),
      bodyStyle: z.string().nullable().optional(),
      seatingCapacity: z.number().int().nullable().optional(),
      status: status.optional(),
    }),
  ),
  async (c) => guard(c, async () => (await updateTrim(c.req.valid("param").id, c.req.valid("json"))) ?? Promise.reject(new Error("트림 없음"))),
);
catalog.delete("/trims/:id", zValidator("param", z.object({ id })), async (c) => guard(c, () => deleteTrim(c.req.valid("param").id)));

// 옵션 / 색상
catalog.get("/trims/:id/options", zValidator("param", z.object({ id })), async (c) => c.json(await listOptionsByTrim(c.req.valid("param").id)));
catalog.get("/trims/:id/colors", zValidator("param", z.object({ id })), async (c) => c.json(await listColorsByTrim(c.req.valid("param").id)));
catalog.post(
  "/trims/:id/options",
  zValidator("param", z.object({ id })),
  zValidator("json", z.object({ type: optionType, name: z.string().min(1), price: z.number().int().nullable().default(null) })),
  async (c) => guard(c, () => createOption({ trimId: c.req.valid("param").id, ...c.req.valid("json") })),
);
catalog.patch(
  "/options/:id",
  zValidator("param", z.object({ id })),
  zValidator("json", z.object({ name: z.string().min(1).optional(), price: z.number().int().nullable().optional() })),
  async (c) => guard(c, async () => (await updateOption(c.req.valid("param").id, c.req.valid("json"))) ?? Promise.reject(new Error("옵션 없음"))),
);
catalog.delete("/options/:id", zValidator("param", z.object({ id })), async (c) => guard(c, () => deleteOption(c.req.valid("param").id)));
```

- [ ] **Step 2: typecheck + lint**

Run: `bun run typecheck` → 0
Run: `bun run lint` → 0
(`guard`의 `c` 타입이 안 맞으면 Hono `Context`로 좁히고 status 코드 union을 조정.)

- [ ] **Step 3: 커밋**

```bash
git add src/routes/catalog.ts
git commit -m "feat(catalog): 차량 관리 admin 라우트 + zod (/api/catalog/models·trims·options) (A2 Phase 1a)"
```

---

## Task 6: tx 롤백 통합테스트 (prod 무변경)

**Files:**
- Create: `src/db/queries/catalog-admin.test.ts`

> `bun test`(test:server)로 실행하며 `DATABASE_URL`(master)이 필요하다. 모든 쓰기는 `db.transaction` 안에서 수행하고 끝에서 강제 throw로 롤백 → prod에 남지 않는다. 트리거(BEFORE INSERT sort_order 등)는 tx 안에서도 실행되므로 효과를 검증할 수 있다.

- [ ] **Step 1: 테스트 작성**

`src/db/queries/catalog-admin.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { expect, test } from "bun:test";

import { brandsInCatalog, modelsInCatalog } from "../catalog";
import { db } from "../client";
import { createModel, createOption, createTrim, deleteModel, deleteTrim, listModelsByBrand, listOptionsByTrim, updateModel, updateTrim } from "./catalog-admin";

class Rollback extends Error {}

// 모든 케이스를 하나의 롤백 tx로 — prod 무변경.
test("catalog-admin CRUD (tx 롤백, prod 무변경)", async () => {
  await db
    .transaction(async (tx) => {
      // 임의 기존 브랜드 1개 확보(국산 우선)
      const [brand] = await tx.select({ id: brandsInCatalog.id, isDomestic: brandsInCatalog.isDomestic }).from(brandsInCatalog).limit(1);
      expect(brand).toBeDefined();

      // 모델 생성 → sort_order 트리거 자동 부여
      const model = await createModel({ brandId: brand.id, name: "__CRM_TEST_MODEL__", category: "중형 세단", status: "판매중" }, tx);
      expect(model.id).toBeGreaterThan(0);
      expect(model.sortOrder).not.toBeNull();

      // 목록 집계에 노출
      const models = await tx
        .select({ id: modelsInCatalog.id })
        .from(modelsInCatalog)
        .where(eq(modelsInCatalog.id, model.id));
      expect(models.length).toBe(1);

      // 모델 수정(category·status)
      const updated = await updateModel(model.id, { category: "대형 SUV" }, tx);
      expect(updated?.category).toBe("대형 SUV");

      // 트림 생성 → canonical 자동, sort_order 트리거
      const trim = await createTrim(
        { modelId: model.id, trimName: "테스트트림", price: 50000000, modelYear: 2026, fuelType: "가솔린" },
        tx,
      );
      expect(trim.canonicalName).toContain("테스트트림");
      expect(trim.name).toBe("테스트트림");
      expect(trim.sortOrder).not.toBeNull();

      // 트림 수정
      const trimUp = await updateTrim(trim.id, { price: 51000000, status: "출시예정" }, tx);
      expect(Number(trimUp?.price)).toBe(51000000);
      expect(trimUp?.status).toBe("출시예정");

      // 옵션 생성/조회
      const opt = await createOption({ trimId: trim.id, type: "tuning", name: "테스트옵션", price: 1000000 }, tx);
      expect(opt.id).toBeGreaterThan(0);
      const opts = await listOptionsByTrim(trim.id); // 주: listOptionsByTrim은 db 사용 → tx 밖. 아래 주석 참고.
      void opts;

      // 트림 삭제 → 옵션 cascade(FK)
      await deleteTrim(trim.id, tx);
      // 모델 삭제 → 트림 cascade
      await deleteModel(model.id, tx);

      throw new Rollback(); // 전부 롤백
    })
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
});
```

> 주의: 조회 함수(`listModelsByBrand`/`listOptionsByTrim`)는 모듈 `db`를 쓰므로 tx 밖을 본다(tx 내 삽입 행이 안 보일 수 있음). tx 내부 가시성 검증은 위처럼 `tx.select(...)`를 직접 쓴다. 조회 함수 자체의 정상 동작(스키마/필드)은 Task 5의 라우트 스모크(Step 2)에서 실데이터로 확인한다. (조회 함수를 tx로 검증하려면 executor 인자를 조회 함수에도 추가하는 리팩터가 필요 — Phase 1엔 과함.)

- [ ] **Step 2: 실행 (master 주입)**

Run:
```bash
DBURL=$(grep -E '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']$//')
DATABASE_URL="$DBURL" bun test src/db/queries/catalog-admin.test.ts
```
Expected: PASS. 직후 psql로 잔존 확인:
```bash
psql "$DBURL" -At -c "select count(*) from catalog.models where name='__CRM_TEST_MODEL__';"
```
Expected: `0` (롤백되어 prod에 안 남음).

- [ ] **Step 3: 라우트 스모크 (읽기 경로 실데이터 — 무변경)**

Run (dev API 기동 후 또는 app.request):
```bash
DATABASE_URL="$DBURL" bun -e '
import { app } from "./src/app.ts";
const brands = await (await app.request("/api/catalog/brands")).json();
const models = await (await app.request("/api/catalog/models?brandId=" + brands[0].id)).json();
console.log("brands", brands.length, "models", models.length, "sample", JSON.stringify(models[0]));
process.exit(0);
'
```
Expected: brands·models 응답 정상, models[0]에 `trimCount/minPrice/maxPrice` 숫자 포함, 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/db/queries/catalog-admin.test.ts
git commit -m "test(catalog-admin): tx 롤백 통합테스트 + 라우트 스모크 (A2 Phase 1a)"
```

---

## Task 7: 최종 검증

- [ ] **Step 1: 전체 게이트**

Run: `bun run typecheck` → 0
Run: `bun run lint` → 0
Run: `bun run test:unit` → 기존 + canonical-name 통과
Run: `DATABASE_URL="$DBURL" bun run test:server` → 기존 13 + catalog-admin 통과
Run: `bun run build` → OK

- [ ] **Step 2: knip** (`bun run knip`) — 새 dead export 없는지(있으면 라우트에서 쓰이므로 대부분 해소). pre-existing 외 신규 0 확인.

---

## Self-Review

- **Spec coverage:** 쓰기 경로(직접 catalog write)✓ / 모델·트림·옵션 CRUD✓ / canonical 파생✓ / status enum✓ / 집계(가격범위·트림수)✓ / 색상 읽기✓ / 에러 한글화·FK 표면화✓ / 트리거 의존(재구현 0)✓ / 라이브 안전(tx 롤백 테스트)✓. UI·권한게이트·taxonomy 드롭다운은 Phase 1b(프론트).
- **Placeholder scan:** 모든 step에 실제 코드/명령. canonical 파생식은 앱 확인값으로 확정.
- **Type consistency:** `VehicleStatus`/`VEHICLE_STATUSES`는 catalog-admin에서 정의→라우트 zod(`z.enum(VEHICLE_STATUSES)`)·테스트 일관. 함수 시그니처(`createModel/updateModel/createTrim/...`)가 라우트·테스트에서 동일하게 호출됨. `Executor` 인자 위치(끝, 기본 db) 일관.

## 미결 / 주의

- `Executor` 타입(`typeof db | PgTransaction<…>`)이 drizzle 버전에서 빡빡하면 `Parameters<typeof db.transaction>[0]` 첫 인자 타입으로 좁히거나, 최소 공통 인터페이스로 정의(any 금지 — `unknown` 좁히기/제네릭 사용).
- 조회 함수의 tx 가시성 한계는 위 테스트 주석대로 `tx.select` 직접 사용으로 우회.
- 서버측 권한 강제는 Phase 1b/이후(현재 UI 게이트). 라우트는 내부 staff 도구 전제.
- mc_code/trim_code, 재정렬, 색상/할인/relations 편집은 Phase 2.

## Execution Handoff

prod 무변경(쓰기는 tx 롤백 테스트만, 스모크는 읽기). 실행 옵션:
1. **Inline (추천)** — executing-plans, task별 체크포인트.
2. **Subagent-Driven** — task별 fresh subagent + 리뷰.
</content>
