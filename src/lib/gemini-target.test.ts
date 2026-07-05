import { test, expect } from "bun:test";

import { resolveGeminiTarget, resolveGeminiTargetFromRequest, geminiHeaders, GEMINI_DIRECT_BASE } from "./gemini-target";

function fakeRequestContext(env: Record<string, string>, authHeader?: string) {
  return { env, req: { header: (name: string) => (name === "Authorization" ? authHeader : undefined) } };
}

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

// 요청 컨텍스트 → target 배선의 단일 소스(0705 배치 B — 백로그 트리거 ② 이행). 호출자: assistant /ask·embed-on-write.
test("resolveGeminiTargetFromRequest: c.env 키로 프록시 target + Authorization 포워딩", () => {
  const t = resolveGeminiTargetFromRequest(
    fakeRequestContext({ GEMINI_API_KEY: "ENV-KEY", GEMINI_PROXY_URL: "https://p.supabase.co/functions/v1/crm-gemini-proxy" }, "Bearer staff-jwt"),
  );
  expect(t?.apiKey).toBe("ENV-KEY");
  expect(t?.baseUrl).toBe("https://p.supabase.co/functions/v1/crm-gemini-proxy");
  expect(t?.extraHeaders?.Authorization).toBe("Bearer staff-jwt");
});

test("resolveGeminiTargetFromRequest: 프록시 미설정이면 직결", () => {
  const t = resolveGeminiTargetFromRequest(fakeRequestContext({ GEMINI_API_KEY: "K" }));
  expect(t?.baseUrl).toBe(GEMINI_DIRECT_BASE);
  expect(t?.extraHeaders).toBeUndefined();
});

test("resolveGeminiTargetFromRequest: apiKey 부재(c.env·process.env 모두) → null(정책은 호출부)", () => {
  const savedKey = process.env.GEMINI_API_KEY;
  const savedProxy = process.env.GEMINI_PROXY_URL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_PROXY_URL;
  try {
    expect(resolveGeminiTargetFromRequest(fakeRequestContext({}))).toBeNull();
  } finally {
    if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
    if (savedProxy !== undefined) process.env.GEMINI_PROXY_URL = savedProxy;
  }
});

test("resolveGeminiTargetFromRequest: c.env가 Bun Server 객체(로컬)여도 process.env 폴백", () => {
  const savedKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "PROC-KEY";
  try {
    const t = resolveGeminiTargetFromRequest({ env: undefined, req: { header: () => undefined } });
    expect(t?.apiKey).toBe("PROC-KEY");
  } finally {
    if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
    else delete process.env.GEMINI_API_KEY;
  }
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
