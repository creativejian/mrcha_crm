# CRM 인증 — 백엔드 미들웨어 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hono 백엔드(`/api/vehicles`·`/api/catalog`)를 Supabase JWT(JWKS edge 검증) + role claim 게이트로 보호한다 — `customer`/무토큰 차단, `staff/manager/admin/dealer` 통과.

**Architecture:** 세 단위로 나눈다. ① 순수 함수 `verifyAndGate`(jose `jwtVerify` + role 게이트), ② keyResolver 주입형 팩토리 `createAuthMiddleware`(prod=원격 JWKS, test=로컬 JWKS), ③ `createApp(authOpts)` 팩토리(테스트가 로컬 키로 보호 라우트를 통과 검증). role은 Supabase Custom Access Token Hook이 넣는 top-level `user_role` claim에서 읽는다(DB 조회 없음).

**Tech Stack:** Hono, jose(JWKS/JWT), bun test. 설계 근거: `ref/specs/2026-06-18-crm-auth-design.md`.

**선행 의존(앱/Supabase, 이 plan 밖)**: `user_role` enum에 `dealer` 추가 · Custom Access Token Hook 등록(role→`user_role` claim). 이 plan은 테스트용 키로 검증하므로 선행이 없어도 진행/테스트 가능. 실배포 검증만 선행 완료 후.

**핵심 제약(왜 팩토리인가):** `authMiddleware`는 prod에서 원격 JWKS(실 Supabase 비밀키 서명)를 쓰므로 테스트에서 유효 토큰을 만들 수 없다. 그래서 keyResolver를 주입 가능하게 하여 테스트는 **로컬 키쌍**으로 토큰을 서명하고 같은 키의 로컬 JWKS로 검증한다. 기존 `catalog.test.ts`·`vehicles.test.ts`가 HTTP로 보호 라우트를 호출하므로, 이들도 로컬 키 app + Bearer 토큰으로 통과시킨다.

---

## File Structure

- `src/auth/verify.ts` (신규) — `verifyAndGate` 순수 함수
- `src/auth/verify.test.ts` (신규) — 단위테스트
- `src/auth/test-jwt.ts` (신규) — 테스트 전용 로컬 키/토큰/JWKS 헬퍼(여러 테스트 공유)
- `src/middleware/auth.ts` (신규) — `createAuthMiddleware` 팩토리
- `src/app.ts` (수정) — `createApp(authOpts)` 팩토리 + `export const app = createApp()`
- `src/app.test.ts` (수정) — 무토큰 401·health 공개 케이스
- `src/routes/catalog.test.ts`·`src/routes/vehicles.test.ts` (수정) — 로컬 키 app + Bearer 토큰
- `package.json` (수정) — jose

---

### Task 1: `verifyAndGate` 순수 검증·게이트 함수 (TDD)

**Files:**
- Create: `src/auth/verify.ts`, `src/auth/verify.test.ts`
- Modify: `package.json`

- [ ] **Step 1: jose 설치**

Run: `bun add jose`
Expected: `package.json` dependencies에 `jose` 추가.

- [ ] **Step 2: 실패하는 테스트 작성**

Create `src/auth/verify.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";

import { verifyAndGate } from "./verify";

const ISSUER = "https://proj.supabase.co/auth/v1";
const AUD = "authenticated";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  const kid = "test-key";
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid, alg: "ES256", use: "sig" }] });
  const sign = (claims: Record<string, unknown>, opts?: { sub?: string; expSec?: number }) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid })
      .setIssuer(ISSUER)
      .setAudience(AUD)
      .setSubject(opts?.sub ?? "user-uuid")
      .setExpirationTime(opts?.expSec ?? "1h")
      .sign(privateKey);
  return { jwks, sign };
}

describe("verifyAndGate", () => {
  it("staff/manager/admin/dealer는 통과한다", async () => {
    const { jwks, sign } = await setup();
    for (const role of ["staff", "manager", "admin", "dealer"]) {
      const token = await sign({ user_role: role });
      const r = await verifyAndGate(token, jwks, { issuer: ISSUER, audience: AUD });
      expect(r).toEqual({ ok: true, user: { id: "user-uuid", role } });
    }
  });

  it("customer는 403으로 차단한다", async () => {
    const { jwks, sign } = await setup();
    const token = await sign({ user_role: "customer" });
    const r = await verifyAndGate(token, jwks, { issuer: ISSUER, audience: AUD });
    expect(r).toEqual({ ok: false, status: 403, error: "접근 권한이 없습니다." });
  });

  it("user_role claim이 없으면 403", async () => {
    const { jwks, sign } = await setup();
    const token = await sign({});
    const r = await verifyAndGate(token, jwks, { issuer: ISSUER, audience: AUD });
    expect(r).toEqual({ ok: false, status: 403, error: "접근 권한이 없습니다." });
  });

  it("만료된 토큰은 401", async () => {
    const { jwks, sign } = await setup();
    const token = await sign({ user_role: "staff" }, { expSec: Math.floor(Date.now() / 1000) - 60 });
    const r = await verifyAndGate(token, jwks, { issuer: ISSUER, audience: AUD });
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("다른 키로 서명된 토큰은 401", async () => {
    const a = await setup();
    const b = await setup();
    const token = await b.sign({ user_role: "admin" });
    const r = await verifyAndGate(token, a.jwks, { issuer: ISSUER, audience: AUD });
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("issuer 불일치는 401", async () => {
    const { jwks, sign } = await setup();
    const token = await sign({ user_role: "admin" });
    const r = await verifyAndGate(token, jwks, { issuer: "https://other/auth/v1", audience: AUD });
    expect(r).toMatchObject({ ok: false, status: 401 });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `bun test src/auth/verify.test.ts`
Expected: FAIL — `Cannot find module './verify'`.

- [ ] **Step 4: 구현**

Create `src/auth/verify.ts`:

```ts
import { jwtVerify, type JWTVerifyGetKey } from "jose";

export type AuthedUser = { id: string; role: string };
export type GateResult =
  | { ok: true; user: AuthedUser }
  | { ok: false; status: 401 | 403; error: string };

// CRM 접근 허용 역할(customer 제외). dealer는 user_role enum에 추가 예정(선행 의존).
export const CRM_ROLES = new Set(["staff", "manager", "admin", "dealer"]);

// 순수 검증+게이트. keyResolver를 주입받아 테스트는 로컬 JWKS, prod는 원격 JWKS를 쓴다.
// role은 Custom Access Token Hook이 넣는 top-level user_role claim에서 읽는다.
export async function verifyAndGate(
  token: string,
  keyResolver: JWTVerifyGetKey,
  opts: { issuer: string; audience: string },
): Promise<GateResult> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, keyResolver, {
      issuer: opts.issuer,
      audience: opts.audience,
    }));
  } catch {
    return { ok: false, status: 401, error: "인증 토큰이 유효하지 않습니다." };
  }
  const id = typeof payload.sub === "string" ? payload.sub : null;
  const role = typeof payload.user_role === "string" ? payload.user_role : null;
  if (!id || !role || !CRM_ROLES.has(role)) {
    return { ok: false, status: 403, error: "접근 권한이 없습니다." };
  }
  return { ok: true, user: { id, role } };
}
```

- [ ] **Step 5: 통과 확인**

Run: `bun test src/auth/verify.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: 커밋**

```bash
git add src/auth/verify.ts src/auth/verify.test.ts package.json bun.lock
git commit -m "feat(auth): JWKS 검증+role 게이트 순수 함수(verifyAndGate)"
```

---

### Task 2: 테스트 헬퍼 + `createAuthMiddleware` 팩토리

**Files:**
- Create: `src/auth/test-jwt.ts`, `src/middleware/auth.ts`

- [ ] **Step 1: 테스트 헬퍼 작성**

Create `src/auth/test-jwt.ts` (테스트 전용 — 로컬 키쌍으로 토큰·JWKS·issuer를 만든다):

```ts
// 테스트 전용. 로컬 키쌍으로 지정 role 토큰 + 같은 키의 JWKS + issuer를 만든다.
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";

export const TEST_ISSUER = "https://test.supabase.co/auth/v1";

export async function makeTestAuth(role = "staff", sub = "test-user"): Promise<{
  token: string;
  keyResolver: JWTVerifyGetKey;
  issuer: string;
}> {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  const kid = "test-key";
  const keyResolver = createLocalJWKSet({ keys: [{ ...jwk, kid, alg: "ES256", use: "sig" }] });
  const token = await new SignJWT({ user_role: role })
    .setProtectedHeader({ alg: "ES256", kid })
    .setIssuer(TEST_ISSUER)
    .setAudience("authenticated")
    .setSubject(sub)
    .setExpirationTime("1h")
    .sign(privateKey);
  return { token, keyResolver, issuer: TEST_ISSUER };
}
```

- [ ] **Step 2: 미들웨어 팩토리 구현**

Create `src/middleware/auth.ts`:

```ts
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import type { MiddlewareHandler } from "hono";

import { type AuthedUser, verifyAndGate } from "../auth/verify";

export type AuthVariables = { user: AuthedUser };

// 주입형: 기본은 원격 JWKS(c.env/process.env의 SUPABASE_URL), 테스트는 keyResolver+issuer 주입.
export function createAuthMiddleware(opts?: {
  keyResolver?: JWTVerifyGetKey;
  issuer?: string;
}): MiddlewareHandler<{ Variables: AuthVariables }> {
  // issuer별 원격 JWKS 캐시(주입 없을 때만).
  let cache: { issuer: string; jwks: JWTVerifyGetKey } | null = null;

  return async (c, next) => {
    let issuer = opts?.issuer;
    let keyResolver = opts?.keyResolver;
    if (!keyResolver) {
      const url = (c.env as { SUPABASE_URL?: string } | undefined)?.SUPABASE_URL ?? process.env.SUPABASE_URL;
      if (!url) throw new Error("SUPABASE_URL is not set (see .env.local / Cloudflare vars)");
      issuer = `${url}/auth/v1`;
      if (!cache || cache.issuer !== issuer) {
        cache = { issuer, jwks: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) };
      }
      keyResolver = cache.jwks;
    }

    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return c.json({ error: "인증이 필요합니다." }, 401);

    const result = await verifyAndGate(token, keyResolver, { issuer: issuer!, audience: "authenticated" });
    if (!result.ok) return c.json({ error: result.error }, result.status);

    c.set("user", result.user);
    await next();
  };
}
```

- [ ] **Step 3: 타입체크**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git add src/middleware/auth.ts src/auth/test-jwt.ts
git commit -m "feat(auth): createAuthMiddleware 팩토리(원격/주입 JWKS) + 테스트 JWT 헬퍼"
```

---

### Task 3: `createApp` 팩토리 + 보호 라우트 적용

**Files:**
- Modify: `src/app.ts`, `src/app.test.ts`

- [ ] **Step 1: app을 팩토리로 전환 + 미들웨어 적용**

Modify `src/app.ts`:

```ts
import { Hono } from "hono";

import { createAuthMiddleware } from "./middleware/auth";
import { catalog } from "./routes/catalog";
import { vehicles } from "./routes/vehicles";

// 테스트는 authOpts(로컬 keyResolver+issuer)를 주입해 보호 라우트를 통과 검증한다.
export function createApp(authOpts?: { keyResolver?: import("jose").JWTVerifyGetKey; issuer?: string }) {
  const app = new Hono();
  const auth = createAuthMiddleware(authOpts);

  app.get("/api/health", (c) => c.json({ ok: true, service: "mrcha-crm" }));

  // 보호 라우트: 카카오 로그인(Supabase JWT) + role 게이트.
  app.use("/api/vehicles/*", auth);
  app.use("/api/catalog/*", auth);

  app.route("/api/vehicles", vehicles);
  app.route("/api/catalog", catalog);

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  return app;
}

export const app = createApp();
```

- [ ] **Step 2: app.test.ts — health 공개 + 무토큰 401**

Modify `src/app.test.ts` (기존 health/404 유지 + 무토큰 401 추가):

```ts
import { describe, expect, test } from "bun:test";

import { app } from "./app";

describe("app (Hono)", () => {
  test("GET /api/health returns service status", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "mrcha-crm" });
  });

  test("unknown route returns 404 not found", async () => {
    const res = await app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  test("보호 라우트는 토큰 없으면 401", async () => {
    const res = await app.request("/api/catalog/brands");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "인증이 필요합니다." });
  });
});
```

> 무토큰 401은 미들웨어가 verify 전에 반환하므로 원격 JWKS(실 Supabase) 없이도 통과한다.

- [ ] **Step 3: 실패 확인**

Run: `bun test src/app.test.ts`
Expected: 무토큰 401 테스트 PASS, 기존 2개 PASS. (이 시점엔 catalog/vehicles routes 테스트가 깨진 상태 — Step 5에서 고친다.)

- [ ] **Step 4: 커밋**

```bash
git add src/app.ts src/app.test.ts
git commit -m "feat(auth): createApp 팩토리 + 보호 라우트(/api/vehicles·/api/catalog) 적용"
```

---

### Task 4: 기존 routes 테스트를 인증 통과로 수정

**Files:**
- Modify: `src/routes/catalog.test.ts`, `src/routes/vehicles.test.ts`

미들웨어 적용으로 두 테스트가 401이 된다. 로컬 키 app + Bearer 토큰으로 통과시킨다.

- [ ] **Step 1: catalog.test.ts 수정**

Modify `src/routes/catalog.test.ts`:

```ts
import { test, expect } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";

test("GET /api/catalog/counts → 200, 7테이블 건수", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/catalog/counts", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, number>;
  expect(body.brands).toBe(33);
  expect(typeof body.trimOptionRelations).toBe("number");
});
```

- [ ] **Step 2: vehicles.test.ts 수정**

Modify `src/routes/vehicles.test.ts` (모든 요청에 토큰 헤더, 로컬 키 app):

```ts
import { test, expect } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";

async function authedApp() {
  const { token, keyResolver, issuer } = await makeTestAuth("staff");
  const app = createApp({ keyResolver, issuer });
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  return { app, auth };
}

test("GET /api/vehicles/brands → 200, 브랜드 목록", async () => {
  const { app, auth } = await authedApp();
  const res = await app.request("/api/vehicles/brands", auth);
  expect(res.status).toBe(200);
  const body = (await res.json()) as unknown[];
  expect(body.length).toBe(33);
});

test("GET /api/vehicles/models?brandId= → 200", async () => {
  const { app, auth } = await authedApp();
  const brandsRes = await app.request("/api/vehicles/brands", auth);
  const brands = (await brandsRes.json()) as { id: number }[];
  const res = await app.request(`/api/vehicles/models?brandId=${brands[0].id}`, auth);
  expect(res.status).toBe(200);
});

test("GET /api/vehicles/models (brandId 없음) → 400", async () => {
  const { app, auth } = await authedApp();
  const res = await app.request("/api/vehicles/models", auth);
  expect(res.status).toBe(400);
});

test("GET /api/vehicles/trims/:trimId (없는 id) → 404", async () => {
  const { app, auth } = await authedApp();
  const res = await app.request("/api/vehicles/trims/999999999", auth);
  expect(res.status).toBe(404);
});
```

- [ ] **Step 3: 전체 서버 테스트 + 검증**

Run: `bun run typecheck && bun run lint && bun test --env-file=.env.local`
Expected: 모두 PASS. (server 테스트는 master DB 연결 필요 → `--env-file=.env.local`)

- [ ] **Step 4: 커밋**

```bash
git add src/routes/catalog.test.ts src/routes/vehicles.test.ts
git commit -m "test(auth): 기존 routes 테스트를 로컬 키 인증 통과로 수정"
```

---

## 완료 기준 / 다음 단계

- **완료 기준**: `verifyAndGate` 6 테스트 통과 · 보호 라우트 무토큰 401 · health 공개 200 · 기존 routes 테스트 인증 통과 · typecheck/lint/test 그린.
- **다음 plan(프론트 인증)**: `@supabase/supabase-js` 카카오 로그인 + `lib/api` 토큰 주입(모든 fetch에 Bearer) + `AuthProvider`/라우트 가드 + mock 역할 탭 제거 + role→화면권한 매핑. 이 백엔드가 머지된 위에서.
- **실배포 검증**: 선행 의존(앱 enum `dealer`, Auth Hook, redirect allowlist) + Cloudflare `SUPABASE_URL` 완료 후.
