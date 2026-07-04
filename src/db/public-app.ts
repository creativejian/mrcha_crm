// public(앱) 스키마 read 전용 drizzle 정의. 앱(master Supabase)이 소유.
// CRM은 앱 견적요청 인박스(S1)에서 read만 한다(복사/sync 금지 — 차량 catalog와 동일 철학).
// crm/catalog와 별도 파일이라 메인 drizzle.config.ts(schema=schema.ts, schemaFilter:["crm"])
// generate에 잡히지 않는다 → 마이그레이션 대상 아님. 구조 변경은 앱팀 소유.
// 주의: profiles.role은 public.user_role enum이나 read 전용이라 text로 모델(catalog status와 동일 방침).

// 주의: drizzle은 pgSchema("public")을 금지한다(throw) — public은 postgres 기본 스키마라
// pgTable()이 곧 public 테이블을 의미한다(검색경로로 public.* 해석). catalog는 비기본 스키마라 pgSchema.
import { bigint, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const quoteRequests = pgTable("quote_requests", {
  id: uuid().primaryKey(),
  userId: uuid("user_id").notNull(),
  trimId: bigint("trim_id", { mode: "number" }),
  paymentMethod: text("payment_method"),
  rentalDeposit: bigint("rental_deposit", { mode: "number" }),
  status: text(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  period: integer(),
  depositType: text("deposit_type"),
  // deposit_ratio는 0~100 정수 퍼센트라 number 캐스팅 정밀도 손실 없음(레포 numeric 기본=string 관례의 의도적 이탈 — 시드 계산이 숫자 소비)
  depositRatio: numeric("deposit_ratio", { mode: "number" }),
  trimPrice: bigint("trim_price", { mode: "number" }),
});

export const quoteRequestOptions = pgTable("quote_request_options", {
  id: bigint({ mode: "number" }).primaryKey(),
  quoteRequestId: uuid("quote_request_id").notNull(),
  trimOptionId: bigint("trim_option_id", { mode: "number" }),
  optionName: text("option_name").notNull(),
  optionType: text("option_type").notNull(),
  priceAtRequest: bigint("price_at_request", { mode: "number" }).notNull(),
});

export const profiles = pgTable("profiles", {
  id: uuid().primaryKey(),
  email: text(),
  username: text(),
  role: text(),
  fullName: text("full_name"),
  phoneNumber: text("phone_number"),
});
