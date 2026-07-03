import { test, expect } from "bun:test";

import { generateAnswer, generateAnswerStream, GEN_MODEL } from "./gemini-generate";
import { resolveGeminiTarget } from "./gemini-target";

const TARGET = resolveGeminiTarget({ apiKey: "KEY" });

test("generateAnswer: system+user 프롬프트 전송, 텍스트 파싱", async () => {
  let captured: { url: string; headers: Record<string, string>; body: { systemInstruction?: unknown; contents: { role: string; parts: { text: string }[] }[] } } | null = null;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), headers: { ...(init?.headers as Record<string, string>) }, body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "답변입니다" }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const out = await generateAnswer("SYS", "USER", TARGET, [], fakeFetch);

  expect(out).toBe("답변입니다");
  expect(captured!.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEN_MODEL}:generateContent`);
  expect(captured!.headers["x-goog-api-key"]).toBe("KEY");
  expect(captured!.url).not.toContain("key=");
  expect(captured!.body.contents.at(-1)!.parts[0].text).toBe("USER");
  expect(captured!.body.contents.at(-1)!.role).toBe("user");
});

test("generateAnswer: history를 contents 앞부분에 role 매핑(assistant→model)", async () => {
  let contents: { role: string; parts: { text: string }[] }[] = [];
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    contents = JSON.parse(String(init?.body)).contents;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  await generateAnswer("SYS", "이번질문", TARGET, [
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
  await expect(generateAnswer("s", "u", TARGET, [], fakeFetch)).rejects.toThrow();
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
  for await (const c of generateAnswerStream("SYS", "USER", TARGET, [], fakeFetch)) out.push(c);

  expect(out).toEqual(["안녕", "하세요"]);
  expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEN_MODEL}:streamGenerateContent?alt=sse`);
});

test("generateAnswerStream: 청크 경계가 라인 중간에서 갈라져도 파싱", async () => {
  const line = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "분할청크" }] } }] })}\n\n`;
  const fakeFetch = (async () =>
    new Response(sseBody([line.slice(0, 20), line.slice(20)]), { status: 200 })) as unknown as typeof fetch;

  const out: string[] = [];
  for await (const c of generateAnswerStream("s", "u", TARGET, [], fakeFetch)) out.push(c);
  expect(out).toEqual(["분할청크"]);
});

test("generateAnswerStream: HTTP 실패는 throw(스트림 시작 전)", async () => {
  const fakeFetch = (async () => new Response("nope", { status: 400 })) as unknown as typeof fetch;
  const gen = generateAnswerStream("s", "u", TARGET, [], fakeFetch);
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
  for await (const c of generateAnswerStream("s", "u", TARGET, [], fakeFetch)) out.push(c);
  expect(out).toEqual(["재시도성공"]);
  expect(calls).toBe(2);
});

test("generateAnswerStream: 멀티바이트(한글) UTF-8 바이트 중간에서 청크가 갈라져도 온전한 문자열 yield", async () => {
  const line = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "한글텍스트" }] } }] })}\n\n`;
  const bytes = new TextEncoder().encode(line);
  // 첫 UTF-8 continuation 바이트(상위비트 10) 앞에서 잘라 멀티바이트 문자 중간 분할을 만든다.
  const cut = bytes.findIndex((b) => (b & 0xc0) === 0x80);
  expect(cut).toBeGreaterThan(0);
  const fakeFetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, cut));
          controller.enqueue(bytes.slice(cut));
          controller.close();
        },
      }),
      { status: 200 },
    )) as unknown as typeof fetch;

  const out: string[] = [];
  for await (const c of generateAnswerStream("s", "u", TARGET, [], fakeFetch)) out.push(c);
  expect(out).toEqual(["한글텍스트"]);
});

test("generateAnswerStream: [DONE] 라인은 스킵", async () => {
  const chunk = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "본문" }] } }] })}\n\n`;
  const fakeFetch = (async () =>
    new Response(sseBody([chunk, "data: [DONE]\n\n"]), { status: 200 })) as unknown as typeof fetch;

  const out: string[] = [];
  for await (const c of generateAnswerStream("s", "u", TARGET, [], fakeFetch)) out.push(c);
  expect(out).toEqual(["본문"]);
});

test("generateAnswerStream: 개행 없이 끝나는 마지막 data 라인도 flush 파싱", async () => {
  const first = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "앞" }] } }] })}\n\n`;
  const tailNoNewline = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "꼬리" }] } }] })}`;
  const fakeFetch = (async () =>
    new Response(sseBody([first, tailNoNewline]), { status: 200 })) as unknown as typeof fetch;

  const out: string[] = [];
  for await (const c of generateAnswerStream("s", "u", TARGET, [], fakeFetch)) out.push(c);
  expect(out).toEqual(["앞", "꼬리"]);
});

test("generateAnswerStream: 전달한 signal이 업스트림 fetch에 배선된다", async () => {
  let captured: AbortSignal | null | undefined;
  const chunk = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })}\n\n`;
  const fakeFetch = (async (_u: string | URL | Request, init?: RequestInit) => {
    captured = init?.signal;
    return new Response(sseBody([chunk]), { status: 200 });
  }) as unknown as typeof fetch;

  const ac = new AbortController();
  const out: string[] = [];
  for await (const c of generateAnswerStream("s", "u", TARGET, [], fakeFetch, ac.signal)) out.push(c);

  expect(out).toEqual(["ok"]);
  expect(captured).toBe(ac.signal);
});

test("generateAnswerStream: 소비자 조기 break 시 업스트림 스트림을 cancel", async () => {
  let cancelled = false;
  const enc = new TextEncoder();
  const chunk = (t: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`;
  const fakeFetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode(chunk("첫청크")));
          // close하지 않음 — cancel이 안 오면 다음 read가 영원히 대기하는 열린 스트림.
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200 },
    )) as unknown as typeof fetch;

  const out: string[] = [];
  for await (const c of generateAnswerStream("s", "u", TARGET, [], fakeFetch)) {
    out.push(c);
    break; // 중지 경로 시뮬레이션 — generator return → finally에서 upstream cancel.
  }
  expect(out).toEqual(["첫청크"]);
  expect(cancelled).toBe(true);
});
