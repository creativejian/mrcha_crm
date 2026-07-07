import { ASSISTANT_TOOL_DECLARATIONS, ASSISTANT_TOOL_KEYS, type AssistantToolKey } from "./assistant-tools";
import { GEN_MODEL, type ChatTurn } from "./gemini-generate";
import { geminiPost } from "./gemini-post";
import type { GeminiTarget } from "./gemini-target";

// 자유 질문 → 도구 라우팅(PR2): RAG 근거 0건(기존 NO_HITS 지점)에서만 호출되는 1차 논스트림 판단.
// 판정 3갈래 — call: 모델이 functionCall을 냄(도구 실행). none: 모델이 텍스트로 답함("해당 없음" —
// 도구로 답할 수 없는 질문이라는 명시적 판단, 라우트가 범위 밖 안내 문구로 구분 응답). null: 라우팅 실패
// (업스트림 에러·빈 응답·화이트리스트 밖 함수명) — 실패를 "범위 밖"으로 단정하면 진짜 CRM 질문에
// 오답이라 기존 NO_HITS 폴백 유지(500으로도 새지 않는다 — 안전 방향).
export type RoutedToolDecision =
  | { kind: "call"; key: AssistantToolKey; params: Record<string, unknown> }
  | { kind: "none" };

const ROUTER_SYSTEM_PROMPT = [
  "당신은 자동차 CRM 업무 어시스턴트의 질문 라우터입니다.",
  "질문이 고객 목록·집계·조건 검색(예: 특정 경로로 들어온 고객, 오늘 할 일, 상태별 고객)이면 가장 적합한 함수를 호출하세요.",
  "함수로 답할 수 없는 질문(잡담·일반 지식·특정 고객의 서술형 맥락)이면 함수를 호출하지 말고 '해당 없음'이라고만 답하세요.",
].join("\n");

type RouteOpts = { history?: ChatTurn[]; fetchImpl?: typeof fetch };

export async function routeAssistantTool(
  question: string,
  target: GeminiTarget,
  opts: RouteOpts = {},
): Promise<RoutedToolDecision | null> {
  const url = `${target.baseUrl}/v1beta/models/${GEN_MODEL}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: ROUTER_SYSTEM_PROMPT }] },
    contents: [
      ...(opts.history ?? []).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
      { role: "user", parts: [{ text: question }] },
    ],
    tools: [{ functionDeclarations: ASSISTANT_TOOL_DECLARATIONS }],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { temperature: 0 },
  });
  try {
    const res = await geminiPost(url, body, target, { label: "route", errorPrefix: "Gemini 라우팅 실패", fetchImpl: opts.fetchImpl });
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { functionCall?: { name?: string; args?: Record<string, unknown> }; text?: string }[] } }[];
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const call = parts.find((p) => p.functionCall)?.functionCall;
    if (!call?.name) {
      // 텍스트 파트가 있으면 모델의 명시적 "도구 불필요" 판단(none), 파트 자체가 없으면 이상 응답 = 실패(null).
      return parts.some((p) => typeof p.text === "string" && p.text.trim()) ? { kind: "none" } : null;
    }
    // 화이트리스트 게이트 — 모델이 지어낸 함수명은 무시(실행기 도달 전 차단). 범위 밖 단정도 하지 않는다.
    if (!(ASSISTANT_TOOL_KEYS as readonly string[]).includes(call.name)) return null;
    const params = typeof call.args === "object" && call.args != null ? call.args : {};
    return { kind: "call", key: call.name as AssistantToolKey, params };
  } catch (e) {
    console.error("[assistant] 도구 라우팅 실패(NO_HITS 폴백):", e);
    return null;
  }
}
