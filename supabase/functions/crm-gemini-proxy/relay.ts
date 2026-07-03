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
