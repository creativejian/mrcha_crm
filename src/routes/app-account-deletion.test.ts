import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { getDefaultDb } from "../db/client";
import { accountDeletionJobs, customers } from "../db/schema";

// 앱 탈퇴 엔드포인트(공유 시크릿 인증) 통합 검증. 라우트가 자기 트랜잭션을 열어 커밋하므로
// 롤백 패턴을 못 쓴다 — 픽스처는 finally에서 직접 정리한다(customers.delete.test.ts 관례).
// 알림 트리거 테이블은 건드리지 않는다(고객·잡 픽스처뿐, 견적 없음) — notify guard 불요.

const db = getDefaultDb();
const TEST_SECRET = `accdel-test-${crypto.randomUUID()}`;
const originalSecret = process.env.APP_DELETION_SECRET;
process.env.APP_DELETION_SECRET = TEST_SECRET;
afterAll(() => {
  if (originalSecret === undefined) delete process.env.APP_DELETION_SECRET;
  else process.env.APP_DELETION_SECRET = originalSecret;
});

const app = createApp();
const post = (body: unknown, secret?: string) =>
  app.request("/api/app/account-deletion", {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-deletion-secret": secret } : {}) },
    body: JSON.stringify(body),
  });

async function cleanupJob(appUserId: string): Promise<void> {
  await db.delete(accountDeletionJobs).where(eq(accountDeletionJobs.appUserId, appUserId));
}

test("시크릿 없음/불일치 → 401, env 미설정 → 503(fail-closed)", async () => {
  expect((await post({ appUserId: crypto.randomUUID() })).status).toBe(401);
  expect((await post({ appUserId: crypto.randomUUID() }, "wrong")).status).toBe(401);

  delete process.env.APP_DELETION_SECRET;
  try {
    expect((await post({ appUserId: crypto.randomUUID() }, TEST_SECRET)).status).toBe(503);
  } finally {
    process.env.APP_DELETION_SECRET = TEST_SECRET;
  }
});

test("POST 잘못된 body → 400 (uuid 아님·JSON 깨짐)", async () => {
  expect((await post({ appUserId: "not-a-uuid" }, TEST_SECRET)).status).toBe(400);
  const broken = await app.request("/api/app/account-deletion", {
    method: "POST",
    headers: { "content-type": "application/json", "x-deletion-secret": TEST_SECRET },
    body: "{broken",
  });
  expect(broken.status).toBe(400);
});

test("POST 미연결 유저 → 200 purged 즉시 종결 + 멱등 + status 폴링 일치", async () => {
  const appUserId = crypto.randomUUID();
  try {
    const res = await post({ appUserId }, TEST_SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "purged" });

    const again = await post({ appUserId }, TEST_SECRET);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: "purged" });

    const status = await app.request(`/api/app/account-deletion/status?appUserId=${appUserId}`, {
      headers: { "x-deletion-secret": TEST_SECRET },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ status: "purged" });
  } finally {
    await cleanupJob(appUserId);
  }
});

test("POST 연결 고객 → 202 review_pending(인지 큐) + 고객 무손상", async () => {
  const appUserId = crypto.randomUUID();
  const [c] = await db
    .insert(customers)
    .values({ customerCode: `CU-ACCDEL-${crypto.randomUUID().slice(0, 8)}`, name: "탈퇴라우트테스트", appUserId })
    .returning({ id: customers.id });
  try {
    const res = await post({ appUserId }, TEST_SECRET);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "review_pending" });

    const status = await app.request(`/api/app/account-deletion/status?appUserId=${appUserId}`, {
      headers: { "x-deletion-secret": TEST_SECRET },
    });
    expect(status.status).toBe(202);

    const [alive] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, c.id));
    expect(alive.id).toBe(c.id);
  } finally {
    await cleanupJob(appUserId);
    await db.delete(customers).where(eq(customers.id, c.id));
  }
});

test("status: 이력 없는 유저 → 404", async () => {
  const res = await app.request(`/api/app/account-deletion/status?appUserId=${crypto.randomUUID()}`, {
    headers: { "x-deletion-secret": TEST_SECRET },
  });
  expect(res.status).toBe(404);
});
