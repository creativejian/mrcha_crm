# 고객 본체 필드 쓰기 (고객 쓰기 #1) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객 상세/목록의 인라인 수정을 `crm.customers` 컬럼에 한해 `PATCH /api/customers/:id`로 저장한다(낙관 갱신 + 실패 롤백). 새로고침해도 유지.

**Architecture:** 읽기와 동일 3계층 — query `updateCustomer` → route `PATCH /:id`(zod) → lib `updateCustomer`. Kim 상세 핸들러는 `savePatch` 헬퍼로 PATCH, 워크플로우(진행상태/계약가능성)는 App `updateCustomerWorkflow` 한 곳에서 PATCH(목록·상세 동시). chance는 읽기 시드 추가로 라운드트립.

**Tech Stack:** Hono + drizzle + zod(백), React 19 + TS 6.0.3(프론트), bun test / vitest.

연계 스펙: `ref/specs/2026-06-19-crm-customer-write-fields-design.md`

---

## File Structure

- `src/db/queries/customers.ts` — `CustomerWritePatch` 타입 + `updateCustomer(id, patch, executor)`.
- `src/routes/customers.ts` — `customerWriteSchema`(export) + `PATCH /:id`.
- `src/routes/customers.test.ts` — schema + PATCH 테스트(확장).
- `client/src/data/customers.ts` — `Customer.chance?: string`.
- `client/src/lib/customers.ts` — `CustomerWritePatch` + `updateCustomer`; `CustomerRow.chance` + `toCustomer` chance.
- `client/src/lib/customers.test.ts` — toCustomer chance 테스트(확장).
- `client/src/App.tsx` — `updateCustomerWorkflow` PATCH+롤백, `fetchCustomers` chance 시드.
- `client/src/pages/CustomerDetailPage.tsx` — `savePatch` 헬퍼 + 핸들러 8개 wiring.

---

## Task 1: 백엔드 — updateCustomer query + PATCH route (TDD)

**Files:**
- Modify: `src/db/queries/customers.ts`
- Modify: `src/routes/customers.ts`
- Test: `src/routes/customers.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/routes/customers.test.ts` 끝에 추가:

```ts
import { customerWriteSchema } from "./customers";

test("customerWriteSchema: 유효 부분 입력 파싱", () => {
  const r = customerWriteSchema.safeParse({ phone: "010-1-2", chance: "높음", needMemo: null });
  expect(r.success).toBe(true);
});

test("customerWriteSchema: 잘못된 타입 거부", () => {
  const r = customerWriteSchema.safeParse({ phone: 123 });
  expect(r.success).toBe(false);
});

test("PATCH /api/customers/:id 없는 uuid → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/customers/00000000-0000-0000-0000-000000000000", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "발송완료" }),
  });
  expect(res.status).toBe(404);
});

test("PATCH /api/customers/:id 잘못된 body → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/customers/00000000-0000-0000-0000-000000000000", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phone: 123 }),
  });
  expect(res.status).toBe(400);
});

test("PATCH /api/customers/:id 같은 값 비파괴 → 200", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const listRes = await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } });
  const list = (await listRes.json()) as Array<{ id: string; source: string | null }>;
  const target = list[0];
  const res = await app.request(`/api/customers/${target.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ source: target.source }),
  });
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: FAIL — `customerWriteSchema` export 없음(import 에러).

- [ ] **Step 3: query `updateCustomer` 구현**

`src/db/queries/customers.ts`의 `listCustomers` 함수 정의 **앞**(라인 23 `export async function listCustomers` 위)에 추가:

```ts
// 쓰기 가능한 customers 컬럼만(고객 쓰기 #1 범위). 값 enum 검증은 추후.
export type CustomerWritePatch = Partial<
  Pick<
    typeof customers.$inferInsert,
    | "phone"
    | "residence"
    | "customerType"
    | "customerTypeDetail"
    | "source"
    | "statusGroup"
    | "status"
    | "chance"
    | "needModel"
    | "needTrim"
    | "needColors"
    | "needMethod"
    | "needTiming"
    | "needMemo"
  >
>;

export async function updateCustomer(
  id: string,
  patch: CustomerWritePatch,
  executor: Executor = getDefaultDb(),
): Promise<{ id: string } | null> {
  const [row] = await executor
    .update(customers)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(customers.id, id))
    .returning({ id: customers.id });
  return row ?? null;
}
```

- [ ] **Step 4: route `PATCH /:id` 구현**

`src/routes/customers.ts`를 아래로 교체:

```ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getCustomer, listCustomers, updateCustomer } from "../db/queries/customers";
import type { DbVariables } from "../middleware/db";

export const customers = new Hono<{ Variables: DbVariables }>();

// 쓰기 가능 컬럼(전부 optional·문자열 nullable). 값 enum 검증 없음(추후 사이클).
export const customerWriteSchema = z.object({
  phone: z.string().nullable().optional(),
  residence: z.string().nullable().optional(),
  customerType: z.string().nullable().optional(),
  customerTypeDetail: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  statusGroup: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  chance: z.string().nullable().optional(),
  needModel: z.string().nullable().optional(),
  needTrim: z.string().nullable().optional(),
  needColors: z.string().nullable().optional(),
  needMethod: z.string().nullable().optional(),
  needTiming: z.string().nullable().optional(),
  needMemo: z.string().nullable().optional(),
});

customers.get("/", async (c) => c.json(await listCustomers(c.var.db)));

customers.get("/:id", zValidator("param", z.object({ id: z.uuid() })), async (c) => {
  const row = await getCustomer(c.req.valid("param").id, c.var.db);
  return row ? c.json(row) : c.json({ error: "고객을 찾을 수 없습니다." }, 404);
});

customers.patch(
  "/:id",
  zValidator("param", z.object({ id: z.uuid() })),
  zValidator("json", customerWriteSchema),
  async (c) => {
    const row = await updateCustomer(c.req.valid("param").id, c.req.valid("json"), c.var.db);
    return row ? c.json(row) : c.json({ error: "고객을 찾을 수 없습니다." }, 404);
  },
);
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: PASS (기존 3 + 신규 5 = 8).

- [ ] **Step 6: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 / 0.

- [ ] **Step 7: 커밋**

```bash
git add src/db/queries/customers.ts src/routes/customers.ts src/routes/customers.test.ts
git commit -m "feat(crm): 고객 본체 PATCH /api/customers/:id (updateCustomer + writeSchema)"
```

---

## Task 2: 프론트 lib + data — updateCustomer + chance 읽기

**Files:**
- Modify: `client/src/data/customers.ts`
- Modify: `client/src/lib/customers.ts`
- Test: `client/src/lib/customers.test.ts`

- [ ] **Step 1: 실패 테스트 작성(toCustomer chance)**

`client/src/lib/customers.test.ts`의 `describe("toCustomer", ...)` 안 마지막 `it` 뒤에 추가:

```ts
  it("chance를 전달(없으면 undefined)", () => {
    expect(toCustomer({ ...row, chance: "높음" }).chance).toBe("높음");
    expect(toCustomer(row).chance).toBeUndefined();
  });
```

> 같은 파일 상단 `const row: CustomerRow`에 `chance: null,`을 추가한다(타입 충족):
```ts
  lastActivityAt: "2026-05-14T14:20:00+09:00",
  latestTask: "GLC 재고 확인",
  chance: null,
};
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/customers.test.ts`
Expected: FAIL — `chance`가 `CustomerRow`/`Customer`에 없음(타입 에러) 또는 단언 실패.

- [ ] **Step 3: data — Customer.chance 추가**

`client/src/data/customers.ts`의 `Customer` 타입에서 `priority: string;` 다음 줄에 추가:

```ts
  priority: string;
  chance?: string;
```

- [ ] **Step 4: lib — CustomerRow.chance, toCustomer, updateCustomer**

`client/src/lib/customers.ts`:

(4a) `CustomerRow` 타입에 `chance` 추가(`priority` 다음):
```ts
  priority: string | null;
  chance: string | null;
  aiSummary: string | null;
```

(4b) `toCustomer` 반환에 chance 추가(`priority` 줄 다음):
```ts
    priority: row.priority ?? "",
    chance: row.chance ?? undefined,
    nextAction: row.latestTask ?? "",
```

(4c) 파일 끝에 쓰기 타입/함수 추가:
```ts
// 고객 본체 PATCH 페이로드(쓰기 가능 컬럼 partial). 백엔드 customerWriteSchema와 1:1.
export type CustomerWritePatch = {
  phone?: string | null;
  residence?: string | null;
  customerType?: string | null;
  customerTypeDetail?: string | null;
  source?: string | null;
  statusGroup?: string | null;
  status?: string | null;
  chance?: string | null;
  needModel?: string | null;
  needTrim?: string | null;
  needColors?: string | null;
  needMethod?: string | null;
  needTiming?: string | null;
  needMemo?: string | null;
};

export async function updateCustomer(id: string, patch: CustomerWritePatch): Promise<void> {
  const res = await apiFetch(`/api/customers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`고객 저장 실패: ${res.status}`);
}
```

- [ ] **Step 5: 통과 확인**

Run: `bun run test:unit client/src/lib/customers.test.ts`
Expected: PASS.

- [ ] **Step 6: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 / 0. (App/Kim 미배선이라 에러 없음 — `chance`는 optional 추가, 기존 코드 영향 없음.)

- [ ] **Step 7: 커밋**

```bash
git add client/src/data/customers.ts client/src/lib/customers.ts client/src/lib/customers.test.ts
git commit -m "feat(crm): 프론트 updateCustomer + chance 읽기(CustomerRow/Customer/toCustomer)"
```

---

## Task 3: App — 워크플로우 PATCH + chance 시드

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: import 확장**

`import { fetchCustomers } from "@/lib/customers";` →
```ts
import { fetchCustomers, updateCustomer, type CustomerWritePatch } from "@/lib/customers";
```

- [ ] **Step 2: fetchCustomers에서 chance 시드**

```ts
      .then((list) => {
        if (!alive) return;
        setCustomers(list);
        setCustomersError(false);
        setCustomersLoaded(true);
      })
```
→
```ts
      .then((list) => {
        if (!alive) return;
        setCustomers(list);
        setChanceOverrides(
          Object.fromEntries(list.filter((c) => c.chance).map((c) => [c.no, c.chance as CustomerChanceOption])),
        );
        setCustomersError(false);
        setCustomersLoaded(true);
      })
```

- [ ] **Step 3: updateCustomerWorkflow에 PATCH+롤백 추가**

함수 전체를 교체:
```ts
  function updateCustomerWorkflow(customerNo: number, next: { statusGroup?: string; status?: string; chance?: CustomerChanceOption; manageStatus?: CustomerManageStatus }) {
    if (next.statusGroup || next.status) {
      const currentCustomer = customers.find((customer) => customer.no === customerNo);
      const nextStageGroup = next.statusGroup ?? currentCustomer?.statusGroup ?? statusGroupByStatus[next.status ?? ""] ?? "";
      setCustomers((current) => current.map((customer) => {
        if (customer.no !== customerNo) return customer;
        const statusGroup = next.statusGroup ?? customer.statusGroup;
        const status = next.status ?? customer.status;
        return { ...customer, statusGroup, status, date: "방금 전" };
      }));
      syncChanceWithStageGroup(customerNo, nextStageGroup);
    }

    if (next.chance) {
      setChanceOverrides((current) => ({ ...current, [customerNo]: next.chance as CustomerChanceOption }));
    }

    if (next.manageStatus) {
      setManageStatusOverrides((current) => ({ ...current, [customerNo]: next.manageStatus as CustomerManageStatus }));
    }
  }
```
→
```ts
  function updateCustomerWorkflow(customerNo: number, next: { statusGroup?: string; status?: string; chance?: CustomerChanceOption; manageStatus?: CustomerManageStatus }) {
    const target = customers.find((customer) => customer.no === customerNo);
    const prevCustomers = customers;
    const prevChanceOverrides = chanceOverrides;

    if (next.statusGroup || next.status) {
      const nextStageGroup = next.statusGroup ?? target?.statusGroup ?? statusGroupByStatus[next.status ?? ""] ?? "";
      setCustomers((current) => current.map((customer) => {
        if (customer.no !== customerNo) return customer;
        const statusGroup = next.statusGroup ?? customer.statusGroup;
        const status = next.status ?? customer.status;
        return { ...customer, statusGroup, status, date: "방금 전" };
      }));
      syncChanceWithStageGroup(customerNo, nextStageGroup);
    }

    if (next.chance) {
      setChanceOverrides((current) => ({ ...current, [customerNo]: next.chance as CustomerChanceOption }));
    }

    if (next.manageStatus) {
      setManageStatusOverrides((current) => ({ ...current, [customerNo]: next.manageStatus as CustomerManageStatus }));
    }

    // DB 저장(statusGroup/status/chance만 — manageStatus는 컬럼 없음). chance는 계약완료 동기화 규칙 반영.
    const patch: CustomerWritePatch = {};
    if (next.statusGroup) patch.statusGroup = next.statusGroup;
    if (next.status) patch.status = next.status;
    if (next.statusGroup === "계약완료") patch.chance = "확정";
    else if (next.statusGroup && prevChanceOverrides[customerNo] === "확정") patch.chance = null;
    else if (next.chance) patch.chance = next.chance;
    if (target?.id && Object.keys(patch).length > 0) {
      updateCustomer(target.id, patch).catch(() => {
        setCustomers(prevCustomers);
        setChanceOverrides(prevChanceOverrides);
        showToast("저장에 실패했습니다");
      });
    }
  }
```

- [ ] **Step 4: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 / 0.

- [ ] **Step 5: 커밋**

```bash
git add client/src/App.tsx
git commit -m "feat(crm): 진행상태/계약가능성 변경 DB persist(App updateCustomerWorkflow) + chance 읽기 시드"
```

---

## Task 4: Kim 상세 핸들러 wiring (savePatch)

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: import 확장**

```ts
import { fetchCustomerDetail, formatActivity, type CustomerDetailData } from "@/lib/customers";
```
→
```ts
import { fetchCustomerDetail, formatActivity, updateCustomer, type CustomerDetailData, type CustomerWritePatch } from "@/lib/customers";
```

- [ ] **Step 2: savePatch 헬퍼 추가**

`function markRecentUpdate(section: string) { … }` 정의 **다음**에 추가:
```ts
  // 낙관 갱신 후 백그라운드 PATCH. 실패 시 rollback + 토스트(쓰기는 재시도 안 함).
  function savePatch(patch: CustomerWritePatch, rollback: () => void) {
    if (!customer.id) return;
    void updateCustomer(customer.id, patch).catch(() => {
      rollback();
      onToast("저장에 실패했습니다");
    });
  }
```

- [ ] **Step 3: saveStatusField(연락처) wiring**

```ts
    if (!value) return;
    setStatusValues((current) => ({ ...current, [key]: value }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast(`${fieldLabel(key)} 수정 완료`);
  }
```
→
```ts
    if (!value) return;
    const prev = statusValues[key];
    setStatusValues((current) => ({ ...current, [key]: value }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast(`${fieldLabel(key)} 수정 완료`);
    if (key === "phone") savePatch({ phone: value }, () => setStatusValues((current) => ({ ...current, phone: prev })));
  }
```

- [ ] **Step 4: saveJobField wiring**

```ts
    const nextJobValue = formatKimJobValue(customerType, customerTypeDetail);
    setStatusValues((current) => ({ ...current, job: nextJobValue }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("직군 수정 완료");
  }
```
→
```ts
    const nextJobValue = formatKimJobValue(customerType, customerTypeDetail);
    const prevJob = statusValues.job;
    setStatusValues((current) => ({ ...current, job: nextJobValue }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("직군 수정 완료");
    savePatch({ customerType, customerTypeDetail }, () => setStatusValues((current) => ({ ...current, job: prevJob })));
  }
```

- [ ] **Step 5: saveLocationField wiring**

```ts
    setStatusValues((current) => ({ ...current, location: formatKimLocationValue(province, detail) }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("거주지 수정 완료");
  }
```
→
```ts
    const nextLocation = formatKimLocationValue(province, detail);
    const prevLocation = statusValues.location;
    setStatusValues((current) => ({ ...current, location: nextLocation }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("거주지 수정 완료");
    savePatch({ residence: nextLocation }, () => setStatusValues((current) => ({ ...current, location: prevLocation })));
  }
```

- [ ] **Step 6: saveSourceField wiring**

```ts
    if (!nextSource) return;
    setStatusValues((current) => ({ ...current, source: nextSource }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("상담경로 수정 완료");
  }
```
→
```ts
    if (!nextSource) return;
    const prevSource = statusValues.source;
    setStatusValues((current) => ({ ...current, source: nextSource }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("상담경로 수정 완료");
    savePatch({ source: nextSource }, () => setStatusValues((current) => ({ ...current, source: prevSource })));
  }
```

- [ ] **Step 7: saveNeeds wiring**

```ts
    setNeeds({
      model: String(formData.get("model") ?? "").trim() || needs.model,
      trim: String(formData.get("trim") ?? "").trim() || needs.trim,
      colors: String(formData.get("colors") ?? "").trim() || needs.colors,
      method: String(formData.get("method") ?? "").trim() || needs.method,
      memo: String(formData.get("memo") ?? "").trim() || needs.memo,
    });
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("고객 니즈 수정 완료");
  }
```
→
```ts
    const prevNeeds = needs;
    const nextNeeds = {
      model: String(formData.get("model") ?? "").trim() || needs.model,
      trim: String(formData.get("trim") ?? "").trim() || needs.trim,
      colors: String(formData.get("colors") ?? "").trim() || needs.colors,
      method: String(formData.get("method") ?? "").trim() || needs.method,
      memo: String(formData.get("memo") ?? "").trim() || needs.memo,
    };
    setNeeds(nextNeeds);
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("고객 니즈 수정 완료");
    savePatch(
      { needModel: nextNeeds.model, needTrim: nextNeeds.trim, needColors: nextNeeds.colors, needMethod: nextNeeds.method, needMemo: nextNeeds.memo },
      () => setNeeds(prevNeeds),
    );
  }
```

- [ ] **Step 8: togglePurchaseMethod(구매방식→needMethod) wiring**

```ts
    const nextValue = orderedMethods.length > 0 ? orderedMethods.join(" · ") : "확인 필요";
    setPurchaseFields((current) => current.map((field) => (
      field.label === "구매방식" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("구매방식 수정 완료");
  }
```
→
```ts
    const nextValue = orderedMethods.length > 0 ? orderedMethods.join(" · ") : "확인 필요";
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "구매방식" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("구매방식 수정 완료");
    savePatch({ needMethod: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }
```

- [ ] **Step 9: selectPurchaseTiming(출고시기→needTiming) wiring**

```ts
    const nextValue = currentTimingField?.value === option ? "확인 필요" : option;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "출고 희망 시기" ? { ...field, value: nextValue } : field
    )));
    setShowTimingMonths(false);
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("출고 희망 시기 수정 완료");
  }
```
→
```ts
    const nextValue = currentTimingField?.value === option ? "확인 필요" : option;
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "출고 희망 시기" ? { ...field, value: nextValue } : field
    )));
    setShowTimingMonths(false);
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("출고 희망 시기 수정 완료");
    savePatch({ needTiming: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }
```

- [ ] **Step 10: selectPurchaseTimingMonth(출고시기 특정월→needTiming) wiring**

```ts
    const nextValue = currentTimingField?.value === monthValue ? "확인 필요" : monthValue;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "출고 희망 시기" ? { ...field, value: nextValue } : field
    )));
    setShowTimingMonths(false);
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("출고 희망 시기 수정 완료");
  }
```
→
```ts
    const nextValue = currentTimingField?.value === monthValue ? "확인 필요" : monthValue;
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "출고 희망 시기" ? { ...field, value: nextValue } : field
    )));
    setShowTimingMonths(false);
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("출고 희망 시기 수정 완료");
    savePatch({ needTiming: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }
```

- [ ] **Step 11: typecheck + lint + build**

Run: `bun run typecheck && bun run lint && bun run build`
Expected: 0 / 0 / OK.

- [ ] **Step 12: 커밋**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 김민준 상세 본체 필드 저장 wiring(savePatch — 상태/니즈/구매방식·출고시기)"
```

---

## Task 5: 통합 검증

**Files:** 없음

- [ ] **Step 1: 전체 스위트**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run build`
Expected: typecheck 0 · lint 0 · test:unit 전부 통과(customers chance 1 추가) · build OK.

Run: `bun test --env-file=.env.local`
Expected: test:server 전부 통과(customers PATCH 5 추가).

- [ ] **Step 2: 수동 확인(로그인 세션)**

`bun run dev`(또는 배포본) 로그인 후 김민준 상세에서:
1. 연락처/거주지/상담경로/직군 수정 → 새로고침 → 유지.
2. 니즈(차종/트림/컬러/구매방식/메모) 수정 → 새로고침 → 유지.
3. 구매조건의 구매방식·출고희망시기 수정 → 새로고침 → 유지. (계약기간 등 나머지는 새로고침 시 원복 — 캐비엇, 정상)
4. 진행상태/계약가능성 변경(상세·목록 양쪽) → 새로고침 → 유지. 계약완료로 바꾸면 계약가능성 자동 확정 유지.
5. (선택) 네트워크 끊고 수정 → 롤백 + "저장에 실패했습니다" 토스트.

- [ ] **Step 3: brief 갱신 + 커밋**

`ref/active-session-brief.md` Current Focus/완료/Next를 "고객 쓰기 #1(본체 필드) 완료, 다음=자식 CRUD(#2)"로 갱신. (커밋 메시지에 skip-ci 마커 금지 — [[skip-ci-squash-propagation]].)

```bash
git add ref/active-session-brief.md
git commit -m "docs: active-session-brief 갱신 — 고객 쓰기 #1(본체 필드) 완료"
```

---

## Self-Review 메모

- **스펙 커버리지**: PATCH 엔드포인트+writeSchema(T1) · lib updateCustomer+chance읽기(T2) · 워크플로우 persist+chance시드+롤백(T3) · 상태/니즈/구매방식·출고시기 wiring(T4). 제외(메모/할일/일정·서류·견적·advisor·관리상태·비컬럼 구매조건)는 손대지 않음. ✅
- **플레이스홀더 스캔**: 모든 단계 실제 코드/명령. ✅
- **타입 일관성**: 백 `CustomerWritePatch`(Pick from $inferInsert) ↔ 프론트 `CustomerWritePatch`(동일 14필드) ↔ `customerWriteSchema`(동일 14필드) 일치. `updateCustomer`(query: id,patch,executor→{id}|null / lib: id,patch→void) 명칭 동일. `Customer.chance`/`CustomerRow.chance`/seed/PATCH 흐름 일관. ✅
- **알려진 가정/캐비엇**: 비컬럼 구매조건(계약기간 등)은 편집되나 미저장(새로고침 원복). `needMethod`는 니즈·구매방식 공용(새로고침 후 일치). 낙관 성공 토스트가 먼저 뜨고 실패 시 롤백 토스트가 뒤따름(2토스트 가능). PATCH 200 서버테스트는 같은 값(비파괴). 목록 행은 항상 `id` 보유(딥링크 #53 전제).
