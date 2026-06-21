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
const latestTaskBody = sql<string | null>`(
  select t.body from crm.customer_tasks t
  where t.customer_id = ${customers.id} and t.done = false
  order by t.created_at desc limit 1
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
    | "needModel"
    | "needTrim"
    | "needColors"
    | "needMethod"
    | "needTiming"
    | "needMemo"
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

export async function listCustomers(executor: Executor = getDefaultDb()): Promise<CustomerListRow[]> {
  return executor
    .select({ ...getTableColumns(customers), latestTask: latestTaskBody })
    .from(customers)
    .orderBy(desc(customers.receivedAt));
}

export type QuoteWithScenarios = typeof quotes.$inferSelect & {
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
  const [customer] = await executor.select().from(customers).where(eq(customers.id, id));
  if (!customer) return null;
  // 자식 6개는 병렬(존재 확인 후 1회 배치). quotes는 scenarios 묶음을 위해 id 목록을 먼저 받아야 하므로 그 뒤 1 왕복 추가.
  const [tasks, schedules, memos, documents, consults, quoteRows] = await Promise.all([
    executor.select().from(customerTasks).where(eq(customerTasks.customerId, id)),
    executor.select().from(customerSchedules).where(eq(customerSchedules.customerId, id)),
    executor.select().from(customerMemos).where(eq(customerMemos.customerId, id)),
    executor
      .select({
        id: customerDocuments.id,
        customerId: customerDocuments.customerId,
        title: customerDocuments.title,
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
  const quotesWithScenarios: QuoteWithScenarios[] = quoteRows.map((q) => ({ ...q, scenarios: scenariosByQuote.get(q.id) ?? [] }));

  return { ...customer, tasks, schedules, memos, documents, consultations: consults, quotes: quotesWithScenarios };
}
