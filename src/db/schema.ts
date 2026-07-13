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
  check,
  customType,
  index,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import {
  CHANCE_OPTIONS,
  CUSTOMER_MANAGE_STATUSES,
  SOURCE_OPTIONS,
  DOC_TYPE_OPTIONS,
  TASK_CATEGORY_OPTIONS,
  SCHEDULE_TYPE_OPTIONS,
  PURCHASE_METHOD_OPTIONS,
  CUSTOMER_TYPE_OPTIONS,
  ANNUAL_MILEAGE_OPTIONS,
  DELIVERY_METHOD_OPTIONS,
  PURCHASE_UNSET_SENTINEL,
  customerStatusGroups,
} from "../../client/src/data/customers";
import { EMBEDDING_DIM } from "../lib/gemini-embed";

// CRM 운영 스키마. drizzle은 catalog + crm만 관리(public=앱 소유, 불가침).
// 외부 FK(catalog.*, public.*)는 Phase B(catalog adopt) 후 별도 추가. 여기선 crm 내부 FK만.
export const crm = pgSchema("crm");

// ── 어휘/기술값 CHECK 사전 (코드 SSOT, lookup_values 폐기 후 단일 출처) ──────────
const STATUS_GROUP_OPTIONS = Object.keys(customerStatusGroups);
const STATUS_OPTIONS = [...new Set(Object.values(customerStatusGroups).flat())];
const ENTRY_MODES = ["manual", "solution", "original"];
const APP_STATUSES = ["draft", "queued", "sent"]; // "viewed" 축소(배치 E) — 열람은 advisor_quotes.viewed_at SSOT, writer 0 실측(#166)
const DECISION_STATUSES = ["none", "considering", "confirmed", "contracting"];
const ACQ_TAX_MODES = ["normal", "hybrid", "electric", "manual"];
const EMBEDDING_SOURCE_TYPES = ["memo", "task", "need_memo", "need_customer_note", "need_review_note", "consultation", "quote", "customer_profile", "schedule", "customer_documents", "quote_request"];
const ASSISTANT_ROLES = ["user", "assistant"];

// nullable 컬럼 IN CHECK(기존 null 보존). 값=코드 상수 SSOT에서 sql.join. 종속(그룹-상태)은 앱 검증.
// 값은 sql.raw로 리터럴 inline(마이그에 박제). param(`sql`${v}``)이면 $1 placeholder로 새 나가 깨짐.
function inListCheck(col: AnyPgColumn, values: readonly string[]) {
  const list = sql.join(
    values.map((v) => sql.raw(`'${v.replace(/'/g, "''")}'`)),
    sql`, `,
  );
  return sql`${col} IS NULL OR ${col} IN (${list})`;
}

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
  advisorName: text("advisor_name"), // 담당자 표시명(옵션 A: 텍스트). advisor_id 연결은 Phase B.
  team: text("team"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  source: text("source"),
  sourceConsultationId: uuid("source_consultation_id"), // → public.consultations.id (FK: Phase B)
  receivedAt: timestamp("received_at", { withTimezone: true }),
  // last_activity_at 컬럼은 drop(0017) — 관리 상태는 GREATEST 파생(queries/customers.ts staffActivityAt)이 대체.
  recontacted: boolean("recontacted").default(false).notNull(),
  // 수동 관리 상태(이사님 2026-07-13 ⑦-①): "다음 실활동까지 유효" 스누즈 — manage_status_at >= staffActivityAt
  // 일 때만 유효(만료 = 파생 복귀). 유효성 판정은 저장이 아니라 읽기 계층(클라 manage-status·AI 도구) 책임.
  // 수동 "재문의"도 이 컬럼(재문의 자동 감지용 recontacted boolean은 별개 — 타임스탬프가 없어 스누즈 불가).
  manageStatus: text("manage_status"),
  manageStatusAt: timestamp("manage_status_at", { withTimezone: true }),
  aiSummary: text("ai_summary"),
  // AI 힌트 입력 재료 hash(lib/ai-hint-on-write) — 재료 불변 재생성 skip. embed content_hash 사상 재사용.
  aiSummarySourceHash: text("ai_summary_source_hash"),
  needModel: text("need_model"),
  needTrim: text("need_trim"),
  needMethod: text("need_method"),
  needTiming: text("need_timing"),
  needColors: text("need_colors"),
  needCompare: text("need_compare"),
  needMemo: text("need_memo"),
  needContractTerm: text("need_contract_term"),
  needInitialCost: text("need_initial_cost"),
  needAnnualMileage: text("need_annual_mileage"),
  needDeliveryMethod: text("need_delivery_method"),
  needContractFocus: text("need_contract_focus"),
  needCustomerNote: text("need_customer_note"),
  needReviewNote: text("need_review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("customers_status_group_check", inListCheck(t.statusGroup, STATUS_GROUP_OPTIONS)),
  check("customers_status_check", inListCheck(t.status, STATUS_OPTIONS)),
  check("customers_chance_check", inListCheck(t.chance, CHANCE_OPTIONS)),
  check("customers_source_check", inListCheck(t.source, SOURCE_OPTIONS)),
  check("customers_customer_type_check", inListCheck(t.customerType, CUSTOMER_TYPE_OPTIONS)),
  check("customers_manage_status_check", inListCheck(t.manageStatus, CUSTOMER_MANAGE_STATUSES)),
  check("customers_need_annual_mileage_check", inListCheck(t.needAnnualMileage, [...ANNUAL_MILEAGE_OPTIONS, PURCHASE_UNSET_SENTINEL])),
  check("customers_need_delivery_method_check", inListCheck(t.needDeliveryMethod, [...DELIVERY_METHOD_OPTIONS, PURCHASE_UNSET_SENTINEL])),
]);

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
}, (t) => [
  check("customer_tasks_category_check", inListCheck(t.category, TASK_CATEGORY_OPTIONS)),
  // 목록 관리 상태 파생(staffActivityAt)의 상관 서브쿼리 max(created_at) 패턴용 — 고객 행당 seq scan 방지.
  index("customer_tasks_customer_id_created_at_idx").on(t.customerId, t.createdAt),
]);

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
}, (t) => [
  check("customer_schedules_type_check", inListCheck(t.type, SCHEDULE_TYPE_OPTIONS)),
  index("customer_schedules_customer_id_created_at_idx").on(t.customerId, t.createdAt),
]);

export const customerDocuments = crm.table("customer_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  docType: text("doc_type"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  fileMime: text("file_mime"),
  filePath: text("file_path"),
  // 미리보기용 JPEG 썸네일 객체 경로(이미지에만, 업로드 시 브라우저가 구움). 없으면 미리보기는 원본 폴백.
  thumbPath: text("thumb_path"),
  sortOrder: integer("sort_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("customer_documents_doc_type_check", inListCheck(t.docType, DOC_TYPE_OPTIONS)),
  index("customer_documents_customer_id_created_at_idx").on(t.customerId, t.createdAt),
]);

export const customerMemos = crm.table("customer_memos", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  body: text("body"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("customer_memos_customer_id_created_at_idx").on(t.customerId, t.createdAt)]);

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
  appStatus: text("app_status"), // draft|queued|sent
  decisionStatus: text("decision_status"), // none|considering|confirmed|contracting
  stockStatus: text("stock_status"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  note: text("note"),
  guidance: jsonb("guidance"), // {deliveryComment, stockNotice, expectedDelivery, customerRegion, keyPoints[], recommendReason, services[]} — 앱 노출용 안내, 표시 전용
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
}, (t) => [
  check("quotes_entry_mode_check", inListCheck(t.entryMode, ENTRY_MODES)),
  check("quotes_app_status_check", inListCheck(t.appStatus, APP_STATUSES)),
  check("quotes_decision_status_check", inListCheck(t.decisionStatus, DECISION_STATUSES)),
  check("quotes_acquisition_tax_mode_check", inListCheck(t.acquisitionTaxMode, ACQ_TAX_MODES)),
  // 활동 파생(activity.ts staffActivityAt)의 상관 서브쿼리 max(created_at) 패턴용 — #165 자식 4테이블과
  // 동일 사유(0706 배치 B에서 견적이 활동 집합에 편입되며 추가).
  index("quotes_customer_id_created_at_idx").on(t.customerId, t.createdAt),
]);

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
}, (t) => [check("quote_scenarios_purchase_method_check", inListCheck(t.purchaseMethod, PURCHASE_METHOD_OPTIONS))]);

// ── RAG 임베딩 (업무 AI 채팅) ─────────────────────────────────────────────────
// pgvector EMBEDDING_DIM(3072)차원. gemini-embedding-001 네이티브. 앱 관례(public.*.embedding vector(3072))와 동일.
// toDriver: number[] → '[a,b,c]' 문자열(pgvector 입력 포맷). fromDriver: 그 역.
const vector3072 = customType<{ data: number[]; driverData: string }>({
  dataType() { return `vector(${EMBEDDING_DIM})`; },
  toDriver(value) { return `[${value.join(",")}]`; },
  fromDriver(value) { return JSON.parse(value) as number[]; },
});

// RAG 코퍼스 임베딩 스토어. 청크 1행 = 메모/할일/니즈메모/상담이력 하나.
export const embeddings = crm.table("embeddings", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceType: text("source_type").notNull(), // memo|task|need_memo|need_customer_note|need_review_note|consultation|quote
  sourceId: uuid("source_id").notNull(),      // 원본 행 id (need_*는 customer_id)
  customerId: uuid("customer_id")             // scope 필터·고객 메타 조인
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  content: text("content").notNull(),         // 임베딩한 원문 스냅샷(경량 컨텍스트 포함)
  contentHash: text("content_hash").notNull(),// 변경 없으면 재임베딩 skip
  embedding: vector3072("embedding").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("embeddings_source_uq").on(t.sourceType, t.sourceId),
  check("embeddings_source_type_check", inListCheck(t.sourceType, EMBEDDING_SOURCE_TYPES)),
]);

// 업무 AI 채팅 메시지(직원/관리자별 평면 스트림). 세션/핸드오프 없음(내부 도구). staff_user_id=JWT sub, loose id(FK 보류).
export const assistantMessages = crm.table("assistant_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  staffUserId: uuid("staff_user_id").notNull(),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  sources: jsonb("sources"), // assistant RAG 근거 [{customerId,customerName,sourceType,snippet}], user는 null
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [check("assistant_messages_role_check", inListCheck(t.role, ASSISTANT_ROLES))]);

// 상담사 개인 설정 — 실시간 상담 수신 On/Off(배정 드롭다운 필터·Topbar 토글의 영속 소스).
// staff_user_id=JWT sub(profiles.id), loose id(public FK 보류 관례). CRM 내부용(앱 미소비).
export const staffSettings = crm.table("staff_settings", {
  staffUserId: uuid("staff_user_id").primaryKey(),
  liveReceiving: boolean("live_receiving").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// 앱 상담신청(public.consultations) CRM 전용 숨김 기록. public.consultations는 앱 소유·불가침이라
// CRM은 그 테이블에 절대 DELETE/UPDATE하지 않는다 — "삭제"는 이 dismissal insert로 CRM 뷰에서만 숨긴다.
// consultation_id는 public.consultations.id를 가리키는 loose id(FK 보류 관례, public 불가침이라 FK 자체도 안 건다).
export const consultationDismissals = crm.table("consultation_dismissals", {
  consultationId: uuid("consultation_id").primaryKey(),
  dismissedBy: uuid("dismissed_by"), // → public.profiles.id(숨긴 상담사, 감사용, loose id)
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }).defaultNow().notNull(),
});

// 고객 하드 삭제 감사 기록(2026-07-10). 되돌릴 수 없는 조작이라 최소한 "누가·언제·무엇을"은 남긴다.
// customer_id에 FK를 걸지 않는다 — 참조 대상이 바로 그 삭제된 행이다.
// 스냅샷(jsonb 전체 복원)은 의도적으로 두지 않는다: 복원은 앱 인박스 재승격으로 충분하고,
// 개인정보 파기 요구가 오면 스냅샷 자체가 파기 대상으로 남는다.
export const customerDeletions = crm.table("customer_deletions", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(), // 삭제된 고객의 원 id (FK 없음 — 대상이 사라진다)
  customerCode: text("customer_code").notNull(),
  name: text("name").notNull(),
  appUserId: uuid("app_user_id"), // 앱 연결 고객이었나 (loose id)
  quoteCount: integer("quote_count").notNull().default(0), // 함께 사라진 견적 수(전부 미발송 — 발송분은 409로 막힌다)
  deletedBy: uuid("deleted_by").notNull(), // JWT sub (loose id, public FK 보류 관례)
  deletedAt: timestamp("deleted_at", { withTimezone: true }).defaultNow().notNull(),
});
