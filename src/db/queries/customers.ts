import { asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import {
  consultations,
  customerDocuments,
  customerMemos,
  customers,
  customerSchedules,
  customerTasks,
  quotes,
  quoteScenarios,
} from "../schema";

// 목록 행 = customers 전체 컬럼 + 상담메모용 최신 미완료 task 1건 body.
export type CustomerListRow = typeof customers.$inferSelect & { latestTask: string | null };

// 상담메모(목업 nextAction): customer_tasks 최신 미완료 1건 body를 상관 서브쿼리로.
// customer_id 비교는 crm.customers.id로 완전정규화 — 섀도잉 사유는 아래 staffActivityAt 주석 참조(동일 버그 클래스).
const latestTaskBody = sql<string | null>`(
  select t.body from crm.customer_tasks t
  where t.customer_id = crm.customers.id and t.done = false
  order by t.created_at desc limit 1
)`;

// 목록·상세가 공유하는 "마지막 담당자 액션" 파생 — 관리 상태(정상/확인필요/지연/장기방치)의 입력.
// customers.updated_at(본체 PATCH 스탬프) + 자식 추가 시각 max(created_at). 자식 테이블엔 updated_at이
// 없어 수정은 못 잡는다(허용 근사 — 컬럼 추가는 follow-up). last_activity_at 컬럼(시드 후 미갱신·죽은 값)은
// 이 파생값으로 응답에서 대체된다(컬럼 자체는 불변, drop은 follow-up).
// 주의: 상관 서브쿼리 안에서는 반드시 `crm.customers.id`로 완전정규화한다 — 자식 테이블(memo/task/schedule/
// document) 모두 자기 자신의 "id" 컬럼을 갖고 있어, `${customers.id}`(비정규화 "id")를 쓰면 SQL 스코프 규칙상
// 바깥 customers.id가 아니라 서브쿼리 자신의 테이블(m.id/t.id/...)로 섀도잉되어 조건이 사실상 항상 거짓이 된다
// (greatest가 전부 NULL을 받아 customers.updated_at만 남는 조용한 오답 — 실측으로 발견, 자세한 재현은 커밋 기록 참조).
const staffActivityAt = sql<Date | null>`greatest(
  ${customers.updatedAt},
  (select max(m.created_at) from crm.customer_memos m where m.customer_id = crm.customers.id),
  (select max(t.created_at) from crm.customer_tasks t where t.customer_id = crm.customers.id),
  (select max(s.created_at) from crm.customer_schedules s where s.customer_id = crm.customers.id),
  (select max(d.created_at) from crm.customer_documents d where d.customer_id = crm.customers.id)
)`;

// 쓰기 가능한 customers 컬럼만(고객 쓰기 #1 범위). 값 enum 검증은 추후.
export type CustomerWritePatch = Partial<
  Pick<
    typeof customers.$inferInsert,
    | "phone"
    | "residence"
    | "customerType"
    | "customerTypeDetail"
    | "source"
    | "statusGroup"
    | "status"
    | "chance"
    | "advisorName"
    | "team"
    | "assignedAt"
    | "needModel"
    | "needTrim"
    | "needColors"
    | "needMethod"
    | "needTiming"
    | "needMemo"
    | "needContractTerm"
    | "needInitialCost"
    | "needAnnualMileage"
    | "needDeliveryMethod"
    | "needContractFocus"
    | "needCustomerNote"
    | "needReviewNote"
  >
>;

export async function updateCustomer(
  id: string,
  patch: CustomerWritePatch,
  executor: Executor = getDefaultDb(),
): Promise<{ id: string } | null> {
  const [row] = await executor
    .update(customers)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(customers.id, id))
    .returning({ id: customers.id });
  return row ?? null;
}

// 현재 담당자 이름만 조회(배정 PATCH의 assigned_at 스탬프 판정용). 없는 고객은 null.
export async function getCustomerAdvisorName(
  id: string,
  executor: Executor = getDefaultDb(),
): Promise<{ advisorName: string | null } | null> {
  const [row] = await executor.select({ advisorName: customers.advisorName }).from(customers).where(eq(customers.id, id));
  return row ?? null;
}

// 고객의 app_user_id만 조회. 없는 고객은 null(라우트 404), 있으면 {appUserId}(null이면 수기 고객).
export async function getCustomerAppUserId(
  id: string,
  executor: Executor = getDefaultDb(),
): Promise<{ appUserId: string | null } | null> {
  const [row] = await executor.select({ appUserId: customers.appUserId }).from(customers).where(eq(customers.id, id));
  return row ?? null;
}

export async function listCustomers(executor: Executor = getDefaultDb()): Promise<CustomerListRow[]> {
  return executor
    .select({ ...getTableColumns(customers), latestTask: latestTaskBody, lastActivityAt: staffActivityAt })
    .from(customers)
    .orderBy(desc(customers.receivedAt));
}

export type QuoteWithScenarios = Omit<typeof quotes.$inferSelect, "filePath"> & {
  scenarios: (typeof quoteScenarios.$inferSelect)[];
};

export type CustomerDetail = typeof customers.$inferSelect & {
  tasks: (typeof customerTasks.$inferSelect)[];
  schedules: (typeof customerSchedules.$inferSelect)[];
  memos: (typeof customerMemos.$inferSelect)[];
  documents: Omit<typeof customerDocuments.$inferSelect, "filePath" | "thumbPath">[];
  consultations: (typeof consultations.$inferSelect)[];
  quotes: QuoteWithScenarios[];
};

export async function getCustomer(id: string, executor: Executor = getDefaultDb()): Promise<CustomerDetail | null> {
  const [customer] = await executor
    .select({ ...getTableColumns(customers), lastActivityAt: staffActivityAt })
    .from(customers)
    .where(eq(customers.id, id));
  if (!customer) return null;
  // 자식 6개는 병렬(존재 확인 후 1회 배치). quotes는 scenarios 묶음을 위해 id 목록을 먼저 받아야 하므로 그 뒤 1 왕복 추가.
  const [tasks, schedules, memos, documents, consults, quoteRows] = await Promise.all([
    executor.select().from(customerTasks).where(eq(customerTasks.customerId, id)).orderBy(asc(customerTasks.createdAt)),
    executor.select().from(customerSchedules).where(eq(customerSchedules.customerId, id)).orderBy(asc(customerSchedules.createdAt)),
    executor.select().from(customerMemos).where(eq(customerMemos.customerId, id)).orderBy(asc(customerMemos.createdAt)),
    executor
      .select({
        id: customerDocuments.id,
        customerId: customerDocuments.customerId,
        docType: customerDocuments.docType,
        fileName: customerDocuments.fileName,
        fileSize: customerDocuments.fileSize,
        fileMime: customerDocuments.fileMime,
        sortOrder: customerDocuments.sortOrder,
        createdAt: customerDocuments.createdAt,
      })
      .from(customerDocuments)
      .where(eq(customerDocuments.customerId, id))
      .orderBy(asc(customerDocuments.sortOrder), asc(customerDocuments.createdAt)),
    executor.select().from(consultations).where(eq(consultations.customerId, id)),
    executor.select().from(quotes).where(eq(quotes.customerId, id)).orderBy(asc(quotes.createdAt)),
  ]);

  const quoteIds = quoteRows.map((q) => q.id);
  const scenarioRows = quoteIds.length
    ? await executor.select().from(quoteScenarios).where(inArray(quoteScenarios.quoteId, quoteIds)).orderBy(asc(quoteScenarios.scenarioNo))
    : [];
  const scenariosByQuote = new Map<string, (typeof quoteScenarios.$inferSelect)[]>();
  for (const s of scenarioRows) {
    const arr = scenariosByQuote.get(s.quoteId);
    if (arr) arr.push(s);
    else scenariosByQuote.set(s.quoteId, [s]);
  }
  const quotesWithScenarios: QuoteWithScenarios[] = quoteRows.map(({ filePath: _filePath, ...rest }) => ({ ...rest, scenarios: scenariosByQuote.get(rest.id) ?? [] }));

  return { ...customer, tasks, schedules, memos, documents, consultations: consults, quotes: quotesWithScenarios };
}
