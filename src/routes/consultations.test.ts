import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { withNotifyGuard } from "../test-utils/notify-gate";
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

// 라우트는 consultations를 읽기만 한다(숨김은 crm.consultation_dismissals) — 픽스처 INSERT만
// 알림 트리거를 깨우므로 withNotifyGuard 트랜잭션 안에서 넣는다.
async function insertConsultation(
  overrides: Partial<typeof consultationRequests.$inferInsert> = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await withNotifyGuard(db, (tx) => tx.insert(consultationRequests).values({
    id,
    userId: null,
    customerName: `라우트테스트-${id.slice(0, 8)}`,
    phoneNumber: "01000000000",
    carModel: "BMW X5",
    notes: "리스 상담 원함",
    status: "pending",
    createdAt: new Date().toISOString(),
    ...overrides,
  }));
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

test("POST /api/consultations/:id/create-customer → 200, source=앱 상담신청·phone 미저장 (실 insert, finally 삭제)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const userId = await anyUnlinkedProfileId();
  // 이름은 registry(TEST_CUSTOMER_NAMES) 등록값 — 이 라우트가 실채번(CU-YYMM-####) 고객을 만들어
  // 접두사 registry가 못 잡는다. 중단 잔재는 이름 스캔이 잡는다.
  const consultationId = await insertConsultation({
    userId,
    customerName: "라우트승격테스트",
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
    expect(row.name).toBe("라우트승격테스트");
    expect(row.phone).toBeNull(); // 폼 phone 미저장(2026-07-17 spec §3-5) — 주 번호는 profiles read-through
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

// ── dismiss — customers 라우터 이사(배치 12 K1, V3 안 ②) ─────────────────────
// 구 DELETE /api/consultations/:id는 #302 인박스 전면 게이트에 걸려 staff의 드로어 상담신청 카드
// 삭제가 403 롤백으로 죽었다(부수 피해). 이사 후 = DELETE /api/customers/:id/consultations/:consultId
// — #301 customerScopeGate 자동 편입 + 소유권 검사(상담 user_id의 연결 고객 == URL 고객).
test("DELETE /api/customers/:id/consultations/:consultId → 200, CRM 뷰에서 숨겨지지만 public.consultations는 불변", async () => {
  // dismissed_by는 uuid 컬럼 — makeTestAuth 기본 sub("test-user")는 uuid가 아니라 insert가 실패하므로
  // 실 uuid sub를 명시 주입한다(me.test.ts/customers.push.test.ts와 동일 관례).
  const { token, keyResolver, issuer } = await makeTestAuth("admin", crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  const userId = await anyUnlinkedProfileId();
  const customerId = await insertCustomer({ appUserId: userId });
  const consultationId = await insertConsultation({ userId, notes: "삭제 테스트 원본" });
  try {
    const res = await app.request(`/api/customers/${customerId}/consultations/${consultationId}`, {
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

test("DELETE dismiss 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request(
    `/api/customers/${crypto.randomUUID()}/consultations/${crypto.randomUUID()}`,
    { method: "DELETE" },
  );
  expect(res.status).toBe(401);
});

test("dismiss — 소유권 불일치(타 유저 상담) → 404 + dismissal 행 0(무변이)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin", crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  const userId = await anyUnlinkedProfileId();
  const customerId = await insertCustomer({ appUserId: userId });
  // 상담은 다른(비연결) 유저 소유 — userId null이면 join 불성립이라 소유권 불일치와 동치.
  const consultationId = await insertConsultation({ userId: null, notes: "소유권 불일치 원본" });
  try {
    const res = await app.request(`/api/customers/${customerId}/consultations/${consultationId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("상담신청");
    const rows = await db.select({ id: consultationDismissals.consultationId }).from(consultationDismissals)
      .where(eq(consultationDismissals.consultationId, consultationId));
    expect(rows.length).toBe(0);
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    await db.delete(customers).where(eq(customers.id, customerId));
  }
});

test("dismiss — staff 본인 담당 200(K1-b 회귀 그물)", async () => {
  const staffSub = crypto.randomUUID();
  const { token, keyResolver, issuer } = await makeTestAuth("staff", staffSub);
  const app = createApp({ keyResolver, issuer });
  const userId = await anyUnlinkedProfileId();
  const customerId = await insertCustomer({ appUserId: userId, advisorId: staffSub, advisorName: "디스미스담당" });
  const consultationId = await insertConsultation({ userId, notes: "staff dismiss 원본" });
  try {
    const res = await app.request(`/api/customers/${customerId}/consultations/${consultationId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  } finally {
    await db.delete(consultationDismissals).where(eq(consultationDismissals.consultationId, consultationId));
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    await db.delete(customers).where(eq(customers.id, customerId));
  }
});
