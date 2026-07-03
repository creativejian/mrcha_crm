# CRM Gemini Supabase Edge 프록시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** prod CF Workers의 HKG 콜로 라우팅으로 인한 Gemini 리전 차단을 Supabase Edge 투명 릴레이(`crm-gemini-proxy`) + `GEMINI_PROXY_URL` 스위치로 우회한다.

**Architecture:** 신설 Edge Function은 staff JWT 인증 + 호스트 교체만 하는 완전 투명 릴레이(경로·쿼리·바디·응답 스트림 패스스루). CRM lib 3함수는 `apiKey: string` 인자를 `GeminiTarget`(baseUrl·apiKey·extraHeaders) 객체로 교체하고, 키는 양 모드 모두 `x-goog-api-key` 헤더로 통일한다. 라우트가 env로 직결/프록시를 분기하고 `x-region: ap-northeast-2`를 핀한다.

**Tech Stack:** Deno(Supabase Edge, plain `Deno.serve` — 단일 라우트라 Hono 불필요), jose(기존 핀), bun:test, Hono(CRM 백엔드).

**Spec:** `ref/specs/2026-07-03-crm-gemini-edge-proxy-design.md` (함정 4종 포함 — x-region 핀·Authorization 미전달·버퍼링 금지·키는 헤더로)

---

## File Structure

- Create: `supabase/functions/crm-gemini-proxy/relay.ts` — allowlist·헤더 세척·패스스루 (순수, 테스트 대상)
- Create: `supabase/functions/crm-gemini-proxy/relay_test.ts`
- Create: `supabase/functions/crm-gemini-proxy/index.ts` — `Deno.serve` + 인증 게이트(`../crm-analyst/auth.ts` 재사용) + relay 조립 (crm-analyst index와 동일 패턴의 얇은 배선)
- Create: `src/lib/gemini-target.ts` — `GeminiTarget` 타입 + `resolveGeminiTarget()` + `geminiHeaders()`
- Create: `src/lib/gemini-target.test.ts`
- Modify: `src/lib/gemini-embed.ts` — target 기반 URL/헤더
- Modify: `src/lib/gemini-embed.test.ts`
- Modify: `src/lib/gemini-generate.ts` — target 기반 URL/헤더 (generateAnswer + generateAnswerStream)
- Modify: `src/lib/gemini-generate.test.ts`
- Modify: `src/routes/assistant.ts` — target 구성(env 분기 + Authorization 포워딩), `StreamAskArgs.apiKey` → `target`
- Modify: `src/routes/assistant.test.ts:35` — mock 파라미터 타입 1건
- Modify: `src/scripts/backfill-embeddings.ts` — 직결 target

---

### Task 1: Edge 릴레이 모듈 `relay.ts` (Deno TDD)

**Files:**
- Create: `supabase/functions/crm-gemini-proxy/relay_test.ts`
- Create: `supabase/functions/crm-gemini-proxy/relay.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`supabase/functions/crm-gemini-proxy/relay_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { relayRequest } from "./relay.ts";

const BASE = "http://edge.test/crm-gemini-proxy";

function post(path: string, headers: Record<string, string> = { "x-goog-api-key": "K" }, body = "{}"): Request {
  return new Request(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
}

Deno.test("POST 외 메서드는 405", async () => {
  const res = await relayRequest(new Request(`${BASE}/v1beta/models/m:generateContent`, { method: "GET" }));
  assertEquals(res.status, 405);
});

Deno.test("allowlist 밖 경로는 404 — 업스트림 fetch 미호출", async () => {
  let called = false;
  const fetchImpl = (() => { called = true; return Promise.resolve(new Response("")); }) as unknown as typeof fetch;
  for (const p of ["/v1beta/models/m:countTokens", "/v1beta/models", "/v1/other", "/v1beta/models/m:generateContent/extra"]) {
    const res = await relayRequest(post(p), fetchImpl);
    assertEquals(res.status, 404);
  }
  assertEquals(called, false);
});

Deno.test("허용 3종은 업스트림 URL로 경로·쿼리 보존 전달 (함수 프리픽스 제거)", async () => {
  const urls: string[] = [];
  const fetchImpl = ((u: string | URL | Request) => { urls.push(String(u)); return Promise.resolve(new Response("{}")); }) as unknown as typeof fetch;
  await relayRequest(post("/v1beta/models/gemini-embedding-001:batchEmbedContents"), fetchImpl);
  await relayRequest(post("/v1beta/models/gemini-3.1-flash-lite:generateContent"), fetchImpl);
  await relayRequest(post("/v1beta/models/gemini-3.1-flash-lite:streamGenerateContent?alt=sse"), fetchImpl);
  assertEquals(urls, [
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:streamGenerateContent?alt=sse",
  ]);
});

Deno.test("프리픽스 없는 경로(로컬 serve 등)도 동일 매칭", async () => {
  let url = "";
  const fetchImpl = ((u: string | URL | Request) => { url = String(u); return Promise.resolve(new Response("{}")); }) as unknown as typeof fetch;
  const req = new Request("http://edge.test/v1beta/models/m:generateContent", {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": "K" }, body: "{}",
  });
  const res = await relayRequest(req, fetchImpl);
  assertEquals(res.status, 200);
  assertEquals(url, "https://generativelanguage.googleapis.com/v1beta/models/m:generateContent");
});

Deno.test("헤더 세척: x-goog-api-key·content-type만 전달, Authorization·apikey·x-region 미전달", async () => {
  let headers: Headers | null = null;
  const fetchImpl = ((_u: string | URL | Request, init?: RequestInit) => {
    headers = new Headers(init?.headers);
    return Promise.resolve(new Response("{}"));
  }) as unknown as typeof fetch;
  await relayRequest(post("/v1beta/models/m:generateContent", {
    "x-goog-api-key": "K", Authorization: "Bearer staff-jwt", apikey: "publishable", "x-region": "ap-northeast-2", "x-client-info": "x",
  }), fetchImpl);
  assertEquals(headers!.get("x-goog-api-key"), "K");
  assertEquals(headers!.get("content-type"), "application/json");
  assertEquals(headers!.get("authorization"), null);
  assertEquals(headers!.get("apikey"), null);
  assertEquals(headers!.get("x-region"), null);
  assertEquals(headers!.get("x-client-info"), null);
});

Deno.test("x-goog-api-key 없으면 400 — 업스트림 fetch 미호출", async () => {
  let called = false;
  const fetchImpl = (() => { called = true; return Promise.resolve(new Response("")); }) as unknown as typeof fetch;
  const res = await relayRequest(post("/v1beta/models/m:generateContent", {}), fetchImpl);
  assertEquals(res.status, 400);
  assertEquals(called, false);
});

Deno.test("요청 바디를 그대로 업스트림에 전달", async () => {
  let body = "";
  const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
    body = await new Response(init?.body as BodyInit).text();
    return new Response("{}");
  }) as unknown as typeof fetch;
  await relayRequest(post("/v1beta/models/m:generateContent", { "x-goog-api-key": "K" }, JSON.stringify({ contents: [1] })), fetchImpl);
  assertEquals(body, JSON.stringify({ contents: [1] }));
});

Deno.test("업스트림 status·content-type·스트림 바디 그대로 통과 (SSE)", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode("data: x\n\n")); c.close(); },
  });
  const fetchImpl = (() =>
    Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }))) as unknown as typeof fetch;
  const res = await relayRequest(post("/v1beta/models/m:streamGenerateContent?alt=sse"), fetchImpl);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/event-stream");
  assertEquals(await res.text(), "data: x\n\n");
});

Deno.test("업스트림 에러 status(429)·본문 그대로 통과 — CRM classifyGeminiError 분류용", async () => {
  const fetchImpl = (() => Promise.resolve(new Response("quota", { status: 429 }))) as unknown as typeof fetch;
  const res = await relayRequest(post("/v1beta/models/m:generateContent"), fetchImpl);
  assertEquals(res.status, 429);
  assertEquals(await res.text(), "quota");
});
```

- [ ] **Step 2: 실패 확인**

Run: `deno test --config supabase/functions/deno.json supabase/functions/crm-gemini-proxy/`
Expected: FAIL — `relay.ts` 모듈 없음.

- [ ] **Step 3: 구현**

`supabase/functions/crm-gemini-proxy/relay.ts`:

```ts
// Gemini 투명 릴레이 — 인증(index.ts)을 통과한 요청의 경로·쿼리·바디를 그대로
// generativelanguage.googleapis.com에 전달한다. Gemini 스키마를 모르는 순수 패스스루라
// CRM 쪽 classifyGeminiError·재시도 로직이 무변경으로 동작한다.
export const UPSTREAM_BASE = "https://generativelanguage.googleapis.com";

// supabase 게이트웨이가 함수에 넘기는 pathname은 "/crm-gemini-proxy/…" — 프리픽스를 벗겨 Gemini 경로만 남긴다.
const FN_PREFIX = "/crm-gemini-proxy";
// 오픈 프록시 방지 2중 방어(1차는 staff 인증): CRM이 실제 쓰는 3개 메서드만 통과.
const ALLOWED_PATH = /^\/v1beta\/models\/[^/:]+:(batchEmbedContents|generateContent|streamGenerateContent)$/;

export async function relayRequest(
  req: Request,
  fetchImpl: typeof fetch = fetch,
  upstreamBase: string = UPSTREAM_BASE,
): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "POST만 허용합니다." }, { status: 405 });

  const url = new URL(req.url);
  const path = url.pathname.startsWith(FN_PREFIX) ? url.pathname.slice(FN_PREFIX.length) : url.pathname;
  if (!ALLOWED_PATH.test(path)) return Response.json({ error: "허용되지 않은 경로입니다." }, { status: 404 });

  const apiKey = req.headers.get("x-goog-api-key");
  if (!apiKey) return Response.json({ error: "x-goog-api-key 헤더가 필요합니다." }, { status: 400 });

  // Google로 나가는 헤더는 딱 2개. Authorization(supabase JWT)을 전달하면 Google이 OAuth
  // 토큰으로 오인해 유효한 API 키가 있어도 401이 난다(스펙 함정 2).
  const upstream = await fetchImpl(`${upstreamBase}${path}${url.search}`, {
    method: "POST",
    headers: { "Content-Type": req.headers.get("content-type") ?? "application/json", "x-goog-api-key": apiKey },
    body: req.body,
  });

  // 바디는 읽지 않고 그대로 반환 — 버퍼링하면 SSE 첫 청크가 지연된다(스펙 함정 3).
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `deno test --config supabase/functions/deno.json supabase/functions/crm-gemini-proxy/`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/crm-gemini-proxy/relay.ts supabase/functions/crm-gemini-proxy/relay_test.ts
git commit -m "feat(crm): crm-gemini-proxy 릴레이 모듈 — allowlist·헤더 세척·스트림 패스스루"
```

---

### Task 2: Edge `index.ts` 조립 (인증 게이트 + relay)

**Files:**
- Create: `supabase/functions/crm-gemini-proxy/index.ts`

배선만 있는 얇은 파일 — crm-analyst `index.ts`의 인증 흐름과 동일 패턴(그쪽은 auth_test + 배포 스모크로 커버, 여기도 로직은 `verifyStaff`·`relayRequest`에 있고 둘 다 테스트됨). 별도 유닛 없이 `deno check`/`lint` + 배포 후 실측으로 검증.

- [ ] **Step 1: 구현**

`supabase/functions/crm-gemini-proxy/index.ts`:

```ts
import { createRemoteJWKSet } from "jose";

import { verifyStaff } from "../crm-analyst/auth.ts";
import { relayRequest } from "./relay.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

// JWKS는 모듈 레벨 1회 생성(crm-analyst 동일).
const issuer = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : "";
const jwks = SUPABASE_URL ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) : null;

// CORS 없음 — CRM 백엔드(서버→서버) 전용, 브라우저 호출 없음.
Deno.serve(async (req) => {
  if (!jwks) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const header = req.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return Response.json({ error: "인증이 필요합니다." }, { status: 401 });
  const gate = await verifyStaff(token, jwks, { issuer, audience: "authenticated" });
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });
  return relayRequest(req);
});
```

- [ ] **Step 2: 정적 검증**

Run: `deno check --config supabase/functions/deno.json supabase/functions/crm-gemini-proxy/index.ts && deno lint --config supabase/functions/deno.json supabase/functions/crm-gemini-proxy/`
Expected: 에러 0

- [ ] **Step 3: 커밋**

```bash
git add supabase/functions/crm-gemini-proxy/index.ts
git commit -m "feat(crm): crm-gemini-proxy index — staff JWT 게이트(../crm-analyst/auth.ts 재사용) + 릴레이 조립"
```

---

### Task 3: CRM `gemini-target.ts` (TDD)

**Files:**
- Create: `src/lib/gemini-target.test.ts`
- Create: `src/lib/gemini-target.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/gemini-target.test.ts`:

```ts
import { test, expect } from "bun:test";

import { resolveGeminiTarget, geminiHeaders, GEMINI_DIRECT_BASE } from "./gemini-target";

test("proxyUrl 미설정 → 직결 target (extraHeaders 없음)", () => {
  const t = resolveGeminiTarget({ apiKey: "KEY" });
  expect(t.baseUrl).toBe(GEMINI_DIRECT_BASE);
  expect(t.apiKey).toBe("KEY");
  expect(t.extraHeaders).toBeUndefined();
});

test("빈 문자열/공백 proxyUrl도 직결 취급", () => {
  expect(resolveGeminiTarget({ apiKey: "K", proxyUrl: "" }).baseUrl).toBe(GEMINI_DIRECT_BASE);
  expect(resolveGeminiTarget({ apiKey: "K", proxyUrl: "  " }).baseUrl).toBe(GEMINI_DIRECT_BASE);
});

test("proxyUrl 설정 → 프록시 target: Authorization 포워딩 + x-region 서울 핀, 꼬리 슬래시 제거", () => {
  const t = resolveGeminiTarget({ apiKey: "KEY", proxyUrl: "https://x.supabase.co/functions/v1/crm-gemini-proxy/", authHeader: "Bearer staff-jwt" });
  expect(t.baseUrl).toBe("https://x.supabase.co/functions/v1/crm-gemini-proxy");
  expect(t.extraHeaders).toEqual({ Authorization: "Bearer staff-jwt", "x-region": "ap-northeast-2" });
});

test("proxyUrl만 있고 authHeader 없으면 throw (백필 오설정 방지)", () => {
  expect(() => resolveGeminiTarget({ apiKey: "K", proxyUrl: "https://x.supabase.co/functions/v1/crm-gemini-proxy" })).toThrow();
});

test("geminiHeaders: 키는 x-goog-api-key 헤더, extraHeaders 병합", () => {
  expect(geminiHeaders(resolveGeminiTarget({ apiKey: "KEY" }))).toEqual({
    "Content-Type": "application/json",
    "x-goog-api-key": "KEY",
  });
  const proxied = geminiHeaders(resolveGeminiTarget({ apiKey: "KEY", proxyUrl: "https://p", authHeader: "Bearer j" }));
  expect(proxied.Authorization).toBe("Bearer j");
  expect(proxied["x-region"]).toBe("ap-northeast-2");
  expect(proxied["x-goog-api-key"]).toBe("KEY");
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:server src/lib/gemini-target.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/lib/gemini-target.ts`:

```ts
// Gemini 호출 대상 — 직결(기본) vs Supabase Edge 프록시(crm-gemini-proxy, GEMINI_PROXY_URL 설정 시).
// 프록시는 prod CF Workers의 HKG 콜로 리전 차단 우회용(스펙: ref/specs/2026-07-03-crm-gemini-edge-proxy-design.md).
export const GEMINI_DIRECT_BASE = "https://generativelanguage.googleapis.com";
// 서울 핀 — Supabase Edge 기본은 호출자 최근접 실행이라, 핀 없이 HKG CF Worker가 부르면 차단이 재현된다.
const GEMINI_PROXY_REGION = "ap-northeast-2";

export type GeminiTarget = {
  baseUrl: string; // 끝 슬래시 없음
  apiKey: string; // 항상 x-goog-api-key 헤더로 전달(?key= 쿼리는 프록시/게이트웨이 로그에 남는다)
  extraHeaders?: Record<string, string>; // 프록시: Authorization(staff JWT 포워딩)·x-region
};

export function resolveGeminiTarget(opts: {
  apiKey: string;
  proxyUrl?: string | null; // GEMINI_PROXY_URL — 미설정이면 직결(로컬 dev·백필)
  authHeader?: string | null; // 수신 요청 Authorization 원문 — 프록시가 verifyStaff로 재검증
}): GeminiTarget {
  const proxyUrl = opts.proxyUrl?.trim();
  if (!proxyUrl) return { baseUrl: GEMINI_DIRECT_BASE, apiKey: opts.apiKey };
  if (!opts.authHeader) throw new Error("GEMINI_PROXY_URL 설정 시 Authorization 포워딩이 필요합니다");
  return {
    baseUrl: proxyUrl.replace(/\/+$/, ""),
    apiKey: opts.apiKey,
    extraHeaders: { Authorization: opts.authHeader, "x-region": GEMINI_PROXY_REGION },
  };
}

export function geminiHeaders(target: GeminiTarget): Record<string, string> {
  return { "Content-Type": "application/json", "x-goog-api-key": target.apiKey, ...target.extraHeaders };
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:server src/lib/gemini-target.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/gemini-target.ts src/lib/gemini-target.test.ts
git commit -m "feat(crm): GeminiTarget — 직결/프록시 분기·x-goog-api-key 헤더·x-region 서울 핀"
```

---

### Task 4: `gemini-embed.ts` target 전환

**Files:**
- Modify: `src/lib/gemini-embed.ts`
- Modify: `src/lib/gemini-embed.test.ts`

- [ ] **Step 1: 테스트를 target 시그니처로 갱신 (실패 상태로)**

`src/lib/gemini-embed.test.ts` 변경점:

```ts
import { test, expect } from "bun:test";

import { embedTexts, EMBEDDING_MODEL } from "./gemini-embed";
import { resolveGeminiTarget } from "./gemini-target";

const TARGET = resolveGeminiTarget({ apiKey: "KEY" });
```

- 각 호출의 `"KEY"` 인자를 `TARGET`으로 교체 (4곳: line 12, 24, 30, 44).
- 첫 테스트의 URL/키 단언 교체 — 헤더 캡처 추가:

```ts
test("embedTexts: batchEmbedContents 요청 본문 + 응답 파싱", async () => {
  let captured: { url: string; headers: Record<string, string>; body: unknown } | null = null;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), headers: { ...(init?.headers as Record<string, string>) }, body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const out = await embedTexts(["a", "b"], TARGET, "RETRIEVAL_DOCUMENT", fakeFetch);

  expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  expect(captured!.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`);
  expect(captured!.headers["x-goog-api-key"]).toBe("KEY");
  expect(captured!.url).not.toContain("key=");
  const body = captured!.body as { requests: { model: string; content: { parts: { text: string }[] }; taskType: string }[] };
  expect(body.requests).toHaveLength(2);
  expect(body.requests[0].content.parts[0].text).toBe("a");
  expect(body.requests[0].taskType).toBe("RETRIEVAL_DOCUMENT");
});
```

- 프록시 모드 URL/헤더 테스트 1건 추가:

```ts
test("embedTexts: 프록시 target이면 프록시 baseUrl + Authorization/x-region 헤더", async () => {
  let captured: { url: string; headers: Record<string, string> } | null = null;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), headers: { ...(init?.headers as Record<string, string>) } };
    return new Response(JSON.stringify({ embeddings: [{ values: [1] }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const proxied = resolveGeminiTarget({ apiKey: "KEY", proxyUrl: "https://x.supabase.co/functions/v1/crm-gemini-proxy", authHeader: "Bearer j" });
  await embedTexts(["a"], proxied, "RETRIEVAL_QUERY", fakeFetch);

  expect(captured!.url).toBe(`https://x.supabase.co/functions/v1/crm-gemini-proxy/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`);
  expect(captured!.headers.Authorization).toBe("Bearer j");
  expect(captured!.headers["x-region"]).toBe("ap-northeast-2");
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:server src/lib/gemini-embed.test.ts`
Expected: FAIL (타입/URL 불일치)

- [ ] **Step 3: 구현**

`src/lib/gemini-embed.ts` 변경점:

```ts
import { classifyGeminiError } from "./gemini-error";
import { geminiHeaders, type GeminiTarget } from "./gemini-target";
```

- `embedTexts`/`embedBatch`의 `apiKey: string` 파라미터를 `target: GeminiTarget`으로 교체.
- `embedBatch` URL/fetch 교체:

```ts
  const url = `${target.baseUrl}/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`;
  // …
    const res = await fetchImpl(url, { method: "POST", headers: geminiHeaders(target), body });
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:server src/lib/gemini-embed.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/gemini-embed.ts src/lib/gemini-embed.test.ts
git commit -m "feat(crm): embedTexts를 GeminiTarget 기반으로 — ?key= 쿼리 제거, x-goog-api-key 헤더"
```

---

### Task 5: `gemini-generate.ts` target 전환

**Files:**
- Modify: `src/lib/gemini-generate.ts`
- Modify: `src/lib/gemini-generate.test.ts`

- [ ] **Step 1: 테스트를 target 시그니처로 갱신 (실패 상태로)**

`src/lib/gemini-generate.test.ts` 변경점:

```ts
import { generateAnswer, generateAnswerStream, GEN_MODEL } from "./gemini-generate";
import { resolveGeminiTarget } from "./gemini-target";

const TARGET = resolveGeminiTarget({ apiKey: "KEY" });
```

- 모든 호출의 `"KEY"`/`"K"` 인자를 `TARGET`으로 교체 (line 12, 27, 40, 62, 74, 80, 94, 118, 128, 139, 162).
- line 65 URL 단언 교체:

```ts
  expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEN_MODEL}:streamGenerateContent?alt=sse`);
```

- 첫 테스트(line 5~18)에 헤더 단언 추가 — `captured`에 `headers: { ...(init?.headers as Record<string, string>) }`를 담고:

```ts
  expect(captured!.headers["x-goog-api-key"]).toBe("KEY");
  expect(captured!.url).not.toContain("key=");
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:server src/lib/gemini-generate.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`src/lib/gemini-generate.ts` 변경점:

```ts
import { classifyGeminiError } from "./gemini-error";
import { geminiHeaders, type GeminiTarget } from "./gemini-target";
```

- `generateAnswer`/`generateAnswerStream`의 `apiKey: string` 파라미터를 `target: GeminiTarget`으로 교체.
- URL/fetch 교체 2곳:

```ts
  const url = `${target.baseUrl}/v1beta/models/${GEN_MODEL}:generateContent`;
  // …
    const res = await fetchImpl(url, { method: "POST", headers: geminiHeaders(target), body });
```

```ts
  const url = `${target.baseUrl}/v1beta/models/${GEN_MODEL}:streamGenerateContent?alt=sse`;
  // …
    res = await fetchImpl(url, { method: "POST", headers: geminiHeaders(target), body });
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:server src/lib/gemini-generate.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/gemini-generate.ts src/lib/gemini-generate.test.ts
git commit -m "feat(crm): generateAnswer/Stream을 GeminiTarget 기반으로 — ?key= 쿼리 제거"
```

---

### Task 6: 호출부 전환 — `routes/assistant.ts` · 백필 스크립트

**Files:**
- Modify: `src/routes/assistant.ts`
- Modify: `src/routes/assistant.test.ts:35`
- Modify: `src/scripts/backfill-embeddings.ts`

- [ ] **Step 1: 라우트 전환**

`src/routes/assistant.ts` 변경점:

```ts
import { resolveGeminiTarget, type GeminiTarget } from "../lib/gemini-target";
```

`/ask` 핸들러 — apiKey 체크(line 67~68)는 유지하고, try 블록 첫머리(line 72 `const scope` 앞)에서 target 구성(오설정 throw가 기존 catch→500으로 수용되도록 try 안):

```ts
    // GEMINI_PROXY_URL 설정 시(prod) Supabase Edge 릴레이 경유 — HKG 콜로 리전 차단 우회.
    const proxyUrl = (c.env as { GEMINI_PROXY_URL?: string } | undefined)?.GEMINI_PROXY_URL ?? process.env.GEMINI_PROXY_URL;
    const target = resolveGeminiTarget({ apiKey, proxyUrl, authHeader: c.req.header("Authorization") });
```

- line 77: `assistantDeps.embedTexts([question], target, "RETRIEVAL_QUERY")`
- line 94: `streamAsk(c, { question, staffUserId, target, history, hits, promptChunks, sources })`
- line 99: `assistantDeps.generateAnswer(SYSTEM_PROMPT, buildUserPrompt(question, buildContextBlock(promptChunks)), target, history)`
- `StreamAskArgs`의 `apiKey: string` → `target: GeminiTarget`
- `streamAsk` 내 line 169: `args.apiKey` → `args.target`

- [ ] **Step 2: 라우트 테스트 mock 타입 1건 갱신**

`src/routes/assistant.test.ts:35` — `_k: string`이 `GeminiTarget`과 불일치로 typecheck 깨짐:

```ts
  assistantDeps.generateAnswer = async (_s: string, _u: string, _t: unknown, history: { role: string }[] = []) => { seen.historyLen = history.length; return "답변"; };
```

- [ ] **Step 3: 백필 스크립트 전환**

`src/scripts/backfill-embeddings.ts` 변경점:

```ts
import { embedTexts } from "../lib/gemini-embed";
import { resolveGeminiTarget } from "../lib/gemini-target";

const db = getDefaultDb();
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY is not set (.env.local)");
const geminiTarget = resolveGeminiTarget({ apiKey }); // 로컬 실행 — 항상 직결(한국 IP)
```

- line 61: `const vectors = await embedTexts(contents, geminiTarget, "RETRIEVAL_DOCUMENT");`

- [ ] **Step 4: 검증**

Run: `bun run typecheck && bun run test:server src/routes/assistant.test.ts`
Expected: typecheck 에러 0, 라우트 테스트 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/routes/assistant.ts src/routes/assistant.test.ts src/scripts/backfill-embeddings.ts
git commit -m "feat(crm): /ask·백필 GeminiTarget 전환 — GEMINI_PROXY_URL 분기 + Authorization 포워딩"
```

---

### Task 7: 전체 검증

- [ ] **Step 1: 4종 + build + deno 전체**

```bash
bun run typecheck && bun run lint && bun run test:server && bun run test:unit && bun run build
deno test --config supabase/functions/deno.json supabase/functions/crm-gemini-proxy/
deno lint --config supabase/functions/deno.json supabase/functions/crm-gemini-proxy/
deno check --config supabase/functions/deno.json supabase/functions/crm-gemini-proxy/index.ts
```

Expected: lint 0 problems, 테스트 전부 green, build 성공.

- [ ] **Step 2: 잔여 수정이 있었으면 커밋**

---

### Task 8: 배포 · 실측 · PR

- [ ] **Step 1: Edge 함수 배포 (master, 함수명 지정 — 앱 함수 불가침)**

```bash
supabase functions deploy crm-gemini-proxy --project-ref wmkbmlespgzkeekliwio
```

- [ ] **Step 2: 릴레이 단독 curl 스모크**

staff JWT는 GoTrue admin `generate_link`(magiclink, `.env.local`의 `SUPABASE_SECRET_KEY`) 흐름으로 발급(브리프 로그인 우회 절차). 발급한 `ACCESS_TOKEN`으로:

```bash
curl -sS -X POST "https://wmkbmlespgzkeekliwio.supabase.co/functions/v1/crm-gemini-proxy/v1beta/models/gemini-3.1-flash-lite:generateContent" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "x-region: ap-northeast-2" \
  -H "x-goog-api-key: $GEMINI_API_KEY" -H "content-type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"ping"}]}]}'
```

Expected: 200 + candidates JSON. (401/403이면 인증 게이트, 404면 allowlist, 400 FAILED_PRECONDITION이면 리전 문제.)
무인증 요청이 401인 것도 확인:

```bash
curl -sS -o /dev/null -w "%{http_code}" -X POST "https://wmkbmlespgzkeekliwio.supabase.co/functions/v1/crm-gemini-proxy/v1beta/models/gemini-3.1-flash-lite:generateContent" -H "content-type: application/json" -d '{}'
```

Expected: 401

- [ ] **Step 3: 로컬 프록시 경유 브라우저 스모크**

`.env.local`에 `GEMINI_PROXY_URL=https://wmkbmlespgzkeekliwio.supabase.co/functions/v1/crm-gemini-proxy` 임시 추가 → `bun dev` 재시작(백엔드 watch 없음) → magiclink 세션으로 업무 AI 왕복(논스트리밍은 기존 대화 로드, 스트리밍 질문 1회 — 타자기·done 정상) → **스모크 대화 master에서 삭제** → env 제거.

- [ ] **Step 4: PR 생성**

```bash
git push -u origin feat/crm-gemini-edge-proxy
gh pr create --title "feat(crm): Gemini Supabase Edge 프록시 — HKG 리전 차단 우회(A안)" --body "..."
```

PR 본문에: 문제(HKG 콜로 400)·설계(투명 릴레이+x-region 핀+GEMINI_PROXY_URL 스위치)·검증 결과·**머지 후 작업**(CF Pages Production `GEMINI_PROXY_URL` 설정 → prod 스트리밍 실측 = #143 dbHold 검증 겸). `[skip ci]` 금지.

- [ ] **Step 5 (머지 후): CF Pages env + prod 실측**

- CF 대시보드: Production 환경변수 `GEMINI_PROXY_URL=https://wmkbmlespgzkeekliwio.supabase.co/functions/v1/crm-gemini-proxy` 추가 → 재배포.
- prod 업무 AI: 논스트리밍/스트리밍 왕복 + 중지 부분저장 + 유령 빈 말풍선 0 (**#143 dbHold prod 검증 마무리**).
- `ref/active-session-brief.md` 갱신(리전 이슈 해소 기록).
