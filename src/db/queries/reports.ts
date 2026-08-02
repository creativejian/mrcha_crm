import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import {
  CONTRACTED_STATUS_GROUP,
  DELIVERY_SCHEDULE_TYPE,
  IN_PROGRESS_STATUS_GROUPS,
} from "../../../client/src/data/customers"; // 순수 상수 leaf(부작용 0) — 상태 어휘 SSOT 공유
import { monthRangeUtc, prevMonthKey } from "../../lib/report-month";
import { brandsInCatalog, modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { advisorQuotes, quoteRequests } from "../public-app";
import { customers, customerSchedules, quotes } from "../schema";

// 경영 리포트 집계(2026-08-02) — spec: ref/specs/2026-08-02-crm-admin-report-live-design.md.
// 기간 지표는 전부 KST 월 경계 [start, end)로 자른다(report-month.ts가 경계 계산 SSOT).
// ⚠️ 스냅샷 지표(inProgress·contracted·upcomingDeliveries)는 **월과 무관하게 현재 값**이다 —
// 상태 전이 시각 컬럼이 없어 과거 월을 물어도 오늘 기준이 나온다(spec §2a). UI가 "현재 기준"으로
// 표기하는 근거이니, 여기에 month 필터를 붙였다고 착각해 표기를 떼지 말 것.

export type AdminReport = {
  month: string;
  prevMonth: string;
  overview: {
    newInflow: { count: number; prevCount: number };
    inProgress: { count: number };
    quotesSent: { count: number; viewedCount: number };
    contracted: { count: number };
    upcomingDeliveries: { count: number; overdueCount: number };
  };
  brandInquiries: { total: number; rows: Array<{ brand: string; count: number }> };
  quoteFunnel: { created: number; sent: number; viewed: number; contracting: number };
};

export async function getAdminReport(month: string, ex: Executor = getDefaultDb()): Promise<AdminReport> {
  const prev = prevMonthKey(month);
  const { start, end } = monthRangeUtc(month);
  const { start: prevStart, end: prevEnd } = monthRangeUtc(prev);

  const [customerAgg, quoteAgg, deliveryAgg, brandRows] = await Promise.all([
    selectCustomerAggregate(ex, start, end, prevStart, prevEnd),
    selectQuoteAggregate(ex, start, end),
    selectDeliveryAggregate(ex),
    selectBrandInquiries(ex, start, end),
  ]);

  return {
    month,
    prevMonth: prev,
    overview: {
      newInflow: { count: customerAgg.newInflow, prevCount: customerAgg.prevInflow },
      inProgress: { count: customerAgg.inProgress },
      quotesSent: { count: quoteAgg.sent, viewedCount: quoteAgg.viewed },
      contracted: { count: customerAgg.contracted },
      upcomingDeliveries: { count: deliveryAgg.count, overdueCount: deliveryAgg.overdue },
    },
    brandInquiries: {
      total: brandRows.reduce((sum, row) => sum + row.count, 0),
      rows: brandRows,
    },
    quoteFunnel: quoteAgg.funnel,
  };
}

// ⚠️ raw `sql` 템플릿의 파라미터에는 **컬럼 타입 매퍼가 붙지 않는다** — Date 객체를 그대로 넣으면
// postgres.js가 직렬화 단계에서 던진다(ERR_INVALID_ARG_TYPE, 2026-08-02 실측). `gte()`/`lt()` 헬퍼와
// 달리 여기서는 ISO 문자열 + 명시 `::timestamptz` 캐스팅이 필요하다.
function tstz(at: Date) {
  return sql`${at.toISOString()}::timestamptz`;
}

// 고객 4지표를 한 번의 스캔으로. 별도 쿼리 4벌로 나누면 같은 테이블을 네 번 훑는다.
async function selectCustomerAggregate(ex: Executor, start: Date, end: Date, prevStart: Date, prevEnd: Date) {
  const inMonth = sql`${customers.receivedAt} >= ${tstz(start)} and ${customers.receivedAt} < ${tstz(end)}`;
  const inPrevMonth = sql`${customers.receivedAt} >= ${tstz(prevStart)} and ${customers.receivedAt} < ${tstz(prevEnd)}`;
  const [row] = await ex
    .select({
      newInflow: sql<number>`count(*) filter (where ${inMonth})::int`,
      prevInflow: sql<number>`count(*) filter (where ${inPrevMonth})::int`,
      // `= any(${배열})`은 쓰지 않는다 — drizzle이 배열을 `($1,$2,…)` 튜플로 펼쳐서 Postgres가
      // "op ANY/ALL (array) requires array on right side"로 거부한다(2026-08-02 실측). inArray가 `in (…)`을 만든다.
      inProgress: sql<number>`count(*) filter (where ${inArray(customers.statusGroup, [...IN_PROGRESS_STATUS_GROUPS])})::int`,
      contracted: sql<number>`count(*) filter (where ${customers.statusGroup} = ${CONTRACTED_STATUS_GROUP})::int`,
    })
    .from(customers);
  return row ?? { newInflow: 0, prevInflow: 0, inProgress: 0, contracted: 0 };
}

// 견적 발송·퍼널. 열람 SSOT는 **public.advisor_quotes.viewed_at**이다 — crm.quotes.viewed_at은
// 전 행 NULL이라(2026-08-02 실측 32/32) 그걸 쓰면 열람이 영구 0으로 나온다(spec §2b).
// leftJoin은 crm_quote_id UNIQUE라 1:1 — 카운트가 부풀지 않는다.
async function selectQuoteAggregate(ex: Executor, start: Date, end: Date) {
  const createdInMonth = sql`${quotes.createdAt} >= ${tstz(start)} and ${quotes.createdAt} < ${tstz(end)}`;
  const sentInMonth = sql`${quotes.sentAt} >= ${tstz(start)} and ${quotes.sentAt} < ${tstz(end)}`;
  const [row] = await ex
    .select({
      created: sql<number>`count(*) filter (where ${createdInMonth})::int`,
      sent: sql<number>`count(*) filter (where ${sentInMonth})::int`,
      viewed: sql<number>`count(*) filter (where ${sentInMonth} and ${advisorQuotes.viewedAt} is not null)::int`,
      contracting: sql<number>`count(*) filter (where ${createdInMonth} and ${quotes.decisionStatus} = 'contracting')::int`,
    })
    .from(quotes)
    .leftJoin(advisorQuotes, eq(advisorQuotes.crmQuoteId, quotes.id));
  const agg = row ?? { created: 0, sent: 0, viewed: 0, contracting: 0 };
  return { sent: agg.sent, viewed: agg.viewed, funnel: agg };
}

// 출고 예정 = 미완료 '출고' 일정(출고 콘솔 파생 정의와 같은 어휘). 예정일이 지난 건은 overdue로
// 떼어낸다 — 합산해 버리면 "예정 5건"이 사실은 전부 지난 건일 수 있다.
// 오늘 판정은 **DB 시계의 KST 날짜**다(앱 시계로 찍으면 Workers=UTC에서 9시간 밀린다).
async function selectDeliveryAggregate(ex: Executor) {
  const today = sql`(now() at time zone 'Asia/Seoul')::date`;
  const [row] = await ex
    .select({
      count: sql<number>`count(*)::int`,
      overdue: sql<number>`count(*) filter (where ${customerSchedules.scheduledDate} < ${today})::int`,
    })
    .from(customerSchedules)
    .where(and(eq(customerSchedules.type, DELIVERY_SCHEDULE_TYPE), eq(customerSchedules.done, false)));
  return row ?? { count: 0, overdue: 0 };
}

// 브랜드별 문의 = 앱 견적요청 × catalog 3단 조인. innerJoin이라 **trim이 붙지 않은 요청은 빠진다**
// (trim_id NULL·카탈로그에서 삭제된 트림) — 그래서 total은 "월 요청 수"가 아니라 "브랜드가 확인된
// 요청 수"다. 화면도 브랜드 바 목록만 그리므로 그 정의로 충분하다.
async function selectBrandInquiries(ex: Executor, start: Date, end: Date) {
  return ex
    .select({ brand: brandsInCatalog.name, count: sql<number>`count(*)::int` })
    .from(quoteRequests)
    .innerJoin(trimsInCatalog, eq(trimsInCatalog.id, quoteRequests.trimId))
    .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
    .innerJoin(brandsInCatalog, eq(brandsInCatalog.id, modelsInCatalog.brandId))
    .where(and(sql`${quoteRequests.createdAt} >= ${tstz(start)}`, sql`${quoteRequests.createdAt} < ${tstz(end)}`))
    .groupBy(brandsInCatalog.name)
    // 동수 브랜드의 순서가 세션마다 뒤바뀌지 않게 이름을 타이브레이커로 고정한다.
    .orderBy(desc(sql`count(*)`), asc(brandsInCatalog.name));
}
