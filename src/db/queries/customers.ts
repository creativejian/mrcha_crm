import { asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import type { CustomerScope } from "../../lib/assistant-scope";
import { staffActivityAt } from "./activity";
import { listAdvisorViewedAt } from "./advisor-quotes";
import { nextCustomerCode } from "./quote-requests";
import { profiles } from "../public-app";
import { DELIVERY_SCHEDULE_TYPE, type ContractingQuoteSummary, type CustomerDeliveryInfo, type NextDeliverySchedule } from "../../../client/src/data/customers";
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

// 목록 행 = customers 전체 컬럼 + 상담메모용 최신 미완료 task 1건 body + 출고 파생 3종.
export type CustomerListRow = typeof customers.$inferSelect & {
  latestTask: string | null;
  nextDeliverySchedule: NextDeliverySchedule | null;
  delivery: CustomerDeliveryInfo | null;
  contractingQuote: ContractingQuoteSummary | null;
};

// 상담메모(목업 nextAction): customer_tasks 최신 미완료 1건 body를 상관 서브쿼리로.
// customer_id 비교는 crm.customers.id로 완전정규화 — 섀도잉 사유는 activity.ts staffActivityAt 주석 참조(동일 버그 클래스).
const latestTaskBody = sql<string | null>`(
  select t.body from crm.customer_tasks t
  where t.customer_id = crm.customers.id and t.done = false
  order by t.created_at desc limit 1
)`;

// "마지막 담당자 액션" 파생은 activity.ts로 이동(0706 배치 B) — 업무 AI 도구와 공유하는 SSOT.
// 파생 집합·완전정규화(섀도잉) 주의사항은 그쪽 주석 참조.

// 출고 콘솔 '출고 예정' 파생(2026-07-19 spec §4): 미완료 '출고' 일정 중 가장 이른 (날짜, 시간) 1건.
// 날짜 없는 행 제외(표시·정렬 불가) · 같은 날짜의 시간 미지정은 뒤(nulls last) · 과거 날짜도 그대로(콘솔이 "지남" 표시).
// id는 콘솔 팝오버의 수정/삭제 대상 지정용. customer_id 비교는 crm.customers.id 완전정규화(latestTaskBody와 동일 — 섀도잉 버그 클래스).
const nextDeliverySchedule = sql<NextDeliverySchedule | null>`(
  select json_build_object('id', s.id, 'date', s.scheduled_date, 'time', s.scheduled_time)
  from crm.customer_schedules s
  where s.customer_id = crm.customers.id
    and s.type = ${DELIVERY_SCHEDULE_TYPE}
    and s.done = false
    and s.scheduled_date is not null
  order by s.scheduled_date asc, s.scheduled_time asc nulls last, s.created_at asc
  limit 1
)`;

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

// 주 번호 read-through 합성(2026-07-17 spec §3-2): 앱 연결 고객의 주 번호는 profiles.phone_number가
// 진실 원본(앱에서 바꾸면 다음 조회부터 자동 반영 — viewed_at #159 선례). 수기 고객은 crm phone.
// 저장·동기화 없음 — CHECK 불변식(app_user_id ↔ phone 배타)이 두 소스의 공존을 막는다.
// export — 업무 AI 도구(assistant-tools.searchCustomers)도 같은 합성을 써야 한다. 손으로 복제하면
// `customers.phone`만 읽는 판이 생기고, 앱 연결 고객은 그 컬럼이 **항상 NULL**이라 화면엔 번호가
// 보이는데 AI만 "연락처 없음"이라 답하는 어긋남이 난다(2026-07-23 실제 발생). 쓰는 쪽은 반드시
// `.leftJoin(profiles, eq(customers.appUserId, profiles.id))`를 함께 건다.
export const composedPhone = sql<string | null>`coalesce(${profiles.phoneNumber}, ${customers.phone})`;

// 쓰기 가능한 customers 컬럼만(고객 쓰기 #1 범위). 값 enum 검증은 추후.
export type CustomerWritePatch = Partial<
  Pick<
    typeof customers.$inferInsert,
    | "phone"
    | "phoneSecondary"
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
    | "manageStatus"
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
  // 수동 관리 상태(스누즈)의 유효 규칙이 manage_status_at >= staffActivityAt(= updated_at 포함 GREATEST)라서,
  // 스탬프를 updated_at과 **같은 now**로 찍어야 설정 직후에 유효하다(별도 new Date()면 ms 차이로 즉시 만료).
  const now = new Date();
  const manageStamp =
    patch.manageStatus !== undefined ? { manageStatusAt: patch.manageStatus === null ? null : now } : {};
  const [row] = await executor
    .update(customers)
    .set({ ...patch, ...manageStamp, updatedAt: now })
    .where(eq(customers.id, id))
    .returning({ id: customers.id });
  return row ?? null;
}

export type CustomerCreateInput = {
  name: string;
  phone?: string | null;
  source?: string | null;
  /** 등록자 자동 배정 — null이면 미배정 생성(라우트가 getStaffName 실패 시 null을 넘긴다). */
  advisor?: { id: string; name: string } | null;
};

// 수기 등록 INSERT — 승격(createCustomerFromRequest/FromConsultation)과 시드 3필드(신규/상담접수/receivedAt)가
// 같지만 코드는 공유하지 않는다(각 경로의 입력 해석이 전부 다름 — spec 확정 결정 4).
// 라우트가 트랜잭션으로 감싸 호출한다(채번+INSERT 원자성 — 승격 라우트 동일).
export async function createCustomerManual(
  input: CustomerCreateInput,
  ex: Executor = getDefaultDb(),
): Promise<typeof customers.$inferSelect> {
  const customerCode = await nextCustomerCode(ex);
  const now = new Date();
  const [row] = await ex
    .insert(customers)
    .values({
      customerCode,
      name: input.name,
      phone: input.phone ?? null,
      source: input.source ?? null,
      statusGroup: "신규",
      status: "상담접수",
      receivedAt: now,
      // 이름·id·배정시각 동반 세팅 — 이름만 갈리고 구 id가 남는 스테일(타 상담사 scope 오염) 방지 규칙.
      ...(input.advisor ? { advisorId: input.advisor.id, advisorName: input.advisor.name, assignedAt: now } : {}),
    })
    .returning();
  return row;
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

// 고객의 advisor_id만 조회 — 견적 쓰기 권한 게이트(canWriteQuote) 입력. 없는 고객은 null(라우트 404).
export async function getCustomerAdvisorId(
  id: string,
  executor: Executor = getDefaultDb(),
): Promise<{ advisorId: string | null } | null> {
  const [row] = await executor
    .select({ advisorId: customers.advisorId })
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

// scope(2026-07-21 role scope spec S-1): "all"=전체(기본값 — 기존 호출부 무영향),
// { advisorId }=본인 담당만. SSOT는 resolveCustomerScope(assistant-scope.ts) — AI(#176)와
// 화면의 고객 집합이 같은 판정을 공유한다. 미배정(advisor_id NULL)은 매칭 불가 = 자동 제외(S-4).
export async function listCustomers(executor: Executor = getDefaultDb(), scope: CustomerScope = "all"): Promise<CustomerListRow[]> {
  const query = executor
    .select({ ...getTableColumns(customers), phone: composedPhone, latestTask: latestTaskBody, lastActivityAt: staffActivityAt, nextDeliverySchedule, delivery: deliveryInfo, contractingQuote: contractingQuoteSummary })
    .from(customers)
    .leftJoin(profiles, eq(customers.appUserId, profiles.id));
  if (scope !== "all") return query.where(eq(customers.advisorId, scope.advisorId)).orderBy(desc(customers.receivedAt));
  return query.orderBy(desc(customers.receivedAt));
}

type QuoteWithScenarios = Omit<typeof quotes.$inferSelect, "filePath"> & {
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
    .select({ ...getTableColumns(customers), phone: composedPhone, lastActivityAt: staffActivityAt })
    .from(customers)
    .leftJoin(profiles, eq(customers.appUserId, profiles.id))
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
