# 고객 수기 등록 구현 계획 (2026-07-10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객 목록 헤드바 `[+ 고객 등록]` 목업 버튼을 실동작으로 — `POST /api/customers` 신설 + 최소 폼 팝오버(이름·연락처·유입 경로) + 저장 즉시 새 고객 상세 드로어 자동 오픈.

**Architecture:** 승격 패턴 미러(코드 비공유 — spec 확정 결정 4). 서버가 채번(`nextCustomerCode`)·시드(신규/상담접수/receivedAt)·등록자 자동 배정(`getStaffName`)을 트랜잭션 안에서 처리하고 커밋 후 `customer_profile` 임베딩을 스케줄. 클라는 팝오버 폼(삭제 확인창 문법) → POST → `reloadCustomers()` + 드로어 URL 내비게이션(드로어는 URL이 single source라 목록 도착 시 자동 오픈).

**Tech Stack:** Hono + zod + drizzle(실 master) / React + vitest / bun:test(`bun run test:server` — 직접 `bun test` 금지).

**Spec:** `ref/specs/2026-07-10-crm-customer-create-design.md` (충돌 시 spec이 우선)

**브랜치:** `feat/crm-customer-create` (생성됨, spec 커밋 `03ce278`)

**⚠️ 공통 함정 (모든 태스크 적용):**
- 서버 테스트는 반드시 `bun run test:server <파일>` — 직접 `bun test <파일>` 금지(EMBED_ON_WRITE·PUSH_NOTIFY 프리픽스가 npm 스크립트에 있다. 이걸 우회해 실 Gemini 호출+master 오염 14행 낸 실사고가 있었다).
- 실 master DB다. 실 행을 만드는 테스트는 반드시 ①트랜잭션 롤백 또는 ②try/finally 삭제 + 픽스처 registry 등록.
- 커밋 메시지에 `[skip ci]` 계열 토큰 절대 금지(squash 전파로 CF 배포 스킵 사고 2회).
- DB 테스트 소스에 미등록 `CU-`/`QT-`/`PUSH-` 리터럴을 적으면 `fixture-codes.test.ts` 계약 스캔이 실패한다. 실채번 형식 단언은 정규식(`/^CU-\d{4}-\d{4}$/`)으로만.

---

## 파일 구조

| 파일 | 역할 | 작업 |
|---|---|---|
| `src/test-utils/fixture-codes.ts` | 픽스처 registry — `TEST_CUSTOMER_NAMES` 추가 | Task 1 |
| `src/test-utils/fixture-residue.ts` | 잔재 스캔 — 이름 조건 추가(`customerResidueWhere`) | Task 1 |
| `src/test-utils/fixture-residue.test.ts` | 이름 검출 프로브(롤백) | Task 1 |
| `src/scripts/check-test-residue.ts` | `--clean`도 이름 조건 사용 | Task 1 |
| `src/db/queries/customers.ts` | `createCustomerManual` 신설 | Task 2 |
| `src/db/queries/customers.create.test.ts` | 쿼리 테스트(트랜잭션 롤백 — 잔재 0) | Task 2 |
| `src/routes/customers.ts` | `POST /` 라우트 신설 | Task 3 |
| `src/routes/customers.create.test.ts` | 라우트 테스트(403/400/성공/미배정) | Task 3 |
| `client/src/lib/customer-create.ts` | 순수 함수(`sanitizePhoneDigits`·`findPhoneDuplicate`) | Task 4 |
| `client/src/lib/customer-create.test.ts` | 순수 함수 유닛 | Task 4 |
| `client/src/lib/customers.ts` | `createCustomer` API 함수 | Task 5 |
| `client/src/pages/CustomerManagementPage.tsx` | 폼 팝오버 + 버튼 배선 + `onCustomerCreated` prop | Task 6 |
| `client/src/styles/customer-console.css` | `.customer-create-*` 스타일 | Task 6 |
| `client/src/App.tsx` | `handleCustomerCreated` 배선 | Task 7 |

---

### Task 1: 잔재 tripwire 확장 — 실채번 픽스처를 이름으로 잡는다

**왜 먼저:** Task 3의 라우트 성공 테스트가 실채번(`CU-2607-####`) 고객을 만든다. 실행이 끊겨 남으면 기존 tripwire(코드 접두사 registry)가 못 본다 — 07-09 유령 행과 같은 사각. 이름 리터럴 registry를 먼저 깔아야 Task 3이 안전하다.

**Files:**
- Modify: `src/test-utils/fixture-codes.ts`
- Modify: `src/test-utils/fixture-residue.ts`
- Modify: `src/test-utils/fixture-residue.test.ts`
- Modify: `src/scripts/check-test-residue.ts`

- [ ] **Step 1: 실패하는 프로브 테스트 작성**

`src/test-utils/fixture-residue.test.ts` 끝의 주석(`// "실채번 코드를 잔재로 오인하지 않는다"는…`) 앞에 추가:

```ts
test("검사기: 실채번 코드여도 등록된 픽스처 이름이면 잡는다(트랜잭션 롤백)", async () => {
  const baseline = residueCount(await scanFixtureResidue(db));

  await db
    .transaction(async (tx) => {
      // 코드는 어떤 registry 접두사와도 무관한 값 — 이름이 유일한 검출 경로임을 증명한다.
      // (POST /api/customers 라우트 테스트가 만드는 실채번 픽스처가 정확히 이 모양이다.)
      await tx.execute(sql`insert into crm.customers (customer_code, name) values ('RESIDUE-NAME-PROBE', '수기등록테스트')`);
      const after = await scanFixtureResidue(tx as unknown as typeof db);
      expect(after.customers.map((c) => c.name)).toContain("수기등록테스트");
      expect(residueCount(after)).toBe(baseline + 1);
      throw new Error("rollback"); // 심은 행을 남기지 않는다
    })
    .catch((e: unknown) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });

  const restored = await scanFixtureResidue(db);
  expect(residueCount(restored)).toBe(baseline);
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:server src/test-utils/fixture-residue.test.ts`
Expected: FAIL — `after.customers.map(...)` 에 "수기등록테스트" 없음(스캔이 코드 접두사만 봄). 기존 테스트 2개는 PASS 유지.

- [ ] **Step 3: registry에 이름 추가**

`src/test-utils/fixture-codes.ts`의 `TEST_QUOTE_CODE_PREFIXES` 선언 뒤에 추가:

```ts
// 실채번 픽스처의 **이름** registry — 서버가 코드를 채번해 접두사를 제어할 수 없는 테스트용.
// POST /api/customers 라우트 테스트(routes/customers.create.test.ts)가 첫 사례:
// 코드가 CU-YYMM-####(실채번)라 위 접두사 registry로는 잔재를 못 잡는다. 이름이 잡는다.
export const TEST_CUSTOMER_NAMES = ["수기등록테스트"] as const;
```

- [ ] **Step 4: 스캔에 이름 조건 추가**

`src/test-utils/fixture-residue.ts`:

import 갱신:

```ts
import { prefixRegex, TEST_CUSTOMER_CODE_PREFIXES, TEST_CUSTOMER_NAMES, TEST_QUOTE_CODE_PREFIXES } from "./fixture-codes";
```

`QUOTE_CODE_REGEX` 선언 뒤에 공유 조건 추가(검사와 정리가 같은 조건을 본다 — 이 파일의 기존 철학):

```ts
// 고객 잔재 판정 — 코드 접두사 or 등록된 픽스처 이름. 실채번 픽스처(POST 라우트 테스트)는
// 코드가 CU-YYMM-####라 접두사로 못 잡는다 — 이름이 잡는다. scan과 check-test-residue --clean이 공유.
export function customerResidueWhere() {
  const names = sql.join(TEST_CUSTOMER_NAMES.map((n) => sql`${n}`), sql`, `);
  return sql`customer_code ~ ${CUSTOMER_CODE_REGEX} or name in (${names})`;
}
```

`scanFixtureResidue`의 customers 쿼리를 교체:

```ts
  const customers = await asRows<{ customer_code: string; name: string; created_at: string }>(sql`
    select customer_code, name, created_at::text from crm.customers
    where ${customerResidueWhere()} order by created_at`);
```

- [ ] **Step 5: `--clean`도 같은 조건 사용**

`src/scripts/check-test-residue.ts`:

import에 `customerResidueWhere` 추가(최종):

```ts
import {
  CUSTOMER_CODE_REGEX, customerResidueWhere, formatResidue, QUOTE_CODE_REGEX, residueCount, scanFixtureResidue,
} from "../test-utils/fixture-residue";
```

트랜잭션 블록을 아래 최종본으로 교체:

```ts
// crm.quotes → customers FK는 NO ACTION이라 견적을 먼저 지운다. 자식 5종과 임베딩은 CASCADE.
// customer_deletions는 두 조건으로 지운다: ①이름 잔재 고객의 감사 행(서브셀렉트 — customers delete보다
// 먼저 와야 한다) ②코드 정규식(감사 행은 고객 행이 이미 없어도 남는다 — 기존 조건 유지).
await db.transaction(async (tx) => {
  await tx.execute(sql`delete from crm.quotes where quote_code ~ ${QUOTE_CODE_REGEX}`);
  await tx.execute(sql`delete from crm.quotes where customer_id in (select id from crm.customers where ${customerResidueWhere()})`);
  await tx.execute(sql`delete from crm.customer_deletions where customer_code in (select customer_code from crm.customers where ${customerResidueWhere()})`);
  await tx.execute(sql`delete from crm.customers where ${customerResidueWhere()}`);
  await tx.execute(sql`delete from crm.customer_deletions where customer_code ~ ${CUSTOMER_CODE_REGEX}`);
});
```

- [ ] **Step 6: 통과 확인**

Run: `bun run test:server src/test-utils/fixture-residue.test.ts src/test-utils/fixture-codes.test.ts`
Expected: 전부 PASS (프로브가 이름으로 검출 + 기존 계약 스캔 무영향).

Run: `bun run check:residue`
Expected: `[residue] 테스트 픽스처 잔재 없음 ✅` exit 0.

- [ ] **Step 7: 커밋**

```bash
git add src/test-utils/fixture-codes.ts src/test-utils/fixture-residue.ts src/test-utils/fixture-residue.test.ts src/scripts/check-test-residue.ts
git commit -m "test(crm): 잔재 tripwire에 픽스처 이름 registry 추가 — 실채번 픽스처 사각 대응"
```

---

### Task 2: 서버 쿼리 `createCustomerManual`

**Files:**
- Modify: `src/db/queries/customers.ts`
- Create: `src/db/queries/customers.create.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/db/queries/customers.create.test.ts` 생성:

```ts
import { expect, test } from "bun:test";

import { getDefaultDb } from "../client";
import { createCustomerManual } from "./customers";

const db = getDefaultDb();

// 실 master지만 전 케이스 트랜잭션 롤백 — 잔재 0 (fixture-residue.test.ts 검사기 검증과 같은 패턴).
// advisor id는 loose id(FK 없음)라 임의 uuid로 충분하다.
const ADVISOR = { id: "3f6a7f7e-90d1-4f7a-b6a1-000000000001", name: "테스트상담사" };

function rollbackOnly(e: unknown): void {
  if (!(e instanceof Error) || e.message !== "rollback") throw e;
}

test("createCustomerManual: 채번 형식 + 시드 3필드 + 등록자 자동 배정", async () => {
  await db
    .transaction(async (tx) => {
      const row = await createCustomerManual(
        { name: "수기등록테스트", phone: "01099887766", source: "소개", advisor: ADVISOR },
        tx,
      );
      expect(row.customerCode).toMatch(/^CU-\d{4}-\d{4}$/);
      expect(row.name).toBe("수기등록테스트");
      expect(row.phone).toBe("01099887766");
      expect(row.source).toBe("소개");
      // 승격과 같은 시드 — 신규 고객은 목록 "신규/상담접수"로 나타난다.
      expect(row.statusGroup).toBe("신규");
      expect(row.status).toBe("상담접수");
      expect(row.receivedAt).not.toBeNull();
      // 자동 배정 — 이름·id·배정시각 동반(PATCH의 "이름과 id 동반" 규칙과 정합).
      expect(row.advisorId).toBe(ADVISOR.id);
      expect(row.advisorName).toBe(ADVISOR.name);
      expect(row.assignedAt).not.toBeNull();
      throw new Error("rollback");
    })
    .catch(rollbackOnly);
});

test("createCustomerManual: advisor null이면 미배정으로 생성(fail-open)", async () => {
  await db
    .transaction(async (tx) => {
      const row = await createCustomerManual({ name: "수기등록테스트", advisor: null }, tx);
      expect(row.advisorId).toBeNull();
      expect(row.advisorName).toBeNull();
      expect(row.assignedAt).toBeNull();
      expect(row.phone).toBeNull();
      expect(row.source).toBeNull();
      throw new Error("rollback");
    })
    .catch(rollbackOnly);
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:server src/db/queries/customers.create.test.ts`
Expected: FAIL — `createCustomerManual` export 없음.

- [ ] **Step 3: 구현**

`src/db/queries/customers.ts`:

import에 `nextCustomerCode` 추가(순환 없음 — `quote-requests.ts`는 queries/customers.ts를 import하지 않는다. `consultations.ts` 선례):

```ts
import { nextCustomerCode } from "./quote-requests";
```

`updateCustomer` 함수 앞(또는 뒤)에 추가:

```ts
export type CustomerCreateInput = {
  name: string;
  phone?: string | null;
  source?: string | null;
  /** 등록자 자동 배정 — null이면 미배정 생성(라우트가 getStaffName 실패 시 null을 넘긴다). */
  advisor?: { id: string; name: string } | null;
};

// 수기 등록 INSERT — 승격(createCustomerFromRequest/FromConsultation)과 시드 3필드(신규/상담접수/receivedAt)가
// 같지만 코드는 공유하지 않는다(각 경로의 입력 해석이 전부 다름 — spec 확정 결정 4).
// 라우트가 트랜잭션으로 감싸 호출한다(채번+INSERT 원자성 — 승격 라우트 동일).
export async function createCustomerManual(
  input: CustomerCreateInput,
  ex: Executor = getDefaultDb(),
): Promise<typeof customers.$inferSelect> {
  const customerCode = await nextCustomerCode(ex);
  const now = new Date();
  const [row] = await ex
    .insert(customers)
    .values({
      customerCode,
      name: input.name,
      phone: input.phone ?? null,
      source: input.source ?? null,
      statusGroup: "신규",
      status: "상담접수",
      receivedAt: now,
      // 이름·id·배정시각 동반 세팅 — 이름만 갈리고 구 id가 남는 스테일(타 상담사 scope 오염) 방지 규칙.
      ...(input.advisor ? { advisorId: input.advisor.id, advisorName: input.advisor.name, assignedAt: now } : {}),
    })
    .returning();
  return row;
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:server src/db/queries/customers.create.test.ts`
Expected: PASS 2건.

Run: `bun run check:residue`
Expected: 잔재 없음 ✅ (롤백 검증).

- [ ] **Step 5: 커밋**

```bash
git add src/db/queries/customers.ts src/db/queries/customers.create.test.ts
git commit -m "feat(crm): createCustomerManual 쿼리 — 채번+시드+등록자 자동 배정 (수기 등록 서버 절반)"
```

---

### Task 3: `POST /api/customers` 라우트

**Files:**
- Modify: `src/routes/customers.ts`
- Create: `src/routes/customers.create.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/routes/customers.create.test.ts` 생성:

```ts
import { afterEach, expect, test } from "bun:test";
import { eq, isNotNull } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { profiles } from "../db/public-app";
import { customers } from "../db/schema";

const db = getDefaultDb();

// 성공 케이스는 실 INSERT를 만든다. 코드가 실채번(CU-YYMM-####)이라 접두사 registry로 못 잡는다 —
// 이름 "수기등록테스트"가 TEST_CUSTOMER_NAMES에 등록돼 있어(Task 1), 여기서 못 지우고 남아도
// 다음 test:server의 잔재 검사가 잡는다. 정상 경로는 afterEach가 지운다.
const FIXTURE_NAME = "수기등록테스트";
const createdIds: string[] = [];

afterEach(async () => {
  for (const id of createdIds.splice(0)) await db.delete(customers).where(eq(customers.id, id));
});

// 자동 배정 검증에는 full_name이 실제로 있는 profiles 행이 필요하다(실 master 전제 — CRM 스태프 계정 상존).
async function anyNamedProfile(): Promise<{ id: string; name: string }> {
  const rows = await db
    .select({ id: profiles.id, name: profiles.fullName })
    .from(profiles)
    .where(isNotNull(profiles.fullName))
    .limit(10);
  const hit = rows.find((r) => r.name?.trim());
  if (!hit) throw new Error("full_name 있는 profiles가 없어 테스트 불가(실 master DB 전제)");
  return { id: hit.id, name: hit.name!.trim() };
}

async function post(role: string, sub: string, body: unknown): Promise<Response> {
  const { token, keyResolver, issuer } = await makeTestAuth(role, sub);
  const app = createApp({ keyResolver, issuer });
  return app.request("/api/customers", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST /api/customers — dealer는 403 (fail-closed)", async () => {
  const res = await post("dealer", crypto.randomUUID(), { name: FIXTURE_NAME });
  expect(res.status).toBe(403);
});

test("POST /api/customers — 이름 공백은 400", async () => {
  const res = await post("staff", crypto.randomUUID(), { name: "   " });
  expect(res.status).toBe(400);
});

test("POST /api/customers — 자동 유입 어휘는 400 (앱 유입 통계 오염 차단)", async () => {
  const res = await post("staff", crypto.randomUUID(), { name: FIXTURE_NAME, source: "앱 견적요청" });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("유입 경로");
});

test("POST /api/customers — 성공: 채번·시드·등록자 자동 배정, 201", async () => {
  const advisor = await anyNamedProfile();
  const res = await post("staff", advisor.id, { name: FIXTURE_NAME, phone: "01098765432", source: "소개" });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; customerCode: string };
  createdIds.push(body.id);
  expect(body.customerCode).toMatch(/^CU-\d{4}-\d{4}$/);

  const [row] = await db.select().from(customers).where(eq(customers.id, body.id));
  expect(row.name).toBe(FIXTURE_NAME);
  expect(row.phone).toBe("01098765432");
  expect(row.source).toBe("소개");
  expect(row.statusGroup).toBe("신규");
  expect(row.status).toBe("상담접수");
  expect(row.receivedAt).not.toBeNull();
  expect(row.advisorId).toBe(advisor.id);
  expect(row.advisorName).toBe(advisor.name);
  expect(row.assignedAt).not.toBeNull();
});

test("POST /api/customers — 프로필 이름 해석 실패면 미배정으로 생성(fail-open)", async () => {
  const res = await post("staff", crypto.randomUUID(), { name: FIXTURE_NAME });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  createdIds.push(body.id);

  const [row] = await db.select().from(customers).where(eq(customers.id, body.id));
  expect(row.advisorId).toBeNull();
  expect(row.advisorName).toBeNull();
  expect(row.assignedAt).toBeNull();
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:server src/routes/customers.create.test.ts`
Expected: FAIL — POST 라우트 없음(404).

- [ ] **Step 3: 라우트 구현**

`src/routes/customers.ts`:

import 3개 추가:

```ts
import { createCustomerManual, getCustomer, getCustomerAdvisorName, getCustomerAppUserId, listCustomers, updateCustomer, type CustomerWritePatch } from "../db/queries/customers";
import { getStaffName } from "../db/queries/staff";
import { SOURCE_MANUAL_OPTIONS } from "../../client/src/data/customers";
```

(`client/src/data/customers` 서버 import는 확립된 순수 상수 경계 — `schema.ts`·`quote-requests.ts` 선례.)

`customerWriteSchema` 선언 뒤에 body 스키마 추가:

```ts
// 수기 등록 body — 최소 폼(이름·연락처·유입 경로)만. 나머지 필드는 등록 직후 상세 드로어에서
// 기존 PATCH 경로로 입력한다(spec 확정 결정 1 — 폼 중복 제로).
const customerCreateSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().nullable().optional(), // 클라가 숫자만 전송(DB 규칙). PATCH와 동일하게 서버 정규화 없음.
  source: z.string().nullable().optional(),
});
```

`customers.get("/", …)` 라인 바로 뒤에 라우트 추가:

```ts
// ── 고객 수기 등록(전화·소개 유입 — 앱 승격 외 유일한 생성 경로) ────
// spec: ref/specs/2026-07-10-crm-customer-create-design.md
// dealer는 fail-closed — 역할 scope(resolveCustomerScope)에서 dealer가 아무것도 못 보는 것과 정합.
// 서버가 진짜 게이트다(프론트 버튼 숨김은 UX 보조 — DELETE 라우트와 같은 원칙).
customers.post("/", zValidator("json", customerCreateSchema), async (c) => {
  if (c.var.user.role === "dealer") return c.json({ error: "권한이 없습니다." }, 403);
  const body = c.req.valid("json");
  // 수동 유입 어휘만 — 자동 어휘("앱 견적요청" 등)를 수기 등록이 쓰면 앱 유입 통계가 오염된다.
  // (validateLookupValue("source")는 자동 어휘까지 포함한 전체 SOURCE_OPTIONS를 보므로 쓰지 않는다.)
  if (body.source != null && !SOURCE_MANUAL_OPTIONS.includes(body.source)) {
    return c.json({ error: "유입 경로가 올바르지 않습니다." }, 400);
  }
  // 등록자 본인 자동 배정 — 이름 해석 실패(프로필 없음·공란)면 미배정으로 생성(fail-open).
  // 등록이 프로필 이름 부재로 막히는 게 더 나쁘다. 자기 배정이라 배정 알림 경로는 없다.
  const staffName = await getStaffName(c.var.user.id, c.var.db);
  const advisor = staffName ? { id: c.var.user.id, name: staffName } : null;
  const row = await c.var.db.transaction((tx) => createCustomerManual({ ...body, advisor }, tx));
  // 프로필 청크 재임베딩 — source·advisorName이 구성 필드(CUSTOMER_PROFILE_EMBED_KEYS).
  // 트랜잭션 resolve(=커밋) 후 스케줄(견적 생성 라우트와 동일 — 훅의 fresh read가 커밋 전 구값을 보는 것 방지).
  scheduleEmbedOnWrite(c, { sourceType: "customer_profile", sourceId: row.id });
  return c.json(row, 201);
});
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:server src/routes/customers.create.test.ts`
Expected: PASS 5건.

Run: `bun run check:residue`
Expected: 잔재 없음 ✅ (afterEach 정리 검증).

- [ ] **Step 5: 커밋**

```bash
git add src/routes/customers.ts src/routes/customers.create.test.ts
git commit -m "feat(crm): POST /api/customers — 고객 수기 등록 라우트 (dealer 403·수동 어휘 게이트·자동 배정·프로필 임베딩)"
```

---

### Task 4: 클라 순수 함수 — 전화 정규화 + 중복 판정

**Files:**
- Create: `client/src/lib/customer-create.ts`
- Create: `client/src/lib/customer-create.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`client/src/lib/customer-create.test.ts` 생성:

```ts
import { describe, expect, it } from "vitest";

import { findPhoneDuplicate, sanitizePhoneDigits } from "./customer-create";

describe("sanitizePhoneDigits", () => {
  it("하이픈·공백·문자를 걷어내고 숫자만 남긴다", () => {
    expect(sanitizePhoneDigits("010-9588-0812")).toBe("01095880812");
    expect(sanitizePhoneDigits(" 010 9588 0812 ")).toBe("01095880812");
    expect(sanitizePhoneDigits("")).toBe("");
  });
});

describe("findPhoneDuplicate", () => {
  const rows = [
    { name: "김민준", customerId: "CU-2605-0020", phone: "010-9588-0812" },
    { name: "박서연", customerId: "CU-2605-0019", phone: "010-9588-0813" },
  ];

  it("포맷이 달라도 숫자 기준으로 같은 번호 첫 고객을 찾는다", () => {
    expect(findPhoneDuplicate(rows, "01095880812")).toEqual({ name: "김민준", customerId: "CU-2605-0020" });
    expect(findPhoneDuplicate(rows, "010-9588-0813")).toEqual({ name: "박서연", customerId: "CU-2605-0019" });
  });

  it("일치가 없으면 null", () => {
    expect(findPhoneDuplicate(rows, "010-0000-0000")).toBeNull();
  });

  it("숫자 10자리 미만은 null — 타이핑 중 조기 경고 방지", () => {
    expect(findPhoneDuplicate(rows, "010-9588")).toBeNull();
    expect(findPhoneDuplicate(rows, "")).toBeNull();
  });

  it("빈 목록이면 null", () => {
    expect(findPhoneDuplicate([], "010-9588-0812")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/customer-create.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`client/src/lib/customer-create.ts` 생성:

```ts
import type { Customer } from "@/data/customers";

// 제출용 전화번호 — DB는 숫자만 저장한다(lib/customers.ts formatPhone 주석의 계약).
export function sanitizePhoneDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

// 연락처 중복 소프트 경고 — 목록(이미 클라에 전체 로드)에서 같은 번호 첫 고객을 찾는다.
// 등록을 막지 않는다(가족 공유 번호·법인 대표번호 등 실무 예외 — spec 확정 결정 3).
// 숫자 10자리 미만은 null: 타이핑 중 접두 일치로 조기 경고가 뜨는 것 방지.
export function findPhoneDuplicate(
  customers: readonly Pick<Customer, "name" | "customerId" | "phone">[],
  phone: string,
): { name: string; customerId: string } | null {
  const digits = sanitizePhoneDigits(phone);
  if (digits.length < 10) return null;
  const hit = customers.find((c) => sanitizePhoneDigits(c.phone) === digits);
  return hit ? { name: hit.name, customerId: hit.customerId } : null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit client/src/lib/customer-create.test.ts`
Expected: PASS 6건.

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/customer-create.ts client/src/lib/customer-create.test.ts
git commit -m "feat(crm): 고객 등록 폼용 순수 함수 — 전화 숫자 정규화 + 중복 소프트 경고 판정"
```

---

### Task 5: 클라 API 함수 `createCustomer`

**Files:**
- Modify: `client/src/lib/customers.ts`

- [ ] **Step 1: 구현** (fetch 래퍼 — 레포 관례상 단독 유닛 없음, Task 6과 함께 typecheck로 검증)

`client/src/lib/customers.ts`의 `deleteCustomer` 함수 뒤에 추가:

```ts
export type CustomerCreateInput = { name: string; phone: string | null; source: string | null };

// 고객 수기 등록 — 채번·시드·등록자 자동 배정은 전부 서버가 처리한다.
// 반환에서 customerCode만 소비한다(등록 직후 드로어 URL 이동용 — 드로어는 URL이 single source).
export async function createCustomer(input: CustomerCreateInput): Promise<{ customerCode: string }> {
  return sendJson<{ customerCode: string }>("/api/customers", "POST", input);
}
```

import 라인 확인: `sendJson`이 `./http` import에 없으면 추가 —

```ts
import { getJson, sendJson, sendVoid } from "./http";
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: 커밋**

```bash
git add client/src/lib/customers.ts
git commit -m "feat(crm): createCustomer API 함수 (POST /api/customers 클라 배선)"
```

---

### Task 6: 폼 팝오버 — `[+ 고객 등록]` 버튼 실동작

**Files:**
- Modify: `client/src/pages/CustomerManagementPage.tsx`
- Modify: `client/src/styles/customer-console.css`

- [ ] **Step 1: 페이지에 상태·핸들러·prop 추가**

`client/src/pages/CustomerManagementPage.tsx`:

① import 갱신 — 3번 라인의 `@/data/customers` import에 `SOURCE_MANUAL_OPTIONS` 추가, lib import 2줄 추가:

```ts
import { APP_QUOTE_REQUEST_SOURCE, CHANCE_OPTIONS, CUSTOMER_MANAGE_STATUSES, SOURCE_MANUAL_OPTIONS, type Customer, type CustomerChanceOption, type CustomerManageStatus, type CustomerMode, customerStatusGroups, initialCustomers } from "@/data/customers";
import { createCustomer, prefetchCustomerDetail } from "@/lib/customers";
import { findPhoneDuplicate, sanitizePhoneDigits } from "@/lib/customer-create";
```

(기존 `import { prefetchCustomerDetail } from "@/lib/customers";` 라인을 위처럼 교체.)

② props 타입(`CustomerManagementPageProps`)에 추가 — `onOpenCustomer` 아래:

```ts
  // 수기 등록 성공 후 App이 목록 리로드 + 드로어 URL 이동을 처리한다(customerCode 전달).
  onCustomerCreated?: (customerCode: string) => void;
```

함수 시그니처 구조분해에도 `onCustomerCreated,` 추가 (`onOpenCustomer,` 뒤).

③ 상태 — `const [deleteNotice, setDeleteNotice] = useState<string | null>(null);` 뒤에 추가:

```ts
  // 고객 수기 등록 — dealer는 서버가 403으로 막는다(진짜 게이트). 여기 숨김은 UX 보조.
  const canCreateCustomers = roleTab !== "딜러";
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createSource, setCreateSource] = useState<string>(SOURCE_MANUAL_OPTIONS[0]);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
```

④ 핸들러 — `deleteSelected` 함수 뒤에 추가:

```ts
  // 연락처 중복 소프트 경고 — 등록을 막지 않는다(가족 공유 번호 등 실무 예외).
  const createDuplicate = creatingOpen ? findPhoneDuplicate(customers, createPhone) : null;

  async function submitCreateCustomer() {
    if (createSubmitting) return;
    const name = createName.trim();
    if (!name) {
      setCreateError("이름을 입력하세요.");
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const { customerCode } = await createCustomer({
        name,
        phone: sanitizePhoneDigits(createPhone) || null,
        source: createSource,
      });
      setCreatingOpen(false);
      setCreateName("");
      setCreatePhone("");
      setCreateSource(SOURCE_MANUAL_OPTIONS[0]);
      onCustomerCreated?.(customerCode);
    } catch (e) {
      // 서버 한글 사유(403 권한 / 400 어휘)를 그대로 노출한다(httpError가 body.error를 싣는다).
      setCreateError(e instanceof Error ? e.message : "등록에 실패했습니다.");
    } finally {
      setCreateSubmitting(false);
    }
  }
```

⑤ 버튼 JSX 교체 — 기존(899-902라인):

```tsx
              <button className="btn primary-register-btn" type="button">
                <Plus aria-hidden="true" size={14} strokeWidth={2.4} />
                <span>고객 등록</span>
              </button>
```

를 아래로 교체:

```tsx
              {canCreateCustomers ? (
                <div className="customer-create-wrap">
                  <button
                    className="btn primary-register-btn"
                    onClick={() => { setCreateError(null); setCreatingOpen((open) => !open); }}
                    type="button"
                  >
                    <Plus aria-hidden="true" size={14} strokeWidth={2.4} />
                    <span>고객 등록</span>
                  </button>
                  {creatingOpen ? (
                    <div aria-label="고객 등록" className="customer-create-form" role="dialog">
                      <strong>고객 등록</strong>
                      <p>이름만 필수입니다. 나머지 정보는 등록 직후 열리는 상세 화면에서 입력하세요.</p>
                      <label>
                        <span>이름 *</span>
                        <input autoFocus onChange={(event) => setCreateName(event.target.value)} type="text" value={createName} />
                      </label>
                      <label>
                        <span>연락처</span>
                        <input onChange={(event) => setCreatePhone(event.target.value)} placeholder="010-0000-0000" type="text" value={createPhone} />
                      </label>
                      <label>
                        <span>유입 경로</span>
                        <select {...bindSelect(createSource, setCreateSource)}>
                          {SOURCE_MANUAL_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                      {createDuplicate ? (
                        <p className="customer-create-duplicate" role="status">
                          {createDuplicate.name}({createDuplicate.customerId}) 고객과 연락처가 같습니다.
                        </p>
                      ) : null}
                      {createError ? <p className="customer-create-error" role="alert">{createError}</p> : null}
                      <div>
                        <button disabled={createSubmitting} onClick={() => setCreatingOpen(false)} type="button">취소</button>
                        <button className="primary-action" disabled={createSubmitting} onClick={submitCreateCustomer} type="button">
                          {createSubmitting ? "등록 중…" : "등록"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
```

⚠️ select는 controlled이므로 반드시 `bindSelect`(Safari onChange 유실 함정 — 이미 페이지에 import돼 있다).

- [ ] **Step 2: CSS 추가**

`client/src/styles/customer-console.css` — `.bulk-delete-confirm p.bulk-delete-targets` 블록(파일 내 890라인 부근) 뒤에 추가:

```css
/* 고객 수기 등록 팝오버 — 삭제 확인창(.bulk-delete-confirm)과 같은 문법.
   .customer-create-wrap이 position:relative 기준, 폼은 absolute로 헤드바 높이를 밀지 않는다. */
.customer-console-headbar .customer-create-wrap {
  position: relative;
  display: inline-flex;
}

.customer-console-headbar .customer-create-form {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  width: 300px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06), 0 12px 28px rgba(16, 24, 40, 0.14);
  padding: 12px 13px;
  text-align: left;
}

.customer-console-headbar .customer-create-form strong {
  display: block;
  font-size: 12.5px;
  font-weight: 650;
  color: #1f2933;
}

.customer-console-headbar .customer-create-form > p {
  margin: 5px 0 10px;
  font-size: 11.5px;
  line-height: 1.55;
  color: #5f6872;
}

.customer-console-headbar .customer-create-form label {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 11.5px;
  color: #5f6872;
}

.customer-console-headbar .customer-create-form input,
.customer-console-headbar .customer-create-form select {
  height: 28px;
  padding: 0 8px;
  border: 1px solid #dededb;
  border-radius: 6px;
  background: #fbfbfa;
  font-size: 12px;
  color: #1f2933;
}

.customer-console-headbar .customer-create-form input:focus,
.customer-console-headbar .customer-create-form select:focus {
  outline: none;
  border-color: rgba(var(--brand-rgb), 0.34);
  box-shadow: 0 0 0 3px rgba(var(--brand-rgb), 0.12);
}

/* 중복은 경고(amber) — 등록을 막지 않는다. 에러(red)와 시각적으로 구분한다. */
.customer-console-headbar .customer-create-form p.customer-create-duplicate {
  margin: 2px 0 8px;
  color: #b45309;
}

.customer-console-headbar .customer-create-form p.customer-create-error {
  margin: 2px 0 8px;
  color: #b42318;
}

.customer-console-headbar .customer-create-form > div {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.customer-console-headbar .customer-create-form button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid #dededb;
  border-radius: 6px;
  background: #fbfbfa;
  font-size: 11.5px;
  font-weight: 550;
  color: #4f5a64;
  cursor: pointer;
}

.customer-console-headbar .customer-create-form button.primary-action {
  border-color: var(--brand);
  background: var(--brand);
  color: #fff;
}

.customer-console-headbar .customer-create-form button:disabled {
  opacity: 0.6;
  cursor: default;
}
```

(브랜드 토큰 `--brand`/`--brand-rgb`는 `theme.css:64-65` 정의 상존. 새 CSS는 도메인 파일 끝이 아니라
관련 블록 곁에 둔다 — `@import` 순서=캐스케이드 규칙과 무관한 신규 클래스라 위치 자유.)

- [ ] **Step 3: 검증**

Run: `bun run typecheck && bun run lint`
Expected: 둘 다 0 problems.

Run: `bun run test:unit client/src/pages/CustomerManagementPage.test.tsx`
Expected: 기존 테스트 전부 PASS (버튼은 `canCreateCustomers`(기본 roleTab 최고관리자=true)라 기존 스냅샷·쿼리 영향 없음. 실패하면 버튼 렌더 구조 변화가 기존 단언과 충돌하는 것 — 단언을 깨뜨린 원인을 확인하고 테스트가 버튼 존재만 봤다면 갱신).

- [ ] **Step 4: 커밋**

```bash
git add client/src/pages/CustomerManagementPage.tsx client/src/styles/customer-console.css
git commit -m "feat(crm): 고객 등록 팝오버 폼 — 이름·연락처·유입 경로 + 중복 소프트 경고 (헤드바 목업 버튼 실동작)"
```

---

### Task 7: App 배선 — 리로드 + 드로어 자동 오픈

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: 핸들러 추가**

`client/src/App.tsx` — `openCustomerDetailPanel` 함수 뒤에 추가:

```ts
  // 수기 등록 직후: 목록을 서버에서 다시 받고 드로어 URL로 이동한다.
  // 드로어는 URL이 single source(/customers?customer=code)라 목록이 도착하는 순간 자동으로 열린다
  // (isDrawerOpen이 selectedCustomer 발견 시점에 성립 — 새 상태 0, 기존 메커니즘 그대로).
  function handleCustomerCreated(customerCode: string) {
    reloadCustomers();
    navigate(`/customers?customer=${encodeURIComponent(customerCode)}`);
    showToast("고객이 등록되었습니다.");
  }
```

- [ ] **Step 2: prop 전달**

`/customers` Route의 `<CustomerManagementPage …>`에 추가 (`onCustomersChange={setCustomers}` 라인 근처, props 알파벳/기존 순서 유지):

```tsx
              onCustomerCreated={handleCustomerCreated}
```

- [ ] **Step 3: 검증**

Run: `bun run typecheck && bun run lint && bun run build`
Expected: 전부 green.

- [ ] **Step 4: 커밋**

```bash
git add client/src/App.tsx
git commit -m "feat(crm): 등록 성공 시 목록 리로드 + 새 고객 드로어 자동 오픈 배선"
```

---

### Task 8: 통합 검증 + 브라우저 스모크

- [ ] **Step 1: 전체 검증 세트**

```bash
bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build
```

Expected: typecheck 0 · lint 0 problems · unit 전부 PASS(기존 498+신규) · server 전부 PASS(기존 459+신규 8) · build 성공.

- [ ] **Step 2: 잔재 확인**

```bash
bun run check:residue
```

Expected: `[residue] 테스트 픽스처 잔재 없음 ✅`

- [ ] **Step 3: 브라우저 스모크 (메인 세션에서 수행 — subagent에 위임 금지)**

격리 스택(레포 관례: API 8799 + vite 임시 포트 — 사용자 dev 불가침) + magiclink admin 로그인으로:

1. 고객 목록 → `[+ 고객 등록]` 클릭 → 팝오버 폼 확인.
2. 이름 없이 등록 → 인라인 에러 "이름을 입력하세요." 확인.
3. 기존 고객과 같은 연락처 입력 → amber 중복 경고 확인(등록 버튼 활성 유지).
4. 이름 "수기등록테스트"(잔재 registry 등록명), 연락처, 경로 "소개"로 등록 →
   목록 리로드 + 새 고객 상세 드로어 자동 오픈 확인.
5. psql로 대조: `select customer_code, name, phone, source, status_group, status, advisor_id, advisor_name, assigned_at, received_at from crm.customers where name = '수기등록테스트';`
   → 시드·자동 배정 필드 확인(로그인 계정=자메스관리자 admin이 담당자로 박혀야 함).
6. 새로고침 → 고객이 목록에 영속 확인.
7. **원복**: 드로어/목록에서 고객 삭제(admin 삭제 경로 — psql 직접 삭제 금지, 임베딩 고아 방지).
   삭제 후 `bun run check:residue`로 0건 확인.

- [ ] **Step 4: 브리프 갱신 + PR**

- `ref/active-session-brief.md`의 "▶ 다음 착수" 항목 갱신(고객 등록 완료 표시, 남은 목업 = 일괄 담당자 변경만).
- push 후 PR 생성(제목 예: `feat(crm): 고객 수기 등록 — POST /api/customers + 헤드바 폼 (#목업 버튼 해소)`),
  본문에 spec/plan 링크 + 검증 결과 + 스모크 기록. squash 머지는 사용자 지시 후.

---

## Self-Review 결과

- **Spec 커버리지**: 역할 게이트(T3)·API 계약(T3)·쿼리+자동 배정+임베딩(T2·T3)·채번 race 수용(코드 없음 — 문서화만, 의도)·클라 lib(T4·T5)·폼+중복 경고(T6)·App 배선(T7)·잔재 tripwire 확장(T1)·검증 세트+스모크(T8) — 전 항목 태스크 매핑 완료.
- **타입 일관성**: `CustomerCreateInput`이 서버(advisor 포함)와 클라(3필드)에서 다른 모양 — 서로 다른 모듈의 별개 타입(각자 파일 스코프)이라 충돌 없음. 클라는 `{ customerCode }`만 소비.
- **플레이스홀더**: 없음. 모든 코드 스텝에 실제 코드 포함.
