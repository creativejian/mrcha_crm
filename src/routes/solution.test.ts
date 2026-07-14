import { afterAll, beforeAll, expect, test } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { solutionDeps } from "./solution";

// dealer 403은 전역 dealerWriteGate 테스트(role-gate.test.ts)가 이미 잠근다 — 여기서 재검증하지 않는다.

const VALID_BODY = {
  lenderCode: "shinhan-card",
  productType: "operating_lease",
  brand: "BMW",
  modelName: "3 Series",
  masterMcCode: "MC-TEST-001",
  ownershipType: "company",
  leaseTermMonths: 60,
  annualMileageKm: 20000,
  depositAmount: 0,
  upfrontPayment: 0,
  quotedVehiclePrice: 59_000_000,
};

const ORIGINAL_FETCH = solutionDeps.fetchImpl;
const SAVED_URL = process.env.SOLUTION_QUOTE_API_URL;
const SAVED_KEY = process.env.SOLUTION_QUOTE_API_KEY;

let app: ReturnType<typeof createApp>;
let token = "";

beforeAll(async () => {
  const auth = await makeTestAuth("staff");
  app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  token = auth.token;
});

afterAll(() => {
  // 다른 테스트 파일과 함께 돌아가는 test:server 스위트에 env/deps 상태를 흘리지 않는다.
  solutionDeps.fetchImpl = ORIGINAL_FETCH;
  if (SAVED_URL === undefined) delete process.env.SOLUTION_QUOTE_API_URL;
  else process.env.SOLUTION_QUOTE_API_URL = SAVED_URL;
  if (SAVED_KEY === undefined) delete process.env.SOLUTION_QUOTE_API_KEY;
  else process.env.SOLUTION_QUOTE_API_KEY = SAVED_KEY;
});

function post(body: unknown, rawBody?: string) {
  return app.request("/api/solution/calculate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: rawBody ?? JSON.stringify(body),
  });
}

function captureRequests() {
  const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  solutionDeps.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify({ ok: true, quote: { monthlyPayment: 1 } }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

test("env 미설정 → 503 명시 에러(fail-loud)", async () => {
  delete process.env.SOLUTION_QUOTE_API_URL;
  const res = await post(VALID_BODY);
  expect(res.status).toBe(503);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("설정");
});

test("본문이 JSON이 아니면 400", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  const res = await post(undefined, "not-json");
  expect(res.status).toBe(400);
});

test("zod 위반(음수 금액) → 400", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  const res = await post({ ...VALID_BODY, depositAmount: -1 });
  expect(res.status).toBe(400);
});

test("zod 위반(미지원 lenderCode) → 400", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  const res = await post({ ...VALID_BODY, lenderCode: "hana-capital" });
  expect(res.status).toBe(400);
});

test("성공 릴레이: 파트너 body 패스스루 + X-Request-ID(crm- 접두) + 키 설정 시 X-API-Key 부착", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  process.env.SOLUTION_QUOTE_API_KEY = "test-key-123";
  const calls = captureRequests();

  const res = await post(VALID_BODY);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);

  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://partner.test/calc");
  expect(calls[0].headers["x-api-key"]).toBe("test-key-123");
  expect(calls[0].headers["x-request-id"]).toMatch(/^crm-[0-9a-f-]{36}$/);
  expect((calls[0].body as { lenderCode: string }).lenderCode).toBe("shinhan-card");
});

test("키 미설정이면 X-API-Key 생략(개발 무인증 단계) — 호출은 진행", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  delete process.env.SOLUTION_QUOTE_API_KEY;
  const calls = captureRequests();

  const res = await post(VALID_BODY);
  expect(res.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0].headers["x-api-key"]).toBeUndefined();
});

test("파트너 4xx(미취급) → 400 + error 문구 패스스루", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  solutionDeps.fetchImpl = (async () =>
    new Response(JSON.stringify({ ok: false, error: "미취급 차종" }), { status: 400 })) as unknown as typeof fetch;

  const res = await post(VALID_BODY);
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("미취급");
});

test("파트너 5xx → 502", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  solutionDeps.fetchImpl = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;

  const res = await post(VALID_BODY);
  expect(res.status).toBe(502);
});

test("네트워크 예외 → 502", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  solutionDeps.fetchImpl = (async () => {
    throw new Error("connect refused");
  }) as unknown as typeof fetch;

  const res = await post(VALID_BODY);
  expect(res.status).toBe(502);
});

test("AbortError(타임아웃) → 504", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  solutionDeps.fetchImpl = (async () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    throw e;
  }) as unknown as typeof fetch;

  const res = await post(VALID_BODY);
  expect(res.status).toBe(504);
});

// 🔴 재발 방지: `solutionDeps.fetchImpl(...)`는 메서드 호출이라 this=solutionDeps가 되고,
// CF Workers의 global fetch는 this가 globalThis/undefined가 아니면 Illegal invocation으로 죽는다
// (배정 알림 두 달 무발송 사고, PR #202). 반드시 지역 변수로 뽑아 plain call해야 한다.
test("fetchImpl은 plain call로 호출된다(this 미결합 — Workers Illegal invocation 가드)", async () => {
  process.env.SOLUTION_QUOTE_API_URL = "https://partner.test/calc";
  let called = false;
  let hadThis = true; // 초기값은 실패 방향 — 호출이 아예 없으면 아래 단언이 걸린다
  solutionDeps.fetchImpl = function (this: unknown) {
    called = true;
    hadThis = this !== undefined;
    return Promise.resolve(new Response(JSON.stringify({ ok: true, quote: {} }), { status: 200 }));
  } as unknown as typeof fetch;

  await post(VALID_BODY);
  expect(called).toBe(true);
  expect(hadThis).toBe(false);
});
