# 앱 견적요청 인박스(S1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱(public.quote_requests)에서 만든 고객 견적요청을 CRM이 직접 read 해 별도 '앱 요청' 메뉴의 인박스 목록으로 보여준다(읽기 전용, 마이그레이션 0).

**Architecture:** 검증된 read 3계층(catalog/customers-read). public(앱) 테이블을 read 전용 drizzle 정의(`src/db/public-app.ts`, catalog.ts와 동일하게 메인 generate에서 격리) → `listQuoteRequests`가 public+catalog+crm 3스키마를 단일 연결로 batch read(N+1 회피) → `GET /api/quote-requests` → 프론트 어댑터가 앱 enum을 한글로 변환. 쓰기/유입/승격은 S2/S3.

**Tech Stack:** Hono + drizzle-orm(postgres-js) 백엔드, bun:test 서버 테스트(실 DB, `--env-file=.env.local`), React + react-router + vitest 프론트.

**Spec:** `ref/specs/2026-06-27-crm-app-quote-requests-inbox-design.md`

---

## File Structure

- `src/db/public-app.ts` — **신규**. public(앱) read 전용 drizzle 정의 3테이블(`quoteRequests`·`quoteRequestOptions`·`profiles`). catalog.ts 패턴. 메인 `drizzle.config.ts`(schema=schema.ts, schemaFilter crm)에 안 잡혀 마이그레이션 대상 아님.
- `src/db/queries/quote-requests.ts` — **신규**. `listQuoteRequests(executor)` + `AppQuoteRequestRow` 타입.
- `src/routes/quote-requests.ts` — **신규**. `GET /api/quote-requests`.
- `src/routes/quote-requests.test.ts` — **신규**. 라우트 200·배열·필드·401 서버 테스트(실 DB).
- `src/app.ts` — 라우트 마운트(auth+db 미들웨어 + route) 추가 (수정).
- `client/src/lib/quote-requests.ts` — **신규**. `AppQuoteRequestRow`(응답)·`AppQuoteRequest`(UI) 타입 + enum 한글 매핑 + 어댑터 `toAppQuoteRequest` + `fetchAppQuoteRequests`.
- `client/src/lib/quote-requests.test.ts` — **신규**. `toAppQuoteRequest` 단위테스트.
- `client/src/pages/AppRequestsPage.tsx` — **신규**. 인박스 목록 페이지.
- `client/src/App.tsx` — `ViewKey`/`VIEW_TO_PATH`/`viewMeta`/`Routes`/import에 app-requests 추가 (수정).
- `client/src/components/Sidebar.tsx` — '앱 요청' nav 버튼 추가 (수정).
- `client/src/index.css` — 인박스 목록 스타일 (수정).

---

## Task 1: 백엔드 — public read 정의 + 쿼리 + 라우트

**Files:**
- Create: `src/db/public-app.ts`, `src/db/queries/quote-requests.ts`, `src/routes/quote-requests.ts`, `src/routes/quote-requests.test.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: 서버 테스트 작성 (실패 확인용)**

Create `src/routes/quote-requests.test.ts`:

```ts
import { test, expect } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";

test("GET /api/quote-requests → 200, 배열", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/quote-requests", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

test("GET /api/quote-requests 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/quote-requests");
  expect(res.status).toBe(401);
});

test("GET /api/quote-requests → 행 형태(차량명/옵션수/매칭)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/quote-requests", { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as Array<{
    id: string; createdAt: string; optionCount: number;
    matchType: string; brandName: string | null; status: string | null;
  }>;
  expect(body.length).toBeGreaterThan(0);
  for (const r of body) {
    expect(typeof r.id).toBe("string");
    expect(typeof r.optionCount).toBe("number");
    expect(["app_user", "phone", "none"]).toContain(r.matchType);
  }
  // trim_id가 전부 non-null이라 최소 1건은 차량명이 채워진다.
  expect(body.some((r) => r.brandName != null)).toBe(true);
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `bun run test:server`
Expected: 새 3개 테스트 FAIL (라우트 미존재 → 200 테스트는 404, 401 테스트는 통과할 수도 있으나 200/행 테스트는 실패).

- [ ] **Step 3: public read 전용 drizzle 정의 생성**

Create `src/db/public-app.ts`:

```ts
// public(앱) 스키마 read 전용 drizzle 정의. 앱(master Supabase)이 소유.
// CRM은 앱 견적요청 인박스(S1)에서 read만 한다(복사/sync 금지 — 차량 catalog와 동일 철학).
// crm/catalog와 별도 파일이라 메인 drizzle.config.ts(schema=schema.ts, schemaFilter:["crm"])
// generate에 잡히지 않는다 → 마이그레이션 대상 아님. 구조 변경은 앱팀 소유.
// 주의: profiles.role은 public.user_role enum이나 read 전용이라 text로 모델(catalog status와 동일 방침).

import { bigint, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const quoteRequests = pgTable("quote_requests", {
  id: uuid().primaryKey(),
  userId: uuid("user_id").notNull(),
  trimId: bigint("trim_id", { mode: "number" }),
  paymentMethod: text("payment_method"),
  rentalDeposit: bigint("rental_deposit", { mode: "number" }),
  status: text(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  period: integer(),
  depositType: text("deposit_type"),
  trimPrice: bigint("trim_price", { mode: "number" }),
});

export const quoteRequestOptions = pgTable("quote_request_options", {
  id: bigint({ mode: "number" }).primaryKey(),
  quoteRequestId: uuid("quote_request_id").notNull(),
  trimOptionId: bigint("trim_option_id", { mode: "number" }),
  optionName: text("option_name").notNull(),
  optionType: text("option_type").notNull(),
  priceAtRequest: bigint("price_at_request", { mode: "number" }).notNull(),
});

export const profiles = pgTable("profiles", {
  id: uuid().primaryKey(),
  email: text(),
  username: text(),
  role: text(),
  fullName: text("full_name"),
  phoneNumber: text("phone_number"),
});
```

- [ ] **Step 4: listQuoteRequests 쿼리 작성**

Create `src/db/queries/quote-requests.ts`:

```ts
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
```

참고: `or(undefined, expr)` — drizzle은 undefined 항을 무시한다. `userIds`는 `rows.length>0`이면 항상 1개 이상이라 where가 빈 조건이 되지 않는다(전체 스캔 안전).

- [ ] **Step 5: 라우트 작성**

Create `src/routes/quote-requests.ts`:

```ts
import { Hono } from "hono";

import { listQuoteRequests } from "../db/queries/quote-requests";
import type { DbVariables } from "../middleware/db";
import { run } from "./shared";

export const quoteRequests = new Hono<{ Variables: DbVariables }>();

quoteRequests.get("/", (c) => run(c, () => listQuoteRequests(c.var.db)));
```

- [ ] **Step 6: app.ts에 마운트**

`src/app.ts` 수정 — import 추가(customers import 아래):

```ts
import { quoteRequests } from "./routes/quote-requests";
```

미들웨어 블록에 추가(`app.use("/api/customers/*", dbMiddleware);` 아래):

```ts
  app.use("/api/quote-requests/*", auth);
  app.use("/api/quote-requests/*", dbMiddleware);
```

라우트 마운트에 추가(`app.route("/api/customers", customers);` 아래):

```ts
  app.route("/api/quote-requests", quoteRequests);
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `bun run test:server`
Expected: 새 3개 테스트 PASS(기존 테스트도 그대로 통과). 실 DB 97건이라 `body.length>0`·`brandName` 일부 채워짐 충족.

- [ ] **Step 8: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 errors, 0 problems.

- [ ] **Step 9: 커밋**

```bash
git add src/db/public-app.ts src/db/queries/quote-requests.ts src/routes/quote-requests.ts src/routes/quote-requests.test.ts src/app.ts
git commit -m "feat(crm): 앱 견적요청 인박스(S1) 백엔드 read — public.quote_requests 직접 조회"
```

---

## Task 2: 프론트 — lib 어댑터 + 단위테스트

**Files:**
- Create: `client/src/lib/quote-requests.ts`, `client/src/lib/quote-requests.test.ts`

- [ ] **Step 1: 어댑터 테스트 작성 (실패 확인용)**

Create `client/src/lib/quote-requests.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { toAppQuoteRequest, type AppQuoteRequestRow } from "./quote-requests";

const base: AppQuoteRequestRow = {
  id: "q1",
  createdAt: "2026-06-25T04:02:34.633288+00:00",
  requesterName: "제임스",
  requesterPhone: null,
  paymentMethod: "lease",
  period: 60,
  depositType: "advance",
  rentalDeposit: 5598000,
  trimPrice: 186600000,
  status: "open",
  brandName: "기아",
  modelName: "쏘렌토",
  trimName: "26년형 노블레스",
  optionCount: 3,
  matchedCustomerId: null,
  matchedCustomerName: null,
  matchedCustomerCode: null,
  matchType: "none",
};

describe("toAppQuoteRequest", () => {
  it("payment_method 4종 한글", () => {
    expect(toAppQuoteRequest({ ...base, paymentMethod: "lease" }).paymentLabel).toBe("운용리스");
    expect(toAppQuoteRequest({ ...base, paymentMethod: "rent" }).paymentLabel).toBe("장기렌트");
    expect(toAppQuoteRequest({ ...base, paymentMethod: "installment" }).paymentLabel).toBe("할부");
    expect(toAppQuoteRequest({ ...base, paymentMethod: "cash" }).paymentLabel).toBe("일시불");
    expect(toAppQuoteRequest({ ...base, paymentMethod: null }).paymentLabel).toBe("—");
  });

  it("deposit_type 3종 + 금액 결합", () => {
    expect(toAppQuoteRequest({ ...base, depositType: "deposit" }).depositLabel).toBe("보증금 559만원");
    expect(toAppQuoteRequest({ ...base, depositType: "advance", rentalDeposit: 0 }).depositLabel).toBe("선수금");
    expect(toAppQuoteRequest({ ...base, depositType: null, rentalDeposit: 0 }).depositLabel).toBe("—");
  });

  it("status 3종 한글", () => {
    expect(toAppQuoteRequest({ ...base, status: "open" }).statusLabel).toBe("진행중");
    expect(toAppQuoteRequest({ ...base, status: "closed" }).statusLabel).toBe("마감");
    expect(toAppQuoteRequest({ ...base, status: "completed" }).statusLabel).toBe("완료");
  });

  it("차량/기간/옵션/차량가 라벨", () => {
    const r = toAppQuoteRequest(base);
    expect(r.vehicleLabel).toBe("기아 쏘렌토 · 26년형 노블레스");
    expect(r.periodLabel).toBe("60개월");
    expect(r.optionLabel).toBe("3개");
    expect(r.trimPriceLabel).toBe("1억 8,660만원");
    expect(toAppQuoteRequest({ ...base, period: null, optionCount: 0 }).periodLabel).toBe("—");
    expect(toAppQuoteRequest({ ...base, optionCount: 0 }).optionLabel).toBe("없음");
  });

  it("매칭 3분기", () => {
    expect(toAppQuoteRequest(base).matchLabel).toBe("신규(미연결)");
    expect(toAppQuoteRequest({ ...base, matchType: "phone", matchedCustomerName: "한소희" }).matchLabel).toBe("기존 고객 한소희(추정)");
    expect(toAppQuoteRequest({ ...base, matchType: "app_user", matchedCustomerName: "한소희" }).matchLabel).toBe("연결됨 한소희");
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `bun run test:unit client/src/lib/quote-requests.test.ts`
Expected: FAIL ("Cannot find module './quote-requests'" 또는 export 없음).

- [ ] **Step 3: lib 어댑터 구현**

Create `client/src/lib/quote-requests.ts`:

```ts
import { formatActivity } from "./customers";
import { getJson } from "./http";
import { formatPriceRangeKorean } from "./price-format";

// 백엔드 listQuoteRequests 응답 1행(camelCase, null 가능).
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

// 앱 enum → 한글. Flutter 앱 SSOT(purchase_method.dart / deposit_type.dart / quote_status.dart)와 일치.
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  lease: "운용리스",
  rent: "장기렌트",
  installment: "할부",
  cash: "일시불",
};
const DEPOSIT_TYPE_LABEL: Record<string, string> = {
  deposit: "보증금",
  advance: "선수금",
  prepayment: "선납금",
};
const STATUS_LABEL: Record<string, string> = {
  open: "진행중",
  closed: "마감",
  completed: "완료",
};

// 화면 표시용 견적요청 1행.
export type AppQuoteRequest = {
  id: string;
  createdAt: string;
  requesterName: string;
  vehicleLabel: string;
  paymentLabel: string;
  periodLabel: string;
  depositLabel: string;
  trimPriceLabel: string;
  optionLabel: string;
  statusLabel: string;
  matchLabel: string;
  matchType: AppQuoteRequestRow["matchType"];
};

function moneyOrDash(won: number | null): string {
  return won != null && won > 0 ? formatPriceRangeKorean(won, null) : "—";
}

export function toAppQuoteRequest(row: AppQuoteRequestRow): AppQuoteRequest {
  const vehicleLabel =
    [row.brandName, row.modelName].filter(Boolean).join(" ") +
    (row.trimName ? ` · ${row.trimName}` : "");
  const depositName = row.depositType ? (DEPOSIT_TYPE_LABEL[row.depositType] ?? row.depositType) : null;
  const depositMoney = row.rentalDeposit != null && row.rentalDeposit > 0 ? ` ${formatPriceRangeKorean(row.rentalDeposit, null)}` : "";
  const matchLabel =
    row.matchType === "app_user"
      ? `연결됨 ${row.matchedCustomerName ?? ""}`.trim()
      : row.matchType === "phone"
        ? `기존 고객 ${row.matchedCustomerName ?? ""}(추정)`
        : "신규(미연결)";
  return {
    id: row.id,
    createdAt: formatActivity(row.createdAt),
    requesterName: row.requesterName ?? "이름없음",
    vehicleLabel: vehicleLabel || "차량 미지정",
    paymentLabel: row.paymentMethod ? (PAYMENT_METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod) : "—",
    periodLabel: row.period != null ? `${row.period}개월` : "—",
    depositLabel: depositName ? `${depositName}${depositMoney}` : "—",
    trimPriceLabel: moneyOrDash(row.trimPrice),
    optionLabel: row.optionCount > 0 ? `${row.optionCount}개` : "없음",
    statusLabel: row.status ? (STATUS_LABEL[row.status] ?? row.status) : "—",
    matchLabel,
    matchType: row.matchType,
  };
}

export async function fetchAppQuoteRequests(): Promise<AppQuoteRequest[]> {
  return (await getJson<AppQuoteRequestRow[]>("/api/quote-requests")).map(toAppQuoteRequest);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:unit client/src/lib/quote-requests.test.ts`
Expected: PASS (전 케이스). `formatPriceRangeKorean(5598000, null)`="559만원", `(186600000,null)`="1억 8,660만원" 확인.

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/quote-requests.ts client/src/lib/quote-requests.test.ts
git commit -m "feat(crm): 앱 견적요청 어댑터(enum 한글·매칭·금액) + 단위테스트"
```

---

## Task 3: 프론트 — 인박스 페이지 + 사이드메뉴 + 라우팅

**Files:**
- Create: `client/src/pages/AppRequestsPage.tsx`
- Modify: `client/src/App.tsx`, `client/src/components/Sidebar.tsx`, `client/src/index.css`

- [ ] **Step 1: 인박스 페이지 작성**

Create `client/src/pages/AppRequestsPage.tsx`:

```tsx
import { useEffect, useState } from "react";

import { fetchAppQuoteRequests, type AppQuoteRequest } from "@/lib/quote-requests";

const MATCH_CLASS: Record<AppQuoteRequest["matchType"], string> = {
  app_user: "app-req-match linked",
  phone: "app-req-match maybe",
  none: "app-req-match none",
};

export function AppRequestsPage() {
  const [rows, setRows] = useState<AppQuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    fetchAppQuoteRequests()
      .then((data) => {
        if (alive) setRows(data);
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="app-requests-page">
      <div className="app-requests-head">
        <strong>앱 견적요청</strong>
        <span className="app-requests-count">{loading ? "불러오는 중…" : `${rows.length}건`}</span>
      </div>
      {error ? (
        <div className="app-requests-empty">불러오지 못했습니다. 새로고침해 주세요.</div>
      ) : loading ? (
        <div className="app-requests-empty">불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div className="app-requests-empty">앱에서 들어온 견적요청이 없습니다.</div>
      ) : (
        <table className="app-requests-table">
          <thead>
            <tr>
              <th>요청일</th>
              <th>요청자</th>
              <th>차량</th>
              <th>구매방식</th>
              <th>조건</th>
              <th>옵션</th>
              <th>상태</th>
              <th>매칭</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="app-req-date">{r.createdAt}</td>
                <td>{r.requesterName}</td>
                <td className="app-req-vehicle">{r.vehicleLabel}</td>
                <td>{r.paymentLabel}</td>
                <td className="app-req-terms">
                  <span>{r.periodLabel}</span>
                  <span className="app-req-sub">{r.depositLabel}</span>
                </td>
                <td>{r.optionLabel}</td>
                <td>{r.statusLabel}</td>
                <td>
                  <span className={MATCH_CLASS[r.matchType]}>{r.matchLabel}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: App.tsx 배선**

`client/src/App.tsx` 수정:

(a) import 추가(`import { AISettingsPage } ...` 인접 페이지 import 블록에):

```ts
import { AppRequestsPage } from "@/pages/AppRequestsPage";
```

(b) `ViewKey` 유니온에 `"app-requests"` 추가(`"customers" |` 뒤):

```ts
type ViewKey = "advisor-dashboard" | "dashboard-preview" | "admin-dashboard" | "chat" | "customers" | "app-requests" | "customer-detail" | "pipeline" | "quotes" | "delivery" | "insights" | "knowledge-base" | "ai-settings" | "mc-master" | "org-members" | "partners" | "finance";
```

(c) `VIEW_TO_PATH`에 추가(`customers: "/customers",` 아래):

```ts
  "app-requests": "/app-requests",
```

(d) `viewMeta`에 추가(`customers: [...]` 아래):

```ts
  "app-requests": ["앱 견적요청", "앱에서 고객이 직접 만든 견적요청을 확인하고, 추후 고객·견적으로 연결합니다."],
```

(e) `<Routes>`에 라우트 추가(`<Route path="/customers" .../>` 블록 뒤, customer-detail 앞):

```tsx
        <Route path="/app-requests" element={<AppRequestsPage />} />
```

- [ ] **Step 3: 사이드메뉴 nav 버튼 추가**

`client/src/components/Sidebar.tsx` 수정 — '고객 상세' 버튼(`aria-label="고객 상세"` 라인) 바로 아래에 추가:

```tsx
              <button aria-label="앱 견적요청" className={navButtonClass(visibleActiveView === "app-requests")} data-label="앱 견적요청" onClick={() => navigate("app-requests")} type="button"><MenuIcon name="quotes" /><span>앱 견적요청</span></button>
```

(아이콘은 기존 `quotes`(₩ 문서) 재사용 — 견적 계열 의미 일관. 별도 아이콘은 후속.)

- [ ] **Step 4: CSS 추가**

`client/src/index.css` 끝에 추가:

```css
/* 앱 견적요청 인박스(S1) */
.app-requests-page { padding: 18px 20px; }
.app-requests-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.app-requests-head strong { font-size: 15px; font-weight: 700; }
.app-requests-count { font-size: 12px; color: #7f858c; }
.app-requests-empty { padding: 40px; text-align: center; color: #7f858c; font-size: 13px; border: 1px solid var(--line); border-radius: 6px; }
.app-requests-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.app-requests-table th { text-align: left; font-weight: 600; color: #5f6872; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.app-requests-table td { padding: 9px 10px; border-bottom: 1px solid #f0f0ee; vertical-align: top; }
.app-req-date { white-space: nowrap; color: #5f6872; }
.app-req-vehicle { max-width: 280px; }
.app-req-terms { display: flex; flex-direction: column; gap: 2px; }
.app-req-sub { color: #7f858c; }
.app-req-match { display: inline-block; padding: 2px 8px; border-radius: 5px; font-weight: 600; white-space: nowrap; }
.app-req-match.linked { background: #ece8ff; color: var(--brand); }
.app-req-match.maybe { background: #fff4e5; color: #b76e00; }
.app-req-match.none { background: #f4f4f3; color: #7f858c; }
```

- [ ] **Step 5: typecheck + lint + build**

Run: `bun run typecheck && bun run lint && bun run build`
Expected: 0 errors / 0 problems / build OK.

- [ ] **Step 6: 커밋**

```bash
git add client/src/pages/AppRequestsPage.tsx client/src/App.tsx client/src/components/Sidebar.tsx client/src/index.css
git commit -m "feat(crm): 앱 견적요청 인박스 페이지 + 사이드메뉴 '앱 견적요청'"
```

---

## Task 4: 전체 검증 + 문서 갱신

**Files:**
- Modify: `ref/active-session-brief.md`

- [ ] **Step 1: 검증 4종 일괄**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build`
Expected: typecheck 0 · lint 0 · test:unit 통과(+어댑터 케이스) · test:server 통과(+quote-requests 3) · build OK.

- [ ] **Step 2: 브라우저 확인(인증 세션)**

`bun run dev` 후 카카오 로그인 → 사이드바 '앱 견적요청' → 97건 목록. 차량명(기아/BMW 등)·구매방식 한글(운용리스/장기렌트/할부/일시불)·상태(진행중 등)·매칭(현 데이터는 전부 "신규(미연결)") 표시 확인. (전화 데이터가 없어 매칭은 전부 미연결이 정상.)

- [ ] **Step 3: brief 갱신**

`ref/active-session-brief.md` 최신 작업 섹션에 S1 완료 한 줄 추가(견적요청 파이프라인 S1 = 앱 인박스 read 머지, S2/S3 다음). 60줄 이내 유지.

- [ ] **Step 4: 커밋**

```bash
git add ref/active-session-brief.md
git commit -m "docs(crm): brief에 앱 견적요청 인박스(S1) 완료 반영"
```

---

## Self-Review (작성자 체크 결과)

- **Spec coverage**: read 3계층(Task 1)·enum 한글 매핑/매칭/금액(Task 2)·별도 '앱 요청' 메뉴+목록(Task 3)·검증(Task 4) 모두 task 존재. 마이그 0(public-app.ts는 메인 generate 격리). 매칭 2단(app_user>phone) 반영.
- **Placeholder scan**: 모든 코드/명령/기대출력 구체값. TODO/TBD 없음.
- **Type consistency**: `AppQuoteRequestRow`(백엔드 query·프론트 lib 동형), `matchType` 3값("app_user"|"phone"|"none") 백/프 일치, `listQuoteRequests`·`toAppQuoteRequest`·`fetchAppQuoteRequests`·`AppRequestsPage` 이름 task 간 일관. `formatPriceRangeKorean(x, null)`·`formatActivity` 재사용 확인.
- **주의**: `or(undefined, ...)` drizzle 무시 동작 의존 — `userIds`는 early-return 이후라 항상 비어있지 않음(전체 스캔 방지).

## 미결 / 다음 (S1.5/S2/S3)

- **S1.5 실시간 알림 (S1 직후 전담 슬라이스, 결정됨)**: 앱 `quote_requests` INSERT → CRM 실시간 알림. Supabase Realtime `postgres_changes`(INSERT) 구독(publication 이미 켜짐 → DB 0, polling 불필요). 표현=토스트 + Topbar 벨 뱃지 + 인박스 자동갱신(S1 `fetchAppQuoteRequests`/`toAppQuoteRequest` 재사용). 별도 brainstorming→spec→plan 사이클.
- S2 고객 유입: 전화매칭 1클릭 연결(`app_user_id` set) + 미매칭 신규 `crm.customers` 생성. **채번 `nextCustomerCode()`**(`CU-YYMM-####`, 기존 `nextQuoteCode` 패턴 복제 — spec §"S2 customer_code 채번" 참고). 쓰기 → `invalidateCustomerDetail` 등 캐시 불변식.
- S3 견적 승격: 요청 행 "견적 작성" → 워크벤치 prefill(차량/구매방식/옵션) → `crm.quotes` INSERT + `source_quote_request_id`.
- 후속(선택): 옵션 상세 펼침, status 필터, 서버사이드 페이지네이션.
