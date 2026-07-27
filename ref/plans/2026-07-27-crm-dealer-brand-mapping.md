# 딜러 브랜드 매칭 구현 계획 (슬라이스 A)

> 실행은 `superpowers:executing-plans`(인라인)로 태스크 단위 진행. 체크박스로 추적한다.
> spec = `ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md`

**목표:** 관리자가 조직 화면에서 딜러 계정에 **브랜드와 비고(딜러사명)를 지정**할 수 있게 한다.

**아키텍처:** `crm.dealer_profiles` 1테이블(PK = `dealer_user_id` → "한 딜러 = 한 브랜드"를 스키마가 강제)
+ admin 전용 `/api/dealer/profiles` GET·PUT + `OrgMembersPage` 「구성원」 탭 dealer 행에 브랜드 select·비고 입력.
`public.profiles`는 읽지도 쓰지도 않는다(브랜드·비고는 crm 소유 데이터).

**기술 스택:** drizzle-kit(`schemaFilter:["crm"]`) · Hono + zod validator · React(controlled select) · bun test

**왜 슬라이스 A만인가:** ①딜러가 브랜드 없이는 아무것도 못 쓰므로 선행이다 ②`schema.ts`에 3테이블을
한꺼번에 export하면 슬라이스 A에서 안 쓰는 2개가 **knip 미사용 export로 CI를 빨갛게 만든다**(기준선 0).
슬라이스 B(딜러 제안 입력)·C(관리자 채택)는 각각 별도 계획으로 쓴다.

---

### Task 0: 브랜치

**Files:** 없음

- [ ] **Step 1: 브랜치 생성**

```bash
git switch -c 0727-dealer-brand-mapping
git status --short --branch
```

기대: `## 0727-dealer-brand-mapping` · 워킹트리 clean

---

### Task 1: `crm.dealer_profiles` 스키마 + 마이그레이션

**Files:**
- Modify: `src/db/schema.ts` (파일 끝에 추가)
- Create: `drizzle/0039_*.sql` (db:generate가 생성 — 손으로 쓰지 않는다)

- [ ] **Step 1: 테이블 정의 추가** (`src/db/schema.ts` 맨 끝)

```ts
// ── 딜러 프로필(0039, 2026-07-27) ─────────────────────────────────────────────
// 딜러 계정 1명당 1행. **PK가 dealer_user_id 하나 = "한 딜러 = 한 브랜드"를 스키마가 강제**한다
// (이사님 요구: 한 브랜드에는 여러 딜러가 붙을 수 있으나, 한 딜러는 한 브랜드).
// brand_id에 FK를 걸지 않는다: NOT NULL이라 ON DELETE SET NULL을 쓸 수 없고, RESTRICT는
// catalog(앱 공유 스키마) 삭제를 CRM이 가로막는 소유권 침범이다. crm.quotes→catalog FK(0001)는
// nullable이라 가능했던 선례이므로 여기 적용되지 않는다 — 조회 시 조인 실패 = "브랜드 미지정".
// note = 비고(딜러사명 "동성모터스"·"코오롱모터스"·"바바리안") — 관리자 입력.
// created_at은 감사 + 테스트 가능성(updated_at > created_at을 DB 안에서 비교, #334·#335)용.
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §3.1
export const dealerProfiles = crm.table("dealer_profiles", {
  dealerUserId: uuid("dealer_user_id").primaryKey(), // → public.profiles.id(loose id 관례)
  brandId: bigint("brand_id", { mode: "number" }).notNull(), // → catalog.brands.id
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: 마이그레이션 생성**

```bash
bun run db:generate
```

- [ ] **Step 3: 생성된 SQL을 눈으로 검사** — ⚠️ **이 스텝을 건너뛰지 않는다**

```bash
cat drizzle/0039_*.sql
```

기대: `CREATE TABLE "crm"."dealer_profiles"` 한 건뿐.
**`DROP`이 한 줄이라도 있거나 `public.`/`catalog.` 스키마가 등장하면 즉시 중단**하고 원인을 파악한다
(`DATABASE_URL`이 공유 master다 — schemaFilter 밖 스키마를 건드리는 SQL은 앱 19테이블·catalog 9테이블을
날릴 수 있다).

- [ ] **Step 4: 마이그레이션 적용**

```bash
bun run db:migrate
```

- [ ] **Step 5: 실 DB에서 테이블 확인**

```bash
set -a && source .env.local && set +a && psql "$DATABASE_URL" -X -c "\d crm.dealer_profiles"
```

기대: 5컬럼(`dealer_user_id` PK · `brand_id` not null · `note` · `created_at` · `updated_at`)

- [ ] **Step 6: 커밋**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(crm): crm.dealer_profiles 테이블 — 딜러 1명 = 브랜드 1개 (0039)"
```

---

### Task 2: 쿼리 레이어 + 실 DB 테스트

**Files:**
- Create: `src/db/queries/dealer-profiles.ts`
- Create: `src/db/queries/dealer-profiles.test.ts`
- Modify: `src/test-utils/db-bound-tests.ts`

- [ ] **Step 1: 실패하는 테스트 작성** (`src/db/queries/dealer-profiles.test.ts`)

```ts
import { afterAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { dealerProfiles } from "../schema";
import { listDealerProfiles, upsertDealerProfile } from "./dealer-profiles";

// 실 DB(공유 master) 테스트. dealer_profiles는 profiles에 FK가 없어(loose id 정책)
// 실제 계정 없이 랜덤 uuid로 완결된다 — 대신 afterAll 정리를 반드시 남긴다
// (uuid PK라 코드 리터럴 registry(fixture-codes)로는 잔재를 탐지할 수 없다).
const db = getDefaultDb();
const DEALER_ID = crypto.randomUUID();

afterAll(async () => {
  await db.delete(dealerProfiles).where(eq(dealerProfiles.dealerUserId, DEALER_ID));
});

test("upsert 신규 → 목록에 브랜드명과 함께 뜬다", async () => {
  // 브랜드는 실 catalog에서 하나 집는다(하드코딩 id 금지 — 환경마다 다르다).
  const [brand] = await db.execute<{ id: number; name: string }>(
    sql`select id, name from catalog.brands order by sort_order limit 1`,
  );
  expect(brand).toBeDefined();

  await upsertDealerProfile({ dealerUserId: DEALER_ID, brandId: brand.id, note: "동성모터스" }, db);

  const rows = await listDealerProfiles(db);
  const mine = rows.find((r) => r.dealerUserId === DEALER_ID);
  expect(mine).toBeDefined();
  expect(mine!.brandId).toBe(brand.id);
  expect(mine!.brandName).toBe(brand.name);
  expect(mine!.note).toBe("동성모터스");
});

test("upsert 재호출 → 1행 유지 · 브랜드 교체 · updated_at 전진", async () => {
  const brands = await db.execute<{ id: number }>(
    sql`select id from catalog.brands order by sort_order limit 2`,
  );
  expect(brands.length).toBe(2);
  const other = brands[1]!.id;

  await upsertDealerProfile({ dealerUserId: DEALER_ID, brandId: other, note: null }, db);

  const rows = (await listDealerProfiles(db)).filter((r) => r.dealerUserId === DEALER_ID);
  expect(rows.length).toBe(1); // PK 충돌이 UPDATE로 흡수됐다
  expect(rows[0]!.brandId).toBe(other);
  expect(rows[0]!.note).toBeNull();

  // ⚠️ 스탬프 전진은 **DB 안에서** 비교한다. JS Date로 꺼내 비교하면 ms 절삭으로 거짓 실패하고,
  // 시계 스큐가 클수록 잘 통과해 결함을 가린다(#334·#335).
  const [chk] = await db
    .select({ advanced: sql<boolean>`${dealerProfiles.updatedAt} > ${dealerProfiles.createdAt}` })
    .from(dealerProfiles)
    .where(eq(dealerProfiles.dealerUserId, DEALER_ID));
  expect(chk!.advanced).toBe(true);
});
```

- [ ] **Step 2: 실패 확인**

```bash
bun test src/db/queries/dealer-profiles.test.ts
```

기대: FAIL — `Cannot find module './dealer-profiles'`

- [ ] **Step 3: 최소 구현** (`src/db/queries/dealer-profiles.ts`)

```ts
import { eq, sql } from "drizzle-orm";

import { brandsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { dealerProfiles } from "../schema";

// 전 딜러 프로필(관리자용). profiles를 조인하지 않는다 — 조직 화면이 이미 구성원 목록을 갖고 있어
// 클라에서 dealerUserId로 merge하면 되고, profiles는 read 전용 계약이라 접점을 늘릴 이유가 없다.
// 브랜드명은 **leftJoin**: brand_id에 FK가 없어(정책) 삭제된 브랜드를 가리킬 수 있고, 그때 행이
// 사라지면 "브랜드 미지정"으로 고칠 기회조차 없어진다.
export async function listDealerProfiles(executor: Executor = getDefaultDb()) {
  return executor
    .select({
      dealerUserId: dealerProfiles.dealerUserId,
      brandId: dealerProfiles.brandId,
      brandName: brandsInCatalog.name,
      note: dealerProfiles.note,
    })
    .from(dealerProfiles)
    .leftJoin(brandsInCatalog, eq(brandsInCatalog.id, dealerProfiles.brandId));
}

// 브랜드·비고 저장(관리자). PK 충돌은 UPDATE로 흡수 = 신규/변경이 한 경로다.
// updated_at은 인라인 sql`now()` — 앱 시계로 찍으면 스탬프가 과거로 되돌아간다(#334·#335).
export async function upsertDealerProfile(
  input: { dealerUserId: string; brandId: number; note: string | null },
  executor: Executor = getDefaultDb(),
) {
  const [row] = await executor
    .insert(dealerProfiles)
    .values({ dealerUserId: input.dealerUserId, brandId: input.brandId, note: input.note })
    .onConflictDoUpdate({
      target: dealerProfiles.dealerUserId,
      set: { brandId: input.brandId, note: input.note, updatedAt: sql`now()` },
    })
    .returning();
  return row ?? null;
}
```

- [ ] **Step 4: 통과 확인**

```bash
bun test src/db/queries/dealer-profiles.test.ts
```

기대: PASS 2건

- [ ] **Step 5: db-bound registry 등록** (`src/test-utils/db-bound-tests.ts`)

`"src/db/queries/customer-delivery.test.ts",` 다음 줄에 알파벳 순으로 삽입:

```ts
  "src/db/queries/dealer-profiles.test.ts",
```

⚠️ 등록하지 않으면 CI `pure` step이 env 없이 이 파일을 돌려 실패한다(fail-closed 설계).

- [ ] **Step 6: 커밋**

```bash
git add src/db/queries/dealer-profiles.ts src/db/queries/dealer-profiles.test.ts src/test-utils/db-bound-tests.ts
git commit -m "feat(crm): 딜러 프로필 쿼리 — 브랜드·비고 upsert + 목록"
```

---

### Task 3: `/api/dealer/profiles` 라우트 (admin 전용)

**Files:**
- Create: `src/routes/dealer.ts`
- Create: `src/routes/dealer.role-gate.test.ts`
- Modify: `src/app.ts`
- Modify: `src/test-utils/db-bound-tests.ts`

- [ ] **Step 1: 실패하는 게이트 테스트 작성** (`src/routes/dealer.role-gate.test.ts`)

```ts
import { expect, test } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";

// ── /api/dealer/profiles role 게이트(admin 전용) ─────────────────────────────
// 딜러 브랜드 매칭은 조직 운영 정보다 — 조직 화면(GET /api/staff/org)과 같은 게이트를 쓴다.
// dealer 본인도 못 바꾼다(자기 브랜드를 스스로 바꾸면 소유권 검증이 무의미해진다).
async function reqFor(role: "admin" | "manager" | "staff" | "dealer", path: string, init?: RequestInit) {
  const { token, keyResolver, issuer } = await makeTestAuth(role, crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  return app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

const BODY = JSON.stringify({ brandId: 1, note: "동성모터스" });

for (const role of ["manager", "staff", "dealer"] as const) {
  test(`GET /api/dealer/profiles — ${role} 403`, async () => {
    expect((await reqFor(role, "/api/dealer/profiles")).status).toBe(403);
  });

  test(`PUT /api/dealer/profiles/:userId — ${role} 403 (게이트가 zod보다 앞)`, async () => {
    const res = await reqFor(role, `/api/dealer/profiles/${crypto.randomUUID()}`, { method: "PUT", body: BODY });
    expect(res.status).toBe(403);
  });
}

test("GET /api/dealer/profiles — admin 200", async () => {
  expect((await reqFor("admin", "/api/dealer/profiles")).status).toBe(200);
});
```

- [ ] **Step 2: 실패 확인**

```bash
bun test src/routes/dealer.role-gate.test.ts
```

기대: FAIL — 라우트가 없어 404(403 기대와 불일치)

- [ ] **Step 3: 라우터 구현** (`src/routes/dealer.ts`)

```ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { listDealerProfiles, upsertDealerProfile } from "../db/queries/dealer-profiles";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";
import { requireRoles } from "../middleware/role-gate";

// /api/dealer/* — 딜러 도메인. 지금은 **관리자용 브랜드 매칭만**이다(슬라이스 A).
// 딜러 본인용 제안 입력(GET /me · PUT /discounts/:trimId)은 슬라이스 B에서 같은 라우터에 붙고,
// 그때만 dealerWriteGate allowlist에 그 경로 하나가 등록된다 — /profiles는 딜러에게 계속 닫힌다.
export const dealer = new Hono<{ Variables: AuthVariables & DbVariables }>();

const userIdParam = z.object({ userId: z.string().uuid() });
// note는 딜러사명 한 줄이라 100자로 제한(빈 문자열은 null로 정규화 — "미입력"과 같은 뜻).
const profileBody = z.object({
  brandId: z.number().int().positive(),
  note: z.string().trim().max(100).nullable().optional(),
});

dealer.get("/profiles", requireRoles(["admin"]), async (c) => c.json(await listDealerProfiles(c.var.db)));

dealer.put(
  "/profiles/:userId",
  requireRoles(["admin"]),
  zValidator("param", userIdParam),
  zValidator("json", profileBody),
  async (c) => {
    const { userId } = c.req.valid("param");
    const { brandId, note } = c.req.valid("json");
    const row = await upsertDealerProfile(
      { dealerUserId: userId, brandId, note: note?.length ? note : null },
      c.var.db,
    );
    return c.json(row);
  },
);
```

- [ ] **Step 4: app.ts 배선** (`src/app.ts`)

import 블록에 추가(다른 라우트 import 옆):

```ts
import { dealer } from "./routes/dealer";
```

`protect("/api/me/*");` 다음 줄에 추가:

```ts
  protect("/api/dealer/*");
```

`app.route("/api/staff", staff);` 다음 줄에 추가:

```ts
  app.route("/api/dealer", dealer);
```

- [ ] **Step 5: 통과 확인**

```bash
bun test src/routes/dealer.role-gate.test.ts
```

기대: PASS 7건

- [ ] **Step 6: 변이 검증** — 게이트가 진짜 도는지 확인

`dealer.ts`의 `GET /profiles`에서 `requireRoles(["admin"]),`를 **일시 제거** → 테스트 재실행 →
manager/staff/dealer GET 3건이 **실패**하는 것을 눈으로 확인 → **원복** → `git status`가 clean인지 확인.

```bash
bun test src/routes/dealer.role-gate.test.ts   # 원복 후: PASS 7건
git status --short
```

- [ ] **Step 7: registry 등록** (`src/test-utils/db-bound-tests.ts`)

`admin 200` 케이스가 실 DB를 탄다. 라우트 테스트 섹션에 알파벳 순으로 삽입:

```ts
  "src/routes/dealer.role-gate.test.ts",
```

- [ ] **Step 8: 커밋**

```bash
git add src/routes/dealer.ts src/routes/dealer.role-gate.test.ts src/app.ts src/test-utils/db-bound-tests.ts
git commit -m "feat(crm): GET·PUT /api/dealer/profiles — 딜러 브랜드 매칭 (admin 전용)"
```

---

### Task 4: 조직 화면 UI — 브랜드 select + 비고

**Files:**
- Create: `client/src/lib/dealer-profiles.ts`
- Modify: `client/src/pages/OrgMembersPage.tsx`
- Modify: `client/src/index.css` (필요 시 셀 폭만)

- [ ] **Step 1: 클라 lib 작성** (`client/src/lib/dealer-profiles.ts`)

```ts
import { useCallback, useEffect, useState } from "react";

import { getJson, sendJson } from "./http";

// 딜러 브랜드 매칭(대표 전용) — `/org-members` 「구성원」 탭이 구성원 목록과 dealerUserId로 merge한다.
// 캐시하지 않는다: 이 화면에서 바로 편집하는 값이라 진입 시 1회 fetch가 정확하고 싸다.
export type DealerProfileEntry = {
  dealerUserId: string;
  brandId: number;
  brandName: string | null; // null = 브랜드가 삭제됨(FK 없음 — spec §3.1)
  note: string | null;
};

export function useDealerProfiles() {
  const [profiles, setProfiles] = useState<DealerProfileEntry[]>([]);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      setProfiles(await getJson<DealerProfileEntry[]>("/api/dealer/profiles"));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (dealerUserId: string, brandId: number, note: string | null) => {
      await sendJson(`/api/dealer/profiles/${dealerUserId}`, "PUT", { brandId, note });
      await reload();
    },
    [reload],
  );

  return { profiles, failed, save };
}
```

- [ ] **Step 2: OrgMembersPage에 컬럼 추가** (`client/src/pages/OrgMembersPage.tsx`)

import 추가:

```ts
import { fetchBrandsCached } from "@/pages/mc-master/catalog-cache";
import { useDealerProfiles, type DealerProfileEntry } from "@/lib/dealer-profiles";
```

컴포넌트 상단(`const { userId } = useAuth();` 다음)에 추가:

```tsx
  // 딜러 브랜드 매칭 — dealer 행에서만 쓰는 값이라 dealer가 없으면 아무 요청도 낭비되지 않는다
  // (목록이 비면 select 옵션이 없고 저장 버튼도 안 보인다).
  const { profiles: dealerProfiles, save: saveDealerProfile } = useDealerProfiles();
  const [brands, setBrands] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    void fetchBrandsCached().then((rows) => setBrands(rows.map((b) => ({ id: b.id, name: b.name }))));
  }, []);
```

`<thead>` 행에 컬럼 2개 추가(`<th>접근 범위</th>` 앞):

```tsx
<th>브랜드</th><th>비고</th>
```

`<td>{ROLE_ACCESS_SUMMARY[m.role] ?? "—"}</td>` 앞에 셀 2개 추가:

```tsx
                      {/* 브랜드·비고는 dealer 행에만 의미가 있다 — 다른 역할은 브랜드 개념이 없다.
                          저장 대상은 crm.dealer_profiles이므로 profiles read 전용 계약을 건드리지 않는다. */}
                      {m.role === "dealer" ? (
                        <DealerBrandCell
                          brands={brands}
                          entry={dealerProfiles.find((p) => p.dealerUserId === m.id)}
                          onSave={(brandId, note) => saveDealerProfile(m.id, brandId, note)}
                        />
                      ) : (
                        <>
                          <td>—</td>
                          <td>—</td>
                        </>
                      )}
```

- [ ] **Step 3: `DealerBrandCell` 컴포넌트 추가** (같은 파일 하단, `OrgMembersPage` 아래)

```tsx
// ⚠️ **Safari controlled select 함정**(전역 규칙): Safari는 팝오버 선택 시 input → React 복원 →
// change(구값) 순서로 발화해 **onChange만 들으면 선택이 통째로 유실**된다. 같은 핸들러를
// onChange + onInput에 병행 바인딩한다(setState 멱등이라 이중 발화는 무해).
function DealerBrandCell({
  brands,
  entry,
  onSave,
}: {
  brands: { id: number; name: string }[];
  entry: DealerProfileEntry | undefined;
  onSave: (brandId: number, note: string | null) => Promise<void>;
}) {
  const [brandId, setBrandId] = useState<number | null>(entry?.brandId ?? null);
  const [note, setNote] = useState(entry?.note ?? "");
  const dirty = brandId !== null && (brandId !== entry?.brandId || note !== (entry?.note ?? ""));

  const pick = (e: SyntheticEvent<HTMLSelectElement>) => {
    const v = e.currentTarget.value;
    setBrandId(v ? Number(v) : null);
  };

  return (
    <>
      <td>
        <select value={brandId ?? ""} onChange={pick} onInput={pick}>
          <option value="">미지정</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        {/* 브랜드가 지정됐는데 이름이 없으면 그 브랜드가 삭제된 상태다(FK 없음 — spec §3.1) */}
        {entry && entry.brandName === null && <span className="badge yellow">브랜드 삭제됨</span>}
      </td>
      <td>
        <input
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          placeholder="동성모터스"
          maxLength={100}
        />
        {dirty && (
          <button onClick={() => void onSave(brandId!, note.trim() || null)} type="button">저장</button>
        )}
      </td>
    </>
  );
}
```

`SyntheticEvent`·`useState`·`useEffect` import를 파일 상단 react import에 합친다(deprecated
`FormEvent`/`ChangeEvent`를 쓰지 않는다 — TS6 관례):

```ts
import { useEffect, useState, type SyntheticEvent } from "react";
```

- [ ] **Step 4: 타입·린트 확인**

```bash
bun run typecheck && bun run lint
```

기대: 둘 다 0 problems

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/dealer-profiles.ts client/src/pages/OrgMembersPage.tsx
git commit -m "feat(crm): 조직 화면 딜러 브랜드·비고 매칭 UI"
```

---

### Task 5: 전체 검증 + 실화면 확인

**Files:** 없음(검증만)

- [ ] **Step 1: 검증 4종 + 테스트**

```bash
bun run typecheck && bun run lint && bun run knip && bun run format:check
```

기대: 전부 0. ⚠️ knip이 미사용 export를 잡으면(예: `DealerProfileEntry`가 안 쓰이면) 그 export를 지운다 —
`knip.json` 예외 등록은 정당한 사유가 있을 때만.

```bash
bun run test:unit && bun run test:pure && bun run build
```

- [ ] **Step 2: 실 DB 테스트(로컬 전용)**

```bash
bun test src/db/queries/dealer-profiles.test.ts src/routes/dealer.role-gate.test.ts
```

기대: PASS 9건. 이어서 잔재가 남지 않았는지 확인:

```bash
bun run check:residue
```

- [ ] **Step 3: 실화면 눈 확인 1회**

`PUSH_NOTIFY=off bun dev`로 띄우고 magiclink 절차(AGENTS.md "로컬 브라우저 스모크 로그인 우회")로
자메스관리자(admin)로 로그인 → 설정 메뉴 → 조직 / 구성원 → dealer 행(`김지안수령님의개`)에서:

1. 브랜드 select에 BMW 지정 → 비고 "동성모터스" 입력 → [저장] → 리로드 후에도 유지되는지
2. **Safari에서도** select 선택이 반영되는지(Chrome만 확인하면 이 함정을 못 잡는다)
3. dealer 아닌 행(admin·staff·manager)은 브랜드·비고가 `—`인지

- [ ] **Step 4: 스모크 데이터 정리 판단**

공유 master이므로 스모크로 만든 딜러 프로필 행은 **남길지 지울지 결정**한다. 슬라이스 B의 딜러 모드
검증에 그 매칭이 필요하니 **남기는 쪽을 권한다**(유슨생 확인 후 결정).

- [ ] **Step 5: PR 올리기**

```bash
git push -u origin 0727-dealer-brand-mapping
gh pr create --title "feat(crm): 딜러 브랜드 매칭 (슬라이스 A)" --body "$(cat <<'EOF'
## 요약
관리자가 조직 화면에서 딜러 계정에 **브랜드와 비고(딜러사명)** 를 지정할 수 있게 한다.
딜러 할인 제안 → 관리자 채택 기능(spec §1)의 **선행 슬라이스**다 — 딜러는 브랜드가 지정되기
전까지 아무것도 쓸 수 없다(서버 fail-closed 403).

## 변경
- `crm.dealer_profiles` 신설(마이그 0039) — PK = `dealer_user_id`로 "한 딜러 = 한 브랜드" 강제
- `GET·PUT /api/dealer/profiles` — **admin 전용**(`requireRoles`, manager·staff·dealer 403)
- `/org-members` 「구성원」 탭 dealer 행에 브랜드 select + 비고 입력

## 설계 근거
- `brand_id`에 FK 미도입: NOT NULL이라 SET NULL 불가, RESTRICT는 catalog(앱 공유) 소유권 침범
- `public.profiles`는 읽지도 쓰지도 않음 — 브랜드·비고는 crm 소유 데이터(read 전용 계약 무접촉)
- spec: `ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md`

## 검증
typecheck 0 · lint 0 · knip 0 · format 0 · unit · pure · build · 실 DB 9건 · 실화면(Chrome+Safari) 1회

## 🟡 행위 변경
조직 화면에 컬럼 2개(브랜드·비고)가 늘어난다. 이사님이 직접 요구한 기능이라 pending 등재는 하지 않는다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

⚠️ 커밋 메시지에 CI 스킵 마커를 넣지 않는다(squash 시 CF Pages 배포가 통째로 스킵된다).

---

## 슬라이스 A 완료 후

- **슬라이스 B**(딜러 제안 입력): `crm.dealer_trim_discounts` + `PUT /api/dealer/discounts/:trimId` +
  `DEALER_WRITE_ALLOWLIST` 1줄 + 브랜드 소유권 검증(`trims → models.brand_id`) + MC 마스터 딜러 모드
- **슬라이스 C**(관리자 채택): `crm.catalog_discount_adoptions` + 채택 트랜잭션 +
  할인 셀 팝오버 + 상태 파생(채택됨/수정됨/미채택/자격상실)

각각 별도 계획으로 쓴다(spec §3.2·§3.3·§4·§6·§7 참조).
