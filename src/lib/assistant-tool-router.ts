import { ASSISTANT_TOOL_DECLARATIONS, ASSISTANT_TOOL_KEYS, type AssistantToolKey } from "./assistant-tools";
import { GEN_MODEL, type ChatTurn } from "./gemini-generate";
import { geminiPost } from "./gemini-post";
import type { GeminiTarget } from "./gemini-target";

// 자유 질문 → 도구 라우팅(PR2): 자유 질문마다 **근거 유무와 무관하게** 호출되는 1차 논스트림 판단
// (구 "RAG 근거 0건에서만"은 2026-07-07 라우팅 우선 게이트로 폐기 — 그 서술이 이 주석에 남아 있었다).
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
  "질문의 '나/내/제'는 현재 로그인한 사용자입니다 — 담당 고객을 1인칭으로 물으면(예: '내가 계약한 고객') search_customers에 mine=true를 넣고, 사용자 자신이 누구인지 물으면 current_user를 호출하세요.",
  "특정 고객의 견적 개수·차종·발송 상태를 물으면(예: '김지안 견적 몇 개', '무슨 차종 견적 넣었어', '발송한 견적') search_customers가 아니라 customer_quotes에 그 고객 이름을 넣어 호출하세요.",
  "함수 파라미터에 질문에 없는 값을 지어내지 마세요 — 관심 차종·예산·지역처럼 지원하는 필터(이름·진행 상태·구매방식·상담경로·담당)로 표현할 수 없는 조건으로 고객을 찾는 질문이면 함수를 호출하지 말고 '해당 없음'이라고 답하세요(그런 질문은 근거 검색이 답합니다).",
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
