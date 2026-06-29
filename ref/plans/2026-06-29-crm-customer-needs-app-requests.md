# 고객 니즈 영역 = 앱 견적요청 카드 목록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 유입 고객(`app_user_id` 있음)의 고객 상세 "고객의 니즈" 영역을, 그 고객이 앱에서 보낸 견적요청(`quote_requests`)을 카드로 쌓아 보여주고 각 카드에서 워크벤치로 견적 승격까지 잇는다. 수기 등록 고객은 기존 단일 need 카드 그대로(회귀 없음).

**Architecture:** 인박스(`listQuoteRequests`)의 batch read 로직을 공통 헬퍼로 추출해 `listQuoteRequestsByUser(appUserId)`가 user 필터만 더해 공유한다. 라우트 `GET /api/customers/:id/quote-requests`가 고객의 `app_user_id`를 조회해 있으면 그 user 요청을, 없으면 빈 배열을 반환한다. 프론트는 `detail.appUserId` 유무로 니즈 영역을 분기: 있으면 요청 카드 목록(read) + "견적 작성"(S3 워크벤치 prefill 재사용), 없으면 기존 단일 need 카드. 문의사항/색상은 고객 단위로 유지.

**Tech Stack:** Hono + drizzle-orm(postgres-js) + Cloudflare Workers / React + react-router / bun:test(server, `bun test --env-file=.env.local`) + vitest(frontend, `bun run test:unit`).

**참조 스펙:** `ref/specs/2026-06-29-crm-customer-needs-app-requests-design.md`

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/db/queries/quote-requests.ts` | 공통 batch-read 헬퍼 추출 + `listQuoteRequestsByUser` | Modify |
| `src/db/queries/customers.ts` | `getCustomerAppUserId`(고객→app_user_id 조회) | Modify |
| `src/routes/customers.ts` | `GET /:id/quote-requests` 라우트 | Modify |
| `src/routes/quote-requests.test.ts` | `listQuoteRequestsByUser` 서버 테스트 | Modify |
| `src/routes/customers.test.ts` | `GET /:id/quote-requests` 라우트 테스트 | Modify |
| `client/src/lib/customers.ts` | `CustomerDetailResponse/Data` + `toCustomerDetail`에 `appUserId` | Modify |
| `client/src/lib/quote-requests.ts` | `fetchCustomerQuoteRequests` | Modify |
| `client/src/lib/customers.test.ts` | `toCustomerDetail` appUserId 통과 테스트 | Modify |
| `client/src/lib/quote-requests.test.ts` | `fetchCustomerQuoteRequests` 엔드포인트 테스트 | Modify |
| `client/src/pages/CustomerDetailPage.tsx` | 니즈 영역 분기 + `openWorkbenchForQuoteRequest` 추출 | Modify |
| `client/src/index.css` | 요청 카드 목록 스타일 | Modify |

---

## 사전 확인된 사실 (구현 전 숙지)

- **백엔드 `getCustomer`는 `appUserId`를 이미 반환한다.** `getCustomer`(`src/db/queries/customers.ts:79`)는 `executor.select().from(customers)`로 전체 컬럼을 받고 `return { ...customer, ... }` 하므로, `GET /api/customers/:id` JSON 응답에 `appUserId`가 이미 포함돼 있다. **백엔드 쿼리 변경은 불필요** — 프론트 타입/어댑터에만 추가한다.
- `AppQuoteRequestRow`에는 `userId` 필드가 없다(표시용). 그래서 `listQuoteRequestsByUser` 테스트는 반환 행의 `userId`를 직접 검사할 수 없고 **id 집합 비교**로 검증한다.
- `quoteRequests.createdAt`은 `mode:"string"`, `userId`는 `notNull` → base row 타입은 `createdAt: string`, `userId: string`.
- `CustomerDetailPage`는 `useCallback`을 import하지 않는다. 추출 함수는 **hoisted `function` 선언**으로 둔다(기존 URL 효과가 뒤에 정의된 `resetWorkbenchVehicle`을 호이스팅으로 참조하는 패턴과 동일).
- 니즈 영역의 "견적 작성"은 인박스 S3와 달리 **여러 카드**가 있으므로 URL(`?quoteRequest=`) 경로를 재사용하면 안 된다(`quoteRequestPrefillRef` 1회 가드 때문에 두 번째 카드가 무동작). **직접 함수 호출**로 워크벤치를 연다.

---

## Task 1: 백엔드 — 공통 헬퍼 추출 + `listQuoteRequestsByUser`

**Files:**
- Modify: `src/db/queries/quote-requests.ts`
- Test: `src/routes/quote-requests.test.ts`

기존 `listQuoteRequests`(rows 조회 → batch read → map)에서 **batch read + map** 부분을 `buildAppQuoteRequestRows(rows, executor)` 헬퍼로 추출하고, rows 조회만 다른 두 함수(`listQuoteRequests` 전체 / `listQuoteRequestsByUser` user 필터)가 공유한다.

- [ ] **Step 1: 실패 테스트 작성**

`src/routes/quote-requests.test.ts` 맨 아래에 추가(파일 상단 import에 `listQuoteRequestsByUser`를 추가하고, `eq`·`quoteRequestsTable`는 이미 import됨):

```ts
// 파일 상단 import 수정: listQuoteRequests 옆에 listQuoteRequestsByUser 추가
// import { createCustomerFromRequest, getQuoteRequestDetail, linkRequestToCustomer, listQuoteRequests, listQuoteRequestsByUser } from "../db/queries/quote-requests";

test("listQuoteRequestsByUser: 해당 user 요청만 반환(id 집합 일치)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  const userReqIds = (
    await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).where(eq(quoteRequestsTable.userId, req.userId))
  ).map((r) => r.id);
  const result = await listQuoteRequestsByUser(req.userId);
  expect(result.length).toBe(userReqIds.length);
  const idSet = new Set(userReqIds);
  for (const r of result) expect(idSet.has(r.id)).toBe(true);
});

test("listQuoteRequestsByUser: 없는 user → 빈 배열", async () => {
  const result = await listQuoteRequestsByUser("00000000-0000-0000-0000-000000000000");
  expect(result).toEqual([]);
});

test("listQuoteRequests(전체) 길이 ≥ listQuoteRequestsByUser(부분) — 추출 회귀 가드", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  const all = await listQuoteRequests();
  const sub = await listQuoteRequestsByUser(req.userId);
  expect(all.length).toBeGreaterThanOrEqual(sub.length);
  // 전체 행 형태가 추출 후에도 유지되는지(차량명/옵션수/매칭)
  for (const r of all) {
    expect(typeof r.optionCount).toBe("number");
    expect(["app_user", "phone", "none"]).toContain(r.matchType);
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test --env-file=.env.local src/routes/quote-requests.test.ts`
Expected: FAIL — `listQuoteRequestsByUser`가 export되지 않아 import/타입 에러.

- [ ] **Step 3: 헬퍼 추출 + 두 함수 구현**

`src/db/queries/quote-requests.ts`에서 기존 `listQuoteRequests`(현재 32~152행 전체)를 아래로 교체. **batch read/map 본문은 기존 코드를 그대로 옮기고**, 앞단 rows 조회만 두 진입점으로 나눈다.

```ts
// 헬퍼/두 함수 공통 base row(rows 조회 결과 1행).
type QuoteRequestBaseRow = {
  id: string;
  createdAt: string;
  userId: string;
  trimId: number | null;
  paymentMethod: string | null;
  period: number | null;
  depositType: string | null;
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
      .select({ sourceId: quotes.sourceQuoteRequestId })
      .from(quotes)
      .where(inArray(quotes.sourceQuoteRequestId, reqIds)),
  ]);

  const trimMap = new Map(trimRows.map((t) => [t.id, t]));

  const optCount = new Map<string, number>();
  for (const o of optRows) optCount.set(o.quoteRequestId, (optCount.get(o.quoteRequestId) ?? 0) + 1);

  const promoCount = new Map<string, number>();
  for (const p of promoRows) {
    if (p.sourceId) promoCount.set(p.sourceId, (promoCount.get(p.sourceId) ?? 0) + 1);
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
      promotedQuoteCount: promoCount.get(r.id) ?? 0,
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
```

> 주의: 위 교체로 기존 `listQuoteRequests` 본문(32~152행)이 사라진다. import·`AppQuoteRequestRow` 타입·그 아래 `getQuoteRequestDetail` 이하 함수들은 **그대로 둔다**.

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun test --env-file=.env.local src/routes/quote-requests.test.ts`
Expected: PASS(기존 + 신규 3개). 특히 "전체 길이 ≥ 부분" 회귀 가드 통과.

- [ ] **Step 5: typecheck + 커밋**

```bash
bun run typecheck
git add src/db/queries/quote-requests.ts src/routes/quote-requests.test.ts
git commit -m "$(cat <<'EOF'
feat(crm): listQuoteRequestsByUser — 공통 batch-read 헬퍼 추출 + user 필터

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 백엔드 — `getCustomerAppUserId` + `GET /api/customers/:id/quote-requests`

**Files:**
- Modify: `src/db/queries/customers.ts`
- Modify: `src/routes/customers.ts`
- Test: `src/routes/customers.test.ts`

라우트는 고객의 `app_user_id`를 조회 → 있으면 `listQuoteRequestsByUser`, 없으면 `[]`. 고객 자체가 없으면 404.

- [ ] **Step 1: 실패 테스트 작성**

`src/routes/customers.test.ts` 맨 아래에 추가. 파일 상단에서 `isNull`/`isNotNull`(drizzle-orm), `customers`(schema)가 import돼 있는지 확인하고 없으면 추가한다.

```ts
// 상단 import 확인/추가:
//   import { and, eq, isNotNull, isNull } from "drizzle-orm";
//   import { customers } from "../db/schema";
//   import { getDefaultDb } from "../db/client";
//   import { createApp } from "../app";
//   import { makeTestAuth } from "../auth/test-jwt";

test("GET /api/customers/:id/quote-requests 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const [cust] = await getDefaultDb().select({ id: customers.id }).from(customers).limit(1);
  const res = await app.request(`/api/customers/${cust.id}/quote-requests`);
  expect(res.status).toBe(401);
});

test("GET /api/customers/:id/quote-requests 없는 고객 → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/customers/00000000-0000-0000-0000-000000000000/quote-requests", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(404);
});

test("GET /api/customers/:id/quote-requests 수기 고객(app_user_id 없음) → 200 빈 배열", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const [cust] = await getDefaultDb().select({ id: customers.id }).from(customers).where(isNull(customers.appUserId)).limit(1);
  const res = await app.request(`/api/customers/${cust.id}/quote-requests`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("GET /api/customers/:id/quote-requests 앱 유입 고객 → 200 배열(요청 행 형태)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const [cust] = await getDefaultDb().select({ id: customers.id }).from(customers).where(isNotNull(customers.appUserId)).limit(1);
  // 앱 유입 고객이 DB에 없으면 이 단언은 건너뛴다(데이터 의존). 김지안 등 app-created 고객 존재 시 검증.
  if (!cust) return;
  const res = await app.request(`/api/customers/${cust.id}/quote-requests`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Array<{ id: string; optionCount: number; matchType: string }>;
  expect(Array.isArray(body)).toBe(true);
  for (const r of body) {
    expect(typeof r.id).toBe("string");
    expect(typeof r.optionCount).toBe("number");
    expect(["app_user", "phone", "none"]).toContain(r.matchType);
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: FAIL — 라우트 미등록이라 404/401 외 케이스가 깨지거나 라우트가 아예 없음.

- [ ] **Step 3: `getCustomerAppUserId` 쿼리 추가**

`src/db/queries/customers.ts`에 추가(`getCustomer` 함수 위, `listCustomers` 아래 등 적당한 위치). 반환값: 고객 없으면 `null`(라우트가 404), 있으면 `{ appUserId: string | null }`.

```ts
// 고객의 app_user_id만 조회. 없는 고객은 null(라우트 404), 있으면 {appUserId}(null이면 수기 고객).
export async function getCustomerAppUserId(
  id: string,
  executor: Executor = getDefaultDb(),
): Promise<{ appUserId: string | null } | null> {
  const [row] = await executor.select({ appUserId: customers.appUserId }).from(customers).where(eq(customers.id, id));
  return row ?? null;
}
```

- [ ] **Step 4: 라우트 추가**

`src/routes/customers.ts`:

1. import 수정 — `getCustomer, listCustomers, updateCustomer` 옆에 `getCustomerAppUserId` 추가, 그리고 `listQuoteRequestsByUser` import 추가:

```ts
import { getCustomer, getCustomerAppUserId, listCustomers, updateCustomer } from "../db/queries/customers";
import { listQuoteRequestsByUser } from "../db/queries/quote-requests";
```

2. `GET /:id` 라우트(41~42행) 바로 아래에 추가:

```ts
// 고객 상세 니즈 영역: 그 고객(app_user_id)의 앱 견적요청 목록. 수기 고객(app_user 없음)은 빈 배열.
customers.get("/:id/quote-requests", zValidator("param", z.object({ id: z.uuid() })), (c) =>
  run(
    c,
    async () => {
      const found = await getCustomerAppUserId(c.req.valid("param").id, c.var.db);
      if (!found) return null; // 고객 없음 → 404
      return found.appUserId ? listQuoteRequestsByUser(found.appUserId, c.var.db) : [];
    },
    "고객을 찾을 수 없습니다.",
  ),
);
```

> 주의: `run`은 결과가 `null`이고 notFoundMsg가 있으면 404, `[]`(빈 배열)은 `[] ?? null === []`라 200으로 나간다. 그래서 "고객 없음=null=404", "app_user 없음=[]=200"이 정확히 구분된다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: PASS(기존 + 신규 4개).

- [ ] **Step 6: typecheck + 커밋**

```bash
bun run typecheck
git add src/db/queries/customers.ts src/routes/customers.ts src/routes/customers.test.ts
git commit -m "$(cat <<'EOF'
feat(crm): GET /api/customers/:id/quote-requests — 고객별 앱 견적요청

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 프론트 lib — `appUserId` 노출 + `fetchCustomerQuoteRequests`

**Files:**
- Modify: `client/src/lib/customers.ts`
- Modify: `client/src/lib/quote-requests.ts`
- Test: `client/src/lib/customers.test.ts`
- Test: `client/src/lib/quote-requests.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (customers — appUserId)**

`client/src/lib/customers.test.ts`의 `detailRes` mock(72~136행)에 `appUserId` 추가, `toCustomerDetail` describe에 단언 추가:

```ts
// detailRes mock: receivedAt 줄 아래(또는 적당한 위치)에 추가
  appUserId: "user-1",
```

```ts
// describe("toCustomerDetail", ...) 안에 추가
  it("appUserId를 그대로 전달(앱 유입 여부 분기용)", () => {
    expect(toCustomerDetail(detailRes).appUserId).toBe("user-1");
    expect(toCustomerDetail({ ...detailRes, appUserId: null }).appUserId).toBeNull();
  });
```

- [ ] **Step 2: 실패 테스트 작성 (quote-requests — fetchCustomerQuoteRequests)**

`client/src/lib/quote-requests.test.ts`: 상단 import에 `fetchCustomerQuoteRequests` 추가, 맨 아래 describe 추가:

```ts
// import 수정:
// import { fetchCustomerQuoteRequests, fetchQuoteRequestDetail, toAppQuoteRequest, type AppQuoteRequestRow } from "./quote-requests";

describe("fetchCustomerQuoteRequests", () => {
  it("GET /api/customers/:id/quote-requests 호출 + 어댑터 적용", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify([base]), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const list = await fetchCustomerQuoteRequests("cust-1");
    expect((spy.mock.calls[0] as unknown[])[0]).toBe("/api/customers/cust-1/quote-requests");
    expect(list).toHaveLength(1);
    expect(list[0].vehicleLabel).toBe("기아 쏘렌토 · 26년형 노블레스"); // toAppQuoteRequest 적용 확인
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `bun run test:unit client/src/lib/customers.test.ts client/src/lib/quote-requests.test.ts`
Expected: FAIL — `appUserId` 미정의 + `fetchCustomerQuoteRequests` 미export.

- [ ] **Step 4: `customers.ts` 구현**

`client/src/lib/customers.ts`:

1. `CustomerDetailResponse` 타입(86~108행)에 `appUserId` 추가 — `id` 아래:

```ts
export type CustomerDetailResponse = {
  id: string;
  appUserId: string | null;
  customerCode: string;
  // ...기존 필드 그대로...
};
```

2. `CustomerDetailData`의 `Pick`(110~133행) 목록에 `"appUserId"` 추가 — `"id"` 다음 줄:

```ts
export type CustomerDetailData = Pick<
  CustomerDetailResponse,
  | "id"
  | "appUserId"
  | "customerCode"
  // ...기존 그대로...
>;
```

3. `toCustomerDetail`(135~159행) 반환 객체에 `appUserId` 추가 — `id: res.id,` 아래:

```ts
  return {
    id: res.id,
    appUserId: res.appUserId,
    customerCode: res.customerCode,
    // ...기존 그대로...
  };
```

- [ ] **Step 5: `quote-requests.ts` 구현**

`client/src/lib/quote-requests.ts`: `fetchAppQuoteRequests`(104~106행) 아래에 추가:

```ts
// 고객 상세 니즈 영역: 그 고객의 앱 견적요청 카드 목록. listQuoteRequests 어댑터 재사용.
export async function fetchCustomerQuoteRequests(customerId: string): Promise<AppQuoteRequest[]> {
  return (await getJson<AppQuoteRequestRow[]>(`/api/customers/${customerId}/quote-requests`)).map(toAppQuoteRequest);
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `bun run test:unit client/src/lib/customers.test.ts client/src/lib/quote-requests.test.ts`
Expected: PASS.

- [ ] **Step 7: typecheck + 커밋**

```bash
bun run typecheck
git add client/src/lib/customers.ts client/src/lib/quote-requests.ts client/src/lib/customers.test.ts client/src/lib/quote-requests.test.ts
git commit -m "$(cat <<'EOF'
feat(crm): 프론트 lib — detail.appUserId 노출 + fetchCustomerQuoteRequests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 프론트 UI — 니즈 영역 분기(앱 요청 카드) + 워크벤치 직접 오픈

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`
- Modify: `client/src/index.css`

> 거대 페이지 컴포넌트라 단위테스트 대신 typecheck/lint/build + 수동(브라우저) 검증. (프로젝트 관례: 거대 페이지는 수동/스크린샷.)

- [ ] **Step 1: import 추가**

`CustomerDetailPage.tsx` 상단 — `@/lib/quote-requests` import(현재 10행 `import { fetchQuoteRequestDetail, fetchAppQuoteRequestsCached } from "@/lib/quote-requests";`)를 아래로 교체:

```ts
import { fetchCustomerQuoteRequests, fetchQuoteRequestDetail, fetchAppQuoteRequestsCached, type AppQuoteRequest } from "@/lib/quote-requests";
```

- [ ] **Step 2: `openWorkbenchForQuoteRequest` 함수 추출 (동작 보존 리팩토링)**

기존 URL 효과(938~975행)에서 `.then` 본문을 함수로 추출한다. URL 효과는 그 함수를 호출하도록 바꾸되 **finally의 navigate(URL 정리)는 효과에만 남긴다**. 938~975행을 아래로 교체:

```ts
  // 앱 견적요청 → 워크벤치 prefill 오픈(차량/구매방식/옵션). 가격은 catalog 계산 보존.
  // 인박스 진입(URL ?quoteRequest=) + 니즈 카드 "견적 작성" 양쪽이 호출. hoisted 함수(useCallback 미사용 — 기존 패턴).
  function openWorkbenchForQuoteRequest(reqId: string): Promise<void> {
    return fetchQuoteRequestDetail(reqId).then((detail) => {
      // 신규 워크벤치 열기와 동일한 리셋(견적함 + 버튼 onClick과 정렬)
      setConfirmingQuoteDeleteId(null);
      setEditingQuoteId(null);
      persistedQuoteIdRef.current = null;
      setEditPrefill(null);
      resetWorkbenchVehicle();
      setGuidance(DEFAULT_QUOTE_GUIDANCE);
      setManualQuoteCards([...kimManualQuoteConditionCards]);
      setManualTermMonths({});
      setSavedManualQuoteConditionIds([]);
      setRecognizedQuoteFile(null);
      setSolutionWorkbenchEntryMode("manual");
      setSolutionWorkbenchModeMenu(null);
      setSolutionWorkbenchPurchaseMethod(primaryKimQuotePurchaseMethod(purchaseFields)); // 고객 기본값 먼저(+onClick과 동일)
      // 견적요청 prefill 설정
      setQuoteRequestPrefill({ trimId: detail.trimId, optionIds: detail.optionIds });
      setSourceQuoteRequestId(reqId);
      // purchaseMethod(한글)가 워크벤치 옵션 목록에 있으면 override, 없으면 위 고객 기본값 유지(stale 방지).
      if (detail.purchaseMethod && kimQuotePurchaseMethodOptions.includes(detail.purchaseMethod as KimQuotePurchaseMethod)) {
        setSolutionWorkbenchPurchaseMethod(detail.purchaseMethod as KimQuotePurchaseMethod);
      }
      setIsQuoteSolutionWorkbenchOpen(true);
    });
  }

  // 앱 견적요청 승격(S3): 인박스에서 /customer-detail/:code?quoteRequest=<id>로 진입하면 워크벤치 prefill 오픈.
  const location = useLocation();
  const navigate = useNavigate();
  const quoteRequestPrefillRef = useRef(false); // StrictMode/재렌더 중복 방지
  useEffect(() => {
    const reqId = new URLSearchParams(location.search).get("quoteRequest");
    if (!reqId || quoteRequestPrefillRef.current) return;
    quoteRequestPrefillRef.current = true;
    let cancelled = false; // unmount/이동 가드(quoteRequestPrefillRef 중복방지와 별개)
    void openWorkbenchForQuoteRequest(reqId)
      .catch(() => { if (!cancelled) onToast("견적요청 정보를 불러오지 못했습니다."); })
      .finally(() => {
        // URL에서 파라미터 제거(뒤로가기/재렌더 재오픈 방지). unmount 후엔 navigate 금지.
        if (!cancelled) navigate(`/customer-detail/${customer.customerId}`, { replace: true });
      });
    return () => { cancelled = true; };
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps -- 진입 시 1회 prefill
```

> `cancelled` 가드가 `openWorkbenchForQuoteRequest`의 `.then`(상태 set) 자체는 막지 않지만, 기존 코드도 동일했다(가드는 navigate/onToast에만 적용). 동작 보존.

- [ ] **Step 3: typecheck로 추출 회귀 확인**

Run: `bun run typecheck`
Expected: 0 errors. (URL 효과 동작이 동일함을 타입/구조로 확인. 브라우저 인박스 진입 검증은 머지 후 수동.)

- [ ] **Step 4: appRequests 상태 + 로드 효과 + 재로드 함수 추가**

`needs` state 선언(714~720행) 아래(또는 상태 선언부 적당한 위치)에 추가:

```ts
  // 앱 유입 고객(detail.appUserId)이면 그 고객의 앱 견적요청 카드 목록. 수기 고객은 null → 기존 단일 need 카드.
  const [appRequests, setAppRequests] = useState<AppQuoteRequest[] | null>(null);
```

`openWorkbenchForQuoteRequest` 근처(URL 효과 아래)에 로드 효과 + 재로드 함수 추가:

```ts
  // detail.appUserId 있으면 그 고객 요청 fetch(카드 목록). 없으면 null 유지(폴백 단일 카드).
  useEffect(() => {
    if (!detail.appUserId) { setAppRequests(null); return; }
    let cancelled = false;
    void fetchCustomerQuoteRequests(customer.id)
      .then((r) => { if (!cancelled) setAppRequests(r); })
      .catch(() => { if (!cancelled) setAppRequests([]); });
    return () => { cancelled = true; };
  }, [detail.appUserId, customer.id]); // eslint-disable-line react-hooks/exhaustive-deps -- appUserId/고객 변경 시 재로드

  // 견적 승격 성공 후 배지(견적 N건) 갱신용 재fetch. 앱 고객일 때만 의미.
  function reloadAppRequests() {
    if (!detail.appUserId) return;
    void fetchCustomerQuoteRequests(customer.id).then(setAppRequests).catch(() => undefined);
  }
```

- [ ] **Step 5: 승격 저장 후 배지 재fetch 연결**

`persistWorkbenchQuote`의 신규 INSERT `.then` 안(2340행 `if (sourceQuoteRequestId) void fetchAppQuoteRequestsCached(true); ...`)에 `reloadAppRequests()` 추가:

```ts
            if (sourceQuoteRequestId) { void fetchAppQuoteRequestsCached(true); reloadAppRequests(); } // 견적요청→견적 INSERT 시 인박스 캐시 + 니즈 카드 배지 갱신
```

- [ ] **Step 6: 니즈 영역 렌더 분기**

기존 니즈 섹션(3672~3693행)을 아래로 교체. 수기 분기(else)는 **기존 마크업 그대로**, 앱 분기(if)만 신규:

```tsx
      <section className="detail-section kim-needs-dashboard">
        <div className="kim-needs-field">
          {detail.appUserId ? (
            <div className="kim-needs-request-list">
              {appRequests === null ? (
                <p className="kim-needs-request-status">앱 견적요청 불러오는 중…</p>
              ) : appRequests.length === 0 ? (
                <p className="kim-needs-request-status">앱 견적요청이 없습니다.</p>
              ) : (
                appRequests.map((req) => (
                  <div className="kim-needs-floating-card kim-needs-request-card" key={req.id}>
                    <div className="kim-needs-card-main">
                      <span className="kim-needs-car-icon" aria-hidden="true"><CarFront size={22} strokeWidth={2.1} /></span>
                      <div className="kim-needs-card-copy">
                        <h3>{req.vehicleLabel}</h3>
                        <p>{req.paymentLabel} · 옵션 {req.optionLabel}</p>
                        <span>{req.periodLabel} · {req.depositLabel}</span>
                      </div>
                      <div className="kim-needs-request-actions">
                        {req.promotedQuoteCount > 0 ? (
                          <span className="kim-needs-request-badge">견적 {req.promotedQuoteCount}건</span>
                        ) : null}
                        <button
                          className="kim-needs-request-create"
                          onClick={() => { void openWorkbenchForQuoteRequest(req.id).catch(() => onToast("견적요청 정보를 불러오지 못했습니다.")); }}
                          type="button"
                        >
                          견적 작성
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
              {/* 문의사항·관심 색상은 고객 단위(요청별 아님) — 카드 아래 유지 */}
              <div className="kim-needs-customer-meta">
                <div className="kim-needs-card-memo">
                  <span>문의사항</span>
                  <p>{needs.memo || "—"}</p>
                </div>
                <div className="kim-needs-card-memo">
                  <span>관심 색상</span>
                  <p>{needs.colors}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="kim-edit-anchor needs" ref={openEditor?.kind === "needs" ? editorRef : undefined}>
              <button className="kim-needs-floating-card" onClick={() => toggleEditor({ kind: "needs" })} type="button">
                <div className="kim-needs-card-main">
                  <span className="kim-needs-car-icon" aria-hidden="true"><CarFront size={22} strokeWidth={2.1} /></span>
                  <div className="kim-needs-card-copy">
                    <h3>{needs.model}</h3>
                    <p>{needs.trim}</p>
                    <span>{needs.colors}</span>
                  </div>
                  <span className="kim-needs-method-badge">{needs.method}</span>
                </div>
                <div className="kim-needs-card-memo">
                  <span>문의사항</span>
                  <p>{needs.memo}</p>
                </div>
              </button>
              {openEditor?.kind === "needs" ? renderNeedsEditor() : null}
            </div>
          )}
        </div>
      </section>
```

> 앱 분기에서 문의사항/색상은 **읽기 전용**으로 노출(스펙: 고객 단위 유지·안 빠짐). 앱 고객의 need_memo 편집은 후속(범위 밖) — 기존 needs 편집 popover는 need_model까지 함께 수정해 카드 목록과 의미가 어긋나므로 앱 분기에선 비노출.

- [ ] **Step 7: CSS 추가**

`client/src/index.css`의 `.kim-needs-card-memo p { ... }`(6790~6800행) 블록 **아래**에 추가:

```css
.kim-needs-request-list {
  width: 100%;
  max-height: calc(100% - 48px);
  display: grid;
  gap: 10px;
  overflow-y: auto;
}

.kim-needs-request-card {
  max-height: none;
}

.kim-needs-request-status {
  margin: 0;
  padding: 18px 10px;
  text-align: center;
  color: #8f969c;
  font-size: 12.5px;
  font-weight: 650;
}

.kim-needs-request-actions {
  display: grid;
  justify-items: end;
  align-content: start;
  gap: 6px;
}

.kim-needs-request-badge {
  border: 1px solid rgba(var(--brand-rgb), 0.26);
  border-radius: 6px;
  background: #f4f1ff;
  color: var(--brand);
  padding: 2px 7px;
  font-size: 10.5px;
  font-weight: 800;
  white-space: nowrap;
}

.kim-needs-request-create {
  min-height: 28px;
  border: 1px solid rgba(var(--brand-rgb), 0.26);
  border-radius: 7px;
  background: var(--brand);
  color: #fff;
  padding: 0 12px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 800;
  line-height: 26px;
  white-space: nowrap;
  cursor: pointer;
  transition: filter 0.14s ease, box-shadow 0.14s ease;
}

.kim-needs-request-create:hover {
  filter: brightness(1.06);
  box-shadow: 0 0 0 3px rgba(var(--brand-rgb), 0.12);
}

.kim-needs-customer-meta {
  border: 1px solid #dededb;
  border-radius: 7px;
  background: #fff;
  display: grid;
  gap: 2px;
}

.kim-needs-customer-meta .kim-needs-card-memo:first-child {
  border-top: 0;
}
```

- [ ] **Step 8: 검증**

```bash
bun run typecheck
bun run lint
bun run build
```
Expected: typecheck 0 errors · lint 0 problems · build OK.

- [ ] **Step 9: 커밋**

```bash
git add client/src/pages/CustomerDetailPage.tsx client/src/index.css
git commit -m "$(cat <<'EOF'
feat(crm): 고객 니즈 영역 — 앱 유입 고객은 견적요청 카드 목록

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 최종 검증 (전 태스크 후)

```bash
bun run typecheck   # 0 errors
bun run lint        # 0 problems
bun test --env-file=.env.local   # 서버: 기존 + 신규(quote-requests 3 · customers 4)
bun run test:unit   # 프론트: 기존 + 신규(customers 1 · quote-requests 1)
bun run build       # OK
```

**브라우저 수동 검증(유슨생, 배포 후):**
- 김지안(앱 유입, 4 차종 요청) 상세 니즈 영역에 요청 카드 4개 + 문의사항/색상 유지.
- 카드 "견적 작성" → 워크벤치가 그 요청 차량/구매방식/옵션 prefill로 열림(여러 카드 각각 동작).
- 승격 후 그 카드에 "견적 N건" 배지.
- 김민준(수기) 상세 니즈 = 기존 단일 카드 + needs 편집 popover 회귀 없음.
- 인박스(`?quoteRequest=`) 진입 승격도 기존대로 동작(추출 회귀 없음).

---

## Self-Review (작성자 점검 결과)

**1. Spec coverage:**
- 데이터 소스 분기(app_user 있음/없음) → Task 3(appUserId 노출) + Task 4(렌더 분기). ✅
- 카드 내용(차종·트림·구매방식·옵션·조건, read) → Task 4 Step 6(어댑터 라벨 사용). ✅
- 카드 "견적 작성" + 배지 → Task 4 Step 2/5/6. ✅
- 문의사항/색상 고객 단위 유지 → Task 4 Step 6(카드 아래 read-only). ✅
- 백엔드 `listQuoteRequestsByUser`(공통 헬퍼) → Task 1. ✅
- 라우트 `GET /:id/quote-requests` → Task 2. ✅
- `fetchCustomerQuoteRequests` → Task 3. ✅
- 엣지(app_user 0건→빈 안내, read-only, 승격 후 배지 갱신, 수기 회귀 없음) → Task 4. ✅

**2. Placeholder scan:** 없음(모든 코드 완전). ✅

**3. Type consistency:** `AppQuoteRequest`/`AppQuoteRequestRow`(quote-requests.ts), `listQuoteRequestsByUser(appUserId, executor)`, `getCustomerAppUserId → {appUserId}|null`, `CustomerDetailData.appUserId: string|null`, `fetchCustomerQuoteRequests(customerId): Promise<AppQuoteRequest[]>` — 태스크 간 시그니처 일치. ✅

**범위 밖(스펙 일치):** 처리 카드 접기/필터, 수기 고객 여러 차종 입력, 앱 분기 need_memo 편집, 관리상태 통일.
