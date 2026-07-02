import { test, expect } from "bun:test";

import { generateAnswer, GEN_MODEL } from "./gemini-generate";

test("generateAnswer: system+user 프롬프트 전송, 텍스트 파싱", async () => {
  let captured: { url: string; body: { systemInstruction?: unknown; contents: { role: string; parts: { text: string }[] }[] } } | null = null;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "답변입니다" }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const out = await generateAnswer("SYS", "USER", "KEY", [], fakeFetch);

  expect(out).toBe("답변입니다");
  expect(captured!.url).toContain(`${GEN_MODEL}:generateContent`);
  expect(captured!.body.contents.at(-1)!.parts[0].text).toBe("USER");
  expect(captured!.body.contents.at(-1)!.role).toBe("user");
});

test("generateAnswer: history를 contents 앞부분에 role 매핑(assistant→model)", async () => {
  let contents: { role: string; parts: { text: string }[] }[] = [];
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    contents = JSON.parse(String(init?.body)).contents;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  await generateAnswer("SYS", "이번질문", "KEY", [
    { role: "user", content: "이전질문" },
    { role: "assistant", content: "이전답변" },
  ], fakeFetch);

  expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  expect(contents[0].parts[0].text).toBe("이전질문");
  expect(contents[1].parts[0].text).toBe("이전답변");
  expect(contents[2].parts[0].text).toBe("이번질문");
});

test("generateAnswer: 실패 응답은 throw", async () => {
  const fakeFetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  await expect(generateAnswer("s", "u", "KEY", [], fakeFetch)).rejects.toThrow();
});
