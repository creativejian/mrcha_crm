import { test, expect, beforeAll, afterAll } from "bun:test";
import { and, eq, sql } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { profiles, quoteRequests } from "../db/public-app";
import { customers, embeddings, quotes } from "../db/schema";
import { kstDateOf } from "../lib/kst-date";
import { EMBEDDING_DIM } from "../lib/gemini-embed";
import { embedOnWriteDeps } from "../lib/embed-on-write";

const db = getDefaultDb();
const ORIGINAL_EMBED = embedOnWriteDeps.embedTexts;
const SAVED_FLAG = process.env.EMBED_ON_WRITE;
let CUST = "";
let embedCalls = 0;
let auth: Awaited<ReturnType<typeof makeTestAuth>>;

beforeAll(async () => {
  // 게이트 개방(test:server 기본 off) + embedTexts만 fake(고정 벡터·실 Gemini 차단). DB deps는 실물 —
  // crm.embeddings 실 왕복까지 검증하는 통합 테스트다.
  process.env.EMBED_ON_WRITE = "on";
  embedOnWriteDeps.embedTexts = async (texts) => { embedCalls++; return texts.map(() => Array.from({ length: EMBEDDING_DIM }, () => 0.01)); };
  auth = await makeTestAuth("admin");
  // 랜덤 서픽스 — 공유 master 재실행 트랩 방지(afterAll 실패/강제 종료로 고아 행이 남아도 다음 실행이 unique 위반으로 연쇄 실패하지 않게).
  const [c] = await db.insert(customers).values({ customerCode: `CU-EMBRT-${crypto.randomUUID().slice(0, 8)}`, name: "배선테스트" }).returning({ id: customers.id });
  CUST = c.id;
});

afterAll(async () => {
  embedOnWriteDeps.embedTexts = ORIGINAL_EMBED;
  if (SAVED_FLAG !== undefined) process.env.EMBED_ON_WRITE = SAVED_FLAG; else delete process.env.EMBED_ON_WRITE;
  await db.delete(quotes).where(eq(quotes.customerId, CUST)); // customers FK에 cascade 없음 — 견적 먼저
  await db.delete(customers).where(eq(customers.id, CUST)); // 메모·임베딩은 FK cascade
});

// 훅은 응답 후 비동기 — 조건 충족까지 폴링(최대 timeoutMs).
async function until(cond: () => Promise<boolean> | boolean, timeoutMs = 3000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - t0 > timeoutMs) throw new Error("until: 조건 미충족 타임아웃");
    await Bun.sleep(25);
  }
}

async function embeddingRow(sourceType: string, sourceId: string) {
  const rows = await db
    .select({ content: embeddings.content, customerId: embeddings.customerId })
    .from(embeddings)
    .where(and(eq(embeddings.sourceType, sourceType), eq(embeddings.sourceId, sourceId)));
  return rows[0] ?? null;
}

test("메모 POST → 임베딩 행 생성(비동기), 동일 내용 재저장은 hash skip", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  const res = await app.request(`/api/customers/${CUST}/memos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "임베딩 배선 검증 메모" }),
  });
  expect(res.status).toBe(201);
  const memo = (await res.json()) as { id: string };

  await until(async () => (await embeddingRow("memo", memo.id)) != null);
  const row = await embeddingRow("memo", memo.id);
  expect(row?.content).toBe("고객 배선테스트 상담메모: 임베딩 배선 검증 메모");
  expect(row?.customerId).toBe(CUST);
  const callsAfterInsert = embedCalls;

  // 동일 본문 PATCH → fresh read 콘텐츠 불변 → hash skip(Gemini 미호출)
  const patch = await app.request(`/api/customers/${CUST}/memos/${memo.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "임베딩 배선 검증 메모" }),
  });
  expect(patch.status).toBe(200);
  await Bun.sleep(300); // 훅이 돌 시간 — skip이면 호출 수 불변
  expect(embedCalls).toBe(callsAfterInsert);

  // DELETE → 임베딩 행 동기 제거
  const del = await app.request(`/api/customers/${CUST}/memos/${memo.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(del.status).toBe(200);
  expect(await embeddingRow("memo", memo.id)).toBeNull(); // 폴링 불필요 — 삭제는 동기(스펙 결정 6)
});

test("니즈 필드 PATCH → need_memo 임베딩, 비우면 행 삭제", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  const res = await app.request(`/api/customers/${CUST}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ needMemo: "GLC 재고 확인 필요" }),
  });
  expect(res.status).toBe(200);
  await until(async () => (await embeddingRow("need_memo", CUST)) != null);
  expect((await embeddingRow("need_memo", CUST))?.content).toBe("고객 배선테스트 니즈메모: GLC 재고 확인 필요");

  const clear = await app.request(`/api/customers/${CUST}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ needMemo: "" }),
  });
  expect(clear.status).toBe(200);
  await until(async () => (await embeddingRow("need_memo", CUST)) == null); // 빈 텍스트 → 훅이 행 삭제
});

test("견적 POST(트랜잭션) → quote 임베딩, DELETE → 동기 제거", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  const res = await app.request(`/api/customers/${CUST}/quotes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ brandName: "BMW", modelName: "320i", trimName: "320i M Sport", scenario: { purchaseMethod: "운용리스", termMonths: 60, monthlyPayment: "2350000", lender: "하나캐피탈" } }),
  });
  expect(res.status).toBe(201);
  const quote = (await res.json()) as { id: string; quoteCode: string };

  await until(async () => (await embeddingRow("quote", quote.id)) != null);
  const row = await embeddingRow("quote", quote.id);
  expect(row?.content).toContain(quote.quoteCode);
  expect(row?.content).toContain("BMW 320i M Sport");
  expect(row?.content).toContain("운용리스");

  const del = await app.request(`/api/customers/${CUST}/quotes/${quote.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(del.status).toBe(200);
  expect(await embeddingRow("quote", quote.id)).toBeNull();
});

test("일정 POST → schedule 임베딩, done 토글 재임베딩, 전체 비움 → 행 삭제, DELETE → 동기 제거", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  const res = await app.request(`/api/customers/${CUST}/schedules`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ scheduledDate: "2026-07-08", scheduledTime: "14:00", type: "재연락", memo: "임베딩 배선 검증 일정" }),
  });
  expect(res.status).toBe(201);
  const schedule = (await res.json()) as { id: string };

  await until(async () => (await embeddingRow("schedule", schedule.id)) != null);
  expect((await embeddingRow("schedule", schedule.id))?.content).toBe(
    "고객 배선테스트 일정: 2026-07-08(수) 14:00 · 재연락 · 임베딩 배선 검증 일정",
  );

  // done 토글 → 완료 라벨로 content 변경(재임베딩)
  const donePatch = await app.request(`/api/customers/${CUST}/schedules/${schedule.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ done: true }),
  });
  expect(donePatch.status).toBe(200);
  await until(async () => (await embeddingRow("schedule", schedule.id))?.content.endsWith("완료") === true);

  // 실질 필드 전체 비움 → 빈 텍스트 → 훅이 임베딩 행 삭제(일정 행은 잔존)
  const clear = await app.request(`/api/customers/${CUST}/schedules/${schedule.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ scheduledDate: null, scheduledTime: null, type: null, memo: null }),
  });
  expect(clear.status).toBe(200);
  await until(async () => (await embeddingRow("schedule", schedule.id)) == null);

  // 재작성 후 DELETE → 동기 제거
  const refill = await app.request(`/api/customers/${CUST}/schedules/${schedule.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ memo: "삭제 검증" }),
  });
  expect(refill.status).toBe(200);
  await until(async () => (await embeddingRow("schedule", schedule.id)) != null);
  const del = await app.request(`/api/customers/${CUST}/schedules/${schedule.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(del.status).toBe(200);
  expect(await embeddingRow("schedule", schedule.id)).toBeNull();
});

test("서류 업로드 → customer_documents aggregate 임베딩(목록), 분류 변경 재임베딩, 마지막 삭제 → 행 제거", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  const authH = { Authorization: `Bearer ${auth.token}` };
  const upload = async (name: string, docType: string) => {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([1, 2, 3, 4])], name, { type: "image/png" }));
    fd.append("docType", docType);
    const res = await app.request(`/api/customers/${CUST}/documents`, { method: "POST", headers: authH, body: fd });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };

  // 2건 업로드 — aggregate 청크(source_id = 고객 id)에 업로드 순 목록
  const doc1 = await upload("면허.png", "면허증");
  const doc2 = await upload("사업자.png", "사업자등록증");
  const today = kstDateOf(new Date());
  await until(async () => {
    const c = (await embeddingRow("customer_documents", CUST))?.content;
    return c === `고객 배선테스트 서류함: 면허증 면허.png (${today} 업로드) · 사업자등록증 사업자.png (${today} 업로드)`;
  });

  // 분류 변경 → 목록 재임베딩
  const patch = await app.request(`/api/customers/${CUST}/documents/${doc2}`, {
    method: "PATCH",
    headers: { ...authH, "Content-Type": "application/json" },
    body: JSON.stringify({ docType: "주민등록등본" }),
  });
  expect(patch.status).toBe(200);
  await until(async () => ((await embeddingRow("customer_documents", CUST))?.content ?? "").includes("주민등록등본 사업자.png"));

  // 1건 삭제 → 남은 목록으로 갱신(동기 삭제 아님 — aggregate)
  const del1 = await app.request(`/api/customers/${CUST}/documents/${doc1}`, { method: "DELETE", headers: authH });
  expect(del1.status).toBe(200);
  await until(async () => {
    const c = (await embeddingRow("customer_documents", CUST))?.content ?? "";
    return !c.includes("면허.png") && c.includes("사업자.png");
  });

  // 마지막 삭제 → 빈 목록 → 임베딩 행 제거
  const del2 = await app.request(`/api/customers/${CUST}/documents/${doc2}`, { method: "DELETE", headers: authH });
  expect(del2.status).toBe(200);
  await until(async () => (await embeddingRow("customer_documents", CUST)) == null);
});

test("견적요청 승격(create-customer) → quote_request 임베딩(훅), 정리 후 고아 없음", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  // crm 고객이 없는 실 profile 1명 — 승격이 신규 고객을 만들고 그 유저의 요청을 임베딩하는 전체 경로 재현.
  // (user_id FK → profiles라 합성 uuid 불가. 전원 연결돼 있으면 검증 불가라 조기 실패로 드러낸다.)
  const [freeProfile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(sql`not exists (select 1 from crm.customers c where c.app_user_id = ${profiles.id})`)
    .limit(1);
  expect(freeProfile).toBeDefined();

  const reqId = crypto.randomUUID();
  await db.insert(quoteRequests).values({
    id: reqId, userId: freeProfile.id, trimId: null, paymentMethod: "lease", period: 36,
    depositType: "deposit", depositRatio: 10, rentalDeposit: 1000000, trimPrice: 30000000,
    status: "open", createdAt: new Date().toISOString(),
  });
  let createdCustomerId = "";
  try {
    const res = await app.request(`/api/quote-requests/${reqId}/create-customer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(res.status).toBe(200);
    createdCustomerId = ((await res.json()) as { id: string }).id;
    // 승격은 **실 profile의 실명**으로 실채번(CU-YYMM-####) 고객을 만든다 — 접두사·이름 registry
    // 어느 쪽으로도 못 잡는 잔재라, 확보 즉시 registry 등록 이름(TEST_CUSTOMER_NAMES)으로 교체해
    // 무방비 창을 "테스트 전체"에서 "이 두 문장 사이"로 줄인다. 아래 임베딩 단언은 이름 비의존.
    await db.update(customers).set({ name: "승격배선테스트" }).where(eq(customers.id, createdCustomerId));

    await until(async () => (await embeddingRow("quote_request", reqId)) != null);
    const row = await embeddingRow("quote_request", reqId);
    expect(row?.customerId).toBe(createdCustomerId);
    expect(row?.content).toContain("운용리스 · 36개월 · 보증금 10% 1,000,000원");
    expect(row?.content).toContain("차량가 30,000,000원");
    expect(row?.content).not.toContain("open"); // status 미포함(스테일 박제 방지)

    // 승격 INSERT가 시드한 프로필 필드(source/needMethod)의 customer_profile 청크도 함께 적재 —
    // 고객 PATCH 훅(CUSTOMER_PROFILE_EMBED_KEYS)과 동일 불변을 승격 write 경로에도 잠근다.
    await until(async () => (await embeddingRow("customer_profile", createdCustomerId)) != null);
    const profileRow = await embeddingRow("customer_profile", createdCustomerId);
    expect(profileRow?.content).toContain("상담경로 앱 견적요청");
    expect(profileRow?.content).toContain("구매방식 운용리스");
  } finally {
    // 고객 삭제(임베딩 FK cascade) → 스모크 요청 삭제 — 공유 master 원복.
    if (createdCustomerId) await db.delete(customers).where(eq(customers.id, createdCustomerId));
    await db.delete(quoteRequests).where(eq(quoteRequests.id, reqId));
  }
});

test("404 경로는 스케줄 안 함 — 없는 메모 PATCH에 임베딩 호출 0", async () => {
  const app = createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
  const before = embedCalls;
  const res = await app.request(`/api/customers/${CUST}/memos/00000000-0000-0000-0000-000000000000`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "유령" }),
  });
  expect(res.status).toBe(404);
  await Bun.sleep(200);
  expect(embedCalls).toBe(before);
});
