// gemini_error.ts classifyGeminiError의 복제(sentry/discord 의존 제외 — 순수 분류만).
export type GeminiErrorCode = "credits_depleted" | "rate_limited" | "unavailable" | "generic";

export function classifyGeminiError(status: number | undefined, bodyText: string): GeminiErrorCode {
  const t = bodyText.toLowerCase();
  if (status === 429 || t.includes("resource_exhausted") || t.includes("429")) {
    if (/credit|deplet|prepay|billing|balance|payment/.test(t)) return "credits_depleted";
    return "rate_limited";
  }
  if (status === 503 || t.includes("unavailable") || t.includes("overloaded") || t.includes("high demand")) {
    return "unavailable";
  }
  return "generic";
}

const MODEL_NAME = "gemini-3.1-flash-lite"; // 앱 ai-analyst와 동일. 정확도 부족 시 상수만 상향.

type ClassifyArgs = {
  apiKey: string;
  mimeType: string;
  dataBase64: string;
  prompt: string;
  responseSchema: unknown;
  fetchImpl?: typeof fetch;
};

// vision 분류. 22종 or "unknown" 문자열 반환. 실패(재시도 후에도)는 throw → 프론트가 regex 폴백.
export async function classifyDocumentImage(args: ClassifyArgs): Promise<string> {
  const { apiKey, mimeType, dataBase64, prompt, responseSchema, fetchImpl = fetch } = args;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: dataBase64 } }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0 },
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string") throw new Error("Gemini 응답 파싱 실패");
      const parsed = JSON.parse(text) as { docType?: string };
      if (!parsed.docType) throw new Error("Gemini 응답에 docType 없음");
      return parsed.docType;
    }
    const bodyText = await res.text();
    const code = classifyGeminiError(res.status, bodyText);
    console.error(`[crm-analyst] Gemini ${code} status=${res.status}`);
    // transient(rate_limited/unavailable)만 1회 재시도. 그 외는 즉시 throw.
    if (attempt === 0 && (code === "rate_limited" || code === "unavailable")) continue;
    throw new Error(`Gemini 분류 실패: ${code}`);
  }
  // unreachable: 루프 내부가 항상 return/throw — TS 반환타입 체크 통과용.
  throw new Error("Gemini 분류 실패");
}
