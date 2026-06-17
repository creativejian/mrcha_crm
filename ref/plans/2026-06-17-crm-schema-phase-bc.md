# catalog adopt + 거울 폐기 (A2 Phase B/C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) 또는 subagent-driven-development. Steps는 체크박스(`- [ ]`)로 추적.

**Goal:** 차량 read 스택을 master `catalog` 직결로 확정하고(거울 `deleted_at` soft-delete 제거), 거울 sync 코드 일체를 폐기하며, `crm.quotes`에 catalog 외부 FK(SET NULL)를 추가한다.

**Architecture:** master DB는 이미 `DATABASE_URL`로 연결돼 있고 `db`(`src/db/client.ts`)가 catalog를 노출 중이다. 차량 read API(`vehicles.ts`)는 사실상 master를 읽고 있으나 거울 잔재인 `isNull(deletedAt)` 필터 때문에 깨진다(master catalog엔 `deleted_at` 없음 — psql 검증 완료). 따라서 "차량 API 전환"의 실체는 **(1) catalog 정의를 master 기준으로 재정렬 + (2) `deleted_at` 필터 제거**다. 거울 sync(`src/sync/*` + `/api/catalog/sync` + MCMaster 동기화 UI)는 더 이상 의미가 없으므로 폐기한다.

**Tech Stack:** drizzle-orm pg-core, drizzle-kit pull/generate(--custom)/migrate, postgres-js, Hono, React 19, TypeScript 6.0.3, bun, vitest.

**검증된 전제 (2026-06-17, master 직접 psql):**
- public 19테이블(앱 소유, 불가침) · catalog 9테이블 · crm 8테이블(Phase A migrate 성공).
- `catalog.*`에 `deleted_at` 없음 → `... where deleted_at is null`은 `ERROR: column "deleted_at" does not exist`.
- `car_status` enum은 `public.car_status`에 있고 `catalog.trims/models.status`가 cross-schema 참조. **위치 유지**(앱 소관) — CRM read는 `status`를 `text`로 모델링.
- trims status 분포 판매중 1651 / 단종 13 / 출시예정 5 → 거울 쿼리가 status를 안 걸렀듯 **status 필터 추가 금지**(동작 보존).
- DB role `postgres.*`(superuser) → catalog FK `ADD CONSTRAINT`에 REFERENCES 권한 자동.

**결정 (앱팀 회신 반영):**
- 외부 FK = **옵션 2**. catalog FK(`quotes.trim_id→catalog.trims`, `exterior_color_id/interior_color_id→catalog.colors`)만 `ON DELETE SET NULL`로 추가. public FK(`app_user_id`/`advisor_id`/`source_*`)는 loose id 보류.
- **모든 FK는 ON DELETE SET NULL만**(RESTRICT/CASCADE 금지). crm.quotes는 brand/model/trim·색상 이름을 비정규화 저장하므로 링크 소실돼도 견적 보존.
- catalog adopt 범위 = CRM이 읽는 7테이블만. 앱전용 `source_vehicle_map`·`trim_code_history`는 `catalog.ts`에서 제외(YAGNI, CRM 미사용).

---

## 순서 제약 (typecheck 안전)

`src/sync/sync-tables.ts`가 `brandsInCatalog.deletedAt` 등을 참조한다. 따라서 **sync 폐기(Task 2)를 catalog.ts의 `deletedAt` 제거(Task 3)보다 먼저** 해야 한다. Task 3(catalog.ts)·Task 4(쿼리 필터)는 함께 적용해야 typecheck가 통과한다. 최종 순서: 재introspect(읽기) → sync 폐기 → master baseline 전환(catalog.ts+쿼리 동시) → catalog FK → 정리/검증.

---

## File Structure

- **Read-only 산출**: `drizzle/_catalog_introspect/` — `db:pull:catalog` baseline(검토용, 커밋 제외 가능).
- **삭제**: `src/sync/` 전체(master-client.ts, sync.ts, sync-tables.ts, sync-diff.ts, sync-diff.test.ts).
- **수정**: `src/db/catalog.ts`(7테이블, deleted_at 제거, status→text) · `src/db/queries/vehicles.ts`(필터 제거) · `src/db/queries/catalog-counts.ts`(필터 제거) · `src/routes/catalog.ts`(/sync 제거) · `package.json`(sync 스크립트 제거) · `client/src/lib/catalog.ts`(runCatalogSync 제거) · `client/src/lib/catalog.test.ts` · `client/src/pages/MCMasterPage.tsx`(동기화 UI 제거) · `client/src/pages/MCMasterPage.test.tsx` · `client/src/index.css`(.catalog-sync-* 제거) · `.env.example`(MRCHA_MASTER_* 제거).
- **생성**: `drizzle/0001_crm_catalog_fk.sql` — 수기 catalog FK 마이그레이션.
- **로컬 정리(코드 아님)**: `.env.local`의 MRCHA_MASTER_* · `ref/db_import/` 덤프.

---

## Task 1: catalog 재introspect (master baseline, read-only)

**Files:** 산출 `drizzle/_catalog_introspect/` (검토용)

- [ ] **Step 1: pull 실행**

Run: `bun run db:pull:catalog`
Expected: `drizzle/_catalog_introspect/schema.ts` 생성. master catalog 기준 → **`deleted_at` 없음**, catalog 9테이블(앱전용 2 포함), `trims/models.status`가 `public.car_status` enum 참조 형태.

- [ ] **Step 2: 산출물 확인 (코드 반영 X, 눈으로 drift 점검)**

Read `drizzle/_catalog_introspect/schema.ts`. 확인:
- 7개 CRM 테이블(brands/models/trims/trim_options/trim_option_relations/trim_no_options/colors) 컬럼이 현 `src/db/catalog.ts`와 동일(단 `deletedAt` 없음).
- 예기치 못한 컬럼 추가/삭제가 있으면 Task 3 catalog.ts에 반영.

> 이 산출물은 baseline 참고용. `src/db/catalog.ts`는 Task 3에서 수기 정렬한다. `_catalog_introspect/`는 커밋하지 않아도 된다(필요 시 `.gitignore`).

---

## Task 2: 거울 sync 폐기 (Phase C 코어)

**Files:**
- Delete: `src/sync/` 전체
- Modify: `package.json`, `src/routes/catalog.ts`, `client/src/lib/catalog.ts`, `client/src/lib/catalog.test.ts`, `client/src/pages/MCMasterPage.tsx`, `client/src/pages/MCMasterPage.test.tsx`, `client/src/index.css`, `.env.example`

- [ ] **Step 1: sync 디렉터리 삭제**

Run: `git rm -r src/sync`
(삭제: master-client.ts, sync.ts, sync-tables.ts, sync-diff.ts, sync-diff.test.ts)

- [ ] **Step 2: `package.json` — sync 스크립트 제거**

`"db:pull:catalog"` 줄 끝의 콤마/다음 줄 `"sync": "bun run src/sync/sync.ts"` 줄을 삭제. (`db:pull:catalog`는 유지 — 향후 catalog 재adopt에 쓴다.)

- [ ] **Step 3: `src/routes/catalog.ts` — /sync 라우트 + runSync 제거, /counts만 유지**

전체를 아래로 교체:

```ts
import { Hono } from "hono";

import { getCatalogCounts } from "../db/queries/catalog-counts";

export const catalog = new Hono();

catalog.get("/counts", async (c) => {
  return c.json(await getCatalogCounts());
});
```

- [ ] **Step 4: `client/src/lib/catalog.ts` — runCatalogSync/SyncResponse 제거**

전체를 아래로 교체:

```ts
export type CatalogCounts = {
  brands: number;
  models: number;
  trims: number;
  trimOptions: number;
  colors: number;
  trimNoOptions: number;
  trimOptionRelations: number;
};

export async function fetchCatalogCounts(): Promise<CatalogCounts> {
  const res = await fetch("/api/catalog/counts");
  if (!res.ok) throw new Error(`catalog counts 실패: ${res.status}`);
  return (await res.json()) as CatalogCounts;
}
```

- [ ] **Step 5: `client/src/lib/catalog.test.ts` — runCatalogSync 테스트 2건 제거**

`import { fetchCatalogCounts, runCatalogSync }` → `import { fetchCatalogCounts }`.
`it("runCatalogSync: 결과 반환", ...)`(현재 29–46) 과 `it("runCatalogSync: 409 → ...", ...)`(현재 48–54) 두 블록 삭제. counts 테스트 2건 유지.

- [ ] **Step 6: `client/src/pages/MCMasterPage.tsx` — 동기화 UI 제거(counts-only)**

전체를 아래로 교체(거울 표현 → master 직접 조회로 문구 수정, sync 버튼/상태/핸들러 제거):

```tsx
import { useEffect, useState } from "react";

import { type CatalogCounts, fetchCatalogCounts } from "@/lib/catalog";

const TABLE_LABELS: [keyof CatalogCounts, string][] = [
  ["brands", "브랜드"],
  ["models", "모델"],
  ["trims", "트림"],
  ["trimOptions", "옵션"],
  ["colors", "색상"],
  ["trimOptionRelations", "옵션 관계"],
  ["trimNoOptions", "옵션 없는 트림"],
];

export function MCMasterPage() {
  const [counts, setCounts] = useState<CatalogCounts | null>(null);
  const [countsError, setCountsError] = useState(false);

  useEffect(() => {
    fetchCatalogCounts()
      .then(setCounts)
      .catch(() => setCountsError(true));
  }, []);

  return (
    <section className="card">
      <div className="panel-head">
        <h2>차선생 차량 데이터 기준</h2>
      </div>
      <div className="panel-body">
        <div className="notice-box">
          <strong>MC코드 기반 차량 마스터 — master Supabase catalog 직접 조회</strong>
          <span>브랜드/모델/트림/옵션/색상은 master catalog를 실시간으로 읽습니다. 데이터 갱신은 앱(master) 쪽에서 관리됩니다.</span>
        </div>

        <div className="mini-grid">
          {TABLE_LABELS.map(([key, label]) => (
            <article className="mini-card catalog-count-card" key={key}>
              <strong>{label}</strong>
              <span>
                {countsError ? (
                  "불러오기 실패"
                ) : counts ? (
                  <>
                    <span className="num">{counts[key].toLocaleString()}</span>건
                  </>
                ) : (
                  "…"
                )}
              </span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
```

> `roleTab` prop이 제거되므로, `MCMasterPage`를 렌더하는 호출처(grep `MCMasterPage`로 확인)에서 `roleTab={...}` prop을 제거해야 한다.

- [ ] **Step 7: `client/src/pages/MCMasterPage.test.tsx` — sync 테스트 제거 + prop 제거**

`fetch` mock에서 `/api/catalog/sync` 분기 제거(counts만 mock). `userEvent` import 제거. 동기화 버튼 테스트 2건(현재 43–55: "최고관리자는 동기화 버튼 노출…", "비최고관리자는 동기화 버튼 숨김")을 삭제. 남는 테스트의 `<MCMasterPage roleTab="최고관리자" />` → `<MCMasterPage />`. 최종:

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MCMasterPage } from "./MCMasterPage";

const COUNTS = {
  brands: 33,
  models: 265,
  trims: 1669,
  trimOptions: 10495,
  colors: 10483,
  trimNoOptions: 57,
  trimOptionRelations: 6236,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(COUNTS), { status: 200 })));
});

afterEach(() => vi.restoreAllMocks());

it("건수 렌더", async () => {
  render(<MCMasterPage />);
  expect(await screen.findByText("1,669")).toBeInTheDocument();
});

it("counts 실패 시 '불러오기 실패'", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
  render(<MCMasterPage />);
  expect((await screen.findAllByText("불러오기 실패")).length).toBeGreaterThan(0);
});
```

- [ ] **Step 8: `client/src/index.css` — .catalog-sync-* 제거(.catalog-count-card 유지)**

삭제: `.catalog-sync-btn` 블록 ~ `@keyframes catalog-sync-spin`(현재 4985–5030), 그리고 `.catalog-sync-result`·`.catalog-sync-result.warn`·`.catalog-sync-result ul`(현재 5043–5061). **유지**: `.catalog-count-card`·`.catalog-count-card strong::after`(5032–5041), `.mini-grid`.

- [ ] **Step 9: `.env.example` — MRCHA_MASTER_* 제거**

`# 차량 거울 sync용 master ...` 주석 + `MRCHA_MASTER_SUPABASE_URL=` + `MRCHA_MASTER_PUBLISHABLE_KEY=` 줄 삭제.

- [ ] **Step 10: typecheck + 클라 단위테스트**

Run: `bun run typecheck`
Expected: 0 errors. (catalog.ts는 아직 deletedAt 보유 → vehicles.ts/catalog-counts.ts와 정합. sync 참조는 전부 제거됨.)

Run: `bun run test:unit client/src/lib/catalog.test.ts client/src/pages/MCMasterPage.test.tsx`
Expected: PASS (counts 테스트만 남음).

- [ ] **Step 11: 커밋**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(catalog): 거울 sync 폐기 — src/sync 삭제 + /sync 라우트·MCMaster 동기화 UI 제거 (A2 Phase C)

master 직결 후 거울 sync는 불필요. /api/catalog/counts(읽기)와 catalog read는 유지.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: master baseline 전환 — catalog.ts + 차량 read 쿼리 (Phase B 코어)

> Task 3 전체(3개 파일)를 한 번에 적용 후 typecheck. catalog.ts에서 `deletedAt`을 빼면 쿼리의 `isNull(deletedAt)`이 즉시 깨지므로 분리 적용 금지.

**Files:**
- Modify: `src/db/catalog.ts`, `src/db/queries/vehicles.ts`, `src/db/queries/catalog-counts.ts`

- [ ] **Step 1: `src/db/catalog.ts` — 7테이블, deleted_at 제거, status→text, carStatusInCatalog 제거**

전체를 아래로 교체:

```ts
// catalog(차량 마스터) schema — master Supabase의 catalog 스키마를 읽기 위한 drizzle 정의.
// READ-ONLY: master(앱)가 소유. CRM은 읽기만 한다. 이 파일은 직접 수정하지 않고,
// master catalog 스키마가 바뀌면 `bun run db:pull:catalog`로 재introspect 후 7테이블을 정렬한다.
// master엔 deleted_at(거울 전용 soft-delete)이 없다 → 필터하지 않는다. status는 public.car_status enum이나
// 읽기 전용이라 text로 모델링한다. 앱전용 source_vehicle_map·trim_code_history는 CRM 미사용이라 제외.
// 상세: ref/specs/2026-06-17-crm-db-connection-migration-design.md

import { pgSchema, index, foreignKey, unique, bigint, text, timestamp, integer, smallint, boolean, jsonb, varchar, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const catalog = pgSchema("catalog");

export const brandsInCatalog = catalog.table("brands", {
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "catalog.brands_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	name: text().notNull(),
	logoUrl: text("logo_url"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`timezone('utc'::text, now())`).notNull(),
	isDomestic: boolean("is_domestic").default(false).notNull(),
	isPopular: boolean("is_popular").default(false).notNull(),
	sortOrder: integer("sort_order").default(999).notNull(),
	brandCode: smallint("brand_code"),
}, (table) => [
	unique("brands_name_key").on(table.name),
	unique("brands_sort_order_unique").on(table.sortOrder),
	unique("brands_brand_code_unique").on(table.brandCode),
]);

export const modelsInCatalog = catalog.table("models", {
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "catalog.models_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	brandId: bigint("brand_id", { mode: "number" }).notNull(),
	name: text().notNull(),
	imageUrl: text("image_url"),
	category: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`timezone('utc'::text, now())`).notNull(),
	sortOrder: integer("sort_order").default(999),
	status: text().default('판매중').notNull(),
	modelCode: smallint("model_code"),
	isShortPattern: boolean("is_short_pattern").default(false).notNull(),
}, (table) => [
	index("idx_models_name").using("btree", table.name.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.brandId],
			foreignColumns: [brandsInCatalog.id],
			name: "models_brand_id_fkey"
		}),
	unique("models_brand_id_model_code_unique").on(table.brandId, table.modelCode),
	unique("models_brand_id_name_key").on(table.brandId, table.name),
	unique("models_brand_id_sort_order_unique").on(table.brandId, table.sortOrder),
]);

export const trimsInCatalog = catalog.table("trims", {
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "catalog.trims_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	modelId: bigint("model_id", { mode: "number" }).notNull(),
	name: text().notNull(),
	price: bigint({ mode: "number" }).notNull(),
	specs: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`timezone('utc'::text, now())`).notNull(),
	modelYear: integer("model_year"),
	displacementCc: integer("displacement_cc"),
	fuelType: text("fuel_type"),
	driveSystem: text("drive_system"),
	transmissionType: text("transmission_type"),
	bodyStyle: text("body_style"),
	seatingCapacity: integer("seating_capacity"),
	canonicalName: text("canonical_name"),
	imageUrl: text("image_url"),
	trimName: text("trim_name"),
	sortOrder: integer("sort_order").default(999),
	status: text().default('판매중').notNull(),
	priceUpdatedAt: timestamp("price_updated_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	financialDiscountAmount: integer("financial_discount_amount"),
	partnerDiscountAmount: integer("partner_discount_amount"),
	cashDiscountAmount: integer("cash_discount_amount"),
	discountUpdatedAt: timestamp("discount_updated_at", { withTimezone: true, mode: 'string' }),
	trimCode: smallint("trim_code"),
	mcCode: varchar("mc_code", { length: 11 }),
}, (table) => [
	index("idx_trims_canonical_name").using("btree", table.canonicalName.asc().nullsLast().op("text_ops")),
	index("idx_trims_fuel_type").using("btree", table.fuelType.asc().nullsLast().op("text_ops")),
	index("idx_trims_model_id").using("btree", table.modelId.asc().nullsLast().op("int8_ops")),
	index("idx_trims_model_year").using("btree", table.modelYear.asc().nullsLast().op("int4_ops")),
	index("idx_trims_trim_name").using("btree", table.trimName.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.modelId],
			foreignColumns: [modelsInCatalog.id],
			name: "trims_model_id_fkey"
		}).onDelete("cascade"),
	unique("trims_model_id_sort_order_unique").on(table.modelId, table.sortOrder),
	unique("trims_model_id_name_key").on(table.modelId, table.name),
	unique("trims_model_id_trim_code_unique").on(table.modelId, table.trimCode),
	unique("trims_mc_code_unique").on(table.mcCode),
]);

export const trimOptionsInCatalog = catalog.table("trim_options", {
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "catalog.trim_options_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	trimId: bigint("trim_id", { mode: "number" }).notNull(),
	type: text().notNull(),
	name: text().notNull(),
	price: bigint({ mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`timezone('utc'::text, now())`).notNull(),
}, (table) => [
	index("idx_trim_options_name").using("btree", table.name.asc().nullsLast().op("text_ops")),
	index("idx_trim_options_price").using("btree", table.price.asc().nullsLast().op("int8_ops")),
	index("trim_options_trim_id_idx").using("btree", table.trimId.asc().nullsLast().op("int8_ops")),
	index("trim_options_trim_id_type_idx").using("btree", table.trimId.asc().nullsLast().op("int8_ops"), table.type.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.trimId],
			foreignColumns: [trimsInCatalog.id],
			name: "trim_options_trim_id_fkey"
		}).onDelete("cascade"),
	check("trim_options_type_check", sql`type = ANY (ARRAY['basic'::text, 'tuning'::text])`),
]);

export const trimOptionRelationsInCatalog = catalog.table("trim_option_relations", {
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "catalog.trim_option_relations_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	optionId: bigint("option_id", { mode: "number" }).notNull(),
	relatedOptionId: bigint("related_option_id", { mode: "number" }).notNull(),
	type: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`timezone('utc'::text, now())`).notNull(),
}, (table) => [
	index("idx_trim_option_relations_type").using("btree", table.type.asc().nullsLast().op("text_ops")),
	index("trim_option_relations_option_id_idx").using("btree", table.optionId.asc().nullsLast().op("int8_ops")),
	index("trim_option_relations_related_option_id_idx").using("btree", table.relatedOptionId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.optionId],
			foreignColumns: [trimOptionsInCatalog.id],
			name: "trim_option_relations_option_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.relatedOptionId],
			foreignColumns: [trimOptionsInCatalog.id],
			name: "trim_option_relations_related_option_id_fkey"
		}).onDelete("cascade"),
	unique("trim_option_relations_unique").on(table.optionId, table.relatedOptionId, table.type),
	check("trim_option_relations_no_self", sql`option_id <> related_option_id`),
	check("trim_option_relations_type_check", sql`type = ANY (ARRAY['includes'::text, 'excludes'::text])`),
]);

export const trimNoOptionsInCatalog = catalog.table("trim_no_options", {
	trimId: bigint("trim_id", { mode: "number" }).primaryKey().notNull(),
	checkedAt: timestamp("checked_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	note: text(),
}, (table) => [
	foreignKey({
			columns: [table.trimId],
			foreignColumns: [trimsInCatalog.id],
			name: "trim_no_options_trim_id_fkey"
		}).onDelete("cascade"),
]);

export const colorsInCatalog = catalog.table("colors", {
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "catalog.colors_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	trimId: bigint("trim_id", { mode: "number" }),
	colorType: text("color_type").notNull(),
	name: text().notNull(),
	code: text(),
	hexValue: text("hex_value"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	sortOrder: smallint("sort_order").default(0).notNull(),
}, (table) => [
	index("idx_colors_trim_id").using("btree", table.trimId.asc().nullsLast().op("int8_ops")),
	index("idx_colors_type").using("btree", table.colorType.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.trimId],
			foreignColumns: [trimsInCatalog.id],
			name: "colors_trim_id_fkey"
		}).onDelete("cascade"),
	unique("colors_trim_id_color_type_name_code_key").on(table.trimId, table.colorType, table.name, table.code),
	check("colors_color_type_check", sql`color_type = ANY (ARRAY['exterior'::text, 'interior'::text])`),
]);
```

- [ ] **Step 2: `src/db/queries/vehicles.ts` — isNull(deletedAt) 필터 전부 제거**

import 줄을 `import { asc, eq, inArray } from "drizzle-orm";`로 교체(`and`, `isNull` 제거). 각 쿼리에서:
- `getBrands`: `.where(isNull(brandsInCatalog.deletedAt))` 줄 삭제(where 없음).
- `getModelsByBrand`: `.where(and(eq(modelsInCatalog.brandId, brandId), isNull(modelsInCatalog.deletedAt)))` → `.where(eq(modelsInCatalog.brandId, brandId))`.
- `getTrimsByModel`: `.where(and(eq(trimsInCatalog.modelId, modelId), isNull(trimsInCatalog.deletedAt)))` → `.where(eq(trimsInCatalog.modelId, modelId))`.
- `getTrimDetail` trim: `.where(and(eq(trimsInCatalog.id, trimId), isNull(trimsInCatalog.deletedAt)))` → `.where(eq(trimsInCatalog.id, trimId))`.
- `getTrimDetail` options: `.where(and(eq(trimOptionsInCatalog.trimId, trimId), isNull(trimOptionsInCatalog.deletedAt)))` → `.where(eq(trimOptionsInCatalog.trimId, trimId))`.
- `getTrimDetail` optionRelations: `.where(and(inArray(trimOptionRelationsInCatalog.optionId, optionIds), isNull(trimOptionRelationsInCatalog.deletedAt)))` → `.where(inArray(trimOptionRelationsInCatalog.optionId, optionIds))`.
- `getTrimDetail` colors: `.where(and(eq(colorsInCatalog.trimId, trimId), isNull(colorsInCatalog.deletedAt)))` → `.where(eq(colorsInCatalog.trimId, trimId))`.
- `getTrimDetail` noOptions: `.where(and(eq(trimNoOptionsInCatalog.trimId, trimId), isNull(trimNoOptionsInCatalog.deletedAt)))` → `.where(eq(trimNoOptionsInCatalog.trimId, trimId))`.

- [ ] **Step 3: `src/db/queries/catalog-counts.ts` — deleted_at 카운트 → 전체 카운트**

import `import { count, isNull } from "drizzle-orm";` → `import { count } from "drizzle-orm";`. `PgColumn` import 제거. `activeCount` 헬퍼를:

```ts
async function tableCount(table: PgTable): Promise<number> {
  const [row] = await db.select({ c: count() }).from(table);
  return row?.c ?? 0;
}
```

로 바꾸고, `getCatalogCounts`의 각 호출을 `await activeCount(brandsInCatalog, brandsInCatalog.deletedAt)` → `await tableCount(brandsInCatalog)` 형태(테이블 인자 1개)로 교체. `import type { PgColumn, PgTable }` → `import type { PgTable }`.

- [ ] **Step 4: typecheck + lint**

Run: `bun run typecheck`
Expected: 0 errors.

Run: `bun run lint`
Expected: 0 problems. (`carStatusInCatalog` 미사용·`and`/`isNull` 미사용 import가 남아있으면 여기서 드러남 → 제거.)

- [ ] **Step 5: master 스모크 (실데이터로 read 동작 증명)**

Run:
```bash
DBURL=$(grep -E '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']$//')
bun -e '
import { getBrands, getTrimsByModel, getTrimDetail } from "./src/db/queries/vehicles.ts";
const brands = await getBrands();
console.log("brands:", brands.length, brands[0]?.name);
const models = (await import("./src/db/queries/vehicles.ts")).getModelsByBrand;
process.exit(0);
'
```
(또는 dev API 기동 후 `curl -s localhost:8788/api/vehicles/brands | head`.)
Expected: brands 30+건, 에러 없음(특히 `deleted_at does not exist` 없음).

- [ ] **Step 6: 커밋**

```bash
git add src/db/catalog.ts src/db/queries/vehicles.ts src/db/queries/catalog-counts.ts
git commit -m "$(cat <<'EOF'
feat(catalog): 차량 read를 master catalog 직결로 전환 — deleted_at 필터 제거 (A2 Phase B)

master catalog엔 거울 전용 deleted_at이 없음(psql 검증). catalog.ts를 master 기준 7테이블로
정렬(status→text, car_status enum은 public 소유라 미모델링), vehicles.ts·catalog-counts.ts의
isNull(deletedAt) 필터 제거. status 필터는 거울 동작과 동일하게 추가하지 않음.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: catalog 외부 FK 마이그레이션 (SET NULL)

**Files:**
- Create: `drizzle/0001_crm_catalog_fk.sql`
- Modify: `drizzle/meta/_journal.json` (drizzle-kit이 자동 갱신)

- [ ] **Step 1: 빈 custom 마이그레이션 생성**

Run: `bunx drizzle-kit generate --custom --name=crm_catalog_fk`
Expected: `drizzle/0001_crm_catalog_fk.sql`(빈 파일) + `_journal.json`에 0001 엔트리 추가. (drizzle.config.ts가 `.env.local`을 로드하지만 generate는 DB 연결 불필요.)

- [ ] **Step 2: FK SQL 작성**

`drizzle/0001_crm_catalog_fk.sql` 내용:

```sql
-- crm.quotes → catalog FK (모두 ON DELETE SET NULL — 앱의 catalog 삭제를 막지 않음).
-- public FK(app_user_id/advisor_id/source_*)는 의도적으로 보류(loose id). schemaFilter=["crm"]라
-- drizzle generate는 이 FK를 산출하지 못하므로 수기 작성. crm.quotes는 brand/model/trim·색상 이름을
-- 비정규화 저장하므로 SET NULL로 링크가 끊겨도 견적 데이터는 보존된다.
ALTER TABLE "crm"."quotes"
  ADD CONSTRAINT "quotes_trim_id_catalog_trims_fk"
  FOREIGN KEY ("trim_id") REFERENCES "catalog"."trims"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "crm"."quotes"
  ADD CONSTRAINT "quotes_exterior_color_id_catalog_colors_fk"
  FOREIGN KEY ("exterior_color_id") REFERENCES "catalog"."colors"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "crm"."quotes"
  ADD CONSTRAINT "quotes_interior_color_id_catalog_colors_fk"
  FOREIGN KEY ("interior_color_id") REFERENCES "catalog"."colors"("id") ON DELETE SET NULL;
```

- [ ] **Step 3: master에 적용**

Run: `bun run db:migrate`
Expected: 0001 적용 성공. (권한 오류 시 — `must be owner of table trims` 등 — 앱팀에 `GRANT REFERENCES ON catalog.trims, catalog.colors TO <role>` 요청. 현재 role=postgres라 가능성 낮음.)

- [ ] **Step 4: 제약 검증 (psql)**

Run:
```bash
DBURL=$(grep -E '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']$//')
psql "$DBURL" -At -c "select conname, confdeltype from pg_constraint where conrelid='crm.quotes'::regclass and contype='f' and conname like 'quotes_%catalog%' order by 1;"
```
Expected: 3행, `confdeltype` 전부 `n`(= ON DELETE SET NULL).

- [ ] **Step 5: 커밋**

```bash
git add drizzle/0001_crm_catalog_fk.sql drizzle/meta/_journal.json
git commit -m "$(cat <<'EOF'
feat(db): crm.quotes → catalog FK 추가 (trim/color, ON DELETE SET NULL, A2 Phase B)

trim_id→catalog.trims, exterior/interior_color_id→catalog.colors. 앱 catalog 삭제를 막지 않도록
SET NULL. public FK(profiles/consultations/quote_requests/ai_estimates)는 loose id로 보류.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 문서 갱신 + 최종 검증

**Files:**
- Modify: `ref/active-session-brief.md`, `AGENTS.md`(DB 현황 줄), `ref/vehicle-mirror-db.md`(폐기 주석)
- 로컬 정리: `.env.local`(MRCHA_MASTER_*), `ref/db_import/`

- [ ] **Step 1: 미사용 export 점검**

Run: `bun run knip`
Expected: sync 삭제로 새로 뜨는 dead export가 없을 것. 뜨면 정리.

- [ ] **Step 2: 전체 검증**

Run: `bun run typecheck` → 0
Run: `bun run lint` → 0
Run: `bun run test:unit` → 클라 단위테스트 전부 PASS
Run: `bun run build` → 성공

> 참고: `src/db/queries/vehicles.test.ts`·`catalog-counts.test.ts`(server `bun test`)는 라이브 DB 필요. `DATABASE_URL` 주입 시 master로 통과해야 함(Task 3 Step 5에서 read 동작은 이미 증명).

- [ ] **Step 3: 로컬 비밀/덤프 정리(코드 아님)**

`.env.local`에서 `MRCHA_MASTER_SUPABASE_URL`/`MRCHA_MASTER_PUBLISHABLE_KEY`/`MRCHA_MASTER_SECRET_KEY` 제거(gitignored, 로컬만). `rm -rf ref/db_import`(거울 import 덤프, gitignored).

- [ ] **Step 4: 문서 갱신**

- `ref/vehicle-mirror-db.md` 상단에 "**폐기됨(2026-06-17, A2 Phase C)** — 거울/sync는 master catalog 직결로 대체. 이 문서는 히스토리 참고용." 주석 추가.
- `AGENTS.md`의 DB 현황(거울/sync 언급) 줄을 "차량은 master `catalog` 직접 read(`db` + `queries/vehicles.ts` + `routes/vehicles.ts`). 거울/sync 폐기 완료. crm.quotes→catalog FK(SET NULL) 적용." 로 갱신.
- `ref/active-session-brief.md`를 Phase B/C 완료 상태로 갱신(60줄 이내): catalog adopt 완료, 거울 폐기 완료, catalog FK 적용, public FK 보류, 다음 = 견적/고객 mock↔crm DB 연결.

- [ ] **Step 5: 최종 커밋**

```bash
git add ref/ AGENTS.md .env.example
git commit -m "$(cat <<'EOF'
docs: A2 Phase B/C 완료 반영 — catalog adopt·거울 폐기·catalog FK (brief/AGENTS/mirror-db)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

- **Spec coverage (A2 design §전환순서):** B-4 catalog adopt = Task 1+3 ✓ / B-5 차량 read 전환 = Task 3(필터 제거; `db`는 이미 master) ✓ / B-6 거울 폐기 = Task 2+5 ✓ / catalog FK(미결→결정) = Task 4 ✓. public FK는 결정에 따라 보류(문서화).
- **순서 안전:** sync(Task 2) → catalog.ts deletedAt 제거(Task 3) 순서로 typecheck 깨짐 방지. catalog.ts+쿼리는 Task 3에서 원자적 적용 ✓.
- **public 불가침:** Task 어디서도 public CREATE/ALTER/DROP 없음. catalog FK는 `crm.quotes`에 ADD CONSTRAINT(crm 소유)만. schemaFilter=["crm"] 유지 ✓.
- **데이터 보존:** catalog FK 전부 SET NULL → 앱 삭제 비차단, 비정규화 이름으로 견적 보존 ✓.
- **Type consistency:** `tableCount(table)`(catalog-counts) 시그니처 변경을 호출처 7곳 모두 반영. `MCMasterPage()` prop 제거를 호출처+테스트 반영. catalog.ts에서 제거한 `carStatusInCatalog`를 import하는 곳 없음(검증됨).

## 미결 (이번 범위 밖)

- public FK(`app_user_id`/`advisor_id`/`source_consultation_id`/`source_quote_request_id`/`source_ai_estimate_id`) — loose id 유지, 필요 시 케이스별 앱팀 협의.
- `quotes.primary_scenario_id → quote_scenarios` 순환 FK(crm 내부) — 여전히 보류.
- catalog.ts status `text` 모델링 — 추후 `public.car_status` enum 참조가 필요해지면 `pgSchema("public").enum(...)`로 승격 검토.
- 견적/고객 mock ↔ crm DB 연결(별도 작업).

## Execution Handoff

prod(master)를 건드리는 단계(Task 3 Step 5 read, Task 4 migrate)가 있으나 모두 비파괴(read/ADD CONSTRAINT SET NULL). 실행 옵션:
1. **Inline (추천)** — 이어서 task별 체크포인트로 실행(executing-plans).
2. **Subagent-Driven** — task별 fresh subagent + 리뷰.
</content>
</invoke>
