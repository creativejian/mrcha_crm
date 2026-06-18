# CRM 백엔드 Cloudflare Hyperdrive 도입 설계

- 작성일: 2026-06-18
- 상태: 설계 합의 완료 (구현 전)
- 관련: `ref/active-session-brief.md`(Next 항목), `ref/specs/2026-06-17-crm-db-connection-migration-design.md`, PR #40(안전망)

## 1. 목표 / 비목표

### 목표
- CRM 백엔드(Cloudflare Pages Functions, Hono + postgres.js)에 **Cloudflare Hyperdrive(edge connection pooling)** 를 도입한다.
- CF Pages Functions는 요청마다 stateless isolate라 postgres.js가 매 요청 새 DB 연결을 연다. 여러 카탈로그 API 동시 호출 시 Supabase 연결 한계에 걸려 `models` API가 비결정적 500을 낸다(transaction pooler로 9→3 완화되었으나 근본 해소는 아님). Hyperdrive로 동시 연결을 **적은 origin 연결**로 모은다.
- 부수 효과: edge connection 재사용으로 latency 개선.

### 비목표
- **Workers 이전 금지** — 이미 Workers 런타임(Pages Functions)이다. 구조 유지.
- 긴급 픽스 아님 — 현재 retry(#40) + transaction pooler로 mc-master 첫 로드는 정상 동작(검증 6/6). 이번 작업은 **고동시성 근본책 + 성능 개선**이며, **동작 중인 경로를 깨지 않고 무중단**으로 진행한다.
- CRM 도메인(고객·견적) DB 연결은 별개 작업. 본 작업은 카탈로그 read/write 경로(`/api/vehicles`, `/api/catalog`)에만 영향.

## 2. 합의된 결정

| # | 항목 | 결정 | 근거 |
|---|------|------|------|
| 1 | db 요청 컨텍스트화 | **Hono `c.var` 주입 + `executor` 파라미터** | 기존 write 함수의 `executor: Executor = db` 패턴을 read 함수까지 확장. 명시적·테스트 친화, strict/no-any 기조 일관. |
| 2 | Hyperdrive origin 연결 | **Supabase Supavisor session pooler (5432)** | direct(5432)는 IPv6-only라 Hyperdrive 도달 위험. session pooler는 IPv4 호환(add-on 불필요) + prepared statement 지원. |
| 3 | Hyperdrive 쿼리 캐싱 | **v1은 캐싱 끄기** | 주 소비자가 /mc-master 관리 화면 — 편집 직후 최대 60s stale은 '고쳤는데 안 바뀜' 버그처럼 보임. 우선 연결 풀링(500 해소)만 확보. |
| 파생 | postgres.js `prepare` | **v1은 두 경로 모두 `prepare: false` 유지** | fallback(6543 transaction pooler)은 prepared statement 미지원이라 false 필수. Hyperdrive 경로(5432)는 true 가능하나, 무중단·parity·최소 위험을 위해 v1은 false 통일. true는 후속 성능 튜닝(아래 §8). |

### 공식 문서 확인 (요약)
- Cloudflare는 Supabase에 **direct connection 권장, pooled 금지**(이중 풀링 회피). 단 Supabase direct(`db.<ref>.supabase.co:5432`)는 **IPv6-only**. IPv4가 필요하면 Supavisor pooler 또는 IPv4 add-on(Pro+ 유료). → 안전한 보편 선택 = **session pooler 5432**(IPv4 + prepared statement).
- Hyperdrive는 named prepared statement 지원(postgres.js ≥ 3.4.5, 현재 3.4.9 ✓).
- Hyperdrive 쿼리 캐싱 기본 ON(`max_age` 60s / `swr` 15s), read만 캐시·write 우회. → v1은 인스턴스 생성 시 `--caching-disabled`.
- 출처: Hyperdrive·Supabase, Query caching, Named prepared statements(blog), Supabase IPv4/IPv6 트러블슈팅 docs.

## 3. 핵심 난점

`src/db/client.ts`는 **모듈 로드 시** `process.env.DATABASE_URL`로 `db` 싱글톤을 생성한다. 그러나 Hyperdrive connection string은 **요청 컨텍스트**(`c.env.HYPERDRIVE.connectionString`)에서만 얻는다. 따라서 db를 요청 컨텍스트에서 생성/주입하는 구조로 바꿔야 한다.

동시에:
- **로컬**(`bun src/local-dev.ts`)·**테스트**(`bun test`, `--env-file=.env.local`)·**CF-Hyperdrive-부재 시 fallback**은 `process.env.DATABASE_URL`(현재 6543 transaction pooler)을 계속 써야 한다.
- 테스트(`catalog-admin.test.ts`)는 `db.transaction(...)`으로 롤백하며 실 master에 붙는다 → fallback용 db는 반드시 유지.

## 4. 아키텍처

### 4.1 `src/db/client.ts` — 팩토리 + 메모이즈 + fallback

```text
- createDb(connStr: string): Db
    postgres(connStr, { prepare: false }) + drizzle(client, { schema: {...schema, ...catalog} })
    모듈 스코프 Map<string, Db>에 connStr 키로 메모이즈
    → 같은 isolate가 같은 connStr이면 요청 간 재사용(매 요청 새로 만들지 않음)

- getDefaultDb(): Db
    process.env.DATABASE_URL로 createDb 호출(메모이즈). 없으면 throw.
    로컬·테스트·fallback 전용.

- export type Db, Executor  (Executor = Db | Db.transaction 콜백의 tx 타입)
    현재 catalog-admin.ts에 있는 Executor 정의를 client.ts로 이관·공유.

- export { catalog, schema }  (유지)
```

기존 `export const db`(eager 싱글톤)는 제거하고 `getDefaultDb()`(lazy)로 대체한다. → CF isolate가 client.ts import만으로 6543에 불필요한 연결을 열지 않게 한다.

### 4.2 `src/db/middleware/db.ts` (신규) — 요청당 db 주입

```text
dbMiddleware: MiddlewareHandler<{ Variables: { db: Db } }>
  connStr = (c.env as { HYPERDRIVE?: { connectionString: string } })?.HYPERDRIVE?.connectionString
  c.set("db", connStr ? createDb(connStr) : getDefaultDb())
  await next()
```

- CF prod: `c.env.HYPERDRIVE.connectionString` 존재 → Hyperdrive 경로.
- 로컬(`Bun.serve`는 env 2번째 인자 미전달)·테스트(`app.request`는 env 미전달) → `c.env` undefined → `getDefaultDb()` fallback.

### 4.3 `src/app.ts` — 미들웨어 배선

```text
app.use("/api/vehicles/*", dbMiddleware)
app.use("/api/catalog/*", dbMiddleware)
(auth 미들웨어와 같은 스코프. /api/health는 db 불필요하므로 제외)
```

`AuthVariables`와 `{ db: Db }`를 합친 Variables 타입을 라우트에 노출.

### 4.4 query 함수 — `executor` 파라미터 일원화

- **write 함수**(`catalog-admin.ts`): 이미 `executor: Executor = db` 보유 → 기본값을 `getDefaultDb()`로 변경.
- **read 함수**(`vehicles.ts` 4개, `catalog-counts.ts`, `catalog-admin.ts` list 계열): `executor: Executor = getDefaultDb()` 파라미터 추가, 내부 `db.` → `executor.`.
  - 기본값 덕분에 인자 없이 호출하는 기존 단위 테스트(`vehicles.test.ts`)는 **무수정**.
- `getCatalogCounts`/`tableCount`: executor 받도록 시그니처 확장(순차 await 유지).

### 4.5 라우트 — `c.var.db` 전달

- `vehicles.ts`·`catalog.ts`의 query 호출에 `c.var.db`를 executor로 전달.
- `catalog.ts`의 `db.transaction(...)`(assign-codes, trims/move) → `c.var.db.transaction(...)`.
- route가 항상 `c.var.db`를 넘기므로, CF에서 read 함수의 기본값(`getDefaultDb()`)은 발동하지 않는다(Hyperdrive 경로 보장). 만약 배선 누락 시 §7 e2e가 500으로 잡아낸다.

### 4.6 `wrangler.jsonc` — binding 추가

```jsonc
"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<이사님이 인스턴스 생성 후 전달>" }]
```

`nodejs_compat` + `compatibility_date`는 현행 유지.

## 5. fallback / 로컬 / 테스트 동작 표

| 환경 | connStr 출처 | 경로 | prepare |
|------|--------------|------|---------|
| CF prod (정상) | `c.env.HYPERDRIVE.connectionString` | Hyperdrive → session pooler 5432 | false |
| CF prod (binding 부재) | `process.env.DATABASE_URL`(6543) | 직접(현행 동작) — 안전망 | false |
| 로컬 dev | `process.env.DATABASE_URL`(.env.local) | 직접 | false |
| `bun test` (route) | `process.env.DATABASE_URL`(.env.local) | 직접, `app.request`로 env 미전달 | false |
| `bun test` (query unit) | `getDefaultDb()` / `tx` | 직접, tx 롤백 | false |

## 6. 분담

- **이사님(CF 대시보드)**: Hyperdrive 인스턴스 생성·등록.
  - origin = **Supabase Supavisor session pooler (5432)** 연결 문자열 (`aws-0-<region>.pooler.supabase.com:5432`, user `postgres.<project-ref>`).
  - **캐싱 비활성**(`--caching-disabled` 또는 대시보드 옵션).
  - **Hyperdrive는 Workers Paid plan 필요 — 생성 시 확인.**
  - 생성 후 **binding id** 전달.
- **유슨생(코드)**: `wrangler.jsonc` binding 추가 + client.ts 팩토리/메모이즈/fallback + dbMiddleware + executor 일원화 + 라우트 배선 + 테스트 수정 + 검증.

## 7. 검증

1. `bun run typecheck` 0 / `bun run lint` 0
2. `bun run test:server`(`--env-file=.env.local`) 28+ 통과 — fallback 경로 회귀 없음
3. (필요 시) `bun run build` OK
4. **배포 후 CF 동시 부하 e2e**: 유효 토큰으로 `/api/catalog/models?brandId=...` **20 동시 호출** → 500 사라짐(오늘의 검증 방식). 로컬 test는 fallback만 타므로 Hyperdrive 효과는 **CF 배포 후에만** 확인 가능.
   - 이 e2e는 배선 검증도 겸함: 라우트가 `c.var.db`를 안 넘겨 fallback(6543)으로 샜다면 동시 500이 재현되어 잡힌다.

## 8. 롤아웃 (무중단) / 후속

- **무중단 순서**: 코드(fallback 유지) PR 머지 → 이사님 인스턴스 생성·binding id 전달 → `wrangler.jsonc`에 id 반영 PR → 재배포 → e2e. binding 없는 동안에도 fallback으로 정상 동작.
- **#40 안전망 유지**: `apiFetch` GET 5xx 재시도(backoff+jitter) + `MCMasterPage` loadError 리셋은 **제거하지 않는다**. 근본책 + 안전망 이중.
- **후속(선택)**:
  - prepare:true — 5432 origin·Hyperdrive prepared statement 검증 후 Hyperdrive 경로만 true로 전환(plan 캐싱 perf). 1줄·가역.
  - 쿼리 캐싱 — read 전용 소비자 엔드포인트 분리 시 별도 cached 바인딩 도입.

## 9. 리스크 / 주의

- **DATABASE_URL secret 변경 후 재배포 필수**(기존 배포는 옛 값 사용) — CF 운영 주의 동일 적용(binding 반영도 재배포 필요).
- postgres.js `max:1`·`fetch_types:false`는 금지(검증됨). 본 설계는 둘 다 안 건드림.
- session pooler origin이 Hyperdrive에서 거부되면(드묾) direct(5432, IPv6) + IPv4 add-on 또는 Hyperdrive IPv6 도달 확인으로 전환 — 인스턴스 생성 시 연결 테스트로 조기 발견.
- read 함수 `executor` 기본값(`getDefaultDb()`)이 CF에서 silent fallback이 될 여지 → 라우트가 항상 `c.var.db` 전달 + §7 e2e가 backstop.
