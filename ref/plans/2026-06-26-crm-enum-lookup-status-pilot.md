# CRM enum/lookup 진행상태 파일럿 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** crm에 단일 `lookup_values` 테이블을 도입하고, `customers` PATCH의 진행상태(`status_group`→`status`) 종속을 lookup 기반으로 검증한다.

**Architecture:** 단일 lookup 테이블(category 컬럼으로 도메인 구분, parent_value로 종속). 종속 판정은 순수 함수로 분리(유닛 테스트), 라우트 PATCH는 status 관련 키가 올 때만 lookup 1쿼리로 검증. `customers.status_group`/`status` 컬럼 값은 무변경(데이터 마이그레이션 0). 프론트 소비는 후속 슬라이스.

**Tech Stack:** drizzle-orm 0.45 / drizzle-kit 0.31, Hono + zod-validator, bun:test(서버 라운드트립, `test:server`), Postgres(master `crm` 스키마).

**Spec:** `ref/specs/2026-06-26-crm-enum-lookup-status-pilot-design.md`

**Branch:** `feat/crm-lookup-status-pilot` (이미 생성, spec 커밋됨)

---

## 테스트 러너 주의

- `vitest`(`test:unit`)는 `client/src/**`·`test/**`만 잡는다. `src/**/*.test.ts`는 **`bun test`(`test:server`)**가 잡는다.
- 따라서 이 플랜의 서버 순수 함수/라우트 테스트는 전부 `bun test --env-file=.env.local`(=`test:server`)로 검증한다.
- `test:server`는 **실제 master DB**에 붙는다. 공유 DB이므로 throwaway 데이터는 `finally`로 정리한다(기존 `customers.test.ts` 패턴).

## 파일 구조

- `src/db/schema.ts` — `lookupValues` 테이블 추가(수정).
- `drizzle/0005_*.sql` — `db:generate` 산출물(생성).
- `scripts/seed-lookups.ts` — 진행상태 시드(생성). `package.json`에 `seed:lookups` 추가(수정).
- `src/lib/status-lookup.ts` — 종속 판정 순수 함수(생성).
- `src/lib/status-lookup.test.ts` — 순수 함수 유닛 테스트(생성, bun).
- `src/db/queries/lookups.ts` — `listLookup`, `validateStatusSelection`(생성).
- `src/routes/customers.ts` — PATCH 핸들러에 검증 연결(수정).
- `src/routes/customers.test.ts` — 진행상태 검증 라운드트립 테스트 추가(수정, bun).

---

## Task 1: lookup_values 스키마 + 마이그레이션

**Files:**
- Modify: `src/db/schema.ts:1-13`(import), 끝에 테이블 추가
- Create: `drizzle/0005_*.sql`(생성기 산출)

- [ ] **Step 1: schema.ts import에 `uniqueIndex` 추가**

`src/db/schema.ts` 상단 import 블록(1-13행)의 `drizzle-orm/pg-core` 목록에 `uniqueIndex`를 추가한다. 수정 후:

```ts
import {
  pgSchema,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  smallint,
  bigint,
  date,
  uniqueIndex,
} from "drizzle-orm/pg-core";
```

- [ ] **Step 2: `lookupValues` 테이블 정의 추가**

`src/db/schema.ts` 맨 끝(`quoteScenarios` 정의 뒤)에 추가한다:

```ts
// ── 업무 어휘 lookup (enum/lookup 정리 1차 슬라이스: 진행상태 파일럿) ────────────
// category로 도메인 구분(이번엔 status_group/status), parent_value로 종속(1차→2차).
// value는 현행 text 값 그대로라 customers 컬럼/기존 데이터는 무변경.
export const lookupValues = crm.table(
  "lookup_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    category: text("category").notNull(),       // "status_group" | "status"
    value: text("value").notNull(),             // 현행 text 값: "계약완료" / "출고완료"
    label: text("label"),                       // 표시명. null이면 value 사용
    parentValue: text("parent_value"),          // status→부모 group value, status_group→null
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("lookup_values_category_value_key").on(table.category, table.value)],
);
```

- [ ] **Step 3: 마이그레이션 생성**

Run: `bun run db:generate`
Expected: `drizzle/0005_*.sql` 생성, 내용은 `CREATE TABLE "crm"."lookup_values" (...)` + unique index. crm 외 스키마 변경이 **없어야** 함(있으면 중단하고 점검).

- [ ] **Step 4: 생성 SQL 육안 확인**

Run: `cat drizzle/0005_*.sql`
Expected: `crm.lookup_values` 생성 + `lookup_values_category_value_key` unique index만. `public`/`catalog` 관련 DDL 없음.

- [ ] **Step 5: 마이그레이션 적용(팀 공유 master, additive)**

Run: `bun run db:migrate`
Expected: `0005` 적용 성공. additive(테이블 신설)라 기존 데이터/스키마 영향 없음.
주의: master는 팀 공유 DB. `db:push`는 절대 사용 금지(규약).

- [ ] **Step 6: 타입 점검 + 커밋**

Run: `bun run typecheck`
Expected: 0 errors.

```bash
git add src/db/schema.ts drizzle/
git commit -m "$(cat <<'EOF'
feat(crm): lookup_values 테이블 + 마이그레이션 0005

단일 lookup 테이블(category/value/label/parent_value/sort_order/active),
(category,value) unique. crm only·additive. 진행상태 파일럿 토대.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 진행상태 lookup 시드

**Files:**
- Create: `scripts/seed-lookups.ts`
- Modify: `package.json`(scripts에 `seed:lookups`)

- [ ] **Step 1: 시드 스크립트 작성**

`customerStatusGroups`(프론트 상수)를 입력으로 `lookup_values`에 status_group/status 행을 멱등 생성한다. `scripts/seed-customers.ts`의 import 패턴(`../client/src/data/...`, `../src/db/...`)을 따른다.

Create `scripts/seed-lookups.ts`:

```ts
import { and, inArray } from "drizzle-orm";

import { customerStatusGroups } from "../client/src/data/customers";
import { getDefaultDb } from "../src/db/client";
import { lookupValues } from "../src/db/schema";

// 진행상태 어휘를 lookup_values로 시드한다(멱등).
// 입력 = client 상수 customerStatusGroups(현행 진실원본). value=현행 text 그대로.
async function main() {
  const db = getDefaultDb();

  const rows: (typeof lookupValues.$inferInsert)[] = [];
  let groupOrder = 0;
  for (const [group, statuses] of Object.entries(customerStatusGroups)) {
    rows.push({ category: "status_group", value: group, parentValue: null, sortOrder: groupOrder });
    groupOrder += 1;
    statuses.forEach((status, i) => {
      // 같은 status 문자열이 여러 그룹에 중복 존재(예: "추후재컨택")할 수 있다.
      // (category,value) unique라 status는 그룹 간 1행만 살아남는다 — 종속 검증엔
      // "그 status가 어느 그룹에든 속하는 유효값인가" + "둘 다 보낼 때 일치" 수준이라 허용 가능.
      // 정밀 종속(같은 status가 그룹마다 별개)은 후속에서 복합키로 승격.
      rows.push({ category: "status", value: status, parentValue: group, sortOrder: i });
    });
  }

  // 멱등: 이 두 카테고리를 지우고 재삽입. on conflict 무시로 중복 status는 자연 흡수.
  await db
    .delete(lookupValues)
    .where(and(inArray(lookupValues.category, ["status_group", "status"])));
  // 중복 (category,value) 제거 후 삽입(중복 status는 첫 그룹만).
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const k = `${r.category}:${r.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  await db.insert(lookupValues).values(deduped);

  console.log(`seeded lookup_values: ${deduped.length} rows (status_group/status)`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
```

> 주의(종속의 한계): `customerStatusGroups`에는 같은 2차 문자열이 여러 1차에 중복으로 나타난다(예: "추후재컨택"은 관리중·상담완료·불발에, "지속적부재"는 신규·불발에, "구매시기미도래"는 관리중·상담완료에). `(category, value)` unique라 중복 status는 **첫 그룹의 parent로만** 1행 남는다. 이번 파일럿의 검증은 "그 status가 유효한 2차 값인가" + "group·status를 함께 보낼 때 parent 일치"까지를 보장한다. 같은 2차가 그룹마다 별개로 취급돼야 하는 정밀 종속은 후속 슬라이스에서 `(category, value, parent_value)` 복합키로 승격한다(spec의 후속 항목).

- [ ] **Step 2: package.json에 스크립트 추가**

`package.json` scripts에서 `seed:customers` 줄 아래에 추가:

```json
    "seed:lookups": "bun run --env-file=.env.local scripts/seed-lookups.ts",
```

- [ ] **Step 3: 시드 실행**

Run: `bun run seed:lookups`
Expected: `seeded lookup_values: N rows (status_group/status)` 출력(N ≈ 9 그룹 + 중복 제거된 2차 수). 에러 없음.

- [ ] **Step 4: 멱등성 확인(2회째도 동일)**

Run: `bun run seed:lookups`
Expected: 동일한 N 출력. 행 수가 누적되지 않음(delete→insert라 멱등).

- [ ] **Step 5: 커밋**

```bash
git add scripts/seed-lookups.ts package.json
git commit -m "$(cat <<'EOF'
feat(crm): 진행상태 lookup 시드(seed:lookups)

customerStatusGroups 상수 → lookup_values status_group/status 멱등 시드.
중복 2차 문자열은 (category,value) unique로 첫 그룹만 적재(후속 복합키 승격).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 종속 판정 순수 함수 (TDD)

**Files:**
- Create: `src/lib/status-lookup.test.ts`
- Create: `src/lib/status-lookup.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `src/lib/status-lookup.test.ts`:

```ts
import { test, expect } from "bun:test";

import { checkStatusSelection } from "./status-lookup";

const groups = new Set(["신규", "계약완료"]);
const statusParent = new Map<string, string>([
  ["상담접수", "신규"],
  ["출고완료", "계약완료"],
]);

test("변경 없음(둘 다 미입력) → null", () => {
  expect(checkStatusSelection(groups, statusParent, {})).toBeNull();
});

test("유효한 group+status → null", () => {
  expect(checkStatusSelection(groups, statusParent, { statusGroup: "계약완료", status: "출고완료" })).toBeNull();
});

test("group 단독 변경(유효) → null(종속 스킵)", () => {
  expect(checkStatusSelection(groups, statusParent, { statusGroup: "신규" })).toBeNull();
});

test("status 단독 변경(유효) → null(종속 스킵)", () => {
  expect(checkStatusSelection(groups, statusParent, { status: "출고완료" })).toBeNull();
});

test("없는 1차 group → 에러", () => {
  expect(checkStatusSelection(groups, statusParent, { statusGroup: "없음", status: "출고완료" })).toContain("1차");
});

test("없는 2차 status → 에러", () => {
  expect(checkStatusSelection(groups, statusParent, { statusGroup: "계약완료", status: "없음" })).toContain("2차");
});

test("종속 불일치(group ≠ status의 부모) → 에러", () => {
  expect(checkStatusSelection(groups, statusParent, { statusGroup: "신규", status: "출고완료" })).toContain("속하지 않");
});

test("둘 다 null로 클리어 → null", () => {
  expect(checkStatusSelection(groups, statusParent, { statusGroup: null, status: null })).toBeNull();
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test src/lib/status-lookup.test.ts`
Expected: FAIL — `Cannot find module './status-lookup'` 또는 `checkStatusSelection is not a function`.

- [ ] **Step 3: 순수 함수 구현**

Create `src/lib/status-lookup.ts`:

```ts
export type StatusSelection = { statusGroup?: string | null; status?: string | null };

// 진행상태 1차(group)/2차(status) 종속 검증(순수, DB 미접근).
// - group이 오면 active group 집합에 있어야 한다.
// - status가 오면 유효한 2차 값이어야 한다.
// - 둘 다 오면 status의 부모가 group과 일치해야 한다(종속).
// 단독 전송(한쪽만)은 그 값의 유효성만 검증하고 종속은 건너뛴다(기존 PATCH 경로 보존).
// 위반 시 사람이 읽는 에러 메시지, OK면 null.
export function checkStatusSelection(
  activeGroups: ReadonlySet<string>,
  statusParent: ReadonlyMap<string, string>,
  sel: StatusSelection,
): string | null {
  const group = sel.statusGroup;
  const status = sel.status;

  if (group != null && !activeGroups.has(group)) {
    return `유효하지 않은 진행 1차 상태입니다: ${group}`;
  }
  if (status != null) {
    const parent = statusParent.get(status);
    if (parent === undefined) return `유효하지 않은 진행 2차 상태입니다: ${status}`;
    if (group != null && parent !== group) {
      return `진행 2차 상태 "${status}"는 1차 "${group}"에 속하지 않습니다.`;
    }
  }
  return null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun test src/lib/status-lookup.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/status-lookup.ts src/lib/status-lookup.test.ts
git commit -m "$(cat <<'EOF'
feat(crm): 진행상태 종속 판정 순수 함수 checkStatusSelection

group/status 유효성 + 둘 다 올 때 종속 일치 검증(순수, DB 미접근).
단독 전송은 유효성만(기존 PATCH 경로 보존). bun 유닛테스트 8.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 검증 쿼리 모듈 (lookups.ts)

**Files:**
- Create: `src/db/queries/lookups.ts`

- [ ] **Step 1: 쿼리 모듈 작성**

Create `src/db/queries/lookups.ts`:

```ts
import { and, asc, eq, inArray } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { lookupValues } from "../schema";
import { checkStatusSelection, type StatusSelection } from "../../lib/status-lookup";

// 한 카테고리의 active 값 목록(sortOrder 순). 후속 슬라이스의 프론트 소비/관리 UI용.
export async function listLookup(category: string, executor: Executor = getDefaultDb()) {
  return executor
    .select()
    .from(lookupValues)
    .where(and(eq(lookupValues.category, category), eq(lookupValues.active, true)))
    .orderBy(asc(lookupValues.sortOrder));
}

// 진행상태 PATCH 종속 검증. status 관련 값이 없으면 DB 왕복 없이 통과(null).
// 있으면 active 값을 1쿼리로 읽어 순수 함수에 위임. 위반 시 에러 메시지(400 본문), OK면 null.
export async function validateStatusSelection(
  sel: StatusSelection,
  executor: Executor = getDefaultDb(),
): Promise<string | null> {
  if (sel.statusGroup == null && sel.status == null) return null;
  const rows = await executor
    .select({
      category: lookupValues.category,
      value: lookupValues.value,
      parentValue: lookupValues.parentValue,
    })
    .from(lookupValues)
    .where(and(inArray(lookupValues.category, ["status_group", "status"]), eq(lookupValues.active, true)));
  const activeGroups = new Set(rows.filter((r) => r.category === "status_group").map((r) => r.value));
  const statusParent = new Map(
    rows.filter((r) => r.category === "status").map((r) => [r.value, r.parentValue ?? ""] as const),
  );
  return checkStatusSelection(activeGroups, statusParent, sel);
}
```

- [ ] **Step 2: 타입 점검**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: 커밋**

```bash
git add src/db/queries/lookups.ts
git commit -m "$(cat <<'EOF'
feat(crm): lookup 쿼리 모듈(listLookup, validateStatusSelection)

status 값 있을 때만 lookup 1쿼리로 읽어 순수 함수 위임(없으면 왕복 0).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 라우트 PATCH 검증 연결 + 서버 테스트

**Files:**
- Modify: `src/routes/customers.ts:5-16`(import), `:43-48`(PATCH 핸들러)
- Modify: `src/routes/customers.test.ts`(테스트 추가)

- [ ] **Step 1: 실패 테스트 추가**

`src/routes/customers.test.ts` 맨 끝에 추가한다(기존 import에 `customerWriteSchema`·`getDefaultDb` 이미 있음). 실제 master DB에 시드된 진행상태 lookup(Task 2)을 전제로, 기존 고객을 잘못/올바른 진행상태로 PATCH한다. 비파괴를 위해 원래 값으로 복원한다.

```ts
test("진행상태 검증: 종속 안 맞는 status → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  // 신규 그룹에 속하지 않는 "출고완료"(계약완료 소속) → 종속 위반.
  const res = await app.request(`/api/customers/${cid}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ statusGroup: "신규", status: "출고완료" }),
  });
  expect(res.status).toBe(400);
});

test("진행상태 검증: 없는 status → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const res = await app.request(`/api/customers/${list[0].id}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ statusGroup: "계약완료", status: "존재하지않는상태" }),
  });
  expect(res.status).toBe(400);
});

test("진행상태 검증: 유효한 group+status → 200(원복)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; statusGroup: string | null; status: string | null }>;
  const target = list[0];
  try {
    const res = await app.request(`/api/customers/${target.id}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ statusGroup: "계약완료", status: "출고완료" }),
    });
    expect(res.status).toBe(200);
  } finally {
    // 원래 값으로 복원(공유 master DB).
    await app.request(`/api/customers/${target.id}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ statusGroup: target.statusGroup, status: target.status }),
    });
  }
});

test("진행상태 검증: status 키 없는 PATCH는 검증 건너뜀 → 200", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; source: string | null }>;
  const target = list[0];
  const res = await app.request(`/api/customers/${target.id}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ source: target.source }),
  });
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test src/routes/customers.test.ts --env-file=.env.local`
Expected: 새 테스트 중 "종속 안 맞는 status → 400", "없는 status → 400"이 FAIL(현재 검증이 없어 200이 돌아옴). 나머지 200 케이스는 통과.

- [ ] **Step 3: 라우트에 검증 연결**

`src/routes/customers.ts` import 블록(5-16행)에 추가:

```ts
import { validateStatusSelection } from "../db/queries/lookups";
```

PATCH 핸들러(43-48행)를 교체:

```ts
customers.patch(
  "/:id",
  zValidator("param", z.object({ id: z.uuid() })),
  zValidator("json", customerWriteSchema),
  async (c) => {
    const patch = c.req.valid("json");
    // 진행상태(1차/2차) 키가 올 때만 lookup 종속 검증. 그 외엔 추가 왕복 0.
    if (patch.statusGroup !== undefined || patch.status !== undefined) {
      const error = await validateStatusSelection(
        { statusGroup: patch.statusGroup, status: patch.status },
        c.var.db,
      );
      if (error) return c.json({ error }, 400);
    }
    return run(c, () => updateCustomer(c.req.valid("param").id, patch, c.var.db), "고객을 찾을 수 없습니다.");
  },
);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun test src/routes/customers.test.ts --env-file=.env.local`
Expected: 새 테스트 4개 모두 PASS. 기존 테스트도 전부 PASS(특히 "PATCH 같은 값 비파괴 → 200"는 status 키가 없어 검증 스킵).

- [ ] **Step 5: 커밋**

```bash
git add src/routes/customers.ts src/routes/customers.test.ts
git commit -m "$(cat <<'EOF'
feat(crm): customers PATCH에 진행상태 lookup 종속 검증 연결

status_group/status 키가 올 때만 validateStatusSelection 호출, 위반 400.
서버 테스트 4(종속불일치·없는status·유효200·키없음200).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 최종 검증 + spec 정정 + PR

**Files:**
- Modify: `ref/specs/2026-06-26-crm-enum-lookup-status-pilot-design.md`(검증 러너·단독 케이스 한 줄 정정)

- [ ] **Step 1: spec 정정**

spec의 "검증 계획" 섹션에서 순수 함수 테스트를 `test:unit` → `test:server(bun)`로 바꾸고, 검증 섹션의 종속 설명에 "단독 전송은 유효성만, 둘 다면 종속까지"를 한 줄 반영한다(plan과 일치). 구현 결과와 어긋나지 않게만 맞추면 됨.

- [ ] **Step 2: 검증 4종 + 서버 테스트**

```bash
bun run typecheck   # 0
bun run lint        # 0 problems
bun run test:unit   # 기존 그대로 통과(이 슬라이스는 client 무변경)
bun run test:server # 기존 + 신규(status-lookup 8 + customers 라우트 4) 통과
bun run build       # OK
```

Expected: 전부 통과. `test:server`는 시드된 lookup(Task 2)을 전제로 함.

- [ ] **Step 3: spec 정정 커밋**

```bash
git add ref/specs/2026-06-26-crm-enum-lookup-status-pilot-design.md
git commit -m "$(cat <<'EOF'
docs(crm): lookup 파일럿 spec 검증 러너·단독 종속 케이스 정정

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: 푸시 + PR 생성(사용자 확인 후)**

```bash
git push -u origin feat/crm-lookup-status-pilot
gh pr create --title "feat(crm): enum/lookup 진행상태 파일럿 (lookup_values + PATCH 종속 검증)" --body "$(cat <<'EOF'
## 요약
crm에 단일 `lookup_values` 테이블 도입 + `customers` PATCH 진행상태(status_group→status) 종속 검증.

- `crm.lookup_values`(category/value/label/parent_value/sort_order/active), 마이그레이션 `0005`(crm only·additive).
- `value`=현행 text 그대로 → customers 컬럼·기존 데이터 무변경.
- 종속 판정 순수 함수(`checkStatusSelection`) + lookup 1쿼리 검증(status 키 올 때만).
- 시드 `seed:lookups`(customerStatusGroups → lookup, 멱등).

## 범위 밖(후속)
프론트 `customerStatusGroups` → API 동적 소비, 나머지 도메인 lookup화, 기술값 enum, 서류 title/doc_type 정리, 관리 UI.

## ⚠️ 제품 결정 확인
lookup 도입·풀 관리 UI 보류 방향이 이사님 의중과 맞는지 최종 확인 필요(spec 명시).

## 검증
typecheck 0 · lint 0 · test:unit · test:server(+status-lookup 8·customers 4) · build OK.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

> 커밋/푸시/PR은 CLAUDE.md 규약상 사용자 지시 시 진행. squash 머지 시 커밋 메시지에 skip-ci 토큰 금지.

---

## Self-review 메모

- **Spec 커버리지**: 데이터 모델(Task1) / 검증·종속(Task3·4·5) / 시드(Task2) / 마이그레이션(Task1) / SSOT·caveat(시드가 상수 기반, Task2 주석) / perf(검증 조건부 1쿼리, Task4·5) — 전부 태스크에 매핑됨.
- **종속 중복 한계**: `customerStatusGroups`의 중복 2차 문자열은 (category,value) unique로 1행만 남음 → 이번 파일럿 검증 범위(유효성 + 둘 다 보낼 때 일치)에선 허용, 정밀 종속은 후속 복합키로 승격(Task2 주석·spec 후속).
- **타입 일관성**: `StatusSelection`, `checkStatusSelection(activeGroups, statusParent, sel)`, `validateStatusSelection(sel, executor)`, `listLookup(category, executor)` — Task 3·4·5에서 시그니처 일치.
