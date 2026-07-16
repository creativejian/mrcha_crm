// 앱 콘텐츠 읽기 전용 라우트 — 실 master read(픽스처 없음, 순수 SELECT라 알림 트리거 무관).
import { expect, test } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";

async function adminApp() {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  return { app: createApp({ keyResolver, issuer }), token };
}

test("GET /api/insights — admin 200, 메타 목록(content 제외)", async () => {
  const { app, token } = await adminApp();
  const res = await app.request("/api/insights", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  if (body.length > 0) {
    expect(body[0]).toHaveProperty("title");
    expect(body[0]).toHaveProperty("status");
    expect(body[0]).not.toHaveProperty("content"); // 목록은 메타만
  }
});

test("GET /api/insights/:id — content·thumbnail 포함", async () => {
  const { app, token } = await adminApp();
  const list = await (await app.request("/api/insights", { headers: { Authorization: `Bearer ${token}` } })).json();
  if (list.length === 0) return;
  const res = await app.request(`/api/insights/${list[0].id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty("content");
  expect(body).toHaveProperty("thumbnailUrl");
});

test("GET /api/insights/:id — 미존재 id는 404(200 null 아님)", async () => {
  const { app, token } = await adminApp();
  const res = await app.request("/api/insights/00000000-0000-0000-0000-000000000000", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(404);
});

test("GET /api/knowledge — admin 200, block_number 오름차순", async () => {
  const { app, token } = await adminApp();
  const res = await app.request("/api/knowledge", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  const blocks = body.map((r: { blockNumber: number | null }) => r.blockNumber).filter((b: number | null): b is number => b != null);
  expect(blocks).toEqual([...blocks].sort((a, b) => a - b));
});

test("GET /api/knowledge/:id — content 포함", async () => {
  const { app, token } = await adminApp();
  const list = await (await app.request("/api/knowledge", { headers: { Authorization: `Bearer ${token}` } })).json();
  if (list.length === 0) return;
  const res = await app.request(`/api/knowledge/${list[0].id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect(await res.json()).toHaveProperty("content");
});

test("GET /api/knowledge/:id — 미존재 id는 404(200 null 아님)", async () => {
  const { app, token } = await adminApp();
  const res = await app.request("/api/knowledge/00000000-0000-0000-0000-000000000000", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(404);
});

test("non-admin(staff)은 403 — CRM은 admin 전용 참조", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("staff");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/insights", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(403);
});
