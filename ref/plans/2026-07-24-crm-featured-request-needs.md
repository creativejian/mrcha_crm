# 대표 견적요청 기반 니즈 파생 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` 또는
> `superpowers:executing-plans`로 task 단위 실행. 체크박스(`- [ ]`)로 진행을 추적한다.

**Goal:** 앱 연결 고객의 니즈를 "상담사가 지정한 대표 견적요청 1건"에서 파생시켜, 최초 승격 값이 영원히
박제되는 스테일 문제를 없앤다.

**Architecture:** `crm.customers.featured_request_id`(대표 요청)를 추가하고, 대표 지정/최초 승격 시
`need_*` 7필드를 컬럼에 **복사(materialize)**한다. 소비처(목록·검색·AI 청크·상세)는 지금처럼 컬럼만 읽으므로
무변경이다. 파생 필드는 API에서 409로 쓰기를 막고, 앱이 값을 안 주는 4필드만 수기 편집을 유지한다.

**Tech Stack:** TypeScript 6.0.3 · Hono · drizzle-orm(schemaFilter `crm`) · React · Vitest · bun

**설계 SSOT:** `ref/specs/2026-07-24-crm-featured-quote-request-needs-design.md`
**문제 정의:** `ref/2026-07-24-customer-needs-staleness.md`

---

## 파일 구조

**신규**

| 파일 | 책임 |
|---|---|
| `client/src/lib/quote-request-needs.ts` | 앱 요청 → `need_*` 파생 **순수** 모듈(서버 공용). 계약기간·초기비용·연간 주행거리 변환 + 파생 필드 키 목록 |
| `client/src/lib/quote-request-needs.test.ts` | 위 모듈 유닛 테스트 |
| `drizzle/0037_*.sql` | `featured_request_id` 컬럼 |
| `src/scripts/backfill-featured-needs.ts` | 기존 앱 연결 고객 대표 지정 + 파생 백필 |

**수정**

| 파일 | 변경 |
|---|---|
| `src/db/schema.ts` | `featuredRequestId` 컬럼 |
| `src/db/queries/quote-requests.ts` | 파생 시드 개편 · `setFeaturedRequest` 추가 |
| `src/routes/quote-requests.ts` | 대표 지정 라우트 |
| `src/db/queries/customers.ts` | 상세 응답에 `featuredRequestId` |
| `src/routes/customers.ts` | 파생 7필드 PATCH 409 |
| `client/src/lib/customers.ts` | `featuredRequestId` 타입 |
| `client/src/lib/quote-requests.ts` | 카드에 `isFeatured` |
| `client/src/components/customer-detail/NeedsDashboard.tsx` | star 토글 |
| `client/src/components/customer-detail/hooks/useCustomerNeeds.ts` | 대표 지정 핸들러 |
| `client/src/components/customer-detail/hooks/useCustomerPurchase.ts` | read-only 분기 · 프리셋 |
| `client/src/components/customer-detail/purchase-meta.ts` | 프리셋 4종 |
| `AGENTS.md` | 서버 import 허용 순수 lib 목록에 `quote-request-needs.ts` 추가 |

**AGENTS.md 경계 규칙:** `client/src/lib/quote-request-needs.ts`는 http/supabase/React 체인이 없는
**부작용 0 순수 모듈**이라 서버가 import할 수 있다(`quote-delivery.ts`와 동일 성격). 이 파일에 절대
부작용을 넣지 말 것.

---

# PR ① — DB · 파생 모듈 · 승격 시드 · 백필

이것만 머지돼도 **신규 승격이 즉시 개선**된다(5필드가 채워진다).

## Task 1: 파생 순수 모듈

**Files:**
- Create: `client/src/lib/quote-request-needs.ts`
- Test: `client/src/lib/quote-request-needs.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// client/src/lib/quote-request-needs.test.ts
import { describe, expect, it } from "vitest";

import { annualMileageTextOf, contractTermTextOf, deriveNeedsFromRequest, initialCostTextOf } from "./quote-request-needs";

describe("contractTermTextOf", () => {
  it("개월 수를 CRM 어휘로 바꾼다", () => {
    expect(contractTermTextOf(60)).toBe("60개월");
    expect(contractTermTextOf(36)).toBe("36개월");
  });

  it("값이 없으면 null", () => {
    expect(contractTermTextOf(null)).toBeNull();
  });
});

describe("annualMileageTextOf", () => {
  it("km 정수를 CRM 어휘로 바꾼다", () => {
    expect(annualMileageTextOf(20000)).toBe("20,000km");
    expect(annualMileageTextOf(30000)).toBe("30,000km");
  });

  it("값이 없으면 null", () => {
    expect(annualMileageTextOf(null)).toBeNull();
  });

  // CHECK 방어: 앱이 검증하지만(chat_quote_flow.dart:379) 어휘 밖 값이 오면 컬럼 CHECK가 INSERT를
  // 통째로 거부한다. 그 필드만 버리고 나머지 파생은 살린다.
  it("CRM 어휘에 없는 값은 null로 버린다", () => {
    expect(annualMileageTextOf(12000)).toBeNull();
  });
});

describe("initialCostTextOf", () => {
  it("무보증", () => {
    expect(initialCostTextOf("none", null, null)).toBe("무보증");
  });

  it("비율이 있으면 비율 우선", () => {
    expect(initialCostTextOf("deposit", 30, 11800000)).toBe("보증금 30%");
    expect(initialCostTextOf("advance", 20, null)).toBe("선수금 20%");
  });

  it("비율이 0이고 금액만 있으면 금액", () => {
    expect(initialCostTextOf("deposit", 0, 11800000)).toBe("보증금 1,180만원");
  });

  it("비율·금액이 모두 0이면 유형명만", () => {
    expect(initialCostTextOf("deposit", 0, 0)).toBe("보증금");
  });

  it("유형이 없으면 null", () => {
    expect(initialCostTextOf(null, 30, 100)).toBeNull();
  });
});

describe("deriveNeedsFromRequest", () => {
  it("V2 요청에서 5필드를 파생한다", () => {
    expect(
      deriveNeedsFromRequest({
        paymentMethod: "lease",
        period: 60,
        depositType: "none",
        depositRatio: null,
        rentalDeposit: 0,
        annualMileageKm: 20000,
        deliveryTimingMode: "within_three_months",
        deliveryTimingReferenceMonth: "2026-07",
        deliveryTargetMonth: null,
      }),
    ).toEqual({
      needMethod: "운용리스",
      needContractTerm: "60개월",
      needInitialCost: "무보증",
      needAnnualMileage: "20,000km",
      needTiming: "2026년 10월까지",
    });
  });

  // 실측: 2026-07-24 15:24 아반떼 N 요청이 구매방식·기간·보증금 전부 null이었다. 빈 칸은 정상 상태다.
  it("앱이 건너뛴 필드는 null로 남긴다", () => {
    expect(
      deriveNeedsFromRequest({
        paymentMethod: null,
        period: null,
        depositType: null,
        depositRatio: null,
        rentalDeposit: null,
        annualMileageKm: null,
        deliveryTimingMode: "within_three_months",
        deliveryTimingReferenceMonth: "2026-07",
        deliveryTargetMonth: null,
      }),
    ).toEqual({
      needMethod: null,
      needContractTerm: null,
      needInitialCost: null,
      needAnnualMileage: null,
      needTiming: "2026년 10월까지",
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `bun run test:unit client/src/lib/quote-request-needs.test.ts`
Expected: FAIL — `Failed to resolve import "./quote-request-needs"`

- [ ] **Step 3: 모듈을 구현한다**

⚠️ **실행 중 확인된 정정 2건**:
1. `formatNumberWithCommas`(`detail-utils.ts`)는 **쓰지 않는다** — 그 파일이 `react`에서 타입을
   import해 "React 체인 없는 순수 모듈" 경계를 흐린다. `toLocaleString("ko-KR")`을 직접 부른다
   (그 함수 본체도 결국 같은 호출이다).
2. `DERIVED_NEED_KEYS`·`DerivedNeedKey`는 **이 Task에서 만들지 않는다** — PR ①에는 소비처가 없어
   knip이 unused export로 잡는다(PR 단위 CI green 유지). 상수는 **Task 7에서 추가**하고,
   `DerivedNeedKey` 타입은 실제 소비처가 없어 폐기한다(YAGNI).

```ts
// client/src/lib/quote-request-needs.ts
// 앱 견적요청 → crm.customers.need_* 파생 SSOT(2026-07-24 대표 견적요청 설계 D2).
// 설계 = ref/specs/2026-07-24-crm-featured-quote-request-needs-design.md
//
// ⚠️ 부작용 0 순수 모듈이다 — 서버(src/)가 import한다(AGENTS.md 경계 규칙). http/supabase/React를
//    절대 끌어들이지 말 것.
// ⚠️ 출력은 need_* 컬럼에 그대로 박히고 AI 프로필 청크 텍스트가 된다 — 형식을 바꾸면 임베딩이
//    전량 재백필된다(embeddingContentHash 변경).

import { ANNUAL_MILEAGE_OPTIONS } from "@/data/customers";
import { DEPOSIT_TYPE_LABEL, PAYMENT_METHOD_LABEL } from "@/data/quote-request-labels";
import { formatNumberWithCommas } from "@/lib/detail-utils";
import { deliveryTimingTextOf } from "@/lib/quote-delivery";

// 대표 요청에서 파생되는 need_* 컬럼(설계 D2). 차종 2개는 catalog 조인이 필요해 서버가 따로 채운다.
// PATCH 거부(D7)·read-only 판정(useCustomerPurchase)이 이 목록을 공유한다.
export const DERIVED_NEED_KEYS = [
  "needModel",
  "needTrim",
  "needMethod",
  "needContractTerm",
  "needInitialCost",
  "needAnnualMileage",
  "needTiming",
] as const;

export type DerivedNeedKey = (typeof DERIVED_NEED_KEYS)[number];

export type QuoteRequestNeedsSource = {
  paymentMethod: string | null;
  period: number | null;
  depositType: string | null;
  depositRatio: number | null;
  rentalDeposit: number | null;
  annualMileageKm: number | null;
  deliveryTimingMode: string | null;
  deliveryTimingReferenceMonth: string | null;
  deliveryTargetMonth: string | null;
};

// 차종 2개(needModel·needTrim)를 뺀 5필드 — 서버가 catalog 조인 결과와 합쳐 7필드를 만든다.
export type DerivedNeeds = {
  needMethod: string | null;
  needContractTerm: string | null;
  needInitialCost: string | null;
  needAnnualMileage: string | null;
  needTiming: string | null;
};

export function contractTermTextOf(period: number | null): string | null {
  // CONTRACT_TERM_OPTIONS 밖 값이어도 그대로 쓴다 — need_contract_term에는 CHECK가 없고(실측),
  // read-only라 편집 선택지와 맞출 필요도 없다. 사실을 그대로 보여주는 게 낫다.
  return period == null ? null : `${period}개월`;
}

export function annualMileageTextOf(km: number | null): string | null {
  if (km == null) return null;
  const text = `${formatNumberWithCommas(String(km))}km`;
  // need_annual_mileage는 DB CHECK가 8종으로 닫혀 있다 — 어휘 밖 값이면 그 필드만 버린다.
  // (앱이 chat_quote_flow.dart:379에서 검증하므로 현재는 도달하지 않는 방어선이다.)
  // annual_mileage_is_minimum(렌트+40000일 때만 true = "40,000km 이상")은 CRM 어휘에 대응이 없어 버린다.
  return ANNUAL_MILEAGE_OPTIONS.includes(text) ? text : null;
}

// 비율 우선·금액 폴백(설계 D2-a). ⚠️ 앱카드 라벨(depositLabelOf — "보증금 (20%) 1,180만원" 병기)과
// 형식이 다르다. 상세 구매조건은 parseInitialCost가 읽는 CRM 어휘여야 앱 미연결 고객의 수기값과
// 같은 어휘가 된다. 복붙 금지.
export function initialCostTextOf(
  depositType: string | null,
  ratio: number | null,
  amountWon: number | null,
): string | null {
  if (!depositType) return null;
  if (depositType === "none") return DEPOSIT_TYPE_LABEL.none;
  const name = DEPOSIT_TYPE_LABEL[depositType] ?? depositType;
  if (ratio != null && ratio > 0) return `${name} ${ratio}%`;
  if (amountWon != null && amountWon > 0) {
    return `${name} ${formatNumberWithCommas(String(Math.round(amountWon / 10000)))}만원`;
  }
  return name;
}

export function deriveNeedsFromRequest(req: QuoteRequestNeedsSource): DerivedNeeds {
  return {
    needMethod: req.paymentMethod ? (PAYMENT_METHOD_LABEL[req.paymentMethod] ?? req.paymentMethod) : null,
    needContractTerm: contractTermTextOf(req.period),
    needInitialCost: initialCostTextOf(req.depositType, req.depositRatio, req.rentalDeposit),
    needAnnualMileage: annualMileageTextOf(req.annualMileageKm),
    needTiming: deliveryTimingTextOf(req.deliveryTimingMode, req.deliveryTimingReferenceMonth, req.deliveryTargetMonth),
  };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `bun run test:unit client/src/lib/quote-request-needs.test.ts`
Expected: PASS (11 tests)

⚠️ `formatNumberWithCommas`의 시그니처를 먼저 확인할 것 — 문자열을 받는지 숫자를 받는지에 따라
`String(km)` 래핑이 달라진다. `rg -n "export function formatNumberWithCommas" client/src/lib/detail-utils.ts`

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/quote-request-needs.ts client/src/lib/quote-request-needs.test.ts
git commit -m "feat(crm): 앱 견적요청 → need_* 파생 순수 모듈"
```

---

## Task 2: `featured_request_id` 컬럼

**Files:**
- Modify: `src/db/schema.ts` (customers 테이블 — `needReviewNote` 아래)
- Create: `drizzle/0037_*.sql` (generate 산출물)

- [ ] **Step 1: 스키마에 컬럼을 추가한다**

```ts
// src/db/schema.ts — needReviewNote 다음 줄
  needReviewNote: text("need_review_note"),
  // 대표 견적요청(2026-07-24 설계 D1) — 이 요청에서 need_* 7필드를 파생한다.
  // → public.quote_requests.id (FK 없음 — public은 앱 소유라 crm에서 FK를 걸지 않는 레포 관례).
  // NULL = 대표 없음(앱 미연결 고객, 또는 상담신청으로만 연결돼 견적요청이 0건인 앱 고객).
  // ⚠️ read-only 판정 기준이 app_user_id가 아니라 이 컬럼이다(설계 D2 — 요청 0건 고객이 영원히
  //    못 채우는 상태가 되는 것을 막는다).
  featuredRequestId: uuid("featured_request_id"),
```

- [ ] **Step 2: 마이그레이션을 생성한다**

Run: `bun run db:generate`
Expected: `drizzle/0037_*.sql` 생성. 내용은 `ALTER TABLE "crm"."customers" ADD COLUMN "featured_request_id" uuid;` 한 줄.

⚠️ 생성된 SQL을 **반드시 눈으로 확인**한다. `crm` 밖 스키마를 건드리는 문장이 하나라도 있으면 중단할 것
(`DATABASE_URL`이 공유 master다).

- [ ] **Step 3: 마이그레이션을 적용한다**

Run: `bun run db:migrate`
Expected: 성공 로그.

- [ ] **Step 4: 실제 컬럼을 확인한다**

Run: `psql "$DATABASE_URL" -c "\d crm.customers" | grep featured_request_id`
Expected: `featured_request_id | uuid | | |`

- [ ] **Step 5: 커밋**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(crm): customers.featured_request_id 추가 — 대표 견적요청"
```

---

## Task 3: 승격 시드 개편

기존 `fillNeedTimingIfEmpty`(빈 칸만 채우는 비파괴 시드)를 **대표 기반 파생**으로 바꾼다.

**Files:**
- Modify: `src/db/queries/quote-requests.ts:382-505` (`requestTimingSelect` ~ `createCustomerFromRequest`)
- Test: `src/routes/quote-requests.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/routes/quote-requests.test.ts`에 추가한다. 기존 픽스처 관례를 그대로 따를 것 —
**새 `CU-`/`QT-` 코드 리터럴을 쓰면 `src/test-utils/fixture-codes.ts` registry에 먼저 등록**해야
`fixture-codes.test.ts`가 실패하지 않는다.

```ts
it("승격하면 대표 요청이 지정되고 파생 5필드가 채워진다", async () => {
  // (기존 테스트의 요청 생성 헬퍼를 재사용해 V2 필드가 있는 요청을 만든다)
  const requestId = await insertQuoteRequestFixture({
    paymentMethod: "lease",
    period: 60,
    depositType: "none",
    annualMileageKm: 20000,
    deliveryTimingMode: "within_three_months",
    deliveryTimingReferenceMonth: "2026-07",
  });

  const res = await app.request(`/api/quote-requests/${requestId}/create-customer`, { method: "POST" });
  expect(res.status).toBe(200);
  const created = await res.json();

  const [row] = await getDefaultDb()
    .select({
      featuredRequestId: customers.featuredRequestId,
      needMethod: customers.needMethod,
      needContractTerm: customers.needContractTerm,
      needInitialCost: customers.needInitialCost,
      needAnnualMileage: customers.needAnnualMileage,
      needTiming: customers.needTiming,
    })
    .from(customers)
    .where(eq(customers.id, created.id));

  expect(row.featuredRequestId).toBe(requestId);
  expect(row.needMethod).toBe("운용리스");
  expect(row.needContractTerm).toBe("60개월");
  expect(row.needInitialCost).toBe("무보증");
  expect(row.needAnnualMileage).toBe("20,000km");
  expect(row.needTiming).toBe("2026년 10월까지");
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `bun run test:server src/routes/quote-requests.test.ts`
Expected: FAIL — `featuredRequestId`가 `null`

- [ ] **Step 3: 파생 시드를 구현한다**

`src/db/queries/quote-requests.ts`에서 `requestTimingSelect`·`RequestTiming`·`needTimingOf`·
`fillNeedTimingIfEmpty`를 아래로 **교체**한다:

```ts
// 대표 요청에서 need_* 파생에 필요한 컬럼(승격 두 경로 + 대표 지정이 공유하는 select 조각).
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

// 대표 요청의 차량(catalog 조인) — needModel·needTrim. 트림이 없거나 삭제됐으면 둘 다 null.
async function vehicleNeedsOf(trimId: number | null, ex: Executor): Promise<{ needModel: string | null; needTrim: string | null }> {
  if (trimId == null) return { needModel: null, needTrim: null };
  const [t] = await ex
    .select({ trimName: trimsInCatalog.trimName, modelName: modelsInCatalog.name, brandName: brandsInCatalog.name })
    .from(trimsInCatalog)
    .leftJoin(modelsInCatalog, eq(trimsInCatalog.modelId, modelsInCatalog.id))
    .leftJoin(brandsInCatalog, eq(modelsInCatalog.brandId, brandsInCatalog.id))
    .where(eq(trimsInCatalog.id, trimId));
  if (!t) return { needModel: null, needTrim: null };
  return {
    needModel: [t.brandName, t.modelName].filter(Boolean).join(" ") || null,
    needTrim: t.trimName,
  };
}

// 고객의 need_* 7필드를 대표 요청 값으로 **덮어쓴다**(설계 D5 — 비파괴 아님).
// 구 fillNeedTimingIfEmpty("빈 칸일 때만")를 대체한다: read-only 전환 후에는 남겨둔 수기값을 상담사가
// 고칠 수 없게 되므로, 대표가 정해지면 파생값이 정본이다.
// 값이 없는 필드는 null로 덮는다 — 빈 칸이 정상 상태이고, 이전 대표의 잔값이 남으면 출처가 섞인다.
export async function applyFeaturedRequestNeeds(customerId: string, requestId: string, ex: Executor): Promise<void> {
  const [req] = await ex
    .select({ trimId: quoteRequests.trimId, ...requestNeedsSelect })
    .from(quoteRequests)
    .where(eq(quoteRequests.id, requestId));
  if (!req) return;
  const vehicle = await vehicleNeedsOf(req.trimId, ex);
  await ex
    .update(customers)
    // updated_at은 DB 시계로만(2026-07-23 #334·#335) — 앱 시계면 "마지막 활동"이 과거로 되돌아간다.
    .set({ ...vehicle, ...deriveNeedsFromRequest(req), featuredRequestId: requestId, updatedAt: sql`now()` })
    .where(eq(customers.id, customerId));
}
```

import를 추가한다:

```ts
import { asc } from "drizzle-orm";                      // firstRequestIdOf의 정렬
import { deriveNeedsFromRequest } from "@/client/lib/quote-request-needs";
```

⚠️ **정확한 import 경로는 기존 서버→클라 import 문을 그대로 따를 것.**
`rg -n "quote-delivery" src/db/queries/quote-requests.ts`로 확인한다. `asc`는 이미 import돼 있을 수 있다
(`rg -n "^import.*drizzle-orm" src/db/queries/quote-requests.ts`).

`linkRequestToCustomer`를 고친다:

```ts
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
  // 대표는 **그 유저의 최초 요청**이다 — 연결한 이 요청이 아니다(설계 D1: 기본 대표 = 최초 요청).
  if (linked) {
    const firstId = await firstRequestIdOf(req.userId, ex);
    if (firstId) await applyFeaturedRequestNeeds(linked.id, firstId, ex);
  }
  return linked;
}

// 그 앱 유저의 최초 견적요청 id(기본 대표). 요청이 0건이면 null.
async function firstRequestIdOf(appUserId: string, ex: Executor): Promise<string | null> {
  const [row] = await ex
    .select({ id: quoteRequests.id })
    .from(quoteRequests)
    .where(eq(quoteRequests.userId, appUserId))
    .orderBy(asc(quoteRequests.createdAt))
    .limit(1);
  return row?.id ?? null;
}
```

`createCustomerFromRequest`를 고친다 — 기존 고객 분기와 INSERT 분기 양쪽:

```ts
  // 기존 고객이면 새로 만들지 않는다(중복 방지). 대표가 아직 없을 때만 최초 요청으로 정한다 —
  // 이미 상담사가 star로 고른 대표를 승격 버튼이 되돌리면 안 된다.
  if (existing) {
    const [current] = await ex
      .select({ featuredRequestId: customers.featuredRequestId })
      .from(customers)
      .where(eq(customers.id, existing.id));
    if (!current?.featuredRequestId) {
      const firstId = await firstRequestIdOf(req.userId, ex);
      if (firstId) await applyFeaturedRequestNeeds(existing.id, firstId, ex);
    }
    return { ...existing, appUserId: req.userId };
  }
```

INSERT 분기에서는 기존의 `needModel`/`needTrim`/`needMethod`/`needTiming` 인라인 시드를 지우고
파생 모듈을 쓴다:

```ts
  const vehicle = await vehicleNeedsOf(req.trimId, ex);
  const customerCode = await nextCustomerCode(ex);
  const [row] = await ex
    .insert(customers)
    .values({
      customerCode,
      name: profile?.fullName ?? "이름미상",
      // phone 미저장(2026-07-17 spec §3-5) — 앱 연결 고객의 주 번호는 profiles read-through 합성.
      phone: null,
      appUserId: req.userId,
      // 신규 생성이면 이 요청이 곧 최초 요청 = 대표다(설계 D1).
      featuredRequestId: requestId,
      ...vehicle,
      ...deriveNeedsFromRequest(req),
      source: APP_QUOTE_REQUEST_SOURCE,
      statusGroup: "신규",
      status: "상담접수",
      receivedAt: new Date(req.createdAt),
    })
    .returning({ id: customers.id, customerCode: customers.customerCode, name: customers.name });
```

`createCustomerFromRequest`의 select에 `...requestNeedsSelect`를 포함시키고 `trimId`도 유지한다.
`PAYMENT_METHOD_LABEL` import가 이 파일에서 더 이상 안 쓰이면 **제거**한다(knip이 잡는다).

- [ ] **Step 4: 통과를 확인한다**

Run: `bun run test:server src/routes/quote-requests.test.ts`
Expected: PASS

⚠️ `test:server`는 **공유 master DB에 실제로 붙는다.** 알림 테이블에 쓰는 테스트라면
`setTestDb(guardedDb(getDefaultDb()))` 배선을 확인할 것(`quote_requests`는 알림 트리거 대상이
아니지만 `consultations`·`advisor_quotes`는 대상이다).

- [ ] **Step 5: 전체 검증**

```bash
bun run typecheck && bun run lint && bun run knip && bun run test:unit
```
Expected: 전부 0 problems / PASS

- [ ] **Step 6: 커밋**

```bash
git add src/db/queries/quote-requests.ts src/routes/quote-requests.test.ts
git commit -m "feat(crm): 승격 시 대표 요청 지정 + need_* 7필드 파생"
```

---

## Task 4: 기존 고객 백필

**Files:**
- Create: `src/scripts/backfill-featured-needs.ts`

- [ ] **Step 1: 백필 전 상태를 기록한다** (복원 대비)

```bash
psql "$DATABASE_URL" -c "\copy (select id, name, need_model, need_trim, need_method, need_contract_term, need_initial_cost, need_annual_mileage, need_timing from crm.customers where app_user_id is not null) to '/tmp/needs-before-backfill.csv' csv header"
```

- [ ] **Step 2: 백필 스크립트를 쓴다**

```ts
// src/scripts/backfill-featured-needs.ts
// 기존 앱 연결 고객의 대표 요청을 **최초 요청**으로 정하고 need_* 7필드를 파생값으로 덮는다(설계 D5).
// 이미 featured_request_id가 있는 고객은 건너뛴다(재실행 안전).
// 수기 유지 4필드(인도 방식·계약 포커스·고객/심사 특이사항)는 건드리지 않는다.
import { asc, eq, isNotNull, isNull } from "drizzle-orm";

import { getDefaultDb } from "@/db/client";
import { applyFeaturedRequestNeeds } from "@/db/queries/quote-requests";
import { customers } from "@/db/schema";
import { quoteRequests } from "@/db/public-app";

async function main() {
  const db = getDefaultDb();
  const targets = await db
    .select({ id: customers.id, name: customers.name, appUserId: customers.appUserId })
    .from(customers)
    .where(and(isNotNull(customers.appUserId), isNull(customers.featuredRequestId)));

  for (const c of targets) {
    if (!c.appUserId) continue;
    const [first] = await db
      .select({ id: quoteRequests.id })
      .from(quoteRequests)
      .where(eq(quoteRequests.userId, c.appUserId))
      .orderBy(asc(quoteRequests.createdAt))
      .limit(1);
    if (!first) {
      console.log(`skip ${c.name} — 견적요청 0건(상담신청만 연결된 고객)`);
      continue;
    }
    await applyFeaturedRequestNeeds(c.id, first.id, db);
    console.log(`ok   ${c.name} — 대표 ${first.id}`);
  }
  console.log(`done: ${targets.length}명 처리`);
}

void main();
```

⚠️ `and`를 `drizzle-orm`에서 import하는 것을 잊지 말 것.

- [ ] **Step 3: 실행한다**

Run: `bun run src/scripts/backfill-featured-needs.ts`
Expected: `ok 김지안 …` / `ok 제임스 …` / `done: 2명 처리`

- [ ] **Step 4: 결과를 실측한다**

```bash
psql "$DATABASE_URL" -c "select name, featured_request_id is not null as 대표, need_model, need_method, need_contract_term, need_initial_cost, need_timing from crm.customers where app_user_id is not null;"
```
Expected: 두 명 다 대표 `t`. 김지안의 `need_method`가 `장기렌트 · 금융리스 · 할부`에서 최초 요청 값
(`금융리스`)으로 바뀌었을 것(설계 D5 — 의도된 덮어쓰기).

- [ ] **Step 5: AI 프로필 청크를 재임베딩한다**

`need_*`가 바뀌면 `buildCustomerProfileChunkText` 출력이 달라져 `embeddingContentHash`가 변한다.
백필을 **실행해야** 반영된다.

Run: `bun run src/scripts/backfill-embeddings.ts`
Expected: 변경된 고객 수만큼 재임베딩 로그.

⚠️ 실제 스크립트 이름·실행법은 `rg -n "backfill" package.json`으로 확인할 것.

- [ ] **Step 6: 커밋**

```bash
git add src/scripts/backfill-featured-needs.ts
git commit -m "chore(crm): 기존 앱 연결 고객 대표 요청 백필"
```

- [ ] **Step 7: PR ① 을 올린다**

```bash
git push -u origin <branch>
gh pr create --title "feat(crm): 대표 견적요청 기반 니즈 파생 — DB·파생 모듈·승격 시드" --body "..."
```

PR 본문에 🟡 **행위 변경**을 명시한다: 승격 시드가 비파괴(빈 칸만)에서 **덮어쓰기**로 바뀌었고,
기존 앱 연결 고객 2명의 수기 니즈가 파생값으로 대체됐다.

---

# PR ② — 대표 지정 API · star UI

## Task 5: 대표 지정 라우트

**Files:**
- Modify: `src/routes/quote-requests.ts`
- Modify: `src/db/queries/customers.ts` (상세 응답에 `featuredRequestId`)
- Test: `src/routes/quote-requests.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it("대표를 바꾸면 need_* 7필드가 그 요청 값으로 갱신된다", async () => {
  // 같은 유저의 요청 2건을 만든다: 첫 요청(리스 60개월) → 둘째 요청(할부 36개월)
  const firstId = await insertQuoteRequestFixture({ paymentMethod: "lease", period: 60 });
  const res = await app.request(`/api/quote-requests/${firstId}/create-customer`, { method: "POST" });
  const created = await res.json();

  const secondId = await insertQuoteRequestFixture({ paymentMethod: "installment", period: 36 });

  const featured = await app.request(`/api/quote-requests/${secondId}/feature`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ customerId: created.id }),
  });
  expect(featured.status).toBe(200);

  const [row] = await getDefaultDb()
    .select({ featuredRequestId: customers.featuredRequestId, needMethod: customers.needMethod, needContractTerm: customers.needContractTerm })
    .from(customers)
    .where(eq(customers.id, created.id));
  expect(row.featuredRequestId).toBe(secondId);
  expect(row.needMethod).toBe("할부");
  expect(row.needContractTerm).toBe("36개월");
});

it("다른 고객의 요청은 대표로 지정할 수 없다", async () => {
  // 요청의 user_id ≠ 고객의 app_user_id 인 조합
  const res = await app.request(`/api/quote-requests/${otherUsersRequestId}/feature`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ customerId: someCustomerId }),
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `bun run test:server src/routes/quote-requests.test.ts`
Expected: FAIL — 404 (라우트 없음)

- [ ] **Step 3: 쿼리를 구현한다**

`src/db/queries/quote-requests.ts`에 추가한다:

```ts
// 대표 요청 지정(설계 D1). 요청이 그 고객의 것이 아니면 null — 남의 요청으로 니즈를 덮는 것을 막는다.
export async function setFeaturedRequest(
  requestId: string,
  customerId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string; featuredRequestId: string } | null> {
  const [req] = await ex.select({ userId: quoteRequests.userId }).from(quoteRequests).where(eq(quoteRequests.id, requestId));
  if (!req) return null;
  const [customer] = await ex
    .select({ id: customers.id, appUserId: customers.appUserId })
    .from(customers)
    .where(eq(customers.id, customerId));
  // 소유권 검증: 그 고객에게 연결된 앱 유저의 요청이어야 한다.
  if (!customer || customer.appUserId !== req.userId) return null;
  await applyFeaturedRequestNeeds(customerId, requestId, ex);
  return { id: customerId, featuredRequestId: requestId };
}
```

- [ ] **Step 4: 라우트를 구현한다**

`src/routes/quote-requests.ts`에 추가한다(기존 `link` 라우트 바로 아래, 같은 형태로):

```ts
// 대표 견적요청 지정 — need_* 7필드가 이 요청 값으로 갱신된다(설계 D1).
quoteRequests.post(
  "/:id/feature",
  zValidator("param", idParam),
  zValidator("json", z.object({ customerId: z.uuid() })),
  (c) =>
    run(
      c,
      async () => {
        const row = await c.var.db.transaction((tx) =>
          setFeaturedRequest(c.req.valid("param").id, c.req.valid("json").customerId, tx),
        );
        if (row) {
          // 프로필 청크 재임베딩 — need_* 7필드 전부가 CUSTOMER_PROFILE_EMBED_KEYS 구성 필드다.
          // 트랜잭션 커밋 후 스케줄(승격 라우트와 동일 — 훅의 fresh read가 구값을 보는 것 방지).
          scheduleEmbedOnWrite(c, { sourceType: "customer_profile", sourceId: row.id });
          scheduleAiHintRefresh(c, row.id);
        }
        return row;
      },
      "요청 또는 고객을 찾을 수 없습니다.",
    ),
);
```

⚠️ `scheduleEmbedOnWrite`가 이 파일에 이미 import돼 있는지 확인한다
(`rg -n "scheduleEmbedOnWrite|schedulePromotionEmbeds" src/routes/quote-requests.ts`).

- [ ] **Step 5: 상세 응답에 `featuredRequestId`를 싣는다**

`src/db/queries/customers.ts`의 `getCustomer` select에 `featuredRequestId: customers.featuredRequestId`를
추가하고, `client/src/lib/customers.ts`의 `CustomerDetailData`·응답 타입에 `featuredRequestId: string | null`을
추가한다(두 곳 다 — 타입과 매핑).

- [ ] **Step 6: 통과를 확인한다**

Run: `bun run test:server src/routes/quote-requests.test.ts`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add src/db/queries/quote-requests.ts src/routes/quote-requests.ts src/db/queries/customers.ts client/src/lib/customers.ts src/routes/quote-requests.test.ts
git commit -m "feat(crm): 대표 견적요청 지정 API"
```

---

## Task 6: 앱 카드 star UI

**Files:**
- Modify: `client/src/lib/quote-requests.ts` (요청 API 함수 추가)
- Modify: `client/src/components/customer-detail/hooks/useCustomerNeeds.ts` (핸들러)
- Modify: `client/src/components/customer-detail/NeedsDashboard.tsx:88-135` (카드 렌더)
- Modify: `client/src/index.css` (star 스타일)

- [ ] **Step 1: API 함수를 추가한다**

```ts
// client/src/lib/quote-requests.ts
export async function featureQuoteRequest(requestId: string, customerId: string): Promise<void> {
  await postJson(`/api/quote-requests/${requestId}/feature`, { customerId });
}
```

⚠️ 이 파일의 기존 http 헬퍼 이름을 그대로 쓸 것(`rg -n "^import|postJson|apiPost" client/src/lib/quote-requests.ts`).

- [ ] **Step 2: 카드에 star 버튼을 붙인다**

`NeedsDashboard.tsx`의 요청 카드(`kim-needs-request-card`)에서 배지 자리 옆에 추가한다:

```tsx
<button
  aria-label={req.id === detail.featuredRequestId ? "대표 견적요청" : "대표 견적요청으로 지정"}
  aria-pressed={req.id === detail.featuredRequestId}
  className={`kim-needs-request-star${req.id === detail.featuredRequestId ? " is-on" : ""}`}
  onClick={() => onFeature(req.id)}
  type="button"
>
  <Star size={16} strokeWidth={2.1} />
</button>
```

`lucide-react`에서 `Star`를 import한다(파일 상단 기존 import에 추가).

- [ ] **Step 3: 핸들러를 배선한다**

`useCustomerNeeds.ts`에 추가한다 — 낙관적 갱신 없이 **성공 후 상세 재조회**로 간다(파생 7필드가
서버에서 한꺼번에 바뀌므로 클라가 미리 계산할 수 없다):

```ts
async function featureRequest(requestId: string) {
  try {
    await featureQuoteRequest(requestId, detail.id);
    await refreshDetail();       // 기존 상세 재조회 함수 이름을 확인해 그대로 쓸 것
    onToast("대표 견적요청 변경 완료");
  } catch {
    onToast("대표 견적요청을 바꾸지 못했습니다.");
  }
}
```

- [ ] **Step 4: 스타일을 넣는다**

```css
/* index.css — kim-needs-request-badge 근처 */
.kim-needs-request-star {
  background: none;
  border: 0;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
}
.kim-needs-request-star.is-on { color: var(--brand-primary); }
.kim-needs-request-star.is-on svg { fill: currentColor; }
```

⚠️ 변수명은 실제 토큰을 확인해 쓸 것(`rg -n "brand-primary|text-muted" client/src/index.css | head`).

- [ ] **Step 5: 눈으로 확인한다**

로컬 dev를 띄우고(로그인은 CLAUDE.md의 magiclink 우회 절차) 제임스 상세를 연다.
Expected: 카드 4장 중 최초 요청(BMW 3 Series)에 star가 켜져 있고, 다른 카드의 star를 누르면
상세 구매조건 5필드와 목록 차종이 그 요청 값으로 바뀐다.

- [ ] **Step 6: 검증 후 커밋**

```bash
bun run typecheck && bun run lint && bun run test:unit
git add client/
git commit -m "feat(crm): 앱 카드 대표 견적요청 star 토글"
```

---

# PR ③ — read-only · 프리셋

## Task 7: 파생 7필드 PATCH 거부

**Files:**
- Modify: `src/routes/customers.ts` (PATCH 핸들러)
- Test: `src/routes/customers.*.test.ts` (기존 PATCH 테스트 파일)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it("대표 요청이 있는 고객의 파생 필드는 PATCH가 409로 거부된다", async () => {
  const res = await app.request(`/api/customers/${featuredCustomerId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ needMethod: "할부" }),
  });
  expect(res.status).toBe(409);
});

it("수기 유지 필드는 대표가 있어도 PATCH된다", async () => {
  const res = await app.request(`/api/customers/${featuredCustomerId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ needDeliveryMethod: "매장 출고" }),
  });
  expect(res.status).toBe(200);
});

it("대표가 없는 고객은 파생 필드도 PATCH된다", async () => {
  const res = await app.request(`/api/customers/${plainCustomerId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ needMethod: "할부" }),
  });
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `bun run test:server <해당 파일>`
Expected: 첫 테스트가 200을 받아 FAIL

- [ ] **Step 3: 거부를 구현한다**

`src/routes/customers.ts`의 PATCH 핸들러에서, 기존 `phone` 409 검사 **바로 옆에** 추가한다:

```ts
// 대표 견적요청에서 파생되는 필드는 수정 불가(설계 D7) — UI 비활성화만으로는 우회된다.
// 판정 기준은 app_user_id가 아니라 featured_request_id다(요청 0건 앱 고객은 수기 입력이 열려 있어야 한다).
const derivedTouched = DERIVED_NEED_KEYS.filter((key) => key in body);
if (derivedTouched.length > 0 && current.featuredRequestId) {
  return c.json({ error: "대표 견적요청에서 자동으로 채워지는 항목이라 수정할 수 없습니다." }, 409);
}
```

`DERIVED_NEED_KEYS`를 import한다(Task 1의 순수 모듈).
⚠️ 기존 핸들러가 현재 고객 행(`current`)을 이미 읽고 있는지 확인한다 — `phone` 409 검사가 `appUserId`를
보므로 읽고 있을 가능성이 높다. 없으면 그 select에 `featuredRequestId`를 추가한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `bun run test:server <해당 파일>`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/routes/customers.ts <테스트 파일>
git commit -m "feat(crm): 파생 니즈 필드 PATCH 409 거부"
```

---

## Task 8: 상세 구매조건 read-only

**Files:**
- Modify: `client/src/components/customer-detail/hooks/useCustomerPurchase.ts`
- Modify: `client/src/components/customer-detail/PurchaseConditions.tsx` (셀 렌더)

- [ ] **Step 1: 훅에 판정을 넣는다**

`UseCustomerPurchaseArgs`에 `detail`이 이미 있으므로 파생 판정만 추가한다:

```ts
// 대표 견적요청이 있으면 파생 5필드는 read-only(설계 D2) — 서버도 409로 막는다(D7).
// 차종 2개는 이 화면에 없어 여기서는 5필드만 본다.
const derivedLocked = detail.featuredRequestId != null;
const READ_ONLY_LABELS = new Set(["구매방식", "계약기간", "초기비용", "연간 주행거리", "출고 희망 시기"]);
const isFieldLocked = (label: string) => derivedLocked && READ_ONLY_LABELS.has(label);
```

에디터 kind ↔ 라벨 매핑을 `purchase-meta.ts`에 둔다(1벌):

```ts
// purchase-meta.ts — PURCHASE_FIELD_KEY 아래
// 편집 팝오버 kind → 구매조건 라벨. read-only 판정(useCustomerPurchase.isFieldLocked)이 쓴다.
export const PURCHASE_EDITOR_LABEL: Record<string, string> = {
  purchaseMethod: "구매방식",
  purchaseTerm: "계약기간",
  purchaseInitialCost: "초기비용",
  purchaseAnnualMileage: "연간 주행거리",
  purchaseDeliveryMethod: "인도 방식",
  purchaseTiming: "출고 희망 시기",
  purchaseCostFocus: "계약 포커스",
  purchaseCustomerNote: "고객 특이사항",
  purchaseReviewNote: "심사 특이사항",
};
```

⚠️ **실제 `OpenEditorState`의 kind 문자열을 먼저 확인해 키를 그대로 맞출 것**
(`rg -n "purchase" client/src/components/customer-detail/types.ts`). 위 키는 추정이다.

`openPurchaseFloatingEditor`·`openPurchaseInitialCostEditor` 진입부에서 잠긴 필드면 즉시 반환한다:

```ts
function openPurchaseFloatingEditor(event: ReactMouseEvent<HTMLButtonElement>, next: Extract<OpenEditorState, { kind: PurchaseFloatingKind }>) {
  if (isFieldLocked(PURCHASE_EDITOR_LABEL[next.kind] ?? "")) return;   // 편집 팝오버 자체를 안 연다
  ...기존 본문 그대로...
}

function openPurchaseInitialCostEditor(event: ReactMouseEvent<HTMLButtonElement>) {
  if (isFieldLocked("초기비용")) return;
  ...기존 본문 그대로...
}
```

⚠️ 팝오버를 막는 것만으로는 부족하다 — `togglePurchaseMethod`·`togglePurchaseTerm`은 팝오버 **안의**
버튼이 직접 호출하므로 팝오버가 안 열리면 도달할 수 없지만, `savePurchaseConditions`(폼 제출)는
별도 경로다. 서버 409(Task 7)가 최종 방어선이다.

훅 반환에 `isFieldLocked`를 추가한다.

- [ ] **Step 2: 셀 렌더에서 잠긴 필드를 표시한다**

`PurchaseConditions.tsx`에서 잠긴 셀은 버튼이 아니라 정적 텍스트로 렌더한다(클릭 어포던스 제거):

```tsx
{isFieldLocked(field.label) ? (
  <div className="kim-purchase-cell is-locked">
    <span className="kim-purchase-label">{field.label}</span>
    <strong>{field.value || "미정"}</strong>
  </div>
) : (
  /* 기존 버튼 렌더 그대로 */
)}
```

```css
/* index.css */
.kim-purchase-cell.is-locked { cursor: default; }
```

- [ ] **Step 3: 눈으로 확인한다**

제임스(대표 있음) 상세 → 구매방식·계약기간·초기비용·연간 주행거리·출고 희망 시기 클릭 시 팝오버가
안 열린다. 인도 방식·계약 포커스·고객/심사 특이사항은 그대로 열린다.
앱 미연결 고객(예: 목록의 일반 고객) 상세 → 9필드 전부 열린다.

- [ ] **Step 4: 검증 후 커밋**

```bash
bun run typecheck && bun run lint && bun run test:unit
git add client/
git commit -m "feat(crm): 대표 요청 파생 5필드 상세 read-only"
```

---

## Task 9: 출고 희망 시기 프리셋 4종

**Files:**
- Modify: `client/src/components/customer-detail/purchase-meta.ts:33-34`
- Modify: `client/src/components/customer-detail/hooks/useCustomerPurchase.ts:167-200`
- Modify: `client/src/components/customer-detail/PurchaseConditions.tsx` (월 피커 제거)
- Test: `client/src/lib/quote-request-needs.test.ts` (프리셋 절대화)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// client/src/lib/quote-request-needs.test.ts 에 추가
import { timingTextFromPreset } from "./quote-request-needs";

describe("timingTextFromPreset", () => {
  // 수기 입력도 절대화해 저장한다(설계 D4) — 상대 표현을 그대로 저장하면 같은 컬럼에 두 어휘가
  // 섞이고, 시간이 지나면 언제 기준인지 알 수 없어져 지금 고치려는 스테일 병이 재발한다.
  it("고른 시점을 참조월로 절대화한다", () => {
    expect(timingTextFromPreset("이번 달", "2026-07")).toBe("2026년 7월");
    expect(timingTextFromPreset("다음 달", "2026-07")).toBe("2026년 8월");
    expect(timingTextFromPreset("3개월 이내", "2026-07")).toBe("2026년 10월까지");
  });

  it("미정은 센티넬로", () => {
    expect(timingTextFromPreset("미정", "2026-07")).toBe("확인 필요");
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `bun run test:unit client/src/lib/quote-request-needs.test.ts`
Expected: FAIL — `timingTextFromPreset is not a function`

- [ ] **Step 3: 구현한다**

```ts
// client/src/lib/quote-request-needs.ts
import { PURCHASE_UNSET_SENTINEL } from "@/data/customers";

// 상세 구매조건 "출고 희망 시기" 프리셋 — 앱 UI 4종과 어휘를 맞춘다(설계 D4).
// ⚠️ 앱의 within_three_months는 "3개월 **이내**"다("이후"가 아니다 — 뜻이 반대).
export const TIMING_PRESET_MODE: Record<string, string> = {
  "이번 달": "current_month",
  "다음 달": "next_month",
  "3개월 이내": "within_three_months",
  "미정": "undecided",
};

export const timingPresetOptions = Object.keys(TIMING_PRESET_MODE);

// 프리셋 선택 → 저장값. 고른 시점(referenceMonth = 'YYYY-MM')을 앵커로 절대화한다.
export function timingTextFromPreset(preset: string, referenceMonth: string): string {
  const mode = TIMING_PRESET_MODE[preset];
  // undecided는 deliveryTimingTextOf가 null을 준다 — 컬럼에는 미입력 센티넬을 넣는다.
  return deliveryTimingTextOf(mode ?? null, referenceMonth, null) ?? PURCHASE_UNSET_SENTINEL;
}
```

`purchase-meta.ts`에서 구 프리셋을 **제거**하고 새 것을 re-export한다:

```ts
// purchase-meta.ts — 아래 두 줄을 삭제한다
// export const timingPresetOptions = ["좋은 조건 즉시", "이번 달", "다음 달", "3개월 이후"];
// export const timingMonthOptions = Array.from({ length: 12 }, (_, index) => `${index + 1}월`);
export { timingPresetOptions } from "@/lib/quote-request-needs";
```

`useCustomerPurchase.ts`의 `selectPurchaseTiming`을 고치고 `selectPurchaseTimingMonth`·
`showTimingMonths`·`setShowTimingMonths`를 **전부 제거**한다("특정 월" 피커가 사라진다):

```ts
function selectPurchaseTiming(option: string) {
  const currentTimingField = purchaseFields.find((field) => field.label === "출고 희망 시기");
  // 고른 시점을 참조월로 절대화(설계 D4). 같은 값을 다시 누르면 해제.
  const now = new Date();
  const referenceMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const nextText = timingTextFromPreset(option, referenceMonth);
  const nextValue = currentTimingField?.value === nextText ? PURCHASE_UNSET_SENTINEL : nextText;
  const prevPurchaseFields = purchaseFields;
  setPurchaseFields((current) => current.map((field) => (
    field.label === "출고 희망 시기" ? { ...field, value: nextValue } : field
  )));
  setOpenEditor(null);
  setPurchasePopoverFrame(null);
  markRecentUpdate("상세 구매조건");
  onToast("출고 희망 시기 수정 완료");
  savePatch({ needTiming: nextValue }, () => setPurchaseFields(prevPurchaseFields));
}
```

`PurchaseConditions.tsx`에서 월 피커 렌더와 `showTimingMonths` 참조를 제거한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `bun run test:unit client/src/lib/quote-request-needs.test.ts`
Expected: PASS

- [ ] **Step 5: 전체 검증**

```bash
bun run typecheck && bun run lint && bun run knip && bun run format:check && bun run test:unit && bun run build
```
Expected: 전부 0 problems / PASS

⚠️ `knip`은 제거한 export(`timingMonthOptions` 등)가 어디서도 안 쓰이는지 확인한다. 남은 참조가
있으면 typecheck가 먼저 잡는다.

- [ ] **Step 6: 커밋 후 PR ③**

```bash
git add client/
git commit -m "feat(crm): 출고 희망 시기 프리셋을 앱 4종으로 통일(저장은 절대화 유지)"
git push
gh pr create --title "feat(crm): 니즈 read-only · 출고 시기 프리셋 통일"
```

PR 본문에 🟡 **행위 변경 2건**을 명시한다: ①대표 요청이 있는 고객은 상세 구매조건 5필드를 더 이상
수정할 수 없다(서버 409) ②출고 희망 시기 선택지에서 `좋은 조건 즉시`·`특정 월`(12개월 피커)이
사라지고 `미정`이 생겼으며, `3개월 이후`가 앱 어휘인 `3개월 이내`로 바뀌었다.

---

## 마무리

- [ ] `AGENTS.md`의 서버 import 허용 순수 lib 목록에 `quote-request-needs.ts` 추가
- [ ] `ref/active-session-brief.md` 갱신(교체 — 누적 금지, 60줄 이하)
- [ ] `ref/2026-07-24-customer-needs-staleness.md`에 **해소됨** 표시 + 설계 문서 링크
- [ ] prod 눈 검증 3건 — ①star 토글 ②상세 5필드 read-only ③출고 시기 프리셋 4종
