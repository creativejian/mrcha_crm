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
