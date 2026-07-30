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
  uniqueIndex,
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
import { CHANGE_REQUEST_KINDS } from "../../client/src/lib/catalog-change-kinds";
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
  // 앱 미연결 고객의 주 번호만(2026-07-17 spec). 앱 연결 고객의 주 번호는 profiles.phone_number
  // 파생(read-through — listCustomers/getCustomer 합성)이라 저장하지 않는다(아래 CHECK가 강제).
  phone: text("phone"),
  // 추가 연락처(상담사 소유·항상 편집 가능) — "다른 번호로 연락달라" 실무 케이스. 매칭에는 쓰지 않는다.
  phoneSecondary: text("phone_secondary"),
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
  // 관심 차량의 catalog 트림 id(2026-07-24). need_model/need_trim은 **표시용 비정규화 스냅샷**이고
  // 이 컬럼이 진짜 링크다 — 앱 견적요청은 원래 trim_id를 갖고 오는데 CRM이 텍스트로만 저장해 버리고
  // 있었고, 수기 입력은 표기가 제각각이었다(실측: 23건 중 catalog 형식이 2건).
  // → 니즈 → 견적 작성 프리필 · 트림명 변경 추종 · id 기반 집계가 여기서 나온다.
  // FK는 drizzle이 cross-schema를 산출하지 못해 수기 마이그레이션(0038)에서 건다(quotes.trim_id 선례).
  needTrimId: bigint("need_trim_id", { mode: "number" }),
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
  // 대표 견적요청(2026-07-24 설계 D1) — 이 요청에서 need_* 7필드를 파생한다. 기본값은 최초 요청이고
  // 상담사가 앱 카드 star로 바꾼다. → public.quote_requests.id (FK 없음 — public은 앱 소유라
  // crm에서 FK를 걸지 않는 레포 관례. app_user_id·source_consultation_id와 같다).
  // NULL = 대표 없음(앱 미연결 고객, 또는 상담신청으로만 연결돼 견적요청이 0건인 앱 고객).
  // ⚠️ 파생 필드 read-only 판정 기준이 app_user_id가 아니라 **이 컬럼**이다(설계 D2) — 요청 0건
  //    고객이 파생 소스도 없이 수기 입력까지 막혀 영원히 못 채우는 상태가 되는 것을 막는다.
  featuredRequestId: uuid("featured_request_id"),
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
  // 앱 유저 1 = CRM 고객 1의 DB 최후 방어선(0713 감사) — link/승격 가드는 autocommit SELECT라 동시
  // 요청 경합(TOCTOU)을 못 막는다. 위반은 23505 → run() dbErrorMessage가 연결 충돌 문구로 매핑.
  uniqueIndex("customers_app_user_id_unique").on(t.appUserId).where(sql`${t.appUserId} IS NOT NULL`),
  // 전화번호 소유권 불변식(2026-07-17 spec): 앱 연결 고객의 주 번호는 profiles 파생 — phone 컬럼과
  // 공존 금지(한 컬럼 두 소유자 차단). 연결(link) 전이는 lib/customer-phone.ts resolvePhoneOnLink.
  check("customers_phone_app_exclusive_check", sql`${t.appUserId} IS NULL OR ${t.phone} IS NULL`),
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
  // CM/AG 수수료 %(계산기 패리티 2026-07-16) — 파트너 calculate 입력(cmFeeRate/agFeeRate 분율의 % 원문).
  cmFeePercent: numeric("cm_fee_percent"),
  agFeePercent: numeric("ag_fee_percent"),
  // 판매사(딜러) — 파트너 calculate 입력 dealerName 원문(판매사 실동작화 T2, 마이그 0033).
  // plain 이름 저장(계산기 `lenderCode::dealerName` 합성과 다름) — 금융사는 lender 컬럼이 이미 보유하고,
  // 워크벤치 딜러 스코프가 카드의 선택 금융사 단일이라 합성이 불필요하다. 수기/비제휴 시나리오는 null.
  dealerName: text("dealer_name"),
  // 솔루션 조회 재현성 스냅샷(스펙 결정 4·5) — 수기 시나리오는 전부 null.
  // 요율이 매월 갱신되는 도메인이라 "어느 워크북 기준 계산인지"를 남긴다. raw는 앱 partner_raw_response 선례.
  solutionLenderCode: text("solution_lender_code"),
  solutionWorkbookVersion: text("solution_workbook_version"),
  solutionCalculatedAt: timestamp("solution_calculated_at", { withTimezone: true }),
  solutionRaw: jsonb("solution_raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [check("quote_scenarios_purchase_method_check", inListCheck(t.purchaseMethod, PURCHASE_METHOD_OPTIONS))]);

// ── RAG 임베딩 (업무 AI 채팅) ─────────────────────────────────────────────────
// pgvector EMBEDDING_DIM(3072)차원. gemini-embedding-2 네이티브(구 001과 차원은 같아 스키마 무변경).
// 앱 관례(public.*.embedding vector(3072))와 동일하지만 **공간은 별개다** — 앱이 아직 001을 쓴다면
// 두 테이블의 벡터를 서로 비교하면 안 된다(001↔2 코사인 0.03 실측). CRM은 crm.embeddings만 읽는다.
// toDriver: number[] → '[a,b,c]' 문자열(pgvector 입력 포맷). fromDriver: 그 역.
const vector3072 = customType<{ data: number[]; driverData: string }>({
  dataType() { return `vector(${EMBEDDING_DIM})`; },
  toDriver(value) { return `[${value.join(",")}]`; },
  fromDriver(value) { return JSON.parse(value) as number[]; },
});

// RAG 코퍼스 임베딩 스토어. 청크 1행 = 코퍼스 소스 하나.
// ⚠️ 모델 컬럼이 없다 — 어느 임베딩 모델이 만든 벡터인지는 `content_hash`에 섞인 모델명 salt로만 안다
// (`embeddingContentHash`). 불변식 검사는 `test-utils/embedding-model-consistency.test.ts`.
export const embeddings = crm.table("embeddings", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceType: text("source_type").notNull(), // 허용값 = CorpusSourceType(lib/assistant-corpus.ts) — 여기 열거하지 않는다(늘 때마다 갈린다)
  sourceId: uuid("source_id").notNull(),      // 원본 행 id (고객 단위 소스는 customer_id — need_*·customer_profile·customer_documents)
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

// 출고 도메인 얇은 테이블(2026-07-20 2단계 spec §3) — 고객당 1행(UNIQUE) upsert.
// CT(계약 상위 식별자)·DV 정식 모델 전까지의 과도기 구조(가역) — 재구매 2회차 출고 이력 미보존(spec S2).
// DV 채번은 계속 미개봉(합의 경계). 닫힌 어휘 없음 → CHECK 0.
export const customerDeliveries = crm.table("customer_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .unique()
    .references(() => customers.id, { onDelete: "cascade" }),
  contractVehicle: text("contract_vehicle"), // 계약 차량 스냅샷(자유 텍스트 — 니즈 '관심 차종'과 구분)
  contractDate: date("contract_date"),
  lender: text("lender"), // 금융사 스냅샷(자유 텍스트 — 솔루션 8사 어휘와 의도적 비결합, spec S4)
  deliveredDate: date("delivered_date"), // 출고 실측일 — 상태 전이와 완전 독립(spec S6, 결합 없음 원칙)
  deliveryMemo: text("delivery_memo"), // 탁송/정비 메모
  // 프리필이 참조한 계약 진행 견적(provenance) — 견적 삭제 시 SET NULL. 파생 표시엔 안 쓴다(스냅샷이 진실).
  sourceQuoteId: uuid("source_quote_id").references(() => quotes.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// 딜러 프로필(2026-07-27) — 딜러 계정 1명당 1행.
// **PK가 dealer_user_id 하나 = "한 딜러 = 한 브랜드"를 스키마가 강제**한다(이사님 요구: 한 브랜드에는
// 여러 딜러가 붙을 수 있으나, 한 딜러는 한 브랜드). 딜러가 낸 할인 제안의 쓰기 범위를 이 브랜드로
// 잠그는 게 유일한 목적이다 — 서버가 trims→models.brand_id를 조회해 이 값과 대조한다(fail-closed).
// brand_id에 FK를 걸지 않는다: NOT NULL이라 ON DELETE SET NULL을 쓸 수 없고, RESTRICT는 catalog(앱
// 공유 스키마) 삭제를 CRM이 가로막는 소유권 침범이다. crm.quotes→catalog FK(0001)는 nullable이라
// 가능했던 선례이므로 여기 적용되지 않는다 — 조회 시 조인 실패 = "브랜드 삭제됨"으로 화면에 알린다.
// note = 비고(딜러사명 "동성모터스"·"코오롱모터스"·"바바리안") — 관리자 입력.
// created_at은 감사(언제 처음 매칭했나) + 테스트 가능성(updated_at > created_at을 DB 안에서 비교 —
// JS Date는 ms 절삭으로 거짓 실패하고 시계 스큐가 클수록 통과해 결함을 가린다, #334·#335)용.
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §3.1
export const dealerProfiles = crm.table("dealer_profiles", {
  dealerUserId: uuid("dealer_user_id").primaryKey(), // → public.profiles.id(loose id 관례)
  brandId: bigint("brand_id", { mode: "number" }).notNull(), // → catalog.brands.id
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// 딜러 할인 제안(2026-07-27) — 딜러가 낸 **제안값**이고 확정값이 아니다.
// 확정 할인은 catalog.trims의 3컬럼이며 **관리자 채택으로만** 바뀐다(spec §2) — 딜러 쓰기는
// role-gate allowlist가 이 테이블로 가는 라우트 하나만 열어서, catalog에는 손이 닿지 않는다.
// 한 트림에 여러 딜러가 각자 제안을 낼 수 있어 (trim_id, dealer_user_id) UNIQUE로 딜러당 1행.
// 3금액이 각각 nullable인 이유: 자사만 내고 제휴·타사는 비울 수 있다(빈 값 = 그 필드는 미제안).
// created_at은 dealerProfiles와 같은 이유(감사 + 스탬프 전진을 DB 안에서 검증).
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §3.2
export const dealerTrimDiscounts = crm.table(
  "dealer_trim_discounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trimId: bigint("trim_id", { mode: "number" }).notNull(), // → catalog.trims.id(loose id)
    dealerUserId: uuid("dealer_user_id").notNull(), // → public.profiles.id(loose id)
    financialAmount: integer("financial_amount"), // 자사할인 제안
    partnerAmount: integer("partner_amount"), // 제휴할인 제안
    cashAmount: integer("cash_amount"), // 타사할인 제안
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("dealer_trim_discounts_trim_dealer_unique").on(table.trimId, table.dealerUserId)],
);

// 확정 할인 채택 감사(2026-07-27, 슬라이스 C) — **필드 단위 1행**이라 "자사는 동성모터스, 제휴는
// 코오롱" 같은 독립 채택이 자연스럽게 표현된다(이사님 요구).
// 채택은 catalog.trims를 갱신하는 관리자 행위이고, 이 표는 "누가·언제·어느 딜러 값을·무엇에서"를
// 남긴다. catalog.trims엔 discount_updated_at만 있어 **누가 바꿨는지가 남지 않는다** — 그 공백을
// 메우는 게 이 테이블의 존재 이유다(딜러 = 외부 인원이고 그 값이 앱 고객에게 보인다).
// source_dealer_user_id = NULL 이면 관리자 직접 입력(TrimEditPanel 경로).
// previous_amount는 되돌리기 근거로만 남긴다(undo는 이번 범위 밖).
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §3.3
export const catalogDiscountAdoptions = crm.table(
  "catalog_discount_adoptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trimId: bigint("trim_id", { mode: "number" }).notNull(), // → catalog.trims.id(loose id)
    field: text("field").notNull(), // 'financial' | 'partner' | 'cash'
    amount: integer("amount"), // 채택된 금액. null = "비움"을 채택
    previousAmount: integer("previous_amount"), // 직전 catalog 값
    sourceDealerUserId: uuid("source_dealer_user_id"), // NULL = 관리자 직접 입력
    adoptedBy: uuid("adopted_by").notNull(), // → public.profiles.id(채택한 관리자)
    adoptedAt: timestamp("adopted_at", { withTimezone: true }).defaultNow().notNull(),
    // 되돌리기(undo, 2026-07-29) — 이 행이 "직전 값 복원"이면 취소한 감사 행을 가리킨다(자기 참조
    // FK — 같은 crm 테이블이라 loose id 관례 대상이 아니다). NULL = 일반 채택/직접 입력.
    // 출처 표시("되돌림")와 일반 관리자 입력을 구분하는 유일한 근거다 — 금액·source로는 못 가른다.
    undoOf: uuid("undo_of").references((): AnyPgColumn => catalogDiscountAdoptions.id),
  },
  (table) => [
    check("catalog_discount_adoptions_field_check", sql`${table.field} in ('financial','partner','cash')`),
  ],
);

// MC 마스터 변경 요청 큐(2026-07-30) — 팀장(manager)의 catalog 쓰기는 여기에만 쌓이고,
// catalog 반영은 admin 승인 replay로만 일어난다. 대기열이자 감사 기록을 겸한다(요청자·
// 승인자·전값 snapshot·반려 사유가 전부 남는다).
// 딜러 할인 제안과 반대로 **대상+작업당 pending 1건**(부분 UNIQUE) — 내부 업무 분담이라
// 같은 대상을 두 명이 고칠 이유가 없다(경쟁 견적이던 딜러와 다르다). kind가 UNIQUE 축에
// 있는 이유: 같은 트림에 "가격 수정"과 "무옵션 확정"은 다른 작업이라 공존해야 한다.
// payload = 원 라우트 zod 검증을 통과한 body 그대로(승인 시 재검증). snapshot = 요청 시점
// 현재 값(update: payload가 건드리는 필드만 · create: 부모 존재 확인의 {} · 드리프트 근거).
// spec: ref/specs/2026-07-30-crm-catalog-change-approval-design.md §4
// 변경 요청 kind 어휘(SSOT) — 아래 CHECK와 라우트 레지스트리(change-request-kinds.ts)의
// ChangeKind 타입이 이 배열 하나에서 파생된다(9번째 kind 추가 시 한 곳만 고친다).
// kind 어휘 SSOT는 클라 순수 lib로 이동(2026-07-30 PR2) — 클라 대기열 라벨과 DB CHECK가
// 같은 배열을 본다. 기존 소비처(레지스트리 등)를 위해 re-export.
// 서버 코드는 계속 schema.ts 경유로 import한다(클라 lib 직접 import는 client 코드 전용 — 경로 혼용 방지).
export { CHANGE_REQUEST_KINDS };
export type { ChangeRequestKind } from "../../client/src/lib/catalog-change-kinds";

export const catalogChangeRequests = crm.table(
  "catalog_change_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    targetType: text("target_type").notNull(),
    targetId: bigint("target_id", { mode: "number" }), // → catalog.*(loose id 관례). create는 NULL
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
    status: text("status").default("pending").notNull(),
    requestedBy: uuid("requested_by").notNull(), // → public.profiles.id(loose id 관례)
    rejectReason: text("reject_reason"),
    decidedBy: uuid("decided_by"), // → public.profiles.id(승인/반려한 관리자, loose id 관례)
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "catalog_change_requests_kind_check",
      sql`${table.kind} in (${sql.raw(CHANGE_REQUEST_KINDS.map((k) => `'${k}'`).join(","))})`,
    ),
    check("catalog_change_requests_target_type_check", sql`${table.targetType} in ('model','trim','option')`),
    check(
      "catalog_change_requests_status_check",
      sql`${table.status} in ('pending','approved','rejected','canceled')`,
    ),
    // kind 접두사와 target_type 정합 — 애플리케이션은 레지스트리가 한 곳에서 파생하지만,
    // psql 수동 insert가 'trim.update'+'model' 같은 불일치 행을 만들 수 있어 DB가 막는다
    // (이 테이블은 승인 워크플로의 유일한 감사 기록이다).
    check(
      "catalog_change_requests_kind_target_type_check",
      sql`(${table.kind} like 'model.%' and ${table.targetType} = 'model') or (${table.kind} like 'trim.%' and ${table.targetType} = 'trim') or (${table.kind} like 'option.%' and ${table.targetType} = 'option')`,
    ),
    uniqueIndex("catalog_change_requests_pending_target_unique")
      .on(table.targetType, table.targetId, table.kind)
      .where(sql`${table.status} = 'pending' and ${table.targetId} is not null`),
  ],
);
