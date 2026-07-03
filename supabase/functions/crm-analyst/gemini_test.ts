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
  const r = await classifyDocumentImage({ ...ARGS, fetchImpl: () => Promise.resolve(geminiOk("사업자등록증")) });
  assertEquals(r, "사업자등록증");
});

Deno.test("API 키는 x-goog-api-key 헤더로만 전달(?key= 쿼리 금지 — 게이트웨이 로그 노출)", async () => {
  let captured: { url: string; headers: Record<string, string> } | null = null;
  const fetchImpl = (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), headers: { ...(init?.headers as Record<string, string>) } };
    return Promise.resolve(geminiOk("면허증"));
  };
  await classifyDocumentImage({ ...ARGS, fetchImpl });
  assert(!captured!.url.includes("key="));
  assertEquals(captured!.headers["x-goog-api-key"], "k");
});

Deno.test("unavailable 1회 재시도 후 성공", async () => {
  let calls = 0;
  const fetchImpl = () => {
    calls++;
    return Promise.resolve(calls === 1 ? new Response("overloaded", { status: 503 }) : geminiOk("면허증"));
  };
  const r = await classifyDocumentImage({ ...ARGS, fetchImpl });
  assertEquals(r, "면허증");
  assertEquals(calls, 2);
});

Deno.test("generic 에러는 재시도 없이 throw", async () => {
  let calls = 0;
  const fetchImpl = () => { calls++; return Promise.resolve(new Response("bad", { status: 400 })); };
  let threw = false;
  try { await classifyDocumentImage({ ...ARGS, fetchImpl }); } catch { threw = true; }
  assert(threw);
  assertEquals(calls, 1);
});

Deno.test("두 번 연속 transient 실패는 재시도 소진 후 throw (calls===2)", async () => {
  let calls = 0;
  const fetchImpl = () => {
    calls++;
    return Promise.resolve(new Response("overloaded", { status: 503 }));
  };
  let threw = false;
  try {
    await classifyDocumentImage({ ...ARGS, fetchImpl });
  } catch {
    threw = true;
  }
  assert(threw);
  assertEquals(calls, 2);
});

Deno.test("credits_depleted는 재시도 없이 throw (calls===1)", async () => {
  let calls = 0;
  const fetchImpl = () => {
    calls++;
    return Promise.resolve(new Response("prepayment credits are depleted", { status: 429 }));
  };
  let threw = false;
  try {
    await classifyDocumentImage({ ...ARGS, fetchImpl });
  } catch {
    threw = true;
  }
  assert(threw);
  assertEquals(calls, 1);
});
