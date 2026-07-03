import { test, expect } from "bun:test";

import { classifyGeminiError as classifyEdge } from "../../supabase/functions/crm-analyst/gemini";
import { classifyGeminiError } from "./gemini-error";

test("classifyGeminiError: 대표 케이스 판정", () => {
  expect(classifyGeminiError(429, "quota exceeded")).toBe("rate_limited");
  expect(classifyGeminiError(429, "your credit balance is depleted")).toBe("credits_depleted");
  expect(classifyGeminiError(503, "model overloaded")).toBe("unavailable");
  expect(classifyGeminiError(400, "invalid argument")).toBe("generic");
});

// bun(CRM) ↔ Deno(crm-analyst) 복제본 드리프트 tripwire — 갈라지면 transient(1회 재시도) 판정이
// CRM과 crm-analyst에서 달라진다(roles-parity와 동일 패턴 — Edge 파일은 배포 시점 번들 스냅샷이라
// 수정 시 crm-analyst 재배포 필요).
test("classifyGeminiError: CRM과 crm-analyst 복제본이 동일 판정", () => {
  const fixtures: [number | undefined, string][] = [
    [429, "quota exceeded"],
    [429, "your credit balance is depleted"],
    [400, "RESOURCE_EXHAUSTED: prepay billing issue"],
    [503, "model overloaded"],
    [500, "the model is unavailable right now"],
    [undefined, "high demand, please try again"],
    [400, "invalid argument"],
    [undefined, ""],
  ];
  for (const [status, body] of fixtures) {
    expect(classifyEdge(status, body)).toBe(classifyGeminiError(status, body));
  }
});
