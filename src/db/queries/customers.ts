import { asc, desc, eq, getTableColumns, sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import {
  consultations,
  customerDocuments,
  customerMemos,
  customers,
  customerSchedules,
  customerTasks,
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

export type CustomerDetail = typeof customers.$inferSelect & {
  tasks: (typeof customerTasks.$inferSelect)[];
  schedules: (typeof customerSchedules.$inferSelect)[];
  memos: (typeof customerMemos.$inferSelect)[];
  documents: Omit<typeof customerDocuments.$inferSelect, "filePath">[];
  consultations: (typeof consultations.$inferSelect)[];
};

export async function getCustomer(id: string, executor: Executor = getDefaultDb()): Promise<CustomerDetail | null> {
  const [customer] = await executor.select().from(customers).where(eq(customers.id, id));
  if (!customer) return null;
  // 자식 5개는 병렬(존재 확인 후 1회 배치 — 순차 6왕복 → 2왕복으로 단축). 상세는 저빈도라 동시연결 부담 작음.
  const [tasks, schedules, memos, documents, consults] = await Promise.all([
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
  ]);
  return { ...customer, tasks, schedules, memos, documents, consultations: consults };
}
