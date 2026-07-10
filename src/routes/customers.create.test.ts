import { afterEach, expect, test } from "bun:test";
import { eq, isNotNull } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { profiles } from "../db/public-app";
import { customers } from "../db/schema";

const db = getDefaultDb();

// 성공 케이스는 실 INSERT를 만든다. 코드가 실채번(CU-YYMM-####)이라 접두사 registry로 못 잡는다 —
// 이름 "수기등록테스트"가 TEST_CUSTOMER_NAMES에 등록돼 있어(Task 1), 여기서 못 지우고 남아도
// 다음 test:server의 잔재 검사가 잡는다. 정상 경로는 afterEach가 지운다.
const FIXTURE_NAME = "수기등록테스트";
const createdIds: string[] = [];

afterEach(async () => {
  for (const id of createdIds.splice(0)) await db.delete(customers).where(eq(customers.id, id));
});

// 자동 배정 검증에는 full_name이 실제로 있는 profiles 행이 필요하다(실 master 전제 — CRM 스태프 계정 상존).
async function anyNamedProfile(): Promise<{ id: string; name: string }> {
  const rows = await db
    .select({ id: profiles.id, name: profiles.fullName })
    .from(profiles)
    .where(isNotNull(profiles.fullName))
    .limit(10);
  const hit = rows.find((r) => r.name?.trim());
  if (!hit) throw new Error("full_name 있는 profiles가 없어 테스트 불가(실 master DB 전제)");
  return { id: hit.id, name: hit.name!.trim() };
}

async function post(role: string, sub: string, body: unknown): Promise<Response> {
  const { token, keyResolver, issuer } = await makeTestAuth(role, sub);
  const app = createApp({ keyResolver, issuer });
  return app.request("/api/customers", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST /api/customers — dealer는 403 (fail-closed)", async () => {
  const res = await post("dealer", crypto.randomUUID(), { name: FIXTURE_NAME });
  expect(res.status).toBe(403);
});

test("POST /api/customers — 이름 공백은 400", async () => {
  const res = await post("staff", crypto.randomUUID(), { name: "   " });
  expect(res.status).toBe(400);
});

test("POST /api/customers — 자동 유입 어휘는 400 (앱 유입 통계 오염 차단)", async () => {
  const res = await post("staff", crypto.randomUUID(), { name: FIXTURE_NAME, source: "앱 견적요청" });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("유입 경로");
});

test("POST /api/customers — 성공: 채번·시드·등록자 자동 배정, 201", async () => {
  const advisor = await anyNamedProfile();
  const res = await post("staff", advisor.id, { name: FIXTURE_NAME, phone: "01098765432", source: "소개" });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; customerCode: string };
  createdIds.push(body.id);
  expect(body.customerCode).toMatch(/^CU-\d{4}-\d{4}$/);

  const [row] = await db.select().from(customers).where(eq(customers.id, body.id));
  expect(row.name).toBe(FIXTURE_NAME);
  expect(row.phone).toBe("01098765432");
  expect(row.source).toBe("소개");
  expect(row.statusGroup).toBe("신규");
  expect(row.status).toBe("상담접수");
  expect(row.receivedAt).not.toBeNull();
  expect(row.advisorId).toBe(advisor.id);
  expect(row.advisorName).toBe(advisor.name);
  expect(row.assignedAt).not.toBeNull();
});

test("POST /api/customers — 프로필 이름 해석 실패면 미배정으로 생성(fail-open)", async () => {
  const res = await post("staff", crypto.randomUUID(), { name: FIXTURE_NAME });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  createdIds.push(body.id);

  const [row] = await db.select().from(customers).where(eq(customers.id, body.id));
  expect(row.advisorId).toBeNull();
  expect(row.advisorName).toBeNull();
  expect(row.assignedAt).toBeNull();
});
