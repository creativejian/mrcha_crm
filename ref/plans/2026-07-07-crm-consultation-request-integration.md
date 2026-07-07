# 앱 상담신청 → CRM 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development(권장) 또는 superpowers:executing-plans로 태스크 단위 구현. 스텝은 체크박스(`- [ ]`)로 추적.
>
> ⚠️ **착수 전제:** 이 plan은 **앱 선행 조건(ⓐ회원가입 번호 강제 ⓑ상담신청 로그인화 ⓒ`public.consultations` 계약)** 완료 후 실행한다. 지금은 견적요청 미러 구조로 계획만 확정 — 아래 **Open Questions**가 앱 계약으로 닫히면 각 태스크 코드가 확정된다. 설계 근거: `ref/specs/2026-07-07-crm-consultation-request-integration-design.md`.

**Goal:** 앱 상담신청(`public.consultations`)을 견적요청과 동일하게 `app_user_id`로 CRM 고객에 통합해, 한 고객 워크벤치에서 견적요청·상담신청을 함께 관리하고 전화번호를 CRM 연락처로 확보한다.

**Architecture:** 견적요청 인바운드(#114~#122)의 **직접 미러**. CRM은 `public.consultations`를 **read-only**로 조회(승격/연결만, DDL 불가침) → `app_user_id`로 기존 고객 연결(없으면 생성) → `notes`/`car_model`을 고객 상세에 **읽기 전용 문의 카드**로 표시. `source`는 최초 유입 경로로 고정(`앱 상담신청` 신규 어휘).

**Tech Stack:** Hono(서버 라우트) · Drizzle(쿼리, `crm`+`public` 스키마) · bun:test(서버) · React/vitest(클라) · pgvector 임베딩 훅(`embed-on-write`).

---

## Open Questions (앱 계약으로 닫아야 코드 확정 — ⓒ 협의 항목)

1. **승격 시 이름/전화번호 소스**: `consultations.customer_name`/`phone_number`(폼 입력) vs `profiles.full_name`/`phone_number`(로그인 계정).
   - 견적요청은 `profiles` 참조(`createCustomerFromRequest:343-344`). 상담신청은 폼에 직접 입력받으므로 **폼 값이 더 정확할 수 있음**.
   - **가정(잠정):** 로그인화(ⓑ) 후 `user_id`=실유저이면 `profiles` 우선, 폼 값은 폴백. 앱 계약에서 확정.
2. **`car_model`(관심모델) 채워짐 여부**: 현재 앱 알림 "관심 모델 미지정"이 많음. 카드에서 차종 없이 문의사항만 표시할지(→ Task 6에서 값 있을 때만 헤더 노출로 방어).
3. **`status` 전이**: 승격 후 `consultations.status`를 `pending`→`completed`로 전이할지(견적요청은 `quote_requests.status` 전이 있음). public write 권한 = 앱 관할 → 계약 필요. **미확정 시 status 미변경(read만)로 시작.**
4. **중복 유입**: 같은 유저가 견적요청+상담신청 둘 다 → `app_user_id` dedupe로 한 고객에 병합(견적요청 `existing` 반환 로직과 동일). `source`는 최초 유입 고정(덮지 않음).
5. **인박스 표시 위치**: 상담신청 인박스를 견적요청 인박스와 통합할지 별도 탭으로 둘지(Task 8, UX 결정).

---

## File Structure

**서버:**
- Modify `src/db/public-app.ts` — `consultations` drizzle 테이블 정의 추가(public read-only 미러; `phoneNumber`/`carModel`/`notes`/`status`).
- Create `src/db/queries/consultations.ts` — `listConsultations`·`linkConsultationToCustomer`·`createCustomerFromConsultation`·`listConsultationIdsByUser`. (견적요청 `quote-requests.ts` 미러)
- Create `src/routes/consultations.ts` — `GET /`·`POST /:id/link`·`POST /:id/create-customer` + 임베딩 훅. (견적요청 `routes/quote-requests.ts` 미러)
- Modify `src/index.ts`(또는 앱 라우트 등록부) — `/api/consultations` 마운트.
- Modify `client/src/data/customers.ts` — `SOURCE_AUTOMATIC_OPTIONS`에 `앱 상담신청` 추가 + `APP_CONSULTATION_SOURCE` 상수(기존 `APP_QUOTE_REQUEST_SOURCE` 대칭).
- Modify `src/lib/assistant-corpus.ts` + CHECK 마이그레이션 — `consultation_request` 코퍼스 소스타입(문의 notes 임베딩; 선택 — Task 7).

**클라:**
- Create `client/src/lib/consultations.ts` — `AppConsultation` 타입·`fetchCustomerConsultationsCached`. (견적요청 `lib/quote-requests.ts` 미러)
- Modify `client/src/components/customer-detail/NeedsDashboard.tsx` — 상담신청 **문의 카드**(읽기 전용, 김민준 니즈 카드 UI 재사용) 렌더.
- Modify `client/src/components/customer-detail/hooks/useCustomerNeeds.ts`(또는 상세 로더) — 상담신청 목록 fetch 배선.

---

## Task 1: `public.consultations` drizzle 정의 (read-only 미러)

**Files:**
- Modify: `src/db/public-app.ts`

**배경:** `public.consultations` 실측 컬럼 = `id(uuid), user_id(uuid), customer_name(text), phone_number(text), car_model(text), notes(text), status(text), created_at(timestamptz)`. public은 앱 관할이라 CRM은 정의만 두고 read만 한다(견적요청 `quoteRequests` 정의와 동일 방식).

- [ ] **Step 1: 테이블 정의 추가**

```ts
// src/db/public-app.ts — 기존 quoteRequests 정의 곁에
export const consultations = pgTable("consultations", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  customerName: text("customer_name"),
  phoneNumber: text("phone_number"),
  carModel: text("car_model"),
  notes: text("notes"),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: PASS (import·타입 정합)

- [ ] **Step 3: Commit**

```bash
git add src/db/public-app.ts
git commit -m "feat(crm): public.consultations drizzle 정의(read-only 미러)"
```

> ⚠️ Open Q ⓒ: 앱이 로그인화하며 컬럼을 바꾸면(예: 관심모델 구조화) 이 정의를 계약대로 갱신.

---

## Task 2: `listConsultations` 쿼리 (인박스 목록)

**Files:**
- Create: `src/db/queries/consultations.ts`
- Test: `src/db/queries/consultations.test.ts`

**참조:** 견적요청 `listQuoteRequests`(`quote-requests.ts:24 진입`, phone/app_user 매칭 로직 `:66-141`). 상담신청도 **기존 고객 매칭(app_user_id 우선, phone 차선)**을 표시용으로 계산한다.

- [ ] **Step 1: 실패 테스트 작성** (랜덤 서픽스 픽스처 — 공유 master 재실행 트랩 방지, `assistant-tools.test.ts` 규약)

```ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { getDefaultDb } from "../client";
import { consultations } from "../public-app";
import { listConsultations } from "./consultations";

const db = getDefaultDb();
const UID = crypto.randomUUID();
let CID = "";

beforeAll(async () => {
  const [row] = await db.insert(consultations).values({
    id: crypto.randomUUID(), userId: UID, customerName: "상담테스트",
    phoneNumber: "01000000000", carModel: "BMW X5", notes: "리스 상담 원함", status: "pending", createdAt: new Date(),
  }).returning({ id: consultations.id });
  CID = row.id;
});
afterAll(async () => { await db.delete(consultations).where(eq(consultations.id, CID)); });

test("listConsultations: pending 상담신청을 문의내용·전화번호와 함께 반환", async () => {
  const rows = await listConsultations(db);
  const mine = rows.find((r) => r.id === CID);
  expect(mine).toBeDefined();
  expect(mine!.phoneNumber).toBe("01000000000");
  expect(mine!.notes).toBe("리스 상담 원함");
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:server src/db/queries/consultations.test.ts`
Expected: FAIL ("listConsultations is not a function")

- [ ] **Step 3: 최소 구현**

```ts
// src/db/queries/consultations.ts
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getDefaultDb, type Executor } from "../client";
import { consultations } from "../public-app";
import { customers } from "../schema";

export type ConsultationRow = {
  id: string; userId: string; customerName: string | null; phoneNumber: string | null;
  carModel: string | null; notes: string | null; status: string | null; createdAt: Date;
};

export async function listConsultations(ex: Executor = getDefaultDb()): Promise<ConsultationRow[]> {
  return ex
    .select({
      id: consultations.id, userId: consultations.userId, customerName: consultations.customerName,
      phoneNumber: consultations.phoneNumber, carModel: consultations.carModel, notes: consultations.notes,
      status: consultations.status, createdAt: consultations.createdAt,
    })
    .from(consultations)
    .where(eq(consultations.status, "pending"))
    .orderBy(desc(consultations.createdAt));
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:server src/db/queries/consultations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/queries/consultations.ts src/db/queries/consultations.test.ts
git commit -m "feat(crm): listConsultations 쿼리(pending 상담신청 인박스)"
```

---

## Task 3: `createCustomerFromConsultation` 승격 (신규 고객 + source 최초유입)

**Files:**
- Modify: `src/db/queries/consultations.ts`
- Modify: `src/db/queries/consultations.test.ts`
- Modify: `client/src/data/customers.ts` (source 어휘)

**참조:** `createCustomerFromRequest`(`quote-requests.ts:297-355`) — `existing`(app_user_id) dedupe로 기존 고객 반환(source 안 덮음), 신규는 profiles+요청 데이터 INSERT. 상담신청 차이: `source=앱 상담신청`, 이름/번호 소스(Open Q 1).

- [ ] **Step 1: source 상수 추가**

```ts
// client/src/data/customers.ts — 기존 APP_QUOTE_REQUEST_SOURCE 곁
export const APP_CONSULTATION_SOURCE = "앱 상담신청";
// SOURCE_AUTOMATIC_OPTIONS 배열에 "앱 상담신청" 추가(견적요청과 대칭 자동 유입 경로).
```

- [ ] **Step 2: 실패 테스트 (신규 생성 + source + phone→연락처)**

```ts
test("createCustomerFromConsultation: 신규 고객에 source='앱 상담신청'·전화번호 매핑", async () => {
  const row = await createCustomerFromConsultation(CID, db);
  expect(row).not.toBeNull();
  const [c] = await db.select({ source: customers.source, phone: customers.phone, appUserId: customers.appUserId })
    .from(customers).where(eq(customers.id, row!.id));
  expect(c.source).toBe("앱 상담신청");
  expect(c.phone).toBe("01000000000"); // Open Q1: 폼 phone_number(또는 profiles) 소스
  expect(c.appUserId).toBe(UID);
  await db.delete(customers).where(eq(customers.id, row!.id)); // 픽스처 정리
});

test("createCustomerFromConsultation: 같은 app_user_id 기존 고객이면 기존 반환(source 유지)", async () => {
  const [existing] = await db.insert(customers).values({
    customerCode: `CU-CONSULT-${crypto.randomUUID().slice(0,8)}`, name: "기존고객",
    appUserId: UID, source: "앱 견적요청", statusGroup: "신규", status: "상담접수",
  }).returning({ id: customers.id });
  const row = await createCustomerFromConsultation(CID, db);
  expect(row!.id).toBe(existing.id); // dedupe
  const [c] = await db.select({ source: customers.source }).from(customers).where(eq(customers.id, existing.id));
  expect(c.source).toBe("앱 견적요청"); // 최초 유입 고정 — 덮지 않음
  await db.delete(customers).where(eq(customers.id, existing.id));
});
```

- [ ] **Step 3: 실패 확인**

Run: `bun run test:server src/db/queries/consultations.test.ts`
Expected: FAIL ("createCustomerFromConsultation is not a function")

- [ ] **Step 4: 구현** (⚠️ Open Q1 — 이름/번호 소스는 앱 계약으로 확정. 아래는 "폼 값 우선, profiles 폴백" 잠정)

```ts
import { profiles } from "../public-app";
import { nextCustomerCode } from "./business-code"; // 견적요청과 동일 채번(실제 경로 확인)
import { APP_CONSULTATION_SOURCE } from "../../../client/src/data/customers"; // 순수 상수 import 경계(AGENTS.md)

export async function createCustomerFromConsultation(
  consultationId: string, ex: Executor = getDefaultDb(),
): Promise<{ id: string; customerCode: string; name: string; appUserId: string } | null> {
  const [req] = await ex.select({
    userId: consultations.userId, customerName: consultations.customerName,
    phoneNumber: consultations.phoneNumber, carModel: consultations.carModel, createdAt: consultations.createdAt,
  }).from(consultations).where(eq(consultations.id, consultationId));
  if (!req) return null;

  const [existing] = await ex.select({ id: customers.id, customerCode: customers.customerCode, name: customers.name })
    .from(customers).where(eq(customers.appUserId, req.userId));
  if (existing) return { ...existing, appUserId: req.userId }; // 최초 유입 source 유지(안 덮음)

  const [profile] = await ex.select({ fullName: profiles.fullName, phoneNumber: profiles.phoneNumber })
    .from(profiles).where(eq(profiles.id, req.userId));

  const customerCode = await nextCustomerCode(ex);
  const [row] = await ex.insert(customers).values({
    customerCode,
    name: req.customerName?.trim() || profile?.fullName || "이름미상", // Open Q1
    phone: req.phoneNumber?.trim() || profile?.phoneNumber || null,     // Open Q1
    appUserId: req.userId,
    needModel: req.carModel ?? null,
    source: APP_CONSULTATION_SOURCE,
    statusGroup: "신규",
    status: "상담접수",
    receivedAt: new Date(req.createdAt),
  }).returning({ id: customers.id, customerCode: customers.customerCode, name: customers.name });
  return row ? { ...row, appUserId: req.userId } : null;
}
```

- [ ] **Step 5: 통과 확인**

Run: `bun run test:server src/db/queries/consultations.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/queries/consultations.ts src/db/queries/consultations.test.ts client/src/data/customers.ts
git commit -m "feat(crm): createCustomerFromConsultation 승격(source 앱 상담신청·phone 매핑·dedupe)"
```

---

## Task 4: `linkConsultationToCustomer` (기존 고객 연결)

**Files:**
- Modify: `src/db/queries/consultations.ts`, `src/db/queries/consultations.test.ts`

**참조:** `linkRequestToCustomer`(`quote-requests.ts:272-293`) — `app_user_id` 충돌 시 `ConflictError`(→409). 그대로 미러. 연결 시 대상 고객 `phone`이 비어 있으면 상담신청 번호로 채우는 보강 포함(전화번호 확보가 상담신청의 핵심 가치).

- [ ] **Step 1: 실패 테스트**

```ts
test("linkConsultationToCustomer: 기존 고객에 app_user_id 연결 + 빈 연락처 보강", async () => {
  const [target] = await db.insert(customers).values({
    customerCode: `CU-CONSULT-${crypto.randomUUID().slice(0,8)}`, name: "연결대상",
    source: "수동", statusGroup: "신규", status: "상담접수",
  }).returning({ id: customers.id });
  const row = await linkConsultationToCustomer(CID, target.id, db);
  expect(row!.appUserId).toBe(UID);
  const [c] = await db.select({ appUserId: customers.appUserId, phone: customers.phone })
    .from(customers).where(eq(customers.id, target.id));
  expect(c.appUserId).toBe(UID);
  expect(c.phone).toBe("01000000000"); // 빈 연락처 보강
  await db.delete(customers).where(eq(customers.id, target.id));
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test:server src/db/queries/consultations.test.ts` → FAIL

- [ ] **Step 3: 구현**

```ts
import { ConflictError } from "../../errors"; // 실제 경로 확인(quote-requests.ts import 대응)

export async function linkConsultationToCustomer(
  consultationId: string, customerId: string, ex: Executor = getDefaultDb(),
): Promise<{ id: string; customerCode: string; name: string; appUserId: string } | null> {
  const [req] = await ex.select({ userId: consultations.userId, phoneNumber: consultations.phoneNumber })
    .from(consultations).where(eq(consultations.id, consultationId));
  if (!req) return null;
  const [linked] = await ex.select({ customerCode: customers.customerCode, name: customers.name })
    .from(customers).where(and(eq(customers.appUserId, req.userId), ne(customers.id, customerId)));
  if (linked) throw new ConflictError(`이 앱 계정은 이미 ${linked.name}(${linked.customerCode}) 고객에 연결돼 있습니다.`);
  const [target] = await ex.select({ phone: customers.phone }).from(customers).where(eq(customers.id, customerId));
  const [row] = await ex.update(customers)
    .set({ appUserId: req.userId, phone: target?.phone?.trim() || req.phoneNumber || target?.phone, updatedAt: new Date() })
    .where(eq(customers.id, customerId))
    .returning({ id: customers.id, customerCode: customers.customerCode, name: customers.name });
  return row ? { ...row, appUserId: req.userId } : null;
}
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test:server src/db/queries/consultations.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(crm): linkConsultationToCustomer(app_user_id 연결·409 가드·연락처 보강)"
```

---

## Task 5: `listConsultationIdsByUser` + 라우트 (`/api/consultations`)

**Files:**
- Modify: `src/db/queries/consultations.ts`
- Create: `src/routes/consultations.ts`
- Modify: `src/index.ts`(라우트 마운트)
- Test: `src/routes/consultations.test.ts`

**참조:** `routes/quote-requests.ts`(전체) — `scheduleQuoteRequestEmbeds` 훅 패턴, link/create-customer 라우트. 임베딩 소스타입만 `consultation_request`로(Task 7 도입 시), 아니면 `customer_profile`만 스케줄.

- [ ] **Step 1: `listConsultationIdsByUser` 구현** (임베딩 훅용 — 승격 유저의 상담신청 전부)

```ts
export async function listConsultationIdsByUser(appUserId: string, ex: Executor = getDefaultDb()): Promise<string[]> {
  const rows = await ex.select({ id: consultations.id }).from(consultations).where(eq(consultations.userId, appUserId));
  return rows.map((r) => r.id);
}
```

- [ ] **Step 2: 라우트 작성** (견적요청 `routes/quote-requests.ts` 미러 — link/create-customer)

```ts
// src/routes/consultations.ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { createCustomerFromConsultation, linkConsultationToCustomer, listConsultations } from "../db/queries/consultations";
import { scheduleEmbedOnWrite } from "../lib/embed-on-write";
import type { DbVariables } from "../middleware/db";
import { run } from "./shared";

export const consultations = new Hono<{ Variables: DbVariables }>();
const idParam = z.object({ id: z.uuid() });

consultations.get("/", (c) => run(c, () => listConsultations(c.var.db)));

consultations.post("/:id/link", zValidator("param", idParam), zValidator("json", z.object({ customerId: z.uuid() })), (c) =>
  run(c, async () => {
    const row = await linkConsultationToCustomer(c.req.valid("param").id, c.req.valid("json").customerId, c.var.db);
    if (row) scheduleEmbedOnWrite(c, { sourceType: "customer_profile", sourceId: row.id });
    return row;
  }, "요청 또는 고객을 찾을 수 없습니다."));

consultations.post("/:id/create-customer", zValidator("param", idParam), (c) =>
  run(c, async () => {
    const row = await c.var.db.transaction((tx) => createCustomerFromConsultation(c.req.valid("param").id, tx));
    if (row) scheduleEmbedOnWrite(c, { sourceType: "customer_profile", sourceId: row.id });
    return row;
  }, "요청을 찾을 수 없습니다."));
```

- [ ] **Step 3: 마운트** — `src/index.ts`에서 `app.route("/api/consultations", consultations)` (견적요청 마운트 곁, 실제 등록부 확인).

- [ ] **Step 4: 라우트 테스트** (staff JWT 게이트 + 승격 왕복, `routes/customers.test.ts`/`quote-requests` 테스트 패턴)

```ts
test("POST /api/consultations/:id/create-customer → 신규 고객 생성", async () => {
  // makeTestAuth("admin") + 픽스처 consultation insert → 라우트 호출 → customers 생성 확인 → 원복
});
```

- [ ] **Step 5: 통과 + typecheck + lint**

Run: `bun run test:server src/routes/consultations.test.ts && bun run typecheck && bun run lint`
Expected: PASS · 0 · 0

- [ ] **Step 6: Commit**

```bash
git add src/db/queries/consultations.ts src/routes/consultations.ts src/index.ts src/routes/consultations.test.ts
git commit -m "feat(crm): /api/consultations 라우트(list·link·create-customer + 임베딩 훅)"
```

---

## Task 6: 고객 상세 상담신청 문의 카드 (읽기 전용, 김민준 니즈 카드 UI 재사용)

**Files:**
- Create: `client/src/lib/consultations.ts` (`AppConsultation` 타입 + `fetchCustomerConsultationsCached`)
- Modify: `client/src/components/customer-detail/NeedsDashboard.tsx`
- Modify: 상세 로더 훅(상담신청 목록 fetch 배선)

**참조:** `client/src/lib/quote-requests.ts`(`fetchCustomerQuoteRequestsCached`, 캐시+TTL+dedupe), `NeedsDashboard.tsx`의 앱 견적요청 카드 렌더 + "문의사항" 섹션(`:55,127,153`). 상담신청 카드 = **관심모델(있을 때만) + 문의사항(notes) 읽기 전용** — 김민준 니즈 카드와 동일 마크업, 편집 없음.

- [ ] **Step 1: 클라 fetch lib** (견적요청 lib 미러 — 완전 코드는 `lib/quote-requests.ts:110-148` 패턴 복제)

```ts
// client/src/lib/consultations.ts
export type AppConsultation = { id: string; carModel: string | null; notes: string | null; createdAt: string };
export async function fetchCustomerConsultations(customerId: string): Promise<AppConsultation[]> { /* GET /api/customers/:id/consultations 또는 필터 */ }
// + fetchCustomerConsultationsCached(캐시/TTL/dedupe — quote-requests 미러)
```

> ⚠️ Open Q ⓒ: 고객별 상담신청 조회 엔드포인트 형태(고객 상세가 `app_user_id`로 필터). 견적요청 `fetchCustomerQuoteRequests`와 동일 규약으로 서버 라우트 1개 추가 필요할 수 있음(Task 5 확장).

- [ ] **Step 2: 카드 렌더 (실패 테스트 — 문의사항 노출)**

```tsx
// NeedsDashboard.test 또는 컴포넌트 테스트: 상담신청 있으면 notes가 "문의사항"으로 렌더
```

- [ ] **Step 3: NeedsDashboard에 상담신청 카드 섹션 추가** — 견적요청 카드 리스트와 공존. 관심모델 헤더(값 있을 때만)+문의사항 본문, **편집 핸들러 없음(읽기 전용)**.

- [ ] **Step 4: 검증** — Run: `bun run typecheck && bun run lint && bun run test:unit` → 0·0·PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(crm): 고객 상세 상담신청 문의 카드(읽기 전용, 니즈 카드 UI 재사용)"
```

---

## Task 7 (선택): 상담신청 문의 임베딩 코퍼스

**Files:** `src/lib/assistant-corpus.ts` + CHECK 마이그레이션 + `embed-on-write` 소스타입.

**참조:** 견적요청 청크(`quote_request`) 도입 패턴(브리프 코퍼스 확장 ④). 상담신청 `notes`를 `consultation_request` 청크로 임베딩 → 업무 AI가 "○○ 상담 문의 뭐였어" 응답 가능.

- [ ] `buildConsultationChunkText` + CHECK 마이그(`consultation_request` 소스타입) + 승격 훅에서 스케줄 + 백필 보정.
- [ ] **함정:** EMBED_ON_WRITE 게이트 3규칙(`bun run test:server`만) · 실 DB 픽스처 랜덤 서픽스 · 빌더 변경=hash 불일치 소급.

> 우선순위 낮음 — Task 1~6(통합 본체) 완료 후 별도 판단.

---

## Task 8 (선택): 상담신청 인박스 UI

**Files:** Topbar/Sidebar 알림 + 인박스 목록(견적요청 인박스 미러).

- [ ] Open Q ⓒ-5: 견적요청 인박스와 통합 탭 vs 별도. 상담사가 pending 상담신청을 보고 승격/연결.

---

## Self-Review 체크

- **Spec 커버리지:** 통합 키(app_user_id)=Task 3·4 / 읽기전용 문의 카드=Task 6 / source 최초유입=Task 3(existing 유지) / phone→연락처=Task 3·4 / 채팅 아이콘 미변경=(범위 밖, 유지). ✅
- **Placeholder:** Task 1~5는 완전 코드(견적요청 미러라 확정). Task 6~8 + Open Q는 앱 계약 의존 — 명시적 마킹. 앱 계약 확정 시 이 부분만 완성.
- **타입 일관성:** `ConsultationRow`(Task 2) ↔ 승격 반환 `{id,customerCode,name,appUserId}`(Task 3·4, 견적요청과 동일 시그니처) 정합.

## 검증 예산 (실행 시)

- 서버 변경: `bun run test:server`(실 master, `EMBED_ON_WRITE=off` 프리픽스 — 직접 `bun test` 금지).
- 클라 변경: `bun run typecheck`·`bun run lint`(0)·`bun run test:unit`.
- 큰 변경: `bun run build`. 승격 왕복은 격리 스택 스모크(사용자 dev 불가침, 원복).
- 실 DB 픽스처는 **랜덤 서픽스**(공유 master 재실행 트랩).
