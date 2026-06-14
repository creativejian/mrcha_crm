import { test, expect } from "bun:test";

import { app } from "../app";

test("GET /api/vehicles/brands → 200, 브랜드 목록", async () => {
  const res = await app.request("/api/vehicles/brands");
  expect(res.status).toBe(200);
  const body = (await res.json()) as unknown[];
  expect(body.length).toBe(33);
});

test("GET /api/vehicles/models?brandId= → 200", async () => {
  const brandsRes = await app.request("/api/vehicles/brands");
  const brands = (await brandsRes.json()) as { id: number }[];
  const res = await app.request(`/api/vehicles/models?brandId=${brands[0].id}`);
  expect(res.status).toBe(200);
});

test("GET /api/vehicles/models (brandId 없음) → 400", async () => {
  const res = await app.request("/api/vehicles/models");
  expect(res.status).toBe(400);
});

test("GET /api/vehicles/trims/:trimId (없는 id) → 404", async () => {
  const res = await app.request("/api/vehicles/trims/999999999");
  expect(res.status).toBe(404);
});
