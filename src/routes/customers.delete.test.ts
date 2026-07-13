import { mock } from "bun:test";

// Storage 호출 인자를 붙잡는다 — 고객 삭제가 서류 원본·썸네일·견적 원본을 전부 지우는지 단언한다.
// (routes/customers.test.ts 상단 관례: import보다 먼저 모듈을 갈아끼운다.)
const removedPaths: string[] = [];
mock.module("../lib/storage", () => ({
  uploadObject: async () => {},
  removeObject: async (_env: unknown, path: string) => { removedPaths.push(path); },
  // 고객 하드 삭제는 배열 1왕복(removeObjects)을 쓴다(0713) — 단건과 같은 버킷에 수집해 단언 불변.
  removeObjects: async (_env: unknown, paths: string[]) => { removedPaths.push(...paths); },
  createSignedUrl: async (_env: unknown, path: string) => `https://example.test/${path}`,
}));

import { afterEach, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { createQuote, updateQuote } from "../db/queries/customer-quotes";
import { advisorQuotes, profiles } from "../db/public-app";
import {
  customerDeletions, customerDocuments, customerMemos, customerSchedules,
  customers, customerTasks, embeddings, quotes,
} from "../db/schema";
import { withNotifyGuard } from "../test-utils/notify-gate";

const db = getDefaultDb();

afterEach(() => { removedPaths.length = 0; });

async function anyProfileId(): Promise<string> {
  const [row] = await db.select({ id: profiles.id }).from(profiles).limit(1);
  if (!row) throw new Error("profiles가 비어 있어 테스트 불가(실 master DB 전제)");
  return row.id;
}

async function seedCustomer(appUserId: string | null = null): Promise<string> {
  const [c] = await db
    .insert(customers)
    .values({ customerCode: `CU-DEL-${crypto.randomUUID().slice(0, 8)}`, name: "삭제테스트", appUserId })
    .returning({ id: customers.id });
  return c.id;
}

// 공유 master라 어떤 결과든 정리. 삭제가 성공했으면 no-op이 된다.
async function cleanup(customerId: string): Promise<void> {
  const qs = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.customerId, customerId));
  for (const q of qs) await db.delete(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, q.id));
  await db.delete(quotes).where(eq(quotes.customerId, customerId));
  await db.delete(customers).where(eq(customers.id, customerId));
  await db.delete(customerDeletions).where(eq(customerDeletions.customerId, customerId));
}

// makeTestAuth의 기본 sub는 "test-user"(uuid 아님)라 감사 행의 deleted_by(uuid)에 못 들어간다.
// prod의 JWT sub는 profiles.id(uuid)이므로 테스트도 uuid를 주입한다. loose id라 FK는 없다.
const DELETED_BY = "9b1b3bc3-ce2f-48be-8ee2-5b0058d0d668";
function authed(role: "admin" | "manager" | "staff" | "dealer") {
  return makeTestAuth(role, DELETED_BY);
}

const baseQuote = {
  brandName: "테스트브랜드", modelName: "테스트모델", trimName: "테스트트림",
  scenarios: [{ scenarioNo: 1, purchaseMethod: "운용리스" as const, termMonths: 48, monthlyPayment: "1000000" }],
};

// ── 역할 게이트 ────────────────────────────────────────────────────
// 인증 미들웨어는 CRM_ROLES(staff·manager·admin·dealer) 중 하나면 통과시킨다.
// 라우트별 역할 검사가 없으면 버튼을 숨겨도 curl 한 번에 뚫린다 — 서버가 진짜 게이트다.

for (const role of ["manager", "staff", "dealer"] as const) {
  test(`DELETE /api/customers/:id — ${role}는 403 (fail-closed)`, async () => {
    const { token, keyResolver, issuer } = await authed(role);
    const app = createApp({ keyResolver, issuer });
    const cid = await seedCustomer();
    try {
      const res = await app.request(`/api/customers/${cid}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(403);
      // 403이면 행이 살아 있어야 한다 — 게이트가 실행 전에 막는지 확인
      const [alive] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, cid));
      expect(alive?.id).toBe(cid);
    } finally {
      await cleanup(cid);
    }
  });
}

test("DELETE /api/customers/:id — 없는 uuid는 404", async () => {
  const { token, keyResolver, issuer } = await authed("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/customers/00000000-0000-0000-0000-000000000000", {
    method: "DELETE", headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(404);
});

// ── 앱 카드 가드 ───────────────────────────────────────────────────
// 고객 삭제가 앱 견적 카드를 조용히 연쇄 삭제해서는 안 된다(2026-07-10 이사님 결정).
// 지우려면 견적함에서 견적을 먼저 삭제해 카드를 회수하는 명시적 2단계를 밟는다.

test("DELETE /api/customers/:id — 앱에 발송한 견적이 있으면 409, 고객은 살아 있다", async () => {
  const { token, keyResolver, issuer } = await authed("admin");
  const app = createApp({ keyResolver, issuer });
  const userId = await anyProfileId();
  const cid = await seedCustomer(userId);
  try {
    const created = await createQuote(cid, baseQuote, db);
    // 발송 = advisor_quotes upsert. 알림 트리거가 물려 있어 반드시 guard 안에서.
    await withNotifyGuard(db, (tx) => updateQuote(cid, created.id, { appStatus: "sent" }, tx));

    const res = await app.request(`/api/customers/${cid}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("앱으로 발송한 견적이 1건");

    // 가드가 트랜잭션 안이라 아무것도 지워지지 않아야 한다
    const [alive] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, cid));
    expect(alive?.id).toBe(cid);
    const cards = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, created.id));
    expect(cards).toHaveLength(1);
    expect(removedPaths).toEqual([]); // Storage도 건드리면 안 된다
  } finally {
    await cleanup(cid);
  }
});

// ── 정상 삭제 ──────────────────────────────────────────────────────

test("DELETE /api/customers/:id — 자식 전부 CASCADE + 임베딩 0건 + 감사 행 1건 + Storage 정리", async () => {
  const { token, keyResolver, issuer } = await authed("admin");
  const app = createApp({ keyResolver, issuer });
  const cid = await seedCustomer();
  try {
    await db.insert(customerMemos).values({ customerId: cid, body: "메모" });
    await db.insert(customerTasks).values({ customerId: cid, body: "할일", category: "체크" });
    await db.insert(customerSchedules).values({ customerId: cid, scheduledDate: "2026-07-15", memo: "일정" });
    await db.insert(customerDocuments).values({
      customerId: cid, docType: "면허증", fileName: "a.pdf",
      filePath: "docs/a.pdf", thumbPath: "docs/a-thumb.jpg", sortOrder: 1,
    });
    // 미발송 견적 + 업로드된 원본 파일 (기존 결함 — 견적 삭제가 Storage를 안 지우던 것도 여기서 잡힌다)
    const q = await createQuote(cid, baseQuote, db);
    await db.update(quotes).set({ filePath: "quotes/orig.pdf" }).where(eq(quotes.id, q.id));
    // 업무 AI 코퍼스 — FK CASCADE가 지운다. 나중에 FK가 바뀌면 AI가 유령 고객을 기억한다.
    await db.execute(sql`
      insert into crm.embeddings (source_type, source_id, customer_id, content, content_hash, embedding)
      values ('memo', gen_random_uuid(), ${cid}::uuid, '삭제테스트 메모', 'h1',
              array_fill(0.01::real, ARRAY[3072])::vector)`);

    const res = await app.request(`/api/customers/${cid}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { id: string }).toEqual({ id: cid });

    const gone = async (t: typeof customerMemos | typeof customerTasks | typeof customerSchedules | typeof customerDocuments | typeof quotes | typeof embeddings) =>
      (await db.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.customerId, cid)))[0].n;
    expect(await gone(customerMemos)).toBe(0);
    expect(await gone(customerTasks)).toBe(0);
    expect(await gone(customerSchedules)).toBe(0);
    expect(await gone(customerDocuments)).toBe(0);
    expect(await gone(quotes)).toBe(0);
    expect(await gone(embeddings)).toBe(0); // 업무 AI가 이 고객을 완전히 잊는다
    const [alive] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, cid));
    expect(alive).toBeUndefined();

    // 감사 — 되돌릴 수 없는 조작이라 누가·언제·무엇을이 남는다
    const audit = await db.select().from(customerDeletions).where(eq(customerDeletions.customerId, cid));
    expect(audit).toHaveLength(1);
    expect(audit[0].name).toBe("삭제테스트");
    expect(audit[0].quoteCount).toBe(1);
    expect(audit[0].deletedBy).toBe(DELETED_BY);

    // Storage: 서류 원본·썸네일 + 견적 원본 3개 전부
    expect(removedPaths.sort()).toEqual(["docs/a-thumb.jpg", "docs/a.pdf", "quotes/orig.pdf"]);
  } finally {
    await cleanup(cid);
  }
});

test("DELETE /api/customers/:id — 앱 계정 연결 고객도 삭제된다(카드만 없으면). profiles는 불가침", async () => {
  const { token, keyResolver, issuer } = await authed("admin");
  const app = createApp({ keyResolver, issuer });
  const userId = await anyProfileId();
  const cid = await seedCustomer(userId);
  try {
    const res = await app.request(`/api/customers/${cid}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const [audit] = await db.select().from(customerDeletions).where(eq(customerDeletions.customerId, cid));
    expect(audit.appUserId).toBe(userId); // 앱 연결 고객이었음이 기록된다

    // 앱 계정은 그대로 — 다음 견적요청 때 인박스에 승격 대기로 다시 뜬다
    const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, userId));
    expect(p?.id).toBe(userId);
  } finally {
    await cleanup(cid);
  }
});

// ── 기존 결함 회귀(2026-07-10 발견) ────────────────────────────────
// 서류 삭제 라우트는 removeOrphanObject로 원본·썸네일을 지우는데, 견적 삭제 라우트는
// Storage를 전혀 지우지 않아 crm.quotes.file_path가 고아로 쌓이고 있었다. 고객 삭제와 무관한 별개 결함.
test("DELETE /api/customers/:id/quotes/:childId — 업로드된 견적 원본을 Storage에서도 지운다", async () => {
  const { token, keyResolver, issuer } = await authed("admin");
  const app = createApp({ keyResolver, issuer });
  const cid = await seedCustomer();
  try {
    const q = await createQuote(cid, baseQuote, db);
    await db.update(quotes).set({ filePath: "quotes/solo.pdf" }).where(eq(quotes.id, q.id));

    const res = await app.request(`/api/customers/${cid}/quotes/${q.id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(removedPaths).toEqual(["quotes/solo.pdf"]);
  } finally {
    await cleanup(cid);
  }
});

test("DELETE /api/customers/:id/quotes/:childId — 원본 없는 견적은 Storage를 건드리지 않는다", async () => {
  const { token, keyResolver, issuer } = await authed("admin");
  const app = createApp({ keyResolver, issuer });
  const cid = await seedCustomer();
  try {
    const q = await createQuote(cid, baseQuote, db);
    const res = await app.request(`/api/customers/${cid}/quotes/${q.id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(removedPaths).toEqual([]);
  } finally {
    await cleanup(cid);
  }
});
