import { geminiPost } from "./gemini-post";
import type { GeminiTarget } from "./gemini-target";

// 2026-07-22: gemini-embedding-001 → gemini-embedding-2 이관(001은 shutdown 예정).
// ⚠️ 두 모델의 임베딩 공간은 **호환되지 않는다**. 같은 문장을 각각 임베딩해 코사인을 재보면 **0.03**
// (거의 직교 — 실측). 섞이면 유사도가 무작위 수준이 되어 SIMILARITY_THRESHOLD(0.75)에 아무것도 안 걸린다.
// 그래서 모델 교체는 **전량 재임베딩과 원자적으로** 가야 한다 — contentHash가 모델명을 포함하는 이유
// (assistant-corpus.ts). 모델 상수를 바꾸면 전 코퍼스 해시가 달라져 백필이 자동으로 전량 재생성한다.
export const EMBEDDING_MODEL = "gemini-embedding-2";
export const EMBEDDING_DIM = 3072; // gemini-embedding-2 네이티브 차원(001과 동일) — schema vector(N)·halfvec 캐스트·테스트 픽스처가 공유. output_dimensionality 미지정.
const MAX_EMBED_BATCH = 100; // Gemini batchEmbedContents 요청당 상한 — 초과분은 배치로 쪼갠다

// texts 각각을 3072차원 벡터로. 100개 초과는 배치로 쪼개 순서 보존해 합친다(백필 코퍼스 성장 대비).
// 실패(재시도 후에도)는 throw. 빈 입력은 호출 없이 [].
// ⚠️ taskType 파라미터는 두지 않는다 — gemini-embedding-2는 그 필드를 **조용히 무시**한다(에러도 없음).
// 실측: 같은 문장을 RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY / 생략으로 각각 임베딩하면 코사인이 정확히 1.0.
// (001은 0.911로 실제 구분했다.) 죽은 파라미터를 남기면 "검색 의도가 반영된다"는 오해를 부른다.
export async function embedTexts(
  texts: string[],
  target: GeminiTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += MAX_EMBED_BATCH) {
    vectors.push(...(await embedBatch(texts.slice(start, start + MAX_EMBED_BATCH), target, fetchImpl)));
  }
  return vectors;
}

async function embedBatch(
  texts: string[],
  target: GeminiTarget,
  fetchImpl: typeof fetch,
): Promise<number[][]> {
  const url = `${target.baseUrl}/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`;
  const body = JSON.stringify({
    requests: texts.map((text) => ({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
    })),
  });

  const res = await geminiPost(url, body, target, { label: "embed", errorPrefix: "Gemini 임베딩 실패", fetchImpl });
  const data = (await res.json()) as { embeddings?: { values?: number[] }[] };
  const vecs = data.embeddings?.map((e) => e.values);
  if (!vecs || vecs.some((v) => !Array.isArray(v))) throw new Error("Gemini 임베딩 응답 파싱 실패");
  // 요청 수 ≠ 응답 수면 호출부의 인덱스 매핑(embedTexts의 순서 보존·백필의 pendingIdx)이 통째로 어긋난다.
  // gemini-embedding-2는 입력이 길어도 내부 집계로 요청당 1벡터를 준다(2026-07-22 실측: 26,101토큰 장문도
  // embeddings 1건). 그 계약이 깨지는 날 조용히 틀린 벡터를 저장하느니 여기서 멈춘다.
  if (vecs.length !== texts.length) {
    throw new Error(`Gemini 임베딩 개수 불일치: 요청 ${texts.length} ≠ 응답 ${vecs.length}`);
  }
  return vecs as number[][];
}
