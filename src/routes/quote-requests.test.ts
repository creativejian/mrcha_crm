import { test, expect } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";

test("GET /api/quote-requests → 200, 배열", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/quote-requests", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

test("GET /api/quote-requests 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/quote-requests");
  expect(res.status).toBe(401);
});

test("GET /api/quote-requests → 행 형태(차량명/옵션수/매칭)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/quote-requests", { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as Array<{
    id: string; createdAt: string; optionCount: number;
    matchType: string; brandName: string | null; status: string | null;
  }>;
  expect(body.length).toBeGreaterThan(0);
  for (const r of body) {
    expect(typeof r.id).toBe("string");
    expect(typeof r.optionCount).toBe("number");
    expect(["app_user", "phone", "none"]).toContain(r.matchType);
    expect(r.brandName === null || typeof r.brandName === "string").toBe(true);
  }
});
