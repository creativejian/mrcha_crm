import { test, expect, afterEach, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { profiles, quoteRequests } from "../db/public-app";
import { customers, quotes } from "../db/schema";
import { pushNotifyDeps } from "../lib/push-notify";

// 이 스위트는 CRM 푸시 발송을 실제로 검증하므로 게이트를 명시적으로 연다(NODE_ENV=test 기본 off를 override).
// 게이트를 열어도 아래 fetchImpl mock이 실 prod send-push 대신 가로챈다 — 실호출 없이 발송 경로만 검증.
const ORIGINAL_PUSH_NOTIFY = process.env.PUSH_NOTIFY;
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
beforeAll(() => {
  process.env.PUSH_NOTIFY = "on";
  // sendAssignmentPush가 URL 조립 전에 skip하지 않도록 테스트 전용 base를 고정한다.
  // 모든 발송 경로는 아래 fetchImpl mock이 가로채므로 네트워크 실호출은 없다.
  process.env.SUPABASE_URL = "https://push.test";
});
afterAll(() => {
  if (ORIGINAL_PUSH_NOTIFY === undefined) delete process.env.PUSH_NOTIFY;
  else process.env.PUSH_NOTIFY = ORIGINAL_PUSH_NOTIFY;
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
});

const ORIGINAL_FETCH = pushNotifyDeps.fetchImpl;
const createdCustomerIds: string[] = [];
const createdQuoteIds: string[] = [];
const createdQuoteRequestIds: string[] = [];

afterEach(async () => {
  pushNotifyDeps.fetchImpl = ORIGINAL_FETCH;
  const db = getDefaultDb();
  for (const id of createdQuoteIds.splice(0)) {
    await db.delete(quotes).where(eq(quotes.id, id));
  }
  for (const id of createdQuoteRequestIds.splice(0)) {
    await db.delete(quoteRequests).where(eq(quoteRequests.id, id));
  }
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

async function linkedPair(): Promise<{ customerId: string; userId: string }> {
  const rows = await getDefaultDb()
    .select({ userId: profiles.id })
    .from(profiles)
    .where(eq(profiles.fullName, "상담사테스트"))
    .limit(2);
  if (rows.length !== 1) {
    throw new Error(`전용 상담사테스트 profile이 정확히 1개여야 함(현재 ${rows.length}개)`);
  }
  const customerId = await makeCustomer({
    appUserId: rows[0].userId,
    name: "발송준비라우트테스트",
  });
  return { customerId, userId: rows[0].userId };
}

test("작성 완료 저장 성공 → ready_for_send_at 최초 전이와 사건 tag 푸시가 정확히 1회 발생한다", async () => {
  const { customerId, userId } = await linkedPair();
  const requestId = crypto.randomUUID();
  createdQuoteRequestIds.push(requestId);
  await getDefaultDb().insert(quoteRequests).values({
    id: requestId,
    userId,
    trimId: null,
    status: "open",
    createdAt: new Date().toISOString(),
  });

  const { token, keyResolver, issuer } = await makeTestAuth("manager", crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  const { calls, waitForCall } = mockPush();
  const pushed = waitForCall();

  const created = await app.request(`/api/customers/${customerId}/quotes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceQuoteRequestId: requestId,
      status: "작성중",
      markReadyForSend: true,
    }),
  });
  expect(created.status).toBe(201);
  const createdBody = (await created.json()) as { id: string };
  createdQuoteIds.push(createdBody.id);
  await pushed;

  expect(calls).toHaveLength(1);
  expect(calls[0].body).toEqual({
    user_id: userId,
    tag: "quote-request-ready-for-send",
  });
  const [firstState] = await getDefaultDb()
    .select({ readyForSendAt: quoteRequests.readyForSendAt })
    .from(quoteRequests)
    .where(eq(quoteRequests.id, requestId));
  expect(firstState.readyForSendAt).not.toBeNull();

  // 새로고침·재클릭·네트워크 재시도를 대표하는 같은 command PATCH. 저장은 성공하지만 전이·푸시는 no-op.
  const retried = await app.request(`/api/customers/${customerId}/quotes/${createdBody.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ note: "작성 완료 재시도", markReadyForSend: true }),
  });
  expect(retried.status).toBe(200);
  await Promise.resolve();
  expect(calls).toHaveLength(1);
  const [secondState] = await getDefaultDb()
    .select({ readyForSendAt: quoteRequests.readyForSendAt })
    .from(quoteRequests)
    .where(eq(quoteRequests.id, requestId));
  expect(secondState.readyForSendAt).toBe(firstState.readyForSendAt);
});

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
