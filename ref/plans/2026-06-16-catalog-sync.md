# catalog 거울 동기화 (sync 코어, 1단계) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 로 task-by-task 구현. 스텝은 체크박스(`- [ ]`)로 추적.

**Goal:** master(미스터차 앱 Supabase)의 차량 7테이블을 catalog 거울로 맞추는 full-sync CLI(`bun run sync`)를 만든다.

**Architecture:** 순수 로직(diff/chunk/projection)을 IO에서 분리해 TDD(bun test). master REST fetch(Range 페이징)와 catalog write(drizzle upsert + soft-delete)는 얇은 IO 레이어. 오케스트레이션이 테이블 메타를 FK 순서로 처리. catalog **데이터만** 변경(스키마 불변 → `db:push` 위험과 무관).

**Tech Stack:** TypeScript 6.0.3, drizzle-orm(postgres-js, `prepare:false`), bun 런타임/`bun test`, PostgREST(Range/`Prefer: count=exact`).

**설계 근거:** `ref/specs/2026-06-16-catalog-sync-design.md` (승인됨). full-sync인 이유: master는 hard-delete(`deleted_at` 없음) + `updated_at`은 `trims`에만 → 증분 불가. catalog는 순수 거울(사용자 트리거 0·함수 0, 2026-06-16 실데이터 검증)이라 upsert가 master 값 보존.

**검증된 사실(2026-06-16 실호출):**
- master REST는 **snake_case** 키 반환(예: `logo_url`, `is_domestic`, `brand_code`). drizzle insert는 camelCase prop → **컬럼 매핑 필요**.
- `Content-Range: 0-1/33` 형식 → `/` 뒤가 total. `Prefer: count=exact` + `Range` 헤더로 페이징 + total 동시 획득. 부분 응답은 HTTP 206.
- `trim_no_options`는 `id` 없음 → PK = `trim_id` (total=57 확인).
- catalog 컬럼은 `src/db/catalog.ts` introspect 산출물 기준. 거울 전용 `deleted_at`은 master에 없으므로 화이트리스트에서 제외.

---

## File Structure

- **신규** `src/sync/sync-diff.ts` — 순수 함수: `idsToSoftDelete`, `chunk`, `projectRow`. IO 없음 → 단위테스트.
- **신규** `src/sync/sync-diff.test.ts` — 위 3함수 bun test.
- **신규** `src/sync/sync-tables.ts` — 7테이블 메타(drizzle 테이블 객체 + 컬럼 매핑 + PK 정보). 순수 데이터.
- **신규** `src/sync/master-client.ts` — `fetchMasterTable(meta)`: REST 화이트리스트 fetch + Range 페이징 + total.
- **신규** `src/sync/sync.ts` — 오케스트레이션(fetch → 검증 → upsert → soft-delete) + 요약 출력 + `main()`.
- **수정** `package.json` — `"sync": "bun run src/sync/sync.ts"` 스크립트.

테스트 분리: `bun test`는 `src/**/*.test.ts`를, vitest는 `client/src/**`·`test/**`만 잡으므로 `sync-diff.test.ts`는 `bun test`(=`test:server`)로 돌고 충돌 없음.

---

## Task 1: 순수 로직 `sync-diff.ts` (TDD)

**Files:**
- Create: `src/sync/sync-diff.ts`
- Test: `src/sync/sync-diff.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/sync/sync-diff.test.ts`:

```ts
import { test, expect } from "bun:test";

import { chunk, idsToSoftDelete, projectRow } from "./sync-diff";

test("idsToSoftDelete: master에 없는 catalog 활성 id만 반환", () => {
  expect(idsToSoftDelete(new Set([1, 2]), [1, 2, 3, 4])).toEqual([3, 4]);
});

test("idsToSoftDelete: 전부 master에 있으면 빈 배열", () => {
  expect(idsToSoftDelete(new Set([1, 2, 3]), [1, 2, 3])).toEqual([]);
});

test("idsToSoftDelete: catalog 활성이 비면 빈 배열", () => {
  expect(idsToSoftDelete(new Set([1, 2]), [])).toEqual([]);
});

test("chunk: size 단위로 분할", () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
});

test("chunk: 빈 배열은 빈 결과", () => {
  expect(chunk([], 3)).toEqual([]);
});

test("chunk: size<1이면 에러", () => {
  expect(() => chunk([1], 0)).toThrow();
});

test("projectRow: snake_case row를 화이트리스트 camelCase로 투영", () => {
  const row = { brand_id: 7, name: "X", extra: "drop" };
  expect(
    projectRow(row, [
      { prop: "brandId", col: "brand_id" },
      { prop: "name", col: "name" },
    ]),
  ).toEqual({ brandId: 7, name: "X" });
});

test("projectRow: 없는 컬럼은 undefined로", () => {
  expect(projectRow({}, [{ prop: "note", col: "note" }])).toEqual({ note: undefined });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `DATABASE_URL=x bun test src/sync/sync-diff.test.ts`
Expected: FAIL — "Cannot find module './sync-diff'" (`DATABASE_URL=x`는 다른 서버 테스트가 client.ts를 import해도 무관하게 이 파일만 돌리기 위함; 이 파일 자체는 DB 미사용)

- [ ] **Step 3: 최소 구현**

`src/sync/sync-diff.ts`:

```ts
// catalog 거울 sync의 순수 로직 (IO 없음 → 단위테스트). 설계: ref/specs/2026-06-16-catalog-sync-design.md
// master REST는 snake_case, drizzle insert는 camelCase → projectRow가 화이트리스트 매핑을 담당.

export type SyncColumn = { prop: string; col: string };

/** catalog의 활성(deleted_at IS NULL) id 중 master 응답에 없는 id = soft-delete 대상. */
export function idsToSoftDelete<K>(masterIds: ReadonlySet<K>, catalogActiveIds: readonly K[]): K[] {
  return catalogActiveIds.filter((id) => !masterIds.has(id));
}

/** 배열을 size 단위 청크로 분할 (postgres 다중 VALUES 파라미터 한계 회피용 batch). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error(`chunk size must be >= 1, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** master REST row(snake_case 키)를 drizzle insert용 객체(camelCase prop)로 화이트리스트 투영. */
export function projectRow(
  row: Record<string, unknown>,
  columns: readonly SyncColumn[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { prop, col } of columns) {
    out[prop] = row[col];
  }
  return out;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `DATABASE_URL=x bun test src/sync/sync-diff.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/sync/sync-diff.ts src/sync/sync-diff.test.ts
git commit -m "feat(sync): 순수 diff/chunk/projectRow + 단위테스트 (TDD)"
```

---

## Task 2: 테이블 메타 `sync-tables.ts`

**Files:**
- Create: `src/sync/sync-tables.ts`

catalog.ts의 7테이블 컬럼(deleted_at 제외)을 화이트리스트로 정의. PK는 conflict target·soft-delete WHERE·masterId Set 추출에 쓰인다.

- [ ] **Step 1: 메타 타입 + 7테이블 정의 작성**

`src/sync/sync-tables.ts`:

```ts
// sync 테이블 메타: catalog.ts introspect 컬럼(deleted_at 제외) 화이트리스트 + PK 정보.
// FK 순서로 나열 (upsert는 부모 먼저). 컬럼은 ref/db/catalog.ts 기준.
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import {
  brandsInCatalog,
  colorsInCatalog,
  modelsInCatalog,
  trimNoOptionsInCatalog,
  trimOptionRelationsInCatalog,
  trimOptionsInCatalog,
  trimsInCatalog,
} from "../db/catalog";
import type { SyncColumn } from "./sync-diff";

export type SyncTable = {
  /** master REST 경로 = catalog 테이블명. */
  name: string;
  /** drizzle 테이블 객체 (insert/upsert/update/select 대상). */
  table: PgTable;
  /** 화이트리스트 (PK 포함, deleted_at 제외). */
  columns: SyncColumn[];
  /** PK prop명 (excluded set에서 제외 + 부활 대상). */
  pkProp: string;
  /** PK의 master row 키(snake_case). masterId Set 추출용. */
  pkCol: string;
  /** drizzle PK 컬럼 객체 (conflict target / inArray / select). */
  pkColumn: PgColumn;
  /** drizzle deleted_at 컬럼 객체 (isNull WHERE). */
  deletedAtColumn: PgColumn;
};

export const syncTables: SyncTable[] = [
  {
    name: "brands",
    table: brandsInCatalog,
    columns: [
      { prop: "id", col: "id" },
      { prop: "name", col: "name" },
      { prop: "logoUrl", col: "logo_url" },
      { prop: "createdAt", col: "created_at" },
      { prop: "isDomestic", col: "is_domestic" },
      { prop: "isPopular", col: "is_popular" },
      { prop: "sortOrder", col: "sort_order" },
      { prop: "brandCode", col: "brand_code" },
    ],
    pkProp: "id",
    pkCol: "id",
    pkColumn: brandsInCatalog.id,
    deletedAtColumn: brandsInCatalog.deletedAt,
  },
  {
    name: "models",
    table: modelsInCatalog,
    columns: [
      { prop: "id", col: "id" },
      { prop: "brandId", col: "brand_id" },
      { prop: "name", col: "name" },
      { prop: "imageUrl", col: "image_url" },
      { prop: "category", col: "category" },
      { prop: "createdAt", col: "created_at" },
      { prop: "sortOrder", col: "sort_order" },
      { prop: "status", col: "status" },
      { prop: "modelCode", col: "model_code" },
      { prop: "isShortPattern", col: "is_short_pattern" },
    ],
    pkProp: "id",
    pkCol: "id",
    pkColumn: modelsInCatalog.id,
    deletedAtColumn: modelsInCatalog.deletedAt,
  },
  {
    name: "trims",
    table: trimsInCatalog,
    columns: [
      { prop: "id", col: "id" },
      { prop: "modelId", col: "model_id" },
      { prop: "name", col: "name" },
      { prop: "price", col: "price" },
      { prop: "specs", col: "specs" },
      { prop: "createdAt", col: "created_at" },
      { prop: "modelYear", col: "model_year" },
      { prop: "displacementCc", col: "displacement_cc" },
      { prop: "fuelType", col: "fuel_type" },
      { prop: "driveSystem", col: "drive_system" },
      { prop: "transmissionType", col: "transmission_type" },
      { prop: "bodyStyle", col: "body_style" },
      { prop: "seatingCapacity", col: "seating_capacity" },
      { prop: "canonicalName", col: "canonical_name" },
      { prop: "imageUrl", col: "image_url" },
      { prop: "trimName", col: "trim_name" },
      { prop: "sortOrder", col: "sort_order" },
      { prop: "status", col: "status" },
      { prop: "priceUpdatedAt", col: "price_updated_at" },
      { prop: "updatedAt", col: "updated_at" },
      { prop: "financialDiscountAmount", col: "financial_discount_amount" },
      { prop: "partnerDiscountAmount", col: "partner_discount_amount" },
      { prop: "cashDiscountAmount", col: "cash_discount_amount" },
      { prop: "discountUpdatedAt", col: "discount_updated_at" },
      { prop: "trimCode", col: "trim_code" },
      { prop: "mcCode", col: "mc_code" },
    ],
    pkProp: "id",
    pkCol: "id",
    pkColumn: trimsInCatalog.id,
    deletedAtColumn: trimsInCatalog.deletedAt,
  },
  {
    name: "trim_options",
    table: trimOptionsInCatalog,
    columns: [
      { prop: "id", col: "id" },
      { prop: "trimId", col: "trim_id" },
      { prop: "type", col: "type" },
      { prop: "name", col: "name" },
      { prop: "price", col: "price" },
      { prop: "createdAt", col: "created_at" },
    ],
    pkProp: "id",
    pkCol: "id",
    pkColumn: trimOptionsInCatalog.id,
    deletedAtColumn: trimOptionsInCatalog.deletedAt,
  },
  {
    name: "colors",
    table: colorsInCatalog,
    columns: [
      { prop: "id", col: "id" },
      { prop: "trimId", col: "trim_id" },
      { prop: "colorType", col: "color_type" },
      { prop: "name", col: "name" },
      { prop: "code", col: "code" },
      { prop: "hexValue", col: "hex_value" },
      { prop: "createdAt", col: "created_at" },
      { prop: "sortOrder", col: "sort_order" },
    ],
    pkProp: "id",
    pkCol: "id",
    pkColumn: colorsInCatalog.id,
    deletedAtColumn: colorsInCatalog.deletedAt,
  },
  {
    name: "trim_no_options",
    table: trimNoOptionsInCatalog,
    columns: [
      { prop: "trimId", col: "trim_id" },
      { prop: "checkedAt", col: "checked_at" },
      { prop: "note", col: "note" },
    ],
    pkProp: "trimId",
    pkCol: "trim_id",
    pkColumn: trimNoOptionsInCatalog.trimId,
    deletedAtColumn: trimNoOptionsInCatalog.deletedAt,
  },
  {
    name: "trim_option_relations",
    table: trimOptionRelationsInCatalog,
    columns: [
      { prop: "id", col: "id" },
      { prop: "optionId", col: "option_id" },
      { prop: "relatedOptionId", col: "related_option_id" },
      { prop: "type", col: "type" },
      { prop: "createdAt", col: "created_at" },
    ],
    pkProp: "id",
    pkCol: "id",
    pkColumn: trimOptionRelationsInCatalog.id,
    deletedAtColumn: trimOptionRelationsInCatalog.deletedAt,
  },
];
```

> 순서 주의: `colors`/`trim_no_options`/`trim_option_relations`는 trims/trim_options FK이므로 부모 뒤. soft-delete는 `deleted_at` 마킹이라 FK 무관.

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 0 errors (drizzle 컬럼 객체가 `PgColumn`/`PgTable`에 할당됨)

- [ ] **Step 3: 커밋**

```bash
git add src/sync/sync-tables.ts
git commit -m "feat(sync): catalog 7테이블 화이트리스트 메타"
```

---

## Task 3: master fetch `master-client.ts`

**Files:**
- Create: `src/sync/master-client.ts`

- [ ] **Step 1: fetch + Range 페이징 구현**

`src/sync/master-client.ts`:

```ts
// master(미스터차 앱 Supabase) REST 화이트리스트 fetch + Range 페이징.
// 키: .env.local의 MRCHA_MASTER_*. publishable 키로 차량 테이블 read 가능(검증됨).
import type { SyncTable } from "./sync-tables";

const PAGE_SIZE = 1000;

export type MasterFetchResult = { rows: Record<string, unknown>[]; total: number };

/**
 * meta.columns 화이트리스트로 master 테이블 전체를 Range 페이징하며 가져온다.
 * Content-Range의 `/total`로 전체 행수를 얻고, total까지 페이지 루프.
 */
export async function fetchMasterTable(meta: SyncTable): Promise<MasterFetchResult> {
  const base = process.env.MRCHA_MASTER_SUPABASE_URL;
  const key = process.env.MRCHA_MASTER_PUBLISHABLE_KEY;
  if (!base || !key) {
    throw new Error("MRCHA_MASTER_SUPABASE_URL / MRCHA_MASTER_PUBLISHABLE_KEY 미설정 (.env.local)");
  }

  const select = meta.columns.map((c) => c.col).join(",");
  const url = `${base}/rest/v1/${meta.name}?select=${select}`;
  const rows: Record<string, unknown>[] = [];
  let total = Number.POSITIVE_INFINITY;
  let start = 0;

  while (start < total) {
    const res = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${start}-${start + PAGE_SIZE - 1}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`master fetch ${meta.name} 실패: ${res.status} ${await res.text()}`);
    }
    const parsed = Number(res.headers.get("content-range")?.split("/")[1]);
    if (Number.isFinite(parsed)) total = parsed;
    const page = (await res.json()) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length === 0) break;
    start += page.length;
  }

  return { rows, total: Number.isFinite(total) ? total : rows.length };
}
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 0 errors

- [ ] **Step 3: 실호출 수동 검증 (brands)**

임시 스니펫 실행으로 페이징 동작 확인 (커밋하지 않음):

```bash
set -a; . ./.env.local; set +a
bun -e 'import { fetchMasterTable } from "./src/sync/master-client"; import { syncTables } from "./src/sync/sync-tables"; const b = syncTables.find((t) => t.name === "brands"); const r = await fetchMasterTable(b); console.log("brands rows:", r.rows.length, "total:", r.total, "keys:", Object.keys(r.rows[0]));'
```
Expected: `brands rows: 33 total: 33 keys: [ "id", "name", "logo_url", "is_domestic", "is_popular", "sort_order", "brand_code" ]`

- [ ] **Step 4: 커밋**

```bash
git add src/sync/master-client.ts
git commit -m "feat(sync): master REST 화이트리스트 fetch + Range 페이징"
```

---

## Task 4: 오케스트레이션 `sync.ts`

**Files:**
- Create: `src/sync/sync.ts`

테이블별로 fetch → 검증(`rows.length === total`) → upsert(부활) → soft-delete(검증 통과 시만). drizzle 동적 테이블 처리에 좁은 캐스팅(`as never`)을 쓴다(any 아님 — typescript-eslint recommended에 안 걸림).

- [ ] **Step 1: 구현**

`src/sync/sync.ts`:

```ts
// catalog 거울 full-sync 오케스트레이션 + CLI. `bun run sync`.
// 흐름: fetch → 검증(rows==total) → upsert(deleted_at=NULL 부활) → soft-delete(검증 통과 시만).
// 설계: ref/specs/2026-06-16-catalog-sync-design.md
import { and, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "../db/client";
import { chunk, idsToSoftDelete, projectRow } from "./sync-diff";
import { syncTables, type SyncTable } from "./sync-tables";
import { fetchMasterTable } from "./master-client";

// postgres 다중 VALUES 파라미터 한계(65535) 안전 예산. 청크당 rows*cols <= 이 값.
const INSERT_PARAM_BUDGET = 60_000;
const DELETE_BATCH = 1000;

type TableResult = {
  name: string;
  fetched: number;
  total: number;
  complete: boolean;
  upserted: number;
  softDeleted: number;
};

/** ON CONFLICT DO UPDATE SET: PK 제외 모든 컬럼을 EXCLUDED 값으로, deleted_at은 NULL(부활). */
function excludedSet(meta: SyncTable): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const { prop, col } of meta.columns) {
    if (prop === meta.pkProp) continue;
    set[prop] = sql.raw(`excluded.${col}`);
  }
  set.deletedAt = sql`NULL`;
  return set;
}

async function syncTable(meta: SyncTable): Promise<TableResult> {
  const { rows, total } = await fetchMasterTable(meta);
  const complete = rows.length === total;

  // upsert (부모 먼저는 syncTables 순서가 보장)
  const projected = rows.map((r) => projectRow(r, meta.columns));
  const batchSize = Math.max(1, Math.floor(INSERT_PARAM_BUDGET / meta.columns.length));
  const set = excludedSet(meta);
  for (const batch of chunk(projected, batchSize)) {
    await db
      .insert(meta.table)
      .values(batch as never)
      .onConflictDoUpdate({ target: meta.pkColumn as never, set: set as never });
  }

  // soft-delete: master에 없는 catalog 활성 id. 불완전 fetch면 스킵.
  let softDeleted = 0;
  if (complete) {
    const activeRows = (await db
      .select({ pk: meta.pkColumn })
      .from(meta.table as never)
      .where(isNull(meta.deletedAtColumn))) as { pk: number }[];
    const masterIds = new Set(rows.map((r) => r[meta.pkCol] as number));
    const toDelete = idsToSoftDelete(
      masterIds,
      activeRows.map((r) => r.pk),
    );
    for (const batch of chunk(toDelete, DELETE_BATCH)) {
      await db
        .update(meta.table)
        .set({ deletedAt: sql`now()` } as never)
        .where(and(inArray(meta.pkColumn, batch), isNull(meta.deletedAtColumn)));
      softDeleted += batch.length;
    }
  }

  return { name: meta.name, fetched: rows.length, total, complete, upserted: rows.length, softDeleted };
}

async function main(): Promise<void> {
  console.log("catalog full-sync 시작\n");
  const results: TableResult[] = [];
  for (const meta of syncTables) {
    const r = await syncTable(meta);
    const flag = r.complete ? "OK" : "SKIP(soft-delete)";
    console.log(
      `  ${r.name.padEnd(22)} fetch ${r.fetched}/${r.total} · upsert ${r.upserted} · soft-delete ${r.softDeleted} · 검증 ${flag}`,
    );
    results.push(r);
  }
  const incomplete = results.filter((r) => !r.complete);
  console.log("\ncatalog full-sync 완료.");
  if (incomplete.length) {
    console.warn(`경고: ${incomplete.map((r) => r.name).join(", ")} 불완전 fetch → soft-delete 스킵됨. 재실행 권장.`);
  }
  await db.$client.end();
}

await main();
```

> `db.$client`은 postgres-js 인스턴스 → `.end()`로 연결 종료(CLI가 매달리지 않게). drizzle postgres-js는 `db.$client`로 원 클라이언트 노출.

- [ ] **Step 2: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 errors / 0 problems. (`as never` 캐스팅이 lint에 안 걸리는지 확인; 걸리면 `eslint-disable-next-line ... -- drizzle 동적 테이블 캐스팅` 주석으로 사유 명시.)

- [ ] **Step 3: 커밋**

```bash
git add src/sync/sync.ts
git commit -m "feat(sync): full-sync 오케스트레이션 (fetch→검증→upsert→soft-delete)"
```

---

## Task 5: `package.json` 스크립트 + 실행 검증

**Files:**
- Modify: `package.json`

- [ ] **Step 1: sync 스크립트 추가**

`package.json` scripts에 추가(`db:pull:catalog` 다음 줄):

```json
    "db:pull:catalog": "drizzle-kit pull --config=drizzle.config.catalog.ts",
    "sync": "bun run src/sync/sync.ts"
```

- [ ] **Step 2: 전체 sync 실행 (import 직후라 변경 0 기대)**

```bash
set -a; . ./.env.local; set +a
bun run sync
```
Expected: 7테이블 각 `검증 OK`, **soft-delete 0건**(import 직후 master==catalog), 에러 없음. upsert는 전건 무변경(값 동일). 경고 없음.

> soft-delete가 0이 아니면 master에 실제 삭제분이 있다는 뜻 → 행 확인 후 정상 판단. 불완전 fetch 경고가 뜨면 페이징/네트워크 확인.

- [ ] **Step 3: 멱등성 재확인 (2회차도 동일)**

```bash
set -a; . ./.env.local; set +a
bun run sync
```
Expected: 1회차와 동일 요약, 에러 없음.

- [ ] **Step 4: 회귀 검증**

Run: `bun run test:server`
Expected: 기존 서버 테스트(app/vehicles/queries) + sync-diff 모두 PASS. (catalog 데이터 무변경이라 `getBrands` 33건 등 기존 단언 유지.)

- [ ] **Step 5: 커밋**

```bash
git add package.json
git commit -m "feat(sync): bun run sync 스크립트 + 실행 검증"
```

---

## 완료 처리

- [ ] `ref/active-session-brief.md`에 sync 코어 완료 + `bun run sync` 사용법 1줄 기록.
- [ ] superpowers:finishing-a-development-branch 로 PR 생성(브랜치 `feat/catalog-sync`).

---

## Self-Review (작성자 체크)

- **spec 커버리지:** ①순수 diff=Task1, ②master fetch=Task3, ③테이블 메타+흐름=Task2+4, ④안전(검증 게이트·트리거0)=Task4 `complete` 분기·spec 참조, ⑤실행/테스트=Task5. 모두 매핑됨.
- **placeholder:** 없음. 모든 코드/명령/기대출력 명시.
- **타입 일관성:** `SyncColumn`(sync-diff) → `SyncTable.columns`(sync-tables) → `projectRow`/`fetchMasterTable`/`excludedSet` 일관. `pkCol`(snake, master row 키) vs `pkProp`(camel, excluded 제외) vs `pkColumn`(drizzle 객체) 역할 분리 명확.
- **범위:** 단일 구현 plan으로 적정(UI 버튼/서버 API는 2단계 비범위). 증분 최적화 YAGNI.
- **알려진 리스크:** drizzle 동적 테이블 `as never` 캐스팅 — typecheck/lint로 Task4에서 확정, 걸리면 disable 주석. `db.$client.end()` 미지원 시 `process.exit(0)` 폴백.
