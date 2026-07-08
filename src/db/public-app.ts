// public(앱) 스키마 drizzle 정의. 앱(master Supabase)이 소유.
// CRM은 원칙적으로 read만 한다(복사/sync 금지 — 차량 catalog와 동일 철학).
// 예외: advisor_quotes 한 테이블만 write 허용 — 상담사 견적 발송 수신함(이사님 승인 2026-07-05,
// spec: ref/specs/2026-07-05-crm-quote-app-send-design.md). 나머지 테이블은 read 전용 원칙 유지.
// (quote_requests.status의 completed 전이도 발송 파이프라인의 일부로 같은 승인에 포함.)
// crm/catalog와 별도 파일이라 메인 drizzle.config.ts(schema=schema.ts, schemaFilter:["crm"])
// generate에 잡히지 않는다 → 마이그레이션 대상 아님. 구조 변경은 앱팀 소유.
// 주의: profiles.role은 public.user_role enum이나 read 전용이라 text로 모델(catalog status와 동일 방침).

// 주의: drizzle은 pgSchema("public")을 금지한다(throw) — public은 postgres 기본 스키마라
// pgTable()이 곧 public 테이블을 의미한다(검색경로로 public.* 해석). catalog는 비기본 스키마라 pgSchema.
import { sql } from "drizzle-orm";
import { bigint, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

// 상담사 견적 발송 수신함 — public에서 유일하게 CRM이 write하는 테이블(파일 헤더 주석 참조).
// 앱은 이 행(payload jsonb = 앱카드 라벨 완성본)을 읽어 렌더한다. crm_quote_id UNIQUE가 upsert conflict target.
// id/created_at은 DB DEFAULT로 생성(insert 생략용 default 표기 — 마이그레이션 대상 아니라 타입 전용).
// revision은 DB DEFAULT 0이 있지만 발송 시 항상 명시 insert하므로 notNull만 정의.
export const advisorQuotes = pgTable("advisor_quotes", {
  id: uuid().primaryKey().default(sql`uuid_generate_v7()`),
  userId: uuid("user_id").notNull(),
  quoteRequestId: uuid("quote_request_id"),
  crmQuoteId: uuid("crm_quote_id").notNull().unique(),
  quoteCode: text("quote_code").notNull(),
  revision: integer().notNull(),
  vehicleLabel: text("vehicle_label").notNull(),
  monthlyPayment: bigint("monthly_payment", { mode: "number" }),
  payload: jsonb().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true, mode: "string" }),
  viewedAt: timestamp("viewed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .default(sql`timezone('utc', now())`),
});

// 앱 상담신청(폼 문의) — 견적요청과 달리 phoneNumber를 폼에서 직접 받아 NOT NULL(전화번호 항상 확보).
// userId는 nullable(비로그인 상담신청 가능 경로가 스키마상 존재) — 통합(승격/연결)은 userId 있는 행만 대상.
// ⚠️ 물리 테이블명은 "consultations"이지만, export 식별자는 `consultationRequests`로 둔다 — src/db/schema.ts에
// 동명(crm.consultations, "CRM 상담 이력/타임라인")이 이미 있어 같은 파일에서 두 개를 import하면 이름이 충돌한다.
export const consultationRequests = pgTable("consultations", {
  id: uuid().primaryKey(),
  userId: uuid("user_id"),
  customerName: text("customer_name").notNull(),
  phoneNumber: text("phone_number").notNull(),
  carModel: text("car_model"),
  notes: text("notes"),
  status: text(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const profiles = pgTable("profiles", {
  id: uuid().primaryKey(),
  email: text(),
  username: text(),
  role: text(),
  fullName: text("full_name"),
  phoneNumber: text("phone_number"),
});
