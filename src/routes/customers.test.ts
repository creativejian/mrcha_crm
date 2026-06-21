import { mock } from "bun:test";

mock.module("../lib/storage", () => ({
  uploadObject: async () => {},
  removeObject: async () => {},
  createSignedUrl: async () => "https://example.test/signed-url",
}));

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

test("자식 CRUD: 메모 POST→PATCH→DELETE 라운드트립", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;

  const created = await app.request(`/api/customers/${cid}/memos`, { method: "POST", headers: h, body: JSON.stringify({ body: "테스트 메모" }) });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };

  const patched = await app.request(`/api/customers/${cid}/memos/${id}`, { method: "PATCH", headers: h, body: JSON.stringify({ body: "수정됨" }) });
  expect(patched.status).toBe(200);

  const removed = await app.request(`/api/customers/${cid}/memos/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  expect(removed.status).toBe(200);
});

test("자식 CRUD: 할일·일정 POST→DELETE 라운드트립", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;

  const task = await app.request(`/api/customers/${cid}/tasks`, { method: "POST", headers: h, body: JSON.stringify({ category: "체크", due: "오늘", body: "t" }) });
  expect(task.status).toBe(201);
  const taskId = ((await task.json()) as { id: string }).id;
  expect((await app.request(`/api/customers/${cid}/tasks/${taskId}`, { method: "PATCH", headers: h, body: JSON.stringify({ done: true }) })).status).toBe(200);
  expect((await app.request(`/api/customers/${cid}/tasks/${taskId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);

  const sch = await app.request(`/api/customers/${cid}/schedules`, { method: "POST", headers: h, body: JSON.stringify({ scheduledDate: "2026-06-01", scheduledTime: "10:00", type: "견적", memo: "s" }) });
  expect(sch.status).toBe(201);
  const schId = ((await sch.json()) as { id: string }).id;
  expect((await app.request(`/api/customers/${cid}/schedules/${schId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
});

test("자식 CRUD: 없는 childId DELETE → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const res = await app.request(`/api/customers/${list[0].id}/memos/00000000-0000-0000-0000-000000000000`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(404);
});

test("서류: 업로드→signedUrl→docType PATCH→reorder→삭제 라운드트립", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const cid = list[0].id;

  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1, 2, 3, 4])], "운전면허증.png", { type: "image/png" }));
  fd.append("docType", "면허증");
  const up = await app.request(`/api/customers/${cid}/documents`, { method: "POST", headers: auth, body: fd });
  expect(up.status).toBe(201);
  const doc = (await up.json()) as { id: string; docType: string; fileName: string; sortOrder: number };
  expect(doc.docType).toBe("면허증");
  expect(doc.fileName).toBe("운전면허증.png");

  const urlRes = await app.request(`/api/customers/${cid}/documents/${doc.id}/url`, { headers: auth });
  expect(urlRes.status).toBe(200);
  const urlBody = (await urlRes.json()) as { url: string; downloadUrl: string; fileMime: string | null };
  expect(urlBody.url).toContain("https://");
  expect(urlBody.downloadUrl).toContain("https://");
  expect(urlBody.fileMime).toBe("image/png");

  const h = { ...auth, "Content-Type": "application/json" };
  const patched = await app.request(`/api/customers/${cid}/documents/${doc.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ docType: "사업자등록증" }) });
  expect(patched.status).toBe(200);

  const reordered = await app.request(`/api/customers/${cid}/documents/reorder`, { method: "PATCH", headers: h, body: JSON.stringify({ order: [{ id: doc.id, sortOrder: 0 }] }) });
  expect(reordered.status).toBe(200);

  const removed = await app.request(`/api/customers/${cid}/documents/${doc.id}`, { method: "DELETE", headers: auth });
  expect(removed.status).toBe(200);
});

test("서류: 허용 안 되는 MIME → 415", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1])], "evil.exe", { type: "application/x-msdownload" }));
  const res = await app.request(`/api/customers/${list[0].id}/documents`, { method: "POST", headers: auth, body: fd });
  expect(res.status).toBe(415);
});

test("서류: 오피스 파일(xlsx) → 415", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1])], "재무제표.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const res = await app.request(`/api/customers/${list[0].id}/documents`, { method: "POST", headers: auth, body: fd });
  expect(res.status).toBe(415);
});

test("서류: 파일 없음 → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const res = await app.request(`/api/customers/${list[0].id}/documents`, { method: "POST", headers: auth, body: new FormData() });
  expect(res.status).toBe(400);
});

test("서류: 없는 childId signedUrl → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const res = await app.request(`/api/customers/${list[0].id}/documents/00000000-0000-0000-0000-000000000000/url`, { headers: auth });
  expect(res.status).toBe(404);
});

test("GET /api/customers/:id → quotes(+scenarios) 배열 포함", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const res = await app.request(`/api/customers/${list[0].id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { quotes: Array<{ id: string; scenarios: unknown[] }> };
  expect(Array.isArray(body.quotes)).toBe(true);
  for (const q of body.quotes) expect(Array.isArray(q.scenarios)).toBe(true);
});
