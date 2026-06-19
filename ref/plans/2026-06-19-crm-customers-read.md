# CRM 고객 읽기 DB 연결 (1차) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `crm.customers`(+자식)를 읽어 고객 목록/상세를 목업이 아닌 실제 DB로 표시한다.

**Architecture:** catalog 도메인과 동일한 3계층 — `queries/customers.ts`(executor 일원화) → `routes/customers.ts`(auth+db 미들웨어) → 프론트 `lib/customers.ts`(DB row→`Customer` adapter). 데이터 소유자는 App.tsx(현재 목업 `useState`)이며 이를 API 로드로 교체. 시드 스크립트로 목업 21명을 DB에 넣어 검증. 쓰기·advisor 이름·정산·견적은 범위 외.

**Tech Stack:** drizzle-orm pg-core(pgSchema crm), Hono, @hono/zod-validator, postgres-js, React 19, Vitest(프론트 단위), bun:test(서버), bun.

**Spec:** `ref/specs/2026-06-19-crm-customers-read-design.md`

---

## File Structure

- **Create** `src/db/queries/customers.ts` — `listCustomers`/`getCustomer` + 반환 타입. crm.customers·자식 read.
- **Create** `src/routes/customers.ts` — `GET /`(목록), `GET /:id`(상세). Hono 인스턴스 `customers`.
- **Modify** `src/app.ts` — `/api/customers/*` auth+db 미들웨어 + `app.route` 마운트.
- **Create** `src/routes/customers.test.ts` — 라우트 통합 테스트(createApp+makeTestAuth).
- **Create** `scripts/seed-customers.ts` — 목업 21명 → crm.customers(+task) insert, 멱등.
- **Create** `client/src/lib/customers.ts` — `fetchCustomers`/`fetchCustomer` + `toCustomer` adapter + 날짜 포맷.
- **Create** `client/src/lib/customers.test.ts` — `toCustomer`/`formatActivity` 단위테스트.
- **Modify** `client/src/App.tsx` — customers를 API 로드(빈 시작 + useEffect), 로딩/에러, selectedCustomerNo 초기값.

---

## Task 1: 백엔드 읽기 쿼리

**Files:**
- Create: `src/db/queries/customers.ts`

- [ ] **Step 1: 쿼리 파일 작성**

`src/db/queries/customers.ts`:

```ts
import { desc, eq, getTableColumns, sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import {
  consultations,
  customerDocuments,
  customerMemos,
  customers,
  customerSchedules,
  customerTasks,
} from "../schema";

// 목록 행 = customers 전체 컬럼 + 상담메모용 최신 미완료 task 1건 body.
export type CustomerListRow = typeof customers.$inferSelect & { latestTask: string | null };

// 상담메모(목업 nextAction): customer_tasks 최신 미완료 1건 body를 상관 서브쿼리로.
const latestTaskBody = sql<string | null>`(
  select t.body from crm.customer_tasks t
  where t.customer_id = ${customers.id} and t.done = false
  order by t.created_at desc limit 1
)`;

export async function listCustomers(executor: Executor = getDefaultDb()): Promise<CustomerListRow[]> {
  return executor
    .select({ ...getTableColumns(customers), latestTask: latestTaskBody })
    .from(customers)
    .orderBy(desc(customers.receivedAt));
}

export type CustomerDetail = typeof customers.$inferSelect & {
  tasks: (typeof customerTasks.$inferSelect)[];
  schedules: (typeof customerSchedules.$inferSelect)[];
  memos: (typeof customerMemos.$inferSelect)[];
  documents: (typeof customerDocuments.$inferSelect)[];
  consultations: (typeof consultations.$inferSelect)[];
};

export async function getCustomer(id: string, executor: Executor = getDefaultDb()): Promise<CustomerDetail | null> {
  const [customer] = await executor.select().from(customers).where(eq(customers.id, id));
  if (!customer) return null;
  // 자식은 순차 await(저빈도 상세, pool 절약 — catalog-counts와 동일 원칙).
  const tasks = await executor.select().from(customerTasks).where(eq(customerTasks.customerId, id));
  const schedules = await executor.select().from(customerSchedules).where(eq(customerSchedules.customerId, id));
  const memos = await executor.select().from(customerMemos).where(eq(customerMemos.customerId, id));
  const documents = await executor.select().from(customerDocuments).where(eq(customerDocuments.customerId, id));
  const consults = await executor.select().from(consultations).where(eq(consultations.customerId, id));
  return { ...customer, tasks, schedules, memos, documents, consultations: consults };
}
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 0 errors. (라우트 미연결 상태라 쿼리만 컴파일 확인.)

- [ ] **Step 3: commit**

```bash
git add src/db/queries/customers.ts
git commit -m "feat(crm): 고객 읽기 쿼리(listCustomers/getCustomer)"
```

---

## Task 2: 라우트 + 마운트 (TDD)

**Files:**
- Create: `src/routes/customers.ts`
- Modify: `src/app.ts`
- Create: `src/routes/customers.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/routes/customers.test.ts` (catalog.test.ts 패턴 복제):

```ts
import { test, expect } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";

test("GET /api/customers → 200, 배열", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect(Array.isArray(await res.json())).toBe(true);
});

test("GET /api/customers 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/customers");
  expect(res.status).toBe(401);
});

test("GET /api/customers/:id 없는 uuid → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/customers/00000000-0000-0000-0000-000000000000", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `bun test src/routes/customers.test.ts --env-file=.env.local`
Expected: FAIL (라우트 없음 → 404 for 목록, 또는 notFound). 401 테스트는 통과할 수도 있으나 목록/404 테스트는 실패.

- [ ] **Step 3: 라우트 작성**

`src/routes/customers.ts`:

```ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getCustomer, listCustomers } from "../db/queries/customers";
import type { DbVariables } from "../middleware/db";

export const customers = new Hono<{ Variables: DbVariables }>();

customers.get("/", async (c) => c.json(await listCustomers(c.var.db)));

customers.get("/:id", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
  const row = await getCustomer(c.req.valid("param").id, c.var.db);
  return row ? c.json(row) : c.json({ error: "고객을 찾을 수 없습니다." }, 404);
});
```

- [ ] **Step 4: app.ts에 미들웨어 + 마운트 추가**

`src/app.ts` — import 추가(파일 상단 import 블록, catalog import 옆):

```ts
import { customers } from "./routes/customers";
```

`app.use("/api/catalog/*", dbMiddleware);` 줄 **다음에** 추가:

```ts
  app.use("/api/customers/*", auth);
  app.use("/api/customers/*", dbMiddleware);
```

`app.route("/api/catalog", catalog);` 줄 **다음에** 추가:

```ts
  app.route("/api/customers", customers);
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `bun test src/routes/customers.test.ts --env-file=.env.local`
Expected: PASS (3 tests). 목록은 빈 배열이어도 200·Array.

- [ ] **Step 6: 전체 서버 테스트 회귀**

Run: `bun test --env-file=.env.local`
Expected: 기존 28 + 신규 3 = 31 pass, 0 fail.

- [ ] **Step 7: commit**

```bash
git add src/routes/customers.ts src/routes/customers.test.ts src/app.ts
git commit -m "feat(crm): 고객 읽기 라우트(GET /api/customers, /:id) + 마운트"
```

---

## Task 3: 시드 스크립트

**Files:**
- Create: `scripts/seed-customers.ts`

- [ ] **Step 1: 시드 스크립트 작성**

`scripts/seed-customers.ts`. 목업은 클라이언트 경로지만 순수 데이터라 직접 import. `appUserId`/`advisorId`는 loose(null). 상대 날짜는 기준일(시드 실행 시점 고정값) 기반 변환.

```ts
import { initialCustomers } from "../client/src/data/customers";
import { getDefaultDb } from "../src/db/client";
import { customers, customerTasks } from "../src/db/schema";

// "2026-05-14 12:56"(절대) | "오늘 13:04" | "어제 19:10" | "5/10 16:30" | "5/09 09:35" 파싱.
// 기준일: 목업 최신 절대 시각(2026-05-14)을 "오늘"로 본다(결정적, Date.now 미사용).
const TODAY = "2026-05-14";
const YESTERDAY = "2026-05-13";
const YEAR = "2026";

function toTimestamp(s: string): string | null {
  if (!s) return null;
  const m = s.trim();
  // 절대: "2026-05-14 12:56"
  if (/^\d{4}-\d{2}-\d{2}/.test(m)) return `${m.replace(" ", "T")}:00+09:00`;
  // "오늘 HH:mm" / "어제 HH:mm"
  const rel = m.match(/^(오늘|어제)\s+(\d{1,2}):(\d{2})$/);
  if (rel) {
    const day = rel[1] === "오늘" ? TODAY : YESTERDAY;
    return `${day}T${rel[2].padStart(2, "0")}:${rel[3]}:00+09:00`;
  }
  // "M/D HH:mm"
  const md = m.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (md) {
    return `${YEAR}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}T${md[3].padStart(2, "0")}:${md[4]}:00+09:00`;
  }
  return null;
}

async function main() {
  const db = getDefaultDb();
  let inserted = 0;
  for (const c of initialCustomers) {
    const [row] = await db
      .insert(customers)
      .values({
        customerCode: c.customerId,
        name: c.name,
        phone: c.phone,
        customerType: c.customerType,
        customerTypeDetail: c.customerTypeDetail,
        team: c.team,
        source: c.source,
        statusGroup: c.statusGroup,
        status: c.status,
        priority: c.priority,
        aiSummary: c.aiSummary,
        needModel: c.vehicle,
        needMethod: c.method,
        receivedAt: toTimestamp(c.receivedAt),
        assignedAt: toTimestamp(c.assignedAt),
        lastActivityAt: toTimestamp(c.date),
      })
      .onConflictDoNothing({ target: customers.customerCode })
      .returning({ id: customers.id });
    if (!row) continue; // 이미 존재(멱등)
    inserted++;
    if (c.nextAction) {
      await db.insert(customerTasks).values({ customerId: row.id, body: c.nextAction, done: false });
    }
  }
  console.log(`seeded ${inserted} customers (skipped ${initialCustomers.length - inserted} existing)`);
  process.exit(0);
}

void main();
```

- [ ] **Step 2: package.json에 스크립트 추가**

`package.json`의 `scripts`에 추가(기존 `db:*` 근처):

```json
    "seed:customers": "bun run --env-file=.env.local scripts/seed-customers.ts",
```

- [ ] **Step 3: 시드 실행**

Run: `bun run seed:customers`
Expected: `seeded 21 customers (skipped 0 existing)` (또는 일부 존재 시 그만큼 skip).

- [ ] **Step 4: 멱등 재실행 확인**

Run: `bun run seed:customers`
Expected: `seeded 0 customers (skipped 21 existing)`.

- [ ] **Step 5: DB 건수 확인**

Run: `psql "$DATABASE_URL" -c "select count(*) from crm.customers;"` (DATABASE_URL은 `.env.local`에서; 없으면 `set -a; source .env.local; set +a` 후 실행)
Expected: count 21.

- [ ] **Step 6: commit**

```bash
git add scripts/seed-customers.ts package.json
git commit -m "feat(crm): 고객 목업 21명 시드 스크립트(멱등)"
```

---

## Task 4: 프론트 adapter + 단위테스트 (TDD)

**Files:**
- Create: `client/src/lib/customers.ts`
- Create: `client/src/lib/customers.test.ts`

- [ ] **Step 1: 실패하는 단위테스트 작성**

`client/src/lib/customers.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { toCustomer, type CustomerRow } from "./customers";

const row: CustomerRow = {
  id: "11111111-1111-1111-1111-111111111111",
  customerCode: "CU-2605-0020",
  name: "김민준",
  phone: "010-9588-0812",
  customerType: "개인",
  customerTypeDetail: "4대보험",
  team: "인천본사",
  source: "디엘(견적서)",
  statusGroup: "견적",
  status: "발송완료",
  priority: "긴급",
  aiSummary: "요약",
  needModel: "Maybach S-Class",
  needMethod: "운용리스",
  receivedAt: "2026-05-14T12:56:00+09:00",
  assignedAt: "2026-05-14T13:04:00+09:00",
  lastActivityAt: "2026-05-14T14:20:00+09:00",
  latestTask: "GLC 재고 확인",
};

describe("toCustomer", () => {
  it("customerCode를 customerId로, 숫자부분을 no로 파생", () => {
    const c = toCustomer(row);
    expect(c.customerId).toBe("CU-2605-0020");
    expect(c.no).toBe(26050020);
  });
  it("needModel/needMethod를 vehicle/method로, latestTask를 nextAction으로", () => {
    const c = toCustomer(row);
    expect(c.vehicle).toBe("Maybach S-Class");
    expect(c.method).toBe("운용리스");
    expect(c.nextAction).toBe("GLC 재고 확인");
  });
  it("advisor는 미배정 폴백, null 필드는 빈 문자열", () => {
    const c = toCustomer({ ...row, latestTask: null, phone: null });
    expect(c.advisor).toBe("미배정");
    expect(c.nextAction).toBe("");
    expect(c.phone).toBe("");
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `bun run test:unit client/src/lib/customers.test.ts`
Expected: FAIL ("./customers" 모듈/`toCustomer` 없음).

- [ ] **Step 3: adapter 구현**

`client/src/lib/customers.ts`:

```ts
import type { Customer } from "@/data/customers";
import { apiFetch } from "./api";

// 백엔드 listCustomers 응답 1행(camelCase, null 가능). 상세는 추가 자식 필드 포함.
export type CustomerRow = {
  id: string;
  customerCode: string;
  name: string;
  phone: string | null;
  customerType: string | null;
  customerTypeDetail: string | null;
  team: string | null;
  source: string | null;
  statusGroup: string | null;
  status: string | null;
  priority: string | null;
  aiSummary: string | null;
  needModel: string | null;
  needMethod: string | null;
  receivedAt: string | null;
  assignedAt: string | null;
  lastActivityAt: string | null;
  latestTask: string | null;
};

// timestamptz → 화면 표시 문자열. 기준일 비교 없이 "YY/MM/DD HH:mm"(읽기 1차 — 상대표현 보류).
export function formatActivity(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear()).slice(2)}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function toCustomer(row: CustomerRow): Customer {
  return {
    no: Number(row.customerCode.replace(/\D/g, "")),
    customerId: row.customerCode,
    receivedAt: formatActivity(row.receivedAt),
    assignedAt: formatActivity(row.assignedAt),
    team: row.team ?? "",
    name: row.name,
    customerType: row.customerType ?? "",
    customerTypeDetail: row.customerTypeDetail ?? "",
    phone: row.phone ?? "",
    vehicle: row.needModel ?? "",
    method: row.needMethod ?? "",
    advisor: "미배정",
    statusGroup: row.statusGroup ?? "",
    status: row.status ?? "",
    date: formatActivity(row.lastActivityAt),
    source: row.source ?? "",
    talkCount: "",
    priority: row.priority ?? "",
    nextAction: row.latestTask ?? "",
    aiSummary: row.aiSummary ?? "",
  };
}

export async function fetchCustomers(): Promise<Customer[]> {
  const res = await apiFetch("/api/customers");
  if (!res.ok) throw new Error(`고객 목록 실패: ${res.status}`);
  return ((await res.json()) as CustomerRow[]).map(toCustomer);
}

export async function fetchCustomer(id: string): Promise<CustomerRow & Record<string, unknown>> {
  const res = await apiFetch(`/api/customers/${id}`);
  if (!res.ok) throw new Error(`고객 상세 실패: ${res.status}`);
  return (await res.json()) as CustomerRow & Record<string, unknown>;
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `bun run test:unit client/src/lib/customers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: commit**

```bash
git add client/src/lib/customers.ts client/src/lib/customers.test.ts
git commit -m "feat(crm): 고객 목록 fetch + DB→Customer adapter"
```

---

## Task 5: App.tsx API 로드 통합

**Files:**
- Modify: `client/src/App.tsx`

> 식별자 `no`는 adapter가 customerCode에서 파생하므로 기존 `selectedCustomerNo`/overrides(`no` 키) 로직은 유지된다. 변경은 데이터 출처(목업→API)와 초기값/로딩뿐.

- [ ] **Step 1: import 교체**

`client/src/App.tsx` 상단. `initialCustomers`는 더 이상 초기 데이터로 쓰지 않으므로 import에서 제거하고 `fetchCustomers` 추가. (line 6의 import에서 `initialCustomers` 토큰만 제거.)

추가 import(다른 lib import 근처):

```ts
import { fetchCustomers } from "@/lib/customers";
```

- [ ] **Step 2: state 초기값을 빈 배열 + 로딩/에러로 교체**

`const [customers, setCustomers] = useState<Customer[]>(initialCustomers);` →

```ts
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [customersError, setCustomersError] = useState(false);
```

`const [selectedCustomerNo, setSelectedCustomerNo] = useState(initialCustomers[0].no);` →

```ts
  const [selectedCustomerNo, setSelectedCustomerNo] = useState<number | null>(null);
```

- [ ] **Step 3: selectedCustomer 폴백을 빈 배열 안전하게 수정**

`const selectedCustomer = customers.find((customer) => customer.no === selectedCustomerNo) ?? customers[0] ?? initialCustomers[0];` →

```ts
  const selectedCustomer = customers.find((customer) => customer.no === selectedCustomerNo) ?? customers[0] ?? null;
```

- [ ] **Step 4: 로드 effect 추가 (state 선언 직후)**

```ts
  useEffect(() => {
    let alive = true;
    fetchCustomers()
      .then((list) => {
        if (!alive) return;
        setCustomers(list);
        setSelectedCustomerNo((cur) => cur ?? list[0]?.no ?? null);
        setCustomersError(false);
      })
      .catch(() => alive && setCustomersError(true))
      .finally(() => alive && setCustomersLoading(false));
    return () => {
      alive = false;
    };
  }, []);
```

(App.tsx에 `useEffect` import가 없으면 `react`에서 추가.)

- [ ] **Step 5: selectedCustomer null 가드**

`selectedCustomer.name`/`.customerId`/`.no`를 참조하는 JSX·title 계산은 `selectedCustomer`가 null일 수 있으므로 옵셔널 체이닝/가드를 적용. title 계산(line ~106)의 분기를 다음으로:

```ts
      ? [`고객 관리 > 전체 보기 > ${selectedCustomer?.name ?? ""}`, `${selectedCustomer?.customerId ?? ""} 고객의 상담 기록, 상태, 견적 조건, 다음 액션을 한 화면에서 처리합니다.`]
```

drawer/detail 블록(`selectedCustomer.*` 사용처, line ~205~299)은 `selectedCustomer && (...)` 로 감싸거나 각 참조에 `selectedCustomer?.`/`?? ""` 적용. `chanceOverrides[selectedCustomer.no]` → `selectedCustomer ? chanceOverrides[selectedCustomer.no] : undefined`.

- [ ] **Step 6: 목록 영역에 로딩/에러 표시**

`CustomerManagementPage`를 렌더하는 `/customers` route 블록에서, `customersLoading`/`customersError`일 때 안내를 보이고 그 외 페이지를 렌더. 최소 변경으로 페이지 위에 배너만 추가하거나, `customersError &&` 배너 + 정상 렌더. 페이지는 빈 `customers=[]`도 안전하게 렌더하므로 로딩 중에도 페이지 렌더 가능(빈 목록).

```tsx
{customersError && <div className="notice-box error">고객 목록을 불러오지 못했습니다.</div>}
```

(이 배너를 CustomerManagementPage 렌더 직전에 둔다.)

- [ ] **Step 7: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 errors, 0 problems. (selectedCustomer null 참조가 남아 있으면 typecheck가 잡음 → Step 5 보강.)

- [ ] **Step 8: build**

Run: `bun run build`
Expected: 성공(청크 경고는 무관).

- [ ] **Step 9: commit**

```bash
git add client/src/App.tsx
git commit -m "feat(crm): App.tsx 고객 목록 API 로드(목업 제거, 로딩/에러)"
```

---

## Task 6: 통합 검증 + PR

- [ ] **Step 1: 전체 검증**

Run 순서대로, 각 통과 확인:
- `bun run typecheck` → 0
- `bun run lint` → 0
- `bun test --env-file=.env.local` → 31 pass (기존 28 + 신규 3)
- `bun run test:unit` → 기존 99 + 신규 3 = 102 pass
- `bun run build` → 성공

- [ ] **Step 2: 수동 화면 확인 (Vite dev)**

`bun run dev`(또는 기존 dev 스크립트)로 띄워 로그인 후 `/customers`:
- 목록에 21명 표시(접수 시각 내림차순), 차종/구매방식/상태/상담메모(nextAction) 채워짐, 담당은 "미배정".
- 고객 행 클릭 → 상세 drawer 표시(김민준 등).
- (스크린샷 또는 육안) 목업과 큰 누락 없는지 확인. 담당 "미배정"·날짜 포맷 차이는 예상된 범위.

- [ ] **Step 3: 브랜치 PR 생성·머지**

```bash
git push -u origin feat/0619-crm-customers-read
gh pr create --title "feat(crm): 고객 읽기 DB 연결(1차)" --body "스펙 ref/specs/2026-06-19-crm-customers-read-design.md. 고객 목록/상세를 crm.customers에서 읽기. 시드 21명. 쓰기·advisor 이름·정산·견적 범위 외. 검증: typecheck/lint/build/test:unit 102/test:server 31."
gh pr merge --squash --delete-branch
```

(브랜치는 Task 1 시작 전에 `git checkout -b feat/0619-crm-customers-read`로 생성해 전 Task 커밋을 담는다.)

---

## Self-Review

- **Spec coverage:** 목록 읽기(Task1 listCustomers·Task2 라우트·Task4 fetch·Task5 App) ✓ / 상세 읽기(Task1 getCustomer·Task2 /:id) ✓ / 시드 21명(Task3) ✓ / 프론트 adapter B안(Task4) ✓ / advisor 보류·정산·Topbar·쓰기 제외(전 Task에서 미포함) ✓ / 매핑표(Task4 toCustomer가 표대로) ✓ / 검증(Task6) ✓.
- **Placeholder scan:** 모든 step에 실제 코드/명령. "적절히 처리" 류 없음. App.tsx Step 5만 다수 참조처를 "옵셔널 체이닝 적용"으로 일반화 — 거대 파일 특성상 정확한 줄은 구현 시 typecheck가 강제(Step 7).
- **Type consistency:** `CustomerRow`(Task4)·`CustomerListRow`(Task1)·`toCustomer`/`fetchCustomers`(Task4)·`listCustomers`/`getCustomer`(Task1) 시그니처 전 Task 일치. 라우트 인스턴스 `customers`(Task2)와 schema `customers`는 다른 파일이라 충돌 없음. `no` 파생 규칙(customerCode 숫자부)은 Task4 정의·Task5에서 활용 일관.

## Execution

브랜치 생성 후 Task 1→6 순차. App.tsx(Task5)는 거대 컴포넌트라 단위테스트 없이 typecheck/lint/build + 수동 확인(CLAUDE.md 관례). 나머지는 TDD/통합테스트로 커버.
