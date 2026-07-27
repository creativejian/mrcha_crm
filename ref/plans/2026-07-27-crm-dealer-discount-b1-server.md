# 딜러 할인 제안 — 서버 구현 계획 (슬라이스 B1)

> 실행은 `superpowers:executing-plans`(인라인)로 태스크 단위 진행.
> spec = `ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md`
> 선행 = 슬라이스 A(`ref/plans/2026-07-27-crm-dealer-brand-mapping.md`, PR #375 머지 완료)

**목표:** 딜러가 **자기 브랜드 트림에만** 자사·제휴·타사 할인 **제안**을 저장할 수 있게 한다.
`catalog.trims`의 확정 할인은 건드리지 않는다(관리자 채택 = 슬라이스 C).

**아키텍처:** `crm.dealer_trim_discounts` 1테이블 + `/api/dealer/*` 3라우트.
`DEALER_WRITE_ALLOWLIST`에 **딱 한 줄**을 열어 딜러 쓰기를 허용하고, 그 안에서
`trims → models.brand_id`를 `dealer_profiles.brand_id`와 대조해 fail-closed 403으로 막는다.

**왜 B1/B2로 나누는가:** B1은 "딜러가 API로 자기 브랜드에만 제안을 넣을 수 있다"를 테스트로
완결한다. allowlist 개방 + 소유권 검증은 보안 축이라 화면 변경과 섞지 않고 독립 리뷰한다.
B2(딜러 모드 화면 · Topbar 실데이터 라벨 · 사이드바 "할인 업데이트" 진입점)는 별도 계획.

**⚠️ 경로 결정 근거:** 기존 `role-gate.test.ts`가 예시 allowlist로 `/api/catalog/trims/:id/discounts`를
쓰지만(픽스처일 뿐 강제 아님), **딜러 제안은 catalog가 아니라 crm에 저장**되므로
`/api/dealer/discounts/:trimId`가 의미상 정확하다. catalog 라우터는 계속 admin 전용으로 남는다.

---

### Task 0: 브랜치

- [ ] **Step 1: 최신 main에서 분기**

```bash
git switch main && git pull -q && git switch -c 0727-dealer-discount-b1
git status --short --branch
```

기대: `## 0727-dealer-discount-b1` · clean

---

### Task 1: `crm.dealer_trim_discounts` + 마이그레이션 0040

**Files:**
- Modify: `src/db/schema.ts` (파일 끝, `dealerProfiles` 다음)
- Create: `drizzle/0040_*.sql` (db:generate 생성)

- [ ] **Step 1: 테이블 정의 추가**

```ts
// 딜러 할인 제안(2026-07-27) — 딜러가 낸 **제안값**이고 확정값이 아니다.
// 확정 할인은 catalog.trims의 3컬럼이며 **관리자 채택으로만** 바뀐다(spec §2 — 딜러는 catalog에
// 손이 닿지 않는다). 한 트림에 여러 딜러가 각자 제안을 낼 수 있어 (trim_id, dealer_user_id) UNIQUE.
// 3금액이 각각 nullable인 이유: 자사만 내고 제휴·타사는 비울 수 있다(빈 값 = 그 필드는 미제안).
// created_at은 dealerProfiles와 같은 이유(감사 + 스탬프 전진을 DB 안에서 검증).
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §3.2
export const dealerTrimDiscounts = crm.table(
  "dealer_trim_discounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trimId: bigint("trim_id", { mode: "number" }).notNull(), // → catalog.trims.id(loose id)
    dealerUserId: uuid("dealer_user_id").notNull(), // → public.profiles.id(loose id)
    financialAmount: integer("financial_amount"), // 자사할인 제안
    partnerAmount: integer("partner_amount"), // 제휴할인 제안
    cashAmount: integer("cash_amount"), // 타사할인 제안
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("dealer_trim_discounts_trim_dealer_unique").on(table.trimId, table.dealerUserId)],
);
```

- [ ] **Step 2: 마이그레이션 생성**

```bash
bun run db:generate
```

- [ ] **Step 3: 생성 SQL 육안 검사** — ⚠️ 건너뛰지 않는다

```bash
cat drizzle/0040_*.sql
```

기대: `CREATE TABLE "crm"."dealer_trim_discounts"` + UNIQUE 제약뿐.
**`DROP`이 한 줄이라도 있거나 `public.`/`catalog.`가 등장하면 즉시 중단** — `DATABASE_URL`이 공유
master라 schemaFilter 밖을 건드리는 SQL은 앱 19테이블·catalog 9테이블을 날릴 수 있다.

- [ ] **Step 4: 적용 + 확인**

```bash
bun run db:migrate
set -a && source .env.local && set +a && psql "$DATABASE_URL" -X -c "\d crm.dealer_trim_discounts"
```

기대: 8컬럼 + PK + `dealer_trim_discounts_trim_dealer_unique`

- [ ] **Step 5: 커밋**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(crm): crm.dealer_trim_discounts 테이블 — 딜러별 할인 제안 (0040)"
```

---

### Task 2: 쿼리 레이어 + 실 DB 테스트

**Files:**
- Create: `src/db/queries/dealer-discounts.ts`
- Create: `src/db/queries/dealer-discounts.test.ts`
- Modify: `src/db/queries/dealer-profiles.ts` (본인 프로필 단건 조회 추가)
- Modify: `src/test-utils/db-bound-tests.ts`

- [ ] **Step 1: 실패하는 테스트 작성** (`src/db/queries/dealer-discounts.test.ts`)

```ts
import { afterAll, expect, test } from "bun:test";
import { and, asc, eq, sql } from "drizzle-orm";

import { modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb } from "../client";
import { dealerTrimDiscounts } from "../schema";
import { brandIdOfTrim, listMyTrimDiscounts, upsertDealerTrimDiscount } from "./dealer-discounts";

// 실 DB(공유 master). FK가 없어(loose id) 랜덤 uuid로 완결되지만 afterAll 정리는 필수다
// (uuid PK라 코드 리터럴 registry로는 잔재를 탐지할 수 없다).
const db = getDefaultDb();
const DEALER_ID = crypto.randomUUID();

afterAll(async () => {
  await db.delete(dealerTrimDiscounts).where(eq(dealerTrimDiscounts.dealerUserId, DEALER_ID));
});

// 실 catalog에서 트림 하나를 집는다(하드코딩 id 금지 — 환경마다 다르다).
async function pickTrim() {
  const [row] = await db
    .select({ trimId: trimsInCatalog.id, modelId: trimsInCatalog.modelId, brandId: modelsInCatalog.brandId })
    .from(trimsInCatalog)
    .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
    .orderBy(asc(trimsInCatalog.id))
    .limit(1);
  return row;
}

test("brandIdOfTrim: 트림의 소속 브랜드를 2단 조인으로 돌려준다", async () => {
  const trim = await pickTrim();
  expect(trim).toBeDefined();
  expect(await brandIdOfTrim(trim!.trimId, db)).toBe(trim!.brandId);
});

test("brandIdOfTrim: 없는 트림은 null (fail-closed 판정의 근거)", async () => {
  expect(await brandIdOfTrim(999_999_999, db)).toBeNull();
});

test("upsert 신규 → 내 제안 목록에 뜬다", async () => {
  const trim = await pickTrim();
  await upsertDealerTrimDiscount(
    { trimId: trim!.trimId, dealerUserId: DEALER_ID, financialAmount: 6_500_000, partnerAmount: null, cashAmount: null },
    db,
  );

  const rows = await listMyTrimDiscounts(DEALER_ID, trim!.modelId, db);
  const mine = rows.find((r) => r.trimId === trim!.trimId);
  expect(mine).toBeDefined();
  expect(mine!.financialAmount).toBe(6_500_000);
  expect(mine!.partnerAmount).toBeNull();
});

test("upsert 재호출 → 1행 유지 · 금액 교체 · updated_at 전진", async () => {
  const trim = await pickTrim();
  await upsertDealerTrimDiscount(
    { trimId: trim!.trimId, dealerUserId: DEALER_ID, financialAmount: null, partnerAmount: 6_000_000, cashAmount: 5_500_000 },
    db,
  );

  const rows = (await listMyTrimDiscounts(DEALER_ID, trim!.modelId, db)).filter((r) => r.trimId === trim!.trimId);
  expect(rows.length).toBe(1); // UNIQUE 충돌이 UPDATE로 흡수됐다
  expect(rows[0]!.financialAmount).toBeNull(); // 비우기도 저장된다
  expect(rows[0]!.partnerAmount).toBe(6_000_000);

  // ⚠️ 스탬프 전진은 DB 안에서 비교한다(JS Date는 ms 절삭 — #334·#335).
  const [chk] = await db
    .select({ advanced: sql<boolean>`${dealerTrimDiscounts.updatedAt} > ${dealerTrimDiscounts.createdAt}` })
    .from(dealerTrimDiscounts)
    .where(and(eq(dealerTrimDiscounts.dealerUserId, DEALER_ID), eq(dealerTrimDiscounts.trimId, trim!.trimId)));
  expect(chk!.advanced).toBe(true);
});

test("다른 딜러의 제안은 내 목록에 섞이지 않는다", async () => {
  const trim = await pickTrim();
  const other = crypto.randomUUID();
  try {
    await upsertDealerTrimDiscount(
      { trimId: trim!.trimId, dealerUserId: other, financialAmount: 7_000_000, partnerAmount: null, cashAmount: null },
      db,
    );
    const rows = await listMyTrimDiscounts(DEALER_ID, trim!.modelId, db);
    expect(rows.every((r) => r.financialAmount !== 7_000_000)).toBe(true);
  } finally {
    await db.delete(dealerTrimDiscounts).where(eq(dealerTrimDiscounts.dealerUserId, other));
  }
});
```

- [ ] **Step 2: 실패 확인**

```bash
EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/db/queries/dealer-discounts.test.ts
```

기대: FAIL — `Cannot find module './dealer-discounts'`

- [ ] **Step 3: 구현** (`src/db/queries/dealer-discounts.ts`)

```ts
import { and, eq, sql } from "drizzle-orm";

import { modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { dealerTrimDiscounts } from "../schema";

// 딜러 할인 제안(crm.dealer_trim_discounts) — 제안값이고 확정값이 아니다.
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §3.2·§6.2

// 트림의 소속 브랜드. 딜러 쓰기 범위 검증의 근거다 — cross-schema라 DB CHECK로 강제할 수 없어
// **서버 검증이 유일한 방어선**이고, 그래서 라우트 테스트가 이 축을 잠근다.
// 없는 트림은 null → 호출부가 403으로 막는다(fail-closed).
export async function brandIdOfTrim(trimId: number, executor: Executor = getDefaultDb()) {
  const [row] = await executor
    .select({ brandId: modelsInCatalog.brandId })
    .from(trimsInCatalog)
    .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
    .where(eq(trimsInCatalog.id, trimId));
  return row?.brandId ?? null;
}

// 내 제안만(모델 단위). **다른 딜러의 제안은 절대 섞지 않는다** — 경쟁사 할인 전략 노출이다
// (관리자 채택 화면은 전 딜러 제안을 보지만 그건 슬라이스 C의 admin 라우트다).
export async function listMyTrimDiscounts(
  dealerUserId: string,
  modelId: number,
  executor: Executor = getDefaultDb(),
) {
  return executor
    .select({
      trimId: dealerTrimDiscounts.trimId,
      financialAmount: dealerTrimDiscounts.financialAmount,
      partnerAmount: dealerTrimDiscounts.partnerAmount,
      cashAmount: dealerTrimDiscounts.cashAmount,
      updatedAt: dealerTrimDiscounts.updatedAt,
    })
    .from(dealerTrimDiscounts)
    .innerJoin(trimsInCatalog, eq(trimsInCatalog.id, dealerTrimDiscounts.trimId))
    .where(and(eq(dealerTrimDiscounts.dealerUserId, dealerUserId), eq(trimsInCatalog.modelId, modelId)));
}

// 제안 저장. UNIQUE(trim_id, dealer_user_id) 충돌을 UPDATE로 흡수해 신규/변경이 한 경로다.
// updated_at은 인라인 sql`now()` — 앱 시계 금지(#334·#335).
export async function upsertDealerTrimDiscount(
  input: {
    trimId: number;
    dealerUserId: string;
    financialAmount: number | null;
    partnerAmount: number | null;
    cashAmount: number | null;
  },
  executor: Executor = getDefaultDb(),
) {
  const [row] = await executor
    .insert(dealerTrimDiscounts)
    .values(input)
    .onConflictDoUpdate({
      target: [dealerTrimDiscounts.trimId, dealerTrimDiscounts.dealerUserId],
      set: {
        financialAmount: input.financialAmount,
        partnerAmount: input.partnerAmount,
        cashAmount: input.cashAmount,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row ?? null;
}
```

- [ ] **Step 4: 본인 프로필 단건 조회 추가** (`src/db/queries/dealer-profiles.ts` 끝에)

```ts
// 딜러 본인 프로필 — 브랜드 소유권 검증(서버)과 Topbar 조직 라벨(B2)이 쓴다.
// null = 브랜드 미지정 → 쓰기 경로는 403(fail-closed), 화면은 안내 문구.
export async function getDealerProfile(dealerUserId: string, executor: Executor = getDefaultDb()) {
  const [row] = await executor
    .select({
      dealerUserId: dealerProfiles.dealerUserId,
      brandId: dealerProfiles.brandId,
      brandName: brandsInCatalog.name,
      note: dealerProfiles.note,
    })
    .from(dealerProfiles)
    .leftJoin(brandsInCatalog, eq(brandsInCatalog.id, dealerProfiles.brandId))
    .where(eq(dealerProfiles.dealerUserId, dealerUserId));
  return row ?? null;
}
```

- [ ] **Step 5: 통과 확인 + registry 등록**

```bash
EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/db/queries/dealer-discounts.test.ts
```

기대: PASS 5건. 이어서 `src/test-utils/db-bound-tests.ts`에 알파벳 순으로 삽입
(`dealer-profiles.test.ts` **앞**):

```ts
  "src/db/queries/dealer-discounts.test.ts",
```

- [ ] **Step 6: 커밋**

```bash
git add src/db/queries/dealer-discounts.ts src/db/queries/dealer-discounts.test.ts src/db/queries/dealer-profiles.ts src/test-utils/db-bound-tests.ts
git commit -m "feat(crm): 딜러 할인 제안 쿼리 — 내 제안 조회·upsert + 트림 브랜드 판정"
```

---

### Task 3: 라우트 3개 + allowlist 개방 + 소유권 검증

**Files:**
- Modify: `src/routes/dealer.ts`
- Modify: `src/middleware/role-gate.ts` (allowlist 1줄)
- Create: `src/routes/dealer.discounts.test.ts`
- Modify: `src/test-utils/db-bound-tests.ts`

- [ ] **Step 1: 실패하는 테스트 작성** (`src/routes/dealer.discounts.test.ts`)

```ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { modelsInCatalog, trimsInCatalog } from "../db/catalog";
import { getDefaultDb } from "../db/client";
import { upsertDealerProfile } from "../db/queries/dealer-profiles";
import { dealerProfiles, dealerTrimDiscounts } from "../db/schema";

// ── 딜러 할인 제안 쓰기: allowlist 개방 + 브랜드 소유권(fail-closed) ──────────
// 딜러 쓰기는 dealerWriteGate가 전면 차단하고 allowlist 1줄로만 열린다. 그 위에 소유권 검증이
// 얹혀 "내 브랜드 트림만" 쓰게 만든다 — cross-schema라 DB CHECK로 강제할 수 없어 서버가 유일한
// 방어선이고, 그래서 이 파일이 그 축을 잠근다.
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §6.1·§6.2
const db = getDefaultDb();
const DEALER_ID = crypto.randomUUID();
let myTrimId = 0;
let otherBrandTrimId = 0;

beforeAll(async () => {
  // 서로 다른 브랜드의 트림 2개를 실 catalog에서 집는다.
  const rows = await db
    .select({ trimId: trimsInCatalog.id, brandId: modelsInCatalog.brandId })
    .from(trimsInCatalog)
    .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
    .orderBy(asc(trimsInCatalog.id));
  const first = rows[0]!;
  const other = rows.find((r) => r.brandId !== first.brandId)!;
  myTrimId = first.trimId;
  otherBrandTrimId = other.trimId;
  // 이 딜러는 first의 브랜드 소속이다. **쿼리 함수로 만든다** — `db.insert(dealerProfiles)`를 직접
  // 쓰면 profiles-write-guard 탐지기에 또 걸려 예외를 하나 더 등록해야 한다(아래 Step 7 참조).
  await upsertDealerProfile({ dealerUserId: DEALER_ID, brandId: first.brandId, note: null }, db);
});

afterAll(async () => {
  await db.delete(dealerTrimDiscounts).where(eq(dealerTrimDiscounts.dealerUserId, DEALER_ID));
  await db.delete(dealerProfiles).where(eq(dealerProfiles.dealerUserId, DEALER_ID));
});

async function put(role: "dealer" | "staff" | "admin", userId: string, trimId: number, body: unknown) {
  const { token, keyResolver, issuer } = await makeTestAuth(role, userId);
  const app = createApp({ keyResolver, issuer });
  return app.request(`/api/dealer/discounts/${trimId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const AMOUNTS = { financialAmount: 6_500_000, partnerAmount: null, cashAmount: null };

test("내 브랜드 트림 → 200 (allowlist가 열려 dealerWriteGate를 통과한다)", async () => {
  const res = await put("dealer", DEALER_ID, myTrimId, AMOUNTS);
  expect(res.status).toBe(200);
});

test("다른 브랜드 트림 → 403 (브랜드 소유권 검증)", async () => {
  const res = await put("dealer", DEALER_ID, otherBrandTrimId, AMOUNTS);
  expect(res.status).toBe(403);
});

test("없는 트림 → 403 (brandIdOfTrim null = fail-closed)", async () => {
  const res = await put("dealer", DEALER_ID, 999_999_999, AMOUNTS);
  expect(res.status).toBe(403);
});

test("프로필 없는 딜러 → 403 (브랜드 미지정은 아무것도 못 쓴다)", async () => {
  const res = await put("dealer", crypto.randomUUID(), myTrimId, AMOUNTS);
  expect(res.status).toBe(403);
});

test("allowlist는 그 경로만 연다 — 딜러의 catalog 쓰기는 여전히 403", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("dealer", DEALER_ID);
  const app = createApp({ keyResolver, issuer });
  const res = await app.request(`/api/catalog/trims/${myTrimId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ financialDiscountAmount: 1 }),
  });
  expect(res.status).toBe(403);
});

test("allowlist는 딜러 프로필 쓰기를 열지 않는다 — 자기 브랜드 변경 403", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("dealer", DEALER_ID);
  const app = createApp({ keyResolver, issuer });
  const res = await app.request(`/api/dealer/profiles/${DEALER_ID}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ brandId: 1 }),
  });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: 실패 확인**

```bash
EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/routes/dealer.discounts.test.ts
```

기대: 첫 테스트가 **403**(allowlist가 아직 닫혀 있다)으로 실패

- [ ] **Step 3: allowlist 1줄 개방** (`src/middleware/role-gate.ts`)

```ts
const DEALER_WRITE_ALLOWLIST: DealerWriteAllowEntry[] = [
  // 딜러 할인 제안 upsert(2026-07-27, 슬라이스 B1 — 이사님 요구). 쓰기 대상은
  // crm.dealer_trim_discounts뿐이고 catalog.trims의 확정 할인은 관리자 채택으로만 바뀐다.
  // 브랜드 소유권은 라우트가 검증한다(cross-schema라 DB CHECK 불가) — routes/dealer.discounts.test.ts.
  { method: "PUT", path: /^\/api\/dealer\/discounts\/\d+$/ },
];
```

- [ ] **Step 4: 라우트 3개 추가** (`src/routes/dealer.ts`)

import에 추가:

```ts
import { brandIdOfTrim, listMyTrimDiscounts, upsertDealerTrimDiscount } from "../db/queries/dealer-discounts";
import { getDealerProfile, listDealerProfiles, upsertDealerProfile } from "../db/queries/dealer-profiles";
```

스키마·라우트 추가(파일 끝):

```ts
const trimIdParam = z.object({ trimId: z.coerce.number().int().positive() });
const modelIdQuery = z.object({ modelId: z.coerce.number().int().positive() });
// 금액은 원 단위 0 이상. null = 그 필드는 미제안(비우기도 저장 대상이다).
const amount = z.number().int().nonnegative().nullable();
const discountBody = z.object({ financialAmount: amount, partnerAmount: amount, cashAmount: amount });

// 본인 프로필 — 게이트 없이 **자기 것만** 돌려준다(role 무관, dealer가 아니면 자연히 null).
dealer.get("/me", async (c) => c.json(await getDealerProfile(c.var.user.id, c.var.db)));

// 내 제안(모델 단위) — 다른 딜러 제안은 섞이지 않는다(쿼리가 dealerUserId로 필터).
dealer.get("/discounts", zValidator("query", modelIdQuery), async (c) =>
  c.json(await listMyTrimDiscounts(c.var.user.id, c.req.valid("query").modelId, c.var.db)),
);

// 제안 저장 — **allowlist가 여는 유일한 딜러 쓰기 경로**.
// 브랜드 소유권을 fail-closed로 검증한다: 프로필 없음·트림 없음·다른 브랜드 = 전부 403.
dealer.put(
  "/discounts/:trimId",
  zValidator("param", trimIdParam),
  zValidator("json", discountBody),
  async (c) => {
    const { trimId } = c.req.valid("param");
    const [profile, trimBrandId] = await Promise.all([
      getDealerProfile(c.var.user.id, c.var.db),
      brandIdOfTrim(trimId, c.var.db),
    ]);
    if (!profile || trimBrandId === null || profile.brandId !== trimBrandId) {
      return c.json({ error: "권한이 없습니다." }, 403);
    }
    const row = await upsertDealerTrimDiscount(
      { trimId, dealerUserId: c.var.user.id, ...c.req.valid("json") },
      c.var.db,
    );
    return c.json(row);
  },
);
```

- [ ] **Step 5: 통과 확인**

```bash
EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/routes/dealer.discounts.test.ts
```

기대: PASS 6건

- [ ] **Step 6: 변이 검증 2회** — 두 방어선이 각각 도는지 눈으로 확인

**변이 A(소유권 검증 제거):** 라우트의 `if (!profile || trimBrandId === null || profile.brandId !== trimBrandId)`
줄을 `if (false)`로 바꿔 실행 → **403 기대 3건**(다른 브랜드·없는 트림·프로필 없음)이 실패하는 것을
확인 → 원복.

**변이 B(allowlist 닫기):** `DEALER_WRITE_ALLOWLIST`를 `[]`로 되돌려 실행 → **200 기대 1건**이
403으로 실패하는 것을 확인 → 원복.

```bash
EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/routes/dealer.discounts.test.ts
git status --short   # 원복 후 clean
```

- [ ] **Step 7: profiles-write-guard 예외 1건 추가** (`src/db/profiles-write-guard.test.ts`)

새 테스트의 `afterAll` 정리가 `db.delete(dealerProfiles)`를 쓰므로 탐지기에 또 걸린다(슬라이스 A와
같은 오탐 — 별칭 판정이 "profiles로 끝나는 식별자"를 본다). `ALLOW` 배열에 한 줄 추가:

```ts
  {
    path: "src/routes/dealer.discounts.test.ts",
    hit: "drizzle: .delete(dealerProfiles)",
    why: "브랜드 소유권 테스트의 픽스처 정리(afterAll) — crm.dealer_profiles, public.profiles 무접촉",
  },
```

⚠️ 생성 쪽은 `upsertDealerProfile()` 쿼리 함수를 써서 매치를 만들지 않았다(예외를 늘리지 않는 쪽이
낫다). 등록 후 확인:

```bash
EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/db/profiles-write-guard.test.ts
```

기대: PASS 9건(스테일 방지 테스트가 새 항목까지 검사한다)

- [ ] **Step 8: registry 등록 + 커밋**

`src/test-utils/db-bound-tests.ts` 라우트 섹션에 알파벳 순 삽입(`dealer.role-gate.test.ts` **앞**):

```ts
  "src/routes/dealer.discounts.test.ts",
```

```bash
git add src/routes/dealer.ts src/routes/dealer.discounts.test.ts src/middleware/role-gate.ts src/db/profiles-write-guard.test.ts src/test-utils/db-bound-tests.ts
git commit -m "feat(crm): 딜러 할인 제안 라우트 + allowlist 1줄 개방 + 브랜드 소유권 검증"
```

---

### Task 4: 전체 검증 + PR

- [ ] **Step 1: 4종 + 테스트 + 빌드**

```bash
bun run typecheck && bun run lint && bun run knip && bun run format:check
bun run test:unit && bun run test:pure && bun run build
```

기대: 전부 0 / 통과

- [ ] **Step 2: 실 DB 전량 + 잔재**

```bash
EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/db/queries/dealer-discounts.test.ts src/db/queries/dealer-profiles.test.ts src/routes/dealer.discounts.test.ts src/routes/dealer.role-gate.test.ts src/middleware/role-gate.test.ts
bun run check:residue
```

기대: PASS 27건 내외 · 잔재 0

- [ ] **Step 3: PR 생성**

본문에 반드시 포함할 것:
- **allowlist를 처음으로 열었다**는 사실과 그 경로 정규식(`^\/api\/dealer\/discounts\/\d+$`)
- 소유권 검증이 **cross-schema라 DB CHECK 불가 → 서버가 유일한 방어선**이라는 근거
- **변이 검증 2회 실관찰 결과**(소유권 제거 → 403 3건 실패 / allowlist 닫기 → 200 1건 실패)
- 딜러 화면은 아직 없다(B2) — 이 PR은 API만이고 딜러는 화면으로 값을 넣을 수 없다

---

## 슬라이스 B2 (다음 계획)

유슨생 실기 리포트(2026-07-27)에서 나온 항목들이 여기 묶인다:

1. **Topbar 조직 라벨 실데이터화** — 지금은 `roles.ts`의 목업 `딜러: { title: "BMW 한독/서초" }`가
   뜬다. `GET /api/dealer/me`(B1에서 신설)로 **"BMW · 동성모터스"**(브랜드 + 비고)로 대체한다.
   목업 상수의 `name: "권지현"` 필드는 소비처가 없어 함께 정리 대상.
2. **사이드바 "할인 업데이트" 실동작화** — `Sidebar.tsx`의 `dealerMenuItems`에 이미 그 자리가
   목업으로 있다(클릭 핸들러 없음). Topbar 설정 메뉴(admin 전용)를 여는 게 아니라 **이 자리가
   원 설계상 딜러의 진입점**이다.
3. **MC 마스터 딜러 모드** — 자기 브랜드만 사이드바 표시(타 브랜드 URL 직접 진입 차단) ·
   할인 3열만 편집(트림명·기본가·상태는 읽기 전용) · admin 기능(트림 추가·이동·삭제·옵션 패널·
   MC코드) 숨김 + 서버 403 유지 · 확정값은 셀 안 회색 보조표기(spec §7.1).
4. **저장 실패 피드백** — 슬라이스 A의 조직 화면 저장이 실패해도 화면에 아무 표시가 없다(버튼만
   남는다). 딜러 모드 저장에도 같은 문제가 생기므로 공통으로 처리한다.
