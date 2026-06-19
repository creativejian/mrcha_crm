# 고객 자식 CRUD 쓰기 (고객 쓰기 #2) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 김민준 상세의 메모/할일/일정 추가·수정·삭제·완료토글을 DB에 저장(낙관 갱신+롤백, 추가는 임시 id→서버 uuid 교체). `customer_schedules.done` 신설로 일정 완료도 저장.

**Architecture:** 마이그레이션(schedules.done) → query `customer-children.ts`(신규 9개) → route `/:id/{memos,tasks,schedules}` 9개 → lib `customer-children.ts`(신규 9개) → Kim 핸들러 12개 wiring + 일정 완료 읽기 시드.

**Tech Stack:** drizzle/Hono/zod(백), React 19/TS 6.0.3(프론트), bun test.

연계 스펙: `ref/specs/2026-06-19-crm-customer-write-children-design.md`

---

## File Structure
- `src/db/schema.ts` — `customerSchedules.done` 추가.
- `drizzle/0002_*.sql` — `db:generate` 산출(schedules.done ADD COLUMN).
- `src/db/queries/customer-children.ts` — (신규) 9 CRUD 함수.
- `src/routes/customers.ts` — 자식 라우트 9개 + zod.
- `src/routes/customers.test.ts` — 자식 라운드트립 테스트.
- `client/src/lib/customer-children.ts` — (신규) 9 lib 함수.
- `client/src/lib/customers.ts` — `CustomerDetailSchedule.done`.
- `client/src/pages/CustomerDetailPage.tsx` — 12 핸들러 wiring + 완료 시드 + import.

---

## Task 1: 마이그레이션 — customer_schedules.done

**Files:** `src/db/schema.ts`, `drizzle/` (생성)

- [ ] **Step 1: 스키마에 done 추가**

`src/db/schema.ts`의 `customerSchedules`에서 `memo: text("memo"),` 다음 줄에 추가:
```ts
  memo: text("memo"),
  done: boolean("done").default(false).notNull(),
```
(`boolean`은 이미 import됨 — customerTasks.done에서 사용 중.)

- [ ] **Step 2: 마이그레이션 생성**

Run: `bun run db:generate`
Expected: `drizzle/0002_*.sql` 1파일 생성, 내용은 `ALTER TABLE "crm"."customer_schedules" ADD COLUMN "done" boolean DEFAULT false NOT NULL;` 류만. (다른 테이블 변경 없어야 함 — 있으면 중단하고 점검.)

- [ ] **Step 3: 마이그레이션 적용**

Run: `bun run db:migrate`
Expected: 0002 적용 성공. 확인:
```bash
set -a; source .env.local 2>/dev/null; set +a
psql "$DATABASE_URL" -c "select column_name from information_schema.columns where table_schema='crm' and table_name='customer_schedules' and column_name='done';"
```
Expected: `done` 1행.

- [ ] **Step 4: typecheck + 커밋**

Run: `bun run typecheck`
```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(crm): customer_schedules.done 컬럼 추가(일정 완료 저장용, drizzle 0002)"
```

---

## Task 2: 백엔드 query + route + 테스트

**Files:** `src/db/queries/customer-children.ts`(신규), `src/routes/customers.ts`, `src/routes/customers.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/routes/customers.test.ts` 끝에 추가(추가 import 없이 라우트만 호출):
```ts
test("자식 CRUD: 메모 POST→PATCH→DELETE 라운드트립", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;

  const created = await app.request(`/api/customers/${cid}/memos`, { method: "POST", headers: h, body: JSON.stringify({ body: "테스트 메모" }) });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };

  const patched = await app.request(`/api/customers/${cid}/memos/${id}`, { method: "PATCH", headers: h, body: JSON.stringify({ body: "수정됨" }) });
  expect(patched.status).toBe(200);

  const removed = await app.request(`/api/customers/${cid}/memos/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  expect(removed.status).toBe(200);
});

test("자식 CRUD: 할일·일정 POST→DELETE 라운드트립", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;

  const task = await app.request(`/api/customers/${cid}/tasks`, { method: "POST", headers: h, body: JSON.stringify({ category: "체크", due: "오늘", body: "t" }) });
  expect(task.status).toBe(201);
  const taskId = ((await task.json()) as { id: string }).id;
  expect((await app.request(`/api/customers/${cid}/tasks/${taskId}`, { method: "PATCH", headers: h, body: JSON.stringify({ done: true }) })).status).toBe(200);
  expect((await app.request(`/api/customers/${cid}/tasks/${taskId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);

  const sch = await app.request(`/api/customers/${cid}/schedules`, { method: "POST", headers: h, body: JSON.stringify({ scheduledDate: "2026-06-01", scheduledTime: "10:00", type: "견적", memo: "s" }) });
  expect(sch.status).toBe(201);
  const schId = ((await sch.json()) as { id: string }).id;
  expect((await app.request(`/api/customers/${cid}/schedules/${schId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
});

test("자식 CRUD: 없는 childId DELETE → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const res = await app.request(`/api/customers/${list[0].id}/memos/00000000-0000-0000-0000-000000000000`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: FAIL — `customer-children` 모듈/라우트 없음.

- [ ] **Step 3: query 구현**

`src/db/queries/customer-children.ts` 생성:
```ts
import { and, eq } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { customerMemos, customerSchedules, customerTasks } from "../schema";

type Created = { id: string; createdAt: Date };

// ── 메모 ───────────────────────────────────────────────
export async function addMemo(customerId: string, v: { body?: string | null }, ex: Executor = getDefaultDb()): Promise<Created> {
  const [row] = await ex.insert(customerMemos).values({ customerId, body: v.body ?? null }).returning({ id: customerMemos.id, createdAt: customerMemos.createdAt });
  return row;
}
export async function updateMemo(customerId: string, id: string, patch: { body?: string | null }, ex: Executor = getDefaultDb()): Promise<{ id: string } | null> {
  const [row] = await ex.update(customerMemos).set(patch).where(and(eq(customerMemos.id, id), eq(customerMemos.customerId, customerId))).returning({ id: customerMemos.id });
  return row ?? null;
}
export async function deleteMemo(customerId: string, id: string, ex: Executor = getDefaultDb()): Promise<{ id: string } | null> {
  const [row] = await ex.delete(customerMemos).where(and(eq(customerMemos.id, id), eq(customerMemos.customerId, customerId))).returning({ id: customerMemos.id });
  return row ?? null;
}

// ── 할일 ───────────────────────────────────────────────
export async function addTask(customerId: string, v: { category?: string | null; due?: string | null; body?: string | null }, ex: Executor = getDefaultDb()): Promise<Created> {
  const [row] = await ex.insert(customerTasks).values({ customerId, category: v.category ?? null, due: v.due ?? null, body: v.body ?? null }).returning({ id: customerTasks.id, createdAt: customerTasks.createdAt });
  return row;
}
export async function updateTask(customerId: string, id: string, patch: { category?: string | null; due?: string | null; body?: string | null; done?: boolean }, ex: Executor = getDefaultDb()): Promise<{ id: string } | null> {
  const [row] = await ex.update(customerTasks).set(patch).where(and(eq(customerTasks.id, id), eq(customerTasks.customerId, customerId))).returning({ id: customerTasks.id });
  return row ?? null;
}
export async function deleteTask(customerId: string, id: string, ex: Executor = getDefaultDb()): Promise<{ id: string } | null> {
  const [row] = await ex.delete(customerTasks).where(and(eq(customerTasks.id, id), eq(customerTasks.customerId, customerId))).returning({ id: customerTasks.id });
  return row ?? null;
}

// ── 일정 ───────────────────────────────────────────────
export async function addSchedule(customerId: string, v: { scheduledDate?: string | null; scheduledTime?: string | null; type?: string | null; memo?: string | null }, ex: Executor = getDefaultDb()): Promise<Created> {
  const [row] = await ex.insert(customerSchedules).values({ customerId, scheduledDate: v.scheduledDate ?? null, scheduledTime: v.scheduledTime ?? null, type: v.type ?? null, memo: v.memo ?? null }).returning({ id: customerSchedules.id, createdAt: customerSchedules.createdAt });
  return row;
}
export async function updateSchedule(customerId: string, id: string, patch: { scheduledDate?: string | null; scheduledTime?: string | null; type?: string | null; memo?: string | null; done?: boolean }, ex: Executor = getDefaultDb()): Promise<{ id: string } | null> {
  const [row] = await ex.update(customerSchedules).set(patch).where(and(eq(customerSchedules.id, id), eq(customerSchedules.customerId, customerId))).returning({ id: customerSchedules.id });
  return row ?? null;
}
export async function deleteSchedule(customerId: string, id: string, ex: Executor = getDefaultDb()): Promise<{ id: string } | null> {
  const [row] = await ex.delete(customerSchedules).where(and(eq(customerSchedules.id, id), eq(customerSchedules.customerId, customerId))).returning({ id: customerSchedules.id });
  return row ?? null;
}
```

- [ ] **Step 4: route 구현**

`src/routes/customers.ts`의 `PATCH /:id` 핸들러 블록 다음(파일 끝)에 추가. 상단 import도 보강:
```ts
import { getCustomer, listCustomers, updateCustomer } from "../db/queries/customers";
import {
  addMemo, updateMemo, deleteMemo,
  addTask, updateTask, deleteTask,
  addSchedule, updateSchedule, deleteSchedule,
} from "../db/queries/customer-children";
```
파일 끝에 추가:
```ts
const idParam = z.object({ id: z.uuid() });
const childParam = z.object({ id: z.uuid(), childId: z.uuid() });
const memoBody = z.object({ body: z.string().nullable().optional() });
const taskBody = z.object({ category: z.string().nullable().optional(), due: z.string().nullable().optional(), body: z.string().nullable().optional(), done: z.boolean().optional() });
const scheduleBody = z.object({ scheduledDate: z.string().nullable().optional(), scheduledTime: z.string().nullable().optional(), type: z.string().nullable().optional(), memo: z.string().nullable().optional(), done: z.boolean().optional() });

customers.post("/:id/memos", zValidator("param", idParam), zValidator("json", memoBody), async (c) =>
  c.json(await addMemo(c.req.valid("param").id, c.req.valid("json"), c.var.db), 201));
customers.patch("/:id/memos/:childId", zValidator("param", childParam), zValidator("json", memoBody), async (c) => {
  const p = c.req.valid("param");
  const row = await updateMemo(p.id, p.childId, c.req.valid("json"), c.var.db);
  return row ? c.json(row) : c.json({ error: "메모를 찾을 수 없습니다." }, 404);
});
customers.delete("/:id/memos/:childId", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await deleteMemo(p.id, p.childId, c.var.db);
  return row ? c.json(row) : c.json({ error: "메모를 찾을 수 없습니다." }, 404);
});

customers.post("/:id/tasks", zValidator("param", idParam), zValidator("json", taskBody), async (c) =>
  c.json(await addTask(c.req.valid("param").id, c.req.valid("json"), c.var.db), 201));
customers.patch("/:id/tasks/:childId", zValidator("param", childParam), zValidator("json", taskBody), async (c) => {
  const p = c.req.valid("param");
  const row = await updateTask(p.id, p.childId, c.req.valid("json"), c.var.db);
  return row ? c.json(row) : c.json({ error: "할 일을 찾을 수 없습니다." }, 404);
});
customers.delete("/:id/tasks/:childId", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await deleteTask(p.id, p.childId, c.var.db);
  return row ? c.json(row) : c.json({ error: "할 일을 찾을 수 없습니다." }, 404);
});

customers.post("/:id/schedules", zValidator("param", idParam), zValidator("json", scheduleBody), async (c) =>
  c.json(await addSchedule(c.req.valid("param").id, c.req.valid("json"), c.var.db), 201));
customers.patch("/:id/schedules/:childId", zValidator("param", childParam), zValidator("json", scheduleBody), async (c) => {
  const p = c.req.valid("param");
  const row = await updateSchedule(p.id, p.childId, c.req.valid("json"), c.var.db);
  return row ? c.json(row) : c.json({ error: "일정을 찾을 수 없습니다." }, 404);
});
customers.delete("/:id/schedules/:childId", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await deleteSchedule(p.id, p.childId, c.var.db);
  return row ? c.json(row) : c.json({ error: "일정을 찾을 수 없습니다." }, 404);
});
```

- [ ] **Step 5: 테스트 통과 + typecheck + lint**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: PASS(기존 8 + 신규 3 = 11).
Run: `bun run typecheck && bun run lint`
Expected: 0 / 0.

- [ ] **Step 6: 커밋**

```bash
git add src/db/queries/customer-children.ts src/routes/customers.ts src/routes/customers.test.ts
git commit -m "feat(crm): 자식 CRUD 백엔드(customer-children query + 중첩 라우트 9개)"
```

---

## Task 3: 프론트 lib + 일정 done 읽기 타입

**Files:** `client/src/lib/customer-children.ts`(신규), `client/src/lib/customers.ts`

- [ ] **Step 1: lib customer-children.ts 생성**
```ts
import { apiFetch } from "./api";

export type ChildCreated = { id: string; createdAt: string };

async function writeJson(path: string, method: "POST" | "PATCH", body: unknown): Promise<Response> {
  const res = await apiFetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path} 실패: ${res.status}`);
  return res;
}
async function del(path: string): Promise<void> {
  const res = await apiFetch(path, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} 실패: ${res.status}`);
}

type MemoBody = { body?: string | null };
type TaskBody = { category?: string | null; due?: string | null; body?: string | null; done?: boolean };
type ScheduleBody = { scheduledDate?: string | null; scheduledTime?: string | null; type?: string | null; memo?: string | null; done?: boolean };

export const addMemo = (cid: string, v: MemoBody) => writeJson(`/api/customers/${cid}/memos`, "POST", v).then((r) => r.json() as Promise<ChildCreated>);
export const updateMemo = (cid: string, id: string, v: MemoBody) => writeJson(`/api/customers/${cid}/memos/${id}`, "PATCH", v).then(() => undefined);
export const deleteMemo = (cid: string, id: string) => del(`/api/customers/${cid}/memos/${id}`);

export const addTask = (cid: string, v: TaskBody) => writeJson(`/api/customers/${cid}/tasks`, "POST", v).then((r) => r.json() as Promise<ChildCreated>);
export const updateTask = (cid: string, id: string, v: TaskBody) => writeJson(`/api/customers/${cid}/tasks/${id}`, "PATCH", v).then(() => undefined);
export const deleteTask = (cid: string, id: string) => del(`/api/customers/${cid}/tasks/${id}`);

export const addSchedule = (cid: string, v: ScheduleBody) => writeJson(`/api/customers/${cid}/schedules`, "POST", v).then((r) => r.json() as Promise<ChildCreated>);
export const updateSchedule = (cid: string, id: string, v: ScheduleBody) => writeJson(`/api/customers/${cid}/schedules/${id}`, "PATCH", v).then(() => undefined);
export const deleteSchedule = (cid: string, id: string) => del(`/api/customers/${cid}/schedules/${id}`);
```

- [ ] **Step 2: CustomerDetailSchedule에 done 추가**

`client/src/lib/customers.ts`:
```ts
export type CustomerDetailSchedule = { id: string; scheduledDate: string | null; scheduledTime: string | null; type: string | null; memo: string | null };
```
→
```ts
export type CustomerDetailSchedule = { id: string; scheduledDate: string | null; scheduledTime: string | null; type: string | null; memo: string | null; done: boolean };
```
(어댑터 `toCustomerDetail`은 `schedules: res.schedules ?? []` passthrough라 done 자동 포함.)

- [ ] **Step 3: typecheck + lint + 커밋**

Run: `bun run typecheck && bun run lint`
Expected: 0 / 0.
```bash
git add client/src/lib/customer-children.ts client/src/lib/customers.ts
git commit -m "feat(crm): 프론트 자식 CRUD lib(customer-children) + 일정 done 읽기 타입"
```

---

## Task 4: Kim wiring — 메모

**Files:** `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: import 추가**

`import { fetchCustomerDetail, formatActivity, updateCustomer, type CustomerDetailData, type CustomerWritePatch } from "@/lib/customers";` 다음 줄에 추가:
```ts
import { addMemo, updateMemo, deleteMemo, addTask, updateTask, deleteTask, addSchedule, updateSchedule as apiUpdateSchedule, deleteSchedule as apiDeleteSchedule } from "@/lib/customer-children";
```

- [ ] **Step 2: saveCustomerMemo wiring**

```ts
    if (!body) return;
    setCustomerMemos((current) => [...current, {
      id: `kim-customer-memo-${Date.now()}`,
      body,
      createdAt: formatKoreanShortTime(),
    }]);
    setAddingCustomerMemo(false);
    setEditingCustomerMemoId(null);
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모가 추가되었습니다.");
  }
```
→
```ts
    if (!body) return;
    const tempId = `kim-customer-memo-${Date.now()}`;
    setCustomerMemos((current) => [...current, { id: tempId, body, createdAt: formatKoreanShortTime() }]);
    setAddingCustomerMemo(false);
    setEditingCustomerMemoId(null);
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모가 추가되었습니다.");
    if (!customer.id) return;
    void addMemo(customer.id, { body })
      .then((res) => setCustomerMemos((current) => current.map((m) => (m.id === tempId ? { ...m, id: res.id, createdAt: formatActivity(res.createdAt) } : m))))
      .catch(() => { setCustomerMemos((current) => current.filter((m) => m.id !== tempId)); onToast("저장에 실패했습니다"); });
  }
```

- [ ] **Step 3: updateCustomerMemo wiring**

```ts
    if (!body) return;
    setCustomerMemos((current) => current.map((item) => (
      item.id === id ? { ...item, body } : item
    )));
    setEditingCustomerMemoId(null);
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모를 수정했습니다.");
  }
```
→
```ts
    if (!body) return;
    const prevMemos = customerMemos;
    setCustomerMemos((current) => current.map((item) => (
      item.id === id ? { ...item, body } : item
    )));
    setEditingCustomerMemoId(null);
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모를 수정했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void updateMemo(customer.id, id, { body }).catch(() => { setCustomerMemos(prevMemos); onToast("저장에 실패했습니다"); });
    }
  }
```

- [ ] **Step 4: deleteCustomerMemo wiring**

```ts
  function deleteCustomerMemo(id: string) {
    setCustomerMemos((current) => current.filter((item) => item.id !== id));
    setEditingCustomerMemoId((current) => (current === id ? null : current));
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모를 삭제했습니다.");
  }
```
→
```ts
  function deleteCustomerMemo(id: string) {
    const prevMemos = customerMemos;
    setCustomerMemos((current) => current.filter((item) => item.id !== id));
    setEditingCustomerMemoId((current) => (current === id ? null : current));
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모를 삭제했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void deleteMemo(customer.id, id).catch(() => { setCustomerMemos(prevMemos); onToast("삭제에 실패했습니다"); });
    }
  }
```

- [ ] **Step 5: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 / 0. (아직 일부 import 미사용 경고 가능 — Task 5/6에서 사용. lint가 unused import을 에러로 잡으면 Task 6까지 한 묶음으로 보고 Task 6 후 검증.)

---

## Task 5: Kim wiring — 할일(checkItems)

**Files:** `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: saveCheckItem wiring**

```ts
    const due = dueSelection === "지정" ? formatShortDateLabel(dueDate) : dueSelection;
    setCheckItems((current) => [...current, {
      id: `kim-check-${Date.now()}`,
      category,
      due,
      body,
    }]);
    setAddingCheckItem(false);
    setSelectedCheckDue("오늘");
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일이 추가되었습니다.");
  }
```
→
```ts
    const due = dueSelection === "지정" ? formatShortDateLabel(dueDate) : dueSelection;
    const tempId = `kim-check-${Date.now()}`;
    setCheckItems((current) => [...current, { id: tempId, category, due, body }]);
    setAddingCheckItem(false);
    setSelectedCheckDue("오늘");
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일이 추가되었습니다.");
    if (!customer.id) return;
    void addTask(customer.id, { category, due, body })
      .then((res) => setCheckItems((current) => current.map((t) => (t.id === tempId ? { ...t, id: res.id } : t))))
      .catch(() => { setCheckItems((current) => current.filter((t) => t.id !== tempId)); onToast("저장에 실패했습니다"); });
  }
```

- [ ] **Step 2: updateCheckItem wiring**

```ts
    const due = dueSelection === "지정" ? (dueDate ? formatShortDateLabel(dueDate) : currentDue) : dueSelection;
    setCheckItems((current) => current.map((item) => (
      item.id === id ? { ...item, category, due, body } : item
    )));
    cancelCheckItemEdit();
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일을 수정했습니다.");
  }
```
→
```ts
    const due = dueSelection === "지정" ? (dueDate ? formatShortDateLabel(dueDate) : currentDue) : dueSelection;
    const prevCheckItems = checkItems;
    setCheckItems((current) => current.map((item) => (
      item.id === id ? { ...item, category, due, body } : item
    )));
    cancelCheckItemEdit();
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일을 수정했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void updateTask(customer.id, id, { category, due, body }).catch(() => { setCheckItems(prevCheckItems); onToast("저장에 실패했습니다"); });
    }
  }
```

- [ ] **Step 3: toggleCheckItem wiring**

```ts
  function toggleCheckItem(id: string) {
    setCompletedCheckItems((current) => (
      current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]
    ));
    setConfirmingCheckItemTitle(null);
    markRecentUpdate("해야 할 일");
  }
```
→
```ts
  function toggleCheckItem(id: string) {
    const nextDone = !completedCheckItems.includes(id);
    const prevCompleted = completedCheckItems;
    setCompletedCheckItems((current) => (
      current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]
    ));
    setConfirmingCheckItemTitle(null);
    markRecentUpdate("해야 할 일");
    if (customer.id && !id.startsWith("kim-")) {
      void updateTask(customer.id, id, { done: nextDone }).catch(() => { setCompletedCheckItems(prevCompleted); onToast("저장에 실패했습니다"); });
    }
  }
```

- [ ] **Step 4: deleteCheckItem wiring**

```ts
  function deleteCheckItem(id: string) {
    setCheckItems((current) => current.filter((item) => item.id !== id));
    setCompletedCheckItems((current) => current.filter((itemId) => itemId !== id));
    setEditingCheckItemId((current) => (current === id ? null : current));
    setConfirmingCheckItemTitle(null);
    setConfirmingCheckItemDeleteId(null);
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일을 삭제했습니다.");
```
→
```ts
  function deleteCheckItem(id: string) {
    const prevCheckItems = checkItems;
    const prevCompleted = completedCheckItems;
    setCheckItems((current) => current.filter((item) => item.id !== id));
    setCompletedCheckItems((current) => current.filter((itemId) => itemId !== id));
    setEditingCheckItemId((current) => (current === id ? null : current));
    setConfirmingCheckItemTitle(null);
    setConfirmingCheckItemDeleteId(null);
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일을 삭제했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void deleteTask(customer.id, id).catch(() => { setCheckItems(prevCheckItems); setCompletedCheckItems(prevCompleted); onToast("삭제에 실패했습니다"); });
    }
```
(닫는 `}`는 기존 유지.)

---

## Task 6: Kim wiring — 일정(schedules) + 완료 시드

**Files:** `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: completedScheduleKeys 완료 시드**

```ts
  const [completedScheduleKeys, setCompletedScheduleKeys] = useState<string[]>([]);
```
→
```ts
  const [completedScheduleKeys, setCompletedScheduleKeys] = useState<string[]>(() =>
    detail.schedules.filter((s) => s.done).map((s) => s.id),
  );
```

- [ ] **Step 2: saveSchedule wiring**

```ts
    if (!nextSchedule.memo) return;
    setSchedules((current) => [...current, nextSchedule]);
    setAddingScheduleItem(false);
    setOpenEditor(null);
    markRecentUpdate("예정 일정");
    onToast("예정 일정이 생성되었습니다.");
  }
```
→
```ts
    if (!nextSchedule.memo) return;
    setSchedules((current) => [...current, nextSchedule]);
    setAddingScheduleItem(false);
    setOpenEditor(null);
    markRecentUpdate("예정 일정");
    onToast("예정 일정이 생성되었습니다.");
    if (!customer.id) return;
    void addSchedule(customer.id, { scheduledDate: nextSchedule.date, scheduledTime: nextSchedule.time, type: nextSchedule.type, memo: nextSchedule.memo })
      .then((res) => setSchedules((current) => current.map((s) => (s.id === nextSchedule.id ? { ...s, id: res.id } : s))))
      .catch(() => { setSchedules((current) => current.filter((s) => s.id !== nextSchedule.id)); onToast("저장에 실패했습니다"); });
  }
```

- [ ] **Step 3: updateSchedule wiring**

```ts
    if (!memo) return;
    setSchedules((current) => current.map((item) => (
      item.id === id ? { ...item, date, time, type, memo } : item
    )));
    setEditingScheduleId(null);
    markRecentUpdate("예정 일정");
    onToast("예정 일정을 수정했습니다.");
  }
```
→
```ts
    if (!memo) return;
    const prevSchedules = schedules;
    setSchedules((current) => current.map((item) => (
      item.id === id ? { ...item, date, time, type, memo } : item
    )));
    setEditingScheduleId(null);
    markRecentUpdate("예정 일정");
    onToast("예정 일정을 수정했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void apiUpdateSchedule(customer.id, id, { scheduledDate: date, scheduledTime: time, type, memo }).catch(() => { setSchedules(prevSchedules); onToast("저장에 실패했습니다"); });
    }
  }
```

- [ ] **Step 4: toggleScheduleComplete wiring**

```ts
  function toggleScheduleComplete(item: KimScheduleItem) {
    const key = scheduleRecordKey(item);
    setCompletedScheduleKeys((current) => (
      current.includes(key) ? current.filter((completedKey) => completedKey !== key) : [...current, key]
    ));
    setConfirmingScheduleCompleteId(null);
    markRecentUpdate("예정 일정");
  }
```
→
```ts
  function toggleScheduleComplete(item: KimScheduleItem) {
    const key = scheduleRecordKey(item);
    const nextDone = !completedScheduleKeys.includes(key);
    const prevCompleted = completedScheduleKeys;
    setCompletedScheduleKeys((current) => (
      current.includes(key) ? current.filter((completedKey) => completedKey !== key) : [...current, key]
    ));
    setConfirmingScheduleCompleteId(null);
    markRecentUpdate("예정 일정");
    if (customer.id && !item.id.startsWith("kim-")) {
      void apiUpdateSchedule(customer.id, item.id, { done: nextDone }).catch(() => { setCompletedScheduleKeys(prevCompleted); onToast("저장에 실패했습니다"); });
    }
  }
```

- [ ] **Step 5: deleteSchedule wiring**

```ts
  function deleteSchedule(id: string) {
    setSchedules((current) => current.filter((item) => item.id !== id));
    setCompletedScheduleKeys((current) => current.filter((key) => key !== id));
    setEditingScheduleId((current) => (current === id ? null : current));
    setConfirmingScheduleDeleteId(null);
    markRecentUpdate("예정 일정");
    onToast("예정 일정을 삭제했습니다.");
  }
```
→
```ts
  function deleteSchedule(id: string) {
    const prevSchedules = schedules;
    const prevCompleted = completedScheduleKeys;
    setSchedules((current) => current.filter((item) => item.id !== id));
    setCompletedScheduleKeys((current) => current.filter((key) => key !== id));
    setEditingScheduleId((current) => (current === id ? null : current));
    setConfirmingScheduleDeleteId(null);
    markRecentUpdate("예정 일정");
    onToast("예정 일정을 삭제했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void apiDeleteSchedule(customer.id, id).catch(() => { setSchedules(prevSchedules); setCompletedScheduleKeys(prevCompleted); onToast("삭제에 실패했습니다"); });
    }
  }
```

- [ ] **Step 6: typecheck + lint + build**

Run: `bun run typecheck && bun run lint && bun run build`
Expected: 0 / 0 / OK.

- [ ] **Step 7: 커밋**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 김민준 상세 메모/할일/일정 CRUD 저장 wiring(낙관+롤백, 임시id 교체)"
```

---

## Task 7: 통합 검증

**Files:** 없음

- [ ] **Step 1: 전체 스위트**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run build`
Expected: 전부 통과.
Run: `bun test --env-file=.env.local`
Expected: test:server 통과(+자식 3).

- [ ] **Step 2: 수동 확인(로그인 세션)**

`bun run dev`(또는 배포) 로그인 후 김민준 상세에서:
1. 고객 메모 추가 → 새로고침 → 유지. 추가 직후 그 메모 수정/삭제 동작(임시 id가 서버 uuid로 교체됨).
2. 할일 추가/수정/삭제/완료토글 → 새로고침 → 유지(완료 상태 포함).
3. 예정 일정 추가/수정/삭제/완료토글 → 새로고침 → 유지(완료 상태 포함 — done 컬럼).
4. (선택) 네트워크 차단 후 조작 → 롤백 + "저장에 실패했습니다".

- [ ] **Step 3: brief 갱신 + 커밋**

`ref/active-session-brief.md` Current Focus/완료/Next를 "고객 쓰기 #2(자식 CRUD) 완료, 다음=#3 서류"로 갱신. (커밋 메시지에 skip-ci 마커 금지.)
```bash
git add ref/active-session-brief.md
git commit -m "docs: active-session-brief 갱신 — 고객 쓰기 #2(자식 CRUD) 완료"
```

---

## Self-Review 메모
- **스펙 커버리지**: 마이그레이션 done(T1) · 백엔드 9 query+route+테스트(T2) · 프론트 lib 9+done타입(T3) · 메모(T4)/할일(T5)/일정+완료시드(T6) wiring. ✅
- **플레이스홀더 스캔**: 모든 단계 실제 코드. ✅
- **타입 일관성**: query(`add*`→Created, `update/delete*`→{id}|null) ↔ route ↔ lib(`add*`→ChildCreated, `update/delete*`→void) 일치. Kim import 별칭(`apiUpdateSchedule`/`apiDeleteSchedule`)로 핸들러 `updateSchedule`/`deleteSchedule`와 충돌 회피. `completedScheduleKeys` 시드는 `detail.schedules[].done`(T3에서 타입 추가) 의존. ✅
- **알려진 캐비엇/race**: 추가 직후 POST 해소 전(임시 id) 그 항목을 수정/삭제/토글하면 `id.startsWith("kim-")` 가드로 **API 생략**(낙관만) → 그 변경은 DB 미반영(추가는 원래 값으로 저장됨). 새로고침 시 추가본만 보임. POST가 ms 단위라 실사용 흐름(추가→확인→조작)에선 발생 안 함. 삭제-during-add는 드물게 orphan 가능(다음 새로고침서 보임) — #2 수용, 추후 in-flight 큐로 개선 가능.
- **검증**: test:server 자식 라운드트립은 생성→삭제로 prod 비파괴. 마이그레이션은 crm만(schemaFilter), 0002 단일.
