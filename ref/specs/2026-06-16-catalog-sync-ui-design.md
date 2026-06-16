# catalog 동기화 UI (sync 2단계) 설계

작성일: 2026-06-16
상태: 설계 승인됨 (writing-plans 대기)

## 배경 / 목적

sync 1단계(PR #18)로 `bun run sync` CLI가 master→catalog full-sync를 수행한다. 이 작업은 그걸 **운영자가 화면에서 버튼으로 실행**하게 만든다(2단계). 기존 `mc-master`("엠씨 마스터") 화면이 "차량 데이터 기준 관리 · 추후 Supabase 연결" 자리로 비어 있으므로(31줄 스텁), **새 메뉴 없이 그 화면을 실데이터 + 동기화 버튼으로 채운다.**

- 라우팅(리로드 초기화) 개선은 **별개 후속 작업**으로 분리. 이 작업은 라우팅에 의존하지 않음(사이드바에서 mc-master 진입).

## 결정사항 (확정)

- **무저장 MVP**: sync 이력 테이블 없음(public 테이블 0 유지). 화면은 catalog 현재 건수를 실시간 조회하고, sync 결과는 그 자리에서만 표시(리로드 시 결과는 사라지고 건수만 재조회). "마지막 동기화 N분 전" 영구 표시는 후속.
- **표시 범위**: 테이블별 건수 요약 + 동기화 버튼 + 최근 결과. 데이터 드릴다운(CRUD/탐색)은 비범위.
- **동기 API**: sync는 ~5초. 동기 요청(버튼→로딩→결과). 비동기 진행률(SSE/폴링)은 YAGNI.
- **동시 실행 방지**: 서버 모듈 플래그로 진행 중이면 `409` + 클라 버튼 disable.
- **권한**: CRM 자체 auth 미구축 → 클라이언트 `roleTab === "최고관리자"` 가드만. 서버 인증은 public 도메인+인증 생길 때 후속.

## 범위

**포함**
- `src/sync/sync.ts` — `runSync()` 재사용 함수 분리(API/CLI 공유)
- `src/db/queries/catalog-counts.ts` — 테이블별 활성 건수 조회
- `src/routes/catalog.ts` — `GET /api/catalog/counts`, `POST /api/catalog/sync` + `app.ts` 등록
- `client/src/lib/catalog.ts` — fetch 순수 함수
- `client/src/pages/MCMasterPage.tsx` — 건수 + 동기화 버튼 + 결과로 교체
- `client/src/App.tsx` — `roleTab`을 MCMasterPage에 prop 전달
- 테스트: catalog-counts(서버), catalog 라우트 스모크(서버), MCMasterPage(클라)

**비범위 (다음 단계)**
- sync 이력 테이블 / "마지막 동기화 N분 전" 영구 표시
- 데이터 드릴다운/CRUD
- 라우팅(리로드 초기화) — 별도 작업
- 서버측 인증/권한 — CRM auth 생길 때
- 비동기 진행률, 자동 스케줄

## 아키텍처 / 데이터 흐름

```
[MCMasterPage]
  mount → GET /api/catalog/counts ──→ getCatalogCounts() → catalog 7테이블 count(deleted_at IS NULL)
  [마스터 동기화] click (최고관리자) → POST /api/catalog/sync ──→ runSync() → master fetch + upsert + soft-delete
        → 결과 패널 표시 + counts 재조회
```

CLI(`bun run sync`)와 API가 `runSync()` 동일 로직 공유. 서버는 연결 유지(`db.$client.end()`는 CLI 엔트리에서만).

## ① 서버 — sync 재사용 분리 (`src/sync/sync.ts` 수정)

현재 `main()`이 테이블 루프 + 로그 + `db.$client.end()`를 한 덩어리로 갖고 top-level `await main()`로 실행된다. 이를 분리:

```ts
export type TableResult = { name: string; fetched: number; total: number; complete: boolean; upserted: number; softDeleted: number };

// 재사용: 전체 테이블 sync 실행 후 결과 배열 반환. 연결을 끊지 않음(서버가 유지).
// onTable 콜백으로 CLI는 테이블별 실시간 로그 유지, API는 생략.
export async function runSync(onTable?: (r: TableResult) => void): Promise<TableResult[]> {
  const results: TableResult[] = [];
  for (const meta of syncTables) {
    const r = await syncTable(meta);
    onTable?.(r);
    results.push(r);
  }
  return results;
}

// CLI 엔트리: runSync 호출 + 요약 + 연결 종료.
async function main(): Promise<void> {
  console.log("catalog full-sync 시작\n");
  const results = await runSync((r) => {
    const flag = r.complete ? "OK" : "SKIP(soft-delete)";
    console.log(`  ${r.name.padEnd(22)} fetch ${r.fetched}/${r.total} · upsert ${r.upserted} · soft-delete ${r.softDeleted} · 검증 ${flag}`);
  });
  const incomplete = results.filter((r) => !r.complete);
  console.log("\ncatalog full-sync 완료.");
  if (incomplete.length) console.warn(`경고: ${incomplete.map((r) => r.name).join(", ")} 불완전 fetch → soft-delete 스킵됨. 재실행 권장.`);
  await db.$client.end();
}
```

`main()`은 **CLI에서만** 실행돼야 한다. top-level `await main()`을 import-safe 가드로 변경:

```ts
// Bun: import.meta.main === true 이면 직접 실행(`bun run src/sync/sync.ts`). 라우트가 import할 땐 실행 안 됨.
if (import.meta.main) await main();
```

> `import.meta.main`은 Bun에서 진입 모듈 여부를 준다. 라우트가 `runSync`를 import해도 `main()`/`db.$client.end()`가 실행되지 않아 서버 연결이 유지된다.

## ② 서버 — catalog 라우트 (`src/routes/catalog.ts` 신규)

```ts
import { Hono } from "hono";
import { getCatalogCounts } from "../db/queries/catalog-counts";
import { runSync } from "../sync/sync";

export const catalog = new Hono();
let syncing = false; // 모듈 레벨 동시 실행 가드 (단일 인스턴스 전제)

catalog.get("/counts", async (c) => c.json(await getCatalogCounts()));

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

`src/app.ts`에 `app.route("/api/catalog", catalog)` 추가.

**응답 형태**
- `GET /api/catalog/counts` → `{ brands: 33, models: 265, trims: 1669, trimOptions: 10495, colors: 10483, trimNoOptions: 57, trimOptionRelations: 6236 }` (camelCase 키)
- `POST /api/catalog/sync` → `{ ok: true, tables: [{ name: "brands", fetched: 33, total: 33, complete: true, upserted: 33, softDeleted: 0 }, …] }`

## ③ 서버 — 건수 쿼리 (`src/db/queries/catalog-counts.ts` 신규)

7테이블 각 `count(*) WHERE deleted_at IS NULL`. drizzle `count()` 사용, 명시적 7테이블(레이어 의존 단순화):

```ts
import { count, isNull } from "drizzle-orm";
import { brandsInCatalog, modelsInCatalog, trimsInCatalog, trimOptionsInCatalog, colorsInCatalog, trimNoOptionsInCatalog, trimOptionRelationsInCatalog } from "../catalog";
import { db } from "../client";

export type CatalogCounts = {
  brands: number; models: number; trims: number; trimOptions: number;
  colors: number; trimNoOptions: number; trimOptionRelations: number;
};

async function activeCount(table: PgTable, deletedAt: PgColumn): Promise<number> {
  const [row] = await db.select({ c: count() }).from(table).where(isNull(deletedAt));
  return row?.c ?? 0;
}

export async function getCatalogCounts(): Promise<CatalogCounts> {
  // 7테이블 병렬 count
}
```

> `activeCount` 헬퍼는 `as never` 캐스팅 없이 `PgTable`/`PgColumn`로 충분(단일 from + where). 7개를 `Promise.all`로 병렬.

## ④ 클라 — fetch lib (`client/src/lib/catalog.ts` 신규)

```ts
export type CatalogCounts = { brands: number; models: number; trims: number; trimOptions: number; colors: number; trimNoOptions: number; trimOptionRelations: number };
export type SyncTableResult = { name: string; fetched: number; total: number; complete: boolean; upserted: number; softDeleted: number };
export type SyncResponse = { ok: boolean; tables: SyncTableResult[] };

export async function fetchCatalogCounts(): Promise<CatalogCounts> { /* GET /api/catalog/counts */ }
export async function runCatalogSync(): Promise<SyncResponse> { /* POST; 409/500 → throw Error(메시지) */ }
```

`vehicles.ts`(lib)의 fetch 패턴(상대경로 `/api/...`, `res.ok` 체크, json)을 따름.

## ⑤ 클라 — MCMasterPage 교체

- `.card > .panel-head`(h2 "차선생 차량 데이터 기준") 골격 유지. 배지는 동적(동기화 가능/진행 중/완료).
- **건수 요약**: 7테이블 한글 라벨 + 실건수 mini-card (브랜드/모델/트림/옵션/색상/옵션관계/옵션없는트림).
- **[마스터 동기화] 버튼**: `roleTab === "최고관리자"`일 때만 노출. 클릭 → `syncing` 로딩(disable + 스피너) → 결과.
- **결과 패널**: 테이블별 `upsert N · soft-delete M · 검증 OK/SKIP`. `ok=false`(SKIP 존재)면 경고 톤. sync 후 counts 재조회.
- **에러**: counts/sync fetch 실패 → 메시지 표시.
- 상태: `counts | loadingCounts | syncing | result | error` (React state).
- 권한 prop: `App.tsx`에서 `<MCMasterPage roleTab={roleTab} />`.
- 스타일: 기존 `.card`/`.panel-head`/`.mini-grid`/`.notice-box`/`.badge` 재사용 우선. 결과 패널은 필요 최소 CSS만 `index.css`에 추가.

## ⑥ 에러 / 엣지

- counts 조회 실패: mini-card 자리에 "불러오기 실패" + 재시도 안내.
- sync 409(동시 실행): "이미 동기화가 진행 중입니다" 표시.
- sync 500/네트워크: 에러 메시지 표시, 버튼 재활성.
- 일부 테이블 SKIP(불완전 fetch): 결과 패널에 경고 + 재실행 유도. (soft-delete만 스킵, upsert는 반영됨)
- 비최고관리자: 버튼 자체 미노출(건수는 조회 가능).

## ⑦ 테스트

- **서버**(bun test, 실 catalog 통합):
  - `catalog-counts.test.ts`: `getCatalogCounts()` → `brands===33` 등 기존 import 행수와 일치, 모든 키 number.
  - `catalog.test.ts`(라우트 스모크): `GET /api/catalog/counts` 200 + 키 존재. `POST /api/catalog/sync`는 실제 master fetch+write(5초·외부 의존)라 **자동 테스트에서 실행하지 않음** — `bun run sync` + 1단계 실전검증으로 커버됨. 라우트는 counts GET 스모크만.
- **클라**(vitest, fetch mock):
  - `MCMasterPage.test.tsx`: counts mock → 건수 렌더, 최고관리자면 버튼 노출/비최고관리자면 숨김, 버튼 클릭 → sync mock → 결과 렌더, 에러 mock → 메시지.

## 영향 파일

- 수정: `src/sync/sync.ts`(runSync export + import.meta.main 가드), `src/app.ts`(route 등록), `client/src/pages/MCMasterPage.tsx`(교체), `client/src/App.tsx`(roleTab prop), `client/src/index.css`(결과 패널 최소 CSS)
- 신규: `src/routes/catalog.ts`, `src/db/queries/catalog-counts.ts`, `client/src/lib/catalog.ts`
- 테스트 신규: `src/db/queries/catalog-counts.test.ts`, `src/routes/catalog.test.ts`, `client/src/pages/MCMasterPage.test.tsx`

## 검증

- `bun run typecheck` / `bun run lint` 0
- `bun run test`(server: counts + 라우트 스모크 + 기존, unit: MCMasterPage + 기존)
- `bun run sync` 회귀(runSync 분리 후에도 CLI 동작 동일)
- 브라우저: mc-master에서 건수 표시 + 동기화 버튼 실행 + 결과 확인(최고관리자), 비최고관리자 버튼 숨김

## 다음 단계 (이 작업 후)

1. 라우팅 도입(react-router) — 리로드 초기화/딥링크
2. sync 이력 테이블 + "마지막 동기화 N분 전" (public 첫 마이그레이션)
3. 할인 매핑·취득세 공식 (master secret key 대기)
