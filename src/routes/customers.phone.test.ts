import { afterAll, expect, test } from "bun:test";
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { profiles } from "../db/public-app";
import { customers } from "../db/schema";
import { customerWriteSchema } from "./customers";

// 전화번호 소유권 분리(2026-07-17 spec) 라우트 계약:
//  - 주 번호 표시값 = 서버 합성(profiles.phone_number ?? customers.phone)
//  - PATCH phone: 앱 연결 고객 409(소유권 게이트) / 미연결은 digits 정규화 저장
//  - phoneSecondary: 항상 편집 가능
// 픽스처 접두사 CU-ROUTE-(registry 기등록). 앱 연결 픽스처는 "현재 미연결인 실 profile"을
// 실행 시점에 조회해 연결한다(고정 uuid는 partial unique index와 경합 — 실측 대신 조회).

const db = getDefaultDb();
const createdIds: string[] = [];

async function seedCustomer(values: Partial<typeof customers.$inferInsert> = {}): Promise<string> {
  const [c] = await db
    .insert(customers)
    .values({ customerCode: `CU-ROUTE-${crypto.randomUUID().slice(0, 8)}`, name: "라우트테스트고객", ...values })
    .returning({ id: customers.id });
  createdIds.push(c.id);
  return c.id;
}

// 아직 어느 고객에도 연결되지 않은, 전화번호 있는 실 profile 1명(테스트 계정 풀에서).
async function findUnlinkedProfile(): Promise<{ id: string; phone: string }> {
  const linkedIds = db
    .select({ id: customers.appUserId })
    .from(customers)
    .where(isNotNull(customers.appUserId));
  const [prof] = await db
    .select({ id: profiles.id, phone: profiles.phoneNumber })
    .from(profiles)
    .where(and(isNotNull(profiles.phoneNumber), notInArray(profiles.id, linkedIds)))
    .limit(1);
  if (!prof?.phone) throw new Error("미연결+전화 보유 profile이 없어 테스트 전제가 깨졌습니다(실 DB 상태 확인 필요)");
  return { id: prof.id, phone: prof.phone };
}

afterAll(async () => {
  if (createdIds.length) await db.delete(customers).where(inArray(customers.id, createdIds));
});

test("customerWriteSchema: phone류는 digits 정규화(하이픈 제거·숫자 0개는 null·null 유지)", () => {
  const r = customerWriteSchema.safeParse({ phone: "010-1234-5678", phoneSecondary: "--" });
  expect(r.success).toBe(true);
  if (r.success) {
    expect(r.data.phone).toBe("01012345678");
    expect(r.data.phoneSecondary).toBeNull();
  }
  const cleared = customerWriteSchema.safeParse({ phone: null });
  expect(cleared.success).toBe(true);
  if (cleared.success) expect(cleared.data.phone).toBeNull();
});

test("PATCH phone: 미연결 고객은 정규화 저장 / phoneSecondary 왕복", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const id = await seedCustomer();

  const res = await app.request(`/api/customers/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "010-1234-0000", phoneSecondary: "010-7777-6666" }),
  });
  expect(res.status).toBe(200);
  const [row] = await db
    .select({ phone: customers.phone, phoneSecondary: customers.phoneSecondary })
    .from(customers)
    .where(eq(customers.id, id));
  expect(row.phone).toBe("01012340000");
  expect(row.phoneSecondary).toBe("01077776666");
});

test("PATCH phone: 앱 연결 고객은 409(앱 등록 번호 소유권 게이트) — phoneSecondary는 허용", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const prof = await findUnlinkedProfile();
  const id = await seedCustomer({ appUserId: prof.id }); // 불변식: phone은 null로 생성

  const denied = await app.request(`/api/customers/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "01099998888" }),
  });
  expect(denied.status).toBe(409);
  expect(((await denied.json()) as { error: string }).error).toContain("앱 등록 번호");

  const allowed = await app.request(`/api/customers/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phoneSecondary: "01055554444" }),
  });
  expect(allowed.status).toBe(200);
  const [row] = await db
    .select({ phone: customers.phone, phoneSecondary: customers.phoneSecondary })
    .from(customers)
    .where(eq(customers.id, id));
  expect(row.phone).toBeNull(); // 게이트가 지켜낸 불변식
  expect(row.phoneSecondary).toBe("01055554444");
});

test("GET 상세·목록: 앱 연결 고객의 phone = profiles.phone_number 합성(read-through)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const prof = await findUnlinkedProfile();
  const id = await seedCustomer({ appUserId: prof.id, phoneSecondary: "01011112222" });

  const detailRes = await app.request(`/api/customers/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(detailRes.status).toBe(200);
  const detail = (await detailRes.json()) as { phone: string | null; phoneSecondary: string | null };
  expect(detail.phone).toBe(prof.phone); // 저장은 null인데 응답은 앱 번호 — 합성 실증
  expect(detail.phoneSecondary).toBe("01011112222");

  const listRes = await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } });
  const list = (await listRes.json()) as { id: string; phone: string | null }[];
  expect(list.find((r) => r.id === id)?.phone).toBe(prof.phone);
});

test("GET: 미연결 고객의 phone은 crm 저장값 그대로(합성 폴백)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const id = await seedCustomer({ phone: "01012340987" });

  const res = await app.request(`/api/customers/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(((await res.json()) as { phone: string | null }).phone).toBe("01012340987");
});
