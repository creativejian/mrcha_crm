import { test, expect } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";

test("GET /api/catalog/counts → 200, 7테이블 건수", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/catalog/counts", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, number>;
  expect(body.brands).toBe(33);
  expect(typeof body.trimOptionRelations).toBe("number");
});
