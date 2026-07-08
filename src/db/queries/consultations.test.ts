import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";

import { ConflictError } from "../../lib/errors";
import { getDefaultDb } from "../client";
import { consultationRequests, profiles } from "../public-app";
import { consultationDismissals, customers } from "../schema";
import {
  createCustomerFromConsultation,
  dismissConsultation,
  linkConsultationToCustomer,
  listConsultations,
  listConsultationsByUser,
} from "./consultations";

const db = getDefaultDb();

// 공유 master 실DB — user_id FK(profiles) 때문에 실존 profile id가 필요하다(읽기만, 수정 금지).
async function anyProfileId(): Promise<string> {
  const [row] = await db.select({ id: profiles.id }).from(profiles).limit(1);
  if (!row) throw new Error("profiles가 비어 있어 테스트 불가(실 master DB 전제)");
  return row.id;
}

// create/link 테스트는 "기존 연결 고객 없음" 분기를 결정적으로 타야 한다 — limit(1)로 아무 profile이나
// 집으면 이미 다른 customer에 연결된 profile을 뽑아 매번 스킵될 위험(공유 master, 실측 11명 중 2명 연결).
// customers.app_user_id에 없는 profile을 명시적으로 찾아 매 실행 결정적으로 통과시킨다.
async function anyUnlinkedProfileId(): Promise<string> {
  const allProfiles = await db.select({ id: profiles.id }).from(profiles);
  const linkedRows = await db.select({ appUserId: customers.appUserId }).from(customers);
  const linked = new Set(linkedRows.map((r) => r.appUserId).filter((v): v is string => v != null));
  const free = allProfiles.find((p) => !linked.has(p.id));
  if (!free) throw new Error("연결되지 않은 profile이 없어 테스트 불가(실 master DB 전제)");
  return free.id;
}

// 상담신청 픽스처 insert. id는 매 테스트 randomUUID로 충돌 방지(공유 master DB).
async function insertConsultation(
  overrides: Partial<typeof consultationRequests.$inferInsert> = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(consultationRequests).values({
    id,
    userId: null,
    customerName: `상담테스트-${id.slice(0, 8)}`,
    phoneNumber: "01000000000",
    carModel: "BMW X5",
    notes: "리스 상담 원함",
    status: "pending",
    createdAt: new Date().toISOString(),
    ...overrides,
  });
  return id;
}

// customers 픽스처 insert. customerCode는 매 테스트 randomUUID 접미사로 유니크 보장.
async function insertCustomer(
  overrides: Partial<typeof customers.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({
      customerCode: `CU-CONSULT-${crypto.randomUUID().slice(0, 8)}`,
      name: "상담통합 테스트고객",
      source: "카카오",
      statusGroup: "신규",
      status: "상담접수",
      ...overrides,
    })
    .returning({ id: customers.id });
  return row.id;
}

test("listConsultations: pending 상담신청이 notes·phoneNumber와 함께 반환된다", async () => {
  const id = await insertConsultation({ notes: "견적 문의드립니다", phoneNumber: "01011112222" });
  try {
    const rows = await listConsultations(db);
    const found = rows.find((r) => r.id === id);
    expect(found).toBeDefined();
    expect(found?.notes).toBe("견적 문의드립니다");
    expect(found?.phoneNumber).toBe("01011112222");
    expect(found?.status).toBe("pending");
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, id));
  }
});

test("listConsultations: pending이 아닌 상담신청은 제외된다", async () => {
  const id = await insertConsultation({ status: "completed" });
  try {
    const rows = await listConsultations(db);
    expect(rows.find((r) => r.id === id)).toBeUndefined();
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, id));
  }
});

test("listConsultationsByUser: 그 userId의 상담신청만 상태 무관 최신순 반환", async () => {
  const userId = await anyProfileId();
  const idPending = await insertConsultation({ userId, status: "pending" });
  const idCompleted = await insertConsultation({ userId, status: "completed" });
  const idOtherUser = await insertConsultation({ userId: null, status: "pending" });
  try {
    const rows = await listConsultationsByUser(userId, db);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(idPending);
    expect(ids).toContain(idCompleted); // 상태 무관
    expect(ids).not.toContain(idOtherUser); // 다른(없는) userId는 미포함
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, idPending));
    await db.delete(consultationRequests).where(eq(consultationRequests.id, idCompleted));
    await db.delete(consultationRequests).where(eq(consultationRequests.id, idOtherUser));
  }
});

test("createCustomerFromConsultation: userId 없으면 null(통합 불가)", async () => {
  const id = await insertConsultation({ userId: null });
  try {
    const result = await createCustomerFromConsultation(id, db);
    expect(result).toBeNull();
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, id));
  }
});

test("createCustomerFromConsultation: 신규 고객 생성 — source/phone/appUserId/needModel 왕복", async () => {
  const userId = await anyUnlinkedProfileId();
  const consultationId = await insertConsultation({
    userId,
    customerName: "김상담",
    phoneNumber: "01099998888",
    carModel: "벤츠 GLE",
  });
  let customerId: string | null = null;
  try {
    const result = await createCustomerFromConsultation(consultationId, db);
    expect(result).toBeDefined();
    customerId = result?.id ?? null;
    expect(result?.appUserId).toBe(userId);

    const [row] = await db.select().from(customers).where(eq(customers.id, result!.id));
    expect(row.name).toBe("김상담");
    expect(row.phone).toBe("01099998888");
    expect(row.appUserId).toBe(userId);
    expect(row.needModel).toBe("벤츠 GLE");
    expect(row.source).toBe("앱 상담신청");
    expect(row.statusGroup).toBe("신규");
    expect(row.status).toBe("상담접수");
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    if (customerId) await db.delete(customers).where(eq(customers.id, customerId));
  }
});

test("createCustomerFromConsultation: 같은 appUserId 기존 고객 있으면 dedupe — 그 고객 반환, source 유지(안 덮음)", async () => {
  const userId = await anyUnlinkedProfileId();
  const existingCustomerId = await insertCustomer({ appUserId: userId, source: "앱 견적요청", name: "기존고객" });
  const consultationId = await insertConsultation({ userId });
  try {
    const result = await createCustomerFromConsultation(consultationId, db);
    expect(result?.id).toBe(existingCustomerId);

    const [row] = await db.select({ source: customers.source }).from(customers).where(eq(customers.id, existingCustomerId));
    expect(row.source).toBe("앱 견적요청"); // 최초 유입 source 유지 — 상담신청으로 덮이지 않음
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    await db.delete(customers).where(eq(customers.id, existingCustomerId));
  }
});

test("linkConsultationToCustomer: 기존 고객에 appUserId 연결 + 빈 phone 보강", async () => {
  const userId = await anyUnlinkedProfileId();
  const customerId = await insertCustomer({ phone: null, source: "카카오" });
  const consultationId = await insertConsultation({ userId, phoneNumber: "01055556666" });
  try {
    const result = await linkConsultationToCustomer(consultationId, customerId, db);
    expect(result?.appUserId).toBe(userId);

    const [row] = await db.select().from(customers).where(eq(customers.id, customerId));
    expect(row.appUserId).toBe(userId);
    expect(row.phone).toBe("01055556666"); // 빈 phone 보강
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    await db.delete(customers).where(eq(customers.id, customerId));
  }
});

test("linkConsultationToCustomer: 기존 phone 있으면 보강하지 않고 유지", async () => {
  const userId = await anyUnlinkedProfileId();
  const customerId = await insertCustomer({ phone: "01022223333", source: "카카오" });
  const consultationId = await insertConsultation({ userId, phoneNumber: "01099990000" });
  try {
    await linkConsultationToCustomer(consultationId, customerId, db);
    const [row] = await db.select({ phone: customers.phone }).from(customers).where(eq(customers.id, customerId));
    expect(row.phone).toBe("01022223333"); // 기존 phone 유지
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    await db.delete(customers).where(eq(customers.id, customerId));
  }
});

test("linkConsultationToCustomer: app_user_id 중복이면 ConflictError", async () => {
  const userId = await anyUnlinkedProfileId();
  const alreadyLinkedCustomerId = await insertCustomer({ appUserId: userId, source: "카카오", name: "이미연결됨" });
  const otherCustomerId = await insertCustomer({ source: "카카오", name: "다른고객" });
  const consultationId = await insertConsultation({ userId });
  try {
    await expect(linkConsultationToCustomer(consultationId, otherCustomerId, db)).rejects.toThrow(ConflictError);
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    await db.delete(customers).where(eq(customers.id, alreadyLinkedCustomerId));
    await db.delete(customers).where(eq(customers.id, otherCustomerId));
  }
});

test("dismissConsultation: 숨긴 상담신청은 listConsultations/listConsultationsByUser에서 제외되고, 나머지는 그대로 노출된다", async () => {
  const userId = await anyProfileId();
  const idDismissed = await insertConsultation({ userId, status: "pending" });
  const idKept = await insertConsultation({ userId, status: "pending" });
  try {
    const result = await dismissConsultation(idDismissed, userId, db);
    expect(result).toEqual({ id: idDismissed });

    const inbox = await listConsultations(db);
    expect(inbox.map((r) => r.id)).not.toContain(idDismissed);
    expect(inbox.map((r) => r.id)).toContain(idKept);

    const byUser = await listConsultationsByUser(userId, db);
    expect(byUser.map((r) => r.id)).not.toContain(idDismissed);
    expect(byUser.map((r) => r.id)).toContain(idKept);
  } finally {
    await db.delete(consultationDismissals).where(eq(consultationDismissals.consultationId, idDismissed));
    await db.delete(consultationRequests).where(eq(consultationRequests.id, idDismissed));
    await db.delete(consultationRequests).where(eq(consultationRequests.id, idKept));
  }
});

test("dismissConsultation: idempotent — 두 번 호출해도 에러 없이 계속 숨겨진다", async () => {
  const id = await insertConsultation({ status: "pending" });
  try {
    await dismissConsultation(id, null, db);
    await expect(dismissConsultation(id, null, db)).resolves.toEqual({ id });

    const inbox = await listConsultations(db);
    expect(inbox.map((r) => r.id)).not.toContain(id);
  } finally {
    await db.delete(consultationDismissals).where(eq(consultationDismissals.consultationId, id));
    await db.delete(consultationRequests).where(eq(consultationRequests.id, id));
  }
});

test("dismissConsultation: public.consultations 행 자체는 절대 삭제/변경되지 않는다(핵심 불변조건)", async () => {
  const id = await insertConsultation({ status: "pending", notes: "원본 노트 불변 확인" });
  try {
    await dismissConsultation(id, null, db);

    const [row] = await db.select().from(consultationRequests).where(eq(consultationRequests.id, id));
    expect(row).toBeDefined();
    expect(row?.notes).toBe("원본 노트 불변 확인");
    expect(row?.status).toBe("pending");
  } finally {
    await db.delete(consultationDismissals).where(eq(consultationDismissals.consultationId, id));
    await db.delete(consultationRequests).where(eq(consultationRequests.id, id));
  }
});
