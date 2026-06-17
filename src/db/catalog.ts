// catalog(차량 마스터) schema — master Supabase의 catalog 스키마를 읽기 위한 drizzle 정의.
// master(앱)가 소유. CRM은 견적용 읽기(queries/vehicles.ts)와 차량 관리 admin 쓰기(queries/catalog-admin.ts)에서
// 이 테이블 객체를 쓴다. 스키마 정의 자체는 `bun run db:pull:catalog` 재introspect 산출물
// (drizzle/_catalog_introspect/)을 CRM 사용 7테이블로 정리한 정본이라 직접 수정하지 않는다(구조 변경 시 재introspect).
// 주의:
//   - master엔 deleted_at(거울 전용 soft-delete)이 없다 → 컬럼·필터 모두 없음.
//   - status는 public.car_status enum이나 cross-schema라 introspect가 모델링 못 함('failed to parse').
//     CRM은 읽기 전용이라 text로 모델링한다(값은 판매중/단종/출시예정 등 문자열).
//   - 앱전용 source_vehicle_map·trim_code_history는 CRM 미사용이라 제외.
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
