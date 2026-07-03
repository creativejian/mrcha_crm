import { geminiPost } from "./gemini-post";
import type { GeminiTarget } from "./gemini-target";

export const EMBEDDING_MODEL = "gemini-embedding-001"; // 앱 관례(3072 네이티브). output_dimensionality 미지정.
export const EMBEDDING_DIM = 3072; // gemini-embedding-001 네이티브 차원 — schema vector(N)·halfvec 캐스트·테스트 픽스처가 공유
const MAX_EMBED_BATCH = 100; // Gemini batchEmbedContents 요청당 상한 — 초과분은 배치로 쪼갠다
export type EmbedTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

// texts 각각을 3072차원 벡터로. 100개 초과는 배치로 쪼개 순서 보존해 합친다(백필 코퍼스 성장 대비).
// 실패(재시도 후에도)는 throw. 빈 입력은 호출 없이 [].
export async function embedTexts(
  texts: string[],
  target: GeminiTarget,
  taskType: EmbedTaskType,
  fetchImpl: typeof fetch = fetch,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += MAX_EMBED_BATCH) {
    vectors.push(...(await embedBatch(texts.slice(start, start + MAX_EMBED_BATCH), target, taskType, fetchImpl)));
  }
  return vectors;
}

async function embedBatch(
  texts: string[],
  target: GeminiTarget,
  taskType: EmbedTaskType,
  fetchImpl: typeof fetch,
): Promise<number[][]> {
  const url = `${target.baseUrl}/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`;
  const body = JSON.stringify({
    requests: texts.map((text) => ({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
    })),
  });

  const res = await geminiPost(url, body, target, { label: "embed", errorPrefix: "Gemini 임베딩 실패", fetchImpl });
  const data = (await res.json()) as { embeddings?: { values?: number[] }[] };
  const vecs = data.embeddings?.map((e) => e.values);
  if (!vecs || vecs.some((v) => !Array.isArray(v))) throw new Error("Gemini 임베딩 응답 파싱 실패");
  return vecs as number[][];
}
