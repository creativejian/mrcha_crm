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
