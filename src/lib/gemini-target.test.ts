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
