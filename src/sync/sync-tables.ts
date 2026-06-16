// sync 테이블 메타: catalog.ts introspect 컬럼(deleted_at 제외) 화이트리스트 + PK 정보.
// FK 순서로 나열 (upsert는 부모 먼저). 컬럼은 src/db/catalog.ts 기준.
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
