import { test, expect, beforeAll, afterAll } from "bun:test";
import { and, eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { customers, embeddings, quotes } from "../db/schema";
import { EMBEDDING_DIM } from "../lib/gemini-embed";
import { embedOnWriteDeps } from "../lib/embed-on-write";

const db = getDefaultDb();
const ORIGINAL_EMBED = embedOnWriteDeps.embedTexts;
const SAVED_FLAG = process.env.EMBED_ON_WRITE;
let CUST = "";
let embedCalls = 0;
let auth: Awaited<ReturnType<typeof makeTestAuth>>;

beforeAll(async () => {
  // 게이트 개방(test:server 기본 off) + embedTexts만 fake(고정 벡터·실 Gemini 차단). DB deps는 실물 —
  // crm.embeddings 실 왕복까지 검증하는 통합 테스트다.
  process.env.EMBED_ON_WRITE = "on";
  embedOnWriteDeps.embedTexts = async (texts) => { embedCalls++; return texts.map(() => Array.from({ length: EMBEDDING_DIM }, () => 0.01)); };
  auth = await makeTestAuth("admin");
  const [c] = await db.insert(customers).values({ customerCode: "CU-EMBRT-9992", name: "배선테스트" }).returning({ id: customers.id });
  CUST = c.id;
});

afterAll(async () => {
  embedOnWriteDeps.embedTexts = ORIGINAL_EMBED;
  if (SAVED_FLAG !== undefined) process.env.EMBED_ON_WRITE = SAVED_FLAG; else delete process.env.EMBED_ON_WRITE;
  await db.delete(quotes).where(eq(quotes.customerId, CUST)); // customers FK에 cascade 없음 — 견적 먼저
  await db.delete(customers).where(eq(customers.id, CUST)); // 메모·임베딩은 FK cascade
});

// 훅은 응답 후 비동기 — 조건 충족까지 폴링(최대 timeoutMs).
async function until(cond: () => Promise<boolean> | boolean, timeoutMs = 3000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - t0 > timeoutMs) throw new Error("until: 조건 미충족 타임아웃");
    await Bun.sleep(25);
  }
}

async function embeddingRow(sourceType: string, sourceId: string) {
  const rows = await db
    .select({ content: embeddings.content, customerId: embeddings.customerId })
    .from(embeddings)
    .where(and(eq(embeddings.sourceType, sourceType), eq(embeddings.sourceId, sourceId)));
  return rows[0] ?? null;
}

test("메모 POST → 임베딩 행 생성(비동기), 동일 내용 재저장은 hash skip", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  const res = await app.request(`/api/customers/${CUST}/memos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "임베딩 배선 검증 메모" }),
  });
  expect(res.status).toBe(201);
  const memo = (await res.json()) as { id: string };

  await until(async () => (await embeddingRow("memo", memo.id)) != null);
  const row = await embeddingRow("memo", memo.id);
  expect(row?.content).toBe("고객 배선테스트 상담메모: 임베딩 배선 검증 메모");
  expect(row?.customerId).toBe(CUST);
  const callsAfterInsert = embedCalls;

  // 동일 본문 PATCH → fresh read 콘텐츠 불변 → hash skip(Gemini 미호출)
  const patch = await app.request(`/api/customers/${CUST}/memos/${memo.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "임베딩 배선 검증 메모" }),
  });
  expect(patch.status).toBe(200);
  await Bun.sleep(300); // 훅이 돌 시간 — skip이면 호출 수 불변
  expect(embedCalls).toBe(callsAfterInsert);

  // DELETE → 임베딩 행 동기 제거
  const del = await app.request(`/api/customers/${CUST}/memos/${memo.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(del.status).toBe(200);
  expect(await embeddingRow("memo", memo.id)).toBeNull(); // 폴링 불필요 — 삭제는 동기(스펙 결정 6)
});

test("니즈 필드 PATCH → need_memo 임베딩, 비우면 행 삭제", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  const res = await app.request(`/api/customers/${CUST}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ needMemo: "GLC 재고 확인 필요" }),
  });
  expect(res.status).toBe(200);
  await until(async () => (await embeddingRow("need_memo", CUST)) != null);
  expect((await embeddingRow("need_memo", CUST))?.content).toBe("고객 배선테스트 니즈메모: GLC 재고 확인 필요");

  const clear = await app.request(`/api/customers/${CUST}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ needMemo: "" }),
  });
  expect(clear.status).toBe(200);
  await until(async () => (await embeddingRow("need_memo", CUST)) == null); // 빈 텍스트 → 훅이 행 삭제
});

test("견적 POST(트랜잭션) → quote 임베딩, DELETE → 동기 제거", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  const res = await app.request(`/api/customers/${CUST}/quotes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ brandName: "BMW", modelName: "320i", trimName: "320i M Sport", scenario: { purchaseMethod: "운용리스", termMonths: 60, monthlyPayment: "2350000", lender: "하나캐피탈" } }),
  });
  expect(res.status).toBe(201);
  const quote = (await res.json()) as { id: string; quoteCode: string };

  await until(async () => (await embeddingRow("quote", quote.id)) != null);
  const row = await embeddingRow("quote", quote.id);
  expect(row?.content).toContain(quote.quoteCode);
  expect(row?.content).toContain("BMW 320i M Sport");
  expect(row?.content).toContain("운용리스");

  const del = await app.request(`/api/customers/${CUST}/quotes/${quote.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(del.status).toBe(200);
  expect(await embeddingRow("quote", quote.id)).toBeNull();
});

test("404 경로는 스케줄 안 함 — 없는 메모 PATCH에 임베딩 호출 0", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  const before = embedCalls;
  const res = await app.request(`/api/customers/${CUST}/memos/00000000-0000-0000-0000-000000000000`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "유령" }),
  });
  expect(res.status).toBe(404);
  await Bun.sleep(200);
  expect(embedCalls).toBe(before);
});
