import { test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { customerMemos, customerTasks, customers, quotes } from "../schema";
import { loadAiHintSource, setCustomerAiHint } from "./ai-hint-sources";

const db = getDefaultDb();
const SUFFIX = crypto.randomUUID().slice(0, 8);
let CUST = "";

beforeAll(async () => {
  // 랜덤 서픽스 — 공유 master 재실행 트랩 방지(afterAll 실패 시 unique 위반 연쇄 방지).
  const [c] = await db.insert(customers).values({
    customerCode: `CU-AIHINT-${SUFFIX}`,
    name: "AI힌트소스테스트",
    statusGroup: "견적", status: "발송완료", chance: "높음", priority: "긴급",
    residence: "인천광역시 남동구", needModel: "X3",
    aiSummary: "이전 힌트", aiSummarySourceHash: "old-hash",
  }).returning({ id: customers.id });
  CUST = c.id;
  // 메모 4건(최근 3만 실려야 함) — createdAt 명시로 순서 결정화.
  for (let i = 0; i < 4; i++) {
    await db.insert(customerMemos).values({
      customerId: CUST, body: `메모${i}`, createdAt: new Date(Date.UTC(2026, 6, 1 + i)),
    });
  }
  // category는 닫힌 6종(TASK_CATEGORY_OPTIONS) CHECK 제약 — "급함/오늘"은 due 쪽 표시 라벨이지 category 값이 아니다.
  await db.insert(customerTasks).values([
    { customerId: CUST, category: "체크", due: "오늘", body: "미완료 할일", done: false },
    { customerId: CUST, category: "견적", due: "오늘", body: "완료된 할일", done: true },
  ]);
  await db.insert(quotes).values({
    customerId: CUST, quoteCode: `QT-AIHINT-${SUFFIX}`,
    modelName: "X3", trimName: "xDrive20i", appStatus: "sent",
  });
});

afterAll(async () => {
  await db.delete(quotes).where(eq(quotes.customerId, CUST)); // FK cascade 없음 — 견적 먼저
  await db.delete(customers).where(eq(customers.id, CUST));   // 메모·할일은 cascade
});

test("loadAiHintSource: 프로필 텍스트·최근 메모 3(최신순)·미완료 할일만·최신 견적·기존 hash", async () => {
  const src = await loadAiHintSource(CUST, db);
  expect(src).not.toBeNull();
  expect(src?.name).toBe("AI힌트소스테스트");
  expect(src?.profileText).toContain("거주지 인천광역시 남동구");
  expect(src?.profileText).toContain("관심 차종 X3");
  expect(src?.memos.map((m) => m.body)).toEqual(["메모3", "메모2", "메모1"]);
  expect(src?.tasks).toEqual([{ category: "체크", due: "오늘", body: "미완료 할일" }]);
  expect(src?.quote).toEqual({ modelName: "X3", trimName: "xDrive20i", appStatus: "sent" });
  expect(src?.consultationNote).toBeNull(); // app_user_id 없음 — 상담 조회 자체를 안 탄다
  expect(src?.aiSummary).toBe("이전 힌트");
  expect(src?.sourceHash).toBe("old-hash");
});

test("loadAiHintSource: 없는 고객 → null", async () => {
  expect(await loadAiHintSource(crypto.randomUUID(), db)).toBeNull();
});

test("setCustomerAiHint: ai_summary·hash 왕복 + null 클리어", async () => {
  await setCustomerAiHint(CUST, { aiSummary: "**새** 힌트", sourceHash: "h2" }, db);
  let src = await loadAiHintSource(CUST, db);
  expect(src?.aiSummary).toBe("**새** 힌트");
  expect(src?.sourceHash).toBe("h2");
  await setCustomerAiHint(CUST, { aiSummary: null, sourceHash: null }, db);
  src = await loadAiHintSource(CUST, db);
  expect(src?.aiSummary).toBeNull();
  expect(src?.sourceHash).toBeNull();
});
