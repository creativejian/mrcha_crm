import { test, expect, afterAll, beforeAll, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { staffSettings } from "../db/schema";
import { setTestDb } from "../middleware/db";
import { getTestDb } from "../test-utils/hermetic-db";

// 실 master DB 오염 방지용 고정 UUID(다른 테스트 sub와 겹치지 않는 값).
const TEST_SUB = "cccccccc-cccc-cccc-cccc-cccccccccccc";
// dual-mode(hermetic-db.ts): 로컬 test:server = 실 master(기존 그대로), CI test:pure = PGlite.
const db = await getTestDb();
beforeAll(() => setTestDb(db));
afterAll(() => setTestDb(null));

async function clean() {
  await db.delete(staffSettings).where(eq(staffSettings.staffUserId, TEST_SUB));
}
beforeEach(clean);
afterAll(clean);

test("GET /api/me/live-consulting 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("staff", TEST_SUB);
  const app = createApp({ keyResolver, issuer });
  expect((await app.request("/api/me/live-consulting")).status).toBe(401);
});

test("GET → 설정 없으면 기본 receiving:true", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("staff", TEST_SUB);
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/me/live-consulting", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ receiving: true });
});

test("PATCH off → GET off → PATCH on (upsert 왕복)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("staff", TEST_SUB);
  const app = createApp({ keyResolver, issuer });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const off = await app.request("/api/me/live-consulting", { method: "PATCH", headers, body: JSON.stringify({ receiving: false }) });
  expect(off.status).toBe(200);
  expect(await off.json()).toEqual({ receiving: false });

  const get = await app.request("/api/me/live-consulting", { headers: { Authorization: `Bearer ${token}` } });
  expect(await get.json()).toEqual({ receiving: false });

  const on = await app.request("/api/me/live-consulting", { method: "PATCH", headers, body: JSON.stringify({ receiving: true }) });
  expect(await on.json()).toEqual({ receiving: true });
});

test("PATCH 잘못된 body → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("staff", TEST_SUB);
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/me/live-consulting", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ receiving: "nope" }),
  });
  expect(res.status).toBe(400);
});
