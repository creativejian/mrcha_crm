import { test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { customers, embeddings } from "../schema";
import { upsertEmbedding, searchEmbeddings, getEmbeddingHash, deleteEmbeddingBySource } from "./embeddings";

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

// 역할 scope(이사님 요구 07-06): {advisorId} = 본인 담당(customers.advisor_id) 고객의 청크만.
test("searchEmbeddings: scope={advisorId}면 담당 고객 청크만 — 남의 advisor는 제외", async () => {
  const OWNER = crypto.randomUUID();
  await db.update(customers).set({ advisorId: OWNER }).where(eq(customers.id, CUST));
  const own = await searchEmbeddings(vec(0.9), { advisorId: OWNER }, 5, db);
  expect(own.some((r) => r.customerId === CUST)).toBe(true);
  expect(own.every((r) => r.customerId === CUST)).toBe(true); // 담당 밖 고객 청크 유입 없음
  const other = await searchEmbeddings(vec(0.9), { advisorId: crypto.randomUUID() }, 5, db);
  expect(other.some((r) => r.customerId === CUST)).toBe(false);
  await db.update(customers).set({ advisorId: null }).where(eq(customers.id, CUST));
});

test("getEmbeddingHash: 있는 행은 해시, 없는 행은 null", async () => {
  const SRC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  await upsertEmbedding(
    { sourceType: "memo", sourceId: SRC, customerId: CUST, content: "해시 조회 테스트", contentHash: "hash-v1", embedding: vec(3) },
    db,
  );
  expect(await getEmbeddingHash("memo", SRC, db)).toBe("hash-v1");
  expect(await getEmbeddingHash("memo", "dddddddd-dddd-dddd-dddd-dddddddddddd", db)).toBeNull();
  expect(await getEmbeddingHash("task", SRC, db)).toBeNull(); // 같은 id라도 source_type이 다르면 별개
});

test("deleteEmbeddingBySource: 삭제 + 멱등(없어도 no-op)", async () => {
  // 자립 테스트: 앞선 테스트가 남긴 행에 의존하지 않고 직접 심는다(-t 단독 실행에서도 실제 삭제를 검증).
  const SRC = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  await upsertEmbedding(
    { sourceType: "memo", sourceId: SRC, customerId: CUST, content: "삭제 테스트", contentHash: "hash-del", embedding: vec(4) },
    db,
  );
  expect(await getEmbeddingHash("memo", SRC, db)).toBe("hash-del"); // 삭제 전 존재 확인
  await deleteEmbeddingBySource("task", SRC, db); // 다른 source_type 삭제는 이 행을 건드리지 않음
  expect(await getEmbeddingHash("memo", SRC, db)).toBe("hash-del");
  await deleteEmbeddingBySource("memo", SRC, db);
  expect(await getEmbeddingHash("memo", SRC, db)).toBeNull();
  await deleteEmbeddingBySource("memo", SRC, db); // 재호출도 throw 없음(멱등)
  expect(await getEmbeddingHash("memo", SRC, db)).toBeNull();
});
