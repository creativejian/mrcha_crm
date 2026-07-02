import { sendJson } from "./http";

export type AssistantSource = { customerId: string; customerName: string; sourceType: string; snippet: string };
export type AssistantAnswer = { answer: string; sources: AssistantSource[] };

// 업무 AI 질문 → 근거 답변. 실패 시 http 헬퍼가 throw(서버 한글 메시지 우선).
export async function askAssistant(question: string): Promise<AssistantAnswer> {
  return sendJson<AssistantAnswer>("/api/assistant/ask", "POST", { question });
}
