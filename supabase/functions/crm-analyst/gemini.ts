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

// 서류 vision 분류 전용 — **본체(`GEN_MODEL` = flash-lite)보다 의도적으로 상위 티어**다(2026-07-22).
// 근거: ①틀리면 사람이 다시 확인해야 하는 작업이라 정확도가 곧 실무 시간이다 ②호출이 **서류 업로드당
// 1회**고 출력이 `{"docType":"…"}` 20토큰 안팎이라(structured output) 비싼 출력 단가가 거의 작동하지
// 않는다 — 실산 호출당 약 3.4원 vs lite 0.7원, 월 1,000건 기준 차이 2,700원 ③실패해도 클라가 파일명
// regex로 degrade하고 UI 배지가 `ai`/`fallback`을 구분 표시해 장애가 은폐되지 않는다.
// ⚠️ 이 파일은 Deno 복제본이라 `GEN_MODEL`을 import할 수 없다 — 두 상수는 **의도적으로 독립**이며,
// 본체 모델을 올려도 여기를 따라 올릴 필요가 없다(그 반대도 마찬가지).
const MODEL_NAME = "gemini-3.6-flash";

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
  // 키는 항상 x-goog-api-key 헤더로 — ?key= 쿼리는 프록시/게이트웨이 로그에 남는다(#144 키 정책, CRM 본체와 동일).
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: dataBase64 } }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0 },
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body });
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
