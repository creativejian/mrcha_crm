import { test, expect } from "bun:test";

import { app } from "../app";

test("GET /api/catalog/counts → 200, 7테이블 건수", async () => {
  const res = await app.request("/api/catalog/counts");
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, number>;
  expect(body.brands).toBe(33);
  expect(typeof body.trimOptionRelations).toBe("number");
});
