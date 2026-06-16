# catalog 동기화 UI (sync 2단계) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 로 task-by-task 구현. 스텝은 체크박스(`- [ ]`)로 추적.

**Goal:** `mc-master`(엠씨 마스터) 화면에서 운영자가 버튼으로 master→catalog 동기화를 실행하고, 테이블별 건수·결과를 본다.

**Architecture:** sync 1단계의 `runSync()`를 CLI/API가 공유하도록 분리하고, Hono `POST /api/catalog/sync`·`GET /api/catalog/counts`로 노출. MCMasterPage(31줄 스텁)를 건수 카드 + 동기화 버튼(최고관리자) + 결과 패널로 교체. public 테이블 0 유지(무저장 MVP).

**Tech Stack:** Hono, drizzle(postgres-js), bun test(서버 통합), vitest+@testing-library(클라 mock), React 19.

**설계 근거:** `ref/specs/2026-06-16-catalog-sync-ui-design.md` (승인됨).

**검증된 패턴:**
- 클라 fetch: `client/src/lib/vehicles.ts`의 `getJson<T>` (fetch → `res.ok` → throw/json)
- 클라 테스트: `VehiclePicker.test.tsx`의 `vi.stubGlobal("fetch", vi.fn(...))` + `findByText`("불러오기 실패" 에러 텍스트 관례)
- 라우트 테스트: `vehicles.test.ts`의 `app.request("/api/...")` (bun test, 실 catalog 통합)
- `RoleTab` = `"최고관리자" | "팀장" | "상담사" | "딜러"` (`client/src/data/roles.ts`)
- CSS: `--line: #e5e5e3`, `.card`/`.panel-head`/`.mini-card`/`.notice-box`/`.primary` 존재

---

## File Structure

- **수정** `src/sync/sync.ts` — `runSync()` export + `TableResult` export + `import.meta.main` 가드 (CLI/API 공유)
- **신규** `src/db/queries/catalog-counts.ts` — `getCatalogCounts()` 7테이블 활성 건수
- **신규** `src/routes/catalog.ts` — `GET /counts`, `POST /sync`(409 가드)
- **수정** `src/app.ts` — `app.route("/api/catalog", catalog)`
- **신규** `client/src/lib/catalog.ts` — `fetchCatalogCounts`/`runCatalogSync` + 타입
- **수정** `client/src/pages/MCMasterPage.tsx` — 건수 + 버튼 + 결과로 교체
- **수정** `client/src/App.tsx` — `<MCMasterPage roleTab={roleTab} />`
- **수정** `client/src/index.css` — 결과 패널 최소 CSS
- **신규 테스트** `src/db/queries/catalog-counts.test.ts`, `src/routes/catalog.test.ts`, `client/src/lib/catalog.test.ts`, `client/src/pages/MCMasterPage.test.tsx`

---

## Task 1: 서버 sync 재사용 분리

**Files:**
- Modify: `src/sync/sync.ts`

`runSync()`는 실 master+catalog IO라 단위테스트 부적합 → 검증된 1단계 로직 추출이므로 **`bun run sync` 회귀 + typecheck**로 검증.

- [ ] **Step 1: `TableResult` export + `runSync` 분리 + `import.meta.main` 가드**

`src/sync/sync.ts`에서 `type TableResult`를 `export type TableResult`로 바꾸고, 파일 하단의 `main()` + `await main()`을 아래로 교체:

```ts
// 재사용: 전체 테이블 sync 실행 후 결과 배열 반환. 연결을 끊지 않음(서버가 유지).
// onTable 콜백으로 CLI는 테이블별 실시간 로그 유지, API(runSync())는 생략.
export async function runSync(onTable?: (r: TableResult) => void): Promise<TableResult[]> {
  const results: TableResult[] = [];
  for (const meta of syncTables) {
    const r = await syncTable(meta);
    onTable?.(r);
    results.push(r);
  }
  return results;
}

// CLI 엔트리: runSync + 요약 + 연결 종료. `bun run sync`로 직접 실행할 때만 동작.
async function main(): Promise<void> {
  console.log("catalog full-sync 시작\n");
  const results = await runSync((r) => {
    const flag = r.complete ? "OK" : "SKIP(soft-delete)";
    console.log(
      `  ${r.name.padEnd(22)} fetch ${r.fetched}/${r.total} · upsert ${r.upserted} · soft-delete ${r.softDeleted} · 검증 ${flag}`,
    );
  });
  const incomplete = results.filter((r) => !r.complete);
  console.log("\ncatalog full-sync 완료.");
  if (incomplete.length) {
    console.warn(
      `경고: ${incomplete.map((r) => r.name).join(", ")} 불완전 fetch → soft-delete 스킵됨. 재실행 권장.`,
    );
  }
  await db.$client.end();
}

// Bun 진입 모듈일 때만 실행. 라우트가 runSync를 import할 땐 main()/연결종료가 실행되지 않음.
if (import.meta.main) await main();
```

> 기존 `syncTable`/`excludedSet` 등 나머지는 그대로 둔다. `db` import도 유지.

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 0 errors (`import.meta.main`은 `types:["node","bun"]`로 지원)

- [ ] **Step 3: CLI 회귀 — `bun run sync` 동작 동일**

Run: `set -a; . ./.env.local; set +a; bun run sync 2>&1 | grep -E "trim_option_relations|완료"`
Expected: `trim_option_relations  fetch 6236/6236 · upsert 6236 · soft-delete 0 · 검증 OK` + `catalog full-sync 완료.`

- [ ] **Step 4: 커밋**

```bash
git add src/sync/sync.ts
git commit -m "refactor(sync): runSync 재사용 분리 + import.meta.main 가드"
```

---

## Task 2: catalog 건수 쿼리

**Files:**
- Create: `src/db/queries/catalog-counts.ts`
- Test: `src/db/queries/catalog-counts.test.ts`

- [ ] **Step 1: 실패하는 테스트**

`src/db/queries/catalog-counts.test.ts`:

```ts
import { test, expect } from "bun:test";

import { getCatalogCounts } from "./catalog-counts";

test("getCatalogCounts: 7테이블 활성 건수 반환", async () => {
  const c = await getCatalogCounts();
  expect(c.brands).toBe(33);
  expect(c.models).toBe(265);
  expect(c.trims).toBe(1669);
  expect(c.trimOptions).toBeGreaterThan(10000);
  expect(c.colors).toBeGreaterThan(10000);
  expect(c.trimNoOptions).toBe(57);
  expect(c.trimOptionRelations).toBe(6236);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `set -a; . ./.env.local; set +a; bun test src/db/queries/catalog-counts.test.ts`
Expected: FAIL — "Cannot find module './catalog-counts'"

- [ ] **Step 3: 구현**

`src/db/queries/catalog-counts.ts`:

```ts
import { count, isNull } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import {
  brandsInCatalog,
  colorsInCatalog,
  modelsInCatalog,
  trimNoOptionsInCatalog,
  trimOptionRelationsInCatalog,
  trimOptionsInCatalog,
  trimsInCatalog,
} from "../catalog";
import { db } from "../client";

export type CatalogCounts = {
  brands: number;
  models: number;
  trims: number;
  trimOptions: number;
  colors: number;
  trimNoOptions: number;
  trimOptionRelations: number;
};

async function activeCount(table: PgTable, deletedAt: PgColumn): Promise<number> {
  const [row] = await db.select({ c: count() }).from(table).where(isNull(deletedAt));
  return row?.c ?? 0;
}

export async function getCatalogCounts(): Promise<CatalogCounts> {
  const [brands, models, trims, trimOptions, colors, trimNoOptions, trimOptionRelations] =
    await Promise.all([
      activeCount(brandsInCatalog, brandsInCatalog.deletedAt),
      activeCount(modelsInCatalog, modelsInCatalog.deletedAt),
      activeCount(trimsInCatalog, trimsInCatalog.deletedAt),
      activeCount(trimOptionsInCatalog, trimOptionsInCatalog.deletedAt),
      activeCount(colorsInCatalog, colorsInCatalog.deletedAt),
      activeCount(trimNoOptionsInCatalog, trimNoOptionsInCatalog.deletedAt),
      activeCount(trimOptionRelationsInCatalog, trimOptionRelationsInCatalog.deletedAt),
    ]);
  return { brands, models, trims, trimOptions, colors, trimNoOptions, trimOptionRelations };
}
```

> **Known risk:** `db.select(...).from(table)`의 `table: PgTable`에서 typecheck가 막히면, sync.ts 선례대로 `.from(table as never)`로 캐스팅(any 아님). Step 4에서 확인.

- [ ] **Step 4: 테스트 + typecheck 통과 확인**

Run: `set -a; . ./.env.local; set +a; bun test src/db/queries/catalog-counts.test.ts && bun run typecheck`
Expected: 1 pass, typecheck 0

- [ ] **Step 5: 커밋**

```bash
git add src/db/queries/catalog-counts.ts src/db/queries/catalog-counts.test.ts
git commit -m "feat(catalog): getCatalogCounts 7테이블 활성 건수 쿼리"
```

---

## Task 3: catalog 라우트 (counts + sync)

**Files:**
- Create: `src/routes/catalog.ts`
- Modify: `src/app.ts`
- Test: `src/routes/catalog.test.ts`

- [ ] **Step 1: 실패하는 라우트 스모크 테스트**

`src/routes/catalog.test.ts`:

```ts
import { test, expect } from "bun:test";

import { app } from "../app";

test("GET /api/catalog/counts → 200, 7테이블 건수", async () => {
  const res = await app.request("/api/catalog/counts");
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, number>;
  expect(body.brands).toBe(33);
  expect(typeof body.trimOptionRelations).toBe("number");
});
```

> `POST /api/catalog/sync`는 실제 master fetch+write(5초·외부 의존)라 자동 테스트에서 실행하지 않는다. `bun run sync`(Task 1 회귀)와 1단계 실전검증으로 커버. 이 테스트가 통과하면 `import.meta.main` 가드도 정상(app→catalog→sync import 시 `main()` 미실행).

- [ ] **Step 2: 테스트 실패 확인**

Run: `set -a; . ./.env.local; set +a; bun test src/routes/catalog.test.ts`
Expected: FAIL — 404 (라우트 미등록) 또는 import 에러

- [ ] **Step 3: 라우트 구현**

`src/routes/catalog.ts`:

```ts
import { Hono } from "hono";

import { getCatalogCounts } from "../db/queries/catalog-counts";
import { runSync } from "../sync/sync";

export const catalog = new Hono();

// 모듈 레벨 동시 실행 가드 (단일 인스턴스 전제).
let syncing = false;

catalog.get("/counts", async (c) => {
  return c.json(await getCatalogCounts());
});

catalog.post("/sync", async (c) => {
  if (syncing) return c.json({ error: "이미 동기화가 진행 중입니다." }, 409);
  syncing = true;
  try {
    const tables = await runSync();
    return c.json({ ok: tables.every((t) => t.complete), tables });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    syncing = false;
  }
});
```

- [ ] **Step 4: app.ts 등록**

`src/app.ts`에서 `import { vehicles }` 아래에 import 추가하고 route 등록:

```ts
import { catalog } from "./routes/catalog";
// ...
app.route("/api/vehicles", vehicles);
app.route("/api/catalog", catalog);
```

- [ ] **Step 5: 테스트 + typecheck 통과 확인**

Run: `set -a; . ./.env.local; set +a; bun test src/routes/catalog.test.ts && bun run typecheck`
Expected: 1 pass, typecheck 0

- [ ] **Step 6: 커밋**

```bash
git add src/routes/catalog.ts src/app.ts src/routes/catalog.test.ts
git commit -m "feat(catalog): /api/catalog counts + sync 라우트 (409 동시실행 가드)"
```

---

## Task 4: 클라 fetch lib

**Files:**
- Create: `client/src/lib/catalog.ts`
- Test: `client/src/lib/catalog.test.ts`

- [ ] **Step 1: 실패하는 테스트**

`client/src/lib/catalog.test.ts`:

```ts
import { afterEach, expect, it, vi } from "vitest";

import { fetchCatalogCounts, runCatalogSync } from "./catalog";

const COUNTS = {
  brands: 33,
  models: 265,
  trims: 1669,
  trimOptions: 10495,
  colors: 10483,
  trimNoOptions: 57,
  trimOptionRelations: 6236,
};

afterEach(() => vi.restoreAllMocks());

it("fetchCatalogCounts: 건수 객체 반환", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(COUNTS), { status: 200 })));
  const c = await fetchCatalogCounts();
  expect(c.brands).toBe(33);
  expect(c.trimOptionRelations).toBe(6236);
});

it("fetchCatalogCounts: 실패 시 throw", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
  await expect(fetchCatalogCounts()).rejects.toThrow();
});

it("runCatalogSync: 결과 반환", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, tables: [{ name: "brands", fetched: 33, total: 33, complete: true, upserted: 33, softDeleted: 0 }] }),
        { status: 200 },
      ),
    ),
  );
  const r = await runCatalogSync();
  expect(r.ok).toBe(true);
  expect(r.tables[0].name).toBe("brands");
});

it("runCatalogSync: 409 → 서버 에러 메시지로 throw", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "이미 동기화가 진행 중입니다." }), { status: 409 })),
  );
  await expect(runCatalogSync()).rejects.toThrow("이미 동기화가 진행 중입니다.");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test:unit client/src/lib/catalog.test.ts`
Expected: FAIL — "Cannot find module './catalog'"

- [ ] **Step 3: 구현**

`client/src/lib/catalog.ts`:

```ts
export type CatalogCounts = {
  brands: number;
  models: number;
  trims: number;
  trimOptions: number;
  colors: number;
  trimNoOptions: number;
  trimOptionRelations: number;
};

export type SyncTableResult = {
  name: string;
  fetched: number;
  total: number;
  complete: boolean;
  upserted: number;
  softDeleted: number;
};

export type SyncResponse = { ok: boolean; tables: SyncTableResult[] };

export async function fetchCatalogCounts(): Promise<CatalogCounts> {
  const res = await fetch("/api/catalog/counts");
  if (!res.ok) throw new Error(`catalog counts 실패: ${res.status}`);
  return (await res.json()) as CatalogCounts;
}

export async function runCatalogSync(): Promise<SyncResponse> {
  const res = await fetch("/api/catalog/sync", { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `동기화 실패: ${res.status}`);
  }
  return (await res.json()) as SyncResponse;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:unit client/src/lib/catalog.test.ts`
Expected: 4 pass

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/catalog.ts client/src/lib/catalog.test.ts
git commit -m "feat(catalog): 클라 fetch lib (counts + sync)"
```

---

## Task 5: MCMasterPage 교체 + App.tsx prop + CSS

**Files:**
- Modify: `client/src/pages/MCMasterPage.tsx` (전면 교체)
- Modify: `client/src/App.tsx`
- Modify: `client/src/index.css`
- Test: `client/src/pages/MCMasterPage.test.tsx`

- [ ] **Step 1: 실패하는 테스트**

`client/src/pages/MCMasterPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MCMasterPage } from "./MCMasterPage";

const COUNTS = {
  brands: 33,
  models: 265,
  trims: 1669,
  trimOptions: 10495,
  colors: 10483,
  trimNoOptions: 57,
  trimOptionRelations: 6236,
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/catalog/counts") return new Response(JSON.stringify(COUNTS), { status: 200 });
      if (url === "/api/catalog/sync" && init?.method === "POST") {
        return new Response(
          JSON.stringify({ ok: true, tables: [{ name: "brands", fetched: 33, total: 33, complete: true, upserted: 33, softDeleted: 0 }] }),
          { status: 200 },
        );
      }
      return new Response("[]", { status: 200 });
    }),
  );
});

afterEach(() => vi.restoreAllMocks());

it("건수 렌더", async () => {
  render(<MCMasterPage roleTab="최고관리자" />);
  expect(await screen.findByText("1,669건")).toBeInTheDocument();
});

it("최고관리자는 동기화 버튼 노출, 클릭 시 결과 표시", async () => {
  const user = userEvent.setup();
  render(<MCMasterPage roleTab="최고관리자" />);
  await screen.findByText("33건");
  await user.click(screen.getByRole("button", { name: "마스터 동기화" }));
  expect(await screen.findByText(/동기화 완료/)).toBeInTheDocument();
});

it("비최고관리자는 동기화 버튼 숨김", async () => {
  render(<MCMasterPage roleTab="상담사" />);
  await screen.findByText("33건");
  expect(screen.queryByRole("button", { name: "마스터 동기화" })).toBeNull();
});

it("counts 실패 시 '불러오기 실패'", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
  render(<MCMasterPage roleTab="최고관리자" />);
  expect((await screen.findAllByText("불러오기 실패")).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test:unit client/src/pages/MCMasterPage.test.tsx`
Expected: FAIL — `MCMasterPage` prop 타입/렌더 불일치 (현재는 props 없는 스텁)

- [ ] **Step 3: MCMasterPage 교체**

`client/src/pages/MCMasterPage.tsx` 전체를 교체:

```tsx
import { useEffect, useState } from "react";

import type { RoleTab } from "@/data/roles";
import { type CatalogCounts, type SyncResponse, fetchCatalogCounts, runCatalogSync } from "@/lib/catalog";

const TABLE_LABELS: [keyof CatalogCounts, string][] = [
  ["brands", "브랜드"],
  ["models", "모델"],
  ["trims", "트림"],
  ["trimOptions", "옵션"],
  ["colors", "색상"],
  ["trimOptionRelations", "옵션 관계"],
  ["trimNoOptions", "옵션 없는 트림"],
];

export function MCMasterPage({ roleTab }: { roleTab: RoleTab }) {
  const [counts, setCounts] = useState<CatalogCounts | null>(null);
  const [countsError, setCountsError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResponse | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    setCountsError(false);
    fetchCatalogCounts()
      .then(setCounts)
      .catch(() => setCountsError(true));
  }, []);

  const reloadCounts = () => {
    fetchCatalogCounts()
      .then(setCounts)
      .catch(() => setCountsError(true));
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const r = await runCatalogSync();
      setResult(r);
      reloadCounts();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "동기화 실패");
    } finally {
      setSyncing(false);
    }
  };

  const isAdmin = roleTab === "최고관리자";

  return (
    <section className="card">
      <div className="panel-head">
        <h2>차선생 차량 데이터 기준</h2>
        {isAdmin && (
          <button className="primary" type="button" onClick={handleSync} disabled={syncing}>
            {syncing ? "동기화 중…" : "마스터 동기화"}
          </button>
        )}
      </div>
      <div className="panel-body">
        <div className="notice-box">
          <strong>MC코드 기반 차량 마스터 — master Supabase 거울</strong>
          <span>master에서 변경된 브랜드/모델/트림/옵션/색상을 동기화해 catalog 거울을 최신으로 맞춥니다.</span>
        </div>

        <div className="mini-grid">
          {TABLE_LABELS.map(([key, label]) => (
            <article className="mini-card" key={key}>
              <strong>{label}</strong>
              <span>{countsError ? "불러오기 실패" : counts ? `${counts[key].toLocaleString()}건` : "…"}</span>
            </article>
          ))}
        </div>

        {syncError && <div className="notice-box error">{syncError}</div>}

        {result && (
          <div className={`catalog-sync-result${result.ok ? "" : " warn"}`}>
            <strong>{result.ok ? "동기화 완료" : "동기화 완료 (일부 검증 스킵)"}</strong>
            <ul>
              {result.tables.map((t) => (
                <li key={t.name}>
                  {t.name} · upsert {t.upserted} · soft-delete {t.softDeleted} · {t.complete ? "OK" : "SKIP"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: App.tsx에서 roleTab prop 전달**

`client/src/App.tsx`의 `if (activeView === "mc-master") return <MCMasterPage />;`를 교체:

```tsx
if (activeView === "mc-master") return <MCMasterPage roleTab={roleTab} />;
```

- [ ] **Step 5: index.css 결과 패널 CSS 추가**

`client/src/index.css`의 `.notice-box span { … }` 규칙(약 4975줄) 다음에 추가:

```css
.notice-box.error {
  border-color: #d9534f;
  color: #d9534f;
}
.catalog-sync-result {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f7f7f6;
}
.catalog-sync-result.warn {
  border-color: #e0b400;
  background: #fffaf0;
}
.catalog-sync-result ul {
  margin: 8px 0 0;
  padding-left: 16px;
  font-size: 12px;
  color: #4f5a64;
}
```

- [ ] **Step 6: 테스트 + typecheck 통과 확인**

Run: `bun run test:unit client/src/pages/MCMasterPage.test.tsx && bun run typecheck`
Expected: 4 pass, typecheck 0

- [ ] **Step 7: 커밋**

```bash
git add client/src/pages/MCMasterPage.tsx client/src/App.tsx client/src/index.css client/src/pages/MCMasterPage.test.tsx
git commit -m "feat(catalog): mc-master 동기화 UI (건수 + 버튼 + 결과)"
```

---

## Task 6: 통합 검증

- [ ] **Step 1: 전체 정적 검증**

Run: `bun run typecheck && bun run lint`
Expected: typecheck 0, lint 0 problems

- [ ] **Step 2: 전체 테스트**

Run: `set -a; . ./.env.local; set +a; bun run test`
Expected: test:server PASS(기존 + catalog-counts + catalog 라우트), test:unit PASS(기존 + catalog lib + MCMasterPage)

- [ ] **Step 3: CLI 회귀**

Run: `set -a; . ./.env.local; set +a; bun run sync 2>&1 | tail -3`
Expected: `catalog full-sync 완료.` (runSync 분리 후에도 동일)

- [ ] **Step 4: 브라우저 수동 확인**

`bun run dev`로 API(8788)+client(5173) 띄우고 mc-master(사이드바 "엠씨 마스터") 진입:
- 7테이블 건수 표시(브랜드 33 등)
- 최고관리자 탭: [마스터 동기화] 버튼 → 클릭 → 결과 패널(테이블별 upsert/soft-delete)
- 상담사 탭으로 전환 시 버튼 숨김

> 브라우저 확인은 수동. 자동 스크린샷은 큰 레이아웃 변화 없으면 생략.

- [ ] **Step 5: 최종 커밋(있으면) + finishing-a-development-branch**

남은 변경 없으면 생략. superpowers:finishing-a-development-branch로 PR.

---

## Self-Review (작성자 체크)

- **spec 커버리지:** ①runSync 분리=Task1, ②catalog 라우트=Task3, ③counts 쿼리=Task2, ④클라 lib=Task4, ⑤MCMasterPage=Task5, ⑥에러처리=Task5(countsError/syncError/SKIP), ⑦테스트=Task2~5 + 통합 Task6. 모두 매핑.
- **placeholder:** 없음. 모든 코드/명령/기대출력 명시. `activeCount` 캐스팅 리스크만 Task2에 known-risk로 명시(typecheck로 확정).
- **타입 일관성:** `TableResult`(서버, sync.ts) ↔ `SyncTableResult`(클라, catalog.ts) 동일 필드. `CatalogCounts` 키(brands…trimOptionRelations) = counts 쿼리 반환 = 클라 타입 = `TABLE_LABELS` keyof 일치. `RoleTab` 값("최고관리자"/"상담사") roles.ts와 일치. `runSync(onTable?)` 시그니처 ↔ main()/라우트 호출 일치.
- **범위:** 단일 plan 적정. sync 이력/드릴다운/라우팅/서버인증 비범위.
