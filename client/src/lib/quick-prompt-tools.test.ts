import { describe, expect, it } from "vitest";

import { ASSISTANT_TOOL_KEYS } from "../../../src/lib/assistant-tools";
import { QUICK_AI_PROMPTS } from "@/components/ai/AiAssistantPanel";

// 파리티 가드: 클라 빠른 질문 → 도구 키 매핑 ↔ 서버 화이트리스트(ASSISTANT_TOOL_KEYS).
// 클라가 모르는 키를 보내면 서버 zod가 400으로 거부해 버튼이 조용히 죽는다 — 드리프트를 기계로 잡는다
// (app-card-payload-parity와 같은 tripwire 패턴: 서버 모듈은 테스트에서만 import, 런타임 번들 미유입).
describe("빠른 질문 도구 키 파리티", () => {
  it("클라 매핑의 모든 키가 서버 화이트리스트에 존재한다", () => {
    const serverKeys = new Set<string>(ASSISTANT_TOOL_KEYS);
    for (const p of QUICK_AI_PROMPTS) {
      expect(serverKeys.has(p.tool), `클라 도구 키 "${p.tool}"(${p.text})가 서버 ASSISTANT_TOOL_KEYS에 없음`).toBe(true);
    }
  });

  it("버튼 5종이 서로 다른 도구를 가리킨다(중복 매핑 방지)", () => {
    const tools = QUICK_AI_PROMPTS.map((p) => p.tool);
    expect(new Set(tools).size).toBe(tools.length);
    expect(tools.length).toBe(5);
  });
});
