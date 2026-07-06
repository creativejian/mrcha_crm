import { test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";

import { ASSISTANT_TOOL_KEYS } from "../../lib/assistant-tools";
import { getDefaultDb } from "../client";
import { customers, customerTasks } from "../schema";
import { runAssistantTool } from "./assistant-tools";

const db = getDefaultDb();
let CUST = "";
let TASK = "";

beforeAll(async () => {
  // 랜덤 서픽스 — 공유 master 재실행 트랩 방지(embed-sources.test.ts와 동일 규약).
  const [c] = await db.insert(customers).values({
    customerCode: `CU-AITOOL-${crypto.randomUUID().slice(0, 8)}`, name: "도구테스트", chance: "높음", statusGroup: "견적", status: "견적상담중",
  }).returning({ id: customers.id });
  CUST = c.id;
  const [t] = await db.insert(customerTasks).values({ customerId: CUST, body: "도구 스모크 할일", due: "오늘", done: false }).returning({ id: customerTasks.id });
  TASK = t.id;
});

afterAll(async () => {
  await db.delete(customerTasks).where(eq(customerTasks.id, TASK));
  await db.delete(customers).where(eq(customers.id, CUST));
});

test("runAssistantTool: 5종 전부 throw 없이 {label, lines[]} 반환(실 DB 스모크)", async () => {
  for (const key of ASSISTANT_TOOL_KEYS) {
    const r = await runAssistantTool(key, db);
    expect(typeof r.label).toBe("string");
    expect(Array.isArray(r.lines)).toBe(true);
    for (const line of r.lines) expect(typeof line).toBe("string");
  }
});

test("today_actions: 기한 오늘 미완료 할일이 고객명과 함께 잡힌다", async () => {
  const r = await runAssistantTool("today_actions", db);
  expect(r.lines.some((l) => l.includes("도구테스트") && l.includes("도구 스모크 할일") && l.includes("기한 오늘"))).toBe(true);
});

test("chance_ranking: chance 있는 고객만, 확정이 높음보다 앞", async () => {
  const r = await runAssistantTool("chance_ranking", db);
  expect(r.lines.some((l) => l.includes("도구테스트") && l.includes("높음"))).toBe(true);
  const firstJeong = r.lines.findIndex((l) => l.includes("확정"));
  const firstHigh = r.lines.findIndex((l) => l.includes("계약 가능성 높음"));
  if (firstJeong !== -1 && firstHigh !== -1) expect(firstJeong).toBeLessThan(firstHigh);
});

test("quote_ready: 진행 상태 견적 단계 고객이 사유와 함께 잡힌다", async () => {
  const r = await runAssistantTool("quote_ready", db);
  expect(r.lines.some((l) => l.includes("도구테스트") && l.includes("견적 단계"))).toBe(true);
});

test("stale_customers: 방금 만든 고객(활동 0일)은 미포함", async () => {
  const r = await runAssistantTool("stale_customers", db);
  expect(r.lines.some((l) => l.includes("도구테스트"))).toBe(false);
});
