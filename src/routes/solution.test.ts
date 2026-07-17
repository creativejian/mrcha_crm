import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";

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
const ORIGINAL_TIMEOUT = solutionDeps.timeoutMs;
const SAVED_URL = process.env.PARTNER_QUOTE_API_URL;
const SAVED_KEY = process.env.PARTNER_QUOTE_API_KEY;

let app: ReturnType<typeof createApp>;
let token = "";

beforeAll(async () => {
  const auth = await makeTestAuth("staff");
  app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  token = auth.token;
});

// 테스트 간 mock 격리 — afterAll만으로는 앞 테스트의 mock이 뒤 테스트로 상속돼 순서 의존이 생긴다
// (push-notify.test.ts와 동일 패턴).
afterEach(() => {
  solutionDeps.fetchImpl = ORIGINAL_FETCH;
  solutionDeps.timeoutMs = ORIGINAL_TIMEOUT;
});

afterAll(() => {
  // 다른 테스트 파일과 함께 돌아가는 test:server 스위트에 env/deps 상태를 흘리지 않는다.
  solutionDeps.fetchImpl = ORIGINAL_FETCH;
  solutionDeps.timeoutMs = ORIGINAL_TIMEOUT;
  if (SAVED_URL === undefined) delete process.env.PARTNER_QUOTE_API_URL;
  else process.env.PARTNER_QUOTE_API_URL = SAVED_URL;
  if (SAVED_KEY === undefined) delete process.env.PARTNER_QUOTE_API_KEY;
  else process.env.PARTNER_QUOTE_API_KEY = SAVED_KEY;
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
  delete process.env.PARTNER_QUOTE_API_URL;
  const res = await post(VALID_BODY);
  expect(res.status).toBe(503);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("설정");
});

test("본문이 JSON이 아니면 400", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  const res = await post(undefined, "not-json");
  expect(res.status).toBe(400);
});

test("zod 위반(음수 금액) → 400", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  const res = await post({ ...VALID_BODY, depositAmount: -1 });
  expect(res.status).toBe(400);
});

test("zod 위반(미지원 lenderCode) → 400", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  const res = await post({ ...VALID_BODY, lenderCode: "hana-capital" });
  expect(res.status).toBe(400);
});

test("성공 릴레이: 파트너 body 패스스루 + X-Request-ID(crm- 접두) + 키 설정 시 X-API-Key 부착", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  process.env.PARTNER_QUOTE_API_KEY = "test-key-123";
  const calls = captureRequests();

  const res = await post({ ...VALID_BODY, dealerName: "테스트모터스" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);

  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://partner.test/calc");
  expect(calls[0].headers["x-api-key"]).toBe("test-key-123");
  expect(calls[0].headers["x-request-id"]).toMatch(/^crm-[0-9a-f-]{36}$/);
  expect((calls[0].body as { lenderCode: string }).lenderCode).toBe("shinhan-card");
  // 판매사 실동작화(T1): 제프 canonical dealerName이 zod strip에 안 잘리고 실린다(스키마 누락이면 탈락 = RED).
  expect((calls[0].body as { dealerName?: string }).dealerName).toBe("테스트모터스");
});

test("zod strip 계약: 스키마 밖 키는 파트너로 전달되지 않는다", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  const calls = captureRequests();

  const res = await post({ ...VALID_BODY, extra: 1 });
  expect(res.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(Object.keys(calls[0].body as Record<string, unknown>)).not.toContain("extra");
});

// ── 계산기 모달 확장 17필드(스펙 2026-07-16 §릴레이 zod 확장 — 제프 calculateQuoteSchema 미러) ──
// zod strip 특성상 스키마에 없는 필드는 업스트림 body에서 조용히 탈락한다 — 확장 전엔 아래 단언이
// RED(탈락 실관찰), 확장 후 GREEN. 값은 제프 V2 buildPayload(QuoteRevolutionV2.tsx:177-247) 실전송 형태.
const CALCULATOR_EXTENDED_FIELDS = {
  affiliateType: "비제휴사",
  directModelEntry: false,
  releaseMethod: "special",
  maintenanceGrade: "vip",
  selectedResidualRateOverride: 0.45,
  acquisitionTaxMode: "amount",
  acquisitionTaxAmountOverride: 4_130_000,
  includePublicBondCost: true,
  publicBondCost: 250_000,
  includeDeliveryFeeAmount: true,
  deliveryFeeAmount: 330_000,
  includeMiscFeeAmount: true,
  miscFeeAmount: 150_000,
  cmFeeRate: 0.01,
  agFeeRate: 0,
  insuranceYearlyAmount: 0,
  lossDamageAmount: 0,
} as const;

test("계산기 확장 17필드: 400 없이 통과 + 전 필드가 업스트림 body에 실린다", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  const calls = captureRequests();

  const res = await post({
    ...VALID_BODY,
    lenderCode: "mg-capital",
    productType: "long_term_rental",
    ...CALCULATOR_EXTENDED_FIELDS,
  });
  expect(res.status).toBe(200);
  expect(calls).toHaveLength(1);
  const sent = calls[0].body as Record<string, unknown>;
  const sentSubset = Object.fromEntries(
    Object.keys(CALCULATOR_EXTENDED_FIELDS).map((key) => [key, sent[key]]),
  );
  expect(sentSubset).toEqual({ ...CALCULATOR_EXTENDED_FIELDS });
});

test("계산기 확장 필드 enum 위반(releaseMethod) → 400", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  const res = await post({ ...VALID_BODY, releaseMethod: "oto" });
  expect(res.status).toBe(400);
});

// 제프는 selectedResidualRateOverride를 positive()로 잠근다(min(0) 아님) — 0 전송은 업스트림 400이므로
// 릴레이가 같은 경계에서 미리 자른다(범위 미러 잠금).
test("계산기 확장 필드 범위 위반(selectedResidualRateOverride=0) → 400", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  const res = await post({ ...VALID_BODY, selectedResidualRateOverride: 0 });
  expect(res.status).toBe(400);
});

test("키 미설정이면 X-API-Key 생략(개발 무인증 단계) — 호출은 진행", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  delete process.env.PARTNER_QUOTE_API_KEY;
  const calls = captureRequests();

  const res = await post(VALID_BODY);
  expect(res.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0].headers["x-api-key"]).toBeUndefined();
});

test("파트너 4xx(미취급) → 400 + error 문구 패스스루", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  solutionDeps.fetchImpl = (async () =>
    new Response(JSON.stringify({ ok: false, error: "미취급 차종" }), { status: 400 })) as unknown as typeof fetch;

  const res = await post(VALID_BODY);
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("미취급");
});

test("파트너 5xx → 502", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  solutionDeps.fetchImpl = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;

  const res = await post(VALID_BODY);
  expect(res.status).toBe(502);
});

// 401/403 = 파트너 키 오설정(운영 문제) — 호출자 입력 잘못(400 패스스루)과 섞이면 조용히 묻힌다.
// push-notify AUTH_FAILED 선례 미러(스펙 보강 — 리뷰 승인 편차).
test("파트너 401 → 503 + 인증 실패 문구(AUTH_FAILED 구분)", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  solutionDeps.fetchImpl = (async () =>
    new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 })) as unknown as typeof fetch;

  const res = await post(VALID_BODY);
  expect(res.status).toBe(503);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("인증");
});

// 200인데 바디가 JSON이 아니면(프록시 HTML 등) 성공으로 둔갑시키지 않는다 — 클라 파서가 raw를 신뢰하는 전제.
test("200 + non-JSON 바디 → 502(성공 둔갑 금지)", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  solutionDeps.fetchImpl = (async () => new Response("<html>proxy error</html>", { status: 200 })) as unknown as typeof fetch;

  const res = await post(VALID_BODY);
  expect(res.status).toBe(502);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("해석");
});

test("네트워크 예외 → 502", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  solutionDeps.fetchImpl = (async () => {
    throw new Error("connect refused");
  }) as unknown as typeof fetch;

  const res = await post(VALID_BODY);
  expect(res.status).toBe(502);
});

test("AbortError(타임아웃) → 504", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  solutionDeps.fetchImpl = (async () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    throw e;
  }) as unknown as typeof fetch;

  const res = await post(VALID_BODY);
  expect(res.status).toBe(504);
});

// 바디 스톨: 헤더는 8초 안에 도착(status 200)했으나 바디 스트리밍 중 타임아웃 → upstream.json()이 abort로
// reject. 저자가 주석(solution.ts:83-85)으로 경고한 분기 — .catch(() => null)로 뭉개면 504 대신 성공 둔갑.
// (기존 AbortError 테스트는 fetch 자체가 던져 바깥 catch만 탄다 — 이 분기는 무테스트였다.)
test("바디 스톨(헤더 도착 후 바디 정지) → 504", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
  solutionDeps.timeoutMs = 5; // timer가 즉시 controller.abort()
  solutionDeps.fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => ({
    status: 200,
    ok: true,
    // 바디 읽기가 abort(타임아웃)에 반응해 reject하는 실제 fetch 바디 동작 모방
    json: () => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  })) as unknown as typeof fetch;

  const res = await post(VALID_BODY);
  expect(res.status).toBe(504);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("시간 초과");
});

// 🔴 재발 방지: `solutionDeps.fetchImpl(...)`는 메서드 호출이라 this=solutionDeps가 되고,
// CF Workers의 global fetch는 this가 globalThis/undefined가 아니면 Illegal invocation으로 죽는다
// (배정 알림 두 달 무발송 사고, PR #202). 반드시 지역 변수로 뽑아 plain call해야 한다.
test("fetchImpl은 plain call로 호출된다(this 미결합 — Workers Illegal invocation 가드)", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/calc";
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

// ── GET /dealers 릴레이(판매사 실동작화 T1) — 제프 external catalog/dealers 미러 ──

function getDealers(query: string) {
  return app.request(`/api/solution/dealers?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// GET 릴레이용 캡처(위 captureRequests는 POST body 파싱 전제라 별도) — 업스트림 성공 응답 고정.
function captureDealerRequests() {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  solutionDeps.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return new Response(
      JSON.stringify({ ok: true, dealers: [{ dealerName: "모터원", baseIrrRate: 0.0681 }] }),
      { status: 200 },
    );
  }) as typeof fetch;
  return calls;
}

test("dealers 성공 패스스루 + URL 조립(calculate URL의 origin 파생) + X-API-Key/X-Request-ID", async () => {
  // PARTNER_QUOTE_API_URL은 calculate 전체 URL — dealers는 origin만 취해 external 경로를 조립한다.
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/api/external/quotes/calculate";
  process.env.PARTNER_QUOTE_API_KEY = "test-key-123";
  const calls = captureDealerRequests();

  const res = await getDealers("lenderCode=bnk-capital&brand=BMW");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; dealers: Array<{ dealerName: string; baseIrrRate: number }> };
  expect(body.ok).toBe(true);
  expect(body.dealers).toEqual([{ dealerName: "모터원", baseIrrRate: 0.0681 }]);

  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://partner.test/api/external/catalog/dealers?lenderCode=bnk-capital&brand=BMW");
  expect(calls[0].headers["x-api-key"]).toBe("test-key-123");
  expect(calls[0].headers["x-request-id"]).toMatch(/^crm-[0-9a-f-]{36}$/);
});

test("dealers 쿼리 zod 위반(미지원 lenderCode / brand 누락) → 400(업스트림 미호출)", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/api/external/quotes/calculate";
  const calls = captureDealerRequests();

  expect((await getDealers("lenderCode=hana-capital&brand=BMW")).status).toBe(400);
  expect((await getDealers("lenderCode=bnk-capital")).status).toBe(400);
  expect(calls).toHaveLength(0);
});

test("dealers 업스트림 400(VALIDATION_ERROR) → 400 + error 문구 패스스루", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/api/external/quotes/calculate";
  solutionDeps.fetchImpl = (async () =>
    new Response(JSON.stringify({ ok: false, errorCode: "VALIDATION_ERROR", error: "요청 형식이 올바르지 않습니다" }), {
      status: 400,
    })) as unknown as typeof fetch;

  const res = await getDealers("lenderCode=bnk-capital&brand=BMW");
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("형식");
});

test("dealers 파트너 401 → 503 + 인증 실패 문구(AUTH_FAILED 구분 — calculate 미러)", async () => {
  process.env.PARTNER_QUOTE_API_URL = "https://partner.test/api/external/quotes/calculate";
  solutionDeps.fetchImpl = (async () =>
    new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 })) as unknown as typeof fetch;

  const res = await getDealers("lenderCode=bnk-capital&brand=BMW");
  expect(res.status).toBe(503);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("인증");
});

test("dealers env URL이 origin 파생 불가(비 URL 문자열) → 503 fail-loud", async () => {
  process.env.PARTNER_QUOTE_API_URL = "not-a-url";
  const calls = captureDealerRequests();

  const res = await getDealers("lenderCode=bnk-capital&brand=BMW");
  expect(res.status).toBe(503);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("설정");
  expect(calls).toHaveLength(0);
});
