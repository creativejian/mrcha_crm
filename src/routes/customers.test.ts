import { mock } from "bun:test";

mock.module("../lib/storage", () => ({
  uploadObject: async () => {},
  removeObject: async () => {},
  // 경로를 그대로 echo해 미리보기(thumb)/다운로드(원본) 중 어떤 객체로 signed URL을 냈는지 단언할 수 있게 한다.
  createSignedUrl: async (_env: unknown, path: string) => `https://example.test/${path}`,
}));

import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { customerDocuments, quotes, quoteScenarios } from "../db/schema";
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
  // 이미지면 클라가 구운 JPEG 썸네일도 함께 올린다(미리보기=썸네일, 다운로드=원본).
  fd.append("thumb", new File([new Uint8Array([9, 9, 9])], "thumb.jpg", { type: "image/jpeg" }));
  const up = await app.request(`/api/customers/${cid}/documents`, { method: "POST", headers: auth, body: fd });
  expect(up.status).toBe(201);
  const doc = (await up.json()) as { id: string; docType: string; fileName: string; sortOrder: number };
  expect(doc.docType).toBe("면허증");
  expect(doc.fileName).toBe("운전면허증.png");

  const urlRes = await app.request(`/api/customers/${cid}/documents/${doc.id}/url`, { headers: auth });
  expect(urlRes.status).toBe(200);
  const urlBody = (await urlRes.json()) as { url: string; downloadUrl: string; fileMime: string | null };
  // 미리보기는 썸네일(-thumb.jpg), 다운로드는 원본 — 서로 다른 객체여야 한다.
  expect(urlBody.url).toContain("-thumb.jpg");
  expect(urlBody.downloadUrl).not.toContain("-thumb.jpg");
  expect(urlBody.url).not.toBe(urlBody.downloadUrl);
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

test("서류: 썸네일 없는 이미지는 미리보기=원본 폴백(미리보기==다운로드)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const cid = list[0].id;

  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1, 2, 3, 4])], "scan.png", { type: "image/png" }));
  fd.append("docType", "기타서류");
  const up = await app.request(`/api/customers/${cid}/documents`, { method: "POST", headers: auth, body: fd });
  const doc = (await up.json()) as { id: string };

  try {
    const urlBody = (await (await app.request(`/api/customers/${cid}/documents/${doc.id}/url`, { headers: auth })).json()) as { url: string; downloadUrl: string };
    expect(urlBody.url).not.toContain("-thumb.jpg");
    expect(urlBody.url).toBe(urlBody.downloadUrl); // 썸네일 없으면 둘 다 원본
  } finally {
    // 공유 master DB라 반드시 정리(안 하면 김민준 서류함에 매 실행마다 누적).
    await getDefaultDb().delete(customerDocuments).where(eq(customerDocuments.id, doc.id));
  }
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

// throwaway 견적 1건 + 대표 시나리오 1건을 직접 insert(생성 API는 #4c라 없음). 반환 id로 라우트를 검증.
async function seedThrowawayQuote(customerId: string) {
  const db = getDefaultDb();
  const [q] = await db.insert(quotes).values({
    quoteCode: `QT-TEST-${crypto.randomUUID().slice(0, 8)}`,
    customerId, entryMode: "manual", appStatus: "draft", status: "작성중", revision: 0,
  }).returning({ id: quotes.id });
  const [s] = await db.insert(quoteScenarios).values({
    quoteId: q.id, scenarioNo: 1, purchaseMethod: "운용리스", termMonths: 60, lender: "iM캐피탈", monthlyPayment: "2473200",
  }).returning({ id: quoteScenarios.id });
  await db.update(quotes).set({ primaryScenarioId: s.id }).where(eq(quotes.id, q.id));
  return q.id;
}

test("견적 쓰기: PATCH 헤더+대표시나리오 → getCustomer 반영", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const quoteId = await seedThrowawayQuote(cid);
  try {
    const patched = await app.request(`/api/customers/${cid}/quotes/${quoteId}`, {
      method: "PATCH", headers: h,
      body: JSON.stringify({
        note: "수정됨", appStatus: "sent", bumpRevision: true, decisionStatus: "confirmed",
        scenario: { purchaseMethod: "장기렌트", termMonths: 48, monthlyPayment: "1999000", lender: "우리금융캐피탈" },
      }),
    });
    expect(patched.status).toBe(200);

    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      quotes: Array<{ id: string; note: string | null; appStatus: string | null; decisionStatus: string | null; revision: number; sentAt: string | null; scenarios: Array<{ purchaseMethod: string | null; termMonths: number | null; monthlyPayment: string | null; lender: string | null }> }>;
    };
    const q = detail.quotes.find((x) => x.id === quoteId)!;
    expect(q.note).toBe("수정됨");
    expect(q.appStatus).toBe("sent");
    expect(q.decisionStatus).toBe("confirmed");
    expect(q.revision).toBe(1);
    expect(q.sentAt).not.toBeNull();
    expect(q.scenarios[0].purchaseMethod).toBe("장기렌트");
    expect(q.scenarios[0].termMonths).toBe(48);
    expect(q.scenarios[0].monthlyPayment).toBe("1999000");
    expect(q.scenarios[0].lender).toBe("우리금융캐피탈");
  } finally {
    // 공유 master DB라 어떤 결과든 정리(scenarios는 ON DELETE CASCADE).
    await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});

test("견적 쓰기: DELETE → 200, getCustomer에서 사라짐(시나리오 cascade)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const quoteId = await seedThrowawayQuote(cid);
  try {
    const removed = await app.request(`/api/customers/${cid}/quotes/${quoteId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    expect(removed.status).toBe(200);

    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { quotes: Array<{ id: string }> };
    expect(detail.quotes.some((x) => x.id === quoteId)).toBe(false);
    const leftover = await getDefaultDb().select({ id: quoteScenarios.id }).from(quoteScenarios).where(eq(quoteScenarios.quoteId, quoteId));
    expect(leftover.length).toBe(0);
  } finally {
    // API DELETE 성공 시 no-op, 실패/예외 시 정리.
    await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});

test("견적 쓰기: 없는 quoteId PATCH/DELETE → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const missing = "00000000-0000-0000-0000-000000000000";
  expect((await app.request(`/api/customers/${cid}/quotes/${missing}`, { method: "PATCH", headers: h, body: JSON.stringify({ note: "x" }) })).status).toBe(404);
  expect((await app.request(`/api/customers/${cid}/quotes/${missing}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })).status).toBe(404);
});

test("견적 쓰기: 교차 고객 가드 — 다른 고객 id로 PATCH → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const otherCid = list[1].id;
  const quoteId = await seedThrowawayQuote(cid);
  try {
    const res = await app.request(`/api/customers/${otherCid}/quotes/${quoteId}`, { method: "PATCH", headers: h, body: JSON.stringify({ note: "x" }) });
    expect(res.status).toBe(404);
  } finally {
    await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});

test("견적 생성: POST → 201·quote_code 형식·getCustomer 반영(대표 시나리오 포함)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  let createdId: string | undefined;
  try {
    const res = await app.request(`/api/customers/${cid}/quotes`, {
      method: "POST", headers: h,
      body: JSON.stringify({
        entryMode: "manual", status: "작성중", quoteRound: "1차", stockStatus: "재고있음",
        brandName: "벤츠", modelName: "Maybach S-Class", trimName: "S 500 4M Long", note: "테스트 생성",
        scenario: { purchaseMethod: "운용리스", termMonths: 60, monthlyPayment: "2473200", lender: "iM캐피탈" },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; quoteCode: string; createdAt: string };
    createdId = body.id;
    expect(body.quoteCode).toMatch(/^QT-\d{4}-\d{4}$/);

    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      quotes: Array<{ id: string; quoteCode: string; brandName: string | null; appStatus: string | null; primaryScenarioId: string | null; scenarios: Array<{ id: string; purchaseMethod: string | null; termMonths: number | null; lender: string | null }> }>;
    };
    const q = detail.quotes.find((x) => x.id === createdId)!;
    expect(q.quoteCode).toBe(body.quoteCode);
    expect(q.brandName).toBe("벤츠");
    expect(q.appStatus).toBe("draft");
    expect(q.scenarios.length).toBe(1);
    expect(q.scenarios[0].purchaseMethod).toBe("운용리스");
    expect(q.scenarios[0].termMonths).toBe(60);
    expect(q.scenarios[0].lender).toBe("iM캐피탈");
    expect(q.primaryScenarioId).toBe(q.scenarios[0].id); // 대표 시나리오 지정됨
  } finally {
    // 공유 master DB라 항상 정리(scenarios는 ON DELETE CASCADE).
    if (createdId) await getDefaultDb().delete(quotes).where(eq(quotes.id, createdId));
  }
});
