import { getJson, sendJson } from "./http";

export type AssistantSource = { customerId: string; customerName: string; sourceType: string; snippet: string };
export type AssistantMessage = { id: string; role: "user" | "assistant"; content: string; sources: AssistantSource[] | null; createdAt: string };
export type AssistantAnswer = { answer: string; sources: AssistantSource[]; messages: AssistantMessage[] };

// 업무 AI 질문 → 근거 답변 + 저장된 user/assistant 메시지. 실패 시 http 헬퍼가 throw.
export async function askAssistant(question: string): Promise<AssistantAnswer> {
  return sendJson<AssistantAnswer>("/api/assistant/ask", "POST", { question });
}

// 본인 최근 대화 히스토리(패널 진입 시).
export async function fetchAssistantMessages(): Promise<AssistantMessage[]> {
  return getJson<AssistantMessage[]>("/api/assistant/messages");
}
