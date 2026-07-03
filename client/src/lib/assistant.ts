import { getJson, sendJson } from "./http";
import { apiFetch } from "./api";
import { createSseParser } from "./assistant-sse";

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

export type AssistantStreamHandlers = { onChunk: (chunk: string) => void };

// 업무 AI 질문(SSE 스트리밍). text 청크마다 onChunk, done에서 영속본 2건을 resolve.
// error 이벤트/HTTP 실패는 한국어 메시지로 throw, 중지(abort)는 AbortError DOMException으로 throw(호출부 분기).
export async function askAssistantStream(
  question: string,
  handlers: AssistantStreamHandlers,
  signal: AbortSignal,
): Promise<AssistantAskResult> {
  const res = await apiFetch("/api/assistant/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, stream: true }),
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `요청 실패: ${res.status}`);
  }
  if (!res.body) throw new Error("응답이 완료되지 않았습니다.");

  const feed = createSseParser();
  const reader = res.body.getReader();
  // { stream: true } 필수 — 멀티바이트 UTF-8이 네트워크 청크 경계에서 갈라져도 디코더가 잔여 바이트를 이월한다.
  const decoder = new TextDecoder();
  let result: AssistantAskResult | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of feed(decoder.decode(value, { stream: true }))) {
        if (ev.event === "text") {
          handlers.onChunk((JSON.parse(ev.data) as { chunk: string }).chunk);
        } else if (ev.event === "done") {
          result = JSON.parse(ev.data) as AssistantAskResult;
        } else if (ev.event === "error") {
          const { message } = JSON.parse(ev.data) as { message?: string };
          throw new Error(message ?? "일시적으로 답변에 실패했습니다.");
        }
      }
    }
  } finally {
    // error 이벤트 throw·조기 종료 시 HTTP 커넥션을 즉시 정리(정상 완료 후에는 no-op).
    await reader.cancel().catch(() => {});
  }
  if (!result) throw new Error("응답이 완료되지 않았습니다.");
  return result;
}
