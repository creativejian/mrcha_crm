import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";

import {
  CONTRACTED_STATUS_GROUP,
  DELIVERY_SCHEDULE_TYPE,
  IN_PROGRESS_STATUS_GROUPS,
  REVENUE_BASIS_BY_PURCHASE_METHOD,
} from "../../../client/src/data/customers"; // 순수 상수 leaf(부작용 0) — 상태 어휘 SSOT 공유
import { monthRangeDate, monthRangeUtc, prevMonthKey } from "../../lib/report-month";
import { brandsInCatalog, modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { advisorQuotes, quoteRequests } from "../public-app";
import { customerDeliveries, customers, customerSchedules, quotes, quoteScenarios } from "../schema";

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
  // 실적(취급 규모) — 2026-08-03 이사님 확정. 귀속은 **계약 확정 달**(차량 인도일이 아니다 —
  // 현장 어휘로는 둘 다 "출고"라 부른다). 기간 지표라 스냅샷 지표와 달리 월 스코프가 정상 작동한다.
  // spec: ref/specs/2026-08-03-crm-delivery-revenue-design.md.
  delivery: {
    count: number;
    prevCount: number;
    leaseAmount: number;
    prevLeaseAmount: number;
    rentAmount: number;
    prevRentAmount: number;
  };
};

export async function getAdminReport(month: string, ex: Executor = getDefaultDb()): Promise<AdminReport> {
  const prev = prevMonthKey(month);
  const { start, end } = monthRangeUtc(month);
  const { start: prevStart, end: prevEnd } = monthRangeUtc(prev);

  const [customerAgg, quoteAgg, deliveryAgg, brandRows, deliveryRevenue] = await Promise.all([
    selectCustomerAggregate(ex, start, end, prevStart, prevEnd),
    selectQuoteAggregate(ex, start, end),
    selectDeliveryAggregate(ex),
    selectBrandInquiries(ex, start, end),
    selectDeliveryRevenue(ex, month, prev),
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
    delivery: deliveryRevenue,
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

// 실적(spec 2026-08-03) — 귀속 기준은 **계약 확정일**(`contract_confirmed_date`)이다.
//
// ⚠️ **차량 인도일(`delivered_date`)이 아니다.** 인도 후 상담사가 고객·금융사 사이에서 URL 인증을
// 마무리해야 수수료가 집계된다(이사님 2026-08-03). 보통 당일~일주일이지만 월을 넘기면 확정된 달의
// 실적이다 — 7월 출고·8월 확정 = **8월 실적**. 현장에서 그 확정을 "출고"라고 불러서(화면 라벨도
// "전체 출고") 처음엔 인도일로 잘못 구현했다(#432 → 이 커밋에서 정정).
//
// 확정 이후에는 조건이 바뀌지 않으므로(이사님) **금액을 스냅샷으로 굳히지 않고 계약 진행 견적에서
// 파생**한다 — 소급 변경 창이 원리적으로 닫혀 있다. 선택 규칙은 `contractingQuoteSummary`
// (queries/customers.ts)와 같은 축(고객당 최대 1건 실측). `source_quote_id`는 "프리필이 참조한 견적"
// 이라 의미가 달라 쓰지 않는다(스키마 주석 규약).
//
// 합산을 SQL이 아니라 JS에서 하는 이유: 구매방식별 산정 기준이 클라와 공유하는 상수
// (REVENUE_BASIS_BY_PURCHASE_METHOD)라 SQL에 리터럴을 복제하지 않기 위해서다. 월 수십 건 규모.
async function selectDeliveryRevenue(ex: Executor, month: string, prevMonth: string) {
  const cur = monthRangeDate(month);
  const prev = monthRangeDate(prevMonth);
  const rows = await ex
    .select({
      confirmedDate: customerDeliveries.contractConfirmedDate,
      // 계약 진행 견적 1건을 json으로 — 세 값을 각각 서브쿼리로 뽑으면 같은 견적을 세 번 훑는다.
      contractingQuote: sql<{
        purchaseMethod: string | null;
        acquisitionCost: number | null;
        finalVehiclePrice: number | null;
      } | null>`(
        select json_build_object(
          'purchaseMethod', (select s.purchase_method from ${quoteScenarios} s where s.id = q.primary_scenario_id),
          'acquisitionCost', q.acquisition_cost,
          'finalVehiclePrice', q.final_vehicle_price)
        from ${quotes} q
        where q.customer_id = ${customerDeliveries.customerId} and q.decision_status = 'contracting'
        order by q.updated_at desc, q.id desc
        limit 1
      )`,
    })
    .from(customerDeliveries)
    .where(
      and(
        isNotNull(customerDeliveries.contractConfirmedDate),
        // 두 달을 한 번에 가져와 JS에서 가른다(왕복 1회). date라 사전식 비교가 곧 날짜 비교다.
        gte(customerDeliveries.contractConfirmedDate, prev.start),
        lt(customerDeliveries.contractConfirmedDate, cur.end),
      ),
    );

  const zero = { count: 0, leaseAmount: 0, rentAmount: 0 };
  const tally = (from: string, to: string) =>
    rows.reduce((acc, row) => {
      const date = row.confirmedDate;
      if (!date || date < from || date >= to) return acc;
      // 대수는 **전 구매방식** 포함(금액만 갈린다 — spec §1a).
      acc.count += 1;
      const quote = row.contractingQuote;
      const basis = quote?.purchaseMethod ? REVENUE_BASIS_BY_PURCHASE_METHOD[quote.purchaseMethod] : undefined;
      if (basis === "acquisitionCost") acc.leaseAmount += quote?.acquisitionCost ?? 0;
      if (basis === "finalVehiclePrice") acc.rentAmount += quote?.finalVehiclePrice ?? 0;
      return acc;
    }, { ...zero });

  const current = tally(cur.start, cur.end);
  const previous = tally(prev.start, prev.end);
  return {
    count: current.count,
    prevCount: previous.count,
    leaseAmount: current.leaseAmount,
    prevLeaseAmount: previous.leaseAmount,
    rentAmount: current.rentAmount,
    prevRentAmount: previous.rentAmount,
  };
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
