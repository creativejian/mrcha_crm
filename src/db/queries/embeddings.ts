import { sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { embeddings } from "../schema";

export type UpsertEmbeddingInput = {
  sourceType: string;
  sourceId: string;
  customerId: string;
  content: string;
  contentHash: string;
  embedding: number[];
};

// (source_type, source_id) 유니크 기준 upsert. 재백필 멱등.
export async function upsertEmbedding(input: UpsertEmbeddingInput, executor: Executor = getDefaultDb()): Promise<void> {
  await executor
    .insert(embeddings)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [embeddings.sourceType, embeddings.sourceId],
      set: { content: input.content, contentHash: input.contentHash, embedding: input.embedding, customerId: input.customerId, updatedAt: new Date() },
    });
}

export type SearchHit = {
  id: string;
  sourceType: string;
  sourceId: string;
  customerId: string;
  content: string;
  similarity: number;
};

// 질문 벡터로 top-k 코사인 검색. scope="all"=전체, string[]=허용 customer_id(빈 배열=결과 없음).
// halfvec 캐스팅으로 HNSW 인덱스를 태운다(앱 관례와 동일). 코사인 유사도 = 1 - 거리.
export async function searchEmbeddings(
  queryVec: number[],
  scope: "all" | string[],
  k: number,
  executor: Executor = getDefaultDb(),
): Promise<SearchHit[]> {
  if (Array.isArray(scope) && scope.length === 0) return [];
  const vecLiteral = `[${queryVec.join(",")}]`;
  const scopeFilter =
    scope === "all" ? sql`` : sql`where customer_id = any(${sql`array[${sql.join(scope.map((id) => sql`${id}::uuid`), sql`, `)}]`})`;
  const rows = await executor.execute(sql`
    select id, source_type as "sourceType", source_id as "sourceId", customer_id as "customerId", content,
           1 - (embedding::halfvec(3072) <=> ${vecLiteral}::halfvec(3072)) as similarity
    from crm.embeddings
    ${scopeFilter}
    order by embedding::halfvec(3072) <=> ${vecLiteral}::halfvec(3072)
    limit ${k}
  `);
  return rows as unknown as SearchHit[];
}
