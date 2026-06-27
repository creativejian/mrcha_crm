import { desc, eq, inArray, or } from "drizzle-orm";

import { brandsInCatalog, modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { profiles, quoteRequestOptions, quoteRequests } from "../public-app";
import { customers } from "../schema";

export type AppQuoteRequestRow = {
  id: string;
  createdAt: string;
  requesterName: string | null;
  requesterPhone: string | null;
  paymentMethod: string | null;
  period: number | null;
  depositType: string | null;
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
  matchType: "app_user" | "phone" | "none";
};

// 앱 견적요청 인박스(읽기). public(요청+요청자) + catalog(차량명) + crm(매칭) 3스키마를
// 단일 연결로 batch read. N+1 회피: trim/options/customers를 IN 묶음으로 한 번씩.
export async function listQuoteRequests(executor: Executor = getDefaultDb()): Promise<AppQuoteRequestRow[]> {
  // 1. 요청 + 요청자(profiles) — 최신순
  const rows = await executor
    .select({
      id: quoteRequests.id,
      createdAt: quoteRequests.createdAt,
      userId: quoteRequests.userId,
      trimId: quoteRequests.trimId,
      paymentMethod: quoteRequests.paymentMethod,
      period: quoteRequests.period,
      depositType: quoteRequests.depositType,
      rentalDeposit: quoteRequests.rentalDeposit,
      trimPrice: quoteRequests.trimPrice,
      status: quoteRequests.status,
      requesterName: profiles.fullName,
      requesterPhone: profiles.phoneNumber,
    })
    .from(quoteRequests)
    .leftJoin(profiles, eq(profiles.id, quoteRequests.userId))
    .orderBy(desc(quoteRequests.createdAt));

  if (rows.length === 0) return [];

  // 2. 차량명 batch (trim → model → brand)
  const trimIds = [...new Set(rows.map((r) => r.trimId).filter((v): v is number => v != null))];
  const trimRows = trimIds.length
    ? await executor
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
    : [];
  const trimMap = new Map(trimRows.map((t) => [t.id, t]));

  // 3. 옵션 개수 batch
  const reqIds = rows.map((r) => r.id);
  const optRows = await executor
    .select({ quoteRequestId: quoteRequestOptions.quoteRequestId })
    .from(quoteRequestOptions)
    .where(inArray(quoteRequestOptions.quoteRequestId, reqIds));
  const optCount = new Map<string, number>();
  for (const o of optRows) optCount.set(o.quoteRequestId, (optCount.get(o.quoteRequestId) ?? 0) + 1);

  // 4. 매칭: app_user_id 직접연결 > phone 일치 (둘 다 표시용 read)
  const phones = [...new Set(rows.map((r) => r.requesterPhone).filter((v): v is string => v != null))];
  // userId는 schema에서 notNull + 위 early-return 이후라 항상 1개 이상 → or()가 빈 WHERE를 만들지 않음(customers 전체 스캔 방지)
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const custByPhone = new Map<string, { id: string; name: string; code: string }>();
  const custByAppUser = new Map<string, { id: string; name: string; code: string }>();
  const custRows = await executor
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
    );
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
    return {
      id: r.id,
      createdAt: r.createdAt,
      requesterName: r.requesterName,
      requesterPhone: r.requesterPhone,
      paymentMethod: r.paymentMethod,
      period: r.period,
      depositType: r.depositType,
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
      matchType,
    };
  });
}
