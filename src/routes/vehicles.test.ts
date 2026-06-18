import { test, expect } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";

async function authedApp() {
  const { token, keyResolver, issuer } = await makeTestAuth("staff");
  const app = createApp({ keyResolver, issuer });
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  return { app, auth };
}

test("GET /api/vehicles/brands → 200, 브랜드 목록", async () => {
  const { app, auth } = await authedApp();
  const res = await app.request("/api/vehicles/brands", auth);
  expect(res.status).toBe(200);
  const body = (await res.json()) as unknown[];
  expect(body.length).toBe(33);
});

test("GET /api/vehicles/models?brandId= → 200", async () => {
  const { app, auth } = await authedApp();
  const brandsRes = await app.request("/api/vehicles/brands", auth);
  const brands = (await brandsRes.json()) as { id: number }[];
  const res = await app.request(`/api/vehicles/models?brandId=${brands[0].id}`, auth);
  expect(res.status).toBe(200);
});

test("GET /api/vehicles/models (brandId 없음) → 400", async () => {
  const { app, auth } = await authedApp();
  const res = await app.request("/api/vehicles/models", auth);
  expect(res.status).toBe(400);
});

test("GET /api/vehicles/trims/:trimId (없는 id) → 404", async () => {
  const { app, auth } = await authedApp();
  const res = await app.request("/api/vehicles/trims/999999999", auth);
  expect(res.status).toBe(404);
});
