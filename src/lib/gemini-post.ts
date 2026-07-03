import { classifyGeminiError } from "./gemini-error";
import { geminiHeaders, type GeminiTarget } from "./gemini-target";

// Gemini POST 공통 골격 — transient(rate_limited/unavailable) 1회 재시도 + 실패 분류·본문 로그.
// generate/stream/embed 3벌 복제가 로그 포맷 수동 동기화로 드리프트하던 것(d4d1deb)을 1벌로 통합.
// 성공 Response를 그대로 반환하고 파싱은 호출부 책임. 재시도 후에도 실패면 throw.
// crm-analyst의 Deno 복제본(gemini.ts)은 런타임 경계라 통합 대상 아님.
export async function geminiPost(
  url: string,
  body: string,
  target: GeminiTarget,
  opts: { label: string; errorPrefix: string; fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, { method: "POST", headers: geminiHeaders(target), body, signal: opts.signal });
    if (res.ok) return res;
    const bodyText = await res.text();
    const code = classifyGeminiError(res.status, bodyText);
    // 본문 일부 포함 — 프록시 경유 시 릴레이/게이트웨이발 401·403·404를 리전 차단과 판별하고,
    // generic 4xx의 실제 원인(키 만료·쿼터 등)을 tail에서 확인할 수 있게 한다.
    console.error(`[assistant] Gemini ${opts.label} ${code} status=${res.status} body=${bodyText.slice(0, 200)}`);
    if (attempt === 0 && (code === "rate_limited" || code === "unavailable")) continue;
    throw new Error(`${opts.errorPrefix}: ${code}`);
  }
  // unreachable: 루프 내부가 항상 return/throw — TS 반환타입 체크 통과용.
  throw new Error(opts.errorPrefix);
}
