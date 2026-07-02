import { classifyGeminiError } from "./gemini-error";

export const EMBEDDING_MODEL = "gemini-embedding-001"; // 앱 관례(3072 네이티브). output_dimensionality 미지정.
export type EmbedTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

// texts 각각을 3072차원 벡터로. 실패(재시도 후에도)는 throw. 빈 입력은 호출 없이 [].
export async function embedTexts(
  texts: string[],
  apiKey: string,
  taskType: EmbedTaskType,
  fetchImpl: typeof fetch = fetch,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${apiKey}`;
  const body = JSON.stringify({
    requests: texts.map((text) => ({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
    })),
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok) {
      const data = (await res.json()) as { embeddings?: { values?: number[] }[] };
      const vecs = data.embeddings?.map((e) => e.values);
      if (!vecs || vecs.some((v) => !Array.isArray(v))) throw new Error("Gemini 임베딩 응답 파싱 실패");
      return vecs as number[][];
    }
    const bodyText = await res.text();
    const code = classifyGeminiError(res.status, bodyText);
    console.error(`[assistant] Gemini embed ${code} status=${res.status}`);
    if (attempt === 0 && (code === "rate_limited" || code === "unavailable")) continue;
    throw new Error(`Gemini 임베딩 실패: ${code}`);
  }
  throw new Error("Gemini 임베딩 실패");
}
