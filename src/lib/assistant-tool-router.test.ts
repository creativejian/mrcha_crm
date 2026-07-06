import { test, expect } from "bun:test";

import { routeAssistantTool } from "./assistant-tool-router";
import type { GeminiTarget } from "./gemini-target";

const target: GeminiTarget = { baseUrl: "https://gemini.test", apiKey: "k" };

function fakeFetch(parts: unknown[]): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts } }] }), { status: 200 })) as unknown as typeof fetch;
}

test("routeAssistantTool: functionCall 파트 → {key, params}", async () => {
  const routed = await routeAssistantTool("앱을 통해서 들어온 고객은 누구야", target, {
    fetchImpl: fakeFetch([{ functionCall: { name: "search_customers", args: { source: "앱" } } }]),
  });
  expect(routed).toEqual({ key: "search_customers", params: { source: "앱" } });
});

test("routeAssistantTool: 텍스트만(도구 불필요 판단) → null", async () => {
  const routed = await routeAssistantTool("안녕", target, { fetchImpl: fakeFetch([{ text: "도구 없이 답변" }]) });
  expect(routed).toBeNull();
});

test("routeAssistantTool: 화이트리스트 밖 함수명 → null(무시)", async () => {
  const routed = await routeAssistantTool("q", target, {
    fetchImpl: fakeFetch([{ functionCall: { name: "drop_table", args: {} } }]),
  });
  expect(routed).toBeNull();
});

test("routeAssistantTool: args 누락 → 빈 params", async () => {
  const routed = await routeAssistantTool("오늘 할 일", target, {
    fetchImpl: fakeFetch([{ functionCall: { name: "today_actions" } }]),
  });
  expect(routed).toEqual({ key: "today_actions", params: {} });
});

test("routeAssistantTool: 업스트림 실패 → null(라우팅 실패는 NO_HITS 폴백 — 500으로 전파하지 않음)", async () => {
  const failFetch = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
  const routed = await routeAssistantTool("q", target, { fetchImpl: failFetch });
  expect(routed).toBeNull();
});
