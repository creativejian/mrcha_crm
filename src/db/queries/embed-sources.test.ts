import { test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { customerMemos, customers, quotes, quoteScenarios } from "../schema";
import { loadCorpusSource } from "./embed-sources";

const db = getDefaultDb();
// 랜덤 서픽스 — 공유 master 재실행 트랩 방지(afterAll 실패/강제 종료로 고아 행이 남아도 다음 실행이 unique 위반으로 연쇄 실패하지 않게).
const QUOTE_CODE = `QT-EMBSRC-${crypto.randomUUID().slice(0, 8)}`;
let CUST = "";
let MEMO = "";
let QUOTE = "";

beforeAll(async () => {
  const [c] = await db.insert(customers).values({
    customerCode: `CU-EMBSRC-${crypto.randomUUID().slice(0, 8)}`, name: "로더테스트", needMemo: "니즈 로더 검증", needCustomerNote: "  ",
  }).returning({ id: customers.id });
  CUST = c.id;
  const [m] = await db.insert(customerMemos).values({ customerId: CUST, body: "메모 로더 검증" }).returning({ id: customerMemos.id });
  MEMO = m.id;
  const [q] = await db.insert(quotes).values({
    quoteCode: QUOTE_CODE, customerId: CUST, brandName: "BMW", modelName: "320i", trimName: "320i M Sport", appStatus: "draft", revision: 0,
  }).returning({ id: quotes.id });
  QUOTE = q.id;
  const [s] = await db.insert(quoteScenarios).values({
    quoteId: QUOTE, scenarioNo: 1, purchaseMethod: "운용리스", termMonths: 60, monthlyPayment: "2350000", lender: "하나캐피탈",
  }).returning({ id: quoteScenarios.id });
  await db.update(quotes).set({ primaryScenarioId: s.id }).where(eq(quotes.id, QUOTE));
});

afterAll(async () => {
  await db.delete(quotes).where(eq(quotes.id, QUOTE)); // 시나리오는 FK cascade
  await db.delete(customers).where(eq(customers.id, CUST)); // 메모는 FK cascade
});

test("loadCorpusSource(memo): 본문+고객명, 없는 id는 null", async () => {
  const snap = await loadCorpusSource("memo", MEMO, db);
  expect(snap).toEqual({ customerId: CUST, customerName: "로더테스트", text: "메모 로더 검증" });
  expect(await loadCorpusSource("memo", "00000000-0000-0000-0000-000000000000", db)).toBeNull();
});

test("loadCorpusSource(need_*): 필드 선택 — 공백뿐 필드는 그대로 반환(빈 판정은 호출부)", async () => {
  const memo = await loadCorpusSource("need_memo", CUST, db);
  expect(memo?.text).toBe("니즈 로더 검증");
  const note = await loadCorpusSource("need_customer_note", CUST, db);
  expect(note?.text).toBe("  "); // trim 판정은 runEmbedJob 책임
  const review = await loadCorpusSource("need_review_note", CUST, db);
  expect(review?.text).toBe(""); // null 필드는 빈 문자열
});

test("loadCorpusSource(quote): 대표 시나리오 기준 청크 텍스트", async () => {
  const snap = await loadCorpusSource("quote", QUOTE, db);
  expect(snap?.customerName).toBe("로더테스트");
  expect(snap?.text).toBe(`${QUOTE_CODE} · BMW 320i M Sport · 운용리스 · 60개월 · 월 2,350,000원 · 하나캐피탈 · 작성 중`);
});
