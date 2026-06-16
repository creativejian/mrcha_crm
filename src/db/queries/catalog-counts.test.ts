import { test, expect } from "bun:test";

import { getCatalogCounts } from "./catalog-counts";

test("getCatalogCounts: 7테이블 활성 건수 반환", async () => {
  const c = await getCatalogCounts();
  expect(c.brands).toBe(33);
  expect(c.models).toBe(265);
  expect(c.trims).toBe(1669);
  expect(c.trimOptions).toBeGreaterThan(10000);
  expect(c.colors).toBeGreaterThan(10000);
  expect(c.trimNoOptions).toBe(57);
  expect(c.trimOptionRelations).toBe(6236);
});
