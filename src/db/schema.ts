import {
  pgSchema,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  smallint,
  bigint,
  date,
} from "drizzle-orm/pg-core";

// CRM 운영 스키마. drizzle은 catalog + crm만 관리(public=앱 소유, 불가침).
// 외부 FK(catalog.*, public.*)는 Phase B(catalog adopt) 후 별도 추가. 여기선 crm 내부 FK만.
export const crm = pgSchema("crm");

// ── 고객 마스터 (니즈 1:1 인라인) ─────────────────────────────────────────────
export const customers = crm.table("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerCode: text("customer_code").notNull().unique(), // CU-YYMM-####
  appUserId: uuid("app_user_id"), // → public.profiles.id (FK: Phase B)
  name: text("name").notNull(),
  phone: text("phone"),
  residence: text("residence"),
  customerType: text("customer_type"), // 개인 | 개인사업자 | 법인사업자
  customerTypeDetail: text("customer_type_detail"),
  statusGroup: text("status_group"), // 1차
  status: text("status"), // 2차 (앱에서 종속 검증)
  priority: text("priority"),
  chance: text("chance"), // 계약완료→확정 동기화는 앱
  advisorId: uuid("advisor_id"), // → public.profiles.id (FK: Phase B)
  team: text("team"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  source: text("source"),
  sourceConsultationId: uuid("source_consultation_id"), // → public.consultations.id (FK: Phase B)
  receivedAt: timestamp("received_at", { withTimezone: true }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  recontacted: boolean("recontacted").default(false).notNull(),
  aiSummary: text("ai_summary"),
  needModel: text("need_model"),
  needTrim: text("need_trim"),
  needMethod: text("need_method"),
  needTiming: text("need_timing"),
  needColors: text("need_colors"),
  needCompare: text("need_compare"),
  needMemo: text("need_memo"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── 고객 자식 테이블 (1:N) ────────────────────────────────────────────────────
export const customerTasks = crm.table("customer_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  category: text("category"),
  due: text("due"),
  body: text("body"),
  done: boolean("done").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const customerSchedules = crm.table("customer_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  scheduledDate: date("scheduled_date"),
  scheduledTime: text("scheduled_time"),
  type: text("type"),
  memo: text("memo"),
  done: boolean("done").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const customerDocuments = crm.table("customer_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  title: text("title"),
  docType: text("doc_type"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  fileMime: text("file_mime"),
  filePath: text("file_path"),
  sortOrder: integer("sort_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const customerMemos = crm.table("customer_memos", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  body: text("body"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// CRM 상담 이력/타임라인 — app public.consultations 와 별개.
export const consultations = crm.table("consultations", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  channel: text("channel"),
  summary: text("summary"),
  status: text("status"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  advisorId: uuid("advisor_id"), // → public.profiles.id (FK: Phase B)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── 견적 (1건 = 시나리오 1~3 묶음) ────────────────────────────────────────────
export const quotes = crm.table("quotes", {
  id: uuid("id").defaultRandom().primaryKey(),
  quoteCode: text("quote_code").notNull().unique(), // QT-YYMM-####
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  entryMode: text("entry_mode"), // manual | solution | original
  quoteRound: text("quote_round"),
  sourceQuoteRequestId: uuid("source_quote_request_id"), // → public.quote_requests.id (FK: Phase B)
  sourceAiEstimateId: uuid("source_ai_estimate_id"), // → public.ai_estimates.id (FK: Phase B)
  trimId: bigint("trim_id", { mode: "number" }), // → catalog.trims.id (FK: Phase B)
  brandName: text("brand_name"),
  modelName: text("model_name"),
  trimName: text("trim_name"),
  basePrice: numeric("base_price"),
  exteriorColorId: bigint("exterior_color_id", { mode: "number" }), // → catalog.colors.id (FK: Phase B)
  exteriorColorName: text("exterior_color_name"),
  exteriorColorHex: text("exterior_color_hex"),
  interiorColorId: bigint("interior_color_id", { mode: "number" }), // → catalog.colors.id (FK: Phase B)
  interiorColorName: text("interior_color_name"),
  interiorColorHex: text("interior_color_hex"),
  options: jsonb("options"), // [{trim_option_id, name, price}]
  optionTotal: numeric("option_total"),
  discountLines: jsonb("discount_lines"), // [{label, amount, unit}]
  finalDiscount: numeric("final_discount"),
  acquisitionTax: numeric("acquisition_tax"),
  acquisitionTaxMode: text("acquisition_tax_mode"), // normal|hybrid|electric|manual
  bond: numeric("bond"),
  delivery: numeric("delivery"),
  incidental: numeric("incidental"),
  finalVehiclePrice: numeric("final_vehicle_price"),
  acquisitionCost: numeric("acquisition_cost"),
  status: text("status"),
  appStatus: text("app_status"), // draft|queued|sent|viewed
  decisionStatus: text("decision_status"), // none|considering|confirmed|contracting
  stockStatus: text("stock_status"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  note: text("note"),
  primaryScenarioId: uuid("primary_scenario_id"), // → crm.quote_scenarios.id (순환, FK: 시나리오 생성 후 UPDATE/Phase B)
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  fileMime: text("file_mime"),
  filePath: text("file_path"),
  revision: integer("revision").default(0).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const quoteScenarios = crm.table("quote_scenarios", {
  id: uuid("id").defaultRandom().primaryKey(),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  scenarioNo: smallint("scenario_no"),
  isSaved: boolean("is_saved").default(false).notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }),
  purchaseMethod: text("purchase_method"),
  lender: text("lender"),
  termMonths: smallint("term_months"),
  depositMode: text("deposit_mode"),
  depositValue: numeric("deposit_value"),
  downPaymentMode: text("down_payment_mode"),
  downPaymentValue: numeric("down_payment_value"),
  residualMode: text("residual_mode"),
  residualValue: numeric("residual_value"),
  mileageMode: text("mileage_mode"),
  mileageValue: text("mileage_value"),
  carTaxIncluded: boolean("car_tax_included"),
  subsidyApplicable: boolean("subsidy_applicable"),
  subsidyAmount: numeric("subsidy_amount"),
  monthlyPayment: numeric("monthly_payment"),
  totalReturnCost: numeric("total_return_cost"),
  totalTakeoverCost: numeric("total_takeover_cost"),
  dueAtDelivery: numeric("due_at_delivery"),
  interestRate: numeric("interest_rate"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
