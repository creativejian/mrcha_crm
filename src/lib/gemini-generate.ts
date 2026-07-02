import { classifyGeminiError } from "./gemini-error";

export const GEN_MODEL = "gemini-3.1-flash-lite"; // 앱/crm-analyst 동일.

// 근거+질문으로 한국어 답변 생성. 실패(재시도 후에도)는 throw.
export async function generateAnswer(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEN_MODEL}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0.2 },
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
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
