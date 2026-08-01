import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { accountDeletionJobs, customerDeletions, customers, quotes } from "../db/schema";

// 탈퇴 인지 큐 스태프 라우트 통합 검증 — 권한(딜러 차단·담당자 스코프)과 확인 실행.
// 라우트가 자기 트랜잭션을 커밋하므로 픽스처는 finally 정리(잡·감사행·고객 —
// customer_deletions도 CU-ACCDEL- registry 스캔 대상이라 반드시 지운다).

const db = getDefaultDb();
const code = () => `CU-ACCDEL-${crypto.randomUUID().slice(0, 8)}`;

async function seed(advisorId: string | null = null) {
  const appUserId = crypto.randomUUID();
  const customerCode = code();
  const [c] = await db
    .insert(customers)
    .values({ customerCode, name: "탈퇴확인라우트테스트", appUserId, advisorId })
    .returning({ id: customers.id });
  const [job] = await db
    .insert(accountDeletionJobs)
    .values({ appUserId, customerId: c.id, customerCode, proposedClassification: "purge" })
    .returning({ id: accountDeletionJobs.id });
  return { appUserId, customerId: c.id, jobId: job.id };
}

async function cleanup(f: { appUserId: string; customerId: string }): Promise<void> {
  await db.delete(accountDeletionJobs).where(eq(accountDeletionJobs.appUserId, f.appUserId));
  await db.delete(customerDeletions).where(eq(customerDeletions.customerId, f.customerId));
  await db.delete(customers).where(eq(customers.id, f.customerId));
}

test("dealer는 목록도 403(내부 운영 큐 fail-closed)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("dealer", crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/account-deletions", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(403);
});

test("admin 확인(purge): 목록 노출 → 실행 → 재확인 409", async () => {
  const adminId = crypto.randomUUID();
  const { token, keyResolver, issuer } = await makeTestAuth("admin", adminId);
  const app = createApp({ keyResolver, issuer });
  const f = await seed();
  try {
    const list = await app.request("/api/account-deletions", { headers: { Authorization: `Bearer ${token}` } });
    expect(list.status).toBe(200);
    const jobs = (await list.json()) as { id: string; customerName: string | null }[];
    const mine = jobs.find((j) => j.id === f.jobId);
    expect(mine?.customerName).toBe("탈퇴확인라우트테스트"); // 표시명은 고객 join(잡은 PII 무보관)

    const confirm = await app.request(`/api/account-deletions/${f.jobId}/confirm`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ classification: "purge" }),
    });
    expect(confirm.status).toBe(200);
    expect(await confirm.json()).toEqual({ ok: true });
    const [gone] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, f.customerId));
    expect(gone).toBeUndefined();
    const [audit] = await db.select().from(customerDeletions).where(eq(customerDeletions.customerId, f.customerId));
    expect(audit.deletedBy).toBe(adminId);

    const again = await app.request(`/api/account-deletions/${f.jobId}/confirm`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ classification: "purge" }),
    });
    expect(again.status).toBe(409);
  } finally {
    await cleanup(f);
  }
});

test("staff 담당자 스코프: 비담당 403 · 담당자는 실행 가능", async () => {
  const advisorId = crypto.randomUUID();
  const outsider = await makeTestAuth("staff", crypto.randomUUID());
  const owner = await makeTestAuth("staff", advisorId);
  const f = await seed(advisorId);
  try {
    const outsiderApp = createApp({ keyResolver: outsider.keyResolver, issuer: outsider.issuer });
    const denied = await outsiderApp.request(`/api/account-deletions/${f.jobId}/confirm`, {
      method: "POST",
      headers: { Authorization: `Bearer ${outsider.token}`, "content-type": "application/json" },
      body: JSON.stringify({ classification: "purge" }),
    });
    expect(denied.status).toBe(403);

    const ownerApp = createApp({ keyResolver: owner.keyResolver, issuer: owner.issuer });
    const ok = await ownerApp.request(`/api/account-deletions/${f.jobId}/confirm`, {
      method: "POST",
      headers: { Authorization: `Bearer ${owner.token}`, "content-type": "application/json" },
      body: JSON.stringify({ classification: "purge" }),
    });
    expect(ok.status).toBe(200);
  } finally {
    await cleanup(f);
  }
});

test("탈퇴 접수 고객은 견적 앱 발송이 409로 막힌다(spec §3e — 유령 카드 방지)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin", crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  const f = await seed();
  const [q] = await db
    .insert(quotes)
    .values({ quoteCode: `QT-ACCDEL-${crypto.randomUUID().slice(0, 8)}`, customerId: f.customerId })
    .returning({ id: quotes.id });
  try {
    const res = await app.request(`/api/customers/${f.customerId}/quotes/${q.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ appStatus: "sent" }),
    });
    expect(res.status).toBe(409);
    // 발송 전이가 기록되지 않았다(차단은 실행 전) — 다른 편집(appStatus 외)은 막지 않는다.
    const [row] = await db.select({ appStatus: quotes.appStatus }).from(quotes).where(eq(quotes.id, q.id));
    expect(row.appStatus).not.toBe("sent");
    const edit = await app.request(`/api/customers/${f.customerId}/quotes/${q.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ note: "탈퇴 접수 중 메모 편집" }),
    });
    expect(edit.status).toBe(200);
  } finally {
    await db.delete(quotes).where(eq(quotes.id, q.id));
    await cleanup(f);
  }
});

test("B 확정은 retentionUntil(미래) 필수 — 없거나 과거면 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin", crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  const f = await seed();
  try {
    const missing = await app.request(`/api/account-deletions/${f.jobId}/confirm`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ classification: "active_fulfillment" }),
    });
    expect(missing.status).toBe(400);
    const past = await app.request(`/api/account-deletions/${f.jobId}/confirm`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ classification: "active_fulfillment", retentionUntil: "2020-01-01T00:00:00Z" }),
    });
    expect(past.status).toBe(400);
    // 고객·잡 무손상(400은 실행 전 차단).
    const [alive] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, f.customerId));
    expect(alive.id).toBe(f.customerId);
  } finally {
    await cleanup(f);
  }
});
