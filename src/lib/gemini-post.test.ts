import { test, expect } from "bun:test";

import { geminiPost } from "./gemini-post";
import { resolveGeminiTarget } from "./gemini-target";

const TARGET = resolveGeminiTarget({ apiKey: "KEY" });
const OPTS = { label: "generate", errorPrefix: "Gemini 생성 실패" };

test("성공 응답은 그대로 반환(파싱은 호출부) + 헤더/바디/signal 배선", async () => {
  let captured: { url: string; init?: RequestInit } | null = null;
  const ac = new AbortController();
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), init };
    return new Response("raw-body", { status: 200 });
  }) as unknown as typeof fetch;

  const res = await geminiPost("https://g/api", "BODY", TARGET, { ...OPTS, fetchImpl: fakeFetch, signal: ac.signal });

  expect(await res.text()).toBe("raw-body");
  expect(captured!.url).toBe("https://g/api");
  expect(captured!.init!.body).toBe("BODY");
  expect((captured!.init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("KEY");
  expect(captured!.init!.signal).toBe(ac.signal);
});

test("transient(429)는 1회 재시도 후 성공", async () => {
  let calls = 0;
  const fakeFetch = (async () => {
    calls++;
    return calls === 1 ? new Response("quota", { status: 429 }) : new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;

  const res = await geminiPost("https://g/api", "B", TARGET, { ...OPTS, fetchImpl: fakeFetch });
  expect(res.ok).toBe(true);
  expect(calls).toBe(2);
});

test("두 번 연속 transient 실패는 재시도 소진 후 throw(에러에 분류 코드 포함)", async () => {
  let calls = 0;
  const fakeFetch = (async () => {
    calls++;
    return new Response("overloaded", { status: 503 });
  }) as unknown as typeof fetch;

  await expect(geminiPost("https://g/api", "B", TARGET, { ...OPTS, fetchImpl: fakeFetch })).rejects.toThrow("Gemini 생성 실패: unavailable");
  expect(calls).toBe(2);
});

test("generic 실패는 재시도 없이 즉시 throw", async () => {
  let calls = 0;
  const fakeFetch = (async () => {
    calls++;
    return new Response("bad request", { status: 400 });
  }) as unknown as typeof fetch;

  await expect(geminiPost("https://g/api", "B", TARGET, { ...OPTS, errorPrefix: "Gemini 임베딩 실패", fetchImpl: fakeFetch })).rejects.toThrow("Gemini 임베딩 실패: generic");
  expect(calls).toBe(1);
});
