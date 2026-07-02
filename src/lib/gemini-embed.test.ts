import { test, expect } from "bun:test";

import { embedTexts, EMBEDDING_MODEL } from "./gemini-embed";

test("embedTexts: batchEmbedContents 요청 본문 + 응답 파싱", async () => {
  let captured: { url: string; body: unknown } | null = null;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const out = await embedTexts(["a", "b"], "KEY", "RETRIEVAL_DOCUMENT", fakeFetch);

  expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  expect(captured!.url).toContain(`${EMBEDDING_MODEL}:batchEmbedContents`);
  expect(captured!.url).toContain("key=KEY");
  const body = captured!.body as { requests: { model: string; content: { parts: { text: string }[] }; taskType: string }[] };
  expect(body.requests).toHaveLength(2);
  expect(body.requests[0].content.parts[0].text).toBe("a");
  expect(body.requests[0].taskType).toBe("RETRIEVAL_DOCUMENT");
});

test("embedTexts: 빈 배열은 API 호출 없이 []", async () => {
  const out = await embedTexts([], "KEY", "RETRIEVAL_QUERY", (() => { throw new Error("호출되면 안 됨"); }) as unknown as typeof fetch);
  expect(out).toEqual([]);
});

test("embedTexts: 실패 응답은 throw", async () => {
  const fakeFetch = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
  await expect(embedTexts(["a"], "KEY", "RETRIEVAL_QUERY", fakeFetch)).rejects.toThrow();
});

test("embedTexts: 100개 초과는 배치로 쪼개 호출하고 순서를 보존해 합친다", async () => {
  const batchSizes: number[] = [];
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { requests: { content: { parts: { text: string }[] } }[] };
    batchSizes.push(body.requests.length);
    // 각 텍스트 "t<i>"를 벡터 [i]로 — 순서 보존 검증용.
    const embeddings = body.requests.map((r) => ({ values: [Number(r.content.parts[0].text.slice(1))] }));
    return new Response(JSON.stringify({ embeddings }), { status: 200 });
  }) as unknown as typeof fetch;

  const texts = Array.from({ length: 250 }, (_, i) => `t${i}`);
  const out = await embedTexts(texts, "KEY", "RETRIEVAL_DOCUMENT", fakeFetch);

  expect(batchSizes).toEqual([100, 100, 50]); // Gemini batchEmbedContents 요청당 100개 제한
  expect(out).toHaveLength(250);
  expect(out[0]).toEqual([0]);
  expect(out[149]).toEqual([149]);
  expect(out[249]).toEqual([249]);
});
