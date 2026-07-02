import { test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { customers, embeddings } from "../schema";
import { upsertEmbedding, searchEmbeddings } from "./embeddings";

const db = getDefaultDb();
const MEMO_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const vec = (seed: number) => Array.from({ length: 3072 }, (_, i) => (i === 0 ? seed : 0.001));
let CUST = "";

beforeAll(async () => {
  const [row] = await db.insert(customers).values({ customerCode: "CU-EMBTEST-9990", name: "임베딩테스트" }).returning({ id: customers.id });
  CUST = row.id;
});
afterAll(async () => {
  // 고객 삭제 → embeddings는 FK cascade로 함께 삭제.
  await db.delete(customers).where(eq(customers.id, CUST));
});

test("upsertEmbedding: 삽입 후 동일 (source_type,source_id) 재upsert=갱신(중복 없음)", async () => {
  await upsertEmbedding({ sourceType: "memo", sourceId: MEMO_ID, customerId: CUST, content: "첫 내용", contentHash: "h1", embedding: vec(0.9) }, db);
  await upsertEmbedding({ sourceType: "memo", sourceId: MEMO_ID, customerId: CUST, content: "수정 내용", contentHash: "h2", embedding: vec(0.9) }, db);
  const rows = await db.select().from(embeddings).where(eq(embeddings.customerId, CUST));
  expect(rows).toHaveLength(1);
  expect(rows[0].content).toBe("수정 내용");
});

test("searchEmbeddings: scope=all 이면 유사도순 top-k에 방금 넣은 행 포함", async () => {
  const res = await searchEmbeddings(vec(0.9), "all", 5, db);
  expect(res.some((r) => r.customerId === CUST)).toBe(true);
  expect(typeof res[0].similarity).toBe("number");
});

test("searchEmbeddings: scope=빈 배열이면 결과 없음", async () => {
  const res = await searchEmbeddings(vec(0.9), [], 5, db);
  expect(res).toHaveLength(0);
});
