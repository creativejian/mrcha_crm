# 앱 견적요청 고객 유입(S2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상담사가 인박스에서 1클릭으로 앱 요청자를 CRM 고객에 연결(link)하거나 신규 생성(create)한다.

**Architecture:** 견적요청 도메인 첫 쓰기. 백엔드 link/create 쿼리 + 라우트 2개(채번 `nextCustomerCode`), 프론트는 인박스 행 매칭 상태별 버튼. 쓰기 성공 시 인박스 캐시 force 재fetch로 매칭 표시("연결됨") 갱신.

**Tech Stack:** Hono + drizzle-orm(postgres-js) 백엔드, bun:test 서버 테스트(실 DB, tx-롤백으로 부작용 0), React + vitest.

**Spec:** `ref/specs/2026-06-28-crm-app-requests-promote-design.md`

---

## File Structure

- `src/db/queries/quote-requests.ts` — `nextCustomerCode`·`linkRequestToCustomer`·`createCustomerFromRequest` + `NEED_METHOD_LABEL` 추가 (수정)
- `src/routes/quote-requests.ts` — `POST /:id/link`·`POST /:id/create-customer` 추가 (수정)
- `src/routes/quote-requests.test.ts` — link/create/중복/404 tx-롤백 테스트 추가 (수정)
- `client/src/lib/quote-requests.ts` — `AppQuoteRequest`에 matched 필드 노출 + `linkRequestToCustomer`·`createCustomerFromRequest` (수정)
- `client/src/lib/quote-requests.test.ts` — 어댑터 matched 필드 노출 테스트 추가 (수정)
- `client/src/pages/AppRequestsPage.tsx` — 매칭 상태별 버튼 + 핸들러 + `onToast` prop (수정)
- `client/src/App.tsx` — AppRequestsPage route에 `onToast` 전달 (수정)
- `client/src/index.css` — 인박스 액션 버튼 스타일 (수정)

---

## Task 1: 백엔드 — link / create 쿼리 + 라우트

**Files:**
- Modify: `src/db/queries/quote-requests.ts`, `src/routes/quote-requests.ts`
- Test: `src/routes/quote-requests.test.ts`

- [ ] **Step 1: 서버 테스트 추가 (실패 확인용)**

`src/routes/quote-requests.test.ts` 끝에 추가 (상단 import에 `getDefaultDb`, drizzle `eq`, schema `customers`, public-app `quoteRequests` 필요 — 없으면 추가):

```ts
import { eq } from "drizzle-orm";
import { getDefaultDb } from "../db/client";
import { customers } from "../db/schema";
import { quoteRequests as quoteRequestsTable } from "../db/public-app";
import { createCustomerFromRequest, linkRequestToCustomer } from "../db/queries/quote-requests";

test("linkRequestToCustomer: 고객 app_user_id에 요청 user_id를 set (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id, userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  const [cust] = await db.select({ id: customers.id }).from(customers).limit(1);
  await expect(
    db.transaction(async (tx) => {
      const linked = await linkRequestToCustomer(req.id, cust.id, tx);
      expect(linked?.id).toBe(cust.id);
      const [c] = await tx.select({ appUserId: customers.appUserId }).from(customers).where(eq(customers.id, cust.id));
      expect(c.appUserId).toBe(req.userId);
      throw new Error("ROLLBACK"); // 부작용 롤백 — 실 DB에 변경 안 남김
    }),
  ).rejects.toThrow("ROLLBACK");
});

test("createCustomerFromRequest: 신규 고객 생성 + CU 코드 + app_user_id (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id, userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      const created = await createCustomerFromRequest(req.id, tx);
      expect(created?.customerCode).toMatch(/^CU-\d{4}-\d{4}$/);
      const [c] = await tx.select({ appUserId: customers.appUserId }).from(customers).where(eq(customers.id, created!.id));
      expect(c.appUserId).toBe(req.userId);
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
});

test("createCustomerFromRequest: 같은 user 중복 호출은 기존 고객 반환 (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      const first = await createCustomerFromRequest(req.id, tx);
      const second = await createCustomerFromRequest(req.id, tx);
      expect(second?.id).toBe(first?.id); // 두 번째는 기존 반환(중복 생성 없음)
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
});

test("linkRequestToCustomer: 없는 요청 → null", async () => {
  const db = getDefaultDb();
  const [cust] = await db.select({ id: customers.id }).from(customers).limit(1);
  const r = await linkRequestToCustomer("00000000-0000-0000-0000-000000000000", cust.id);
  expect(r).toBeNull();
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `bun run test:server`
Expected: 새 4개 FAIL (`linkRequestToCustomer`/`createCustomerFromRequest` 미존재).

- [ ] **Step 3: nextCustomerCode + NEED_METHOD_LABEL 추가**

`src/db/queries/quote-requests.ts` import 라인에 `like`, `getDefaultDb`는 이미 있음 — `desc, eq, inArray, like, or`로 보강:

```ts
import { desc, eq, inArray, like, or } from "drizzle-orm";
```

파일 끝에 추가:

```ts
// 다음 고객 코드 CU-YYMM-#### (현재월 기준, 기존 최대 시퀀스 +1). customer_code UNIQUE라 서버가 canonical 생성.
// customer-quotes.ts nextQuoteCode와 동형(QT→CU, quotes→customers).
export async function nextCustomerCode(ex: Executor = getDefaultDb()): Promise<string> {
  const now = new Date();
  const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `CU-${yymm}-`;
  const rows = await ex.select({ code: customers.customerCode }).from(customers).where(like(customers.customerCode, `${prefix}%`));
  const max = rows.reduce((m, r) => {
    const match = r.code.match(/-(\d{4})$/);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// payment_method 한글 — S1 프론트 PAYMENT_METHOD_LABEL과 동일 어휘. customers.need_method는 한글로 저장한다.
const NEED_METHOD_LABEL: Record<string, string> = {
  lease: "운용리스",
  rent: "장기렌트",
  installment: "할부",
  cash: "일시불",
};
```

- [ ] **Step 4: linkRequestToCustomer 추가**

`src/db/queries/quote-requests.ts` 끝에 추가:

```ts
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
```

- [ ] **Step 5: createCustomerFromRequest 추가**

`src/db/queries/quote-requests.ts` 끝에 추가:

```ts
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
      source: "앱 견적비교",
      statusGroup: "신규",
      status: "상담접수",
      receivedAt: new Date(req.createdAt),
    })
    .returning({ id: customers.id, customerCode: customers.customerCode, name: customers.name });
  return row;
}
```

- [ ] **Step 6: 라우트 2개 추가**

`src/routes/quote-requests.ts` 전체를 교체:

```ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { createCustomerFromRequest, linkRequestToCustomer, listQuoteRequests } from "../db/queries/quote-requests";
import type { DbVariables } from "../middleware/db";
import { run } from "./shared";

export const quoteRequests = new Hono<{ Variables: DbVariables }>();

const idParam = z.object({ id: z.uuid() });

quoteRequests.get("/", (c) => run(c, () => listQuoteRequests(c.var.db)));

// 전화 매칭된 기존 고객에 연결(app_user_id set).
quoteRequests.post(
  "/:id/link",
  zValidator("param", idParam),
  zValidator("json", z.object({ customerId: z.uuid() })),
  (c) =>
    run(
      c,
      () => linkRequestToCustomer(c.req.valid("param").id, c.req.valid("json").customerId, c.var.db),
      "요청 또는 고객을 찾을 수 없습니다.",
    ),
);

// 미매칭 요청 → 신규 고객 생성(채번+insert 트랜잭션).
quoteRequests.post("/:id/create-customer", zValidator("param", idParam), (c) =>
  run(c, () => c.var.db.transaction((tx) => createCustomerFromRequest(c.req.valid("param").id, tx)), "요청을 찾을 수 없습니다."),
);
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `bun run test:server`
Expected: 새 4개 PASS(기존 통과 유지). tx-롤백이라 실 DB에 customer 잔재 없음.

- [ ] **Step 8: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 / 0.

- [ ] **Step 9: 커밋**

```bash
git add src/db/queries/quote-requests.ts src/routes/quote-requests.ts src/routes/quote-requests.test.ts
git commit -m "feat(crm): 앱 견적요청 고객 유입(S2) 백엔드 — link/create + nextCustomerCode"
```

---

## Task 2: 프론트 — 어댑터 보강 + lib + 인박스 버튼

**Files:**
- Modify: `client/src/lib/quote-requests.ts`, `client/src/lib/quote-requests.test.ts`, `client/src/pages/AppRequestsPage.tsx`, `client/src/App.tsx`, `client/src/index.css`

- [ ] **Step 1: 어댑터 테스트 추가 (실패 확인용)**

`client/src/lib/quote-requests.test.ts`의 `describe("toAppQuoteRequest", ...)` 안에 추가:

```ts
  it("matched 고객 필드(id/name/code)를 노출한다", () => {
    const r = toAppQuoteRequest({ ...base, matchType: "phone", matchedCustomerId: "c1", matchedCustomerName: "한소희", matchedCustomerCode: "CU-2605-0001" });
    expect(r.matchedCustomerId).toBe("c1");
    expect(r.matchedCustomerName).toBe("한소희");
    expect(r.matchedCustomerCode).toBe("CU-2605-0001");
  });
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `bun run test:unit client/src/lib/quote-requests.test.ts`
Expected: FAIL (`AppQuoteRequest`에 matched 필드 없음 → 타입/undefined).

- [ ] **Step 3: AppQuoteRequest 타입 + 어댑터 보강**

`client/src/lib/quote-requests.ts`의 `AppQuoteRequest` 타입에 3필드 추가(`matchType` 위):

```ts
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  matchedCustomerCode: string | null;
  matchType: AppQuoteRequestRow["matchType"];
```

`toAppQuoteRequest` return 객체에 추가(`matchLabel,` 아래):

```ts
    matchLabel,
    matchedCustomerId: row.matchedCustomerId,
    matchedCustomerName: row.matchedCustomerName,
    matchedCustomerCode: row.matchedCustomerCode,
    matchType: row.matchType,
```

- [ ] **Step 4: lib link/create 함수 추가**

`client/src/lib/quote-requests.ts` import에 `sendJson` 추가, `invalidateCustomerDetail`도:

```ts
import { getJson, sendJson } from "./http";
import { invalidateCustomerDetail } from "./customers";
```

파일 끝에 추가:

```ts
type PromoteResult = { id: string; customerCode: string; name: string };

// 전화 매칭된 기존 고객에 연결. 성공 시 인박스 캐시 fresh + 그 고객 상세 캐시 무효화.
export async function linkRequestToCustomer(requestId: string, customerId: string): Promise<PromoteResult> {
  const r = await sendJson<PromoteResult>(`/api/quote-requests/${requestId}/link`, "POST", { customerId });
  await fetchAppQuoteRequestsCached(true);
  invalidateCustomerDetail(customerId);
  return r;
}

// 미매칭 요청 → 신규 고객 생성. 성공 시 인박스 캐시 fresh + 생성 고객 상세 캐시 무효화.
export async function createCustomerFromRequest(requestId: string): Promise<PromoteResult> {
  const r = await sendJson<PromoteResult>(`/api/quote-requests/${requestId}/create-customer`, "POST");
  await fetchAppQuoteRequestsCached(true);
  invalidateCustomerDetail(r.id);
  return r;
}
```

- [ ] **Step 5: AppRequestsPage 버튼 + 핸들러 + onToast**

`client/src/pages/AppRequestsPage.tsx` 수정:

(a) import 교체:

```tsx
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { createCustomerFromRequest, fetchAppQuoteRequestsCached, linkRequestToCustomer, type AppQuoteRequest } from "@/lib/quote-requests";
```

(b) props에 `onToast` 추가:

```tsx
type AppRequestsPageProps = {
  signal: number;
  onRead: () => void;
  onToast: (message: string) => void;
};

export function AppRequestsPage({ signal, onRead, onToast }: AppRequestsPageProps) {
```

(c) state + 핸들러 추가(기존 state 선언 아래):

```tsx
  const [actingId, setActingId] = useState<string | null>(null);

  async function handleCreate(r: AppQuoteRequest) {
    setActingId(r.id);
    try {
      const created = await createCustomerFromRequest(r.id);
      onToast(`${created.customerCode} ${created.name} 고객 생성`);
      setRows(await fetchAppQuoteRequestsCached(true));
    } catch {
      onToast("고객 생성에 실패했습니다");
    } finally {
      setActingId(null);
    }
  }

  async function handleLink(r: AppQuoteRequest) {
    if (!r.matchedCustomerId) return;
    setActingId(r.id);
    try {
      const linked = await linkRequestToCustomer(r.id, r.matchedCustomerId);
      onToast(`${linked.name} 고객에 연결했습니다`);
      setRows(await fetchAppQuoteRequestsCached(true));
    } catch {
      onToast("연결에 실패했습니다");
    } finally {
      setActingId(null);
    }
  }
```

(d) 매칭 셀(`<td>` with MATCH_CLASS)을 버튼 포함으로 교체:

```tsx
                <td className="app-req-match-cell">
                  <span className={MATCH_CLASS[r.matchType]}>{r.matchLabel}</span>
                  {r.matchType === "none" && (
                    <button className="app-req-action" disabled={actingId === r.id} onClick={() => handleCreate(r)} type="button">신규 생성</button>
                  )}
                  {r.matchType === "phone" && (
                    <button className="app-req-action" disabled={actingId === r.id} onClick={() => handleLink(r)} type="button">{r.matchedCustomerName ?? "고객"}에 연결</button>
                  )}
                  {r.matchType === "app_user" && r.matchedCustomerCode && (
                    <Link className="app-req-action link" to={`/customer-detail/${r.matchedCustomerCode}`}>고객 보기</Link>
                  )}
                </td>
```

- [ ] **Step 6: App.tsx — onToast 전달**

`client/src/App.tsx`의 AppRequestsPage route 수정:

```tsx
        <Route path="/app-requests" element={<AppRequestsPage signal={appRequestSignal} onRead={markAppRequestsRead} onToast={showToast} />} />
```

- [ ] **Step 7: CSS 추가**

`client/src/index.css` 끝에 추가:

```css
/* 앱 견적요청 인박스 — 유입 액션 버튼 */
.app-req-match-cell { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.app-req-action { padding: 3px 10px; border: 1px solid var(--line); border-radius: 5px; background: #fff; font-size: 12px; font-weight: 600; color: var(--brand); cursor: pointer; white-space: nowrap; }
.app-req-action:hover { background: #f4f1ff; border-color: var(--brand); }
.app-req-action:disabled { opacity: 0.5; cursor: default; }
.app-req-action.link { color: #5f6872; text-decoration: none; }
```

- [ ] **Step 8: typecheck + lint + build**

Run: `bun run typecheck && bun run lint && bun run build`
Expected: 0 / 0 / OK.

- [ ] **Step 9: 어댑터 테스트 통과 + 커밋**

Run: `bun run test:unit client/src/lib/quote-requests.test.ts`
Expected: PASS (matched 필드 노출 포함).

```bash
git add client/src/lib/quote-requests.ts client/src/lib/quote-requests.test.ts client/src/pages/AppRequestsPage.tsx client/src/App.tsx client/src/index.css
git commit -m "feat(crm): 앱 견적요청 인박스 고객 연결/생성 버튼(S2 프론트)"
```

---

## Task 3: 전체 검증 + brief 갱신

**Files:**
- Modify: `ref/active-session-brief.md`

- [ ] **Step 1: 검증 4종 일괄**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build`
Expected: typecheck 0 · lint 0 · test:unit 통과(+어댑터 matched 1) · test:server 통과(+link/create/중복/404 4) · build OK.

- [ ] **Step 2: 브라우저 확인(인증 세션) — 데이터 제약 명시**

기록만 — 실행은 유슨생. `bun run dev` → 로그인 → '앱 견적요청'. **현재 phone 매칭 0이라 "연결" 버튼은 안 뜨고, "신규 생성"만 동작**(테스트 계정 고객 생성 → 고객 목록에 CU-2606-#### 추가 → 매칭이 "연결됨"으로). 생성된 테스트 고객은 확인 후 정리 권장. 실 "연결" 시연은 앱에서 전화 입력 회원이 견적요청해야.

- [ ] **Step 3: brief 갱신**

`ref/active-session-brief.md` 최신 작업 섹션에 S2 한 줄(브랜치/PR) 추가. 60줄 이내.

- [ ] **Step 4: 커밋**

```bash
git add ref/active-session-brief.md
git commit -m "docs(crm): brief에 앱 견적요청 고객 유입(S2) 반영"
```

---

## Self-Review (작성자 체크 결과)

- **Spec coverage:** link/create 쿼리+라우트(Task1) · 채번 nextCustomerCode(Task1 Step3) · create 매핑(Task1 Step5, name/phone/need_*/source/신규상태/received_at) · 중복방지(Step5 existing) · 어댑터 matched 노출(Task2 Step3) · 매칭 상태별 버튼(Task2 Step5) · 캐시 force+invalidate(Task2 Step4) · 토스트(Step5) · 고객보기 Link(Step5) 모두 task 존재. 마이그 0.
- **Placeholder scan:** 모든 코드/명령/기대출력 구체값. 초기상태 "신규/상담접수"·source "앱 견적비교"·receivedAt `new Date(req.createdAt)` 확정.
- **Type consistency:** 백엔드 `linkRequestToCustomer`/`createCustomerFromRequest` 반환 `{id, customerCode, name}` ↔ 프론트 `PromoteResult` 동형. `AppQuoteRequest`에 matched 3필드(Task2 Step3) ↔ 버튼 사용(Step5) 일치. `nextCustomerCode` CU-YYMM-#### ↔ 테스트 정규식 `/^CU-\d{4}-\d{4}$/`(Task1 Step1) 일치. `onToast` prop ↔ App 전달(Step6) 일치.
- **주의:** 서버 테스트는 tx-롤백(`throw ROLLBACK`)으로 실 DB 부작용 0 — 실 데이터(quote_requests 97건/customers 20건)를 읽되 변경은 남기지 않음.

## 미결 / 다음

- 브라우저 실 검증 = 유슨생(연결은 실 유입 후). 머지 시 squash `[skip ci]` 주의.
- **S3 견적 승격**(마지막 슬라이스): 요청 행 "견적 작성" → 워크벤치 prefill(차량/구매방식/옵션) → `crm.quotes` INSERT + `source_quote_request_id`.
- 후속(선택): 연결 해제(unlink)·고객 병합·매칭 후보 수동 검색.
