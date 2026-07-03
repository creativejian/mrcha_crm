import { classifyGeminiError } from "./gemini-error";
import { geminiHeaders, type GeminiTarget } from "./gemini-target";

export const GEN_MODEL = "gemini-3.1-flash-lite"; // 앱/crm-analyst 동일.

export type ChatTurn = { role: "user" | "assistant"; content: string };

// generateContent/streamGenerateContent 공통 요청 바디 — history role 매핑(assistant→model) 포함.
function buildGenerateBody(systemPrompt: string, userPrompt: string, history: ChatTurn[]): string {
  const contents = [
    ...history.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
    { role: "user", parts: [{ text: userPrompt }] },
  ];
  return JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.2 },
  });
}

// 근거+질문(+지난 turn history)으로 한국어 답변 생성. 실패(재시도 후에도)는 throw.
export async function generateAnswer(
  systemPrompt: string,
  userPrompt: string,
  target: GeminiTarget,
  history: ChatTurn[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = `${target.baseUrl}/v1beta/models/${GEN_MODEL}:generateContent`;
  const body = buildGenerateBody(systemPrompt, userPrompt, history);

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, { method: "POST", headers: geminiHeaders(target), body });
    if (res.ok) {
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string") throw new Error("Gemini 생성 응답 파싱 실패");
      return text;
    }
    const bodyText = await res.text();
    const code = classifyGeminiError(res.status, bodyText);
    console.error(`[assistant] Gemini generate ${code} status=${res.status}`);
    if (attempt === 0 && (code === "rate_limited" || code === "unavailable")) continue;
    throw new Error(`Gemini 생성 실패: ${code}`);
  }
  throw new Error("Gemini 생성 실패");
}

// SSE `data: {json}` 한 줄에서 텍스트 파트 추출. data 라인이 아니거나 빈 payload/[DONE]이면 null.
function parseSseLine(rawLine: string): string | null {
  const line = rawLine.trimEnd();
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  const data = JSON.parse(payload) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" && text.length > 0 ? text : null;
}

// 스트리밍 생성 — Gemini alt=sse의 `data: {json}` 라인에서 텍스트 파트만 순서대로 yield.
// HTTP 레벨 실패(스트림 시작 전)만 rate_limited/unavailable 1회 재시도. 스트림 중간 실패는 그대로 throw(호출부가 부분 저장 처리).
export async function* generateAnswerStream(
  systemPrompt: string,
  userPrompt: string,
  target: GeminiTarget,
  history: ChatTurn[] = [],
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<string> {
  const url = `${target.baseUrl}/v1beta/models/${GEN_MODEL}:streamGenerateContent?alt=sse`;
  const body = buildGenerateBody(systemPrompt, userPrompt, history);

  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetchImpl(url, { method: "POST", headers: geminiHeaders(target), body });
    if (res.ok) break;
    const bodyText = await res.text();
    const code = classifyGeminiError(res.status, bodyText);
    console.error(`[assistant] Gemini stream ${code} status=${res.status}`);
    if (attempt === 0 && (code === "rate_limited" || code === "unavailable")) { res = null; continue; }
    throw new Error(`Gemini 생성 실패: ${code}`);
  }
  if (!res?.ok || !res.body) throw new Error("Gemini 생성 실패");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const text = parseSseLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (text !== null) yield text;
      }
    }
    // 종단 방어 — 개행 없이 끝나는 스트림의 잔여 바이트를 flush하고 마지막 라인도 파싱.
    buf += decoder.decode();
    const tail = parseSseLine(buf);
    if (tail !== null) yield tail;
  } finally {
    // 소비자가 조기 break/throw(중지 경로)해도 업스트림 HTTP를 취소해 연결·토큰 낭비를 막는다. 정상 완료 후엔 no-op.
    await reader.cancel().catch(() => {});
  }
}
