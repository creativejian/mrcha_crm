# crm 스키마 코드 (A2 Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/db/schema.ts`를 `crm` 스키마(고객·견적 8테이블)로 교체하고 drizzle을 `crm`만 관리하도록 전환 — **prod 무관(코드 + 마이그레이션 SQL 생성까지)**.

**Architecture:** 현재 public `customers`/`consultations`(pgTable)를 `pgSchema("crm")` 기반 8테이블로 교체(`crm-customers-schema-design.md` + `crm-quotes-schema-design.md`). 외부 FK(catalog/public)는 Phase B(adopt 후) 보류 — Phase A는 crm 내부 FK만. `schemaFilter:["crm"]`로 전환해 이후 generate/migrate가 public(앱)을 영원히 안 건드리게 함.

**Tech Stack:** drizzle-orm pg-core(pgSchema), drizzle-kit generate, TypeScript 6.0.3, bun.

> ⚠️ Phase A는 **DB를 안 건드림**(generate는 schema 파일 기준 SQL 생성, DB 연결 없음). repoint·migrate·adopt·거울폐기는 Phase B/C 별도 plan. db:push는 이미 제거됨.

---

## File Structure

- **Modify**: `src/db/schema.ts` — public 2테이블 → crm 8테이블 전면 교체.
- **Modify**: `drizzle.config.ts` — `schemaFilter:["public"]` → `["crm"]`.
- **Create(생성물)**: `drizzle/0000_*.sql` — db:generate 산출 마이그레이션(검토용, Phase B에서 적용).

---

## Task 1: schema.ts를 crm 8테이블로 교체

**Files:**
- Modify: `src/db/schema.ts` (전체 교체)

- [ ] **Step 1: schema.ts 전체를 아래로 교체**

```ts
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
```

> 참고: 기존 `consultationNo`/`customerNo` 등 옛 컬럼은 design(`customer_code`/CRM consultations)로 대체되므로 의도적으로 제거. uuid 기본값은 현 코드 관례인 `defaultRandom()`(v4) 유지 — uuidv7 전환은 미결(아래).

- [ ] **Step 2: 다른 파일에서 옛 schema export 참조 확인**

Run: `grep -rn "from.*db/schema\|customerNo\|consultationNo" src/ client/`
Expected: schema를 import해 옛 컬럼(`customerNo`/`consultationNo`)을 쓰는 코드가 있으면 목록화. (현재 public 0 테이블·미연결이라 없을 가능성 높음. 있으면 Task 추가.)

---

## Task 2: drizzle.config.ts를 crm 관리로 전환

**Files:**
- Modify: `drizzle.config.ts`

- [ ] **Step 1: schemaFilter를 crm으로 교체**

`drizzle.config.ts`의 `schemaFilter: ["public"]` 줄과 위 주석을 아래로 교체:

```ts
  // drizzle는 crm + catalog 만 관리. public(앱 소유)은 절대 안 건드림(SET SCHEMA·view 보호).
  // catalog 는 introspect(drizzle.config.catalog.ts)로 adopt. 이 config는 crm DDL 전용.
  schemaFilter: ["crm"],
```

> catalog는 Phase B adopt 후 `["crm","catalog"]`로 넓힐 수 있으나, catalog는 introspect로 받으므로 generate 대상에서 빼는 게 안전. Phase A는 `["crm"]`.

---

## Task 3: 타입 검사

- [ ] **Step 1: typecheck**

Run: `bun run typecheck`
Expected: 0 errors. (schema.ts가 새 export만 가지므로, 옛 export를 쓰던 코드가 있으면 여기서 드러남 → 그 코드도 이 plan에 Task로 추가)

- [ ] **Step 2: lint**

Run: `bun run lint`
Expected: 0 problems.

---

## Task 4: 마이그레이션 SQL 생성 + 검증 (DB 미적용)

- [ ] **Step 1: generate**

Run: `bun run db:generate`
Expected: `drizzle/0000_*.sql` 생성. (drizzle-kit generate는 schema 파일 기준 — DB 연결 없음, prod 무관)

- [ ] **Step 2: 생성 SQL 검증 — crm 스키마만, public 무관 확인**

Run: `cat drizzle/0000_*.sql` (또는 Read)
Expected:
- `CREATE SCHEMA "crm";` 포함
- `CREATE TABLE "crm"."customers" ...` 외 8테이블 전부 crm 스키마
- **`public` 테이블 CREATE/ALTER/DROP 문이 하나도 없을 것** (있으면 schemaFilter 오설정 — 중단하고 재점검)
- crm 내부 FK(customer_id→customers, quote_id→quotes 등)만, catalog/public 외부 FK 없음

---

## Task 5: 커밋

- [ ] **Step 1: commit**

```bash
git add src/db/schema.ts drizzle.config.ts drizzle/
git commit -m "feat(db): crm 스키마 코드 (customers·quotes 8테이블, A2 Phase A)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** customers(+니즈 1:1)·tasks·schedules·documents·memos·consultations(A1) + quotes·quote_scenarios(ⓐ) = 8테이블 전부 task에 포함 ✓. 외부 FK는 design상 Phase B로 명시 분리 ✓.
- **Placeholder scan:** 코드 완전. "Phase B" 표기는 placeholder가 아니라 명시적 범위 분리.
- **Type consistency:** 컬럼명(snake_case)·타입(uuid/text/timestamptz/numeric/jsonb/bigint/smallint/integer/boolean/date)이 design과 일치. FK 참조(자식→customers, scenarios→quotes)는 crm 내부라 Phase A에 포함.

## 미결 (Phase B로)

- 외부 FK 추가: `app_user_id`/`advisor_id`/`source_consultation_id`→public, `trim_id`/`color_id`→catalog, `source_*`→public — catalog adopt 후 수동 마이그레이션(public 테이블 CREATE/DROP 금지 주의).
- `quotes.primary_scenario_id`→`quote_scenarios` 순환 FK(시나리오 생성 후 지정/DEFERRABLE).
- uuid 기본값: 현재 `defaultRandom()`(v4). business-code-system은 uuidv7 권고 — master Postgres 버전 확인 후 `uuidv7()` 전환 검토.
- `UNIQUE(quote_id, scenario_no)` 등 복합 제약: generate 결과 확인 후 필요 시 추가.

## Execution Handoff

이 plan은 **prod 무관**(코드 + SQL 생성). 두 가지 실행 옵션:
1. **Inline (추천)** — prod 무관이고 이어서 바로 검증 가능. executing-plans로 task별 체크포인트.
2. **Subagent-Driven** — task별 fresh subagent + 리뷰.
