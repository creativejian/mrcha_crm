import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";

import { nextSequenceCode, yymmKstOf } from "../../lib/business-code";
import { APP_QUOTE_REQUEST_SOURCE } from "../../../client/src/data/customers";
import { dedupedModelTrim } from "../../../client/src/lib/app-card-labels";
import { deliveryRegionOf, deliveryTimingTextOf } from "../../../client/src/lib/quote-delivery";
import { deriveNeedsFromRequest } from "../../../client/src/lib/quote-request-needs";
import { findSameNumberLinked, type LinkedPhoneCandidate } from "../../../client/src/lib/phone-duplicate";
import { brandsInCatalog, modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { profiles, quoteRequestOptions, quoteRequests } from "../public-app";
import { customers, quotes } from "../schema";
import { applyAppUserLink } from "./app-user-link";

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
  colorPreferenceMode: string | null;
  exteriorColorId: number | null;
  exteriorColorName: string | null;
  exteriorColorHex: string | null;
  interiorColorId: number | null;
  interiorColorName: string | null;
  interiorColorHex: string | null;
  // 출고 정보는 **서버에서 파생해 보낸다**(원본 지역 5필드 중 클라는 1개만 쓰고, 같은 파생을 업무 AI 청크도
  // 쓰기 때문 — quote-delivery.ts가 SSOT). 컬러가 원본 전달인 것과 다른 선택이니 복붙 주의.
  deliveryRegion: string | null;
  deliveryTimingText: string | null;
  requestTopicCodes: string[];
  additionalRequest: string | null;
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
  // none일 때만 채우는 같은 이름 미연결 고객 후보(예방용 제안 — 자동 연결 아님). 그 외 매칭은 빈 배열.
  nameMatches: { id: string; name: string; code: string }[];
  // 같은 번호를 인증한 **다른 계정**의 연결 고객(경고 표시 전용 — client/src/lib/phone-duplicate.ts SSOT).
  sameNumberLinked: { id: string; name: string; code: string }[];
};

// 이름 매칭 정규화 — 클라 consultation-inbox.normalizeName와 동일 규칙(공유 모듈은 import 경계상 미도입).
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// 헬퍼/두 함수 공통 base row(rows 조회 결과 1행). 아래 quoteRequestBaseSelect와 컬럼이 1:1로 맞아야 한다
// (select에 컬럼을 더하면 이 타입에도 추가할 것 — 안 그러면 헬퍼에서 그 컬럼이 안 보임).
export type QuoteRequestBaseRow = {
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
  colorPreferenceMode: string | null;
  exteriorColorId: number | null;
  exteriorColorName: string | null;
  exteriorColorHex: string | null;
  interiorColorId: number | null;
  interiorColorName: string | null;
  interiorColorHex: string | null;
  // 출고 원본(파생 재료) — 응답에는 파생값만 나간다. registration_region_mode·예약 2필드는
  // 소비처가 없어 select에서도 뺐다(저장 가능한 값이 'different'|null뿐이라 분기에 못 쓴다).
  deliveryRegionCode: string | null;
  deliveryRegionName: string | null;
  registrationRegionCode: string | null;
  registrationRegionName: string | null;
  deliveryTimingMode: string | null;
  deliveryTimingReferenceMonth: string | null;
  deliveryTargetMonth: string | null;
  requestTopicCodes: string[];
  additionalRequest: string | null;
  requesterName: string | null;
  requesterPhone: string | null;
};

// rows(요청+요청자) → catalog(차량명)·options·customers(매칭)·quotes(승격 역참조) batch read + map.
// listQuoteRequests(전체)와 listQuoteRequestsByUser(user 필터)가 공유 — rows만 다르게 넣는다.
export async function buildAppQuoteRequestRows(
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
  const names = [...new Set(rows.map((r) => r.requesterName).filter((v): v is string => v != null))];

  const [trimRows, optRows, custRows, promoRows, linkedPhoneRows] = await Promise.all([
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
          names.length ? inArray(customers.name, names) : undefined,
        ),
      ),
    executor
      .select({ id: quotes.id, sourceId: quotes.sourceQuoteRequestId, createdAt: quotes.createdAt })
      .from(quotes)
      .where(inArray(quotes.sourceQuoteRequestId, reqIds))
      .orderBy(desc(quotes.createdAt)),
    // 같은 번호 "연결 고객" 후보(경고 축 — phone-duplicate.ts 주석 참조): 연결 고객의 번호는
    // customers.phone이 아니라 profiles에만 있어(CHECK 배타) 위 custRows 매칭으로는 못 잡는다.
    // 요청자 번호(profiles 유래)와 같은 번호를 인증한 **다른 계정**의 연결 고객을 여기서 찾는다.
    phones.length
      ? executor
          .select({
            id: customers.id,
            name: customers.name,
            code: customers.customerCode,
            appUserId: customers.appUserId,
            phoneDigits: profiles.phoneNumber,
          })
          .from(customers)
          .innerJoin(profiles, eq(profiles.id, customers.appUserId))
          .where(inArray(profiles.phoneNumber, phones))
      : Promise.resolve(
          [] as { id: string; name: string; code: string; appUserId: string | null; phoneDigits: string | null }[],
        ),
  ]);

  const trimMap = new Map(trimRows.map((t) => [t.id, t]));

  // innerJoin(profiles.id = customers.app_user_id)이라 appUserId는 실제로 non-null — 타입만 좁힌다.
  const linkedPhoneCandidates: LinkedPhoneCandidate[] = linkedPhoneRows.flatMap((c) =>
    c.appUserId ? [{ id: c.id, name: c.name, code: c.code, appUserId: c.appUserId, phoneDigits: c.phoneDigits }] : [],
  );

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
  const custByNameUnlinked = new Map<string, { id: string; name: string; code: string }[]>();
  // 같은 phone/appUserId를 가진 고객이 여럿이면 마지막 행 우선(표시용 read, 기능 무관)
  for (const c of custRows) {
    const entry = { id: c.id, name: c.name, code: c.code };
    // phone 후보 = 앱 미연결 고객만(2026-07-17 spec §3-6). CHECK 불변식상 연결 고객은 phone이
    // NULL이라 자동 성립하지만, 의미를 코드에 명시한다(연결 고객은 app_user_id가 확정 매칭).
    if (c.phone && !c.appUserId) custByPhone.set(c.phone, entry);
    if (c.appUserId) custByAppUser.set(c.appUserId, entry);
    // 이름 매칭 후보도 미연결 고객만(중복 고객 예방 제안 — 이미 연결된 고객은 다른 앱 유저로 붙을 수 없다).
    if (!c.appUserId) {
      const nameKey = normalizeName(c.name);
      if (nameKey) {
        const list = custByNameUnlinked.get(nameKey) ?? [];
        list.push(entry);
        custByNameUnlinked.set(nameKey, list);
      }
    }
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
      colorPreferenceMode: r.colorPreferenceMode,
      exteriorColorId: r.exteriorColorId,
      exteriorColorName: r.exteriorColorName,
      exteriorColorHex: r.exteriorColorHex,
      interiorColorId: r.interiorColorId,
      interiorColorName: r.interiorColorName,
      interiorColorHex: r.interiorColorHex,
      deliveryRegion: deliveryRegionOf(r),
      deliveryTimingText: deliveryTimingTextOf(
        r.deliveryTimingMode,
        r.deliveryTimingReferenceMonth,
        r.deliveryTargetMonth,
      ),
      requestTopicCodes: r.requestTopicCodes,
      additionalRequest: r.additionalRequest,
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
      nameMatches:
        matchType === "none" && r.requesterName
          ? (custByNameUnlinked.get(normalizeName(r.requesterName)) ?? [])
              .slice()
              .sort((a, b) => a.code.localeCompare(b.code))
          : [],
      // 같은 번호를 인증한 다른 계정의 연결 고객(경고 표시 전용 — 연결 액션 불가, phone-duplicate.ts).
      sameNumberLinked: findSameNumberLinked(r.requesterPhone, r.userId, linkedPhoneCandidates),
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
  colorPreferenceMode: quoteRequests.colorPreferenceMode,
  exteriorColorId: quoteRequests.exteriorColorId,
  exteriorColorName: quoteRequests.exteriorColorName,
  exteriorColorHex: quoteRequests.exteriorColorHex,
  interiorColorId: quoteRequests.interiorColorId,
  interiorColorName: quoteRequests.interiorColorName,
  interiorColorHex: quoteRequests.interiorColorHex,
  deliveryRegionCode: quoteRequests.deliveryRegionCode,
  deliveryRegionName: quoteRequests.deliveryRegionName,
  registrationRegionCode: quoteRequests.registrationRegionCode,
  registrationRegionName: quoteRequests.registrationRegionName,
  deliveryTimingMode: quoteRequests.deliveryTimingMode,
  deliveryTimingReferenceMonth: quoteRequests.deliveryTimingReferenceMonth,
  deliveryTargetMonth: quoteRequests.deliveryTargetMonth,
  requestTopicCodes: quoteRequests.requestTopicCodes,
  additionalRequest: quoteRequests.additionalRequest,
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
  // 승격 워크벤치 프리필용 컬러 id(selected일 때만 non-null — DB가 그 경우만 저장). 클라가 catalog에서 id 매칭.
  exteriorColorId: number | null;
  interiorColorId: number | null;
  // 앱카드 "고객 지역" 1순위 소스(계약 D6). payment_method 분기까지 끝낸 결론 1개 —
  // 워크벤치는 customerRegionOf(이 값, 거주지)로 3단 폴백을 완성한다.
  deliveryRegion: string | null;
};

// prefill용 단건 조회. 요청 1행 + 옵션(trim_option_id) 배열. 없으면 null.
// ownerUserId(배치 12 K1): 소유권 WHERE — 전달 시 그 유저의 요청만 반환(불일치 = null = 라우트 404).
// 프리필 라우트가 customers 하위로 이사하면서 "그 고객 소유 요청"만 프리필되게 계약을 좁혔다.
export async function getQuoteRequestDetail(
  requestId: string,
  executor: Executor = getDefaultDb(),
  ownerUserId?: string,
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
      exteriorColorId: quoteRequests.exteriorColorId,
      interiorColorId: quoteRequests.interiorColorId,
      deliveryRegionCode: quoteRequests.deliveryRegionCode,
      deliveryRegionName: quoteRequests.deliveryRegionName,
      registrationRegionCode: quoteRequests.registrationRegionCode,
      registrationRegionName: quoteRequests.registrationRegionName,
    })
    .from(quoteRequests)
    .where(
      ownerUserId === undefined
        ? eq(quoteRequests.id, requestId)
        : and(eq(quoteRequests.id, requestId), eq(quoteRequests.userId, ownerUserId)),
    );
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
    exteriorColorId: req.exteriorColorId,
    interiorColorId: req.interiorColorId,
    deliveryRegion: deliveryRegionOf(req),
  };
}

// 다음 고객 코드 CU-YYMM-#### (KST 현재월 기준, 기존 최대 시퀀스 +1). customer_code UNIQUE라 서버가 canonical 생성.
// 공통 로직은 lib/business-code.ts(nextQuoteCode와 공유).
export async function nextCustomerCode(ex: Executor = getDefaultDb()): Promise<string> {
  const prefix = `CU-${yymmKstOf()}-`;
  const rows = await ex.select({ code: customers.customerCode }).from(customers).where(like(customers.customerCode, `${prefix}%`));
  return nextSequenceCode(prefix, rows.map((r) => r.code));
}

// 승격/연결 시점 임베딩 훅용 — 해당 앱 유저의 요청 id 전부(요청 청크는 고객 연결이 생겨야 적재 가능).
export async function listQuoteRequestIdsByUser(appUserId: string, ex: Executor = getDefaultDb()): Promise<string[]> {
  const rows = await ex.select({ id: quoteRequests.id }).from(quoteRequests).where(eq(quoteRequests.userId, appUserId));
  return rows.map((r) => r.id);
}

// 대표 견적요청에서 need_* 파생에 필요한 컬럼(승격 두 경로 + 대표 지정이 공유하는 select 조각).
// 파생 규칙 자체는 client/src/lib/quote-request-needs.ts가 SSOT다.
const requestNeedsSelect = {
  paymentMethod: quoteRequests.paymentMethod,
  period: quoteRequests.period,
  depositType: quoteRequests.depositType,
  depositRatio: quoteRequests.depositRatio,
  rentalDeposit: quoteRequests.rentalDeposit,
  annualMileageKm: quoteRequests.annualMileageKm,
  deliveryTimingMode: quoteRequests.deliveryTimingMode,
  deliveryTimingReferenceMonth: quoteRequests.deliveryTimingReferenceMonth,
  deliveryTargetMonth: quoteRequests.deliveryTargetMonth,
} as const;

// 대표 요청의 차량(catalog 조인) — needTrimId(진짜 링크) + needModel·needTrim(표시용 스냅샷).
// ⚠️ trim_id를 **버리지 않는다**(2026-07-24): 앱 견적요청은 원래 trim_id를 갖고 오는데 구 구현은
// 텍스트 2개만 남겨 링크를 잃었다. id가 있어야 니즈 → 견적 프리필·트림명 변경 추종이 된다.
// 트림이 catalog에서 사라졌으면(조인 실패) 셋 다 null — FK가 SET NULL로 정리하는 것과 같은 결.
async function vehicleNeedsOf(
  trimId: number | null,
  ex: Executor,
): Promise<{ needTrimId: number | null; needModel: string | null; needTrim: string | null }> {
  if (trimId == null) return { needTrimId: null, needModel: null, needTrim: null };
  const [t] = await ex
    .select({ trimName: trimsInCatalog.trimName, modelName: modelsInCatalog.name, brandName: brandsInCatalog.name })
    .from(trimsInCatalog)
    .leftJoin(modelsInCatalog, eq(trimsInCatalog.modelId, modelsInCatalog.id))
    .leftJoin(brandsInCatalog, eq(modelsInCatalog.brandId, brandsInCatalog.id))
    .where(eq(trimsInCatalog.id, trimId));
  if (!t) return { needTrimId: null, needModel: null, needTrim: null };
  return {
    needTrimId: trimId,
    needModel: [t.brandName, t.modelName].filter(Boolean).join(" ") || null,
    needTrim: t.trimName,
  };
}

// 그 앱 유저의 최초 견적요청 id(기본 대표 — 설계 D1). 요청이 0건이면 null(상담신청으로만 연결된 고객).
async function firstRequestIdOf(appUserId: string, ex: Executor): Promise<string | null> {
  const [row] = await ex
    .select({ id: quoteRequests.id })
    .from(quoteRequests)
    .where(eq(quoteRequests.userId, appUserId))
    .orderBy(asc(quoteRequests.createdAt))
    .limit(1);
  return row?.id ?? null;
}

// 그 앱 유저의 **최초 요청**을 대표로 지정하고 니즈를 파생한다(설계 D1의 기본 대표).
// 요청이 0건이면 아무 것도 하지 않는다 — 파생 소스가 없으니 대표는 null로 남아야 하고, 그래야
// 상담사가 니즈를 수기로 계속 쓸 수 있다(설계 D2 · PATCH 409 게이트의 판정 기준이 이 컬럼이다).
// ⚠️ **앱 계정을 고객에 붙이는 모든 경로**가 이걸 불러야 한다 — 견적요청 인박스만 부르고 상담신청
// 인박스가 빠져 있어, 요청을 가진 유저를 상담신청 쪽에서 연결하면 ⭐가 어디에도 안 켜지고 니즈가
// 옛 수기값으로 남았다(2026-07-25). 복붙 대신 이 함수를 부를 것.
export async function featureFirstRequestOf(customerId: string, appUserId: string, ex: Executor): Promise<void> {
  const firstId = await firstRequestIdOf(appUserId, ex);
  if (firstId) await applyFeaturedRequestNeeds(customerId, firstId, ex);
}

// 고객의 need_* 7필드를 대표 요청 값으로 **덮어쓴다**(설계 D5 — 비파괴 아님).
// 구 fillNeedTimingIfEmpty("빈 칸일 때만")를 대체한다: read-only 전환(D2·D7) 후에는 남겨둔 수기값을
// 상담사가 고칠 수 없게 되므로, 대표가 정해지면 파생값이 정본이다.
// ⚠️ 값이 없는 필드도 null로 덮는다 — 빈 칸이 정상 상태이고(앱은 구매방식·기간·보증금을 건너뛴 채
//    제출할 수 있다), 이전 대표의 잔값이 남으면 화면에서 출처가 섞인다.
export async function applyFeaturedRequestNeeds(customerId: string, requestId: string, ex: Executor): Promise<void> {
  const [req] = await ex
    .select({ trimId: quoteRequests.trimId, ...requestNeedsSelect })
    .from(quoteRequests)
    .where(eq(quoteRequests.id, requestId));
  if (!req) return;
  const vehicle = await vehicleNeedsOf(req.trimId, ex);
  await ex
    .update(customers)
    // updated_at은 DB 시계로만(2026-07-23 #334·#335) — 앱 시계로 찍으면 "마지막 활동"이 과거로 되돌아간다.
    .set({ ...vehicle, ...deriveNeedsFromRequest(req), featuredRequestId: requestId, updatedAt: sql`now()` })
    .where(eq(customers.id, customerId));
}

// 대표 견적요청 지정(설계 D1) — need_* 7필드가 이 요청 값으로 갱신된다.
// 요청이 그 고객의 것이 아니면 null을 준다: 남의 요청으로 남의 니즈를 덮는 것을 **쿼리에서** 막는다
// (라우트 파라미터 2개가 서로 무관하게 올 수 있으므로 표현 계층에 맡기지 않는다 —
//  프리필 라우트가 소유권 WHERE로 구 라우트의 느슨함을 닫은 것과 같은 축).
// 응답에 **갱신된 파생값을 그대로 실어 보낸다** — 클라가 상세를 다시 받지 않고 즉시 화면에 반영할 수
// 있다. prod는 CF Workers → Hyperdrive → Supabase 왕복이라 "지정 POST → 상세 GET" 두 번이 순차로
// 돌면 1초 넘게 걸려 눈에 띄는 딜레이가 생겼다(로컬은 수십 ms라 안 보였다 — 2026-07-24 유슨생 실기).
export type FeaturedNeedsResult = {
  id: string;
  featuredRequestId: string;
  needModel: string | null;
  needTrim: string | null;
  needMethod: string | null;
  needContractTerm: string | null;
  needInitialCost: string | null;
  needAnnualMileage: string | null;
  needTiming: string | null;
};

export async function setFeaturedRequest(
  requestId: string,
  customerId: string,
  ex: Executor = getDefaultDb(),
): Promise<FeaturedNeedsResult | null> {
  const [req] = await ex.select({ userId: quoteRequests.userId }).from(quoteRequests).where(eq(quoteRequests.id, requestId));
  if (!req) return null;
  const [customer] = await ex.select({ appUserId: customers.appUserId }).from(customers).where(eq(customers.id, customerId));
  if (!customer || customer.appUserId !== req.userId) return null;
  await applyFeaturedRequestNeeds(customerId, requestId, ex);
  // 파생 규칙을 클라에서 재현하지 않고 **UPDATE 결과를 되읽어** 보낸다(같은 트랜잭션이라 방금 쓴 값).
  // 재현하면 규칙이 두 벌이 되고, 특히 차종·트림은 catalog 조인이라 클라가 계산할 수도 없다.
  const [row] = await ex
    .select({
      needModel: customers.needModel,
      needTrim: customers.needTrim,
      needMethod: customers.needMethod,
      needContractTerm: customers.needContractTerm,
      needInitialCost: customers.needInitialCost,
      needAnnualMileage: customers.needAnnualMileage,
      needTiming: customers.needTiming,
    })
    .from(customers)
    .where(eq(customers.id, customerId));
  return { id: customerId, featuredRequestId: requestId, ...row };
}

// 요청의 user_id를 대상 고객의 app_user_id에 set(전화 매칭된 기존 고객 연결). 요청/고객 없으면 null.
// appUserId는 라우트의 요청 청크 임베딩 훅용(응답 JSON에 실려도 무해한 식별자).
// 가드+전화번호 전이+UPDATE는 applyAppUserLink SSOT(상담신청 link와 완전 공유 — 2026-07-17 spec).
export async function linkRequestToCustomer(
  requestId: string,
  customerId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string; customerCode: string; name: string; appUserId: string; droppedPhone: string | null } | null> {
  const [req] = await ex
    .select({ userId: quoteRequests.userId })
    .from(quoteRequests)
    .where(eq(quoteRequests.id, requestId));
  if (!req) return null;
  const linked = await applyAppUserLink(req.userId, customerId, ex);
  // 연결이 실제로 성립한 뒤에만 대표를 정한다(가드가 막으면 applyAppUserLink가 던지거나 null).
  // ⚠️ 대표는 **그 유저의 최초 요청**이지 지금 연결한 이 요청이 아니다(설계 D1 — 기본 대표 = 최초 요청).
  if (linked) await featureFirstRequestOf(linked.id, req.userId, ex);
  return linked;
}

// profiles + 요청 데이터로 신규 customers INSERT(app_user_id 연결). 같은 user로 이미 고객 있으면 기존 반환(중복 방지).
// 요청 없으면 null. 라우트가 transaction으로 감싸 호출(ex=tx) — 채번+insert 원자성.
export async function createCustomerFromRequest(
  requestId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string; customerCode: string; name: string; appUserId: string } | null> {
  const [req] = await ex
    .select({ userId: quoteRequests.userId, createdAt: quoteRequests.createdAt })
    .from(quoteRequests)
    .where(eq(quoteRequests.id, requestId));
  if (!req) return null;

  const [existing] = await ex
    .select({ id: customers.id, customerCode: customers.customerCode, name: customers.name, featuredRequestId: customers.featuredRequestId })
    .from(customers)
    .where(eq(customers.appUserId, req.userId));
  // 기존 고객이면 새로 만들지 않는다(중복 방지). 대표가 **아직 없을 때만** 최초 요청으로 정한다 —
  // 상담사가 star로 고른 대표를 승격 버튼이 되돌리면 안 된다(설계 D1, 유슨생 확인).
  if (existing) {
    if (!existing.featuredRequestId) await featureFirstRequestOf(existing.id, req.userId, ex);
    return { id: existing.id, customerCode: existing.customerCode, name: existing.name, appUserId: req.userId };
  }

  const [profile] = await ex
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, req.userId));

  const customerCode = await nextCustomerCode(ex);
  const [row] = await ex
    .insert(customers)
    .values({
      customerCode,
      name: profile?.fullName ?? "이름미상",
      // phone 미저장(2026-07-17 spec §3-5) — 앱 연결 고객의 주 번호는 profiles read-through 합성이
      // 담당한다(복사 스냅샷은 앱에서 번호가 바뀌는 순간 스테일). CHECK 불변식도 이걸 강제.
      phone: null,
      appUserId: req.userId,
      source: APP_QUOTE_REQUEST_SOURCE,
      statusGroup: "신규",
      status: "상담접수",
      receivedAt: new Date(req.createdAt),
    })
    .returning({ id: customers.id, customerCode: customers.customerCode, name: customers.name });
  // 대표 = **그 유저의 최초 요청**이다(설계 D1) — 승격을 누른 이 요청이 아니다. 인박스에서 최신 요청
  // 카드로 승격할 수도 있어서, 승격 요청을 대표로 삼으면 link·기존 고객 경로와 규칙이 갈린다.
  // 방금 만든 고객이라 덮을 수기값이 없다(D5 덮어쓰기 주의사항이 여기엔 해당 없음).
  await applyFeaturedRequestNeeds(row.id, (await firstRequestIdOf(req.userId, ex)) ?? requestId, ex);
  return { ...row, appUserId: req.userId };
}

// ── 담당자 확인(2단계) 전이 ────────────────────────────────────────────────────
//
// 이사님 요청(2026-07-27): CRM에서 그 요청의 "견적 작성"을 **처음 여는 순간**을 담당자 확인 사건으로
// 잡는다. 버튼 클릭마다 푸시하는 대신 `confirmed_at`을 **한 번만** 채우고 그 최초 전이에서만 알림을
// 보낸다 — 그래야 앱 2단계 표시(reviewing)와 푸시 중복 방지가 같은 사실 하나를 근거로 쓴다.
//
// 멱등의 근거는 조건절 `confirmed_at IS NULL`이다. "견적 작성"과 "추가 작성"이 클라에서 같은 핸들러라
// 재진입·재클릭이 흔한데, 두 번째부터는 UPDATE가 0행이 되어 `firstConfirm: false`로 떨어진다.
// (앱 계약: 단조 값 — 되돌리지 않는다. ref/2026-07-27-app-quote-request-confirmed-request.md)
export type QuoteRequestConfirmResult = {
  firstConfirm: boolean; // true일 때만 호출부가 푸시한다
  appUserId: string;
  vehicleLabel: string; // 푸시 body — "<브랜드> · <모델 트림>"
};

export async function confirmQuoteRequest(
  requestId: string,
  customerId: string,
  ex: Executor = getDefaultDb(),
): Promise<QuoteRequestConfirmResult | null> {
  // 소유권 검증은 setFeaturedRequest와 같은 축 — 파라미터 2개가 서로 무관하게 올 수 있다.
  const [req] = await ex
    .select({ userId: quoteRequests.userId, trimId: quoteRequests.trimId })
    .from(quoteRequests)
    .where(eq(quoteRequests.id, requestId));
  if (!req) return null;
  const [customer] = await ex.select({ appUserId: customers.appUserId }).from(customers).where(eq(customers.id, customerId));
  if (!customer || customer.appUserId !== req.userId) return null;

  // ⚠️ 시각은 DB 시계(now())로 찍는다 — 앱 시계와 어긋나면 앱이 보는 확인 시점이 뒤로 갈 수 있다
  //    (updated-at-clock-guard와 같은 축).
  const changed = await ex
    .update(quoteRequests)
    .set({ confirmedAt: sql`now()` })
    .where(and(eq(quoteRequests.id, requestId), sql`${quoteRequests.confirmedAt} is null`))
    .returning({ id: quoteRequests.id });

  return {
    firstConfirm: changed.length > 0,
    appUserId: req.userId,
    vehicleLabel: await vehicleLabelOfTrim(req.trimId, ex),
  };
}

// 푸시 body "<브랜드> · <모델 트림>". 트림명이 모델명을 접두로 포함하면 중복을 지운다(앱카드 어휘와 동일 규칙).
// 차량을 못 찾으면 빈 문자열 — 호출부가 그때는 body 없이 보낸다(알림 자체를 막지는 않는다).
async function vehicleLabelOfTrim(trimId: number | null, ex: Executor): Promise<string> {
  if (trimId == null) return "";
  const [t] = await ex
    .select({
      trimName: trimsInCatalog.trimName,
      modelName: modelsInCatalog.name,
      brandName: brandsInCatalog.name,
    })
    .from(trimsInCatalog)
    .leftJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
    .leftJoin(brandsInCatalog, eq(brandsInCatalog.id, modelsInCatalog.brandId))
    .where(eq(trimsInCatalog.id, trimId));
  if (!t) return "";
  const vehicle = dedupedModelTrim(t.modelName, t.trimName);
  return [t.brandName, vehicle].filter(Boolean).join(" · ");
}
