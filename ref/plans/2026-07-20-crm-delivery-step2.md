# 출고 관리 2단계 — customer_deliveries 얇은 테이블 구현 계획 (2026-07-20)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans(inline) 또는 superpowers:subagent-driven-development로 태스크 단위 실행. 체크박스(`- [ ]`)로 진행 추적.

**Goal:** 계약완료 출고 큐에 출고 도메인 실데이터(계약 차량·계약일·금융사·실측일·메모)를 얹고, 견적함 "계약 진행" 마킹을 프리필 소스로 연결한다(소프트 파이프).

**Architecture:** `crm.customer_deliveries` 고객당 1행(UNIQUE) upsert + `listCustomers` 상관 서브쿼리 2개(delivery·contractingQuote) + 출고 콘솔 "출고 정보" 컬럼·폼형 팝오버. 순수 계층(`client/src/lib/delivery-info.ts`)이 시드/제출/요약을 소유.

**Tech Stack:** drizzle(마이그 0036) · Hono(PUT upsert) · React 콘솔 팝오버(useFixedPopoverPosition·useTablePopoverDismiss 재사용) · bun test(실 master)+vitest.

**Spec:** `ref/specs/2026-07-20-crm-delivery-step2-design.md` (S1~S6 확정 결정이 우선)

**⚠️ 경계(불변)**: DV 채번 미개봉 · 정산(ST)/settlement mode 무접촉 · 드로어 무접촉 · `db:push` 금지 · 머지 금지(PR 생성까지만 — 유슨생 지시 2026-07-20).

## ✅ 진행 상태 (2026-07-20 실행 — PR #296)

- [x] Task 0: 브랜치 + spec/plan 커밋 (`db382ea`)
- [x] Task 1: 스키마 + 마이그 0036(**실 DB 적용 완료** — psql \d 확인) (`a6ad782`)
- [x] Task 2: 공유 타입(data/customers.ts) (`0eb7d15`)
- [x] Task 3: listCustomers 서브쿼리 2개 (TDD·RED 실관찰) (`817b9b4`) — ⚠️실행 편차: afterAll이 고객만 지우면 **quotes FK(no action)가 23503** — 견적 먼저 삭제로 수정(plan 초안의 "cascade" 서술 오류·테스트 주석에 박제). 실패 afterAll 잔재는 `check:residue -- --clean`으로 정리(registry 선등록이 정확히 작동)
- [x] Task 4: upsert 쿼리 + PUT 라우트 (TDD·RED 실관찰, 6종) (`d72cd48`)
- [x] Task 5: 클라 API 배선(http PUT·CustomerRow·saveCustomerDelivery) (`7f1ac7f`)
- [x] Task 6: 순수 lib delivery-info.ts (TDD 11·RED 실관찰) (`07344b2`)
- [x] Task 7: 콘솔 UI + 페이지 테스트 5종(RED 6 fail 실관찰→GREEN 77) (`dbe0f9d`)
- [x] Task 8: CSS (`4279602`)
- [x] Task 9: pending 항목 15 등재
- [x] Task 10: 통합 검증 + **PR #296 생성(머지 보류 — 유슨생 지시)** — typecheck 0·lint 0·unit **961**(+16)·server **594**(+10·실 master·잔재 0)·build·knip 7/9 무드리프트
- [x] Task 11: 격리 스택 브라우저 스모크 **전량 통과**(2026-07-20 — API 8799+vite 5174·magiclink admin·사용자 dev 불가침) — ①김민준 QT-2606-0005(제네시스 G80·우리금융캐피탈) contracting 마킹 → 팝오버 **프리필 실증**(계약 차량 "제네시스 G80 26년형 가솔린 터보 2.5 - 2WD"·금융사 "우리금융캐피탈") ②저장 → psql 대조(source_quote_id까지 정확) ③**차량 컬럼 폴백 실증**(Maybach 니즈 → 계약 차량 표시 전환)·셀 요약("우리금융캐피탈"+"출고 7/20") ④수정 왕복(실측일 추가) → **upsert 1행 유지** ⑤byte-exact 원복(deliveries 전체 0행·decision_status NULL·updated_at 원값·'출고' 일정 0·잔재 0). **관찰 2건(앱 버그 아님·기록)**: ⓐ자동화 CDP 클릭이 스냅샷 사이클에 따라 일과성 무효(hit-test 정상·프로그램 클릭 정상·기출하 출고 예정 팝오버 정상·재시도 정상 — 4중 판별로 앱 결함 배제) ⓑ낮은 뷰포트(~577px)에서는 팝오버 하단 저장 버튼으로 스크롤 시 closeOnViewportShift가 팝오버를 닫음 — 출고 예정 팝오버와 동일 확립 행동이나 이 팝오버가 더 길어 발생 확률↑(실사용 리포트 시 재론 후보)

---

### Task 0: 브랜치 + spec/plan 커밋

- [ ] **Step 0.1**: `git checkout -b feat/crm-delivery-step2`
- [ ] **Step 0.2**: `git add ref/specs/2026-07-20-crm-delivery-step2-design.md ref/plans/2026-07-20-crm-delivery-step2.md && git commit -m "docs(crm): 출고 관리 2단계 spec·plan 박제"` (⚠️ skip-ci 토큰 금지 — squash 전파 사고 이력)

### Task 1: 스키마 + 마이그 0036

**Files:** Modify `src/db/schema.ts` (파일 끝 `customerDeletions` 블록 뒤) / Generate `drizzle/0036_*.sql`

- [ ] **Step 1.1**: `customerDeliveries` 테이블 추가

```ts
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
```

- [ ] **Step 1.2**: `bun run db:generate` → 생성된 `drizzle/0036_*.sql`이 **CREATE TABLE + UNIQUE + FK 2개만**인지 눈으로 확인(additive — 타 테이블 접촉 0이어야 함)
- [ ] **Step 1.3**: `bun run db:migrate` (실 master 적용 — `schemaFilter:["crm"]`) 후 `psql "$DATABASE_URL" -c "\\d crm.customer_deliveries"`로 확인
- [ ] **Step 1.4**: `bun run typecheck` → 0
- [ ] **Step 1.5**: `git add -A && git commit -m "feat(crm): 마이그 0036 — crm.customer_deliveries 얇은 테이블(고객당 1행)"`

### Task 2: 공유 타입 (data/customers.ts)

**Files:** Modify `client/src/data/customers.ts`

- [ ] **Step 2.1**: `NextDeliverySchedule`(107행 부근) 아래에 타입 2종 추가

```ts
// 출고 정보(crm.customer_deliveries) — 목록 파생·팝오버 편집 공유 shape(2026-07-20 출고 2단계 spec §3).
export type CustomerDeliveryInfo = {
  contractVehicle: string | null;
  contractDate: string | null; // YYYY-MM-DD
  lender: string | null;
  deliveredDate: string | null; // YYYY-MM-DD
  deliveryMemo: string | null;
  sourceQuoteId: string | null;
};

// 계약 진행(decision_status='contracting') 견적 요약 — 출고 정보 팝오버 프리필 소스(소프트 파이프, spec §4).
export type ContractingQuoteSummary = {
  id: string;
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  lender: string | null; // 대표 시나리오(primary_scenario_id)의 금융사
};
```

- [ ] **Step 2.2**: `Customer` 타입의 `nextDeliverySchedule` 줄 아래에 필드 2개 추가

```ts
  delivery?: CustomerDeliveryInfo | null; // 서버 파생 출고 정보(목록 전용 — delivery mode가 소비)
  contractingQuote?: ContractingQuoteSummary | null; // 출고 정보 프리필 소스(소프트 파이프)
```

- [ ] **Step 2.3**: `bun run typecheck` → 0, commit `"feat(crm): 출고 정보 공유 타입(CustomerDeliveryInfo·ContractingQuoteSummary)"`

### Task 3: listCustomers 서브쿼리 2개 (TDD)

**Files:** Modify `src/test-utils/fixture-codes.ts` · Create `src/db/queries/customer-delivery.test.ts` · Modify `src/db/queries/customers.ts`

- [ ] **Step 3.1**: 픽스처 접두사 registry 선등록(#214 규칙) — `TEST_CUSTOMER_CODE_PREFIXES`에 `"CU-DLVI-",     // db/queries/customer-delivery.test.ts · routes/customers.delivery.test.ts — 출고 정보 2단계` 추가, `TEST_QUOTE_CODE_PREFIXES`에 `"QT-DLVI-",       // db/queries/customer-delivery.test.ts — contracting 프리필 소스 견적` 추가
- [ ] **Step 3.2**: 실패 테스트 작성 — `src/db/queries/customer-delivery.test.ts`

```ts
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { customerDeliveries, customers, quotes, quoteScenarios } from "../schema";
import { listCustomers } from "./customers";

const db = getDefaultDb();
const suffix = () => Math.random().toString(36).slice(2, 8).toUpperCase();

// 고객 삭제 → deliveries/quotes/scenarios는 FK cascade. crm 테이블만 접촉(알림 트리거 4테이블 무관 — notify 가드 불필요).
describe("listCustomers delivery·contractingQuote 파생 (출고 2단계 spec §4.1)", () => {
  const ids: string[] = [];
  afterAll(async () => {
    for (const id of ids.splice(0)) await db.delete(customers).where(eq(customers.id, id));
  });

  async function seedCustomer(): Promise<string> {
    const [row] = await db.insert(customers).values({ customerCode: `CU-DLVI-${suffix()}`, name: "출고정보파생검증" }).returning({ id: customers.id });
    ids.push(row.id);
    return row.id;
  }

  test("customer_deliveries 행이 있으면 delivery로 동봉한다", async () => {
    const cid = await seedCustomer();
    await db.insert(customerDeliveries).values({ customerId: cid, contractVehicle: "BMW 520i", contractDate: "2026-07-15", lender: "iM캐피탈", deliveryMemo: "탁송 조율" });
    const mine = (await listCustomers(db)).find((r) => r.id === cid);
    expect(mine?.delivery).toEqual({ contractVehicle: "BMW 520i", contractDate: "2026-07-15", lender: "iM캐피탈", deliveredDate: null, deliveryMemo: "탁송 조율", sourceQuoteId: null });
  });

  test("delivery 행·contracting 견적이 없으면 둘 다 null", async () => {
    const cid = await seedCustomer();
    const mine = (await listCustomers(db)).find((r) => r.id === cid);
    expect(mine?.delivery).toBeNull();
    expect(mine?.contractingQuote).toBeNull();
  });

  test("contractingQuote = contracting 중 updated_at 최신 1건 + 대표 시나리오 lender (considering 제외)", async () => {
    const cid = await seedCustomer();
    // 구 contracting(2026-07-01) · 신 contracting(2026-07-10, 대표 시나리오 lender=iM캐피탈) · considering 1건.
    await db.insert(quotes).values({ customerId: cid, quoteCode: `QT-DLVI-${suffix()}`, brandName: "제네시스", modelName: "G80", trimName: "가솔린 2.5", decisionStatus: "contracting", updatedAt: new Date("2026-07-01T00:00:00Z") });
    const [newer] = await db.insert(quotes).values({ customerId: cid, quoteCode: `QT-DLVI-${suffix()}`, brandName: "BMW", modelName: "5 Series", trimName: "520i", decisionStatus: "contracting", updatedAt: new Date("2026-07-10T00:00:00Z") }).returning({ id: quotes.id });
    await db.insert(quotes).values({ customerId: cid, quoteCode: `QT-DLVI-${suffix()}`, brandName: "아우디", modelName: "A6", decisionStatus: "considering", updatedAt: new Date("2026-07-15T00:00:00Z") });
    const [scenario] = await db.insert(quoteScenarios).values({ quoteId: newer.id, scenarioNo: 1, lender: "iM캐피탈" }).returning({ id: quoteScenarios.id });
    await db.update(quotes).set({ primaryScenarioId: scenario.id }).where(eq(quotes.id, newer.id));

    const mine = (await listCustomers(db)).find((r) => r.id === cid);
    expect(mine?.contractingQuote).toEqual({ id: newer.id, brandName: "BMW", modelName: "5 Series", trimName: "520i", lender: "iM캐피탈" });
  });

  test("contracting 견적에 대표 시나리오가 없으면 lender만 null", async () => {
    const cid = await seedCustomer();
    const [q] = await db.insert(quotes).values({ customerId: cid, quoteCode: `QT-DLVI-${suffix()}`, brandName: "볼보", modelName: "XC60", decisionStatus: "contracting" }).returning({ id: quotes.id });
    const mine = (await listCustomers(db)).find((r) => r.id === cid);
    expect(mine?.contractingQuote).toEqual({ id: q.id, brandName: "볼보", modelName: "XC60", trimName: null, lender: null });
  });
});
```

- [ ] **Step 3.3**: RED 실관찰 — `bun run test:server src/db/queries/customer-delivery.test.ts` (⚠️ 직접 `bun test` 금지 — 게이트 3규칙). Expected: FAIL (`delivery`/`contractingQuote` 프로퍼티 부재)
- [ ] **Step 3.4**: `src/db/queries/customers.ts` 구현 — import에 `type ContractingQuoteSummary, type CustomerDeliveryInfo` 추가(data/customers), `nextDeliverySchedule` 상수 아래에:

```ts
// 출고 정보(2단계 spec §4.1) — 고객당 1행(UNIQUE)이라 서브쿼리가 곧 그 행. 소비는 delivery mode만이나
// 파생을 mode로 왜곡하지 않는다(nextDeliverySchedule과 동일 원칙). 완전정규화 주의(#154 섀도잉 버그 클래스).
const deliveryInfo = sql<CustomerDeliveryInfo | null>`(
  select json_build_object(
    'contractVehicle', d.contract_vehicle,
    'contractDate', d.contract_date,
    'lender', d.lender,
    'deliveredDate', d.delivered_date,
    'deliveryMemo', d.delivery_memo,
    'sourceQuoteId', d.source_quote_id)
  from crm.customer_deliveries d
  where d.customer_id = crm.customers.id
)`;

// 계약 진행 견적 요약(소프트 파이프 프리필 소스, spec §4.1) — contracting 복수 마킹 엣지는 updated_at
// 최신 1건(id desc 최종 tie-break·결정적). lender는 대표 시나리오(primary_scenario_id) 경유 — 미지정이면 null.
// confirmed/considering은 소스가 아니다(명시 마킹만 신뢰 — spec §0 "받는 쪽 부재" 해소가 이 서브쿼리).
const contractingQuoteSummary = sql<ContractingQuoteSummary | null>`(
  select json_build_object(
    'id', q.id,
    'brandName', q.brand_name,
    'modelName', q.model_name,
    'trimName', q.trim_name,
    'lender', (select s.lender from crm.quote_scenarios s where s.id = q.primary_scenario_id))
  from crm.quotes q
  where q.customer_id = crm.customers.id and q.decision_status = 'contracting'
  order by q.updated_at desc, q.id desc
  limit 1
)`;
```

`CustomerListRow` 타입 확장 + `listCustomers` select 확장:

```ts
export type CustomerListRow = typeof customers.$inferSelect & {
  latestTask: string | null;
  nextDeliverySchedule: NextDeliverySchedule | null;
  delivery: CustomerDeliveryInfo | null;
  contractingQuote: ContractingQuoteSummary | null;
};
```

```ts
    .select({ ...getTableColumns(customers), phone: composedPhone, latestTask: latestTaskBody, lastActivityAt: staffActivityAt, nextDeliverySchedule, delivery: deliveryInfo, contractingQuote: contractingQuoteSummary })
```

- [ ] **Step 3.5**: GREEN — `bun run test:server src/db/queries/customer-delivery.test.ts` 전건 pass + `bun run typecheck` 0
- [ ] **Step 3.6**: commit `"feat(crm): listCustomers delivery·contractingQuote 상관 서브쿼리(soft pipe 소스)"`

### Task 4: upsert 쿼리 + PUT 라우트 (TDD)

**Files:** Create `src/db/queries/customer-delivery.ts` · Modify `src/routes/customers.ts` · Create `src/routes/customers.delivery.test.ts`

- [ ] **Step 4.1**: 실패 테스트 작성 — `src/routes/customers.delivery.test.ts`

```ts
import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { customerDeliveries, customers, quotes } from "../db/schema";

const db = getDefaultDb();
const suffix = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const ids: string[] = [];
afterAll(async () => {
  for (const id of ids.splice(0)) await db.delete(customers).where(eq(customers.id, id));
});

async function seedCustomer(): Promise<string> {
  const [row] = await db.insert(customers).values({ customerCode: `CU-DLVI-${suffix()}`, name: "출고정보파생검증" }).returning({ id: customers.id });
  ids.push(row.id);
  return row.id;
}

async function put(customerId: string, body: unknown, role = "staff"): Promise<Response> {
  const { token, keyResolver, issuer } = await makeTestAuth(role, crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  return app.request(`/api/customers/${customerId}/delivery`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FULL = { contractVehicle: "BMW 520i", contractDate: "2026-07-15", lender: "iM캐피탈", deliveredDate: null, deliveryMemo: "탁송 조율", sourceQuoteId: null };

test("PUT /delivery — 생성 → 갱신 왕복(고객당 1행 upsert) + DB 대조", async () => {
  const cid = await seedCustomer();
  const created = await put(cid, FULL);
  expect(created.status).toBe(200);
  const updated = await put(cid, { ...FULL, deliveredDate: "2026-07-20", deliveryMemo: null });
  expect(updated.status).toBe(200);
  const rows = await db.select().from(customerDeliveries).where(eq(customerDeliveries.customerId, cid));
  expect(rows).toHaveLength(1); // upsert — 2행이 아니라 1행
  expect(rows[0].deliveredDate).toBe("2026-07-20");
  expect(rows[0].deliveryMemo).toBeNull();
  expect(rows[0].contractVehicle).toBe("BMW 520i");
});

test("PUT /delivery — 빈 문자열은 null로 정규화(값 지우기 경로)", async () => {
  const cid = await seedCustomer();
  const res = await put(cid, { ...FULL, contractVehicle: "  ", lender: "" });
  expect(res.status).toBe(200);
  const [row] = await db.select().from(customerDeliveries).where(eq(customerDeliveries.customerId, cid));
  expect(row.contractVehicle).toBeNull();
  expect(row.lender).toBeNull();
});

test("PUT /delivery — 날짜 포맷 위반은 400(로케일 오배치 무경고 해석 차단 — scheduleBody 미러)", async () => {
  const cid = await seedCustomer();
  expect((await put(cid, { ...FULL, contractDate: "07/15/2026" })).status).toBe(400);
  expect((await put(cid, { ...FULL, deliveredDate: "2026-7-5" })).status).toBe(400);
});

test("PUT /delivery — 타 고객 견적을 sourceQuoteId로 보내면 400(provenance 오염 차단)", async () => {
  const cid = await seedCustomer();
  const other = await seedCustomer();
  const [q] = await db.insert(quotes).values({ customerId: other, quoteCode: `QT-DLVI-${suffix()}`, decisionStatus: "contracting" }).returning({ id: quotes.id });
  const res = await put(cid, { ...FULL, sourceQuoteId: q.id });
  expect(res.status).toBe(400);
});

test("PUT /delivery — 본인 견적 sourceQuoteId는 저장된다", async () => {
  const cid = await seedCustomer();
  const [q] = await db.insert(quotes).values({ customerId: cid, quoteCode: `QT-DLVI-${suffix()}`, decisionStatus: "contracting" }).returning({ id: quotes.id });
  const res = await put(cid, { ...FULL, sourceQuoteId: q.id });
  expect(res.status).toBe(200);
  const [row] = await db.select().from(customerDeliveries).where(eq(customerDeliveries.customerId, cid));
  expect(row.sourceQuoteId).toBe(q.id);
});

test("PUT /delivery — 미존재 고객 404 · dealer 403(전역 게이트)", async () => {
  expect((await put(crypto.randomUUID(), FULL)).status).toBe(404);
  const cid = await seedCustomer();
  expect((await put(cid, FULL, "dealer")).status).toBe(403);
});
```

- [ ] **Step 4.2**: RED 실관찰 — `bun run test:server src/routes/customers.delivery.test.ts`. Expected: FAIL(404 라우트 부재 — 200 기대 케이스 전멸)
- [ ] **Step 4.3**: 쿼리 모듈 신설 — `src/db/queries/customer-delivery.ts`

```ts
import { eq } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { customerDeliveries, customers, quotes } from "../schema";
import type { CustomerDeliveryInfo } from "../../../client/src/data/customers";

// 출고 정보 upsert(2단계 spec §4.2) — 고객당 1행(customer_id UNIQUE) 전체 교체.
// sourceQuoteId는 그 고객 소유 견적만 허용(타 고객 견적 id 주입 = provenance 오염 → 400 fail-loud).
// 미존재 quote id도 같은 분기(FK 위반을 400 이전에 잡는다 — 경합은 FK가 최후 방어).
export type UpsertCustomerDeliveryResult =
  | { kind: "saved"; row: typeof customerDeliveries.$inferSelect }
  | { kind: "customer_not_found" }
  | { kind: "quote_mismatch" };

export async function upsertCustomerDelivery(
  customerId: string,
  patch: CustomerDeliveryInfo,
  ex: Executor = getDefaultDb(),
): Promise<UpsertCustomerDeliveryResult> {
  const [customer] = await ex.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId));
  if (!customer) return { kind: "customer_not_found" };
  if (patch.sourceQuoteId) {
    const [q] = await ex.select({ customerId: quotes.customerId }).from(quotes).where(eq(quotes.id, patch.sourceQuoteId));
    if (!q || q.customerId !== customerId) return { kind: "quote_mismatch" };
  }
  const [row] = await ex
    .insert(customerDeliveries)
    .values({ customerId, ...patch })
    .onConflictDoUpdate({ target: customerDeliveries.customerId, set: { ...patch, updatedAt: new Date() } })
    .returning();
  return { kind: "saved", row };
}
```

- [ ] **Step 4.4**: 라우트 추가 — `src/routes/customers.ts` 일정 CRUD 블록(delete `/:id/schedules/:childId`) 바로 아래

import에 `upsertCustomerDelivery` 추가(`../db/queries/customer-delivery`), zod는 `scheduleBody` 근처에:

```ts
// ── 출고 정보 upsert(출고 2단계 spec §4.2) — 팝오버 전체 폼 = 전체 교체(PUT) ──────
// 빈 문자열 → null(값 지우기), 날짜는 포맷 게이트(scheduleBody와 동일 사유 — 로케일 오배치 무경고 해석 400).
// embed/AI 힌트 훅 없음(코퍼스 미편입 — 재료↔트리거 정합, spec §4.2). dealer는 전역 dealerWriteGate가 403.
const deliveryTextField = z.string().nullable().transform((v) => (v && v.trim() ? v.trim() : null));
const deliveryDateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const deliveryBody = z.object({
  contractVehicle: deliveryTextField,
  contractDate: deliveryDateField,
  lender: deliveryTextField,
  deliveredDate: deliveryDateField,
  deliveryMemo: deliveryTextField,
  sourceQuoteId: z.uuid().nullable(),
});

customers.put("/:id/delivery", zValidator("param", idParam), zValidator("json", deliveryBody), async (c) => {
  try {
    const result = await upsertCustomerDelivery(c.req.valid("param").id, c.req.valid("json"), c.var.db);
    if (result.kind === "customer_not_found") return c.json({ error: "고객을 찾을 수 없습니다." }, 404);
    if (result.kind === "quote_mismatch") return c.json({ error: "참조한 견적이 이 고객의 견적이 아닙니다." }, 400);
    return c.json(result.row);
  } catch (e) {
    return errorResponse(c, e);
  }
});
```

- [ ] **Step 4.5**: GREEN — `bun run test:server src/routes/customers.delivery.test.ts` 전건 pass + typecheck 0
- [ ] **Step 4.6**: commit `"feat(crm): PUT /api/customers/:id/delivery upsert — 출고 정보 전체 교체 + sourceQuoteId 소유 검증"`

### Task 5: 클라 API 배선

**Files:** Modify `client/src/lib/http.ts` · `client/src/lib/customers.ts` · `client/src/lib/customer-children.ts` · `client/src/lib/customers.test.ts`(픽스처)

- [ ] **Step 5.1**: `http.ts` — `sendJson`/`sendVoid` 메서드 유니언에 `"PUT"` 추가: `method: "POST" | "PATCH" | "PUT" | "DELETE"` (두 함수 모두)
- [ ] **Step 5.2**: `lib/customers.ts` — import에 `CustomerDeliveryInfo, ContractingQuoteSummary` 추가, `CustomerRow`에 필드 추가:

```ts
  delivery: CustomerDeliveryInfo | null;
  contractingQuote: ContractingQuoteSummary | null;
```

`toCustomer` 반환에 배선(nextDeliverySchedule 줄 아래):

```ts
    delivery: row.delivery ?? null,
    contractingQuote: row.contractingQuote ?? null,
```

- [ ] **Step 5.3**: `lib/customer-children.ts` — 끝에 추가(자식 CRUD 파일 소속 — 페이지 테스트가 이 모듈을 통째 mock하는 기존 관례 재사용):

```ts
// 출고 정보 upsert(PUT — 전체 교체, 출고 2단계 spec §4.2). 드로어는 출고 정보를 안 보여주지만
// 캐시 무효화는 관례대로 동반(무해·미래 편입 대비).
export const saveCustomerDelivery = (cid: string, v: CustomerDeliveryInfo) => done(cid, sendVoid(`/api/customers/${cid}/delivery`, "PUT", v));
```

import에 `import type { CustomerDeliveryInfo } from "@/data/customers";` 추가.

- [ ] **Step 5.4**: `bun run typecheck` — `lib/customers.test.ts` 등 `CustomerRow` 리터럴 픽스처가 필수 필드 누락으로 깨지면 `delivery: null, contractingQuote: null` 추가
- [ ] **Step 5.5**: `bun run test:unit client/src/lib/customers.test.ts` pass, commit `"feat(crm): 클라 출고 정보 배선 — http PUT·CustomerRow 파생 2필드·saveCustomerDelivery"`

### Task 6: 순수 lib delivery-info.ts (TDD)

**Files:** Create `client/src/lib/delivery-info.ts` · `client/src/lib/delivery-info.test.ts`

- [ ] **Step 6.1**: 실패 테스트 작성 — `client/src/lib/delivery-info.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { ContractingQuoteSummary, CustomerDeliveryInfo } from "@/data/customers";
import { deliveryInfoSummary, resolveDeliveryInfoSubmit, seedDeliveryInfoDraft } from "./delivery-info";

const QUOTE: ContractingQuoteSummary = { id: "q-1", brandName: "BMW", modelName: "5 Series", trimName: "520i", lender: "iM캐피탈" };
const SAVED: CustomerDeliveryInfo = { contractVehicle: "수기 차량", contractDate: "2026-07-15", lender: "수기 금융사", deliveredDate: null, deliveryMemo: null, sourceQuoteId: "q-old" };
const EMPTY: CustomerDeliveryInfo = { contractVehicle: null, contractDate: null, lender: null, deliveredDate: null, deliveryMemo: null, sourceQuoteId: null };

describe("seedDeliveryInfoDraft (soft pipe — spec §4)", () => {
  it("저장값 없는 필드만 contracting 견적에서 시드한다(차량 dedupe 라벨·금융사)", () => {
    const draft = seedDeliveryInfoDraft(null, QUOTE);
    expect(draft.contractVehicle).toBe("BMW 5 Series 520i");
    expect(draft.lender).toBe("iM캐피탈");
    expect(draft.sourceQuoteId).toBe("q-1");
  });

  it("저장값이 있으면 프리필하지 않는다(수기 우선) — sourceQuoteId는 기존값 승계", () => {
    const draft = seedDeliveryInfoDraft(SAVED, QUOTE);
    expect(draft.contractVehicle).toBe("수기 차량");
    expect(draft.lender).toBe("수기 금융사");
    expect(draft.sourceQuoteId).toBe("q-old");
  });

  it("일부 필드만 비면 그 필드만 시드하고 sourceQuoteId는 시드 견적으로 갱신", () => {
    const draft = seedDeliveryInfoDraft({ ...SAVED, lender: null }, QUOTE);
    expect(draft.contractVehicle).toBe("수기 차량");
    expect(draft.lender).toBe("iM캐피탈");
    expect(draft.sourceQuoteId).toBe("q-1");
  });

  it("contracting 견적이 없으면 빈 폼(저장값만)", () => {
    const draft = seedDeliveryInfoDraft(null, null);
    expect(draft).toEqual({ contractVehicle: "", contractDate: "", lender: "", deliveredDate: "", deliveryMemo: "", sourceQuoteId: null });
  });

  it("트림이 모델을 포함하면 중복 없이(dedupedModelTrim 재사용)", () => {
    const draft = seedDeliveryInfoDraft(null, { ...QUOTE, modelName: "G80", trimName: "G80 가솔린 2.5", brandName: "제네시스" });
    expect(draft.contractVehicle).toBe("제네시스 G80 가솔린 2.5");
  });
});

describe("resolveDeliveryInfoSubmit", () => {
  const DRAFT = { contractVehicle: " BMW 520i ", contractDate: "2026-07-15", lender: "", deliveredDate: "", deliveryMemo: "  ", sourceQuoteId: "q-1" };

  it("빈 문자열·공백은 null, 텍스트는 trim, 날짜는 정규화해 body로", () => {
    const submit = resolveDeliveryInfoSubmit(DRAFT);
    expect(submit).toEqual({ kind: "save", body: { contractVehicle: "BMW 520i", contractDate: "2026-07-15", lender: null, deliveredDate: null, deliveryMemo: null, sourceQuoteId: "q-1" } });
  });

  it("유연 날짜 입력(2026.7.5)을 ISO로 정규화한다(datetime-text 규약)", () => {
    const submit = resolveDeliveryInfoSubmit({ ...DRAFT, contractDate: "2026.7.5" });
    expect(submit.kind).toBe("save");
    if (submit.kind === "save") expect(submit.body.contractDate).toBe("2026-07-05");
  });

  it("해석 불가 날짜는 invalid(어느 필드인지 사유 명시)", () => {
    expect(resolveDeliveryInfoSubmit({ ...DRAFT, contractDate: "내일" }).kind).toBe("invalid");
    expect(resolveDeliveryInfoSubmit({ ...DRAFT, deliveredDate: "13/45" }).kind).toBe("invalid");
  });
});

describe("deliveryInfoSummary (셀 요약 — spec §5.1)", () => {
  it("계약 줄 = '계약 M/D · 금융사', 실측 줄 = '출고 M/D'", () => {
    expect(deliveryInfoSummary({ ...EMPTY, contractDate: "2026-07-15", lender: "iM캐피탈", deliveredDate: "2026-07-20" }))
      .toEqual({ contractLine: "계약 7/15 · iM캐피탈", deliveredLine: "출고 7/20", fallback: null });
  });

  it("있는 값만 조합한다(금융사만 → 금융사만)", () => {
    expect(deliveryInfoSummary({ ...EMPTY, lender: "iM캐피탈" })?.contractLine).toBe("iM캐피탈");
  });

  it("전부 비면 null(셀은 + 미입력), 줄 없는 필드만 있으면 fallback '입력됨'", () => {
    expect(deliveryInfoSummary(EMPTY)).toBeNull();
    expect(deliveryInfoSummary(null)).toBeNull();
    expect(deliveryInfoSummary({ ...EMPTY, deliveryMemo: "탁송 조율" })).toEqual({ contractLine: null, deliveredLine: null, fallback: "입력됨" });
  });
});
```

- [ ] **Step 6.2**: RED 실관찰 — `bun run test:unit client/src/lib/delivery-info.test.ts`. Expected: FAIL(모듈 부재)
- [ ] **Step 6.3**: 구현 — `client/src/lib/delivery-info.ts`

```ts
import type { ContractingQuoteSummary, CustomerDeliveryInfo } from "@/data/customers";
import { dedupedModelTrim } from "@/lib/app-card-labels";
import { normalizeDateText } from "@/lib/datetime-text";

// ── 출고 정보 팝오버 순수 계층(2026-07-20 출고 2단계 spec §4·§5) — 전부 순수 함수 ──

export type DeliveryInfoDraft = {
  contractVehicle: string;
  contractDate: string;
  lender: string;
  deliveredDate: string;
  deliveryMemo: string;
  /** 프리필이 참조한 계약 진행 견적 id(soft pipe provenance) — 시드 미적용이면 기존 저장값 승계. */
  sourceQuoteId: string | null;
};

// 프리필 시드(spec §4): 저장값이 비어 있는 필드만 contracting 견적에서 채운다(수기 우선).
// sourceQuoteId = 프리필이 하나라도 적용됐으면 그 견적 id, 아니면 기존 저장값(없으면 null).
// DB 자동 변경 경로 아님 — 저장 버튼을 눌러야만 영속(결합 없음 원칙과 정합).
export function seedDeliveryInfoDraft(
  existing: CustomerDeliveryInfo | null,
  quote: ContractingQuoteSummary | null,
): DeliveryInfoDraft {
  const vehicleSeed = quote ? [quote.brandName, dedupedModelTrim(quote.modelName, quote.trimName)].filter(Boolean).join(" ") : "";
  const seedVehicle = !existing?.contractVehicle && vehicleSeed ? vehicleSeed : null;
  const seedLender = !existing?.lender && quote?.lender ? quote.lender : null;
  return {
    contractVehicle: existing?.contractVehicle ?? seedVehicle ?? "",
    contractDate: existing?.contractDate ?? "",
    lender: existing?.lender ?? seedLender ?? "",
    deliveredDate: existing?.deliveredDate ?? "",
    deliveryMemo: existing?.deliveryMemo ?? "",
    sourceQuoteId: seedVehicle || seedLender ? quote!.id : (existing?.sourceQuoteId ?? null),
  };
}

export type DeliveryInfoSubmit = { kind: "save"; body: CustomerDeliveryInfo } | { kind: "invalid"; reason: string };

// 제출 해석: 빈 문자열 → null(값 지우기), 텍스트 trim, 날짜는 유연 정규화(datetime-text — DateTextField 규약).
export function resolveDeliveryInfoSubmit(draft: DeliveryInfoDraft): DeliveryInfoSubmit {
  const dateOrInvalid = (raw: string, label: string): { ok: true; value: string | null } | { ok: false; reason: string } => {
    if (!raw.trim()) return { ok: true, value: null };
    const normalized = normalizeDateText(raw);
    if (!normalized) return { ok: false, reason: `${label}은 2026-07-20처럼 년-월-일 형식으로 입력해 주세요.` };
    return { ok: true, value: normalized };
  };
  const contract = dateOrInvalid(draft.contractDate, "계약일");
  if (!contract.ok) return { kind: "invalid", reason: contract.reason };
  const delivered = dateOrInvalid(draft.deliveredDate, "출고 실측일");
  if (!delivered.ok) return { kind: "invalid", reason: delivered.reason };
  const textOrNull = (v: string) => (v.trim() ? v.trim() : null);
  return {
    kind: "save",
    body: {
      contractVehicle: textOrNull(draft.contractVehicle),
      contractDate: contract.value,
      lender: textOrNull(draft.lender),
      deliveredDate: delivered.value,
      deliveryMemo: textOrNull(draft.deliveryMemo),
      sourceQuoteId: draft.sourceQuoteId,
    },
  };
}

export type DeliveryInfoSummary = { contractLine: string | null; deliveredLine: string | null; fallback: string | null };

function monthDay(date: string | null): string | null {
  if (!date) return null;
  const [, m, d] = date.split("-").map(Number);
  return m && d ? `${m}/${d}` : null;
}

// 셀 요약(spec §5.1): 계약 줄 "계약 M/D · 금융사"(있는 값만 조합) + 실측 줄 "출고 M/D".
// 전부 비면 null(셀 = "+ 미입력"), 줄 구성 값은 없는데 다른 필드(차량/메모)만 있으면 "입력됨" 폴백(정직 표시).
export function deliveryInfoSummary(info: CustomerDeliveryInfo | null | undefined): DeliveryInfoSummary | null {
  if (!info) return null;
  if (!info.contractVehicle && !info.contractDate && !info.lender && !info.deliveredDate && !info.deliveryMemo) return null;
  const contractDay = monthDay(info.contractDate);
  const contractLine = [contractDay ? `계약 ${contractDay}` : null, info.lender].filter(Boolean).join(" · ") || null;
  const deliveredDay = monthDay(info.deliveredDate);
  const deliveredLine = deliveredDay ? `출고 ${deliveredDay}` : null;
  return { contractLine, deliveredLine, fallback: contractLine || deliveredLine ? null : "입력됨" };
}
```

- [ ] **Step 6.4**: GREEN — `bun run test:unit client/src/lib/delivery-info.test.ts` 전건 pass (⚠️ `normalizeDateText`가 "2026.7.5"를 실제로 어떻게 정규화하는지 구현을 열어 확인 — 기대값이 규약과 다르면 **테스트를 datetime-text 실규약에 맞춘다**, 구현을 바꾸지 않는다)
- [ ] **Step 6.5**: commit `"feat(crm): delivery-info 순수 계층 — soft pipe 시드·제출 정규화·셀 요약(TDD)"`

### Task 7: 콘솔 UI + 페이지 테스트

**Files:** Modify `client/src/pages/CustomerManagementRow.tsx` · `client/src/pages/CustomerManagementPage.tsx` · `client/src/pages/CustomerManagementPage.test.tsx`

- [ ] **Step 7.1**: 실패 테스트 먼저 — `CustomerManagementPage.test.tsx`

①기존 delivery 헤더 기대 배열 갱신(500행 부근): `["", "고객", "차량", "출고 단계", "출고 예정", "출고 정보", "인도 방식", "담당", "관리"]`

②"출고 관리(delivery) 콘솔" describe에 추가:

```tsx
it("출고 정보 미입력 셀 = '+ 미입력' 버튼, 클릭 시 폼형 팝오버(저장·취소)", () => {
  render(<CustomerManagementPage mode="delivery" />);
  fireEvent.click(screen.getAllByRole("button", { name: /^출고 정보 입력:/ })[0]);
  const dialog = screen.getByRole("dialog", { name: "출고 정보 편집" });
  expect(within(dialog).getByRole("button", { name: "저장" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "취소" })).toBeInTheDocument();
});

it("팝오버는 contracting 견적에서 차량·금융사를 프리필한다(soft pipe)", () => {
  const customers = [{
    ...initialCustomers[4],
    id: "cid-5", no: 90005, customerId: "CU-2605-9005", name: "프리필검증",
    statusGroup: "계약완료", status: "배정완료", nextDeliverySchedule: null,
    delivery: null,
    contractingQuote: { id: "q-1", brandName: "BMW", modelName: "5 Series", trimName: "520i", lender: "iM캐피탈" },
  }];
  render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "출고 정보 입력: 프리필검증" }));
  expect(screen.getByLabelText("계약 차량")).toHaveValue("BMW 5 Series 520i");
  expect(screen.getByLabelText("금융사")).toHaveValue("iM캐피탈");
});

it("저장은 정규화 body로 PUT을 호출하고, 리로드 실패(false)면 팝오버 유지+안내(B#1 미러)", async () => {
  const reload = vi.fn().mockResolvedValue(false);
  const customers = [{
    ...initialCustomers[4],
    id: "cid-6", no: 90006, customerId: "CU-2605-9006", name: "출고정보저장검증",
    statusGroup: "계약완료", status: "배정완료", nextDeliverySchedule: null,
    delivery: null, contractingQuote: null,
  }];
  render(<CustomerManagementPage customers={customers} mode="delivery" onCustomerListChanged={reload} onCustomersChange={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "출고 정보 입력: 출고정보저장검증" }));
  fireEvent.change(screen.getByLabelText("계약일"), { target: { value: "2026-07-15" } });
  fireEvent.change(screen.getByLabelText("금융사"), { target: { value: "iM캐피탈" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(saveCustomerDelivery).toHaveBeenCalledWith("cid-6", {
    contractVehicle: null, contractDate: "2026-07-15", lender: "iM캐피탈", deliveredDate: null, deliveryMemo: null, sourceQuoteId: null,
  }));
  expect(await screen.findByRole("alert")).toHaveTextContent("목록을 불러오지");
  expect(screen.getByRole("dialog", { name: "출고 정보 편집" })).toBeInTheDocument();
});

it("delivery mode 차량 셀은 계약 차량 저장값을 우선 표시한다(니즈 파생 폴백)", () => {
  const customers = [{
    ...initialCustomers[4],
    id: "cid-7", no: 90007, customerId: "CU-2605-9007", name: "차량폴백검증",
    statusGroup: "계약완료", status: "배정완료", nextDeliverySchedule: null, vehicle: "니즈차종",
    delivery: { contractVehicle: "계약차량 520i", contractDate: null, lender: null, deliveredDate: null, deliveryMemo: null, sourceQuoteId: null },
    contractingQuote: null,
  }];
  render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
  expect(screen.getByText("계약차량 520i")).toBeInTheDocument();
  expect(screen.queryByText("니즈차종")).toBeNull();
});
```

mock 팩토리에 `saveCustomerDelivery: vi.fn().mockResolvedValue(undefined)` 추가 + 테스트 파일 상단 `import { saveCustomerDelivery } from "@/lib/customer-children";` (vi.mock 대상이라 mocked fn).

- [ ] **Step 7.2**: RED 실관찰 — `bun run test:unit client/src/pages/CustomerManagementPage.test.tsx` FAIL(헤더 배열·셀 부재)
- [ ] **Step 7.3**: `CustomerManagementRow.tsx` 구현

import 추가: `import { deliveryInfoSummary, resolveDeliveryInfoSubmit, seedDeliveryInfoDraft, type DeliveryInfoDraft } from "@/lib/delivery-info";` `import { SOLUTION_LENDERS } from "@/lib/solution-quote";` (+ `resolveDeliveryInfoSubmit`는 Page에서 쓰면 여기선 제외 — 실제 사용처만 import)

①`CustomerVehicleCell`에 계약 차량 오버라이드 prop 추가:

```tsx
export function CustomerVehicleCell({ customer, openExtraFor, onToggleExtra, extraPopoverRef, contractVehicle = null }: {
  /* 기존 props… */
  /** delivery mode 한정(spec §5.2): 계약 차량 저장값이 있으면 모델·트림 줄을 대체(비교 차종 pill 미표시 — 계약 확정 맥락). */
  contractVehicle?: string | null;
}) {
  const vehicle = vehicleDisplay(customer);
  if (contractVehicle) {
    return (
      <td>
        <strong className="vehicle-title"><span className="vehicle-line-text" title={contractVehicle}>{contractVehicle}</span></strong>
        <span className="vehicle-method"><span className="vehicle-line-text">{vehicle.method}</span></span>
      </td>
    );
  }
  /* 기존 렌더 그대로 */
```

②새 셀 + 팝오버(DeliverySchedule 쌍 바로 아래):

```tsx
export function CustomerDeliveryInfoCell({ customer, notice, open, popoverRef, saving, onSave, onToggle }: {
  customer: Customer;
  notice: string | null;
  open: boolean;
  popoverRef: RefObject<HTMLDivElement | null>;
  saving: boolean;
  onSave: (draft: DeliveryInfoDraft) => void;
  onToggle: () => void;
}) {
  const summary = deliveryInfoSummary(customer.delivery);
  return (
    <td className="delivery-info-cell">
      <div className="delivery-info-wrap" ref={open ? popoverRef : undefined}>
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={summary ? `출고 정보: ${customer.name}` : `출고 정보 입력: ${customer.name}`}
          className={summary ? "delivery-info-btn" : "delivery-info-btn delivery-info-btn-empty"}
          onClick={(event) => { event.stopPropagation(); onToggle(); }}
          onPointerDown={stopTableControlPointer}
          type="button"
        >
          {summary ? (
            <span className="delivery-info-lines">
              {summary.contractLine && <span>{summary.contractLine}</span>}
              {summary.deliveredLine && <span>{summary.deliveredLine}</span>}
              {summary.fallback && <span>{summary.fallback}</span>}
            </span>
          ) : (
            <span>+ 미입력</span>
          )}
        </button>
        {open && (
          <DeliveryInfoPopover
            draft={seedDeliveryInfoDraft(customer.delivery ?? null, customer.contractingQuote ?? null)}
            notice={notice}
            saving={saving}
            onCancel={onToggle}
            onSave={onSave}
          />
        )}
      </div>
    </td>
  );
}

// 출고 정보 팝오버 — 폼형(명시 저장·취소: 담당자 변경/고객 등록 관례. 출고 예정의 무취소·경량형과 다른 분류
// — spec §5.3·B#10 각주). fixed 배치·notice 높이 재계산·스크롤 닫기는 출고 예정 팝오버(T13)와 동일 기계장치.
// 팝오버는 열릴 때 마운트되므로 useState(draft) 초기값이 곧 시드 — 재오픈마다 새로 시드된다.
function DeliveryInfoPopover({ draft: initialDraft, notice, saving, onCancel, onSave }: {
  draft: DeliveryInfoDraft;
  notice: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (draft: DeliveryInfoDraft) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const rootRef = useRef<HTMLDivElement>(null);
  const pos = useFixedPopoverPosition(rootRef, ".delivery-info-wrap", Boolean(notice));
  const set = (patch: Partial<DeliveryInfoDraft>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <div
      aria-label="출고 정보 편집"
      className="delivery-info-popover"
      onClick={(event) => event.stopPropagation()}
      ref={rootRef}
      role="dialog"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
    >
      <label><span>계약 차량</span><input onChange={(e) => set({ contractVehicle: e.target.value })} type="text" value={draft.contractVehicle} /></label>
      <label><span>계약일</span><DateTextField onValueChange={(v) => set({ contractDate: v })} value={draft.contractDate} /></label>
      <label>
        <span>금융사</span>
        <input list="delivery-lender-options" onChange={(e) => set({ lender: e.target.value })} type="text" value={draft.lender} />
        <datalist id="delivery-lender-options">{SOLUTION_LENDERS.map((l) => <option key={l.code} value={l.label} />)}</datalist>
      </label>
      <label><span>출고 실측일</span><DateTextField onValueChange={(v) => set({ deliveredDate: v })} value={draft.deliveredDate} /></label>
      <label><span>탁송/정비 메모</span><textarea onChange={(e) => set({ deliveryMemo: e.target.value })} rows={3} value={draft.deliveryMemo} /></label>
      {notice && <p className="delivery-schedule-notice" role="alert">{notice}</p>}
      <div className="delivery-schedule-actions">
        <button disabled={saving} onClick={onCancel} type="button">취소</button>
        <button disabled={saving} onClick={() => onSave(draft)} type="button">{saving ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7.4**: `CustomerManagementPage.tsx` 배선

①heads/columns(128·141행 부근): delivery = `["선택", "고객", "차량", "출고 단계", "출고 예정", "출고 정보", "인도 방식", "담당", "관리"]` / `["select", "customer", "vehicle", "stage", "schedule", "deliveryInfo", "method", "advisor", "actions"]`

②`isTableControl`(48행) closest 목록에 `.delivery-info-wrap` 추가

③state(출고 예정 state 근처):

```tsx
  // 출고 정보 팝오버(delivery mode 전용, 2단계 spec §5.3) — soft pipe 프리필 + upsert.
  const [openDeliveryInfoFor, setOpenDeliveryInfoFor] = useState<number | null>(null);
  const [savingDeliveryInfoFor, setSavingDeliveryInfoFor] = useState<number | null>(null);
  const [deliveryInfoNotice, setDeliveryInfoNotice] = useState<{ no: number; message: string } | null>(null);
  const deliveryInfoPopoverRef = useRef<HTMLDivElement>(null);
```

④dismiss 배선(기존 5벌 아래):

```tsx
  const closeDeliveryInfoStable = useCallback(() => setOpenDeliveryInfoFor(null), []);
  useTablePopoverDismiss({ active: openDeliveryInfoFor !== null, containerRef: deliveryInfoPopoverRef, onClose: closeDeliveryInfoStable, suppressRef: suppressOutsideClickRef, closeOnViewportShift: true });
```

⑤toggle + save(출고 예정 핸들러 아래 — 기존 toggle 5개 각각에 `setOpenDeliveryInfoFor(null);` 상호 닫기 1줄 추가):

```tsx
  function toggleDeliveryInfo(customerNo: number) {
    setOpenStagePicker(null);
    setOpenChanceFor(null);
    setOpenExtraFor(null);
    setOpenFinalUpdateFor(null);
    setOpenDeliveryScheduleFor(null);
    setDeliveryInfoNotice(null);
    setOpenDeliveryInfoFor((current) => (current === customerNo ? null : customerNo));
  }

  // 성공 반영 = 서버 리로드 규약(#234) + 리로드 false 실패 분기(배치 10 B#1) — saveDeliverySchedule 미러.
  async function saveDeliveryInfo(customer: Customer, draft: DeliveryInfoDraft) {
    const submit = resolveDeliveryInfoSubmit(draft);
    if (submit.kind === "invalid") { setDeliveryInfoNotice({ no: customer.no, message: submit.reason }); return; }
    if (!customer.id) { setDeliveryInfoNotice({ no: customer.no, message: "목업 행에는 저장할 수 없습니다." }); return; }
    const cid = customer.id;
    setSavingDeliveryInfoFor(customer.no);
    setDeliveryInfoNotice(null);
    try {
      await saveCustomerDelivery(cid, submit.body);
      if (onCustomerListChanged) {
        const ok = await onCustomerListChanged();
        if (ok === false) {
          setDeliveryInfoNotice({ no: customer.no, message: "저장은 완료됐지만 목록을 불러오지 못했습니다. 새로고침해 주세요." });
          return;
        }
      } else updateCustomers((current) => current.map((c) => (c.no === customer.no ? { ...c, delivery: submit.body } : c)));
      setOpenDeliveryInfoFor((current) => (current === customer.no ? null : current));
    } catch {
      setDeliveryInfoNotice({ no: customer.no, message: "출고 정보 저장에 실패했습니다. 다시 시도해 주세요." });
    } finally {
      setSavingDeliveryInfoFor((current) => (current === customer.no ? null : current));
    }
  }
```

⑥renderRow delivery 분기: `{vehicleCell}` → 계약 차량 오버라이드 셀, 출고 예정 셀 아래 새 셀:

```tsx
          <CustomerVehicleCell contractVehicle={customer.delivery?.contractVehicle ?? null} customer={customer} extraPopoverRef={extraPopoverRef} onToggleExtra={toggleExtraPopover} openExtraFor={openExtraFor} />
          {/* …기존 stage·schedule 셀… */}
          <CustomerDeliveryInfoCell
            customer={customer}
            notice={deliveryInfoNotice?.no === customer.no ? deliveryInfoNotice.message : null}
            open={openDeliveryInfoFor === customer.no}
            popoverRef={deliveryInfoPopoverRef}
            saving={savingDeliveryInfoFor === customer.no}
            onSave={(draft) => void saveDeliveryInfo(customer, draft)}
            onToggle={() => toggleDeliveryInfo(customer.no)}
          />
```

import: `saveCustomerDelivery`(customer-children) · `resolveDeliveryInfoSubmit, type DeliveryInfoDraft`(delivery-info) · `CustomerDeliveryInfoCell`(Row).

- [ ] **Step 7.5**: GREEN — `bun run test:unit client/src/pages/CustomerManagementPage.test.tsx` 전건 pass(기존 delivery 테스트 포함 회귀 0) + typecheck 0
- [ ] **Step 7.6**: commit `"feat(crm): 출고 콘솔 '출고 정보' 컬럼·폼형 팝오버 + 계약 차량 우선 표시(soft pipe UI)"`

### Task 8: CSS

**Files:** Modify `client/src/styles/customer-console.css`(delivery-schedule 블록 뒤) · `client/src/styles/customer-list.css`(:has 승격 룰)

- [ ] **Step 8.1**: customer-console.css 추가

```css
/* 출고 정보 셀(delivery mode) — 요약 줄 버튼 + 5필드 폼형 팝오버 (2026-07-20 출고 2단계).
   notice/actions는 delivery-schedule-* 공용 재사용. */
.delivery-info-wrap { position: relative; display: inline-flex; }
.delivery-info-btn {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 26px; padding: 3px 9px; border-radius: 6px;
  border: 1px solid #dededb; background: #fff; font-size: 12px; color: #3f4750;
  box-shadow: 0 1px 1.5px rgba(15, 20, 25, 0.06); cursor: pointer; text-align: left;
}
/* generic 'empty' 금지 — dashboard.css 전역 .empty 캐스케이드 충돌(delivery-schedule-empty 선례) */
.delivery-info-btn.delivery-info-btn-empty { border-style: dashed; color: #9aa1a9; }
.delivery-info-btn:hover { border-color: rgba(88, 54, 255, 0.34); }
.delivery-info-lines { display: grid; gap: 1px; line-height: 1.35; }
/* fixed 배치 — 콘솔 래퍼 overflow:hidden 클리핑 탈출(delivery-schedule-popover와 동일 사유·기계장치) */
.delivery-info-popover {
  position: fixed; z-index: 160;
  display: grid; gap: 8px; min-width: 260px; padding: 12px;
  background: #fff; border: 1px solid var(--line, #dededb); border-radius: 12px;
  box-shadow: 0 12px 28px rgba(15, 20, 25, 0.16);
}
.delivery-info-popover label { display: grid; gap: 4px; font-size: 11px; color: #6b7280; }
.delivery-info-popover input { height: 28px; border: 1px solid #dededb; border-radius: 6px; padding: 0 8px; font-size: 12px; }
.delivery-info-popover textarea { border: 1px solid #dededb; border-radius: 6px; padding: 6px 8px; font-size: 12px; font: inherit; resize: vertical; }
```

- [ ] **Step 8.2**: customer-list.css 408행 :has 룰에 `.customer-table tr:has(.delivery-info-popover)` 셀렉터 추가(행 z:1 스태킹 컨텍스트 — fixed여도 조상 컨텍스트에 갇힌다, 출고 예정 각주와 동일)
- [ ] **Step 8.3**: `bun run build` 성공 확인, commit `"style(crm): 출고 정보 셀·팝오버 CSS + tr:has 승격 편입"`

### Task 9: pending 항목 15 등재

**Files:** Modify `ref/director-pending-confirmations.md` (항목 14 위에 추가)

- [ ] **Step 9.1**:

```md
### 항목 15 — 출고 관리 2단계: 출고 도메인 얇은 테이블 (PR #TBD, 2026-07-20): 🟡 **유슨생 주도 구현 — 사후 공유 예정**

1단계(항목 13)와 같은 거버넌스의 대체 가정(전부 가역, 스펙 `ref/specs/2026-07-20-crm-delivery-step2-design.md` §7): ①`crm.customer_deliveries` **고객당 1행** 얇은 테이블 신설 — 계약 차량·계약일·금융사·출고 실측일·탁송/정비 메모 5종(재구매 2회차 출고 이력은 CT/DV 정식 모델 설계 때) ②**소프트 파이프** — 견적함 "계약 진행" 마킹 견적에서 출고 정보 팝오버가 차량·금융사를 프리필(자동 반영 아님·수기 우선·저장은 스냅샷) ③편집 = 출고 콘솔 팝오버 단일 표면 + delivery mode 차량 컬럼이 계약 차량 우선 표시 ④DV 채번 **계속 미개봉**(인도 완료 시 발급 규칙과 함께 정식 설계 때) ⑤체크리스트 제외(후속 후보 — 할일 어휘 확장). 출고완료 전이와 실측일은 완전 독립(1단계 결합 없음 원칙).
```

- [ ] **Step 9.2**: PR 번호 확정 후 `#TBD` 치환(Task 10에서), commit은 Task 10 문서 커밋에 합류

### Task 10: 통합 검증 + PR 생성(머지 금지)

- [ ] **Step 10.1**: `bun run typecheck` 0 · `bun run lint` 0(problems 0 유지)
- [ ] **Step 10.2**: `bun run test:unit` 전건 · `bun run test:server` 전건(실 master — 잔재 0까지)
- [ ] **Step 10.3**: `bun run build` 성공
- [ ] **Step 10.4**: knip 드리프트 확인(`bunx knip` — 신규 unused export 0. `delivery-info.ts` export가 전부 소비되는지)
- [ ] **Step 10.5**: push + PR 생성(**머지 금지** — 유슨생 지시): `gh pr create` — 본문에 spec/plan 링크·검증 결과·**🟡 pending 항목 15**(이사님 사후 공유) 표시·`[skip ci]` 금지. 생성된 PR 번호로 pending 파일 `#TBD` 치환 커밋 후 재push
- [ ] **Step 10.6**: plan 상단 ✅ 진행 상태 갱신 커밋

### Task 11: 격리 스택 브라우저 스모크(머지 전 필수)

- [ ] 격리 스택(PORT=8799 API + vite 5174 임시 config — 사용자 dev 불가침)에서 magiclink admin 세션으로:
  1. 실 고객(계약완료 큐) 1명 선정 → 견적 1건 "계약 진행" 마킹(psql `decision_status` 사전 캡처)
  2. 출고 콘솔 → 출고 정보 `+ 미입력` 클릭 → **프리필 실증**(계약 차량·금융사 = 그 견적 값)
  3. 저장 → psql `crm.customer_deliveries` 대조(전 필드 + source_quote_id) → 셀 요약·차량 컬럼 계약 차량 표시 확인
  4. 수정 왕복(실측일 추가) → upsert 1행 유지 확인
  5. **byte-exact 원복**: `DELETE FROM crm.customer_deliveries WHERE customer_id=…` + `decision_status` 원값 UPDATE + 잔재 0 확인
- [ ] 스모크 결과를 PR 본문에 추기

---

## Self-Review 노트 (plan 작성 시점)

- **Spec 커버리지**: §3=Task 1 · §4.1=Task 3 · §4.2=Task 4 · §4(파이프 규칙)=Task 6 · §5.1/5.3=Task 7·8 · §5.2=Task 7(①) · §7=Task 9 · §9=Task 3~7 테스트+Task 10~11. 누락 없음.
- **타입 일관성**: `CustomerDeliveryInfo`(Task 2)를 서버 upsert patch·클라 body·서브쿼리 shape가 공유(별도 재선언 없음). `DeliveryInfoDraft`는 Task 6 정의를 Task 7이 import.
- **주의**: Step 6.4 — `normalizeDateText`의 실제 유연성(예: "2026.7.5")은 구현 확인 후 테스트 기대값 확정(규약이 SSOT). Step 7.1 프리필 테스트의 `initialCustomers[4]` 스프레드는 기존 B#1 테스트 관례 — 해당 인덱스 고객의 mock 필드가 단언과 충돌하면 명시 필드로 덮는다.
