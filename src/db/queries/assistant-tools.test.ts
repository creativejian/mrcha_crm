import { test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";

import { ASSISTANT_TOOL_KEYS } from "../../lib/assistant-tools";
import { getDefaultDb } from "../client";
import { customers, customerTasks } from "../schema";
import { runAssistantTool } from "./assistant-tools";

const db = getDefaultDb();
let CUST = "";
let TASK = "";
const OWNER = crypto.randomUUID(); // 담당 상담사(advisor_id — loose id라 profiles 행 불필요)
const OTHER = crypto.randomUUID(); // 남의 상담사

beforeAll(async () => {
  // 랜덤 서픽스 — 공유 master 재실행 트랩 방지(embed-sources.test.ts와 동일 규약).
  const [c] = await db.insert(customers).values({
    customerCode: `CU-AITOOL-${crypto.randomUUID().slice(0, 8)}`, name: "도구테스트", chance: "높음", statusGroup: "견적", status: "견적상담중", advisorId: OWNER,
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
    const r = await runAssistantTool(key, {}, "all", db);
    expect(typeof r.label).toBe("string");
    expect(Array.isArray(r.lines)).toBe(true);
    for (const line of r.lines) expect(typeof line).toBe("string");
  }
});

test("today_actions: 기한 오늘 미완료 할일이 고객명과 함께 잡힌다", async () => {
  const r = await runAssistantTool("today_actions", {}, "all", db);
  expect(r.lines.some((l) => l.includes("도구테스트") && l.includes("도구 스모크 할일") && l.includes("기한 오늘"))).toBe(true);
});

test("chance_ranking: chance 있는 고객만, 확정이 높음보다 앞", async () => {
  const r = await runAssistantTool("chance_ranking", {}, "all", db);
  expect(r.lines.some((l) => l.includes("도구테스트") && l.includes("높음"))).toBe(true);
  const firstJeong = r.lines.findIndex((l) => l.includes("확정"));
  const firstHigh = r.lines.findIndex((l) => l.includes("계약 가능성 높음"));
  if (firstJeong !== -1 && firstHigh !== -1) expect(firstJeong).toBeLessThan(firstHigh);
});

test("quote_ready: 진행 상태 견적 단계 고객이 사유와 함께 잡힌다", async () => {
  const r = await runAssistantTool("quote_ready", {}, "all", db);
  expect(r.lines.some((l) => l.includes("도구테스트") && l.includes("견적 단계"))).toBe(true);
});

test("stale_customers: 방금 만든 고객(활동 0일)은 미포함", async () => {
  const r = await runAssistantTool("stale_customers", {}, "all", db);
  expect(r.lines.some((l) => l.includes("도구테스트"))).toBe(false);
});

test("search_customers: 상담경로 부분 일치('앱') + 이름 필터, 미지 파라미터 무시", async () => {
  const bySource = await runAssistantTool("search_customers", { source: "테스트경로없음" }, "all", db);
  expect(bySource.lines).toHaveLength(0); // 없는 경로 → 0건(라벨에 필터 병기)
  expect(bySource.label).toContain("상담경로 테스트경로없음");
  const byName = await runAssistantTool("search_customers", { name: "도구테스트", junk: 123 }, "all", db);
  expect(byName.lines.some((l) => l.includes("도구테스트") && l.includes("진행 견적"))).toBe(true);
});

// 역할 scope(이사님 요구 07-06): 상담사는 본인 담당(advisor_id) 고객만 — 도구 6종 공통 필터.
test("scope {advisorId}: 본인 담당 고객만 — 남의 scope에는 0건", async () => {
  for (const key of ["today_actions", "chance_ranking", "quote_ready"] as const) {
    const own = await runAssistantTool(key, {}, { advisorId: OWNER }, db);
    expect(own.lines.some((l) => l.includes("도구테스트"))).toBe(true);
    const other = await runAssistantTool(key, {}, { advisorId: OTHER }, db);
    expect(other.lines.some((l) => l.includes("도구테스트"))).toBe(false);
  }
  const bySearch = await runAssistantTool("search_customers", { name: "도구테스트" }, { advisorId: OTHER }, db);
  expect(bySearch.lines).toHaveLength(0);
});
