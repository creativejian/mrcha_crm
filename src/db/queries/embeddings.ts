import { and, eq, sql } from "drizzle-orm";

import { EMBEDDING_DIM } from "../../lib/gemini-embed";
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

// 질문 벡터로 top-k 코사인 검색. scope="all"=전체, string[]=허용 customer_id(빈 배열=결과 없음),
// {advisorId}=본인 담당 고객만(crm.customers.advisor_id 매칭 — 역할 scope, resolveCustomerScope 참조).
// halfvec 캐스팅으로 HNSW 인덱스를 태운다(앱 관례와 동일). 코사인 유사도 = 1 - 거리.
export async function searchEmbeddings(
  queryVec: number[],
  scope: "all" | string[] | { advisorId: string },
  k: number,
  executor: Executor = getDefaultDb(),
): Promise<SearchHit[]> {
  if (Array.isArray(scope) && scope.length === 0) return [];
  const vecLiteral = `[${queryVec.join(",")}]`;
  const halfvec = sql.raw(`halfvec(${EMBEDDING_DIM})`); // HNSW 인덱스 식과 동일 차원 — EMBEDDING_DIM 단일 소스
  const scopeFilter =
    scope === "all" ? sql``
    : Array.isArray(scope) ? sql`where customer_id = any(${sql`array[${sql.join(scope.map((id) => sql`${id}::uuid`), sql`, `)}]`})`
    : sql`where customer_id in (select c.id from crm.customers c where c.advisor_id = ${scope.advisorId}::uuid)`;
  const rows = await executor.execute(sql`
    select id, source_type as "sourceType", source_id as "sourceId", customer_id as "customerId", content,
           1 - (embedding::${halfvec} <=> ${vecLiteral}::${halfvec}) as similarity
    from crm.embeddings
    ${scopeFilter}
    order by embedding::${halfvec} <=> ${vecLiteral}::${halfvec}
    limit ${k}
  `);
  // raw SQL 결과는 단언하지 않고 행 단위로 좁힌다 — alias가 바뀌면 NaN/"undefined"로 즉시 드러난다.
  return [...(rows as Iterable<Record<string, unknown>>)].map((r): SearchHit => ({
    id: String(r.id),
    sourceType: String(r.sourceType),
    sourceId: String(r.sourceId),
    customerId: String(r.customerId),
    content: String(r.content),
    similarity: Number(r.similarity),
  }));
}

// hash skip용: 기존 임베딩 행의 content_hash 조회. 행 없으면 null(→ 신규 임베딩).
export async function getEmbeddingHash(
  sourceType: string,
  sourceId: string,
  executor: Executor = getDefaultDb(),
): Promise<string | null> {
  const rows = await executor
    .select({ contentHash: embeddings.contentHash })
    .from(embeddings)
    .where(and(eq(embeddings.sourceType, sourceType), eq(embeddings.sourceId, sourceId)));
  return rows[0]?.contentHash ?? null;
}

// 원본 삭제/텍스트 비움 시 임베딩 행 제거. 멱등 — 행이 없어도 no-op(미발송 견적 삭제 등).
export async function deleteEmbeddingBySource(
  sourceType: string,
  sourceId: string,
  executor: Executor = getDefaultDb(),
): Promise<void> {
  await executor.delete(embeddings).where(and(eq(embeddings.sourceType, sourceType), eq(embeddings.sourceId, sourceId)));
}
