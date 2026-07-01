# crm-analyst 서류 자동분류 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객 상세 서류함 업로드 시, 파일명 regex 분류를 Gemini vision 분류로 격상하되 실패·불확실 시 regex로 폴백한다.

**Architecture:** CRM 레포에 신설하는 Supabase Edge Function `crm-analyst`(Deno + Hono)가 staff JWT를 검증하고 이미지/PDF를 `gemini-3.1-flash-lite` vision으로 22종 중 하나(또는 `unknown`)로 분류한다. 프론트는 업로드 *전* 이 함수를 직접 invoke하고, `unknown`·에러면 기존 `classifyKimDocumentFile`(regex)로 폴백한 뒤 기존 CF Workers 업로드 경로를 그대로 탄다.

**Tech Stack:** Deno, Hono, jose(JWT), Gemini REST `generateContent`(structured output), Supabase Edge Functions, React(프론트), supabase-js `functions.invoke`.

**Spec:** `ref/specs/2026-07-01-crm-analyst-document-classify-design.md`

**환경 확인 완료:** deno 2.9.0 · supabase CLI 2.109.0 설치됨. tsconfig `include`에 supabase 없음(typecheck 자동 제외). eslint는 `eslint.config.js:11` ignores에 추가 필요(Task 1). CRM staff 게이트 SSOT = `src/auth/verify.ts`(`CRM_ROLES = staff/manager/admin/dealer`, `user_role` top-level claim, issuer `${SUPABASE_URL}/auth/v1`, audience `authenticated`).

---

## File Structure

**신규 — Edge Function (Deno, `supabase/functions/`):**
- `supabase/config.toml` — Supabase 프로젝트 링크 config (supabase CLI 생성)
- `supabase/functions/deno.json` — Deno 설정(lib, importMap)
- `supabase/functions/import_map.json` — hono, jose
- `supabase/functions/crm-analyst/doc-types.ts` — 22종 상수 + 프롬프트 + responseSchema
- `supabase/functions/crm-analyst/gemini.ts` — vision 호출 + 에러분류 + 재시도
- `supabase/functions/crm-analyst/auth.ts` — staff JWT 게이트(verify.ts 로직 재현)
- `supabase/functions/crm-analyst/index.ts` — Hono app 조립(CORS + 인증 + 핸들러)
- 테스트: `doc-types_test.ts`, `gemini_test.ts`, `auth_test.ts` (같은 폴더)

**신규 — 프론트:**
- `client/src/lib/document-classify.ts` — `classifyDocumentWithAI(file)` + base64 인코딩
- `client/src/lib/document-classify.test.ts`

**수정:**
- `eslint.config.js:11` — ignores에 `supabase/functions/` 추가
- `client/src/components/customer-detail/hooks/useCustomerDocuments.ts` — `addDocumentFiles` 교체+병렬화

**책임 경계:** Edge Function은 **vision 분류만**(22종 or `unknown`). regex 폴백은 **프론트 lib**. 업로드 경로(`uploadDocument`)·서버 라우트는 **손대지 않음**.

---

## Task 1: Edge Function 스캐폴드 + config + eslint ignore

**Files:**
- Create: `supabase/functions/deno.json`
- Create: `supabase/functions/import_map.json`
- Create: `supabase/functions/crm-analyst/index.ts` (뼈대)
- Modify: `eslint.config.js:11`

- [ ] **Step 1: Deno 설정 파일 생성**

`supabase/functions/deno.json`:
```json
{
  "compilerOptions": {
    "lib": ["deno.ns", "deno.unstable", "dom"]
  },
  "lint": {
    "rules": {
      "exclude": ["no-import-prefix"]
    }
  },
  "importMap": "./import_map.json"
}
```

`supabase/functions/import_map.json`:
```json
{
  "imports": {
    "hono": "https://esm.sh/hono@4.6.14",
    "hono/": "https://esm.sh/hono@4.6.14/",
    "jose": "https://esm.sh/jose@6.2.3"
  }
}
```

- [ ] **Step 2: index.ts 최소 뼈대 생성**

`supabase/functions/crm-analyst/index.ts`:
```ts
import { Hono } from "hono";

const app = new Hono();

app.get("/crm-analyst/health", (c) => c.json({ ok: true }));

Deno.serve(app.fetch);
```

- [ ] **Step 3: eslint가 supabase/functions를 검사하지 않도록 ignore 추가**

`eslint.config.js:11`의 ignores 배열 끝에 `"supabase/functions/"` 추가:
```js
    ignores: ["node_modules/", "client/dist/", "build/", "coverage/", "screenshots/", "test-results/", "playwright-report/", ".wrangler/", "src/db/catalog.ts", "drizzle/_catalog_introspect/", "supabase/functions/"],
```

- [ ] **Step 4: Deno 타입 체크 + CRM lint 통과 확인**

Run: `deno check --config supabase/functions/deno.json supabase/functions/crm-analyst/index.ts`
Expected: 에러 없음 (esm.sh import 첫 다운로드 후 통과)

Run: `bun run lint`
Expected: 0 problems (supabase/functions가 ignore돼 Deno 문법이 eslint에 안 걸림)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/deno.json supabase/functions/import_map.json supabase/functions/crm-analyst/index.ts eslint.config.js
git commit -m "feat(crm-analyst): Edge Function 스캐폴드 + deno config + eslint ignore"
```

---

## Task 2: doc-types.ts — 22종 상수 + 프롬프트 + responseSchema

**Files:**
- Create: `supabase/functions/crm-analyst/doc-types.ts`
- Test: `supabase/functions/crm-analyst/doc-types_test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`supabase/functions/crm-analyst/doc-types_test.ts`:
```ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CLASSIFY_RESPONSE_SCHEMA, DOC_TYPE_OPTIONS, buildClassifyPrompt } from "./doc-types.ts";

Deno.test("DOC_TYPE_OPTIONS는 22종", () => {
  assertEquals(DOC_TYPE_OPTIONS.length, 22);
  assert(DOC_TYPE_OPTIONS.includes("기타서류"));
  assert(DOC_TYPE_OPTIONS.includes("면허증"));
});

Deno.test("responseSchema enum은 22종 + unknown", () => {
  const en = CLASSIFY_RESPONSE_SCHEMA.properties.docType.enum;
  assertEquals(en.length, 23);
  assert(en.includes("unknown"));
  assert(en.includes("법인(점)재무제표(당해)"));
});

Deno.test("프롬프트는 22종을 모두 포함하고 unknown 규칙을 명시", () => {
  const p = buildClassifyPrompt();
  for (const t of DOC_TYPE_OPTIONS) assert(p.includes(t), `프롬프트에 ${t} 누락`);
  assert(p.includes("unknown"));
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `deno test --config supabase/functions/deno.json --allow-net supabase/functions/crm-analyst/doc-types_test.ts`
Expected: FAIL — `Module not found "./doc-types.ts"`

- [ ] **Step 3: 구현**

`supabase/functions/crm-analyst/doc-types.ts`:
```ts
// 서류 분류 22종 닫힌 집합.
// ⚠️ SSOT는 프론트 client/src/data/customers.ts DOC_TYPE_OPTIONS — 여기는 Deno 격리라 복제한다.
// 22종 enum을 바꾸면 양쪽을 함께 갱신할 것(spec Caveat).
export const DOC_TYPE_OPTIONS = [
  "면허증",
  "주민등록등본",
  "원천징수영수증",
  "사업자등록증",
  "부가세과세증명원",
  "소득금액증명원",
  "자동이체통장사본",
  "매매계약서",
  "리스승인서",
  "계약사실확인서",
  "법인(점)주주명부",
  "법인(점)등기부등본",
  "법인(점)법인인감증명서",
  "법인(점)개인인감증명서",
  "법인(점)재무제표(당해)",
  "법인(점)재무제표(전기)",
  "등록(점)자동차등록증",
  "등록(점)세금계산서",
  "등록(점)취득세납부영수증",
  "등록(점)등록비영수증",
  "등록(점)보험가입증명서",
  "기타서류",
] as const;

// Gemini structured output 스키마. enum으로 22종 + unknown 제약 → 파싱 안전 + 사전 밖 값 차단.
export const CLASSIFY_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    docType: { type: "STRING", enum: [...DOC_TYPE_OPTIONS, "unknown"] },
  },
  required: ["docType"],
} as const;

// 애매한 구분(재무제표 당해/전기, 법인/개인 인감, 자동차등록증/등록비영수증 등)을 짧게 힌트.
export function buildClassifyPrompt(): string {
  return [
    "당신은 자동차 리스·할부 상담에 제출되는 고객 서류를 분류하는 분류기입니다.",
    "주어진 이미지 또는 PDF의 내용을 보고 아래 22가지 종류 중 정확히 하나로 분류하세요.",
    "파일 내용을 우선 판단하고, 어느 종류인지 확신이 서지 않으면 반드시 \"unknown\"을 반환하세요. 추측하지 마세요.",
    "",
    "[종류 목록과 힌트]",
    "- 면허증: 운전면허증",
    "- 주민등록등본: 주민등록표 등본 또는 초본",
    "- 원천징수영수증: 근로소득 원천징수영수증",
    "- 사업자등록증: 개인/법인 사업자등록증",
    "- 부가세과세증명원: 부가가치세 과세표준증명원",
    "- 소득금액증명원: 소득금액증명(원)",
    "- 자동이체통장사본: 통장 사본 또는 계좌/자동이체 확인 서류",
    "- 매매계약서: 차량 매매(구매) 계약서",
    "- 리스승인서: 리스/렌트 승인서",
    "- 계약사실확인서: 계약 사실 확인서",
    "- 법인(점)주주명부: 법인 주주명부",
    "- 법인(점)등기부등본: 법인 등기사항전부증명서(등기부등본)",
    "- 법인(점)법인인감증명서: 법인 인감증명서",
    "- 법인(점)개인인감증명서: 대표자 등 개인 인감증명서",
    "- 법인(점)재무제표(당해): 당해(올해) 재무제표",
    "- 법인(점)재무제표(전기): 전기(전년도) 재무제표",
    "- 등록(점)자동차등록증: 자동차등록증",
    "- 등록(점)세금계산서: 세금계산서",
    "- 등록(점)취득세납부영수증: 취득세 납부 영수증",
    "- 등록(점)등록비영수증: 등록비(등록 대행) 영수증",
    "- 등록(점)보험가입증명서: 자동차보험 가입증명서",
    "- 기타서류: 위 어디에도 명확히 해당하지 않지만 서류이긴 한 경우",
    "",
    "확신이 없으면 \"unknown\". 반드시 JSON {\"docType\": \"...\"} 형식으로만 답하세요.",
  ].join("\n");
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `deno test --config supabase/functions/deno.json --allow-net supabase/functions/crm-analyst/doc-types_test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/crm-analyst/doc-types.ts supabase/functions/crm-analyst/doc-types_test.ts
git commit -m "feat(crm-analyst): 22종 분류 상수·프롬프트·responseSchema"
```

---

## Task 3: auth.ts — staff JWT 게이트

**Files:**
- Create: `supabase/functions/crm-analyst/auth.ts`
- Test: `supabase/functions/crm-analyst/auth_test.ts`

`src/auth/verify.ts`의 `verifyAndGate` 로직을 Deno용으로 재현한다(같은 CRM_ROLES·claim). 차이: 반환 타입 이름만 `verifyStaff`.

- [ ] **Step 1: 실패 테스트 작성** (로컬 키쌍으로 토큰을 서명해 검증)

`supabase/functions/crm-analyst/auth_test.ts`:
```ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { verifyStaff } from "./auth.ts";

const ISSUER = "https://example.supabase.co/auth/v1";
const AUD = "authenticated";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  // jose JWTVerifyGetKey 시그니처에 맞춘 로컬 resolver
  const keyResolver = async () => publicKey;
  return { privateKey, keyResolver };
}

function sign(privateKey: CryptoKey, claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("1h")
    .setSubject("user-123")
    .sign(privateKey);
}

Deno.test("staff role은 통과", async () => {
  const { privateKey, keyResolver } = await setup();
  const token = await sign(privateKey, { user_role: "staff" });
  const r = await verifyStaff(token, keyResolver, { issuer: ISSUER, audience: AUD });
  assert(r.ok);
  if (r.ok) assertEquals(r.role, "staff");
});

Deno.test("customer role은 403", async () => {
  const { privateKey, keyResolver } = await setup();
  const token = await sign(privateKey, { user_role: "customer" });
  const r = await verifyStaff(token, keyResolver, { issuer: ISSUER, audience: AUD });
  assert(!r.ok);
  if (!r.ok) assertEquals(r.status, 403);
});

Deno.test("role 없으면 403", async () => {
  const { privateKey, keyResolver } = await setup();
  const token = await sign(privateKey, {});
  const r = await verifyStaff(token, keyResolver, { issuer: ISSUER, audience: AUD });
  assert(!r.ok);
  if (!r.ok) assertEquals(r.status, 403);
});

Deno.test("서명 불일치는 401", async () => {
  const { keyResolver } = await setup();
  const { privateKey: otherKey } = await setup(); // 다른 키로 서명
  const token = await sign(otherKey, { user_role: "staff" });
  const r = await verifyStaff(token, keyResolver, { issuer: ISSUER, audience: AUD });
  assert(!r.ok);
  if (!r.ok) assertEquals(r.status, 401);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `deno test --config supabase/functions/deno.json --allow-net supabase/functions/crm-analyst/auth_test.ts`
Expected: FAIL — `Module not found "./auth.ts"`

- [ ] **Step 3: 구현**

`supabase/functions/crm-analyst/auth.ts`:
```ts
import { jwtVerify, type JWTVerifyGetKey } from "jose";

// CRM 접근 허용 역할(customer 제외) — src/auth/verify.ts CRM_ROLES와 동일 SSOT(복제).
const CRM_ROLES = new Set(["staff", "manager", "admin", "dealer"]);

export type StaffGate =
  | { ok: true; userId: string; role: string }
  | { ok: false; status: 401 | 403; error: string };

// src/auth/verify.ts verifyAndGate의 Deno 재현. user_role은 Custom Access Token Hook이 넣는 top-level claim.
export async function verifyStaff(
  token: string,
  keyResolver: JWTVerifyGetKey,
  opts: { issuer: string; audience: string },
): Promise<StaffGate> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, keyResolver, {
      issuer: opts.issuer,
      audience: opts.audience,
    }));
  } catch {
    return { ok: false, status: 401, error: "인증 토큰이 유효하지 않습니다." };
  }
  const userId = typeof payload.sub === "string" ? payload.sub : null;
  const role = typeof payload.user_role === "string" ? payload.user_role : null;
  if (!userId || !role || !CRM_ROLES.has(role)) {
    return { ok: false, status: 403, error: "접근 권한이 없습니다." };
  }
  return { ok: true, userId, role };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `deno test --config supabase/functions/deno.json --allow-net supabase/functions/crm-analyst/auth_test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/crm-analyst/auth.ts supabase/functions/crm-analyst/auth_test.ts
git commit -m "feat(crm-analyst): staff JWT 게이트(verify.ts 로직 재현)"
```

---

## Task 4: gemini.ts — vision 분류 호출 + 에러분류 + 재시도

**Files:**
- Create: `supabase/functions/crm-analyst/gemini.ts`
- Test: `supabase/functions/crm-analyst/gemini_test.ts`

`gemini_error.ts`의 `classifyGeminiError`(순수함수)만 복제한다(sentry/discord 의존 제외). vision 호출은 `fetchImpl` 주입으로 테스트한다.

- [ ] **Step 1: 실패 테스트 작성**

`supabase/functions/crm-analyst/gemini_test.ts`:
```ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyDocumentImage, classifyGeminiError } from "./gemini.ts";

function geminiOk(docType: string): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ docType }) }] } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const ARGS = { apiKey: "k", mimeType: "image/jpeg", dataBase64: "AAAA", prompt: "p", responseSchema: {} };

Deno.test("classifyGeminiError: 429 rate_limited / credit는 credits_depleted / 503 unavailable", () => {
  assertEquals(classifyGeminiError(429, "resource_exhausted"), "rate_limited");
  assertEquals(classifyGeminiError(429, "prepayment credits are depleted"), "credits_depleted");
  assertEquals(classifyGeminiError(503, "overloaded"), "unavailable");
  assertEquals(classifyGeminiError(400, "bad"), "generic");
});

Deno.test("정상 응답에서 docType 추출", async () => {
  const r = await classifyDocumentImage({ ...ARGS, fetchImpl: async () => geminiOk("사업자등록증") });
  assertEquals(r, "사업자등록증");
});

Deno.test("unavailable 1회 재시도 후 성공", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return calls === 1 ? new Response("overloaded", { status: 503 }) : geminiOk("면허증");
  };
  const r = await classifyDocumentImage({ ...ARGS, fetchImpl });
  assertEquals(r, "면허증");
  assertEquals(calls, 2);
});

Deno.test("generic 에러는 재시도 없이 throw", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response("bad", { status: 400 }); };
  let threw = false;
  try { await classifyDocumentImage({ ...ARGS, fetchImpl }); } catch { threw = true; }
  assert(threw);
  assertEquals(calls, 1);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `deno test --config supabase/functions/deno.json --allow-net supabase/functions/crm-analyst/gemini_test.ts`
Expected: FAIL — `Module not found "./gemini.ts"`

- [ ] **Step 3: 구현**

`supabase/functions/crm-analyst/gemini.ts`:
```ts
// gemini_error.ts classifyGeminiError의 복제(sentry/discord 의존 제외 — 순수 분류만).
export type GeminiErrorCode = "credits_depleted" | "rate_limited" | "unavailable" | "generic";

export function classifyGeminiError(status: number | undefined, bodyText: string): GeminiErrorCode {
  const t = bodyText.toLowerCase();
  if (status === 429 || t.includes("resource_exhausted") || t.includes("429")) {
    if (/credit|deplet|prepay|billing|balance|payment/.test(t)) return "credits_depleted";
    return "rate_limited";
  }
  if (status === 503 || t.includes("unavailable") || t.includes("overloaded") || t.includes("high demand")) {
    return "unavailable";
  }
  return "generic";
}

const MODEL_NAME = "gemini-3.1-flash-lite"; // 앱 ai-analyst와 동일. 정확도 부족 시 상수만 상향.

type ClassifyArgs = {
  apiKey: string;
  mimeType: string;
  dataBase64: string;
  prompt: string;
  responseSchema: unknown;
  fetchImpl?: typeof fetch;
};

// vision 분류. 22종 or "unknown" 문자열 반환. 실패(재시도 후에도)는 throw → 프론트가 regex 폴백.
export async function classifyDocumentImage(args: ClassifyArgs): Promise<string> {
  const { apiKey, mimeType, dataBase64, prompt, responseSchema, fetchImpl = fetch } = args;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: dataBase64 } }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0 },
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string") throw new Error("Gemini 응답 파싱 실패");
      const parsed = JSON.parse(text) as { docType?: string };
      if (!parsed.docType) throw new Error("Gemini 응답에 docType 없음");
      return parsed.docType;
    }
    const bodyText = await res.text();
    const code = classifyGeminiError(res.status, bodyText);
    console.error(`[crm-analyst] Gemini ${code} status=${res.status}`);
    // transient(rate_limited/unavailable)만 1회 재시도. 그 외는 즉시 throw.
    if (attempt === 0 && (code === "rate_limited" || code === "unavailable")) continue;
    throw new Error(`Gemini 분류 실패: ${code}`);
  }
  throw new Error("Gemini 분류 실패");
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `deno test --config supabase/functions/deno.json --allow-net supabase/functions/crm-analyst/gemini_test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/crm-analyst/gemini.ts supabase/functions/crm-analyst/gemini_test.ts
git commit -m "feat(crm-analyst): Gemini vision 분류 호출 + 에러분류 + 재시도"
```

---

## Task 5: index.ts — Hono 조립(CORS + 인증 + 핸들러)

**Files:**
- Modify: `supabase/functions/crm-analyst/index.ts` (Task 1 뼈대 대체)

이 Task는 통합/조립이라 단위테스트 없이 `deno check`로 정합성만 확인한다(실동작은 Task 8 배포 후 검증).

- [ ] **Step 1: 앱 라우트 경로 패턴 교차확인**

Run: `grep -n "app.post\|app.get\|new Hono" /Users/tobedoit/Documents/Flutter/mr-cha-app/supabase/functions/ai-analyst/index.ts`
확인 목적: supabase functions.invoke는 함수명(`/crm-analyst`)으로 POST가 도달한다. Hono 라우트 base가 함수명을 포함하는지(`app.post("/crm-analyst", ...)`) 앱 패턴과 맞춘다. 아래 구현은 함수명 base 기준.

- [ ] **Step 2: index.ts 구현**

`supabase/functions/crm-analyst/index.ts` (전체 교체):
```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRemoteJWKSet } from "jose";

import { verifyStaff } from "./auth.ts";
import { buildClassifyPrompt, CLASSIFY_RESPONSE_SCHEMA } from "./doc-types.ts";
import { classifyDocumentImage } from "./gemini.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

const ALLOWED_ORIGINS = [
  "https://crm.mrcha.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const app = new Hono();

app.use("*", cors({
  origin: ALLOWED_ORIGINS,
  allowMethods: ["POST", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type"],
}));

// JWKS는 issuer당 1회 생성(모듈 레벨 캐시).
const issuer = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : "";
const jwks = SUPABASE_URL ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) : null;

// staff 인증 게이트.
app.use("/crm-analyst/*", async (c, next) => {
  if (!jwks) return c.json({ error: "서버 설정 오류입니다." }, 500);
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return c.json({ error: "인증이 필요합니다." }, 401);
  const gate = await verifyStaff(token, jwks, { issuer, audience: "authenticated" });
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  await next();
});

app.post("/crm-analyst", async (c) => {
  if (!GEMINI_API_KEY) return c.json({ error: "서버 설정 오류입니다." }, 500);
  const bodyJson = (await c.req.json().catch(() => null)) as
    | { mimeType?: string; dataBase64?: string }
    | null;
  if (!bodyJson?.mimeType || !bodyJson?.dataBase64) {
    return c.json({ error: "mimeType·dataBase64가 필요합니다." }, 400);
  }
  const docType = await classifyDocumentImage({
    apiKey: GEMINI_API_KEY,
    mimeType: bodyJson.mimeType,
    dataBase64: bodyJson.dataBase64,
    prompt: buildClassifyPrompt(),
    responseSchema: CLASSIFY_RESPONSE_SCHEMA,
  });
  return c.json({ docType });
});

Deno.serve(app.fetch);
```

주의: 인증 미들웨어는 `/crm-analyst/*`로, 실제 핸들러는 `POST /crm-analyst`로 둔다. Step 1 grep 결과 앱이 다른 base(예: `/`)를 쓰면 이 두 경로와 아래 프론트 invoke를 함께 맞춘다(핸들러 경로·미들웨어 glob·프론트 `functions.invoke` 함수명 3곳 일치가 불변식).

- [ ] **Step 3: Deno 타입 체크**

Run: `deno check --config supabase/functions/deno.json supabase/functions/crm-analyst/index.ts`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/crm-analyst/index.ts
git commit -m "feat(crm-analyst): Hono 조립 — CORS + staff 게이트 + 분류 라우트"
```

---

## Task 6: 프론트 lib — document-classify.ts

**Files:**
- Create: `client/src/lib/document-classify.ts`
- Test: `client/src/lib/document-classify.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`client/src/lib/document-classify.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

import { classifyDocumentWithAI } from "./document-classify";
import { supabase } from "./supabase";

vi.mock("./supabase", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
// 썸네일은 브라우저 API라 테스트에선 무력화(원본 사용).
vi.mock("./image-thumbnail", () => ({ createImageThumbnail: vi.fn(async () => null) }));

const invoke = vi.mocked(supabase.functions.invoke);

function pngFile(name: string) {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

describe("classifyDocumentWithAI", () => {
  beforeEach(() => invoke.mockReset());

  it("AI가 22종을 반환하면 그 값을 쓴다", async () => {
    invoke.mockResolvedValue({ data: { docType: "사업자등록증" }, error: null });
    expect(await classifyDocumentWithAI(pngFile("scan.png"))).toBe("사업자등록증");
  });

  it("AI가 unknown이면 파일명 regex로 폴백", async () => {
    invoke.mockResolvedValue({ data: { docType: "unknown" }, error: null });
    expect(await classifyDocumentWithAI(pngFile("운전면허증.png"))).toBe("면허증");
  });

  it("invoke 에러면 파일명 regex로 폴백", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("boom") });
    expect(await classifyDocumentWithAI(pngFile("사업자등록증.png"))).toBe("사업자등록증");
  });

  it("invoke가 throw해도 폴백(예외 삼킴)", async () => {
    invoke.mockRejectedValue(new Error("network"));
    expect(await classifyDocumentWithAI(pngFile("아무거나.png"))).toBe("기타서류");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test:unit -- document-classify`
Expected: FAIL — `Cannot find module './document-classify'`

- [ ] **Step 3: 구현**

`client/src/lib/document-classify.ts`:
```ts
import { DOC_TYPE_OPTIONS } from "@/data/customers";
import { classifyKimDocumentFile } from "@/lib/kim-detail-utils";
import { createImageThumbnail } from "./image-thumbnail";
import { supabase } from "./supabase";

// File → base64(데이터 부분만, data:URL 접두어 제거).
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// 업로드 전 vision 분류. 항상 유효한 22종 docType을 반환한다(vision → unknown/에러면 파일명 regex 폴백).
export async function classifyDocumentWithAI(file: File): Promise<string> {
  try {
    // 이미지는 경량 썸네일(분류엔 저해상도 충분), PDF는 원본.
    let payloadFile = file;
    if (file.type.startsWith("image/")) {
      const thumb = await createImageThumbnail(file, 1024, 0.7);
      if (thumb) payloadFile = thumb;
    }
    const dataBase64 = await fileToBase64(payloadFile);
    const mimeType = payloadFile.type || file.type;
    const { data, error } = await supabase.functions.invoke("crm-analyst", {
      body: { mimeType, dataBase64, fileName: file.name },
    });
    if (error) throw error;
    const docType = (data as { docType?: string } | null)?.docType;
    if (docType && docType !== "unknown" && (DOC_TYPE_OPTIONS as readonly string[]).includes(docType)) {
      return docType;
    }
  } catch {
    // 아래 regex 폴백으로 진행
  }
  return classifyKimDocumentFile(file.name);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:unit -- document-classify`
Expected: PASS (4 tests)

- [ ] **Step 5: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 / 0

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/document-classify.ts client/src/lib/document-classify.test.ts
git commit -m "feat(crm): document-classify lib — AI 분류 + regex 폴백"
```

---

## Task 7: useCustomerDocuments 통합 — addDocumentFiles 교체 + 병렬화

**Files:**
- Modify: `client/src/components/customer-detail/hooks/useCustomerDocuments.ts` (import 7행, `addDocumentFiles` 90-125행)

- [ ] **Step 1: import 교체**

7행의 import에서 `classifyKimDocumentFile`를 제거하고(폴백은 lib 내부로 이동) `document-classify`를 추가한다. `kimDocumentFileKind`·`isDocumentFileDrag`·`nowMs`는 유지:
```ts
import { classifyDocumentWithAI } from "@/lib/document-classify";
import { isDocumentFileDrag, kimDocumentFileKind, nowMs } from "@/lib/kim-detail-utils";
```

- [ ] **Step 2: addDocumentFiles 재작성 (90-125행 교체)**

기존 순차 `for` 루프를 파일별 병렬(`Promise.all`)로, 분류를 비동기 optimistic으로 바꾼다. optimistic 카드는 즉시(`status:"분류 중…"`) 뜨고, 분류 완료 후 `docType`·`status`로 갱신한 뒤 업로드한다:
```ts
  async function addDocumentFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) => {
      const lower = file.name.toLowerCase();
      return file.type.startsWith("image/") || file.type === "application/pdf" || lower.endsWith(".pdf");
    });
    if (files.length === 0) {
      onToast("이미지·PDF만 등록할 수 있습니다.");
      return;
    }
    setConfirmingDocumentDeleteId(null);
    markRecentUpdate("서류함");

    await Promise.all(
      files.map(async (file) => {
        const tempId = `kim-document-${nowMs()}-${Math.round(file.size)}`;
        const objectUrl = URL.createObjectURL(file);
        const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
        const optimistic: KimDocumentItem = {
          id: tempId,
          title: "",
          status: "분류 중…",
          fileName: file.name,
          fileSize: file.size,
          mimeType,
          objectUrl,
          file,
        };
        setDocuments((current) => [...current, optimistic]);

        // vision 분류(실패·unknown이면 lib이 파일명 regex로 폴백 → 항상 유효한 22종).
        const docType = await classifyDocumentWithAI(file);
        setDocuments((current) =>
          current.map((d) => (d.id === tempId ? { ...d, title: docType, status: "AI분류" } : d)),
        );

        try {
          const saved = await uploadDocument(detail.id, file, docType);
          setDocuments((current) => current.map((d) => (d.id === tempId ? { ...d, id: saved.id, file: undefined } : d)));
        } catch {
          setDocuments((current) => current.filter((d) => d.id !== tempId));
          URL.revokeObjectURL(objectUrl);
          onToast(`${file.name} 업로드에 실패했습니다.`);
        }
      }),
    );
  }
```

- [ ] **Step 3: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 / 0 (`classifyKimDocumentFile` 미사용 import 제거 확인 — kim-detail-utils.ts의 함수 자체와 그 기존 테스트는 폴백 경로로 유지되므로 삭제하지 않는다)

- [ ] **Step 4: 전체 단위 테스트 회귀 확인**

Run: `bun run test:unit`
Expected: 기존 267 + document-classify 4 = 271 pass (회귀 0)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/customer-detail/hooks/useCustomerDocuments.ts
git commit -m "feat(crm): 서류함 업로드 분류를 AI로 교체 + 파일별 병렬화"
```

---

## Task 8: 배포 + 브라우저 검증 (사용자 실행 — supabase 로그인 필요)

**Files:** 코드 변경 없음. supabase CLI 배포 + secret 세팅 + 브라우저 확인.

이 Task는 supabase 인증 세션이 필요해 **사용자(유슨생)가 직접 실행**한다. 아래 절차를 문서화한다.

- [ ] **Step 1: supabase 프로젝트 링크** (최초 1회)

```bash
supabase login          # 브라우저 로그인 (인터랙티브 — 사용자가 `! supabase login`으로 실행)
supabase link --project-ref <master-project-ref>   # crm/catalog/public 있는 master 프로젝트
```
결과: `supabase/config.toml` 생성/갱신. 이 파일은 커밋한다(project_id).

- [ ] **Step 2: Edge Function secret 세팅**

```bash
supabase secrets set GEMINI_API_KEY=<앱과 동일한 키>
# SUPABASE_URL은 Edge 런타임이 자동 주입(Deno.env)이라 별도 불필요 — 배포 후 로그로 확인.
```

- [ ] **Step 3: 함수 배포** (⚠️ 반드시 함수명 명시 — 앱 함수 보호)

```bash
supabase functions deploy crm-analyst
```
Expected: 배포 성공, 함수 URL 출력.

- [ ] **Step 4: 인증 게이트 실검증**

- staff 계정(유슨생)으로 CRM 로그인 → 서류함에 실제 이미지/PDF 드롭 → 카드가 "분류 중…" → "AI분류"로 바뀌고 docType이 실제 서류와 맞는지 확인.
- 22종 세밀 구분(사업자등록증·소득금액증명원·재무제표 등) 몇 건 정확도 확인. 부정확하면 프롬프트 힌트 보강 또는 모델 상향(gemini.ts `MODEL_NAME`) 후속.
- 잘못 분류된 건은 기존 분류 select로 수정 → "수동분류"로 바뀌는지 확인(회귀 없음).
- Gemini 실패 시나리오(예: 잠시 네트워크 차단)에서 파일명 regex 폴백으로 조용히 진행되는지 확인.

- [ ] **Step 5: config.toml 커밋** (Step 1에서 생성된 경우)

```bash
git add supabase/config.toml
git commit -m "chore(crm-analyst): supabase 프로젝트 링크 config"
```

---

## Self-Review 결과

- **Spec 커버리지:** ①함수 스캐폴드=Task1 · ②입력처리(썸네일/PDF base64)=Task6 · ③분류로직(vision+unknown+responseSchema)=Task2·4 · ④프론트 통합(호출흐름 A, optimistic, 병렬)=Task6·7 · ⑤staff 게이트=Task3·5 · ⑥에러·재시도=Task4 · ⑦테스트=각 Task + Task8 브라우저. regex 폴백=Task6(프론트). 함수명 배포 caveat=Task8. 모두 매핑됨.
- **Placeholder:** 없음(모든 코드·명령·기대출력 구체화).
- **타입 일관성:** `classifyDocumentWithAI`(Task6·7), `classifyDocumentImage`(Task4·5), `verifyStaff`/`StaffGate`(Task3·5), `DOC_TYPE_OPTIONS`/`CLASSIFY_RESPONSE_SCHEMA`/`buildClassifyPrompt`(Task2·5) — 정의부와 사용부 일치.
- **불변식:** Hono 핸들러 경로 · 인증 미들웨어 glob · 프론트 `functions.invoke` 함수명 3곳이 일치해야 함(Task5 Step2 주의에 명시).

## Caveats (spec에서 재확인)

- **함수명 배포 필수**: `supabase functions deploy crm-analyst`(공유 master 프로젝트, 앱 함수 보호).
- **22종 SSOT 이원화**: 프론트 `client/src/data/customers.ts`와 Edge `doc-types.ts` 양쪽 — enum 변경 시 함께 갱신.
- **`GEMINI_API_KEY`는 Edge secret**(프론트 노출 금지).
- **Deno 파일은 CRM typecheck/lint 대상 밖**(tsconfig 미포함 + eslint ignore). 검증은 `deno check`/`deno test`로 분리.
