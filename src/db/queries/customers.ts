import { asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { staffActivityAt } from "./activity";
import { listAdvisorViewedAt } from "./advisor-quotes";
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
// customer_id 비교는 crm.customers.id로 완전정규화 — 섀도잉 사유는 activity.ts staffActivityAt 주석 참조(동일 버그 클래스).
const latestTaskBody = sql<string | null>`(
  select t.body from crm.customer_tasks t
  where t.customer_id = crm.customers.id and t.done = false
  order by t.created_at desc limit 1
)`;

// "마지막 담당자 액션" 파생은 activity.ts로 이동(0706 배치 B) — 업무 AI 도구와 공유하는 SSOT.
// 파생 집합·완전정규화(섀도잉) 주의사항은 그쪽 주석 참조.

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
    | "advisorId"
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

// 현재 담당자 이름 + 고객명 조회(배정 PATCH의 assigned_at 스탬프 판정 + 배정 알림 body용). 없는 고객은 null.
export async function getCustomerAdvisorName(
  id: string,
  executor: Executor = getDefaultDb(),
): Promise<{ advisorName: string | null; name: string } | null> {
  const [row] = await executor
    .select({ advisorName: customers.advisorName, name: customers.name })
    .from(customers)
    .where(eq(customers.id, id));
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
  const [scenarioRows, advisorViewed] = await Promise.all([
    quoteIds.length
      ? executor.select().from(quoteScenarios).where(inArray(quoteScenarios.quoteId, quoteIds)).orderBy(asc(quoteScenarios.scenarioNo))
      : Promise.resolve([]),
    // 열람 read-through(스펙 결정 8): 앱이 스탬프하는 public.advisor_quotes.viewed_at이 열람 SSOT라
    // 동기화 배치 없이 조회 시점에 병합한다(crm.quotes.viewed_at은 아무도 write 안 해 항상 null).
    listAdvisorViewedAt(quoteIds, executor),
  ]);
  const scenariosByQuote = new Map<string, (typeof quoteScenarios.$inferSelect)[]>();
  for (const s of scenarioRows) {
    const arr = scenariosByQuote.get(s.quoteId);
    if (arr) arr.push(s);
    else scenariosByQuote.set(s.quoteId, [s]);
  }
  const quotesWithScenarios: QuoteWithScenarios[] = quoteRows.map(({ filePath: _filePath, ...rest }) => {
    // Map 시맨틱: absent=앱 미전달, null=전달·미열람. 여기선 값이 있는 경우만 승격하므로
    // absent/null 구분 소실이 무해(폴백 rest.viewedAt은 사실상 항상 null). advisor 쪽은
    // mode:"string"이라 Date로 변환해 CustomerDetail 타입(Date | null)을 불변 유지.
    const viewed = advisorViewed.get(rest.id);
    return { ...rest, viewedAt: viewed != null ? new Date(viewed) : rest.viewedAt, scenarios: scenariosByQuote.get(rest.id) ?? [] };
  });

  return { ...customer, tasks, schedules, memos, documents, consultations: consults, quotes: quotesWithScenarios };
}
