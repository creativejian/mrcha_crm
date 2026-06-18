# CRM Hyperdrive 도입 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CRM 백엔드(Hono + postgres.js on CF Pages Functions)가 요청 컨텍스트에서 db를 생성/주입하도록 바꿔 Cloudflare Hyperdrive(edge connection pooling)를 경유시키고, 로컬·테스트·binding 부재 시 `process.env.DATABASE_URL` fallback을 유지한다.

**Architecture:** `client.ts`에 `createDb(connStr)` 팩토리(connStr별 메모이즈) + `getDefaultDb()`(fallback)를 둔다. `dbMiddleware`가 `c.env.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL`을 해석해 `c.var.db`로 주입한다. 모든 query 함수는 기존 write 함수의 `executor` 파라미터 패턴으로 일원화하고(read 함수는 기본값 `getDefaultDb()`), 라우트가 `c.var.db`를 넘긴다.

**Tech Stack:** Hono 4, postgres.js 3.4.9, drizzle-orm 0.45, Cloudflare Pages Functions(`nodejs_compat`) + Hyperdrive binding, Bun test(`--env-file=.env.local`).

**참조 스펙:** `ref/specs/2026-06-18-crm-hyperdrive-design.md`

**전제(분담):** Hyperdrive 인스턴스(origin=Supabase **session pooler 5432**, **캐싱 비활성**, Workers Paid plan)는 이사님이 생성·등록 후 **binding id**를 전달한다. Task 5는 binding id를 받기 전까지 placeholder로 두고, 받으면 채운다. 코드는 binding 부재 상태에서도 fallback으로 정상 동작하므로 무중단.

**유지:** #40 안전망(`client/src/lib/api.ts`의 GET 5xx 재시도, `MCMasterPage` loadError 리셋)은 **건드리지 않는다.**

---

### Task 0: 작업 브랜치 생성

**Files:** (없음 — git 작업)

- [ ] **Step 1: main 최신화 + 브랜치 생성**

```bash
git switch main && git pull --ff-only
git switch -c feat/hyperdrive-db-context
```

- [ ] **Step 2: 현재 테스트가 green인지 베이스라인 확인**

Run: `bun run typecheck && bun run lint && bun run test:server --env-file=.env.local`
Expected: typecheck 0, lint 0, server test 28+ PASS (리팩토링 전 기준선)

---

### Task 1: `client.ts` — 팩토리 + 메모이즈 + fallback + 타입

**Files:**
- Modify: `src/db/client.ts` (전체 교체)

- [ ] **Step 1: `client.ts`를 아래로 교체**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as catalog from "./catalog";
import * as schema from "./schema";

// connStr 하나당 drizzle 인스턴스 1개를 isolate 스코프에 메모이즈한다.
// CF Pages Functions는 isolate가 여러 요청을 처리하므로, 같은 connStr이면
// 요청마다 새 postgres 클라이언트를 만들지 않고 재사용한다.
const pool = new Map<string, ReturnType<typeof build>>();

// `prepare: false` — fallback origin(Supabase transaction pooler 6543)은 prepared statement 미지원.
// Hyperdrive 경로(session pooler 5432)는 true 가능하나 v1은 parity·무중단을 위해 false 통일.
function build(connStr: string) {
  const client = postgres(connStr, { prepare: false });
  return drizzle(client, { schema: { ...schema, ...catalog } });
}

// 요청 컨텍스트의 connection string(Hyperdrive 또는 fallback)으로 db를 얻는다.
export function createDb(connStr: string) {
  let db = pool.get(connStr);
  if (!db) {
    db = build(connStr);
    pool.set(connStr, db);
  }
  return db;
}

// 로컬 dev · 테스트 · CF에서 Hyperdrive binding이 없을 때의 fallback.
export function getDefaultDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.local / .env.example)");
  return createDb(url);
}

export type Db = ReturnType<typeof createDb>;
// 쓰기 함수는 db 또는 tx(transaction 콜백 인자)를 받는다.
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export { catalog, schema };
```

- [ ] **Step 2: typecheck (아직 다른 파일은 `db` import라 실패 예상)**

Run: `bun run typecheck`
Expected: FAIL — `vehicles.ts`/`catalog-admin.ts`/`catalog-counts.ts`/`routes/catalog.ts`/`catalog-admin.test.ts`가 더 이상 없는 `db`/`Executor` export를 import. (Task 2~4에서 해소)

- [ ] **Step 3: 커밋**

```bash
git add src/db/client.ts
git commit -m "refactor(db): client.ts에 createDb 팩토리+메모이즈+getDefaultDb fallback 도입"
```

---

### Task 2: query 함수 `executor` 일원화

**Files:**
- Modify: `src/db/queries/catalog-admin.ts`
- Modify: `src/db/queries/vehicles.ts`
- Modify: `src/db/queries/catalog-counts.ts`

- [ ] **Step 1: `catalog-admin.ts` — import와 Executor 타입 정리**

상단 import에서 `Executor` 로컬 정의를 제거하고 client.ts에서 가져온다. 14~16행 부근의 `import { db } from "../client";`와 `type Executor = ...` 블록을 아래로 교체:

```ts
import { db, type Executor } from "../client"; // ← 임시: 다음 스텝에서 db→getDefaultDb로 교체
import { buildCanonicalName } from "./canonical-name";
```

그리고 기존 `type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];` 줄을 **삭제**한다.

- [ ] **Step 2: `catalog-admin.ts` — write 함수 기본값 일괄 교체**

`executor: Executor = db` → `executor: Executor = getDefaultDb()` 전부 치환(18곳). import도 `db`를 빼고 `getDefaultDb`로:

```ts
import { getDefaultDb, type Executor } from "../client";
```

치환 명령(에디터 replace_all 또는):
```bash
# 검토용: 치환 대상 확인
grep -n "Executor = db" src/db/queries/catalog-admin.ts
```
모든 `executor: Executor = db`를 `executor: Executor = getDefaultDb()`로 바꾼다.

- [ ] **Step 3: `catalog-admin.ts` — read 함수에 executor 추가**

`db`를 직접 쓰는 read 함수 6개를 executor 파라미터로 바꾼다.

`listModelsByBrand`:
```ts
export async function listModelsByBrand(brandId: number, executor: Executor = getDefaultDb()) {
  return executor
    .select({ /* …기존 select 동일… */ })
    .from(modelsInCatalog)
    .leftJoin(trimsInCatalog, eq(trimsInCatalog.modelId, modelsInCatalog.id))
    .where(eq(modelsInCatalog.brandId, brandId))
    .groupBy(modelsInCatalog.id)
    .orderBy(asc(modelsInCatalog.sortOrder));
}
```
`listTrimsByModel`:
```ts
export async function listTrimsByModel(modelId: number, executor: Executor = getDefaultDb()) {
  return executor
    .select({ /* …기존 select 동일… */ })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.modelId, modelId))
    .orderBy(asc(trimsInCatalog.sortOrder));
}
```
`listOptionsByTrim`:
```ts
export async function listOptionsByTrim(trimId: number, executor: Executor = getDefaultDb()) {
  return executor
    .select({ id: trimOptionsInCatalog.id, type: trimOptionsInCatalog.type, name: trimOptionsInCatalog.name, price: trimOptionsInCatalog.price })
    .from(trimOptionsInCatalog)
    .where(eq(trimOptionsInCatalog.trimId, trimId))
    .orderBy(asc(trimOptionsInCatalog.id));
}
```
`listOptionRelationsByTrim` (내부 `db` 2회 모두 executor로):
```ts
export async function listOptionRelationsByTrim(trimId: number, executor: Executor = getDefaultDb()) {
  const opts = await executor
    .select({ id: trimOptionsInCatalog.id })
    .from(trimOptionsInCatalog)
    .where(eq(trimOptionsInCatalog.trimId, trimId));
  const ids = opts.map((o) => o.id);
  if (ids.length === 0) return [];
  return executor
    .select({ optionId: trimOptionRelationsInCatalog.optionId, relatedOptionId: trimOptionRelationsInCatalog.relatedOptionId, type: trimOptionRelationsInCatalog.type })
    .from(trimOptionRelationsInCatalog)
    .where(inArray(trimOptionRelationsInCatalog.optionId, ids));
}
```
`listTrimColorsByModel`:
```ts
export async function listTrimColorsByModel(modelId: number, executor: Executor = getDefaultDb()) {
  return executor
    .select({ trimId: colorsInCatalog.trimId, colorType: colorsInCatalog.colorType, name: colorsInCatalog.name, hexValue: colorsInCatalog.hexValue, sortOrder: colorsInCatalog.sortOrder })
    .from(colorsInCatalog)
    .innerJoin(trimsInCatalog, eq(trimsInCatalog.id, colorsInCatalog.trimId))
    .where(eq(trimsInCatalog.modelId, modelId))
    .orderBy(asc(colorsInCatalog.sortOrder));
}
```
`listColorsByTrim`:
```ts
export async function listColorsByTrim(trimId: number, executor: Executor = getDefaultDb()) {
  return executor
    .select({ id: colorsInCatalog.id, colorType: colorsInCatalog.colorType, name: colorsInCatalog.name, hexValue: colorsInCatalog.hexValue })
    .from(colorsInCatalog)
    .where(eq(colorsInCatalog.trimId, trimId))
    .orderBy(asc(colorsInCatalog.sortOrder));
}
```
> `modelCanonicalContext`, `listModelOptionSummary`, `setTrimNoOption`, `unsetTrimNoOption`, `modelHasCodes`, `maxTrimCode`, `assignMcCodes`, `moveTrims`, `reorderCatalog`는 Step 2의 일괄 치환으로 이미 `= getDefaultDb()`가 되어 추가 작업 없음.

- [ ] **Step 4: `vehicles.ts` — read 함수 4개 executor화**

상단 import 교체: `import { db } from "../client";` → `import { getDefaultDb, type Executor } from "../client";`

```ts
export async function getBrands(executor: Executor = getDefaultDb()) {
  return executor
    .select({ /* …기존 동일… */ })
    .from(brandsInCatalog)
    .orderBy(asc(brandsInCatalog.sortOrder));
}

export async function getModelsByBrand(brandId: number, executor: Executor = getDefaultDb()) {
  return executor
    .select({ /* …기존 동일… */ })
    .from(modelsInCatalog)
    .where(eq(modelsInCatalog.brandId, brandId))
    .orderBy(asc(modelsInCatalog.sortOrder));
}

export async function getTrimsByModel(modelId: number, executor: Executor = getDefaultDb()) {
  return executor
    .select({ /* …기존 동일… */ })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.modelId, modelId))
    .orderBy(asc(trimsInCatalog.sortOrder));
}
```
`getTrimDetail`은 내부에서 `db`를 5회 사용 → 모두 executor로:
```ts
export async function getTrimDetail(trimId: number, executor: Executor = getDefaultDb()) {
  const [trim] = await executor.select({ /* …기존 동일… */ }).from(trimsInCatalog).where(eq(trimsInCatalog.id, trimId));
  if (!trim) return null;
  const options = await executor.select({ /* …기존 동일… */ }).from(trimOptionsInCatalog).where(eq(trimOptionsInCatalog.trimId, trimId));
  const optionIds = options.map((o) => o.id);
  const optionRelations = optionIds.length
    ? await executor.select({ /* …기존 동일… */ }).from(trimOptionRelationsInCatalog).where(inArray(trimOptionRelationsInCatalog.optionId, optionIds))
    : [];
  const colors = await executor.select({ /* …기존 동일… */ }).from(colorsInCatalog).where(eq(colorsInCatalog.trimId, trimId)).orderBy(asc(colorsInCatalog.sortOrder));
  const [noOptions] = await executor.select({ /* …기존 동일… */ }).from(trimNoOptionsInCatalog).where(eq(trimNoOptionsInCatalog.trimId, trimId));
  return { ...trim, options, optionRelations, colors, noOptions: noOptions ?? null };
}
```
> select 본문은 기존 코드 그대로 두고 `db.` → `executor.`만 바꾼다.

- [ ] **Step 5: `catalog-counts.ts` — executor 전달(순차 await 유지)**

import 교체: `import { db } from "../client";` → `import { getDefaultDb, type Executor } from "../client";`

```ts
async function tableCount(table: PgTable, executor: Executor): Promise<number> {
  const [row] = await executor.select({ c: count() }).from(table);
  return row?.c ?? 0;
}

export async function getCatalogCounts(executor: Executor = getDefaultDb()): Promise<CatalogCounts> {
  return {
    brands: await tableCount(brandsInCatalog, executor),
    models: await tableCount(modelsInCatalog, executor),
    trims: await tableCount(trimsInCatalog, executor),
    trimOptions: await tableCount(trimOptionsInCatalog, executor),
    colors: await tableCount(colorsInCatalog, executor),
    trimNoOptions: await tableCount(trimNoOptionsInCatalog, executor),
    trimOptionRelations: await tableCount(trimOptionRelationsInCatalog, executor),
  };
}
```

- [ ] **Step 6: query 단위 테스트로 회귀 확인**

Run: `bun test src/db/queries --env-file=.env.local`
Expected: PASS — `vehicles.test.ts`(인자 없이 호출 → 기본값 fallback), `catalog-admin.test.ts`(아직 `db.transaction` 사용 → Task 4 전이라 **여기서는 import 에러로 FAIL일 수 있음**). vehicles/catalog-counts 테스트가 통과하면 OK.

> 주의: `catalog-admin.test.ts`는 Task 4에서 고친다. 이 스텝에서는 `vehicles.test.ts`·`catalog-counts.test.ts` 통과만 확인.

- [ ] **Step 7: 커밋**

```bash
git add src/db/queries/catalog-admin.ts src/db/queries/vehicles.ts src/db/queries/catalog-counts.ts
git commit -m "refactor(db): query 함수 executor 파라미터 일원화(read 기본값 getDefaultDb)"
```

---

### Task 3: `dbMiddleware` + app 배선 + 라우트 `c.var.db`

**Files:**
- Create: `src/middleware/db.ts`
- Modify: `src/app.ts`
- Modify: `src/routes/vehicles.ts`
- Modify: `src/routes/catalog.ts`

- [ ] **Step 1: `src/middleware/db.ts` 작성**

```ts
import type { MiddlewareHandler } from "hono";

import { createDb, getDefaultDb, type Db } from "../db/client";

export type DbVariables = { db: Db };

// CF Pages Functions: c.env.HYPERDRIVE.connectionString이 있으면 Hyperdrive 경유.
// 로컬(Bun.serve)·테스트(app.request)는 c.env가 없어 getDefaultDb() fallback.
export const dbMiddleware: MiddlewareHandler<{ Variables: DbVariables }> = async (c, next) => {
  const connStr = (c.env as { HYPERDRIVE?: { connectionString: string } } | undefined)?.HYPERDRIVE?.connectionString;
  c.set("db", connStr ? createDb(connStr) : getDefaultDb());
  await next();
};
```

- [ ] **Step 2: `src/app.ts` — dbMiddleware 배선**

import 추가:
```ts
import { dbMiddleware } from "./middleware/db";
```
보호 라우트 블록을 아래로(auth 뒤에 db 미들웨어 추가 — 401은 db 생성 안 함):
```ts
  // 보호 라우트: 카카오 로그인(Supabase JWT) + role 게이트, 이후 요청 컨텍스트 db 주입.
  app.use("/api/vehicles/*", auth);
  app.use("/api/vehicles/*", dbMiddleware);
  app.use("/api/catalog/*", auth);
  app.use("/api/catalog/*", dbMiddleware);
```

- [ ] **Step 3: `src/routes/vehicles.ts` — c.var.db 전달**

Hono 인스턴스에 Variables 타입 부여 + 각 query 호출에 `c.var.db` 전달:
```ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { DbVariables } from "../middleware/db";
import { getBrands, getModelsByBrand, getTrimDetail, getTrimsByModel } from "../db/queries/vehicles";

const idSchema = z.coerce.number().int().positive();

export const vehicles = new Hono<{ Variables: DbVariables }>();

vehicles.get("/brands", async (c) => c.json(await getBrands(c.var.db)));

vehicles.get("/models", zValidator("query", z.object({ brandId: idSchema })), async (c) =>
  c.json(await getModelsByBrand(c.req.valid("query").brandId, c.var.db)),
);

vehicles.get("/trims", zValidator("query", z.object({ modelId: idSchema })), async (c) =>
  c.json(await getTrimsByModel(c.req.valid("query").modelId, c.var.db)),
);

vehicles.get("/trims/:trimId", zValidator("param", z.object({ trimId: idSchema })), async (c) => {
  const detail = await getTrimDetail(c.req.valid("param").trimId, c.var.db);
  if (!detail) return c.json({ error: "Trim not found" }, 404);
  return c.json(detail);
});
```

- [ ] **Step 4: `src/routes/catalog.ts` — c.var.db 전달**

상단: `import { db } from "../db/client";` 제거. Hono 인스턴스 타입 부여:
```ts
import type { DbVariables } from "../middleware/db";
// …
export const catalog = new Hono<{ Variables: DbVariables }>();
```
각 query 호출에 `c.var.db`를 executor로 추가, `db.transaction` → `c.var.db.transaction`. 대표 변경:
```ts
catalog.get("/counts", async (c) => c.json(await getCatalogCounts(c.var.db)));
catalog.get("/brands", async (c) => c.json(await getBrands(c.var.db)));

catalog.get("/models", zValidator("query", z.object({ brandId: id })), async (c) => {
  const rows = await listModelsByBrand(c.req.valid("query").brandId, c.var.db);
  return c.json(rows.map((m) => ({ ...m, trimCount: Number(m.trimCount), minPrice: m.minPrice == null ? null : Number(m.minPrice), maxPrice: m.maxPrice == null ? null : Number(m.maxPrice) })));
});

catalog.post("/models", zValidator("json", /* 동일 */), async (c) => run(c, () => createModel(c.req.valid("json"), c.var.db)));
catalog.patch("/models/:id", /* validators 동일 */, async (c) => run(c, () => updateModel(c.req.valid("param").id, c.req.valid("json"), c.var.db), "모델을 찾을 수 없습니다."));
catalog.delete("/models/:id", zValidator("param", z.object({ id })), async (c) => run(c, () => deleteModel(c.req.valid("param").id, c.var.db), "모델을 찾을 수 없습니다."));

catalog.post("/models/:id/assign-codes", zValidator("param", z.object({ id })), async (c) =>
  run(c, () => c.var.db.transaction((tx) => assignMcCodes(c.req.valid("param").id, tx))),
);

catalog.post("/models/reorder", zValidator("json", z.object({ ids: z.array(id).min(1) })), async (c) =>
  run(c, async () => { await reorderCatalog("models", c.req.valid("json").ids, c.var.db); return { ok: true }; }),
);
catalog.post("/trims/reorder", zValidator("json", z.object({ ids: z.array(id).min(1) })), async (c) =>
  run(c, async () => { await reorderCatalog("trims", c.req.valid("json").ids, c.var.db); return { ok: true }; }),
);

catalog.post("/trims/move", zValidator("json", z.object({ trimIds: z.array(id).min(1), targetModelId: id })), async (c) => {
  const { trimIds, targetModelId } = c.req.valid("json");
  return run(c, () => c.var.db.transaction((tx) => moveTrims(trimIds, targetModelId, tx)));
});

catalog.get("/models/:id/trim-colors", zValidator("param", z.object({ id })), async (c) => c.json(await listTrimColorsByModel(c.req.valid("param").id, c.var.db)));
catalog.get("/models/:id/option-summary", zValidator("param", z.object({ id })), async (c) => c.json(await listModelOptionSummary(c.req.valid("param").id, c.var.db)));

catalog.get("/trims", zValidator("query", z.object({ modelId: id })), async (c) => {
  const trims = await listTrimsByModel(c.req.valid("query").modelId, c.var.db);
  return c.json(trims.map((t) => ({ ...t, price: Number(t.price) })));
});

catalog.post("/trims", zValidator("json", /* 동일 */), async (c) => run(c, () => createTrim(c.req.valid("json"), c.var.db)));
catalog.patch("/trims/:id", /* validators 동일 */, async (c) => run(c, () => updateTrim(c.req.valid("param").id, c.req.valid("json"), c.var.db), "트림을 찾을 수 없습니다."));
catalog.delete("/trims/:id", zValidator("param", z.object({ id })), async (c) => run(c, () => deleteTrim(c.req.valid("param").id, c.var.db), "트림을 찾을 수 없습니다."));

catalog.get("/trims/:id/options", zValidator("param", z.object({ id })), async (c) => {
  const trimId = c.req.valid("param").id;
  const [options, relations] = await Promise.all([listOptionsByTrim(trimId, c.var.db), listOptionRelationsByTrim(trimId, c.var.db)]);
  return c.json({ options, relations });
});
catalog.get("/trims/:id/colors", zValidator("param", z.object({ id })), async (c) => c.json(await listColorsByTrim(c.req.valid("param").id, c.var.db)));

catalog.post("/trims/:id/options", zValidator("param", z.object({ id })), zValidator("json", /* 동일 */), async (c) => run(c, () => createOption({ trimId: c.req.valid("param").id, ...c.req.valid("json") }, c.var.db)));
catalog.patch("/options/:id", /* validators 동일 */, async (c) => run(c, () => updateOption(c.req.valid("param").id, c.req.valid("json"), c.var.db), "옵션을 찾을 수 없습니다."));
catalog.delete("/options/:id", zValidator("param", z.object({ id })), async (c) => run(c, () => deleteOption(c.req.valid("param").id, c.var.db), "옵션을 찾을 수 없습니다."));

catalog.post("/trims/:id/no-option", zValidator("param", z.object({ id })), async (c) => run(c, () => setTrimNoOption(c.req.valid("param").id, c.var.db)));
catalog.delete("/trims/:id/no-option", zValidator("param", z.object({ id })), async (c) => run(c, () => unsetTrimNoOption(c.req.valid("param").id, c.var.db)));
```
> validator 블록(zValidator(...))은 기존과 동일하게 유지하고, query 호출 인자에 `c.var.db`만 추가한다. `Promise.all`로 묶인 `listOptionsByTrim`/`listOptionRelationsByTrim`는 같은 db 인스턴스(같은 postgres pool)를 공유 — 기존 동작과 동일.

- [ ] **Step 5: typecheck**

Run: `bun run typecheck`
Expected: PASS (단, `catalog-admin.test.ts`는 Task 4 전이라 여전히 에러 가능 — 해당 파일만 남았는지 확인)

- [ ] **Step 6: 커밋**

```bash
git add src/middleware/db.ts src/app.ts src/routes/vehicles.ts src/routes/catalog.ts
git commit -m "feat(db): dbMiddleware로 요청당 db 주입 + 라우트 c.var.db 전달"
```

---

### Task 4: 테스트 fixture 정리

**Files:**
- Modify: `src/db/queries/catalog-admin.test.ts`

- [ ] **Step 1: `db` import → `getDefaultDb`**

```ts
import { getDefaultDb } from "../client";
```
(기존 `import { db } from "../client";` 교체)

- [ ] **Step 2: `db.transaction` → `getDefaultDb().transaction`**

27행 부근 `await db.transaction(async (tx) => {` 를 `await getDefaultDb().transaction(async (tx) => {` 로 변경.

```bash
grep -n "db.transaction\|import { db }" src/db/queries/catalog-admin.test.ts
```
Expected after fix: 위 두 패턴 0건.

- [ ] **Step 3: query/route 테스트 전체 통과 확인**

Run: `bun run test:server --env-file=.env.local`
Expected: PASS — 28+ (catalog-admin tx 롤백 포함, 실 master 무변경)

- [ ] **Step 4: 커밋**

```bash
git add src/db/queries/catalog-admin.test.ts
git commit -m "test(db): catalog-admin 테스트를 getDefaultDb()로 전환"
```

---

### Task 5: `wrangler.jsonc` — Hyperdrive binding

**Files:**
- Modify: `wrangler.jsonc`

> **차단점:** 이사님이 인스턴스 생성 후 binding id를 줄 때까지 실제 id는 비워둔다. id 없이 머지해도 fallback으로 동작하지만, binding 키가 잘못된 id면 배포 시 에러가 날 수 있으므로 **실제 id를 받은 뒤 이 Task를 수행**하는 것을 권장.

- [ ] **Step 1: `hyperdrive` 배열 추가**

`wrangler.jsonc`에 `compatibility_flags` 다음으로 추가(`<HYPERDRIVE_ID>`를 이사님이 준 값으로 치환):
```jsonc
  "compatibility_flags": ["nodejs_compat"],
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<HYPERDRIVE_ID>" }],
  "vars": {
```

- [ ] **Step 2: 빌드/타입 영향 없음 확인**

Run: `bun run build`
Expected: PASS (wrangler.jsonc는 런타임 binding 설정 — 빌드 산출물에 영향 없음)

- [ ] **Step 3: 커밋**

```bash
git add wrangler.jsonc
git commit -m "feat(cf): wrangler.jsonc에 HYPERDRIVE binding 추가"
```

---

### Task 6: 전체 검증 + PR

**Files:** (없음)

- [ ] **Step 1: 전체 검증 스위트**

Run:
```bash
bun run typecheck && bun run lint && bun run test:server --env-file=.env.local && bun run build
```
Expected: typecheck 0, lint 0(기존 경고 외 신규 0), server test 28+ PASS, build OK

- [ ] **Step 2: PR 생성**

```bash
git push -u origin feat/hyperdrive-db-context
gh pr create --title "feat: CRM 백엔드 Hyperdrive 도입(요청 컨텍스트 db 주입)" --body "$(cat <<'EOF'
## 요약
- db를 모듈 로드 싱글톤 → 요청 컨텍스트 주입(createDb 팩토리+메모이즈, getDefaultDb fallback)으로 전환
- dbMiddleware가 c.env.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL 해석 → c.var.db
- query 함수 executor 일원화(read 기본값 getDefaultDb), 라우트가 c.var.db 전달
- wrangler.jsonc HYPERDRIVE binding 추가

## 무중단
- binding 부재/로컬/테스트는 process.env.DATABASE_URL fallback으로 동일 동작
- #40 안전망(apiFetch 재시도 + loadError 리셋) 유지

## 검증
- typecheck 0 / lint 0 / test:server 28+ / build OK
- 배포 후 CF 동시 부하 e2e는 Task 7(별도)

스펙: ref/specs/2026-06-18-crm-hyperdrive-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 7: (배포 후, 수동) CF 동시 부하 e2e

**Files:** (없음 — 운영 검증)

> 이사님이 binding id 반영 + 머지 + 재배포(Deployments→Retry 또는 push)한 뒤 수행. **DATABASE_URL/binding 변경 후 재배포 필수**(기존 배포는 옛 값).

- [ ] **Step 1: 유효 토큰 확보**

crm.mrcha.app에서 카카오 로그인 후 브라우저 devtools 또는 supabase 세션에서 access token 확보(오늘 검증과 동일 방식).

- [ ] **Step 2: `/api/catalog/models` 20 동시 호출**

```bash
TOKEN="<access_token>"
BRAND_ID=1   # 실제 존재하는 brandId
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "Authorization: Bearer $TOKEN" \
    "https://crm.mrcha.app/api/catalog/models?brandId=$BRAND_ID" &
done; wait
```
Expected: **20개 모두 200**(비결정적 500 소멸). 하나라도 500이면 binding 배선/origin 연결 점검(스펙 §9).

- [ ] **Step 3: mc-master 첫 로드 육안 확인**

crm.mrcha.app → /mc-master 새로고침 → 6/6 정상(에러 배너 0).

- [ ] **Step 4: 브리프 갱신**

`ref/active-session-brief.md`의 Next에서 Hyperdrive 항목을 완료로 옮기고 검증 결과 1줄 기록. (Codex/팀 공유)

---

## Self-Review 결과

- **스펙 커버리지**: §4.1→Task1, §4.2/4.3→Task3, §4.4/4.5→Task2·3, §4.6→Task5, §5 fallback표→Task1·3 동작, §6 분담→Task5·7, §7 검증→Task6·7, §8 무중단/#40 유지→Task0 전제·PR 본문. 누락 없음.
- **placeholder**: `<HYPERDRIVE_ID>`, `<access_token>`, `BRAND_ID`는 런타임 입력값(이사님 제공/운영). 설계상 미정 항목 아님.
- **타입 일관성**: `Db`/`Executor`(client.ts) → `DbVariables`(middleware/db.ts) → 라우트 `Hono<{ Variables: DbVariables }>` → `c.var.db`. query 함수 시그니처 `(…, executor: Executor = getDefaultDb())` 일관.
- **prepare**: v1 두 경로 모두 false(스펙 파생 결정과 일치).
