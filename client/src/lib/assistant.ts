import { getJson, sendJson } from "./http";
import { apiFetch } from "./api";
import { createSseParser } from "./assistant-sse";

export type AssistantSource = { customerId: string; customerName: string; sourceType: string; snippet: string };
export type AssistantMessage = { id: string; role: "user" | "assistant"; content: string; sources: AssistantSource[] | null; createdAt: string };
export type AssistantAskResult = { messages: AssistantMessage[] };

// 본인 최근 대화 히스토리(패널 진입 시). cursor 지정 시 그 이전(older) 30건을 오름차순으로 반환.
export async function fetchAssistantMessages(before?: { createdAt: string; id: string }): Promise<AssistantMessage[]> {
  const q = before ? `?before=${encodeURIComponent(before.createdAt)}&beforeId=${before.id}` : "";
  return getJson<AssistantMessage[]>(`/api/assistant/messages${q}`);
}

// 중단 트림 — stop 시 화면에 노출된 만큼으로 본인 답변을 잘라 저장(stop = 본 것까지만, 앱 미러).
export async function updateAssistantMessageContent(id: string, content: string): Promise<AssistantMessage> {
  return sendJson<AssistantMessage>(`/api/assistant/messages/${id}`, "PATCH", { content });
}

export type AssistantStreamHandlers = { onChunk: (chunk: string) => void };

// 업무 AI 질문(SSE 스트리밍). text 청크마다 onChunk, done에서 영속본 2건을 resolve.
// error 이벤트/HTTP 실패는 한국어 메시지로 throw, 중지(abort)는 AbortError DOMException으로 throw(호출부 분기).
// onChunk는 동기 호출되며 내부에서 throw하면 스트림 소비가 중단되고 일반 Error로 전파된다 — 호출부는 onChunk를 방어적으로 작성할 것.
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
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of feed(decoder.decode(value, { stream: true }))) {
        if (ev.event === "text") {
          handlers.onChunk((JSON.parse(ev.data) as { chunk: string }).chunk);
        } else if (ev.event === "done") {
          // done 수신 즉시 반환 — 물리적 close를 한 번 더 기다리는 창에서 중지(abort)가 이미 완료·영속된 결과를 버리는 경합 제거.
          return JSON.parse(ev.data) as AssistantAskResult;
        } else if (ev.event === "error") {
          const { message } = JSON.parse(ev.data) as { message?: string };
          throw new Error(message ?? "일시적으로 답변에 실패했습니다.");
        }
      }
    }
  } finally {
    // 모든 종료 경로(done 즉시 반환·error throw·조기 종료)에서 HTTP 커넥션을 즉시 정리(이미 닫힌 스트림엔 no-op).
    await reader.cancel().catch(() => {});
  }
  throw new Error("응답이 완료되지 않았습니다.");
}
