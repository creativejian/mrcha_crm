import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { consultationRequests, profiles } from "../db/public-app";
import { consultationDismissals, customers } from "../db/schema";

const db = getDefaultDb();

// consultations.test.ts(쿼리 계층)의 helper 미러 — create/link가 "기존 연결 고객 없음" 분기를
// 결정적으로 타야 한다(공유 master, 일부 profile은 이미 customers.app_user_id에 연결돼 있음).
async function anyUnlinkedProfileId(): Promise<string> {
  const allProfiles = await db.select({ id: profiles.id }).from(profiles);
  const linkedRows = await db.select({ appUserId: customers.appUserId }).from(customers);
  const linked = new Set(linkedRows.map((r) => r.appUserId).filter((v): v is string => v != null));
  const free = allProfiles.find((p) => !linked.has(p.id));
  if (!free) throw new Error("연결되지 않은 profile이 없어 테스트 불가(실 master DB 전제)");
  return free.id;
}

async function insertConsultation(
  overrides: Partial<typeof consultationRequests.$inferInsert> = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(consultationRequests).values({
    id,
    userId: null,
    customerName: `라우트테스트-${id.slice(0, 8)}`,
    phoneNumber: "01000000000",
    carModel: "BMW X5",
    notes: "리스 상담 원함",
    status: "pending",
    createdAt: new Date().toISOString(),
    ...overrides,
  });
  return id;
}

async function insertCustomer(
  overrides: Partial<typeof customers.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({
      customerCode: `CU-CONSULT-RT-${crypto.randomUUID().slice(0, 8)}`,
      name: "상담통합 라우트 테스트고객",
      source: "카카오",
      statusGroup: "신규",
      status: "상담접수",
      ...overrides,
    })
    .returning({ id: customers.id });
  return row.id;
}

test("GET /api/consultations → 200, 배열", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/consultations", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

test("GET /api/consultations 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/consultations");
  expect(res.status).toBe(401);
});

test("POST /api/consultations/:id/create-customer → 200, source=앱 상담신청 + 폼 phone (실 insert, finally 삭제)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const userId = await anyUnlinkedProfileId();
  const consultationId = await insertConsultation({
    userId,
    customerName: "박라우트",
    phoneNumber: "01077778888",
    carModel: "아우디 Q7",
  });
  let customerId: string | null = null;
  try {
    const res = await app.request(`/api/consultations/${consultationId}/create-customer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; customerCode: string; name: string; appUserId: string };
    customerId = body.id;
    expect(body.appUserId).toBe(userId);
    expect(body.customerCode).toMatch(/^CU-\d{4}-\d{4}$/);

    const [row] = await db.select().from(customers).where(eq(customers.id, body.id));
    expect(row.name).toBe("박라우트");
    expect(row.phone).toBe("01077778888");
    expect(row.source).toBe("앱 상담신청");
    expect(row.needModel).toBe("아우디 Q7");
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    if (customerId) await db.delete(customers).where(eq(customers.id, customerId));
  }
});

test("POST /api/consultations/:id/create-customer → userId 없는 상담신청은 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const consultationId = await insertConsultation({ userId: null });
  try {
    const res = await app.request(`/api/consultations/${consultationId}/create-customer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
  }
});

test("GET /api/customers/:id/consultations → 그 고객(app_user_id)의 상담신청만 반환, 수기 고객은 빈 배열", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const userId = await anyUnlinkedProfileId();
  const customerId = await insertCustomer({ appUserId: userId });
  const consultationId = await insertConsultation({ userId });
  const manualCustomerId = await insertCustomer(); // appUserId 없음(수기 고객)
  try {
    const res = await app.request(`/api/customers/${customerId}/consultations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((r) => r.id)).toContain(consultationId);

    const manualRes = await app.request(`/api/customers/${manualCustomerId}/consultations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(manualRes.status).toBe(200);
    expect(await manualRes.json()).toEqual([]);
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    await db.delete(customers).where(eq(customers.id, customerId));
    await db.delete(customers).where(eq(customers.id, manualCustomerId));
  }
});

test("GET /api/customers/:id/consultations → 없는 고객 id는 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/customers/00000000-0000-0000-0000-000000000000/consultations", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(404);
});

test("DELETE /api/consultations/:id → 200, CRM 뷰에서 숨겨지지만 public.consultations는 불변", async () => {
  // dismissed_by는 uuid 컬럼 — makeTestAuth 기본 sub("test-user")는 uuid가 아니라 insert가 실패하므로
  // 실 uuid sub를 명시 주입한다(me.test.ts/customers.push.test.ts와 동일 관례).
  const { token, keyResolver, issuer } = await makeTestAuth("admin", crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  const userId = await anyUnlinkedProfileId();
  const customerId = await insertCustomer({ appUserId: userId });
  const consultationId = await insertConsultation({ userId, notes: "삭제 테스트 원본" });
  try {
    const res = await app.request(`/api/consultations/${consultationId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(consultationId);

    // CRM 고객 상세 카드 목록에서 사라져야 한다.
    const listRes = await app.request(`/api/customers/${customerId}/consultations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listBody = (await listRes.json()) as Array<{ id: string }>;
    expect(listBody.map((r) => r.id)).not.toContain(consultationId);

    // 핵심 불변조건: public.consultations 원본 행은 절대 삭제/변경되지 않는다.
    const [row] = await db.select().from(consultationRequests).where(eq(consultationRequests.id, consultationId));
    expect(row).toBeDefined();
    expect(row?.notes).toBe("삭제 테스트 원본");
  } finally {
    await db.delete(consultationDismissals).where(eq(consultationDismissals.consultationId, consultationId));
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    await db.delete(customers).where(eq(customers.id, customerId));
  }
});

test("DELETE /api/consultations/:id 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/consultations/00000000-0000-0000-0000-000000000000", { method: "DELETE" });
  expect(res.status).toBe(401);
});
