import { test, expect } from "bun:test";

import { generateAnswer, generateAnswerStream, GEN_MODEL } from "./gemini-generate";

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

function sseBody(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const l of lines) controller.enqueue(enc.encode(l));
      controller.close();
    },
  });
}

test("generateAnswerStream: alt=sse 라인에서 텍스트 청크를 순서대로 yield", async () => {
  const chunk = (t: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`;
  let url = "";
  const fakeFetch = (async (u: string | URL | Request) => {
    url = String(u);
    return new Response(sseBody([chunk("안녕"), chunk("하세요")]), { status: 200 });
  }) as unknown as typeof fetch;

  const out: string[] = [];
  for await (const c of generateAnswerStream("SYS", "USER", "KEY", [], fakeFetch)) out.push(c);

  expect(out).toEqual(["안녕", "하세요"]);
  expect(url).toContain(`${GEN_MODEL}:streamGenerateContent?alt=sse`);
});

test("generateAnswerStream: 청크 경계가 라인 중간에서 갈라져도 파싱", async () => {
  const line = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "분할청크" }] } }] })}\n\n`;
  const fakeFetch = (async () =>
    new Response(sseBody([line.slice(0, 20), line.slice(20)]), { status: 200 })) as unknown as typeof fetch;

  const out: string[] = [];
  for await (const c of generateAnswerStream("s", "u", "K", [], fakeFetch)) out.push(c);
  expect(out).toEqual(["분할청크"]);
});

test("generateAnswerStream: HTTP 실패는 throw(스트림 시작 전)", async () => {
  const fakeFetch = (async () => new Response("nope", { status: 400 })) as unknown as typeof fetch;
  const gen = generateAnswerStream("s", "u", "K", [], fakeFetch);
  await expect(gen.next()).rejects.toThrow("Gemini 생성 실패");
});

test("generateAnswerStream: rate_limited는 1회 재시도 후 성공", async () => {
  let calls = 0;
  const ok = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "재시도성공" }] } }] })}\n\n`;
  const fakeFetch = (async () => {
    calls++;
    if (calls === 1) return new Response("quota", { status: 429 });
    return new Response(sseBody([ok]), { status: 200 });
  }) as unknown as typeof fetch;

  const out: string[] = [];
  for await (const c of generateAnswerStream("s", "u", "K", [], fakeFetch)) out.push(c);
  expect(out).toEqual(["재시도성공"]);
  expect(calls).toBe(2);
});
