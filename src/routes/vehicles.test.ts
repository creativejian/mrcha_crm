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

test("GET /api/vehicles/workbench?trimId= → 200, 번들(brands/models/trims/trimDetail)", async () => {
  const { app, auth } = await authedApp();
  const brands = (await (await app.request("/api/vehicles/brands", auth)).json()) as { id: number }[];
  const models = (await (await app.request(`/api/vehicles/models?brandId=${brands[0].id}`, auth)).json()) as { id: number }[];
  const trims = (await (await app.request(`/api/vehicles/trims?modelId=${models[0].id}`, auth)).json()) as { id: number }[];
  const res = await app.request(`/api/vehicles/workbench?trimId=${trims[0].id}`, auth);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { brands: unknown[]; models: { id: number }[]; trims: { id: number }[]; trimDetail: { id: number; modelId: number } };
  expect(body.brands.length).toBeGreaterThan(0);
  expect(body.models.length).toBeGreaterThan(0);
  expect(body.trims.length).toBeGreaterThan(0);
  expect(body.trimDetail.id).toBe(trims[0].id);
  expect(body.models.some((m) => m.id === body.trimDetail.modelId)).toBe(true);
  expect(body.trims.some((t) => t.id === trims[0].id)).toBe(true);
});

test("GET /api/vehicles/workbench (없는 trimId) → 404", async () => {
  const { app, auth } = await authedApp();
  const res = await app.request("/api/vehicles/workbench?trimId=999999999", auth);
  expect(res.status).toBe(404);
});

test("GET /api/vehicles/workbench (trimId 없음) → 400", async () => {
  const { app, auth } = await authedApp();
  const res = await app.request("/api/vehicles/workbench", auth);
  expect(res.status).toBe(400);
});

test("트림 목록·상세에 mcCode 필드가 실린다(솔루션 조회 masterMcCode 소스)", async () => {
  const { app, auth } = await authedApp();
  const brands = (await (await app.request("/api/vehicles/brands", auth)).json()) as { id: number }[];
  const models = (await (await app.request(`/api/vehicles/models?brandId=${brands[0].id}`, auth)).json()) as { id: number }[];
  const trimsRes = await app.request(`/api/vehicles/trims?modelId=${models[0].id}`, auth);
  const trims = (await trimsRes.json()) as { id: number }[];
  expect(trims.length).toBeGreaterThan(0);
  expect(Object.keys(trims[0])).toContain("mcCode");

  const detailRes = await app.request(`/api/vehicles/trims/${trims[0].id}`, auth);
  const detail = (await detailRes.json()) as Record<string, unknown>;
  expect(Object.keys(detail)).toContain("mcCode");
});
