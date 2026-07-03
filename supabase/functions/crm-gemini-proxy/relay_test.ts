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
