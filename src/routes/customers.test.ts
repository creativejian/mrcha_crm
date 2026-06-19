import { test, expect } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { customerWriteSchema } from "./customers";

test("GET /api/customers → 200, 배열", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect(Array.isArray(await res.json())).toBe(true);
});

test("GET /api/customers 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/customers");
  expect(res.status).toBe(401);
});

test("GET /api/customers/:id 없는 uuid → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/customers/00000000-0000-0000-0000-000000000000", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(404);
});

test("customerWriteSchema: 유효 부분 입력 파싱", () => {
  const r = customerWriteSchema.safeParse({ phone: "010-1-2", chance: "높음", needMemo: null });
  expect(r.success).toBe(true);
});

test("customerWriteSchema: 잘못된 타입 거부", () => {
  const r = customerWriteSchema.safeParse({ phone: 123 });
  expect(r.success).toBe(false);
});

test("PATCH /api/customers/:id 없는 uuid → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/customers/00000000-0000-0000-0000-000000000000", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "발송완료" }),
  });
  expect(res.status).toBe(404);
});

test("PATCH /api/customers/:id 잘못된 body → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/customers/00000000-0000-0000-0000-000000000000", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phone: 123 }),
  });
  expect(res.status).toBe(400);
});

test("PATCH /api/customers/:id 같은 값 비파괴 → 200", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const listRes = await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } });
  const list = (await listRes.json()) as Array<{ id: string; source: string | null }>;
  const target = list[0];
  const res = await app.request(`/api/customers/${target.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ source: target.source }),
  });
  expect(res.status).toBe(200);
});
