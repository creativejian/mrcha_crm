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
