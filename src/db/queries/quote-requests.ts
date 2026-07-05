import { desc, eq, inArray, like, or } from "drizzle-orm";

import { nextSequenceCode, yymmKstOf } from "../../lib/business-code";
import { brandsInCatalog, modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { profiles, quoteRequestOptions, quoteRequests } from "../public-app";
import { customers, quotes } from "../schema";

export type AppQuoteRequestRow = {
  id: string;
  createdAt: string;
  requesterName: string | null;
  requesterPhone: string | null;
  paymentMethod: string | null;
  period: number | null;
  depositType: string | null;
  depositRatio: number | null;
  rentalDeposit: number | null;
  trimPrice: number | null;
  status: string | null;
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  optionCount: number;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  matchedCustomerCode: string | null;
  promotedQuoteCount: number;
  promotedQuoteIds: string[];
  matchType: "app_user" | "phone" | "none";
};

// 헬퍼/두 함수 공통 base row(rows 조회 결과 1행). 아래 quoteRequestBaseSelect와 컬럼이 1:1로 맞아야 한다
// (select에 컬럼을 더하면 이 타입에도 추가할 것 — 안 그러면 헬퍼에서 그 컬럼이 안 보임).
type QuoteRequestBaseRow = {
  id: string;
  createdAt: string;
  userId: string;
  trimId: number | null;
  paymentMethod: string | null;
  period: number | null;
  depositType: string | null;
  depositRatio: number | null;
  rentalDeposit: number | null;
  trimPrice: number | null;
  status: string | null;
  requesterName: string | null;
  requesterPhone: string | null;
};

// rows(요청+요청자) → catalog(차량명)·options·customers(매칭)·quotes(승격 역참조) batch read + map.
// listQuoteRequests(전체)와 listQuoteRequestsByUser(user 필터)가 공유 — rows만 다르게 넣는다.
async function buildAppQuoteRequestRows(
  rows: QuoteRequestBaseRow[],
  executor: Executor,
): Promise<AppQuoteRequestRow[]> {
  if (rows.length === 0) return [];

  // trims(차량명)·options(개수)·customers(매칭)·quotes(승격 역참조)는 rows에만 의존해 서로 독립.
  // CF(Hyperdrive)는 왕복당 RTT가 커서 직렬 4왕복이 느리다 → Promise.all로 병렬화.
  const trimIds = [...new Set(rows.map((r) => r.trimId).filter((v): v is number => v != null))];
  const reqIds = rows.map((r) => r.id);
  const phones = [...new Set(rows.map((r) => r.requesterPhone).filter((v): v is string => v != null))];
  // userId는 schema에서 notNull + 위 early-return 이후라 항상 1개 이상 → or()가 빈 WHERE를 만들지 않음(customers 전체 스캔 방지)
  const userIds = [...new Set(rows.map((r) => r.userId))];

  const [trimRows, optRows, custRows, promoRows] = await Promise.all([
    trimIds.length
      ? executor
          .select({
            id: trimsInCatalog.id,
            trimName: trimsInCatalog.trimName,
            modelName: modelsInCatalog.name,
            brandName: brandsInCatalog.name,
          })
          .from(trimsInCatalog)
          .leftJoin(modelsInCatalog, eq(trimsInCatalog.modelId, modelsInCatalog.id))
          .leftJoin(brandsInCatalog, eq(modelsInCatalog.brandId, brandsInCatalog.id))
          .where(inArray(trimsInCatalog.id, trimIds))
      : Promise.resolve(
          [] as { id: number; trimName: string | null; modelName: string | null; brandName: string | null }[],
        ),
    executor
      .select({ quoteRequestId: quoteRequestOptions.quoteRequestId })
      .from(quoteRequestOptions)
      .where(inArray(quoteRequestOptions.quoteRequestId, reqIds)),
    executor
      .select({
        id: customers.id,
        name: customers.name,
        code: customers.customerCode,
        phone: customers.phone,
        appUserId: customers.appUserId,
      })
      .from(customers)
      .where(
        or(
          phones.length ? inArray(customers.phone, phones) : undefined,
          userIds.length ? inArray(customers.appUserId, userIds) : undefined,
        ),
      ),
    executor
      .select({ id: quotes.id, sourceId: quotes.sourceQuoteRequestId, createdAt: quotes.createdAt })
      .from(quotes)
      .where(inArray(quotes.sourceQuoteRequestId, reqIds))
      .orderBy(desc(quotes.createdAt)),
  ]);

  const trimMap = new Map(trimRows.map((t) => [t.id, t]));

  const optCount = new Map<string, number>();
  for (const o of optRows) optCount.set(o.quoteRequestId, (optCount.get(o.quoteRequestId) ?? 0) + 1);

  // promoRows는 createdAt desc로 이미 정렬돼 있어(위 orderBy), req별로 순서대로 push하면 최신 우선 배열이 된다.
  const promoIdsByReq = new Map<string, string[]>();
  for (const p of promoRows) {
    if (!p.sourceId) continue;
    const ids = promoIdsByReq.get(p.sourceId) ?? [];
    ids.push(p.id);
    promoIdsByReq.set(p.sourceId, ids);
  }

  // 매칭: app_user_id 직접연결 > phone 일치 (둘 다 표시용 read)
  const custByPhone = new Map<string, { id: string; name: string; code: string }>();
  const custByAppUser = new Map<string, { id: string; name: string; code: string }>();
  // 같은 phone/appUserId를 가진 고객이 여럿이면 마지막 행 우선(표시용 read, 기능 무관)
  for (const c of custRows) {
    const entry = { id: c.id, name: c.name, code: c.code };
    if (c.phone) custByPhone.set(c.phone, entry);
    if (c.appUserId) custByAppUser.set(c.appUserId, entry);
  }

  return rows.map((r) => {
    const t = r.trimId != null ? trimMap.get(r.trimId) : undefined;
    const byApp = custByAppUser.get(r.userId);
    const byPhone = r.requesterPhone ? custByPhone.get(r.requesterPhone) : undefined;
    const matched = byApp ?? byPhone ?? null;
    const matchType: AppQuoteRequestRow["matchType"] = byApp ? "app_user" : byPhone ? "phone" : "none";
    const promotedQuoteIds = promoIdsByReq.get(r.id) ?? [];
    return {
      id: r.id,
      createdAt: r.createdAt,
      requesterName: r.requesterName,
      requesterPhone: r.requesterPhone,
      paymentMethod: r.paymentMethod,
      period: r.period,
      depositType: r.depositType,
      depositRatio: r.depositRatio,
      rentalDeposit: r.rentalDeposit,
      trimPrice: r.trimPrice,
      status: r.status,
      brandName: t?.brandName ?? null,
      modelName: t?.modelName ?? null,
      trimName: t?.trimName ?? null,
      optionCount: optCount.get(r.id) ?? 0,
      matchedCustomerId: matched?.id ?? null,
      matchedCustomerName: matched?.name ?? null,
      matchedCustomerCode: matched?.code ?? null,
      promotedQuoteCount: promotedQuoteIds.length,
      promotedQuoteIds,
      matchType,
    };
  });
}

// rows 조회 공통 select 컬럼(전체/필터 동일). where만 호출부에서 더한다.
const quoteRequestBaseSelect = {
  id: quoteRequests.id,
  createdAt: quoteRequests.createdAt,
  userId: quoteRequests.userId,
  trimId: quoteRequests.trimId,
  paymentMethod: quoteRequests.paymentMethod,
  period: quoteRequests.period,
  depositType: quoteRequests.depositType,
  depositRatio: quoteRequests.depositRatio,
  rentalDeposit: quoteRequests.rentalDeposit,
  trimPrice: quoteRequests.trimPrice,
  status: quoteRequests.status,
  requesterName: profiles.fullName,
  requesterPhone: profiles.phoneNumber,
} as const;

// 앱 견적요청 인박스(읽기, 전체). public(요청+요청자) + catalog(차량명) + crm(매칭) 3스키마 batch read.
export async function listQuoteRequests(executor: Executor = getDefaultDb()): Promise<AppQuoteRequestRow[]> {
  const rows = await executor
    .select(quoteRequestBaseSelect)
    .from(quoteRequests)
    .leftJoin(profiles, eq(profiles.id, quoteRequests.userId))
    .orderBy(desc(quoteRequests.createdAt));
  return buildAppQuoteRequestRows(rows, executor);
}

// 한 고객(app_user_id)의 견적요청만. 고객 상세 니즈 영역 카드 목록용.
export async function listQuoteRequestsByUser(
  appUserId: string,
  executor: Executor = getDefaultDb(),
): Promise<AppQuoteRequestRow[]> {
  const rows = await executor
    .select(quoteRequestBaseSelect)
    .from(quoteRequests)
    .leftJoin(profiles, eq(profiles.id, quoteRequests.userId))
    .where(eq(quoteRequests.userId, appUserId))
    .orderBy(desc(quoteRequests.createdAt));
  return buildAppQuoteRequestRows(rows, executor);
}

export type QuoteRequestDetail = {
  id: string;
  trimId: number | null;
  paymentMethod: string | null;
  period: number | null;
  depositType: string | null;
  depositRatio: number | null;
  rentalDeposit: number | null;
  optionIds: number[];
};

// prefill용 단건 조회. 요청 1행 + 옵션(trim_option_id) 배열. 없으면 null.
export async function getQuoteRequestDetail(
  requestId: string,
  executor: Executor = getDefaultDb(),
): Promise<QuoteRequestDetail | null> {
  const [req] = await executor
    .select({
      id: quoteRequests.id,
      trimId: quoteRequests.trimId,
      paymentMethod: quoteRequests.paymentMethod,
      period: quoteRequests.period,
      depositType: quoteRequests.depositType,
      depositRatio: quoteRequests.depositRatio,
      rentalDeposit: quoteRequests.rentalDeposit,
    })
    .from(quoteRequests)
    .where(eq(quoteRequests.id, requestId));
  if (!req) return null;
  const opts = await executor
    .select({ optId: quoteRequestOptions.trimOptionId })
    .from(quoteRequestOptions)
    .where(eq(quoteRequestOptions.quoteRequestId, requestId));
  const optionIds = opts.map((o) => o.optId).filter((v): v is number => v != null);
  return {
    id: req.id,
    trimId: req.trimId,
    paymentMethod: req.paymentMethod,
    period: req.period,
    depositType: req.depositType,
    depositRatio: req.depositRatio,
    rentalDeposit: req.rentalDeposit,
    optionIds,
  };
}

// 다음 고객 코드 CU-YYMM-#### (KST 현재월 기준, 기존 최대 시퀀스 +1). customer_code UNIQUE라 서버가 canonical 생성.
// 공통 로직은 lib/business-code.ts(nextQuoteCode와 공유).
export async function nextCustomerCode(ex: Executor = getDefaultDb()): Promise<string> {
  const prefix = `CU-${yymmKstOf()}-`;
  const rows = await ex.select({ code: customers.customerCode }).from(customers).where(like(customers.customerCode, `${prefix}%`));
  return nextSequenceCode(prefix, rows.map((r) => r.code));
}

// payment_method 한글 — S1 프론트 PAYMENT_METHOD_LABEL과 동일 어휘. customers.need_method는 한글로 저장한다.
const NEED_METHOD_LABEL: Record<string, string> = {
  lease: "운용리스",
  rent: "장기렌트",
  installment: "할부",
  cash: "일시불",
};

// 요청의 user_id를 대상 고객의 app_user_id에 set(전화 매칭된 기존 고객 연결). 요청/고객 없으면 null.
export async function linkRequestToCustomer(
  requestId: string,
  customerId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string; customerCode: string; name: string } | null> {
  const [req] = await ex.select({ userId: quoteRequests.userId }).from(quoteRequests).where(eq(quoteRequests.id, requestId));
  if (!req) return null;
  const [row] = await ex
    .update(customers)
    .set({ appUserId: req.userId, updatedAt: new Date() })
    .where(eq(customers.id, customerId))
    .returning({ id: customers.id, customerCode: customers.customerCode, name: customers.name });
  return row ?? null;
}

// profiles + 요청 데이터로 신규 customers INSERT(app_user_id 연결). 같은 user로 이미 고객 있으면 기존 반환(중복 방지).
// 요청 없으면 null. 라우트가 transaction으로 감싸 호출(ex=tx) — 채번+insert 원자성.
export async function createCustomerFromRequest(
  requestId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string; customerCode: string; name: string } | null> {
  const [req] = await ex
    .select({
      userId: quoteRequests.userId,
      trimId: quoteRequests.trimId,
      paymentMethod: quoteRequests.paymentMethod,
      createdAt: quoteRequests.createdAt,
    })
    .from(quoteRequests)
    .where(eq(quoteRequests.id, requestId));
  if (!req) return null;

  const [existing] = await ex
    .select({ id: customers.id, customerCode: customers.customerCode, name: customers.name })
    .from(customers)
    .where(eq(customers.appUserId, req.userId));
  if (existing) return existing;

  const [profile] = await ex
    .select({ fullName: profiles.fullName, phoneNumber: profiles.phoneNumber })
    .from(profiles)
    .where(eq(profiles.id, req.userId));

  let needModel: string | null = null;
  let needTrim: string | null = null;
  if (req.trimId != null) {
    const [t] = await ex
      .select({ trimName: trimsInCatalog.trimName, modelName: modelsInCatalog.name, brandName: brandsInCatalog.name })
      .from(trimsInCatalog)
      .leftJoin(modelsInCatalog, eq(trimsInCatalog.modelId, modelsInCatalog.id))
      .leftJoin(brandsInCatalog, eq(modelsInCatalog.brandId, brandsInCatalog.id))
      .where(eq(trimsInCatalog.id, req.trimId));
    if (t) {
      needModel = [t.brandName, t.modelName].filter(Boolean).join(" ") || null;
      needTrim = t.trimName;
    }
  }

  const customerCode = await nextCustomerCode(ex);
  const [row] = await ex
    .insert(customers)
    .values({
      customerCode,
      name: profile?.fullName ?? "이름미상",
      phone: profile?.phoneNumber ?? null,
      appUserId: req.userId,
      needModel,
      needTrim,
      needMethod: req.paymentMethod ? (NEED_METHOD_LABEL[req.paymentMethod] ?? req.paymentMethod) : null,
      source: "앱 견적요청",
      statusGroup: "신규",
      status: "상담접수",
      receivedAt: new Date(req.createdAt),
    })
    .returning({ id: customers.id, customerCode: customers.customerCode, name: customers.name });
  return row;
}
