import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { advisorQuotes, quoteRequests } from "../db/public-app";
import { customers, quotes } from "../db/schema";
import { setTestDb } from "../middleware/db";
import { guardedDb } from "../test-utils/notify-gate";
import { anyUnlinkedProfileId } from "../test-utils/profiles-fixture";

// ── 라우트 → updateQuote → syncAdvisorQuoteOnSend 통합 경로 ─────────────────
// 이 경로는 오랫동안 어떤 테스트도 타지 않았다. 발송 훅이 `public.advisor_quotes`에 쓰면
// on_advisor_quote_sent 트리거가 실 고객 FCM 푸시를 쏘기 때문이다(#199 오염 사고).
//
// 해법: `guardedDb`를 라우트에 주입해 라우트가 여는 트랜잭션마다 `app.skip_notify='on'`(SET LOCAL)을
// 켠다. INSERT/UPDATE는 그대로 되고 알림만 스킵된다.
//   · guardedDb가 GUC를 켠다           → src/test-utils/notify-gate.test.ts
//   · setTestDb가 라우트 db를 바꾼다   → src/middleware/db.test.ts
// 위 둘의 합성이 이 파일의 안전 근거다. 그래서 여기서는 업무 동작만 단언한다.

const db = getDefaultDb();

beforeAll(() => setTestDb(guardedDb(db)));
afterAll(() => setTestDb(null)); // 다른 테스트 파일로 새지 않게 반드시 원복


async function seedAppLinkedCustomer(appUserId: string): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({ customerCode: `CU-RSEND-${crypto.randomUUID().slice(0, 8)}`, name: "라우트발송테스트", appUserId })
    .returning({ id: customers.id });
  return row.id;
}

const quoteBody = {
  brandName: "테스트브랜드",
  modelName: "테스트모델",
  trimName: "테스트트림",
  basePrice: "50000000",
  optionTotal: "2000000",
  finalDiscount: "1000000",
  scenarios: [{ scenarioNo: 1, purchaseMethod: "운용리스", termMonths: 48, monthlyPayment: "1234567" }],
};

async function cleanup(ids: { quoteId?: string; customerId?: string; requestId?: string }): Promise<void> {
  if (ids.quoteId) {
    await db.delete(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, ids.quoteId));
    await db.delete(quotes).where(eq(quotes.id, ids.quoteId));
  }
  if (ids.customerId) await db.delete(customers).where(eq(customers.id, ids.customerId));
  if (ids.requestId) await db.delete(quoteRequests).where(eq(quoteRequests.id, ids.requestId));
}

async function authedApp() {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  return { app, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
}

test("라우트 통합: POST 견적 → PATCH appStatus=sent → advisor_quotes 카드가 커밋된다", async () => {
  const { app, headers } = await authedApp();
  const userId = await anyUnlinkedProfileId();
  const ids: { quoteId?: string; customerId?: string } = {};
  try {
    ids.customerId = await seedAppLinkedCustomer(userId);

    const created = await app.request(`/api/customers/${ids.customerId}/quotes`, {
      method: "POST", headers, body: JSON.stringify(quoteBody),
    });
    expect(created.status).toBe(201);
    const { id: quoteId } = (await created.json()) as { id: string };
    ids.quoteId = quoteId;

    const sent = await app.request(`/api/customers/${ids.customerId}/quotes/${quoteId}`, {
      method: "PATCH", headers, body: JSON.stringify({ appStatus: "sent" }),
    });
    expect(sent.status).toBe(200);

    // 응답이 끝난 뒤에도 남아 있어야 한다 = 라우트 트랜잭션이 커밋됐다.
    const rows = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, quoteId));
    expect(rows).toHaveLength(1);
    // 라우트가 param의 customerId를 훅까지 올바로 흘렸는지 — 잘못 넘기면 app_user_id를 못 찾아 행이 안 생긴다.
    expect(rows[0].userId).toBe(userId);
    expect(rows[0].monthlyPayment).toBe(1_234_567);
    expect(rows[0].vehicleLabel).toBe("테스트브랜드 테스트모델 테스트트림");

    const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
    expect(q.appStatus).toBe("sent");
    expect(q.sentAt).not.toBeNull();
    expect(q.validUntil).not.toBeNull(); // 서버 스탬프 +7일 — updateQuote와 훅이 같은 트랜잭션임의 방증
  } finally {
    await cleanup(ids);
  }
});

test("라우트 통합: 견적요청 연결 견적 발송 → quote_requests completed 전이", async () => {
  const { app, headers } = await authedApp();
  const userId = await anyUnlinkedProfileId();
  const ids: { quoteId?: string; customerId?: string; requestId?: string } = {};
  try {
    ids.requestId = crypto.randomUUID();
    await db.insert(quoteRequests).values({ id: ids.requestId, userId, trimId: null, status: "open", createdAt: new Date().toISOString() });
    ids.customerId = await seedAppLinkedCustomer(userId);

    const created = await app.request(`/api/customers/${ids.customerId}/quotes`, {
      method: "POST", headers, body: JSON.stringify({ ...quoteBody, sourceQuoteRequestId: ids.requestId }),
    });
    const { id: quoteId } = (await created.json()) as { id: string };
    ids.quoteId = quoteId;

    await app.request(`/api/customers/${ids.customerId}/quotes/${quoteId}`, {
      method: "PATCH", headers, body: JSON.stringify({ appStatus: "sent" }),
    });

    const [req] = await db.select({ status: quoteRequests.status }).from(quoteRequests).where(eq(quoteRequests.id, ids.requestId));
    expect(req.status).toBe("completed");
    const [row] = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, quoteId));
    expect(row.quoteRequestId).toBe(ids.requestId);
  } finally {
    await cleanup(ids);
  }
});

test("라우트 통합: DELETE 견적 → 보낸 카드 회수 + 요청 open 복원(트랜잭션 경계)", async () => {
  const { app, headers } = await authedApp();
  const userId = await anyUnlinkedProfileId();
  const ids: { quoteId?: string; customerId?: string; requestId?: string } = {};
  try {
    ids.requestId = crypto.randomUUID();
    await db.insert(quoteRequests).values({ id: ids.requestId, userId, trimId: null, status: "open", createdAt: new Date().toISOString() });
    ids.customerId = await seedAppLinkedCustomer(userId);

    const created = await app.request(`/api/customers/${ids.customerId}/quotes`, {
      method: "POST", headers, body: JSON.stringify({ ...quoteBody, sourceQuoteRequestId: ids.requestId }),
    });
    const { id: quoteId } = (await created.json()) as { id: string };
    ids.quoteId = quoteId;
    await app.request(`/api/customers/${ids.customerId}/quotes/${quoteId}`, {
      method: "PATCH", headers, body: JSON.stringify({ appStatus: "sent" }),
    });

    const removed = await app.request(`/api/customers/${ids.customerId}/quotes/${quoteId}`, { method: "DELETE", headers });
    expect(removed.status).toBe(200);

    const after = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, quoteId));
    expect(after).toHaveLength(0); // 앱에 유령 카드가 남지 않는다
    const [req] = await db.select({ status: quoteRequests.status }).from(quoteRequests).where(eq(quoteRequests.id, ids.requestId));
    expect(req.status).toBe("open"); // 마지막 카드 회수 → 요청은 다시 진행중
  } finally {
    await cleanup(ids);
  }
});

test("라우트 통합: 앱 미연결 고객은 발송해도 advisor_quotes를 쓰지 않는다(스탬프만)", async () => {
  const { app, headers } = await authedApp();
  const ids: { quoteId?: string; customerId?: string } = {};
  try {
    const [row] = await db
      .insert(customers)
      .values({ customerCode: `CU-RSEND-${crypto.randomUUID().slice(0, 8)}`, name: "라우트발송미연결" })
      .returning({ id: customers.id });
    ids.customerId = row.id;

    const created = await app.request(`/api/customers/${ids.customerId}/quotes`, {
      method: "POST", headers, body: JSON.stringify(quoteBody),
    });
    const { id: quoteId } = (await created.json()) as { id: string };
    ids.quoteId = quoteId;

    const sent = await app.request(`/api/customers/${ids.customerId}/quotes/${quoteId}`, {
      method: "PATCH", headers, body: JSON.stringify({ appStatus: "sent" }),
    });
    expect(sent.status).toBe(200);

    const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
    expect(q.appStatus).toBe("sent");
    const rows = await db.select().from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, quoteId));
    expect(rows).toHaveLength(0);
  } finally {
    await cleanup(ids);
  }
});
