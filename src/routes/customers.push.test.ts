import { test, expect, afterEach } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { customers } from "../db/schema";
import { pushNotifyDeps } from "../lib/push-notify";

const ORIGINAL_FETCH = pushNotifyDeps.fetchImpl;
const createdCustomerIds: string[] = [];

afterEach(async () => {
  pushNotifyDeps.fetchImpl = ORIGINAL_FETCH;
  const db = getDefaultDb();
  for (const id of createdCustomerIds.splice(0)) {
    await db.delete(customers).where(eq(customers.id, id));
  }
});

// send-push 호출 가로채 payload 기록. holdWork(비차단)라 응답 후 settle을 기다리기 위해 resolve를 노출한다.
function mockPush() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let resolveNext: (() => void) | null = null;
  pushNotifyDeps.fetchImpl = (async (url: string | URL, init?: { body?: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
    resolveNext?.();
    return new Response(JSON.stringify({ message: "no tokens", sent: 0 }), { status: 200 });
  }) as unknown as typeof fetch;
  const waitForCall = () => new Promise<void>((r) => { resolveNext = r; });
  return { calls, waitForCall };
}

async function makeCustomer(fields: Partial<typeof customers.$inferInsert> = {}): Promise<string> {
  const db = getDefaultDb();
  const [row] = await db
    .insert(customers)
    .values({ customerCode: `PUSH-TEST-${crypto.randomUUID().slice(0, 12)}`, name: "푸시테스트고객", ...fields })
    .returning({ id: customers.id });
  createdCustomerIds.push(row.id);
  return row.id;
}

test("배정(대상≠배정자) → send-push 1건, payload {user_id,title,body}", async () => {
  const managerSub = crypto.randomUUID();
  const targetAdvisor = crypto.randomUUID();
  const { token, keyResolver, issuer } = await makeTestAuth("manager", managerSub);
  const app = createApp({ keyResolver, issuer });
  const { calls, waitForCall } = mockPush();
  const cid = await makeCustomer({ name: "김배정" });
  const settled = waitForCall();

  const res = await app.request(`/api/customers/${cid}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ advisorName: "강현준", advisorId: targetAdvisor }),
  });
  expect(res.status).toBe(200);
  await settled;

  expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain("/functions/v1/send-push");
  expect(calls[0].body).toEqual({ user_id: targetAdvisor, title: "담당 고객으로 배정되었습니다", body: "김배정" });
});

test("자기 배정(대상=배정자) → 알림 미호출 · 단 배정 저장은 정상", async () => {
  const managerSub = crypto.randomUUID();
  const { token, keyResolver, issuer } = await makeTestAuth("manager", managerSub);
  const app = createApp({ keyResolver, issuer });
  const { calls } = mockPush();
  const cid = await makeCustomer();

  const res = await app.request(`/api/customers/${cid}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ advisorName: "본인관리자", advisorId: managerSub }),
  });
  expect(res.status).toBe(200);
  const [saved] = await getDefaultDb().select({ advisorId: customers.advisorId }).from(customers).where(eq(customers.id, cid));
  expect(saved.advisorId).toBe(managerSub);
  expect(calls).toHaveLength(0);
});

test("담당자 미변경(동일 이름 재저장) → 미호출", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("manager", crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  const { calls } = mockPush();
  const cid = await makeCustomer({ advisorName: "강현준", advisorId: crypto.randomUUID() });

  const res = await app.request(`/api/customers/${cid}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ advisorName: "강현준", advisorId: crypto.randomUUID(), team: "인천본사" }),
  });
  expect(res.status).toBe(200);
  expect(calls).toHaveLength(0);
});

test("배정 해제(advisorName null) → 미호출", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("manager", crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  const { calls } = mockPush();
  const cid = await makeCustomer({ advisorName: "강현준", advisorId: crypto.randomUUID() });

  const res = await app.request(`/api/customers/${cid}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ advisorName: null }),
  });
  expect(res.status).toBe(200);
  expect(calls).toHaveLength(0);
});
