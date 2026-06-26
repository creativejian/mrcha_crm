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

test("견적 쓰기: PATCH guidance(추가 안내) → getCustomer 라운드트립", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const quoteId = await seedThrowawayQuote(cid);
  const guidance = {
    deliveryComment: "이 차량은 1주일 내 출고 가능해요",
    stockNotice: "즉시 출고 가능",
    expectedDelivery: "1주일 이내",
    customerRegion: "서울",
    keyPoint: "초기 부담을 낮추는 조건입니다.",
    recommendReason: "안정적인 조건입니다.",
    services: ["썬팅", "블랙박스", "", ""],
  };
  try {
    // seed 직후엔 guidance=null
    const before = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { quotes: Array<{ id: string; guidance: unknown }> };
    expect(before.quotes.find((x) => x.id === quoteId)!.guidance).toBeNull();

    const patched = await app.request(`/api/customers/${cid}/quotes/${quoteId}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ guidance }),
    });
    expect(patched.status).toBe(200);

    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { quotes: Array<{ id: string; guidance: typeof guidance | null }> };
    expect(detail.quotes.find((x) => x.id === quoteId)!.guidance).toEqual(guidance);
  } finally {
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

test("견적 쓰기: PATCH primaryScenarioId → 대표 전환 반영, 타 quote 시나리오 id는 무시", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const db = getDefaultDb();
  // 시나리오 2건 견적(대표 = 1번 시나리오).
  const [q] = await db.insert(quotes).values({
    quoteCode: `QT-TEST-${crypto.randomUUID().slice(0, 8)}`,
    customerId: cid, entryMode: "manual", appStatus: "draft", status: "작성중", revision: 0,
  }).returning({ id: quotes.id });
  const [s1] = await db.insert(quoteScenarios).values({ quoteId: q.id, scenarioNo: 1, purchaseMethod: "운용리스", termMonths: 60, lender: "A캐피탈", monthlyPayment: "100" }).returning({ id: quoteScenarios.id });
  const [s2] = await db.insert(quoteScenarios).values({ quoteId: q.id, scenarioNo: 2, purchaseMethod: "할부", termMonths: 36, lender: "B캐피탈", monthlyPayment: "200" }).returning({ id: quoteScenarios.id });
  await db.update(quotes).set({ primaryScenarioId: s1.id }).where(eq(quotes.id, q.id));
  // 타 quote(시나리오 id 무시 검증용).
  const otherQuoteId = await seedThrowawayQuote(cid);
  const [otherScenario] = await db.select({ id: quoteScenarios.id }).from(quoteScenarios).where(eq(quoteScenarios.quoteId, otherQuoteId));
  try {
    // 대표를 2번 시나리오로 전환.
    const patched = await app.request(`/api/customers/${cid}/quotes/${q.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ primaryScenarioId: s2.id }) });
    expect(patched.status).toBe(200);
    const d1 = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { quotes: Array<{ id: string; primaryScenarioId: string | null }> };
    expect(d1.quotes.find((x) => x.id === q.id)!.primaryScenarioId).toBe(s2.id);

    // 타 quote의 시나리오 id → 무시(대표 불변 = s2).
    const ignored = await app.request(`/api/customers/${cid}/quotes/${q.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ primaryScenarioId: otherScenario.id }) });
    expect(ignored.status).toBe(200);
    const d2 = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { quotes: Array<{ id: string; primaryScenarioId: string | null }> };
    expect(d2.quotes.find((x) => x.id === q.id)!.primaryScenarioId).toBe(s2.id);
  } finally {
    await getDefaultDb().delete(quotes).where(eq(quotes.id, q.id));
    await getDefaultDb().delete(quotes).where(eq(quotes.id, otherQuoteId));
  }
});

test("견적 쓰기 PR2a: PATCH가 가격 스냅샷 + 색상 + 옵션 + 시나리오 교체를 반영한다", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  let quoteId: string | undefined;
  try {
    // scenarios 2건으로 생성.
    const createRes = await app.request(`/api/customers/${cid}/quotes`, {
      method: "POST", headers: h,
      body: JSON.stringify({
        entryMode: "manual", brandName: "벤츠", modelName: "S", trimName: "S 500",
        scenarios: [
          { scenarioNo: 1, purchaseMethod: "운용리스", monthlyPayment: "2000000" },
          { scenarioNo: 2, purchaseMethod: "운용리스", monthlyPayment: "2100000" },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    quoteId = ((await createRes.json()) as { id: string }).id;

    // PATCH: 스냅샷 + 시나리오 1건으로 교체.
    const patchRes = await app.request(`/api/customers/${cid}/quotes/${quoteId}`, {
      method: "PATCH", headers: h,
      body: JSON.stringify({
        basePrice: "243000000", finalVehiclePrice: "236500000",
        exteriorColorName: "옵시디언 블랙",
        options: [{ id: 1, name: "옵션A", price: 1000000 }],
        scenarios: [{ scenarioNo: 1, purchaseMethod: "장기렌트", monthlyPayment: "1900000" }],
      }),
    });
    expect(patchRes.status).toBe(200);

    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      quotes: Array<{ id: string; basePrice: string | null; finalVehiclePrice: string | null; exteriorColorName: string | null; options: unknown[] | null; primaryScenarioId: string | null; scenarios: Array<{ id: string; purchaseMethod: string | null }> }>;
    };
    const q = detail.quotes.find((x) => x.id === quoteId)!;
    expect(Number(q.basePrice)).toBe(243000000);
    expect(Number(q.finalVehiclePrice)).toBe(236500000);
    expect(q.exteriorColorName).toBe("옵시디언 블랙");
    expect(q.options?.length).toBe(1);
    expect(q.scenarios.length).toBe(1); // 2건 → 1건 교체
    expect(q.scenarios[0].purchaseMethod).toBe("장기렌트");
    expect(q.primaryScenarioId).toBe(q.scenarios[0].id); // 대표 재계산
  } finally {
    if (quoteId) await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});

test("견적 원본 #4d: POST 업로드 → getCustomer file_* 반영(file_path 비노출), url 발급, DELETE 제거", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const quoteId = await seedThrowawayQuote(cid);
  try {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([1, 2, 3, 4])], "원본견적.pdf", { type: "application/pdf" }));
    const up = await app.request(`/api/customers/${cid}/quotes/${quoteId}/original`, { method: "POST", headers: auth, body: fd });
    expect(up.status).toBe(201);
    expect(((await up.json()) as { fileName: string }).fileName).toBe("원본견적.pdf");

    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: auth })).json()) as {
      quotes: Array<{ id: string; fileName: string | null; fileMime: string | null; filePath?: string }>;
    };
    const q = detail.quotes.find((x) => x.id === quoteId)!;
    expect(q.fileName).toBe("원본견적.pdf");
    expect(q.fileMime).toBe("application/pdf");
    expect("filePath" in q).toBe(false); // file_path 비노출

    const urlRes = await app.request(`/api/customers/${cid}/quotes/${quoteId}/original/url`, { headers: auth });
    expect(urlRes.status).toBe(200);
    expect(((await urlRes.json()) as { url: string }).url).toContain("https://example.test/");

    const del = await app.request(`/api/customers/${cid}/quotes/${quoteId}/original`, { method: "DELETE", headers: auth });
    expect(del.status).toBe(200);
    const detail2 = (await (await app.request(`/api/customers/${cid}`, { headers: auth })).json()) as { quotes: Array<{ id: string; fileName: string | null }> };
    expect(detail2.quotes.find((x) => x.id === quoteId)!.fileName).toBeNull();
  } finally {
    await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});

test("견적 원본 #4d: 허용 안 되는 MIME → 415, 없는 견적 → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const quoteId = await seedThrowawayQuote(cid);
  try {
    const fdBad = new FormData();
    fdBad.append("file", new File([new Uint8Array([1])], "메모.txt", { type: "text/plain" }));
    expect((await app.request(`/api/customers/${cid}/quotes/${quoteId}/original`, { method: "POST", headers: auth, body: fdBad })).status).toBe(415);

    const missing = "00000000-0000-0000-0000-000000000000";
    const fdPdf = new FormData();
    fdPdf.append("file", new File([new Uint8Array([1])], "q.pdf", { type: "application/pdf" }));
    expect((await app.request(`/api/customers/${cid}/quotes/${missing}/original`, { method: "POST", headers: auth, body: fdPdf })).status).toBe(404);
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

test("견적 생성(워크벤치 #4c-2): 가격/색상/옵션 payload → getCustomer 라운드트립", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  let quoteId: string | null = null;
  try {
    const created = await app.request(`/api/customers/${cid}/quotes`, {
      method: "POST", headers: h,
      body: JSON.stringify({
        entryMode: "manual", status: "작성중", quoteRound: "1차", stockStatus: "재고확인중",
        brandName: "벤츠", modelName: "Maybach S-Class", trimName: "S 500 4M Long", note: "수기 입력 조건",
        // trim_id·color_id는 catalog FK(실존 id만 가능)라 단위테스트에선 null로 두고 snapshot(이름/hex/가격/옵션)만 검증한다.
        basePrice: "243000000", optionTotal: "5000000",
        options: [{ id: 9001, name: "프리미엄 패키지", price: 5000000 }],
        finalDiscount: "6500000", acquisitionTax: "13531000", acquisitionTaxMode: "normal",
        bond: "0", delivery: "0", incidental: "0",
        finalVehiclePrice: "241500000", acquisitionCost: "255031000",
        exteriorColorName: "옵시디언 블랙", exteriorColorHex: "#0a0a0a",
        interiorColorName: "마키아토 베이지", interiorColorHex: "#d8c7a8",
        scenario: { purchaseMethod: "운용리스" },
      }),
    });
    expect(created.status).toBe(201);
    quoteId = ((await created.json()) as { id: string }).id;

    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      quotes: Array<{ id: string; basePrice: string | null; optionTotal: string | null; options: Array<{ id: number; name: string; price: number | null }> | null; finalVehiclePrice: string | null; exteriorColorName: string | null; exteriorColorHex: string | null; interiorColorName: string | null; scenarios: Array<{ purchaseMethod: string | null }> }>;
    };
    const q = detail.quotes.find((x) => x.id === quoteId)!;
    expect(q.basePrice).toBe("243000000");
    expect(q.optionTotal).toBe("5000000");
    expect(q.options?.[0]?.name).toBe("프리미엄 패키지");
    expect(q.finalVehiclePrice).toBe("241500000");
    expect(q.exteriorColorName).toBe("옵시디언 블랙");
    expect(q.exteriorColorHex).toBe("#0a0a0a");
    expect(q.interiorColorName).toBe("마키아토 베이지");
    expect(q.scenarios[0].purchaseMethod).toBe("운용리스");
  } finally {
    if (quoteId) await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});

test("견적 생성(워크벤치 #4c-2): composer 하위호환 — 가격 필드 없이도 201", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  let quoteId: string | null = null;
  try {
    const created = await app.request(`/api/customers/${cid}/quotes`, {
      method: "POST", headers: h,
      body: JSON.stringify({ entryMode: "manual", status: "작성중", brandName: "BMW", scenario: { purchaseMethod: "할부" } }),
    });
    expect(created.status).toBe(201);
    quoteId = ((await created.json()) as { id: string }).id;
  } finally {
    if (quoteId) await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});

test("견적 다중 시나리오(#4c-3a): scenarios 3건 → getCustomer 라운드트립 + primary=round1", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  let quoteId: string | null = null;
  try {
    const created = await app.request(`/api/customers/${cid}/quotes`, {
      method: "POST", headers: h,
      body: JSON.stringify({
        entryMode: "manual", status: "작성중", brandName: "벤츠",
        scenarios: [
          { scenarioNo: 1, isSaved: true, purchaseMethod: "운용리스", lender: "우리금융캐피탈", monthlyPayment: "2398000", depositMode: "percent", depositValue: "30", residualMode: "max", mileageMode: "basic", mileageValue: "20,000km / 년" },
          { scenarioNo: 2, isSaved: true, purchaseMethod: "운용리스", lender: "iM캐피탈", monthlyPayment: "2473200", depositMode: "amount", depositValue: "10000000" },
          { scenarioNo: 3, isSaved: true, purchaseMethod: "운용리스", lender: "하나캐피탈", monthlyPayment: "2550000" },
        ],
      }),
    });
    expect(created.status).toBe(201);
    quoteId = ((await created.json()) as { id: string }).id;

    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      quotes: Array<{ id: string; primaryScenarioId: string | null; scenarios: Array<{ id: string; scenarioNo: number | null; lender: string | null; monthlyPayment: string | null; depositMode: string | null; depositValue: string | null; isSaved: boolean }> }>;
    };
    const q = detail.quotes.find((x) => x.id === quoteId)!;
    expect(q.scenarios.length).toBe(3);
    const byNo = [...q.scenarios].sort((a, b) => (a.scenarioNo ?? 0) - (b.scenarioNo ?? 0));
    expect(byNo[0].lender).toBe("우리금융캐피탈");
    expect(byNo[0].depositMode).toBe("percent");
    expect(byNo[0].depositValue).toBe("30");
    expect(byNo[0].isSaved).toBe(true);
    expect(byNo[1].lender).toBe("iM캐피탈");
    expect(byNo[2].monthlyPayment).toBe("2550000");
    expect(q.primaryScenarioId).toBe(byNo[0].id);
  } finally {
    if (quoteId) await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});

test("견적 다중 시나리오(#4c-3a): scenario 단수 하위호환 — 1건 저장", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  let quoteId: string | null = null;
  try {
    const created = await app.request(`/api/customers/${cid}/quotes`, {
      method: "POST", headers: h,
      body: JSON.stringify({ entryMode: "manual", status: "작성중", scenario: { purchaseMethod: "할부", termMonths: 36, monthlyPayment: "1000000", lender: "iM캐피탈" } }),
    });
    expect(created.status).toBe(201);
    quoteId = ((await created.json()) as { id: string }).id;
    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      quotes: Array<{ id: string; scenarios: Array<{ scenarioNo: number | null; purchaseMethod: string | null }> }>;
    };
    const q = detail.quotes.find((x) => x.id === quoteId)!;
    expect(q.scenarios.length).toBe(1);
    expect(q.scenarios[0].scenarioNo).toBe(1);
    expect(q.scenarios[0].purchaseMethod).toBe("할부");
  } finally {
    if (quoteId) await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});

test("진행상태 검증: 종속 안 맞는 status → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  // 신규 그룹에 속하지 않는 "출고완료"(계약완료 소속) → 종속 위반.
  const res = await app.request(`/api/customers/${cid}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ statusGroup: "신규", status: "출고완료" }),
  });
  expect(res.status).toBe(400);
});

test("진행상태 검증: 없는 status → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const res = await app.request(`/api/customers/${list[0].id}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ statusGroup: "계약완료", status: "존재하지않는상태" }),
  });
  expect(res.status).toBe(400);
});

test("진행상태 검증: 유효한 group+status → 200(원복)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; statusGroup: string | null; status: string | null }>;
  const target = list[0];
  try {
    const res = await app.request(`/api/customers/${target.id}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ statusGroup: "계약완료", status: "출고완료" }),
    });
    expect(res.status).toBe(200);
  } finally {
    // 원래 값으로 복원(공유 master DB).
    await app.request(`/api/customers/${target.id}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ statusGroup: target.statusGroup, status: target.status }),
    });
  }
});

test("진행상태 검증: status 키 없는 PATCH는 검증 건너뜀 → 200", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; source: string | null }>;
  const target = list[0];
  const res = await app.request(`/api/customers/${target.id}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ source: target.source }),
  });
  expect(res.status).toBe(200);
});

test("chance 검증: 없는 chance 값 → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const res = await app.request(`/api/customers/${list[0].id}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ chance: "존재하지않는값" }),
  });
  expect(res.status).toBe(400);
});

test("chance 검증: 유효한 chance → 200(원복)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; chance: string | null }>;
  const target = list[0];
  try {
    const res = await app.request(`/api/customers/${target.id}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ chance: "높음" }),
    });
    expect(res.status).toBe(200);
  } finally {
    // 원래 값으로 복원(공유 master DB).
    await app.request(`/api/customers/${target.id}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ chance: target.chance }),
    });
  }
});

test("chance 검증: chance=null(해제)은 통과 → 200", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; chance: string | null }>;
  const target = list[0];
  try {
    const res = await app.request(`/api/customers/${target.id}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ chance: null }),
    });
    expect(res.status).toBe(200);
  } finally {
    await app.request(`/api/customers/${target.id}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ chance: target.chance }),
    });
  }
});

test("서류 doc_type 검증: 업로드 시 없는 docType → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }));
  fd.append("docType", "존재하지않는종류");
  const res = await app.request(`/api/customers/${list[0].id}/documents`, { method: "POST", headers: auth, body: fd });
  expect(res.status).toBe(400);
});

test("서류 doc_type 검증: 유효 docType 업로드→PATCH(없는값 400·유효 200)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const h = { ...auth, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1, 2, 3])], "사업자등록증.png", { type: "image/png" }));
  fd.append("docType", "사업자등록증");
  const up = await app.request(`/api/customers/${cid}/documents`, { method: "POST", headers: auth, body: fd });
  expect(up.status).toBe(201);
  const doc = (await up.json()) as { id: string };
  try {
    const bad = await app.request(`/api/customers/${cid}/documents/${doc.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ docType: "없는종류" }) });
    expect(bad.status).toBe(400);
    const ok = await app.request(`/api/customers/${cid}/documents/${doc.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ docType: "기타서류" }) });
    expect(ok.status).toBe(200);
  } finally {
    // 공유 master DB라 throwaway 서류 정리.
    await getDefaultDb().delete(customerDocuments).where(eq(customerDocuments.id, doc.id));
  }
});

test("source 검증: 없는 source → 400 / 유효 → 200(원복)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; source: string | null }>;
  const target = list[0];
  expect((await app.request(`/api/customers/${target.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ source: "없는경로" }) })).status).toBe(400);
  try {
    expect((await app.request(`/api/customers/${target.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ source: "대표전화" }) })).status).toBe(200);
  } finally {
    await app.request(`/api/customers/${target.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ source: target.source }) });
  }
});

test("task category 검증: 없는 category POST → 400, 유효 → 201", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  expect((await app.request(`/api/customers/${cid}/tasks`, { method: "POST", headers: h, body: JSON.stringify({ category: "없는분류", body: "x" }) })).status).toBe(400);
  const ok = await app.request(`/api/customers/${cid}/tasks`, { method: "POST", headers: h, body: JSON.stringify({ category: "견적", body: "x" }) });
  expect(ok.status).toBe(201);
  const taskId = ((await ok.json()) as { id: string }).id;
  await app.request(`/api/customers/${cid}/tasks/${taskId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
});

test("schedule type 검증: 없는 type POST → 400, 유효 → 201", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  expect((await app.request(`/api/customers/${cid}/schedules`, { method: "POST", headers: h, body: JSON.stringify({ type: "없는종류", scheduledDate: "2026-06-01" }) })).status).toBe(400);
  const ok = await app.request(`/api/customers/${cid}/schedules`, { method: "POST", headers: h, body: JSON.stringify({ type: "견적", scheduledDate: "2026-06-01" }) });
  expect(ok.status).toBe(201);
  const schId = ((await ok.json()) as { id: string }).id;
  await app.request(`/api/customers/${cid}/schedules/${schId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
});

test("customerType enum: 잘못된 값 → 400 / 유효 → 200(원복)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; customerType: string | null }>;
  const target = list[0];
  expect((await app.request(`/api/customers/${target.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ customerType: "외계인" }) })).status).toBe(400);
  try {
    expect((await app.request(`/api/customers/${target.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ customerType: "개인" }) })).status).toBe(200);
  } finally {
    await app.request(`/api/customers/${target.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ customerType: target.customerType }) });
  }
});

test("purchaseMethod enum: 잘못된 값 견적 생성 → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const res = await app.request(`/api/customers/${cid}/quotes`, {
    method: "POST", headers: h,
    body: JSON.stringify({ entryMode: "manual", scenario: { purchaseMethod: "비교 견적" } }),
  });
  expect(res.status).toBe(400);
});
