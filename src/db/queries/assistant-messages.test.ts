import { test, expect, afterAll } from "bun:test";
import { eq } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { assistantMessages } from "../schema";
import { insertAssistantMessages, listRecentMessages } from "./assistant-messages";

const db = getDefaultDb();
const STAFF = "cccccccc-cccc-cccc-cccc-cccccccccccc";

afterAll(async () => { await db.delete(assistantMessages).where(eq(assistantMessages.staffUserId, STAFF)); });

test("insertAssistantMessages: user+assistant 원자 저장, createdAt 순서 보존", async () => {
  const now = new Date();
  const saved = await insertAssistantMessages([
    { staffUserId: STAFF, role: "user", content: "질문1", sources: null, createdAt: now },
    { staffUserId: STAFF, role: "assistant", content: "답1", sources: [{ customerId: "x" }], createdAt: new Date(now.getTime() + 1) },
  ], db);
  expect(saved).toHaveLength(2);
});

test("listRecentMessages: 최근 N개 created_at 오름차순 반환", async () => {
  const rows = await listRecentMessages(STAFF, 10, db);
  expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
  expect(rows[0].content).toBe("질문1");
  expect(rows[1].content).toBe("답1");
});

test("listRecentMessages: limit 초과분은 최신 우선으로 잘림", async () => {
  const base = new Date();
  await insertAssistantMessages(
    Array.from({ length: 4 }, (_, i) => ({ staffUserId: STAFF, role: "user" as const, content: `m${i}`, sources: null, createdAt: new Date(base.getTime() + 100 + i) })),
    db,
  );
  const rows = await listRecentMessages(STAFF, 2, db);
  expect(rows).toHaveLength(2);
  expect(rows[1].content).toBe("m3"); // 가장 최신이 마지막
});

test("listRecentMessages: before 커서로 더 오래된 페이지 로드(중복/누락 없음)", async () => {
  const S = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const base = new Date();
  await insertAssistantMessages(
    Array.from({ length: 5 }, (_, i) => ({ staffUserId: S, role: "user" as const, content: `p${i}`, sources: null, createdAt: new Date(base.getTime() + i) })),
    db,
  );
  const page1 = await listRecentMessages(S, 2, db); // 최신 2개(p3,p4) 오름차순
  expect(page1.map((r) => r.content)).toEqual(["p3", "p4"]);
  const oldestOfPage1 = page1[0]; // p3
  const page2 = await listRecentMessages(S, 2, db, { createdAt: oldestOfPage1.createdAt, id: oldestOfPage1.id }); // p3보다 오래된 2개(p1,p2)
  expect(page2.map((r) => r.content)).toEqual(["p1", "p2"]);
  await db.delete(assistantMessages).where(eq(assistantMessages.staffUserId, S));
});
