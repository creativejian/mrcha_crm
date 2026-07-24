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
  // 희망 컬러(2026-07-14 앱 추가). mode는 undecided/no_preference/selected/consultation(CHECK, 앱 소유).
  // 컬러 6필드는 selected일 때만 채워진다(RPC 서버 CASE 방어). id는 catalog.colors.id 참조(FK 없음, 스냅샷 name/hex 동봉).
  colorPreferenceMode: text("color_preference_mode"),
  exteriorColorId: bigint("exterior_color_id", { mode: "number" }),
  exteriorColorName: text("exterior_color_name"),
  exteriorColorHex: text("exterior_color_hex"),
  interiorColorId: bigint("interior_color_id", { mode: "number" }),
  interiorColorName: text("interior_color_name"),
  interiorColorHex: text("interior_color_hex"),
  // 출고·추가요청 13필드(2026-07-24 앱 마이그 20260724120000, 계약 = ref/2026-07-24-app-delivery-contract-reply.md).
  // 지역은 either/or — 리스/렌트/미정은 delivery_*(인수 지역), 할부/일시불은 registration_*(등록 지역).
  // 소비 분기는 quote-requests.ts deliveryRegionOf가 SSOT. code는 앱 자체 광역 16코드(행정표준코드 아님),
  // name은 정식명 스냅샷이라 표시는 name을 그대로 쓴다(코드 해석표 불필요).
  deliveryRegionCode: text("delivery_region_code"),
  deliveryRegionName: text("delivery_region_name"),
  // 저장 가능한 값은 'different'|null 둘뿐 — 앱 renderer·fromPayload가 same_as_delivery를 different로 재스탬프한다
  // (CHECK엔 3값이 있으나 현 경로로 도달 불가). 그래서 CRM은 이 값으로 분기하지 않는다.
  registrationRegionMode: text("registration_region_mode"),
  registrationRegionCode: text("registration_region_code"),
  registrationRegionName: text("registration_region_name"),
  // 상대 3종(current/next/within_three)은 referenceMonth(답변 시점 도장)와 한 쌍, specific_month는 targetMonth와 한 쌍.
  // 절대화 텍스트 생성은 deliveryTimingTextOf가 SSOT(승격 시드와 카드 표시가 공유).
  deliveryTimingMode: text("delivery_timing_mode"),
  deliveryTimingReferenceMonth: text("delivery_timing_reference_month"),
  deliveryTargetMonth: text("delivery_target_month"),
  // 배열 2종은 DB가 NOT NULL DEFAULT '{}' — default 표기가 있어야 INSERT에서 생략할 수 있다
  // (파일 헤더의 id/created_at과 같은 "insert 생략용 타입 전용 default", 마이그레이션 대상 아님).
  requestTopicCodes: text("request_topic_codes").array().notNull().default(sql`'{}'::text[]`),
  additionalRequestMode: text("additional_request_mode"),
  additionalRequest: text("additional_request"),
  // 예약 2필드 — 앱 UI 미노출이라 당분간 전 행 null/빈배열. 라벨·표시는 예약 해제 시 함께 붙인다.
  deliveryMethod: text("delivery_method"),
  quotePriorityCodes: text("quote_priority_codes").array().notNull().default(sql`'{}'::text[]`),
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

// ⚠️ read 전용 — CRM은 profiles에 절대 쓰지 않는다(2026-07-10 앱 팀과 합의한 계약).
// 앱이 `REVOKE UPDATE ... FROM anon, authenticated`로 닫았지만 **CRM 서버는 postgres 롤이라 그 REVOKE의
// 대상이 아니다** — DB가 우리를 막아주지 않는다. `profiles-write-guard.test.ts`가 기계로 잠근다.
// 특히 `role`은 custom_access_token_hook이 JWT user_role claim으로 복사하고 그게 CRM의 유일한 인증
// 게이트다(auth/verify.ts) — 위조되면 곧 CRM 관리자 접근이다. phone_verified_* 3종은 앱 Edge Function
// (profile-authentication, admin key) 전용. 쓰기가 필요하면 앱 팀에 서버 경로를 요청한다.
export const profiles = pgTable("profiles", {
  id: uuid().primaryKey(),
  email: text(),
  username: text(), // 앱에서 DROP 검토 중(죽은 컬럼) — 제거되면 이 줄도 함께 삭제
  role: text(),
  fullName: text("full_name"),
  phoneNumber: text("phone_number"),
});

// 앱 콘텐츠 — CRM은 read 전용(admin 참조). 앱 staff가 CRUD·임베딩을 유지한다.
// embedding(vector 3072)·author_id는 CRM 무관이라 미러 제외(read 컬럼만 정의).
export const insights = pgTable("insights", {
  id: uuid().primaryKey(),
  title: text().notNull(),
  summary: text().notNull(),
  content: text().notNull(),
  category: text().notNull(), // 자유 text(UI 5종) — 앱이 enum 아님
  status: text().notNull(), // draft | published
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
  thumbnailUrl: text("thumbnail_url"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }),
});

// 지식베이스 원문 — 청크/임베딩(knowledge_chunks)은 앱 AI 전용이라 미러하지 않는다.
// category는 12장 slug(client/src/data/knowledge-categories.ts 매핑). status는 항상 published.
export const knowledgeArticles = pgTable("knowledge_articles", {
  id: uuid().primaryKey(),
  category: text().notNull(),
  documentTitle: text("document_title").notNull(),
  content: text().notNull(),
  blockNumber: integer("block_number"),
  subNumber: integer("sub_number"),
  status: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }),
});
