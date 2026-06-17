import { afterEach, expect, it, vi } from "vitest";

import { fetchCatalogCounts } from "./catalog";

const COUNTS = {
  brands: 33,
  models: 265,
  trims: 1669,
  trimOptions: 10495,
  colors: 10483,
  trimNoOptions: 57,
  trimOptionRelations: 6236,
};

afterEach(() => vi.restoreAllMocks());

it("fetchCatalogCounts: 건수 객체 반환", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(COUNTS), { status: 200 })));
  const c = await fetchCatalogCounts();
  expect(c.brands).toBe(33);
  expect(c.trimOptionRelations).toBe(6236);
});

it("fetchCatalogCounts: 실패 시 throw", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
  await expect(fetchCatalogCounts()).rejects.toThrow();
});
