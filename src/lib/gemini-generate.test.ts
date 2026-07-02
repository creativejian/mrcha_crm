import { test, expect } from "bun:test";

import { generateAnswer, GEN_MODEL } from "./gemini-generate";

test("generateAnswer: system+user 프롬프트 전송, 텍스트 파싱", async () => {
  let captured: { url: string; body: { systemInstruction?: unknown; contents: { parts: { text: string }[] }[] } } | null = null;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "답변입니다" }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const out = await generateAnswer("SYS", "USER", "KEY", fakeFetch);

  expect(out).toBe("답변입니다");
  expect(captured!.url).toContain(`${GEN_MODEL}:generateContent`);
  expect(captured!.body.contents[0].parts[0].text).toBe("USER");
});

test("generateAnswer: 실패 응답은 throw", async () => {
  const fakeFetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  await expect(generateAnswer("s", "u", "KEY", fakeFetch)).rejects.toThrow();
});
