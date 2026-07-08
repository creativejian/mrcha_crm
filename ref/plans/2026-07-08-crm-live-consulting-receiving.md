# 실시간 상담 수신 On/Off 영속 + 배정 드롭다운 필터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상담사 개인별 실시간 상담 수신 On/Off를 `crm.staff_settings`에 영속하고, 실시간 상담 콘솔의 배정 드롭다운에서 수신 Off 상담사를 후보에서 제외한다.

**Architecture:** 저장소는 `crm.staff_settings` 신설(CRM 내부용, 앱 미소비). 자기 수신 상태는 신규 백엔드 `GET/PATCH /api/me/live-consulting`. 배정 필터는 `GET /api/staff` 응답에 `liveReceiving`를 비파괴 추가하고, 실시간 상담 배정 select를 supabase-js 직결 `fetchStaffOptions` → 백엔드 `GET /api/staff`로 통합(중복 경로 제거)한 뒤 후보만 필터한다.

**Tech Stack:** Hono + drizzle(crm 스키마, master 직결) + zod / React + vitest / bun:test(실 master DB) / drizzle-kit(`schemaFilter:["crm"]`).

**참조 spec:** `ref/specs/2026-07-08-crm-live-consulting-receiving-design.md`

---

## File Structure

**생성:**
- `drizzle/0024_*.sql` — `db:generate` 자동 생성(`crm.staff_settings` DDL)
- `src/db/queries/staff-settings.ts` — `getLiveReceiving`·`setLiveReceiving`(upsert)
- `src/routes/me.ts` — `GET/PATCH /api/me/live-consulting`
- `src/routes/me.test.ts` — 401·기본 true·upsert 왕복
- `client/src/lib/live-consulting.ts` — `fetchLiveConsulting`·`saveLiveConsulting`
- `client/src/lib/live-consulting.test.ts`

**수정:**
- `src/db/schema.ts` — `staffSettings` 테이블 추가
- `src/app.ts` — `/api/me` 라우트 배선
- `src/routes/staff.ts` — `liveReceiving`(LEFT JOIN + coalesce)
- `src/routes/staff.test.ts` — `liveReceiving` 검증
- `client/src/lib/staff.ts` — `StaffEntry.liveReceiving`
- `client/src/lib/staff.test.ts` — `ROWS` 목업에 `liveReceiving`
- `client/src/lib/chat.ts` — `fetchStaffOptions`·`StaffOption` 제거
- `client/src/lib/chat-data.test.ts` — `fetchStaffOptions` 케이스 제거(`getStaffId`는 유지)
- `client/src/pages/ChatPage.tsx` — `fetchStaffDirectory` 사용
- `client/src/components/chat/ChatSessionHeader.tsx` — `StaffEntry`·후보 필터
- `client/src/components/Topbar.tsx` — 마운트 로드 + 저장(낙관·롤백)

---

## Task 1: crm.staff_settings 스키마 + 마이그레이션

**Files:**
- Modify: `src/db/schema.ts` (`assistantMessages` 정의 뒤, 파일 끝)
- Create: `drizzle/0024_*.sql` (자동 생성)

- [ ] **Step 1: schema.ts에 staffSettings 테이블 추가**

`src/db/schema.ts` 맨 끝(`assistantMessages` 블록 뒤)에 추가한다. `boolean`은 이미 파일 상단 `drizzle-orm/pg-core` import에 포함되어 있다(라인 6).

```ts
// 상담사 개인 설정 — 실시간 상담 수신 On/Off(배정 드롭다운 필터·Topbar 토글의 영속 소스).
// staff_user_id=JWT sub(profiles.id), loose id(public FK 보류 관례). CRM 내부용(앱 미소비).
export const staffSettings = crm.table("staff_settings", {
  staffUserId: uuid("staff_user_id").primaryKey(),
  liveReceiving: boolean("live_receiving").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: 마이그레이션 생성**

Run: `bun run db:generate`
Expected: `drizzle/0024_*.sql` 생성. 내용에 `CREATE TABLE "crm"."staff_settings"`가 있고 `staff_user_id`·`live_receiving boolean ... DEFAULT true`·`updated_at`만 포함(public/catalog 테이블 DROP/변경 문구가 **없어야** 함 — 있으면 즉시 중단).

- [ ] **Step 3: 생성된 SQL 검토**

Run: `cat drizzle/0024_*.sql`
Expected: `CREATE TABLE IF NOT EXISTS "crm"."staff_settings" (...)` 한 문장. crm 외 스키마 언급 0.

- [ ] **Step 4: 마이그레이션 적용**

Run: `bun run db:migrate`
Expected: 성공(신규 마이그레이션 1건 적용).

- [ ] **Step 5: psql로 테이블 실측**

Run: `psql "$DATABASE_URL" -c "\d crm.staff_settings"`
Expected: `staff_user_id uuid PK`, `live_receiving boolean not null default true`, `updated_at timestamptz not null default now()`.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(crm): crm.staff_settings 테이블 — 상담사 실시간 상담 수신 On/Off 영속"
```

---

## Task 2: me 라우트 + staff-settings 쿼리 + 배선 (TDD)

**Files:**
- Create: `src/db/queries/staff-settings.ts`
- Create: `src/routes/me.ts`
- Create: `src/routes/me.test.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `src/routes/me.test.ts`. `staff_settings.staff_user_id`가 uuid PK라 `makeTestAuth`에 고정 UUID sub를 주입하고(기본 sub `"test-user"`는 uuid 아님), 실 master DB 오염 방지를 위해 각 케이스 전/후로 그 행을 삭제한다.

```ts
import { test, expect, afterAll, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { staffSettings } from "../db/schema";

// 실 master DB 오염 방지용 고정 UUID(다른 테스트 sub와 겹치지 않는 값).
const TEST_SUB = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const db = getDefaultDb();

async function clean() {
  await db.delete(staffSettings).where(eq(staffSettings.staffUserId, TEST_SUB));
}
beforeEach(clean);
afterAll(clean);

test("GET /api/me/live-consulting 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("staff", TEST_SUB);
  const app = createApp({ keyResolver, issuer });
  expect((await app.request("/api/me/live-consulting")).status).toBe(401);
});

test("GET → 설정 없으면 기본 receiving:true", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("staff", TEST_SUB);
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/me/live-consulting", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ receiving: true });
});

test("PATCH off → GET off → PATCH on (upsert 왕복)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("staff", TEST_SUB);
  const app = createApp({ keyResolver, issuer });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const off = await app.request("/api/me/live-consulting", { method: "PATCH", headers, body: JSON.stringify({ receiving: false }) });
  expect(off.status).toBe(200);
  expect(await off.json()).toEqual({ receiving: false });

  const get = await app.request("/api/me/live-consulting", { headers: { Authorization: `Bearer ${token}` } });
  expect(await get.json()).toEqual({ receiving: false });

  const on = await app.request("/api/me/live-consulting", { method: "PATCH", headers, body: JSON.stringify({ receiving: true }) });
  expect(await on.json()).toEqual({ receiving: true });
});

test("PATCH 잘못된 body → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("staff", TEST_SUB);
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/me/live-consulting", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ receiving: "nope" }),
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:server src/routes/me.test.ts`
Expected: FAIL — `staffSettings` import 실패 또는 라우트 404. (전체 `bun run test:server`가 아닌 파일 지정 실행: `test:server`는 `--env-file=.env.local` + `EMBED_ON_WRITE=off` 프리픽스가 붙어 있어 파일 인자를 그대로 전달한다. me 라우트는 임베딩 훅과 무관하지만 관례상 `bun run test:server`로 돌린다.)

- [ ] **Step 3: staff-settings 쿼리 모듈 작성**

Create `src/db/queries/staff-settings.ts`:

```ts
import { eq } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { staffSettings } from "../schema";

// 상담사 실시간 상담 수신 상태 — 행 없으면 기본 On(true).
export async function getLiveReceiving(userId: string, ex: Executor = getDefaultDb()): Promise<boolean> {
  const [row] = await ex
    .select({ receiving: staffSettings.liveReceiving })
    .from(staffSettings)
    .where(eq(staffSettings.staffUserId, userId));
  return row?.receiving ?? true;
}

// upsert(상담사당 1행). updated_at 갱신.
export async function setLiveReceiving(userId: string, receiving: boolean, ex: Executor = getDefaultDb()): Promise<boolean> {
  await ex
    .insert(staffSettings)
    .values({ staffUserId: userId, liveReceiving: receiving, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: staffSettings.staffUserId,
      set: { liveReceiving: receiving, updatedAt: new Date() },
    });
  return receiving;
}
```

- [ ] **Step 4: me 라우트 작성**

Create `src/routes/me.ts`:

```ts
import { Hono } from "hono";
import { z } from "zod";

import { getLiveReceiving, setLiveReceiving } from "../db/queries/staff-settings";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";

// 로그인 상담사 본인 개인 설정(/api/me/*). self만 접근하므로 역할 scope 무관 — auth 미들웨어만 통과하면 된다.
export const me = new Hono<{ Variables: AuthVariables & DbVariables }>();

me.get("/live-consulting", async (c) => {
  const receiving = await getLiveReceiving(c.var.user.id, c.var.db);
  return c.json({ receiving });
});

const patchSchema = z.object({ receiving: z.boolean() });

me.patch("/live-consulting", async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "잘못된 요청입니다." }, 400);
  const receiving = await setLiveReceiving(c.var.user.id, parsed.data.receiving, c.var.db);
  return c.json({ receiving });
});
```

- [ ] **Step 5: app.ts에 배선**

`src/app.ts`를 수정한다. `staff` 라우트 import 옆에 `me` import를 추가하고, `/api/staff/*` 미들웨어/라우트 블록 뒤에 `/api/me`를 추가한다.

import 구역(기존 라우트 import들과 같은 위치):
```ts
import { me } from "./routes/me";
```

미들웨어 배선(라인 39~40 `/api/staff/*` 뒤):
```ts
  app.use("/api/me/*", auth);
  app.use("/api/me/*", dbMiddleware);
```

라우트 등록(라인 47 `app.route("/api/staff", staff)` 뒤):
```ts
  app.route("/api/me", me);
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `bun run test:server src/routes/me.test.ts`
Expected: PASS (4 케이스).

- [ ] **Step 7: Commit**

```bash
git add src/db/queries/staff-settings.ts src/routes/me.ts src/routes/me.test.ts src/app.ts
git commit -m "feat(crm): GET/PATCH /api/me/live-consulting — 상담사 수신 상태 조회·저장"
```

---

## Task 3: GET /api/staff에 liveReceiving 추가 (TDD)

**Files:**
- Modify: `src/routes/staff.test.ts`
- Modify: `src/routes/staff.ts`

- [ ] **Step 1: 실패 테스트 추가**

`src/routes/staff.test.ts` 끝에 추가한다. 실 profile 하나에 수신 Off를 upsert해 `liveReceiving:false`가 응답에 반영되는지, 설정 없는 계정은 `true`인지 검증하고 **원복**한다. 원복이 실 데이터를 훼손하지 않도록 `setLiveReceiving` 호출 전에 그 행의 **실제 존재 여부를 직접 select로 확인**한다(있으면 원값 복원, 없으면 신설 행 삭제 = 기본 true 복귀). **아래 4개 import는 파일 상단 import 구역에 배치하고**(lint import/order — 기존 `drizzle-orm`/`../app` import들과 함께 정렬), **`test(...)` 블록만 파일 끝에 추가**한다.

```ts
import { setLiveReceiving } from "../db/queries/staff-settings";
import { getDefaultDb } from "../db/client";
import { staffSettings } from "../db/schema";
import { eq } from "drizzle-orm";

test("GET /api/staff → liveReceiving 포함(설정 없으면 true, Off 계정은 false) — 실 DB", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });

  const first = (await (await app.request("/api/staff", { headers: { Authorization: `Bearer ${token}` } })).json()) as { id: string; liveReceiving: boolean }[];
  expect(first.length).toBeGreaterThan(0);
  for (const r of first) expect(typeof r.liveReceiving).toBe("boolean");

  // 첫 후보를 Off로 만들고 반영 확인 → 원복. 원복 정확성을 위해 기존 행 존재/원값을 직접 확인.
  const target = first[0].id;
  const db = getDefaultDb();
  const [existing] = await db
    .select({ v: staffSettings.liveReceiving })
    .from(staffSettings)
    .where(eq(staffSettings.staffUserId, target));
  try {
    await setLiveReceiving(target, false, db);
    const after = (await (await app.request("/api/staff", { headers: { Authorization: `Bearer ${token}` } })).json()) as { id: string; liveReceiving: boolean }[];
    expect(after.find((r) => r.id === target)?.liveReceiving).toBe(false);
  } finally {
    if (existing) await setLiveReceiving(target, existing.v, db); // 원값 복원
    else await db.delete(staffSettings).where(eq(staffSettings.staffUserId, target)); // 이 테스트가 만든 행 제거
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:server src/routes/staff.test.ts`
Expected: FAIL — 응답에 `liveReceiving` 필드 없음.

- [ ] **Step 3: staff.ts 라우트에 LEFT JOIN + coalesce**

`src/routes/staff.ts`를 수정한다. import에 `sql`·`eq`와 `staffSettings`를 추가하고, select에 `liveReceiving`를 추가한 뒤 leftJoin한다.

```ts
import { Hono } from "hono";
import { asc, eq, inArray, sql } from "drizzle-orm";

import { profiles } from "../db/public-app";
import { staffSettings } from "../db/schema";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";

export const ADVISOR_ROLES = ["admin", "manager", "staff"] as const;

export const staff = new Hono<{ Variables: AuthVariables & DbVariables }>();

staff.get("/", async (c) => {
  const rows = await c.var.db
    .select({
      id: profiles.id,
      name: profiles.fullName,
      role: profiles.role,
      // 실시간 상담 수신 상태 — 설정 없는 계정은 기본 On(true). 실시간 상담 배정 select만 소비(고객 담당자 배정은 무시).
      liveReceiving: sql<boolean>`coalesce(${staffSettings.liveReceiving}, true)`,
    })
    .from(profiles)
    .leftJoin(staffSettings, eq(staffSettings.staffUserId, profiles.id))
    .where(inArray(profiles.role, [...ADVISOR_ROLES]))
    .orderBy(asc(profiles.fullName), asc(profiles.id));
  return c.json(rows.filter((r) => r.name?.trim()));
});
```

기존 주석(ADVISOR_ROLES 근거·orderBy 근거·이름 없는 계정 제외)은 유지하되 위 코드에 맞춰 배치한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:server src/routes/staff.test.ts`
Expected: PASS(기존 2 + 신규 1).

- [ ] **Step 5: Commit**

```bash
git add src/routes/staff.ts src/routes/staff.test.ts
git commit -m "feat(crm): GET /api/staff에 liveReceiving 추가(staff_settings LEFT JOIN, 기본 true)"
```

---

## Task 4: 프론트 lib — live-consulting + StaffEntry 확장 (TDD)

**Files:**
- Create: `client/src/lib/live-consulting.test.ts`
- Create: `client/src/lib/live-consulting.ts`
- Modify: `client/src/lib/staff.ts`
- Modify: `client/src/lib/staff.test.ts`

- [ ] **Step 1: live-consulting 실패 테스트 작성**

Create `client/src/lib/live-consulting.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchLiveConsulting, saveLiveConsulting } from "./live-consulting";
import { getJson, sendJson } from "./http";

vi.mock("./http", () => ({ getJson: vi.fn(), sendJson: vi.fn() }));
const getJsonMock = vi.mocked(getJson);
const sendJsonMock = vi.mocked(sendJson);

afterEach(() => {
  getJsonMock.mockReset();
  sendJsonMock.mockReset();
});

describe("fetchLiveConsulting", () => {
  it("GET 응답 receiving 반환", async () => {
    getJsonMock.mockResolvedValue({ receiving: false });
    expect(await fetchLiveConsulting()).toBe(false);
    expect(getJsonMock).toHaveBeenCalledWith("/api/me/live-consulting");
  });
});

describe("saveLiveConsulting", () => {
  it("PATCH body {receiving} 전송, 응답 receiving 반환", async () => {
    sendJsonMock.mockResolvedValue({ receiving: true });
    expect(await saveLiveConsulting(true)).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith("/api/me/live-consulting", "PATCH", { receiving: true });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/live-consulting.test.ts`
Expected: FAIL — `live-consulting` 모듈 없음.

- [ ] **Step 3: live-consulting.ts 작성**

Create `client/src/lib/live-consulting.ts`:

```ts
import { getJson, sendJson } from "./http";

// 실시간 상담 수신 On/Off — 로그인 상담사 자기 상태. crm.staff_settings 영속(GET/PATCH /api/me/live-consulting).
export async function fetchLiveConsulting(): Promise<boolean> {
  const { receiving } = await getJson<{ receiving: boolean }>("/api/me/live-consulting");
  return receiving;
}

export async function saveLiveConsulting(receiving: boolean): Promise<boolean> {
  const res = await sendJson<{ receiving: boolean }>("/api/me/live-consulting", "PATCH", { receiving });
  return res.receiving;
}
```

- [ ] **Step 4: live-consulting 테스트 통과**

Run: `bun run test:unit client/src/lib/live-consulting.test.ts`
Expected: PASS(2).

- [ ] **Step 5: StaffEntry에 liveReceiving 추가**

`client/src/lib/staff.ts` 라인 8을 수정하고 캐시 주석(라인 5~7)을 보강한다.

```ts
// 직원 디렉토리(GET /api/staff — profiles CRM 역할). 담당자 배정 select의 후보 목록으로,
// 배정 저장이 advisorId(uuid)를 동봉해야 역할 scope(staff=본인 담당)가 성립한다(#176).
// 세션 내 캐시: 이름/역할은 세션 중 불변이라 TTL 없이 1회 fetch + inflight dedupe.
// liveReceiving(수신 On/Off)은 가변이지만 배정 콘솔 실시간성 요구가 낮아 캐시 stale 허용(재진입 시 최신).
export type StaffEntry = { id: string; name: string; role: string; liveReceiving: boolean };
```

- [ ] **Step 6: staff.test.ts ROWS 목업 갱신**

`client/src/lib/staff.test.ts` 라인 9~12 `ROWS`에 `liveReceiving`를 추가한다(타입 확장에 맞춤).

```ts
const ROWS = [
  { id: "11111111-1111-1111-1111-111111111111", name: "김지안", role: "admin", liveReceiving: true },
  { id: "22222222-2222-2222-2222-222222222222", name: "강현준", role: "manager", liveReceiving: false },
];
```

- [ ] **Step 7: staff 테스트 통과**

Run: `bun run test:unit client/src/lib/staff.test.ts`
Expected: PASS(기존 케이스 전부).

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/live-consulting.ts client/src/lib/live-consulting.test.ts client/src/lib/staff.ts client/src/lib/staff.test.ts
git commit -m "feat(crm): live-consulting lib + StaffEntry.liveReceiving"
```

---

## Task 5: 실시간 상담 배정 경로 통합 (chat.ts 정리 + ChatPage/ChatSessionHeader)

**Files:**
- Modify: `client/src/lib/chat.ts`
- Modify: `client/src/lib/chat-data.test.ts`
- Modify: `client/src/pages/ChatPage.tsx`
- Modify: `client/src/components/chat/ChatSessionHeader.tsx`

- [ ] **Step 1: chat.ts에서 fetchStaffOptions·StaffOption 제거**

`client/src/lib/chat.ts` 라인 190~203(`export type StaffOption` + `export async function fetchStaffOptions`)을 삭제한다. `getStaffId`(라인 182~188)·`insertSystemMessage`·`assignSession` 등 나머지는 유지한다.

- [ ] **Step 2: chat-data.test.ts에서 fetchStaffOptions 케이스 제거**

`client/src/lib/chat-data.test.ts`의 `describe("fetchStaffOptions / getStaffId", ...)`에서 `fetchStaffOptions`를 매핑하는 `it`(라인 185~191 근처)을 삭제하고, `describe` 이름을 `"getStaffId"`로 바꾼다. import 목록에서 `fetchStaffOptions`를 제거한다(`getStaffId`는 유지). `getStaffId` `it`은 그대로 둔다.

변경 후 형태:
```ts
describe("getStaffId", () => {
  it("getStaffId는 JWT claims sub를 반환한다", async () => {
    expect(await getStaffId()).toBe("staff-1");
  });
});
```

- [ ] **Step 3: ChatPage.tsx가 fetchStaffDirectory 사용**

`client/src/pages/ChatPage.tsx`를 수정한다. import·state 타입·effect를 교체한다.

라인 4 교체:
```ts
import { getStaffId } from "@/lib/chat";
import { fetchStaffDirectory, type StaffEntry } from "@/lib/staff";
```

라인 26 교체:
```ts
  const [staffOptions, setStaffOptions] = useState<StaffEntry[]>([]);
```

라인 28~31 effect 교체:
```ts
  useEffect(() => {
    getStaffId().then(setStaffId).catch(() => setStaffId(null));
    fetchStaffDirectory().then(setStaffOptions).catch(() => setStaffOptions([]));
  }, []);
```

(라인 62 `<ChatSessionHeader ... staffOptions={staffOptions} />`는 그대로 — props 타입만 Task 5 Step 4에서 바뀐다.)

- [ ] **Step 4: ChatSessionHeader가 StaffEntry + 후보 필터**

`client/src/components/chat/ChatSessionHeader.tsx`를 수정한다.

라인 3 교체(StaffOption 타입 import 제거) + StaffEntry import 추가:
```ts
import { assignSession, returnSessionToAi, takeOverSession, type ChatSession } from "@/lib/chat";
import type { StaffEntry } from "@/lib/staff";
```

라인 9 props 타입 교체:
```ts
  staffOptions: StaffEntry[];
```

라인 23(`assignedName`) 아래에 배정 후보(수신 On만) 파생을 추가한다. **`assignedName`은 전체 목록에서 해석**(필터 전) — Off인데 이미 배정된 상담사 이름 표시가 깨지지 않도록:
```ts
  const assignedName = staffOptions.find((option) => option.id === session.assignedStaffId)?.name ?? null;
  // 배정 후보는 수신 On 상담사만(Off는 자리 비움 → 새 배정 불가). 이름 해석은 위 전체 목록에서.
  const assignable = staffOptions.filter((option) => option.liveReceiving);
```

배정 select(라인 51·55) `staffOptions` → `assignable`:
```tsx
              disabled={busy || assignable.length === 0}
              {...assignBind}
            >
              <option value="">배정…</option>
              {assignable.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
```

- [ ] **Step 5: typecheck + lint + 관련 테스트**

Run: `bun run typecheck`
Expected: 0 errors.

Run: `bun run lint`
Expected: 0 problems.

Run: `bun run test:unit client/src/lib/chat-data.test.ts`
Expected: PASS(`getStaffId` 케이스 유지, `fetchStaffOptions` 제거됨).

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/chat.ts client/src/lib/chat-data.test.ts client/src/pages/ChatPage.tsx client/src/components/chat/ChatSessionHeader.tsx
git commit -m "feat(crm): 실시간 상담 배정을 GET /api/staff로 통합 + 수신 Off 상담사 후보 제외"
```

---

## Task 6: Topbar 마운트 로드 + 저장(낙관·롤백)

**Files:**
- Modify: `client/src/components/Topbar.tsx`

Topbar는 거대 컴포넌트라 유닛 테스트 대신 typecheck/lint + 브라우저 스모크(Task 7)로 검증한다. Topbar에는 `onToast` prop이 없으므로 저장 실패는 조용히 롤백한다(수신 토글은 재시도 가능한 보조 동작 — `lib/staff.ts` "배정은 재시도 가능한 보조 동작이라 에러 UI를 띄우지 않는다"와 동일 정신).

- [ ] **Step 1: import 추가**

`client/src/components/Topbar.tsx` 상단 import 구역에 추가:
```ts
import { fetchLiveConsulting, saveLiveConsulting } from "@/lib/live-consulting";
```

- [ ] **Step 2: 마운트 시 수신 상태 로드**

라인 139 `const [liveConsulting, setLiveConsulting] = useState(true);` 아래에 effect를 추가한다. `dealerMode`(라인 159 파생)는 이 effect보다 아래에 정의되어 있으므로, effect는 `roleTab`으로 딜러 여부를 직접 판정한다(딜러는 수신 개념 없음 → 스킵, GET 실패는 기본 true 유지).

라인 139 바로 아래(다른 `useEffect`들과 같은 위치, 훅 순서 유지 위해 컴포넌트 상단부)에 추가:
```ts
  // 실시간 상담 수신 상태는 crm.staff_settings 영속(SSOT) — 마운트 시 로드(딜러 제외).
  // 로드 실패 시 기본 true(수신 중) 유지 — 기존 동작과 동일해 회귀 0.
  useEffect(() => {
    if (roleTab === "딜러") return;
    fetchLiveConsulting().then(setLiveConsulting).catch(() => undefined);
  }, [roleTab]);
```

(주의: 이 `useEffect`는 라인 136~138의 기존 `useEffect`(aiThread) 바로 뒤, `const [liveConsulting...]` 선언 직후에 두어 훅 호출 순서를 안정적으로 유지한다. `const [liveConsulting...]`을 먼저 선언한 뒤 effect를 배치할 것.)

- [ ] **Step 3: 확인 다이얼로그 저장에 낙관·롤백 배선**

라인 565의 확인 버튼 `onClick`을 교체한다. 현재:
```tsx
onClick={() => { setLiveConsulting(confirmMode === "on"); setConfirmMode(null); }}
```
교체:
```tsx
onClick={() => {
  const next = confirmMode === "on";
  const prev = liveConsulting;
  setLiveConsulting(next);        // 낙관적 반영
  setConfirmMode(null);
  void saveLiveConsulting(next).catch(() => setLiveConsulting(prev)); // 실패 시 롤백(조용히)
}}
```

- [ ] **Step 4: typecheck + lint**

Run: `bun run typecheck`
Expected: 0 errors.

Run: `bun run lint`
Expected: 0 problems.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Topbar.tsx
git commit -m "feat(crm): Topbar 실시간 상담 수신 토글 영속(마운트 로드 + 저장 낙관·롤백)"
```

---

## Task 7: 최종 검증 + 브라우저 스모크

**Files:** (없음 — 검증만)

- [ ] **Step 1: 전체 서버 테스트**

Run: `bun run test:server`
Expected: 기존 + 신규(me 4, staff liveReceiving 1) 전부 PASS.

- [ ] **Step 2: 전체 프론트 테스트**

Run: `bun run test:unit`
Expected: 기존 + 신규(live-consulting 2) 전부 PASS, 제거분(chat-data fetchStaffOptions) 회귀 없음.

- [ ] **Step 3: typecheck + lint + build**

Run: `bun run typecheck && bun run lint && bun run build`
Expected: 0 errors · 0 problems · build 성공.

- [ ] **Step 4: 브라우저 스모크(magiclink 세션)**

`CLAUDE.md`의 magiclink 우회 절차로 admin(자메스관리자) 세션 수립 후:
1. Topbar 계정 설정 → 실시간 상담 Off 저장 → **새로고침(재로그인) 후 Off로 복원** 확인.
2. `psql "$DATABASE_URL" -c "select * from crm.staff_settings"`로 해당 admin 행 `live_receiving=false` 실측.
3. 실시간 상담 콘솔(ChatPage) 진입 → 대기 세션의 배정 드롭다운에 **Off 상담사가 후보에서 빠짐** 확인(다른 상담사 하나를 Off로 만들어 검증).
4. Off 상담사가 이미 배정된 세션이 있으면 헤더 "담당 {이름}" 표시가 **유지**되는지 확인(assignedName 전체 해석).
5. 스모크로 만든 `crm.staff_settings` 행은 원복: `psql "$DATABASE_URL" -c "delete from crm.staff_settings where staff_user_id in ('<admin>','<off상담사>')"`.

- [ ] **Step 5: 최종 커밋(있으면) 및 브랜치 상태 확인**

Run: `git status --short && git log --oneline -8`
Expected: 작업트리 clean, Task 1~6 커밋 7건(spec 포함 8) 확인.

---

## Self-Review 메모(작성자)

- **spec 커버리지**: §3 데이터모델→Task1, §4.1 me 라우트→Task2, §4.2 staff 확장→Task3, §5.1 Topbar→Task6, §5.2 배정 통합→Task4~5, §7 검증→각 Task+Task7. 전부 매핑됨.
- **타입 일관성**: `StaffEntry`(id·name·role·liveReceiving)를 Task4에서 정의하고 Task5(ChatSessionHeader·ChatPage)·Task3(서버 응답 형태 일치)에서 소비. `{receiving:boolean}` 계약은 Task2(서버)↔Task4(클라 lib)↔Task6(Topbar) 일치. PATCH 메서드는 `sendJson`의 지원 메서드(POST|PATCH|DELETE)와 일치.
- **범위**: takeOver·캐시 완전 실시간은 spec §6/§8 follow-up으로 명시, 이 plan 범위 밖.
