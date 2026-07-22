import { test, expect } from "bun:test";

import { embedTexts, EMBEDDING_MODEL } from "./gemini-embed";
import { resolveGeminiTarget } from "./gemini-target";

const TARGET = resolveGeminiTarget({ apiKey: "KEY" });

test("embedTexts: batchEmbedContents 요청 본문 + 응답 파싱", async () => {
  let captured: { url: string; headers: Record<string, string>; body: unknown } | null = null;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), headers: { ...(init?.headers as Record<string, string>) }, body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const out = await embedTexts(["a", "b"], TARGET, fakeFetch);

  expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  expect(captured!.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`);
  expect(captured!.headers["x-goog-api-key"]).toBe("KEY");
  expect(captured!.url).not.toContain("key=");
  const body = captured!.body as { requests: { model: string; content: { parts: { text: string }[] }; taskType?: string }[] };
  expect(body.requests).toHaveLength(2);
  expect(body.requests[0].content.parts[0].text).toBe("a");
  expect(body.requests[0].model).toBe(`models/${EMBEDDING_MODEL}`);
  // gemini-embedding-2는 taskType을 조용히 무시한다(실측: DOCUMENT/QUERY/생략 코사인 1.0).
  // 죽은 필드를 보내면 "검색 의도가 반영된다"는 오해를 부르므로 아예 싣지 않는다.
  expect(body.requests[0].taskType).toBeUndefined();
});

test("embedTexts: 빈 배열은 API 호출 없이 []", async () => {
  const out = await embedTexts([], TARGET, (() => { throw new Error("호출되면 안 됨"); }) as unknown as typeof fetch);
  expect(out).toEqual([]);
});

test("embedTexts: 요청 수 ≠ 응답 벡터 수면 throw(인덱스 오매핑 방지)", async () => {
  // gemini-embedding-2는 요청당 1벡터를 보장한다(장문도 내부 집계 — 실측). 그 계약이 깨지면
  // 호출부의 순서 기반 매핑이 조용히 어긋나므로 fail-loud로 막는다.
  const fakeFetch = (async () => new Response(JSON.stringify({ embeddings: [{ values: [0.1] }] }), { status: 200 })) as unknown as typeof fetch;
  await expect(embedTexts(["a", "b"], TARGET, fakeFetch)).rejects.toThrow(/개수 불일치/);
});

test("embedTexts: 실패 응답은 throw", async () => {
  const fakeFetch = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
  await expect(embedTexts(["a"], TARGET, fakeFetch)).rejects.toThrow();
});

test("embedTexts: 프록시 target이면 프록시 baseUrl + Authorization/x-region 헤더", async () => {
  let captured: { url: string; headers: Record<string, string> } | null = null;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), headers: { ...(init?.headers as Record<string, string>) } };
    return new Response(JSON.stringify({ embeddings: [{ values: [1] }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const proxied = resolveGeminiTarget({ apiKey: "KEY", proxyUrl: "https://x.supabase.co/functions/v1/crm-gemini-proxy", authHeader: "Bearer j" });
  await embedTexts(["a"], proxied, fakeFetch);

  expect(captured!.url).toBe(`https://x.supabase.co/functions/v1/crm-gemini-proxy/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`);
  expect(captured!.headers.Authorization).toBe("Bearer j");
  expect(captured!.headers["x-region"]).toBe("ap-northeast-2");
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
  const out = await embedTexts(texts, TARGET, fakeFetch);

  expect(batchSizes).toEqual([100, 100, 50]); // Gemini batchEmbedContents 요청당 100개 제한
  expect(out).toHaveLength(250);
  expect(out[0]).toEqual([0]);
  expect(out[149]).toEqual([149]);
  expect(out[249]).toEqual([249]);
});
