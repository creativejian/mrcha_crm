import { getJson, sendJson } from "./http";

export type AssistantSource = { customerId: string; customerName: string; sourceType: string; snippet: string };
export type AssistantMessage = { id: string; role: "user" | "assistant"; content: string; sources: AssistantSource[] | null; createdAt: string };
export type AssistantAskResult = { messages: AssistantMessage[] };

// 업무 AI 질문 → 저장된 user/assistant 메시지 2건(답변·출처는 messages[1]에 영속). 실패 시 http 헬퍼가 throw.
export async function askAssistant(question: string): Promise<AssistantAskResult> {
  return sendJson<AssistantAskResult>("/api/assistant/ask", "POST", { question });
}

// 본인 최근 대화 히스토리(패널 진입 시). cursor 지정 시 그 이전(older) 30건을 오름차순으로 반환.
export async function fetchAssistantMessages(before?: { createdAt: string; id: string }): Promise<AssistantMessage[]> {
  const q = before ? `?before=${encodeURIComponent(before.createdAt)}&beforeId=${before.id}` : "";
  return getJson<AssistantMessage[]>(`/api/assistant/messages${q}`);
}
