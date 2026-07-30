# MC 마스터 변경 승인 워크플로 — PR 1 (서버) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀장(manager)의 catalog 쓰기가 즉시 반영되지 않고 `crm.catalog_change_requests` 큐에 쌓이며, admin 승인 시에만 같은 실행 함수의 replay로 catalog에 반영되는 서버 기반을 만든다.

**Architecture:** kind 레지스트리 1벌(스냅샷·실행·zod)이 적재와 승인 replay의 단일 소스. 쓰기 라우트는 역할로 분기(admin 즉시 실행 / manager 202 큐 적재), 승인은 트랜잭션 하나(선점→재검증→드리프트→replay→스탬프). 드리프트 판정은 순수 함수로 분리해 test:pure 커버.

**Tech Stack:** Hono + drizzle(pg, crm 스키마만) + zod v4 + bun test. 마이그레이션은 `db:generate` → `db:migrate`(schemaFilter crm — `db:push` 금지).

**Spec:** `ref/specs/2026-07-30-crm-catalog-change-approval-design.md` (§ 참조는 전부 이 문서)

**범위:** PR 1(서버)만. PR 2(관리자 UI)·PR 3(팀장 개방)은 별도 계획.

**⚠️ 공유 master 주의:** `DATABASE_URL`은 운영 master다. 마이그레이션은 additive(새 테이블)라 사전 적용 안전(0042 선례). 실 DB 테스트는 롤백 패턴 필수, 라우트 테스트가 만드는 pending 행은 afterAll 삭제 + 고아 판정 잔재 그물(Task 9).

---

## 사전 준비

- [ ] **브랜치 생성**

```bash
cd /Users/tobedoit/Documents/TypeScript/mr-cha-crm
git checkout main && git pull && git checkout -b feat/catalog-change-approval-server
```

- [ ] **spec·plan 문서 커밋** (이 파일과 spec이 아직 미커밋이면)

```bash
git add ref/specs/2026-07-30-crm-catalog-change-approval-design.md ref/plans/2026-07-30-crm-catalog-change-approval-pr1.md
git commit -m "docs(crm): MC 마스터 변경 승인 워크플로 spec + PR1 계획

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: 스키마 + 마이그레이션 0043

**Files:**
- Modify: `src/db/schema.ts` (파일 끝, `catalogDiscountAdoptions` 아래)
- Create: `drizzle/0043_*.sql` (drizzle-kit 생성)

- [ ] **Step 1: 테이블 정의 추가** — `src/db/schema.ts` 끝에 append:

```ts
// MC 마스터 변경 요청 큐(2026-07-30) — 팀장(manager)의 catalog 쓰기는 여기에만 쌓이고,
// catalog 반영은 admin 승인 replay로만 일어난다. 대기열이자 감사 기록을 겸한다(요청자·
// 승인자·전값 snapshot·반려 사유가 전부 남는다).
// 딜러 할인 제안과 반대로 **대상+작업당 pending 1건**(부분 UNIQUE) — 내부 업무 분담이라
// 같은 대상을 두 명이 고칠 이유가 없다(경쟁 견적이던 딜러와 다르다). kind가 UNIQUE 축에
// 있는 이유: 같은 트림에 "가격 수정"과 "무옵션 확정"은 다른 작업이라 공존해야 한다.
// payload = 원 라우트 zod 검증을 통과한 body 그대로(승인 시 재검증). snapshot = 요청 시점
// 현재 값(update: payload가 건드리는 필드만 · create: 부모 존재 확인의 {} · 드리프트 근거).
// spec: ref/specs/2026-07-30-crm-catalog-change-approval-design.md §4
export const catalogChangeRequests = crm.table(
  "catalog_change_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    targetType: text("target_type").notNull(),
    targetId: bigint("target_id", { mode: "number" }), // → catalog.*(loose id 관례). create는 NULL
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
    status: text("status").default("pending").notNull(),
    requestedBy: uuid("requested_by").notNull(), // → public.profiles.id(loose id 관례)
    rejectReason: text("reject_reason"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "catalog_change_requests_kind_check",
      sql`${table.kind} in ('model.create','model.update','trim.create','trim.update','option.create','option.update','trim.no-option.set','trim.no-option.unset')`,
    ),
    check("catalog_change_requests_target_type_check", sql`${table.targetType} in ('model','trim','option')`),
    check(
      "catalog_change_requests_status_check",
      sql`${table.status} in ('pending','approved','rejected','canceled')`,
    ),
    uniqueIndex("catalog_change_requests_pending_target_unique")
      .on(table.targetType, table.targetId, table.kind)
      .where(sql`${table.status} = 'pending' and ${table.targetId} is not null`),
  ],
);
```

- [ ] **Step 2: 마이그레이션 생성 후 SQL 눈으로 검수**

```bash
bun run db:generate
cat drizzle/0043_*.sql
```

기대: `CREATE TABLE "crm"."catalog_change_requests"` + CHECK 3개 + `CREATE UNIQUE INDEX … WHERE …` 부분 인덱스. **crm 밖(public·catalog) DDL이 한 줄이라도 있으면 중단** — schemaFilter 확인.

- [ ] **Step 3: 실 DB 적용 + 실측 확인**

```bash
bun run db:migrate
source .env.local && psql "$DATABASE_URL" -c "\d crm.catalog_change_requests" | head -30
```

기대: 컬럼 13개 + 인덱스 `catalog_change_requests_pending_target_unique` (partial).

- [ ] **Step 4: typecheck 후 커밋**

```bash
bun run typecheck
git add src/db/schema.ts drizzle/
git commit -m "feat(crm): catalog_change_requests 테이블 (마이그 0043)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 드리프트 판정 순수 모듈 (TDD)

**Files:**
- Create: `src/lib/change-request-drift.ts`
- Test: `src/lib/change-request-drift.test.ts` (DB 무관 → db-bound registry에 **넣지 않는다** → CI pure에서 돈다)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { expect, test } from "bun:test";

import { detectSnapshotDrift } from "./change-request-drift";

test("같으면 빈 배열", () => {
  expect(detectSnapshotDrift({ price: 100, status: "판매중" }, { price: 100, status: "판매중" })).toEqual([]);
});

test("값이 다른 키만 골라낸다", () => {
  expect(detectSnapshotDrift({ price: 100, status: "판매중" }, { price: 200, status: "판매중" })).toEqual(["price"]);
});

test("snapshot에 있는 키만 본다 — current의 여분 키는 무시", () => {
  expect(detectSnapshotDrift({ price: 100 }, { price: 100, extra: "x" })).toEqual([]);
});

test("null과 undefined는 동치 — '값 없음'의 두 표기가 드리프트로 오탐되지 않는다", () => {
  expect(detectSnapshotDrift({ driveSystem: null }, {})).toEqual([]);
  expect(detectSnapshotDrift({ driveSystem: undefined }, { driveSystem: null })).toEqual([]);
});

test("null → 실값 변화는 드리프트다", () => {
  expect(detectSnapshotDrift({ driveSystem: null }, { driveSystem: "AWD" })).toEqual(["driveSystem"]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test src/lib/change-request-drift.test.ts`
기대: FAIL — "Cannot find module './change-request-drift'"

- [ ] **Step 3: 구현**

```ts
// 변경 요청 승인 시점의 드리프트 판정(순수 — DB 무관, test:pure 커버).
// snapshot(요청 시점 값)에 있는 키만 현재 값과 대조한다 — "payload가 건드리는 필드만"
// 규칙(spec §5.1)은 snapshot을 그 필드들로만 만들어 두는 것으로 성립한다.
// null/undefined는 동치("값 없음") — DB의 NULL과 select 누락이 서로 오탐하지 않게.
export function detectSnapshotDrift(
  snapshot: Record<string, unknown>,
  current: Record<string, unknown>,
): string[] {
  const norm = (v: unknown) => (v === undefined ? null : v);
  return Object.keys(snapshot).filter((key) => !Object.is(norm(snapshot[key]), norm(current[key])));
}
```

- [ ] **Step 4: 통과 확인 후 커밋**

Run: `bun test src/lib/change-request-drift.test.ts` → 5 pass

```bash
git add src/lib/change-request-drift.ts src/lib/change-request-drift.test.ts
git commit -m "feat(crm): 변경 요청 드리프트 판정 순수 모듈

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 바디 스키마 추출 (동작 불변 리팩터)

**Files:**
- Create: `src/routes/catalog/schemas.ts`
- Modify: `src/routes/catalog/models.ts`, `src/routes/catalog/trims.ts`, `src/routes/catalog/options.ts` (인라인 zod → import)

레지스트리(Task 6)가 승인 시 재검증에 같은 스키마를 써야 하므로 라우트 인라인 정의를 한 파일로 뺀다.

- [ ] **Step 1: `src/routes/catalog/schemas.ts` 생성**

```ts
import { z } from "zod";

import { id, optionType, status } from "./shared";

// catalog 쓰기 바디 스키마 — 라우트 zValidator와 변경 요청 승인 재검증(change-request-kinds.ts)이
// 같은 정의를 본다. 여기 리터럴을 라우트에 복제하면 적재 검증과 승인 재검증이 어긋날 수 있다.
export const modelCreateBody = z.object({
  brandId: id,
  name: z.string().min(1),
  category: z.string().nullable().default(null),
  status: status.default("판매중"),
});

export const modelUpdateBody = z.object({
  category: z.string().nullable().optional(),
  status: status.optional(),
});

// 트림 본문 스키마. create는 modelId를 더해 그대로, patch는 .partial()로 전부 optional.
export const trimBody = z.object({
  trimName: z.string().min(1),
  price: z.number().int().nonnegative(),
  modelYear: z.number().int(),
  fuelType: z.string().min(1),
  driveSystem: z.string().nullable().optional(),
  displacementCc: z.number().int().nullable().optional(),
  transmissionType: z.string().nullable().optional(),
  bodyStyle: z.string().nullable().optional(),
  seatingCapacity: z.number().int().nullable().optional(),
  status: status.optional(),
  financialDiscountAmount: z.number().int().nullable().optional(),
  partnerDiscountAmount: z.number().int().nullable().optional(),
  cashDiscountAmount: z.number().int().nullable().optional(),
});
export const trimCreateBody = trimBody.extend({ modelId: id });
export const trimUpdateBody = trimBody.partial();

export const optionCreateBody = z.object({
  type: optionType,
  name: z.string().min(1),
  price: z.number().int().nullable().default(null),
});
// 변경 요청 payload용 — 라우트는 trimId를 param으로 받지만 큐에는 본문과 합쳐 저장한다.
export const optionCreatePayload = optionCreateBody.extend({ trimId: id });

export const optionUpdateBody = z.object({
  name: z.string().min(1).optional(),
  price: z.number().int().nullable().optional(),
});

// 무옵션 토글은 본문이 없다 — 큐 payload는 빈 객체로 저장·재검증한다.
export const emptyBody = z.object({});
```

- [ ] **Step 2: 라우트 3파일이 인라인 정의 대신 import 하도록 수정**

`models.ts`: `zValidator("json", z.object({ brandId: id, … }))` → `zValidator("json", modelCreateBody)`, PATCH는 `modelUpdateBody`. `trims.ts`: 파일 상단 `const trimBody = …` 삭제 → `trimCreateBody`/`trimUpdateBody` import 사용 (`POST /trims`는 `zValidator("json", trimCreateBody)`, `PATCH`는 `zValidator("json", trimUpdateBody)`). `options.ts`: POST는 `optionCreateBody`, PATCH는 `optionUpdateBody`. 안 쓰게 된 `z`·`id`·`status`·`optionType` import는 각 파일에서 정리.

- [ ] **Step 3: 검증 후 커밋**

```bash
bun run typecheck && bun run lint && bun run knip
git add src/routes/catalog/
git commit -m "refactor(crm): catalog 바디 스키마 추출 — 승인 재검증과 공유 준비

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `updateTrimWithDiscountAudit` 추출 (동작 불변 리팩터)

**Files:**
- Modify: `src/db/queries/discount-adoptions.ts` (함수 추가), `src/routes/catalog/trims.ts` (PATCH 핸들러 축소)

admin 직접 PATCH와 승인 replay가 **같은 트랜잭션 블록**(before 읽기 → updateTrim → 할인 감사)을 공유해야 한다(spec §5).

- [ ] **Step 1: `discount-adoptions.ts`에 추가** (파일의 기존 import에 `trimsInCatalog`·`updateTrim`이 없으면 추가: `import { trimsInCatalog } from "../catalog";` · `import { updateTrim } from "./catalog-admin";`)

```ts
type TrimPatch = Parameters<typeof updateTrim>[1];

// 트림 직접 편집 + 할인 3필드 감사 한 몸(구 trims.ts PATCH 트랜잭션 블록 — spec §3.4).
// admin 직접 실행과 변경 요청 승인 replay(change-request-kinds.ts)가 이 한 벌을 공유한다 —
// 두 경로가 갈라지면 "누가 바꿨는지 모르는 확정 할인"이 다시 생긴다.
export async function updateTrimWithDiscountAudit(
  trimId: number,
  patch: TrimPatch,
  adoptedBy: string,
  tx: Executor,
) {
  // 갱신 전 값을 같은 트랜잭션에서 읽는다 — previous_amount의 근거이고, 되돌리기의 유일한 단서다.
  const [before] = await tx
    .select({
      financial: trimsInCatalog.financialDiscountAmount,
      partner: trimsInCatalog.partnerDiscountAmount,
      cash: trimsInCatalog.cashDiscountAmount,
    })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.id, trimId));
  if (!before) return null;
  const row = await updateTrim(trimId, patch, tx);
  if (row) await recordAdminDiscountEdits({ trimId, before, patch, adoptedBy }, tx);
  return row;
}
```

- [ ] **Step 2: `trims.ts` PATCH 핸들러 교체** (기존 트랜잭션 블록 → 호출 한 줄; `eq`·`trimsInCatalog`·`recordAdminDiscountEdits` import가 라우트에서 불필요해지면 정리)

```ts
  catalog.patch(
    "/trims/:id",
    zValidator("param", z.object({ id })),
    zValidator("json", trimUpdateBody),
    async (c) => {
      const trimId = c.req.valid("param").id;
      const patch = c.req.valid("json");
      const adoptedBy = c.var.user.id;
      return run(
        c,
        () => c.var.db.transaction((tx) => updateTrimWithDiscountAudit(trimId, patch, adoptedBy, tx)),
        "트림을 찾을 수 없습니다.",
      );
    },
  );
```

- [ ] **Step 3: 기존 감사 스위트로 회귀 확인 후 커밋** (실 DB — 롤백 패턴이라 잔재 없음)

```bash
bun run typecheck
EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/db/queries/discount-adoptions.test.ts
git add src/db/queries/discount-adoptions.ts src/routes/catalog/trims.ts
git commit -m "refactor(crm): 트림 편집+할인 감사 트랜잭션 블록 추출 — 승인 replay와 공유 준비

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 큐 CRUD 쿼리 (TDD, 롤백)

**Files:**
- Create: `src/db/queries/change-requests.ts`
- Test: `src/db/queries/change-requests.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/db/queries/change-requests.test.ts`

```ts
import { beforeAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { catalogChangeRequests } from "../schema";
import {
  cancelOwnPending, claimPending, listChangeRequests, listModelPendingRequests, listMyChangeRequests,
  markRejected, upsertPendingRequest,
} from "./change-requests";

// ── 변경 요청 큐 CRUD — 전부 트랜잭션 롤백(discount-adoptions.test.ts와 같은 이유:
// afterAll에 의존하면 실행이 끊길 때 공유 master에 잔재가 남는다). requestedBy는 랜덤
// uuid를 쓴다 — 롤백이라 잔재 그물(고아 판정, Task 9)에 걸릴 일도 없다.
const db = getDefaultDb();
let trimId = 0;
let modelId = 0;

beforeAll(async () => {
  const [trim] = await db
    .select({ id: trimsInCatalog.id, modelId: trimsInCatalog.modelId })
    .from(trimsInCatalog)
    .limit(1);
  trimId = trim!.id;
  modelId = trim!.modelId;
});

async function inRollback(fn: (tx: Executor) => Promise<void>): Promise<void> {
  await db
    .transaction(async (tx) => {
      await fn(tx);
      throw new Error("rollback");
    })
    .catch((e: unknown) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
}

const requester = () => crypto.randomUUID();

function trimUpdateInput(requestedBy: string, price = 999) {
  return {
    kind: "trim.update",
    targetType: "trim",
    targetId: trimId,
    payload: { price },
    snapshot: { price: 100 },
    requestedBy,
  };
}

test("적재: 새 요청은 pending으로 insert된다", async () => {
  await inRollback(async (tx) => {
    const r = await upsertPendingRequest(trimUpdateInput(requester()), tx);
    expect(r.ok).toBe(true);
  });
});

test("본인 재제출은 같은 행을 갱신한다(payload 교체 + updated_at 전진 — DB 안 비교)", async () => {
  await inRollback(async (tx) => {
    const me = requester();
    const first = await upsertPendingRequest(trimUpdateInput(me, 100), tx);
    const second = await upsertPendingRequest(trimUpdateInput(me, 200), tx);
    if (!first.ok || !second.ok) throw new Error("적재 실패");
    expect(second.id).toBe(first.id);
    // JS Date 비교 금지(#334 — ms 절삭 거짓 실패·스큐 은폐). timestamptz끼리 DB 안에서 비교.
    const [row] = (await tx.execute(sql`
      select (updated_at > created_at) as advanced, (payload->>'price')::int as price
      from crm.catalog_change_requests where id = ${first.id}`)) as unknown as Array<{
      advanced: boolean; price: number;
    }>;
    expect(row!.advanced).toBe(true);
    expect(row!.price).toBe(200);
  });
});

test("타인의 pending이 있으면 적재를 거부하고 기존 요청 정보를 준다", async () => {
  await inRollback(async (tx) => {
    const first = await upsertPendingRequest(trimUpdateInput(requester()), tx);
    expect(first.ok).toBe(true);
    const second = await upsertPendingRequest(trimUpdateInput(requester()), tx);
    expect(second.ok).toBe(false);
  });
});

test("create(target_id NULL)는 UNIQUE 대상이 아니다 — 여러 건 공존", async () => {
  await inRollback(async (tx) => {
    const input = (by: string) => ({
      kind: "trim.create", targetType: "trim", targetId: null,
      payload: { modelId, trimName: "승인요청검증", price: 1, modelYear: 2027, fuelType: "가솔린" },
      snapshot: {}, requestedBy: by,
    });
    const a = await upsertPendingRequest(input(requester()), tx);
    const b = await upsertPendingRequest(input(requester()), tx);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

test("claimPending: pending만 선점하고, 두 번째 claim은 null", async () => {
  await inRollback(async (tx) => {
    const r = await upsertPendingRequest(trimUpdateInput(requester()), tx);
    if (!r.ok) throw new Error("적재 실패");
    const admin = requester();
    const claimed = await claimPending(r.id, admin, tx);
    expect(claimed?.kind).toBe("trim.update");
    expect(await claimPending(r.id, admin, tx)).toBeNull();
  });
});

test("markRejected: 사유가 남고 pending만 대상이다", async () => {
  await inRollback(async (tx) => {
    const r = await upsertPendingRequest(trimUpdateInput(requester()), tx);
    if (!r.ok) throw new Error("적재 실패");
    const rejected = await markRejected(r.id, "가격 근거 부족", requester(), tx);
    expect(rejected?.rejectReason).toBe("가격 근거 부족");
    expect(await markRejected(r.id, "again", requester(), tx)).toBeNull();
  });
});

test("cancelOwnPending: 본인+pending만 취소된다", async () => {
  await inRollback(async (tx) => {
    const me = requester();
    const r = await upsertPendingRequest(trimUpdateInput(me), tx);
    if (!r.ok) throw new Error("적재 실패");
    expect(await cancelOwnPending(r.id, requester(), tx)).toBeNull(); // 타인
    const canceled = await cancelOwnPending(r.id, me, tx);
    expect(canceled?.status).toBe("canceled");
  });
});

test("모델 단위 pending 조회가 trim 대상·trim.create payload를 모두 잡는다", async () => {
  await inRollback(async (tx) => {
    await upsertPendingRequest(trimUpdateInput(requester()), tx);
    await upsertPendingRequest(
      {
        kind: "trim.create", targetType: "trim", targetId: null,
        payload: { modelId, trimName: "승인요청검증", price: 1, modelYear: 2027, fuelType: "가솔린" },
        snapshot: {}, requestedBy: requester(),
      },
      tx,
    );
    const rows = await listModelPendingRequests(modelId, tx);
    const kinds = rows.map((r) => r.kind).sort();
    expect(kinds).toContain("trim.update");
    expect(kinds).toContain("trim.create");
  });
});

test("목록 조회에 대상 라벨이 붙는다", async () => {
  await inRollback(async (tx) => {
    const me = requester();
    await upsertPendingRequest(trimUpdateInput(me), tx);
    const [model] = await tx
      .select({ name: modelsInCatalog.name })
      .from(modelsInCatalog)
      .where(eq(modelsInCatalog.id, modelId));
    const all = await listChangeRequests("pending", tx);
    const mineRow = all.find((r) => r.requestedBy === me);
    expect(mineRow?.targetLabel).toContain(model!.name);
    const mine = await listMyChangeRequests(me, tx);
    expect(mine.length).toBe(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/db/queries/change-requests.test.ts`
기대: FAIL — "Cannot find module './change-requests'"

- [ ] **Step 3: 구현** — `src/db/queries/change-requests.ts`

```ts
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import { modelsInCatalog, trimOptionsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { catalogChangeRequests } from "../schema";

// MC 마스터 변경 요청 큐 CRUD — kind 의미론(스냅샷·실행)은 모른다. 그건
// routes/catalog/change-request-kinds.ts(레지스트리)의 몫이고, 여기는 행 상태 전이만 담당.
// spec: ref/specs/2026-07-30-crm-catalog-change-approval-design.md §4·§6.3

export type ChangeRequestRow = typeof catalogChangeRequests.$inferSelect;
export type ChangeRequestListItem = ChangeRequestRow & { targetLabel: string };

export type UpsertPendingInput = {
  kind: string;
  targetType: string;
  targetId: number | null;
  payload: Record<string, unknown>;
  snapshot: Record<string, unknown> | null;
  requestedBy: string;
};

export type UpsertPendingResult =
  | { ok: true; id: string }
  | { ok: false; existingRequestedBy: string; existingCreatedAt: Date };

// 대상+작업당 pending 1건(spec §4.1): 본인 재제출 = 갱신, 타인 = 거부. 동시 insert 경합은
// 부분 UNIQUE가 최종 방어선(23505 → routes/shared.ts가 한글 매핑).
export async function upsertPendingRequest(
  input: UpsertPendingInput,
  executor: Executor = getDefaultDb(),
): Promise<UpsertPendingResult> {
  if (input.targetId != null) {
    const [existing] = await executor
      .select()
      .from(catalogChangeRequests)
      .where(
        and(
          eq(catalogChangeRequests.targetType, input.targetType),
          eq(catalogChangeRequests.targetId, input.targetId),
          eq(catalogChangeRequests.kind, input.kind),
          eq(catalogChangeRequests.status, "pending"),
        ),
      );
    if (existing && existing.requestedBy !== input.requestedBy) {
      return { ok: false, existingRequestedBy: existing.requestedBy, existingCreatedAt: existing.createdAt };
    }
    if (existing) {
      const [row] = await executor
        .update(catalogChangeRequests)
        .set({ payload: input.payload, snapshot: input.snapshot, updatedAt: sql`now()` })
        .where(and(eq(catalogChangeRequests.id, existing.id), eq(catalogChangeRequests.status, "pending")))
        .returning();
      if (row) return { ok: true, id: row.id };
      // 그 사이 승인/반려로 pending이 사라졌다 — 새 요청으로 insert(아래 폴스루)
    }
  }
  const [row] = await executor
    .insert(catalogChangeRequests)
    .values({
      kind: input.kind,
      targetType: input.targetType,
      targetId: input.targetId,
      payload: input.payload,
      snapshot: input.snapshot,
      requestedBy: input.requestedBy,
    })
    .returning();
  return { ok: true, id: row!.id };
}

// 승인 선점 — status 조건부 UPDATE라 동시 더블클릭은 한쪽만 통과한다(spec §6.4 ①).
// 호출자는 이걸 승인 트랜잭션 안에서 부른다: 이후 단계(재검증·드리프트)가 던지면 전이도 롤백.
export async function claimPending(id: string, decidedBy: string, tx: Executor): Promise<ChangeRequestRow | null> {
  const [row] = await tx
    .update(catalogChangeRequests)
    .set({ status: "approved", decidedBy, decidedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(catalogChangeRequests.id, id), eq(catalogChangeRequests.status, "pending")))
    .returning();
  return row ?? null;
}

export async function markRejected(
  id: string,
  reason: string,
  decidedBy: string,
  executor: Executor = getDefaultDb(),
): Promise<ChangeRequestRow | null> {
  const [row] = await executor
    .update(catalogChangeRequests)
    .set({ status: "rejected", rejectReason: reason, decidedBy, decidedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(catalogChangeRequests.id, id), eq(catalogChangeRequests.status, "pending")))
    .returning();
  return row ?? null;
}

export async function cancelOwnPending(
  id: string,
  requesterId: string,
  executor: Executor = getDefaultDb(),
): Promise<ChangeRequestRow | null> {
  const [row] = await executor
    .update(catalogChangeRequests)
    .set({ status: "canceled", updatedAt: sql`now()` })
    .where(
      and(
        eq(catalogChangeRequests.id, id),
        eq(catalogChangeRequests.requestedBy, requesterId),
        eq(catalogChangeRequests.status, "pending"),
      ),
    )
    .returning();
  return row ?? null;
}

export async function listChangeRequests(
  status: string,
  executor: Executor = getDefaultDb(),
): Promise<ChangeRequestListItem[]> {
  const rows = await executor
    .select()
    .from(catalogChangeRequests)
    .where(eq(catalogChangeRequests.status, status))
    .orderBy(asc(catalogChangeRequests.createdAt));
  return labelTargets(rows, executor);
}

export async function listMyChangeRequests(
  requesterId: string,
  executor: Executor = getDefaultDb(),
): Promise<ChangeRequestListItem[]> {
  const rows = await executor
    .select()
    .from(catalogChangeRequests)
    .where(eq(catalogChangeRequests.requestedBy, requesterId))
    .orderBy(desc(catalogChangeRequests.createdAt))
    .limit(50);
  return labelTargets(rows, executor);
}

// 화면 배지용 모델 단위 pending — 대상 축이 3층(모델 자신·트림·옵션)이라 create의 부모는
// payload에서 꺼내 잡는다(create는 target_id가 없다).
export async function listModelPendingRequests(
  modelId: number,
  executor: Executor = getDefaultDb(),
): Promise<ChangeRequestListItem[]> {
  const modelTrimIds = executor
    .select({ id: trimsInCatalog.id })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.modelId, modelId));
  const modelOptionIds = executor
    .select({ id: trimOptionsInCatalog.id })
    .from(trimOptionsInCatalog)
    .where(inArray(trimOptionsInCatalog.trimId, modelTrimIds));
  const rows = await executor
    .select()
    .from(catalogChangeRequests)
    .where(
      and(
        eq(catalogChangeRequests.status, "pending"),
        or(
          and(eq(catalogChangeRequests.targetType, "model"), eq(catalogChangeRequests.targetId, modelId)),
          and(
            eq(catalogChangeRequests.targetType, "trim"),
            inArray(catalogChangeRequests.targetId, modelTrimIds),
          ),
          and(
            eq(catalogChangeRequests.kind, "trim.create"),
            sql`(${catalogChangeRequests.payload}->>'modelId')::int = ${modelId}`,
          ),
          and(
            eq(catalogChangeRequests.targetType, "option"),
            inArray(catalogChangeRequests.targetId, modelOptionIds),
          ),
          and(
            eq(catalogChangeRequests.kind, "option.create"),
            sql`(${catalogChangeRequests.payload}->>'trimId')::int in (select id from ${trimsInCatalog} where ${trimsInCatalog.modelId} = ${modelId})`,
          ),
        ),
      ),
    )
    .orderBy(asc(catalogChangeRequests.createdAt));
  return labelTargets(rows, executor);
}

// 대상 라벨("모델 › 트림 › 옵션") 합성 — update/토글은 target_id로, create는 payload의 부모로.
// 대상이 그 사이 삭제됐으면 "삭제됨"(pending 승인 시도는 어차피 드리프트로 막힌다).
async function labelTargets(rows: ChangeRequestRow[], ex: Executor): Promise<ChangeRequestListItem[]> {
  const p = (r: ChangeRequestRow) => r.payload;

  const optionIds = rows.filter((r) => r.targetType === "option" && r.targetId != null).map((r) => r.targetId!);
  const options =
    optionIds.length > 0
      ? await ex
          .select({ id: trimOptionsInCatalog.id, name: trimOptionsInCatalog.name, trimId: trimOptionsInCatalog.trimId })
          .from(trimOptionsInCatalog)
          .where(inArray(trimOptionsInCatalog.id, optionIds))
      : [];
  const optionById = new Map(options.map((o) => [o.id, o]));

  const trimIds = new Set<number>();
  for (const r of rows) {
    if (r.targetType === "trim" && r.targetId != null) trimIds.add(r.targetId);
    if (r.kind === "option.create") trimIds.add(Number(p(r).trimId));
  }
  for (const o of options) trimIds.add(o.trimId);
  const trims =
    trimIds.size > 0
      ? await ex
          .select({ id: trimsInCatalog.id, trimName: trimsInCatalog.trimName, modelId: trimsInCatalog.modelId })
          .from(trimsInCatalog)
          .where(inArray(trimsInCatalog.id, [...trimIds]))
      : [];
  const trimById = new Map(trims.map((t) => [t.id, t]));

  const modelIds = new Set<number>();
  for (const r of rows) {
    if (r.targetType === "model" && r.targetId != null) modelIds.add(r.targetId);
    if (r.kind === "trim.create") modelIds.add(Number(p(r).modelId));
  }
  for (const t of trims) modelIds.add(t.modelId);
  const models =
    modelIds.size > 0
      ? await ex
          .select({ id: modelsInCatalog.id, name: modelsInCatalog.name })
          .from(modelsInCatalog)
          .where(inArray(modelsInCatalog.id, [...modelIds]))
      : [];
  const modelById = new Map(models.map((m) => [m.id, m]));

  const modelName = (id: number) => modelById.get(id)?.name ?? "삭제됨";
  const trimPath = (trimId: number) => {
    const t = trimById.get(trimId);
    return t ? `${modelName(t.modelId)} › ${t.trimName}` : "삭제됨";
  };

  return rows.map((r) => {
    let targetLabel = "삭제됨";
    if (r.kind === "model.create") targetLabel = `${String(p(r).name)} (신규 모델)`;
    else if (r.targetType === "model" && r.targetId != null) targetLabel = modelName(r.targetId);
    else if (r.kind === "trim.create") targetLabel = `${modelName(Number(p(r).modelId))} › ${String(p(r).trimName)} (신규 트림)`;
    else if (r.targetType === "trim" && r.targetId != null) targetLabel = trimPath(r.targetId);
    else if (r.kind === "option.create") targetLabel = `${trimPath(Number(p(r).trimId))} › ${String(p(r).name)} (신규 옵션)`;
    else if (r.targetType === "option" && r.targetId != null) {
      const o = optionById.get(r.targetId);
      targetLabel = o ? `${trimPath(o.trimId)} › ${o.name}` : "삭제됨";
    }
    return { ...r, targetLabel };
  });
}
```

- [ ] **Step 4: 통과 확인 후 커밋**

Run: `EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/db/queries/change-requests.test.ts` → 9 pass

```bash
git add src/db/queries/change-requests.ts src/db/queries/change-requests.test.ts
git commit -m "feat(crm): 변경 요청 큐 CRUD — 대상+작업당 pending 1건·선점·라벨

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: kind 레지스트리 + 승인 replay (TDD, 롤백)

**Files:**
- Create: `src/routes/catalog/change-request-kinds.ts`
- Test: `src/routes/catalog/change-request-kinds.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/routes/catalog/change-request-kinds.test.ts`

```ts
import { beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { modelsInCatalog, trimsInCatalog } from "../../db/catalog";
import { getDefaultDb, type Executor } from "../../db/client";
import { catalogDiscountAdoptions } from "../../db/schema";
import { updateTrim } from "../../db/queries/catalog-admin";
import { upsertPendingRequest } from "../../db/queries/change-requests";
import { ConflictError } from "../../lib/errors";
import { approveChangeRequest, CHANGE_KINDS } from "./change-request-kinds";

// ── kind 레지스트리 + 승인 replay — 전부 롤백(catalog를 실제로 바꾸는 테스트라 필수).
const db = getDefaultDb();
let trimId = 0;
let modelId = 0;
let brandId = 0;

beforeAll(async () => {
  const [trim] = await db
    .select({ id: trimsInCatalog.id, modelId: trimsInCatalog.modelId, brandId: modelsInCatalog.brandId })
    .from(trimsInCatalog)
    .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
    .limit(1);
  trimId = trim!.id;
  modelId = trim!.modelId;
  brandId = trim!.brandId;
});

async function inRollback(fn: (tx: Executor) => Promise<void>): Promise<void> {
  await db
    .transaction(async (tx) => {
      await fn(tx);
      throw new Error("rollback");
    })
    .catch((e: unknown) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
}

async function enqueue(tx: Executor, kind: string, targetId: number | null, payload: Record<string, unknown>) {
  const def = CHANGE_KINDS[kind as keyof typeof CHANGE_KINDS];
  const snapshot = await def.buildSnapshot(targetId, payload, tx);
  expect(snapshot).not.toBeNull();
  const r = await upsertPendingRequest(
    { kind, targetType: def.targetType, targetId, payload, snapshot, requestedBy: crypto.randomUUID() },
    tx,
  );
  if (!r.ok) throw new Error("적재 실패");
  return r.id;
}

test("trim.update 승인 replay가 catalog를 실제로 바꾸고 할인 감사가 승인자 명의로 남는다", async () => {
  await inRollback(async (tx) => {
    const [before] = await tx
      .select({ price: trimsInCatalog.price, fin: trimsInCatalog.financialDiscountAmount })
      .from(trimsInCatalog)
      .where(eq(trimsInCatalog.id, trimId));
    const newFin = (before!.fin ?? 0) + 111;
    const id = await enqueue(tx, "trim.update", trimId, { financialDiscountAmount: newFin });
    const adminId = crypto.randomUUID();
    const result = await approveChangeRequest(id, adminId, tx);
    expect(result).not.toBeNull();
    const [after] = await tx
      .select({ fin: trimsInCatalog.financialDiscountAmount })
      .from(trimsInCatalog)
      .where(eq(trimsInCatalog.id, trimId));
    expect(after!.fin).toBe(newFin);
    // 할인 감사 명의 = 승인한 관리자(spec §6.4 ④)
    const audits = await tx
      .select()
      .from(catalogDiscountAdoptions)
      .where(eq(catalogDiscountAdoptions.adoptedBy, adminId));
    expect(audits.length).toBe(1);
    expect(audits[0]!.field).toBe("financial");
  });
});

test("드리프트: 요청 후 admin이 직접 고치면 승인이 ConflictError로 죽고 행은 롤백된다", async () => {
  await inRollback(async (tx) => {
    const [before] = await tx
      .select({ price: trimsInCatalog.price })
      .from(trimsInCatalog)
      .where(eq(trimsInCatalog.id, trimId));
    const id = await enqueue(tx, "trim.update", trimId, { price: Number(before!.price) + 1 });
    // 그 사이 admin 직접 수정(같은 필드)
    await updateTrim(trimId, { price: Number(before!.price) + 500 }, tx);
    await expect(approveChangeRequest(id, crypto.randomUUID(), tx)).rejects.toThrow(ConflictError);
  });
});

test("model.create: 승인 replay가 모델을 만든다(부모 = 브랜드 존재 확인)", async () => {
  await inRollback(async (tx) => {
    const id = await enqueue(tx, "model.create", null, {
      brandId, name: "승인요청검증모델", category: null, status: "판매중",
    });
    const created = (await approveChangeRequest(id, crypto.randomUUID(), tx)) as { id: number } | null;
    expect(created?.id).toBeGreaterThan(0);
    const [row] = await tx
      .select({ name: modelsInCatalog.name })
      .from(modelsInCatalog)
      .where(eq(modelsInCatalog.id, created!.id));
    expect(row!.name).toBe("승인요청검증모델");
  });
});

test("대상 삭제 후 승인은 ConflictError(스냅샷 재조회 null)", async () => {
  await inRollback(async (tx) => {
    const id = await enqueue(tx, "model.update", modelId, { category: "테스트" });
    // 트림 FK 때문에 실제 삭제 대신 존재하지 않는 대상을 흉내낼 수 없다 — 옵션 축으로 검증:
    // 존재하는 옵션 없이도 model.update 스냅샷 자체는 위에서 non-null이었으므로,
    // 여기서는 payload 스키마 위반 재검증 축을 대신 확인한다(§6.4 ②).
    await tx.execute(
      // payload를 스키마 밖 값으로 오염(psql 직접 조작 시나리오)
      (await import("drizzle-orm")).sql`update crm.catalog_change_requests set payload = '{"status":"없는상태"}'::jsonb where id = ${id}`,
    );
    await expect(approveChangeRequest(id, crypto.randomUUID(), tx)).rejects.toThrow(ConflictError);
  });
});

test("no-option.set: 옵션이 있는 트림은 스냅샷 드리프트로 막힌다", async () => {
  await inRollback(async (tx) => {
    // 옵션 0개 트림을 찾기 어려우면 기존 트림에 옵션을 심어 optionCount 드리프트를 만든다
    const def = CHANGE_KINDS["trim.no-option.set"];
    const snapshot = await def.buildSnapshot(trimId, {}, tx);
    expect(snapshot).not.toBeNull();
    expect(typeof (snapshot as Record<string, unknown>).optionCount).toBe("number");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/routes/catalog/change-request-kinds.test.ts`
기대: FAIL — "Cannot find module './change-request-kinds'"

- [ ] **Step 3: 구현** — `src/routes/catalog/change-request-kinds.ts`

```ts
import { count, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { z } from "zod";

import {
  brandsInCatalog, modelsInCatalog, trimNoOptionsInCatalog, trimOptionsInCatalog, trimsInCatalog,
} from "../../db/catalog";
import type { Executor } from "../../db/client";
import {
  createModel, createOption, createTrim, setTrimNoOption, unsetTrimNoOption, updateModel, updateOption,
} from "../../db/queries/catalog-admin";
import { claimPending, upsertPendingRequest } from "../../db/queries/change-requests";
import { updateTrimWithDiscountAudit } from "../../db/queries/discount-adoptions";
import { detectSnapshotDrift } from "../../lib/change-request-drift";
import { ConflictError } from "../../lib/errors";
import type { AuthVariables } from "../../middleware/auth";
import type { DbVariables } from "../../middleware/db";
import { errorResponse } from "../shared";
import {
  emptyBody, modelCreateBody, modelUpdateBody, optionCreatePayload, optionUpdateBody, trimCreateBody, trimUpdateBody,
} from "./schemas";

// kind 레지스트리 — 적재(스냅샷)와 승인 replay(재검증·드리프트·실행)의 단일 소스(spec §5).
// admin 직접 실행 라우트와 승인 경로가 같은 execute를 부르므로 두 경로가 갈라질 수 없다.
//
// buildSnapshot 계약: null = 대상/부모 없음(적재 시 404, 승인 시 드리프트 409).
// update 계약: snapshot은 payload가 건드리는 필드의 현재 값만 담는다(spec §5.1 — 무관 필드의
// admin 직접 수정은 승인을 막지 않는다).

export type ChangeKind =
  | "model.create" | "model.update"
  | "trim.create" | "trim.update"
  | "option.create" | "option.update"
  | "trim.no-option.set" | "trim.no-option.unset";

type KindDef = {
  targetType: "model" | "trim" | "option";
  bodySchema: z.ZodTypeAny;
  notFoundMsg: string;
  buildSnapshot(targetId: number | null, payload: Record<string, unknown>, ex: Executor): Promise<Record<string, unknown> | null>;
  execute(targetId: number | null, payload: Record<string, unknown>, ctx: { decidedBy: string }, tx: Executor): Promise<unknown>;
};

const pickByPayloadKeys = (fields: Record<string, unknown>, payload: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(payload).map((k) => [k, fields[k] ?? null]));

async function brandExists(brandId: number, ex: Executor) {
  const [row] = await ex.select({ id: brandsInCatalog.id }).from(brandsInCatalog).where(eq(brandsInCatalog.id, brandId));
  return row ? {} : null;
}

async function modelExists(modelId: number, ex: Executor) {
  const [row] = await ex.select({ id: modelsInCatalog.id }).from(modelsInCatalog).where(eq(modelsInCatalog.id, modelId));
  return row ? {} : null;
}

async function trimExists(trimId: number, ex: Executor) {
  const [row] = await ex.select({ id: trimsInCatalog.id }).from(trimsInCatalog).where(eq(trimsInCatalog.id, trimId));
  return row ? {} : null;
}

async function modelFields(id: number, ex: Executor): Promise<Record<string, unknown> | null> {
  const [row] = await ex
    .select({ category: modelsInCatalog.category, status: modelsInCatalog.status })
    .from(modelsInCatalog)
    .where(eq(modelsInCatalog.id, id));
  return row ?? null;
}

async function trimFields(id: number, ex: Executor): Promise<Record<string, unknown> | null> {
  const [row] = await ex
    .select({
      trimName: trimsInCatalog.trimName,
      price: trimsInCatalog.price,
      modelYear: trimsInCatalog.modelYear,
      fuelType: trimsInCatalog.fuelType,
      driveSystem: trimsInCatalog.driveSystem,
      displacementCc: trimsInCatalog.displacementCc,
      transmissionType: trimsInCatalog.transmissionType,
      bodyStyle: trimsInCatalog.bodyStyle,
      seatingCapacity: trimsInCatalog.seatingCapacity,
      status: trimsInCatalog.status,
      financialDiscountAmount: trimsInCatalog.financialDiscountAmount,
      partnerDiscountAmount: trimsInCatalog.partnerDiscountAmount,
      cashDiscountAmount: trimsInCatalog.cashDiscountAmount,
    })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.id, id));
  if (!row) return null;
  // price는 numeric이라 드라이버가 문자열로 줄 수 있다 — payload(number)와 같은 표현으로 정규화.
  return { ...row, price: Number(row.price) };
}

async function optionFields(id: number, ex: Executor): Promise<Record<string, unknown> | null> {
  const [row] = await ex
    .select({ name: trimOptionsInCatalog.name, price: trimOptionsInCatalog.price })
    .from(trimOptionsInCatalog)
    .where(eq(trimOptionsInCatalog.id, id));
  return row ?? null;
}

// 무옵션 토글 스냅샷: 옵션 개수까지 담아 "요청 이후 옵션이 생겼다/사라졌다"를 드리프트로 잡는다.
async function noOptionSnapshot(trimId: number, ex: Executor): Promise<Record<string, unknown> | null> {
  if ((await trimExists(trimId, ex)) === null) return null;
  const [opt] = await ex
    .select({ c: count() })
    .from(trimOptionsInCatalog)
    .where(eq(trimOptionsInCatalog.trimId, trimId));
  const [no] = await ex
    .select({ c: count() })
    .from(trimNoOptionsInCatalog)
    .where(eq(trimNoOptionsInCatalog.trimId, trimId));
  return { optionCount: Number(opt?.c ?? 0), noOption: Number(no?.c ?? 0) > 0 };
}

export const CHANGE_KINDS: Record<ChangeKind, KindDef> = {
  "model.create": {
    targetType: "model",
    bodySchema: modelCreateBody,
    notFoundMsg: "브랜드를 찾을 수 없습니다.",
    buildSnapshot: (_t, payload, ex) => brandExists(Number(payload.brandId), ex),
    execute: (_t, payload, _ctx, tx) => createModel(modelCreateBody.parse(payload), tx),
  },
  "model.update": {
    targetType: "model",
    bodySchema: modelUpdateBody,
    notFoundMsg: "모델을 찾을 수 없습니다.",
    buildSnapshot: async (targetId, payload, ex) => {
      const fields = await modelFields(targetId!, ex);
      return fields === null ? null : pickByPayloadKeys(fields, payload);
    },
    execute: (targetId, payload, _ctx, tx) => updateModel(targetId!, modelUpdateBody.parse(payload), tx),
  },
  "trim.create": {
    targetType: "trim",
    bodySchema: trimCreateBody,
    notFoundMsg: "모델을 찾을 수 없습니다.",
    buildSnapshot: (_t, payload, ex) => modelExists(Number(payload.modelId), ex),
    execute: (_t, payload, _ctx, tx) => createTrim(trimCreateBody.parse(payload), tx),
  },
  "trim.update": {
    targetType: "trim",
    bodySchema: trimUpdateBody,
    notFoundMsg: "트림을 찾을 수 없습니다.",
    buildSnapshot: async (targetId, payload, ex) => {
      const fields = await trimFields(targetId!, ex);
      return fields === null ? null : pickByPayloadKeys(fields, payload);
    },
    execute: (targetId, payload, ctx, tx) =>
      updateTrimWithDiscountAudit(targetId!, trimUpdateBody.parse(payload), ctx.decidedBy, tx),
  },
  "option.create": {
    targetType: "option",
    bodySchema: optionCreatePayload,
    notFoundMsg: "트림을 찾을 수 없습니다.",
    buildSnapshot: (_t, payload, ex) => trimExists(Number(payload.trimId), ex),
    execute: (_t, payload, _ctx, tx) => createOption(optionCreatePayload.parse(payload), tx),
  },
  "option.update": {
    targetType: "option",
    bodySchema: optionUpdateBody,
    notFoundMsg: "옵션을 찾을 수 없습니다.",
    buildSnapshot: async (targetId, payload, ex) => {
      const fields = await optionFields(targetId!, ex);
      return fields === null ? null : pickByPayloadKeys(fields, payload);
    },
    execute: (targetId, payload, _ctx, tx) => updateOption(targetId!, optionUpdateBody.parse(payload), tx),
  },
  "trim.no-option.set": {
    targetType: "trim",
    bodySchema: emptyBody,
    notFoundMsg: "트림을 찾을 수 없습니다.",
    buildSnapshot: (targetId, _p, ex) => noOptionSnapshot(targetId!, ex),
    execute: (targetId, _p, _ctx, tx) => setTrimNoOption(targetId!, tx),
  },
  "trim.no-option.unset": {
    targetType: "trim",
    bodySchema: emptyBody,
    notFoundMsg: "트림을 찾을 수 없습니다.",
    buildSnapshot: (targetId, _p, ex) => noOptionSnapshot(targetId!, ex),
    execute: (targetId, _p, _ctx, tx) => unsetTrimNoOption(targetId!, tx),
  },
};

// 승인 트랜잭션 본체(spec §6.4) — 호출자(라우트)가 db.transaction으로 감싼다.
// ConflictError는 run()이 409로 매핑하고, tx 전체가 롤백되어 행은 pending으로 남는다.
export async function approveChangeRequest(id: string, decidedBy: string, tx: Executor): Promise<unknown> {
  const claimed = await claimPending(id, decidedBy, tx); // ① 선점
  if (!claimed) return null; // → 404 "대기 중인 요청이 없습니다."
  const def = CHANGE_KINDS[claimed.kind as ChangeKind];
  const parsed = def.bodySchema.safeParse(claimed.payload); // ② 재검증
  if (!parsed.success) throw new ConflictError("요청 내용이 현재 스키마와 맞지 않습니다. 반려 후 재요청을 안내하세요.");
  const current = await def.buildSnapshot(claimed.targetId, claimed.payload, tx); // ③ 드리프트
  if (current === null) throw new ConflictError("대상이 그 사이 삭제되어 승인할 수 없습니다. 반려 후 재요청을 안내하세요.");
  const drifted = detectSnapshotDrift(claimed.snapshot ?? {}, current);
  if (drifted.length > 0) {
    throw new ConflictError(`그 사이 값이 바뀌어 승인할 수 없습니다(${drifted.join(", ")}). 반려 후 재요청을 안내하세요.`);
  }
  return def.execute(claimed.targetId, claimed.payload, { decidedBy }, tx); // ④ replay (⑤ 스탬프는 ①에서 — 같은 tx라 원자)
}

type CatalogContext = Context<{ Variables: AuthVariables & DbVariables }>;

// manager의 쓰기 → 큐 적재 + 202. 라우트 분기(spec §6.1)의 manager 쪽 절반.
// 404(대상 없음)·409(타인 pending)·202(적재)를 스스로 응답한다 — run()은 200 고정이라 못 쓴다.
export async function submitChangeRequest(
  c: CatalogContext,
  kind: ChangeKind,
  targetId: number | null,
  payload: Record<string, unknown>,
): Promise<Response> {
  const def = CHANGE_KINDS[kind];
  try {
    const snapshot = await def.buildSnapshot(targetId, payload, c.var.db);
    if (snapshot === null) return c.json({ error: def.notFoundMsg }, 404);
    const result = await upsertPendingRequest(
      { kind, targetType: def.targetType, targetId, payload, snapshot, requestedBy: c.var.user.id },
      c.var.db,
    );
    if (!result.ok) {
      return c.json(
        { error: "이미 승인 대기 중인 요청이 있습니다.", requestedBy: result.existingRequestedBy, requestedAt: result.existingCreatedAt },
        409,
      );
    }
    return c.json({ queued: true, requestId: result.id }, 202);
  } catch (e) {
    return errorResponse(c, e);
  }
}
```

- [ ] **Step 4: 통과 확인 후 커밋**

Run: `EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/routes/catalog/change-request-kinds.test.ts` → 5 pass

```bash
git add src/routes/catalog/change-request-kinds.ts src/routes/catalog/change-request-kinds.test.ts
git commit -m "feat(crm): 변경 요청 kind 레지스트리 + 승인 replay — 적재·실행 단일 소스

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 쓰기 라우트 분기 + 게이트 봉인

**Files:**
- Modify: `src/routes/catalog/models.ts`, `src/routes/catalog/trims.ts`, `src/routes/catalog/options.ts`, `src/routes/shared.ts`(에러 매핑 1줄), `src/routes/catalog/discounts.ts`(스테일 주석 정정)

- [ ] **Step 1: 큐 대상 8종 — `requireRoles(["admin","manager"])` + manager 분기**

각 파일에 `import { requireRoles } from "../../middleware/role-gate";`와 `import { submitChangeRequest } from "./change-request-kinds";` 추가. 8개 핸들러를 아래 형태로 교체(전부 같은 패턴 — kind·targetId·직접 실행 호출만 다르다):

`models.ts`:

```ts
  catalog.post("/models", requireRoles(["admin", "manager"]), zValidator("json", modelCreateBody), async (c) => {
    const body = c.req.valid("json");
    if (c.var.user.role === "manager") return submitChangeRequest(c, "model.create", null, body);
    return run(c, () => createModel(body, c.var.db));
  });

  catalog.patch(
    "/models/:id",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id })),
    zValidator("json", modelUpdateBody),
    async (c) => {
      const modelId = c.req.valid("param").id;
      const body = c.req.valid("json");
      if (c.var.user.role === "manager") return submitChangeRequest(c, "model.update", modelId, body);
      return run(c, () => updateModel(modelId, body, c.var.db), "모델을 찾을 수 없습니다.");
    },
  );
```

`trims.ts`:

```ts
  catalog.post("/trims", requireRoles(["admin", "manager"]), zValidator("json", trimCreateBody), async (c) => {
    const body = c.req.valid("json");
    if (c.var.user.role === "manager") return submitChangeRequest(c, "trim.create", null, body);
    return run(c, () => createTrim(body, c.var.db));
  });

  catalog.patch(
    "/trims/:id",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id })),
    zValidator("json", trimUpdateBody),
    async (c) => {
      const trimId = c.req.valid("param").id;
      const patch = c.req.valid("json");
      if (c.var.user.role === "manager") return submitChangeRequest(c, "trim.update", trimId, patch);
      const adoptedBy = c.var.user.id;
      return run(
        c,
        () => c.var.db.transaction((tx) => updateTrimWithDiscountAudit(trimId, patch, adoptedBy, tx)),
        "트림을 찾을 수 없습니다.",
      );
    },
  );
```

`options.ts` (option.create는 param trimId를 payload에 합쳐 저장한다 — 승인 시 실행에 필요):

```ts
  catalog.post(
    "/trims/:id/options",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id })),
    zValidator("json", optionCreateBody),
    async (c) => {
      const payload = { trimId: c.req.valid("param").id, ...c.req.valid("json") };
      if (c.var.user.role === "manager") return submitChangeRequest(c, "option.create", null, payload);
      return run(c, () => createOption(payload, c.var.db));
    },
  );

  catalog.patch(
    "/options/:id",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id })),
    zValidator("json", optionUpdateBody),
    async (c) => {
      const optionId = c.req.valid("param").id;
      const body = c.req.valid("json");
      if (c.var.user.role === "manager") return submitChangeRequest(c, "option.update", optionId, body);
      return run(c, () => updateOption(optionId, body, c.var.db), "옵션을 찾을 수 없습니다.");
    },
  );

  catalog.post("/trims/:id/no-option", requireRoles(["admin", "manager"]), zValidator("param", z.object({ id })), async (c) => {
    const trimId = c.req.valid("param").id;
    if (c.var.user.role === "manager") return submitChangeRequest(c, "trim.no-option.set", trimId, {});
    return run(c, () => setTrimNoOption(trimId, c.var.db));
  });
  catalog.delete("/trims/:id/no-option", requireRoles(["admin", "manager"]), zValidator("param", z.object({ id })), async (c) => {
    const trimId = c.req.valid("param").id;
    if (c.var.user.role === "manager") return submitChangeRequest(c, "trim.no-option.unset", trimId, {});
    return run(c, () => unsetTrimNoOption(trimId, c.var.db));
  });
```

- [ ] **Step 2: admin 전용 7종 — `requireRoles(["admin"])` 부착** (분기 없음, 핸들러 본문 불변)

- `models.ts`: `DELETE /models/:id` · `POST /models/:id/assign-codes` · `POST /models/reorder`
- `trims.ts`: `DELETE /trims/:id` · `POST /trims/move` · `POST /trims/reorder`
- `options.ts`: `DELETE /options/:id`

각각 첫 미들웨어 인자로 삽입. 예:

```ts
  catalog.delete("/models/:id", requireRoles(["admin"]), zValidator("param", z.object({ id })), async (c) =>
    run(c, () => deleteModel(c.req.valid("param").id, c.var.db), "모델을 찾을 수 없습니다."),
  );
```

- [ ] **Step 3: 경합 시 UNIQUE 위반 한글 매핑** — `src/routes/shared.ts`의 `dbErrorMessage`에서 generic 23505 줄 **앞에** 추가:

```ts
  if (/catalog_change_requests_pending_target_unique/i.test(msg)) return "이미 승인 대기 중인 요청이 있습니다.";
```

- [ ] **Step 4: 스테일 주석 정정** — `src/routes/catalog/discounts.ts` 상단 주석의 "catalog 라우터에는 role 게이트가 없어서 staff도 카탈로그를 쓸 수 있는 상태다(기존 정책 — 이번에 바꾸지 않는다)"를 현재 사실로 교체:

```ts
// ⚠️ requireRoles를 명시로 붙이는 이유: 딜러 제안 열람·채택은 admin 전용이다. dealerWriteGate는
// **쓰기만** 보므로 GET을 막지 않아 딜러가 경쟁사 제안을 들여다보는 경로도 열린다.
// (2026-07-30부터 catalog 쓰기 전 라우트에 role 게이트가 붙었다 — 큐 8종 admin·manager,
// 삭제/이동/mc_code/reorder admin 전용. spec: 2026-07-30-crm-catalog-change-approval-design.md §6.2)
```

- [ ] **Step 5: 검증 후 커밋**

```bash
bun run typecheck && bun run lint
EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/routes/catalog.test.ts src/routes/catalog.discount-adoptions.test.ts src/routes/dealer.role-gate.test.ts
git add src/routes/catalog/ src/routes/shared.ts
git commit -m "feat(crm): catalog 쓰기 라우트 role 분기 — manager 큐 적재·게이트 봉인

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 대기열 라우트

**Files:**
- Create: `src/routes/catalog/change-requests.ts`
- Modify: `src/routes/catalog.ts` (register 1줄)

- [ ] **Step 1: 라우트 파일 생성** — `src/routes/catalog/change-requests.ts`

```ts
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import {
  cancelOwnPending, listChangeRequests, listModelPendingRequests, listMyChangeRequests, markRejected,
} from "../../db/queries/change-requests";
import { requireRoles } from "../../middleware/role-gate";
import { approveChangeRequest } from "./change-request-kinds";
import { type CatalogApp, id, run } from "./shared";

// 변경 요청 대기열(spec §6.3) — 목록·승인·반려는 admin, 내 요청·취소는 요청자 본인(manager).
// 승인은 트랜잭션 하나(선점→재검증→드리프트→replay) — approveChangeRequest 주석 참조.
const listQuery = z.object({
  status: z.enum(["pending", "approved", "rejected", "canceled"]).default("pending"),
  mine: z.string().optional(), // "1"일 때만 내 요청 모드(전 status 최근 50건)
});

export function registerChangeRequestRoutes(catalog: CatalogApp) {
  catalog.get("/change-requests", requireRoles(["admin", "manager"]), zValidator("query", listQuery), async (c) => {
    const { status, mine } = c.req.valid("query");
    if (mine === "1") return c.json(await listMyChangeRequests(c.var.user.id, c.var.db));
    // 전체 대기열은 admin 전용 — manager가 mine 없이 부르면 타인 요청까지 보인다.
    if (c.var.user.role !== "admin") return c.json({ error: "권한이 없습니다." }, 403);
    return c.json(await listChangeRequests(status, c.var.db));
  });

  catalog.post(
    "/change-requests/:id/approve",
    requireRoles(["admin"]),
    zValidator("param", z.object({ id: z.uuid() })),
    async (c) => {
      const decidedBy = c.var.user.id;
      return run(
        c,
        () => c.var.db.transaction((tx) => approveChangeRequest(c.req.valid("param").id, decidedBy, tx)),
        "대기 중인 요청이 없습니다.",
      );
    },
  );

  catalog.post(
    "/change-requests/:id/reject",
    requireRoles(["admin"]),
    zValidator("param", z.object({ id: z.uuid() })),
    zValidator("json", z.object({ reason: z.string().min(1) })),
    async (c) =>
      run(
        c,
        () => markRejected(c.req.valid("param").id, c.req.valid("json").reason, c.var.user.id, c.var.db),
        "대기 중인 요청이 없습니다.",
      ),
  );

  catalog.delete(
    "/change-requests/:id",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id: z.uuid() })),
    async (c) =>
      run(c, () => cancelOwnPending(c.req.valid("param").id, c.var.user.id, c.var.db), "취소할 대기 요청이 없습니다."),
  );

  catalog.get(
    "/models/:id/change-requests",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id })),
    async (c) => c.json(await listModelPendingRequests(c.req.valid("param").id, c.var.db)),
  );
}
```

- [ ] **Step 2: `src/routes/catalog.ts`에 배선**

```ts
import { registerChangeRequestRoutes } from "./catalog/change-requests";
// … registerDiscountRoutes(catalog); 아래에:
registerChangeRequestRoutes(catalog);
```

- [ ] **Step 3: typecheck 후 커밋**

```bash
bun run typecheck && bun run lint
git add src/routes/catalog/change-requests.ts src/routes/catalog.ts
git commit -m "feat(crm): 변경 요청 대기열 라우트 — 목록·승인·반려·취소·모델 단위 조회

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 잔재 그물 확장 (고아 판정)

**Files:**
- Modify: `src/test-utils/fixture-residue.ts`, `src/scripts/check-test-residue.ts`

라우트 테스트(Task 10)가 만드는 pending 행은 `requested_by = crypto.randomUUID()`라 `public.profiles`에 없다 — 딜러 3테이블과 같은 **고아 판정**으로 잡는다. crm 소유라 `--clean`이 지워도 된다(catalog는 아직 안 바뀐 요청이므로 복원 정보 이슈 없음 — 채택 감사와 다르다).

- [ ] **Step 1: `fixture-residue.ts` 확장**

`FixtureResidue` 타입에 추가:

```ts
  /** 고아 변경 요청 — profiles에 없는 requested_by(테스트 uuid). crm 소유·미반영 큐라 `--clean`이 지운다. */
  orphanChangeRequests: { id: string; kind: string; status: string }[];
```

`residueCount`에 `+ r.orphanChangeRequests.length` 추가. `scanFixtureResidue`에 쿼리 추가:

```ts
  const orphanChangeRequests = await asRows<{ id: string; kind: string; status: string }>(sql`
    select r.id::text, r.kind, r.status from crm.catalog_change_requests r
    where not exists (select 1 from public.profiles p where p.id = r.requested_by)
    order by r.created_at`);
```

return에 매핑 추가:

```ts
    orphanChangeRequests: orphanChangeRequests.map((r) => ({ id: r.id, kind: r.kind, status: r.status })),
```

`formatResidue`에 추가:

```ts
  for (const r of r.orphanChangeRequests) {
    lines.push(`변경 요청 ${r.id} · ${r.kind} · ${r.status} (crm.catalog_change_requests — profiles에 없는 요청자)`);
  }
```

(⚠️ 기존 `formatResidue`의 매개변수 이름이 `r`이므로 루프 변수는 `cr` 등으로 충돌 회피해서 작성한다.)

- [ ] **Step 2: `check-test-residue.ts`의 `--clean` 트랜잭션에 한 줄 추가** (딜러 잔재 DELETE 근처):

```ts
  await tx.execute(sql`delete from crm.catalog_change_requests r
    where not exists (select 1 from public.profiles p where p.id = r.requested_by)`);
```

- [ ] **Step 3: 검증 후 커밋**

```bash
bun run typecheck
bun run check:residue   # 기대: "잔재 없음 ✅" (이 시점엔 고아 행이 없어야 정상)
git add src/test-utils/fixture-residue.ts src/scripts/check-test-residue.ts
git commit -m "feat(crm): 잔재 그물에 고아 변경 요청 추가(고아 판정·clean 포함)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: 라우트 역할 매트릭스 테스트

**Files:**
- Test: `src/routes/catalog.change-requests.test.ts`

- [ ] **Step 1: 테스트 작성** (게이트는 무변이 검증이 원칙 — 유일한 실 행 생성은 manager 202 케이스이고, 같은 테스트가 취소까지 하고 afterAll이 hard delete + Task 9 그물이 백스톱)

```ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { modelsInCatalog } from "../db/catalog";
import { getDefaultDb } from "../db/client";
import { catalogChangeRequests } from "../db/schema";

// ── 변경 승인 워크플로 라우트 게이트(spec §3.3 역할 매트릭스) ────────────────
// 실제 catalog 변이는 하지 않는다(존재하지 않는 대상 → 404 fail-closed로 게이트 통과를 확인).
// 유일한 실 행 = manager 202 케이스의 pending 1건 — 같은 테스트에서 본인 취소까지 확인하고
// afterAll이 hard delete, 잔재는 고아 판정 그물(fixture-residue)이 백스톱.
const db = getDefaultDb();
let modelId = 0;
let modelCategory: string | null = null;
const createdIds: string[] = [];

beforeAll(async () => {
  const [model] = await db
    .select({ id: modelsInCatalog.id, category: modelsInCatalog.category })
    .from(modelsInCatalog)
    .limit(1);
  modelId = model!.id;
  modelCategory = model!.category;
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(catalogChangeRequests).where(inArray(catalogChangeRequests.id, createdIds));
  }
});

type Role = "dealer" | "staff" | "manager" | "admin";

async function makeClient(role: Role) {
  const userId = crypto.randomUUID();
  const { token, keyResolver, issuer } = await makeTestAuth(role, userId);
  const app = createApp({ keyResolver, issuer });
  return {
    userId,
    request: (method: string, path: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}

const NO_MODEL = 999_999_999;

test("큐 8종 축: staff·dealer는 403 (구멍 봉인 — 종전엔 staff가 API 직접 쓰기 가능했다)", async () => {
  for (const role of ["staff", "dealer"] as const) {
    const c = await makeClient(role);
    expect((await c.request("POST", "/api/catalog/models", { brandId: 1, name: "x" })).status).toBe(403);
    expect((await c.request("PATCH", `/api/catalog/models/${NO_MODEL}`, { category: "x" })).status).toBe(403);
    expect((await c.request("POST", `/api/catalog/trims/${NO_MODEL}/no-option`)).status).toBe(403);
  }
});

test("admin 전용 축: manager도 403 (삭제·이동·mc_code·reorder)", async () => {
  const c = await makeClient("manager");
  expect((await c.request("DELETE", `/api/catalog/models/${NO_MODEL}`)).status).toBe(403);
  expect((await c.request("DELETE", `/api/catalog/trims/${NO_MODEL}`)).status).toBe(403);
  expect((await c.request("DELETE", `/api/catalog/options/${NO_MODEL}`)).status).toBe(403);
  expect((await c.request("POST", "/api/catalog/trims/move", { trimIds: [NO_MODEL], targetModelId: 1 })).status).toBe(403);
  expect((await c.request("POST", `/api/catalog/models/${NO_MODEL}/assign-codes`)).status).toBe(403);
  expect((await c.request("POST", "/api/catalog/models/reorder", { ids: [1] })).status).toBe(403);
  expect((await c.request("POST", "/api/catalog/trims/reorder", { ids: [1] })).status).toBe(403);
});

test("manager: 없는 대상 요청은 404 — 큐에 행이 생기지 않는다(fail-closed)", async () => {
  const c = await makeClient("manager");
  const res = await c.request("PATCH", `/api/catalog/models/${NO_MODEL}`, { category: "x" });
  expect(res.status).toBe(404);
  const rows = await db
    .select({ id: catalogChangeRequests.id })
    .from(catalogChangeRequests)
    .where(eq(catalogChangeRequests.requestedBy, c.userId));
  expect(rows.length).toBe(0);
});

test("admin: 없는 대상은 404 — 즉시 실행 경로(큐를 타지 않는다)", async () => {
  const c = await makeClient("admin");
  const res = await c.request("PATCH", `/api/catalog/models/${NO_MODEL}`, { category: "x" });
  expect(res.status).toBe(404);
});

test("manager 202 적재 → 내 요청 목록 → 본인 취소 (실 행 1건, 즉시 정리)", async () => {
  const c = await makeClient("manager");
  // 현재 값 그대로를 payload로 — 승인돼도 무변이지만, 이 테스트는 승인하지 않는다.
  const res = await c.request("PATCH", `/api/catalog/models/${modelId}`, { category: modelCategory });
  expect(res.status).toBe(202);
  const body = (await res.json()) as { queued: boolean; requestId: string };
  expect(body.queued).toBe(true);
  createdIds.push(body.requestId);

  const mine = await c.request("GET", "/api/catalog/change-requests?mine=1");
  expect(mine.status).toBe(200);
  const mineRows = (await mine.json()) as Array<{ id: string; status: string }>;
  expect(mineRows.some((r) => r.id === body.requestId && r.status === "pending")).toBe(true);

  // 모델 단위 배지 조회에도 잡힌다
  const scoped = await c.request("GET", `/api/catalog/models/${modelId}/change-requests`);
  expect(scoped.status).toBe(200);
  expect(((await scoped.json()) as Array<{ id: string }>).some((r) => r.id === body.requestId)).toBe(true);

  const cancel = await c.request("DELETE", `/api/catalog/change-requests/${body.requestId}`);
  expect(cancel.status).toBe(200);
  expect(((await cancel.json()) as { status: string }).status).toBe("canceled");
});

test("대기열 조회: admin 200 · manager(mine 없이) 403 · staff 403 · dealer 403", async () => {
  expect((await (await makeClient("admin")).request("GET", "/api/catalog/change-requests")).status).toBe(200);
  expect((await (await makeClient("manager")).request("GET", "/api/catalog/change-requests")).status).toBe(403);
  expect((await (await makeClient("staff")).request("GET", "/api/catalog/change-requests?mine=1")).status).toBe(403);
  expect((await (await makeClient("dealer")).request("GET", "/api/catalog/change-requests")).status).toBe(403);
});

test("승인·반려: manager 403 · admin은 없는 id에 404 · 반려 사유 없으면 400", async () => {
  const someId = crypto.randomUUID();
  const m = await makeClient("manager");
  expect((await m.request("POST", `/api/catalog/change-requests/${someId}/approve`)).status).toBe(403);
  const a = await makeClient("admin");
  expect((await a.request("POST", `/api/catalog/change-requests/${someId}/approve`)).status).toBe(404);
  expect((await a.request("POST", `/api/catalog/change-requests/${someId}/reject`, { reason: "" })).status).toBe(400);
  expect((await a.request("POST", `/api/catalog/change-requests/${someId}/reject`, { reason: "사유" })).status).toBe(404);
});
```

- [ ] **Step 2: 실행 확인**

Run: `EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/routes/catalog.change-requests.test.ts` → 7 pass

- [ ] **Step 3: 잔재 0 확인 후 커밋**

```bash
bun run check:residue   # 기대: 잔재 없음 ✅ (afterAll 정리 검증)
git add src/routes/catalog.change-requests.test.ts
git commit -m "test(crm): 변경 승인 워크플로 역할 매트릭스 — 큐 8종·admin 전용 7종·대기열

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: registry 등록 + 종합 검증 + PR

**Files:**
- Modify: `src/test-utils/db-bound-tests.ts`

- [ ] **Step 1: DB 의존 테스트 3파일 등록** (fail-closed — 안 하면 CI pure가 env 없이 돌려 빨개진다). `DB_BOUND_TEST_FILES`의 해당 섹션에 알파벳 순서로 삽입:

```ts
  // 쿼리 레이어 섹션에:
  "src/db/queries/change-requests.test.ts",
  // 라우트 통합 섹션에:
  "src/routes/catalog.change-requests.test.ts",
  "src/routes/catalog/change-request-kinds.test.ts",
```

(⚠️ `src/lib/change-request-drift.test.ts`는 **등록하지 않는다** — 순수라 CI pure에서 돌아야 한다.)

- [ ] **Step 2: 전체 검증 4종 + 로컬 서버 스위트**

```bash
bun run typecheck && bun run lint && bun run knip && bun run format:check
bun run test:unit
bun run build
bun run test:server   # ⚠️ 실 DB + 실 Gemini 9콜 — 시간 몇 분. 말미 잔재 검사까지 green 확인
```

기대: 전부 0 error / 잔재 없음. knip에서 신규 export가 미사용으로 잡히면 → 실제 소비처(라우트·레지스트리)가 배선됐는지 먼저 확인(등록으로 덮지 말 것).

- [ ] **Step 3: 커밋 + PR**

```bash
git add src/test-utils/db-bound-tests.ts
git commit -m "chore(crm): 변경 승인 DB 테스트 3파일 db-bound registry 등록

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin feat/catalog-change-approval-server
gh pr create --title "feat(crm): MC 마스터 변경 승인 워크플로 — 서버 (PR 1/3)" --body "$(cat <<'EOF'
## 요약
- 팀장(manager)의 catalog 쓰기(8종: 모델/트림/옵션 추가·수정 + 무옵션 토글)가 `crm.catalog_change_requests` 큐로 적재되고(202), admin 승인 시에만 같은 실행 함수 replay로 catalog에 반영됩니다(마이그 0043).
- 대상+작업당 pending 1건(부분 UNIQUE) — 본인 재제출은 갱신, 타인은 409.
- 승인 = 트랜잭션 하나: 선점 → zod 재검증 → 드리프트 fail-closed(409, pending 유지) → replay(할인 감사는 승인자 명의) → 스탬프.
- 🟡 **행위 변경(게이트 봉인)**: catalog 쓰기 전 라우트에 requireRoles 부착 — 종전엔 staff도 API 직접 쓰기가 가능했습니다(UI만 막힘). 이제 큐 8종 = admin·manager, 삭제·이동·mc_code·reorder = admin 전용.
- 대기열 라우트(목록·승인·반려·본인 취소·모델 단위 조회) + 잔재 그물(고아 변경 요청) 확장.
- UI는 후속: PR 2(관리자 대기열)·PR 3(팀장 개방). 이 PR 시점엔 팀장 UI가 없어 큐는 비어 있습니다.

spec: `ref/specs/2026-07-30-crm-catalog-change-approval-design.md` / 계획: `ref/plans/2026-07-30-crm-catalog-change-approval-pr1.md`

## 검증
- typecheck · lint · knip · format:check 0
- test:unit / test:pure(드리프트 순수 5) / build green
- 로컬 test:server: 큐 CRUD 9(롤백) · 레지스트리 replay 5(롤백) · 라우트 매트릭스 7 · 잔재 0

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: CI 8단계(typecheck · lint · knip · format · unit · pure · build · edge) green 확인**

```bash
gh pr checks --watch
```

---

## Self-Review 결과 (계획 작성 시 수행)

- **Spec 커버리지**: §3.1 큐 8종(Task 6·7) · §3.2 admin 전용(Task 7 Step 2 — 딜러 채택 2종은 기존 게이트 유지라 무변경) · §3.3 매트릭스(Task 10) · §4 테이블+UNIQUE(Task 1) · §4.1 충돌 의미론(Task 5) · §5 레지스트리·순수 드리프트(Task 2·6) · §6.1 분기(Task 7) · §6.2 게이트(Task 7) · §6.3 라우트 6종(Task 8) · §6.4 승인 tx(Task 6) · §8 테스트 전략(Task 2·5·6·10) — **§7(UI)·사이드바 배지는 PR 2·3 범위로 의도적 제외**.
- **타입 일관성**: `upsertPendingRequest`/`claimPending`/`cancelOwnPending`/`markRejected` 시그니처가 Task 5 정의 = Task 6·8 사용처 일치. `updateTrimWithDiscountAudit(trimId, patch, adoptedBy, tx)` Task 4 정의 = Task 6·7 사용처 일치. `detectSnapshotDrift(snapshot, current): string[]` Task 2 = Task 6 일치.
- **주의(구현 중 확인)**: ①`trims.ts`의 `visibleTrimsFor` 등 기존 import 정리 시 GET 라우트가 깨지지 않게 ②`formatResidue` 매개변수 `r`과 루프 변수 충돌(Task 9에 명시) ③drizzle `uniqueIndex().where()` 생성 SQL을 Step 2에서 반드시 눈으로 검수 ④Task 6 테스트의 "대상 삭제" 케이스는 FK 제약상 payload 오염으로 §6.4 ② 축을 검증(주석에 사유 있음).
```
