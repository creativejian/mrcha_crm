import { geminiPost } from "./gemini-post";
import type { GeminiTarget } from "./gemini-target";

// 생성 모델 SSOT — **업무 AI 답변(SSE/논스트림)·도구 라우팅·AI 힌트 3용도가 이 한 상수를 공유**한다.
// ⚠️ 그래서 이 값을 바꾸면 답변 문장만이 아니라 **라우팅 판단(어떤 질문에 어떤 도구를 부를지)까지
// 바뀐다**(`assistant-tool-router.ts`가 같은 상수를 쓴다). 자동 테스트는 라우터를 페이크로 주입하므로
// 이 변화를 못 잡는다(배치 14 K2-d) — 모델을 올릴 때는 **실기 골든 4종**을 눈으로 확인할 것:
//   "마이바흐 관심 고객이 누구야?" → 라우팅 없음(RAG로 답) · "김지안 견적 몇 개야?" → customer_quotes
//   "앱으로 들어온 고객 알려줘" → search_customers{source:"앱"} · "오늘 점심 뭐 먹을까?" → 범위 밖 안내
//
// **flash-lite 티어를 유지하는 이유**(2026-07-22 검토): ①라우터는 "도구 하나 고르기"라 지능 상한이
// 낮고, 상위 티어의 thinking은 분류에 지연만 더한다 ②답변은 SSE 스트리밍이라 **TTFB가 UX 핵심**이다
// (#145~#147에서 데드락으로 고생한 축) ③힌트는 90자 한 줄이다.
// 서류 vision 분류만 상위 티어로 갈랐다 — `supabase/functions/crm-analyst/gemini.ts` 참조.
// 임베딩 모델(`gemini-embed.ts`)과 달리 생성은 저장물이 없어 **앱과 달라도 무방**하다(계약 아님).
export const GEN_MODEL = "gemini-3.5-flash-lite";

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type GenerateOpts = { history?: ChatTurn[]; fetchImpl?: typeof fetch };
// signal: 클라 중단 시 업스트림을 즉시 끊는다 — CF에서 클라 disconnect 후 pending read는 영영 해소되지
// 않아, signal 없이는 finalize가 waitUntil 유예(30s)를 넘겨 취소된다(2026-07-03 prod 유령 placeholder 실측).
export type GenerateStreamOpts = GenerateOpts & { signal?: AbortSignal };

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
  opts: GenerateOpts = {},
): Promise<string> {
  const url = `${target.baseUrl}/v1beta/models/${GEN_MODEL}:generateContent`;
  const body = buildGenerateBody(systemPrompt, userPrompt, opts.history ?? []);
  const res = await geminiPost(url, body, target, { label: "generate", errorPrefix: "Gemini 생성 실패", fetchImpl: opts.fetchImpl });
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error("Gemini 생성 응답 파싱 실패");
  return text;
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
  opts: GenerateStreamOpts = {},
): AsyncGenerator<string> {
  const url = `${target.baseUrl}/v1beta/models/${GEN_MODEL}:streamGenerateContent?alt=sse`;
  const body = buildGenerateBody(systemPrompt, userPrompt, opts.history ?? []);
  const res = await geminiPost(url, body, target, { label: "stream", errorPrefix: "Gemini 생성 실패", fetchImpl: opts.fetchImpl, signal: opts.signal });
  if (!res.body) throw new Error("Gemini 생성 실패");

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
