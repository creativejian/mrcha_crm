import { expect, test } from "bun:test";

import { withNotifyGuard } from "../../test-utils/notify-gate";
import { eq } from "drizzle-orm";

import { ConflictError, LinkConflictError } from "../../lib/errors";
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
// public.consultations INSERT는 on_consultation_created 트리거가 운영 디스코드 알림을 낸다 —
// withNotifyGuard 트랜잭션(app.skip_notify) 안에서만 넣는다(src/test-utils/notify-gate.ts).
async function insertConsultation(
  overrides: Partial<typeof consultationRequests.$inferInsert> = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await withNotifyGuard(db, (tx) => tx.insert(consultationRequests).values({
    id,
    userId: null,
    customerName: `상담테스트-${id.slice(0, 8)}`,
    phoneNumber: "01000000000",
    carModel: "BMW X5",
    notes: "리스 상담 원함",
    status: "pending",
    createdAt: new Date().toISOString(),
    ...overrides,
  }));
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

test("createCustomerFromConsultation: 신규 고객 생성 — source/appUserId/needModel 왕복, phone 미저장(2026-07-17 spec)", async () => {
  const userId = await anyUnlinkedProfileId();
  // 이름은 registry(TEST_CUSTOMER_NAMES) 등록값 — createCustomerFromConsultation이 이 이름으로
  // **실채번**(CU-YYMM-####) 고객을 만들어 접두사 registry가 못 잡는다. 실행이 끊겨 남아도
  // 잔재 스캔·--clean이 이름으로 잡게 한다(routes/customers.create.test.ts "수기등록테스트" 선례).
  const consultationId = await insertConsultation({
    userId,
    customerName: "상담승격테스트",
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
    expect(row.name).toBe("상담승격테스트");
    // 폼 phone은 저장하지 않는다(spec §3-5) — 앱 연결 고객 주 번호는 profiles read-through 합성.
    // CHECK 불변식(app_user_id ↔ phone 배타)이 DB에서도 강제한다.
    expect(row.phone).toBeNull();
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

test("linkConsultationToCustomer: appUserId 연결 — 구 '빈 phone 보강' 폐기, phone은 null 유지(read-through가 담당)", async () => {
  const userId = await anyUnlinkedProfileId();
  const customerId = await insertCustomer({ phone: null, source: "카카오" });
  const consultationId = await insertConsultation({ userId, phoneNumber: "01055556666" });
  try {
    const result = await linkConsultationToCustomer(consultationId, customerId, db);
    expect(result?.appUserId).toBe(userId);
    expect(result?.droppedPhone).toBeNull();

    const [row] = await db.select().from(customers).where(eq(customers.id, customerId));
    expect(row.appUserId).toBe(userId);
    expect(row.phone).toBeNull(); // 폼 번호를 저장하지 않는다(2026-07-17 spec §3-5)
    expect(row.phoneSecondary).toBeNull();
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    await db.delete(customers).where(eq(customers.id, customerId));
  }
});

test("linkConsultationToCustomer: 기존 phone은 앱 번호와 다르면 secondary로 내려가고 phone은 null(전이 규칙)", async () => {
  const userId = await anyUnlinkedProfileId();
  // 실 profile의 phone과 우연히 같으면 '같으면 버림' 분기로 빠져 단언이 흔들린다 — 조회해서 회피(결정적).
  const [prof] = await db.select({ phone: profiles.phoneNumber }).from(profiles).where(eq(profiles.id, userId));
  const crmPhone = prof?.phone === "01022223333" ? "01033334444" : "01022223333";
  const customerId = await insertCustomer({ phone: crmPhone, source: "카카오" });
  const consultationId = await insertConsultation({ userId, phoneNumber: "01099990000" });
  try {
    const result = await linkConsultationToCustomer(consultationId, customerId, db);
    expect(result?.droppedPhone).toBeNull();
    const [row] = await db
      .select({ phone: customers.phone, phoneSecondary: customers.phoneSecondary })
      .from(customers)
      .where(eq(customers.id, customerId));
    expect(row.phone).toBeNull(); // CHECK 불변식 — 연결 고객의 주 번호는 profiles 파생
    expect(row.phoneSecondary).toBe(crmPhone); // 상담사가 적었던 번호는 추가 연락처로 보존
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    await db.delete(customers).where(eq(customers.id, customerId));
  }
});

test("linkConsultationToCustomer: app_user_id 중복이면 LinkConflictError + 충돌 고객 식별 동봉", async () => {
  const userId = await anyUnlinkedProfileId();
  const alreadyLinkedCustomerId = await insertCustomer({ appUserId: userId, source: "카카오", name: "이미연결됨" });
  const otherCustomerId = await insertCustomer({ source: "카카오", name: "다른고객" });
  const consultationId = await insertConsultation({ userId });
  try {
    // 차단 유지 + 클라 "그 고객으로 이동" 안내용 충돌 고객 식별 동봉(이사님 2026-07-13 ② — quote-requests와 대칭).
    const err = await linkConsultationToCustomer(consultationId, otherCustomerId, db).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LinkConflictError);
    const [linkedRow] = await db
      .select({ customerCode: customers.customerCode, name: customers.name })
      .from(customers)
      .where(eq(customers.id, alreadyLinkedCustomerId));
    expect((err as LinkConflictError).conflict).toEqual({ customerCode: linkedRow.customerCode, name: linkedRow.name });
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    await db.delete(customers).where(eq(customers.id, alreadyLinkedCustomerId));
    await db.delete(customers).where(eq(customers.id, otherCustomerId));
  }
});

// 역방향(고객 → 앱계정) 재연결 차단(0709 감사). 기존 409 가드는 "들어오는 userId가 다른 고객에 이미
// 붙었나"만 봐서, 대상 고객이 **다른** 앱 계정에 연결돼 있어도 조용히 덮어썼다. 그러면 원래 붙어 있던
// 앱 계정은 고아가 되고 그 유저의 견적요청/상담신청이 매칭을 잃는다(crm.customers.app_user_id에 UNIQUE
// 제약도 없어 DB가 막지 않는다 — 실측).
test("linkConsultationToCustomer: 대상 고객이 이미 다른 앱 계정에 연결돼 있으면 ConflictError(덮어쓰기 금지)", async () => {
  const incomingUser = await anyUnlinkedProfileId();
  const occupyingUser = crypto.randomUUID(); // customers.app_user_id는 loose id(FK 없음)
  const customerId = await insertCustomer({ appUserId: occupyingUser, name: "이미 다른 앱계정 연결됨" });
  const consultationId = await insertConsultation({ userId: incomingUser });
  try {
    await expect(linkConsultationToCustomer(consultationId, customerId, db)).rejects.toThrow(ConflictError);
    const [c] = await db.select({ appUserId: customers.appUserId }).from(customers).where(eq(customers.id, customerId));
    expect(c.appUserId).toBe(occupyingUser); // 기존 연결 보존
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    await db.delete(customers).where(eq(customers.id, customerId));
  }
});

// 같은 앱 계정으로의 재연결은 멱등이라 허용(가드는 "다른 계정"만 막는다).
test("linkConsultationToCustomer: 같은 앱 계정으로 다시 연결하면 그대로 성공(멱등)", async () => {
  const userId = await anyUnlinkedProfileId();
  const customerId = await insertCustomer({ appUserId: userId, name: "같은 계정 재연결" });
  const consultationId = await insertConsultation({ userId });
  try {
    const row = await linkConsultationToCustomer(consultationId, customerId, db);
    expect(row?.id).toBe(customerId);
  } finally {
    await db.delete(consultationRequests).where(eq(consultationRequests.id, consultationId));
    await db.delete(customers).where(eq(customers.id, customerId));
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
