import { test, expect } from "bun:test";
import { eq, inArray, sql } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { ConflictError, LinkConflictError } from "../lib/errors";
import { createCustomerFromRequest, getQuoteRequestDetail, linkRequestToCustomer, listQuoteRequests, listQuoteRequestsByUser } from "../db/queries/quote-requests";
import { createQuote } from "../db/queries/customer-quotes";
import { profiles, quoteRequests as quoteRequestsTable, quoteRequestOptions as quoteRequestOptionsTable } from "../db/public-app";
import { customers, quotes } from "../db/schema";

test("GET /api/quote-requests → 200, 배열", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/quote-requests", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

test("GET /api/quote-requests 무토큰 → 401", async () => {
  const { keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/quote-requests");
  expect(res.status).toBe(401);
});

test("GET /api/quote-requests → 행 형태(차량명/옵션수/매칭)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/quote-requests", { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as Array<{
    id: string; createdAt: string; optionCount: number;
    matchType: string; brandName: string | null; status: string | null;
  }>;
  expect(body.length).toBeGreaterThan(0);
  for (const r of body) {
    expect(typeof r.id).toBe("string");
    expect(typeof r.optionCount).toBe("number");
    expect(["app_user", "phone", "none"]).toContain(r.matchType);
    expect(r.brandName === null || typeof r.brandName === "string").toBe(true);
  }
});

test("linkRequestToCustomer: 고객 app_user_id에 요청 user_id를 set (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id, userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  const [cust] = await db.select({ id: customers.id }).from(customers).limit(1);
  await expect(
    db.transaction(async (tx) => {
      // 같은 앱 계정이 이미 다른 고객에 연결돼 있으면 가드가 막으므로 기존 연결 해제(롤백됨).
      await tx.update(customers).set({ appUserId: null }).where(eq(customers.appUserId, req.userId));
      // 대상 고객이 이미 **다른** 앱 계정에 연결돼 있어도 역방향 가드가 막는다 — limit(1)이 뽑는 실
      // master 첫 고객은 연결돼 있어(실측) 미연결 상태를 명시적으로 만든다(anyUnlinkedProfileId와 같은 사유).
      await tx.update(customers).set({ appUserId: null }).where(eq(customers.id, cust.id));
      const linked = await linkRequestToCustomer(req.id, cust.id, tx);
      expect(linked?.id).toBe(cust.id);
      const [c] = await tx.select({ appUserId: customers.appUserId }).from(customers).where(eq(customers.id, cust.id));
      expect(c.appUserId).toBe(req.userId);
      throw new Error("ROLLBACK"); // 부작용 롤백 — 실 DB에 변경 안 남김
    }),
  ).rejects.toThrow("ROLLBACK");
});

test("createCustomerFromRequest: 신규 고객 생성 + CU 코드 + app_user_id (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id, userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      const created = await createCustomerFromRequest(req.id, tx);
      expect(created?.customerCode).toMatch(/^CU-\d{4}-\d{4}$/);
      const [c] = await tx.select({ appUserId: customers.appUserId }).from(customers).where(eq(customers.id, created!.id));
      expect(c.appUserId).toBe(req.userId);
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
});

test("createCustomerFromRequest: 같은 user 중복 호출은 기존 고객 반환 (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      const first = await createCustomerFromRequest(req.id, tx);
      const second = await createCustomerFromRequest(req.id, tx);
      expect(second?.id).toBe(first?.id); // 두 번째는 기존 반환(중복 생성 없음)
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
});

// 출고 시기 → need_timing 시드 (계약 D3·D4 절대화 + D5 비파괴).
// V2 요청이 아직 실 DB에 0건이라, 트랜잭션 안에서 timing을 심고 롤백해 경로를 실측한다
// (quote_requests는 앱 소유 read 원칙이지만 롤백되고, 알림 트리거 4테이블에도 없다).
async function withSeededTiming<T>(
  fn: (tx: Parameters<Parameters<ReturnType<typeof getDefaultDb>["transaction"]>[0]>[0], reqId: string, userId: string) => Promise<T>,
): Promise<void> {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id, userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      await tx
        .update(quoteRequestsTable)
        .set({ deliveryTimingMode: "next_month", deliveryTimingReferenceMonth: "2026-07" })
        .where(eq(quoteRequestsTable.id, req.id));
      await fn(tx, req.id, req.userId);
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
}

test("createCustomerFromRequest: 신규 고객에 출고 시기를 절대화해 시드 (tx 롤백)", async () => {
  await withSeededTiming(async (tx, reqId, userId) => {
    await tx.update(customers).set({ appUserId: null }).where(eq(customers.appUserId, userId)); // 신규 생성 경로 강제
    const created = await createCustomerFromRequest(reqId, tx);
    const [c] = await tx.select({ needTiming: customers.needTiming }).from(customers).where(eq(customers.id, created!.id));
    expect(c.needTiming).toBe("2026년 8월"); // next_month + reference 2026-07
  });
});

test("createCustomerFromRequest: 기존 고객이면 need_timing 빈 칸만 채운다 (tx 롤백)", async () => {
  await withSeededTiming(async (tx, reqId, userId) => {
    await tx.update(customers).set({ appUserId: null }).where(eq(customers.appUserId, userId));
    const created = await createCustomerFromRequest(reqId, tx);
    await tx.update(customers).set({ needTiming: null }).where(eq(customers.id, created!.id));
    await createCustomerFromRequest(reqId, tx); // 두 번째 = 기존 고객 분기
    const [c] = await tx.select({ needTiming: customers.needTiming }).from(customers).where(eq(customers.id, created!.id));
    expect(c.needTiming).toBe("2026년 8월");
  });
});

// D5의 핵심 — 상담사 수기 입력을 자동 시드가 지우면 안 된다.
test("createCustomerFromRequest: 기존 고객의 need_timing 수기 값은 덮지 않는다 (tx 롤백)", async () => {
  await withSeededTiming(async (tx, reqId, userId) => {
    await tx.update(customers).set({ appUserId: null }).where(eq(customers.appUserId, userId));
    const created = await createCustomerFromRequest(reqId, tx);
    await tx.update(customers).set({ needTiming: "상담사가 적은 값" }).where(eq(customers.id, created!.id));
    await createCustomerFromRequest(reqId, tx);
    const [c] = await tx.select({ needTiming: customers.needTiming }).from(customers).where(eq(customers.id, created!.id));
    expect(c.needTiming).toBe("상담사가 적은 값");
  });
});

test("linkRequestToCustomer: 연결된 기존 고객의 빈 need_timing을 채운다 (tx 롤백)", async () => {
  await withSeededTiming(async (tx, reqId, userId) => {
    const [cust] = await tx.select({ id: customers.id }).from(customers).limit(1);
    await tx.update(customers).set({ appUserId: null }).where(eq(customers.appUserId, userId));
    await tx.update(customers).set({ appUserId: null, needTiming: null }).where(eq(customers.id, cust.id));
    await linkRequestToCustomer(reqId, cust.id, tx);
    const [c] = await tx.select({ needTiming: customers.needTiming }).from(customers).where(eq(customers.id, cust.id));
    expect(c.needTiming).toBe("2026년 8월");
  });
});

// 레거시 요청(timing 없음)은 아무것도 건드리지 않는다 — 빈 칸을 빈 문자열로 덮는 등의 부작용 금지.
test("createCustomerFromRequest: 레거시 요청은 need_timing을 건드리지 않는다 (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id, userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      await tx.update(customers).set({ appUserId: null }).where(eq(customers.appUserId, req.userId));
      const created = await createCustomerFromRequest(req.id, tx);
      const [c] = await tx.select({ needTiming: customers.needTiming }).from(customers).where(eq(customers.id, created!.id));
      expect(c.needTiming).toBeNull();
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
});

test("linkRequestToCustomer: 같은 앱 계정이 이미 다른 고객에 연결 → LinkConflictError + 충돌 고객 식별 동봉 (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id, userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  const two = await db.select({ id: customers.id, customerCode: customers.customerCode, name: customers.name }).from(customers).limit(2);
  expect(two.length).toBe(2);
  await expect(
    db.transaction(async (tx) => {
      await tx.update(customers).set({ appUserId: null }).where(eq(customers.appUserId, req.userId));
      // 두 고객 모두 미연결로 초기화 — 역방향 가드가 아니라 **정방향** 가드(app_user_id 중복)를 검증한다.
      await tx.update(customers).set({ appUserId: null }).where(inArray(customers.id, [two[0].id, two[1].id]));
      const linked = await linkRequestToCustomer(req.id, two[0].id, tx);
      expect(linked?.id).toBe(two[0].id);
      // 두 번째 고객으로 재연결 시도 — 차단은 유지하되 클라 "그 고객으로 이동" 안내용으로
      // 충돌 상대 고객 식별(customerCode·name)을 구조화 동봉한다(이사님 2026-07-13 ② 결정).
      const err = await linkRequestToCustomer(req.id, two[1].id, tx).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LinkConflictError);
      expect((err as LinkConflictError).conflict).toEqual({ customerCode: two[0].customerCode, name: two[0].name });
      throw new Error("ROLLBACK"); // 부작용 롤백 — 실 DB에 변경 안 남김
    }),
  ).rejects.toThrow("ROLLBACK");
});

// 역방향(고객 → 앱계정) 재연결 차단(0709 감사). 전화 매칭 후보는 이미 다른 앱 계정에 연결된 고객도
// 그대로 노출하므로(matchType="phone"), 가드가 없으면 인박스 "연결" 클릭 한 번에 그 고객의
// app_user_id가 조용히 교체되고 원래 앱 계정이 고아가 된다.
test("linkRequestToCustomer: 대상 고객이 이미 다른 앱 계정에 연결 → ConflictError (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id, userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  const [cust] = await db.select({ id: customers.id }).from(customers).limit(1);
  const occupyingUser = crypto.randomUUID(); // loose id — app_user_id에 FK 없음
  await expect(
    db.transaction(async (tx) => {
      await tx.update(customers).set({ appUserId: null }).where(eq(customers.appUserId, req.userId));
      // phone: null 동반 — limit(1)이 phone 보유 고객을 뽑으면 app_user_id만 세팅하는 시드가
      // customers_phone_app_exclusive_check(마이그 0034 — app_user_id ↔ phone 배타)에 거부돼
      // ConflictError 전에 tx가 죽는다(heap 순서 종속이라 0034 이후 잠복하다 2026-07-20 발현).
      // 연결 고객 = phone NULL이 소유권 계약 정합 상태이기도 하다(#276). tx 롤백이라 실 DB 불변.
      await tx.update(customers).set({ appUserId: occupyingUser, phone: null }).where(eq(customers.id, cust.id));
      await expect(linkRequestToCustomer(req.id, cust.id, tx)).rejects.toThrow(ConflictError);
      const [c] = await tx.select({ appUserId: customers.appUserId }).from(customers).where(eq(customers.id, cust.id));
      expect(c.appUserId).toBe(occupyingUser); // 기존 연결 보존
      throw new Error("ROLLBACK"); // 부작용 롤백 — 실 DB에 변경 안 남김
    }),
  ).rejects.toThrow("ROLLBACK");
});

test("linkRequestToCustomer: 없는 요청 → null", async () => {
  const db = getDefaultDb();
  const [cust] = await db.select({ id: customers.id }).from(customers).limit(1);
  const r = await linkRequestToCustomer("00000000-0000-0000-0000-000000000000", cust.id);
  expect(r).toBeNull();
});

test("getQuoteRequestDetail: 요청의 trimId·paymentMethod·optionIds 반환", async () => {
  const db = getDefaultDb();
  // 옵션이 있는 요청을 하나 고른다(없으면 첫 요청).
  const [opt] = await db.select({ reqId: quoteRequestOptionsTable.quoteRequestId, optId: quoteRequestOptionsTable.trimOptionId }).from(quoteRequestOptionsTable).limit(1);
  const targetId = opt?.reqId
    ?? (await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1))[0].id;
  const detail = await getQuoteRequestDetail(targetId);
  expect(detail).not.toBeNull();
  expect(detail!.id).toBe(targetId);
  expect(Array.isArray(detail!.optionIds)).toBe(true);
  // 옵션 있는 요청을 골랐다면 실제로 채워지는지 검증(빈 배열 false positive 방지). opt 폴백 시엔 옵션 0개 가능.
  if (opt) expect(detail!.optionIds.length).toBeGreaterThan(0);
  // trimId는 number 또는 null
  expect(detail!.trimId === null || typeof detail!.trimId === "number").toBe(true);
});

// 프리필 배선 — deliveryRegionOf 자체는 유닛 테스트가 잠갔지만 "프리필 응답까지 흐르는지"는 별개다.
// 워크벤치가 이 값으로 customerRegion 3단 폴백을 완성한다(계약 D6).
test("getQuoteRequestDetail: 구매방식 분기에 맞는 지역을 파생해 실어 보낸다 (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      await tx
        .update(quoteRequestsTable)
        .set({
          paymentMethod: "lease",
          deliveryRegionCode: "seoul",
          deliveryRegionName: "서울특별시",
          registrationRegionCode: "busan",
          registrationRegionName: "부산광역시",
        })
        .where(eq(quoteRequestsTable.id, req.id));
      expect((await getQuoteRequestDetail(req.id, tx))?.deliveryRegion).toBe("서울특별시"); // 리스 → 인수 지역

      await tx.update(quoteRequestsTable).set({ paymentMethod: "cash" }).where(eq(quoteRequestsTable.id, req.id));
      expect((await getQuoteRequestDetail(req.id, tx))?.deliveryRegion).toBe("부산광역시"); // 일시불 → 등록 지역
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
});

test("getQuoteRequestDetail: 없는 요청 → null", async () => {
  const detail = await getQuoteRequestDetail("00000000-0000-0000-0000-000000000000");
  expect(detail).toBeNull();
});

// 컬러(2026-07-14): quote_requests는 앱 소유라 실 행은 아직 mode=null. selected 값 검증은 롤백 tx로
// 임시 UPDATE 후 확인(quote_requests엔 알림 트리거 없음 — 부작용/알림 0). catalog.colors FK 없음(실측).
test("listQuoteRequestsByUser: selected 행의 컬러 필드(mode·외장·내장)를 반환 (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id, userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      await tx.update(quoteRequestsTable)
        .set({ colorPreferenceMode: "selected", exteriorColorId: 7011, exteriorColorName: "카본 블랙 메탈릭", exteriorColorHex: "#111111", interiorColorId: 7053, interiorColorName: "커피", interiorColorHex: "#3a2a1a" })
        .where(eq(quoteRequestsTable.id, req.id));
      const rows = await listQuoteRequestsByUser(req.userId, tx);
      const row = rows.find((r) => r.id === req.id);
      expect(row?.colorPreferenceMode).toBe("selected");
      expect(row?.exteriorColorId).toBe(7011);
      expect(row?.exteriorColorName).toBe("카본 블랙 메탈릭");
      expect(row?.exteriorColorHex).toBe("#111111");
      expect(row?.interiorColorId).toBe(7053);
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
});

test("getQuoteRequestDetail: selected 요청의 외장·내장 컬러 id 반환 (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      await tx.update(quoteRequestsTable)
        .set({ colorPreferenceMode: "selected", exteriorColorId: 7011, interiorColorId: 7053 })
        .where(eq(quoteRequestsTable.id, req.id));
      const detail = await getQuoteRequestDetail(req.id, tx);
      expect(detail!.exteriorColorId).toBe(7011);
      expect(detail!.interiorColorId).toBe(7053);
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
});

// ── 프리필 단건 — customers 라우터 이사(배치 12 K1, V3 안 ②) ──────────────────
// 구 GET /api/quote-requests/:id는 #302 인박스 전면 게이트에 걸려 staff의 니즈 카드 "견적 작성"
// (본인 담당 앱 고객)이 403으로 죽었다(부수 피해). 이사 후 = /api/customers/:id/quote-requests/:reqId
// — #301 customerScopeGate 자동 편입 + 소유권 WHERE(요청 user_id == 그 고객 app_user_id).
// 소유권 검사는 구 라우트의 잠재 느슨함(열린 드로어와 무관한 임의 요청 id 프리필)까지 닫는다.

const PREFILL_STAFF = "41111111-1111-4111-8111-111111111111";

async function seedPrefillFixture(advisorId: string | null = null) {
  const db = getDefaultDb();
  const freed = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(sql`not exists (select 1 from crm.customers c where c.app_user_id = ${profiles.id})`)
    .limit(2);
  expect(freed.length).toBe(2);
  const [ownerUser, otherUser] = freed.map((r) => r.id);
  const reqId = crypto.randomUUID();
  const otherReqId = crypto.randomUUID();
  const reqBase = {
    trimId: null, paymentMethod: "lease", period: 36, depositType: "deposit",
    depositRatio: 10, rentalDeposit: 1000000, trimPrice: 30000000, status: "open",
    createdAt: new Date().toISOString(),
  };
  await db.insert(quoteRequestsTable).values([
    { id: reqId, userId: ownerUser, ...reqBase },
    { id: otherReqId, userId: otherUser, ...reqBase },
  ]);
  const [cust] = await db
    .insert(customers)
    .values({
      customerCode: `CU-QRPF-${crypto.randomUUID().slice(0, 8)}`,
      name: "프리필이사테스트",
      appUserId: ownerUser,
      advisorId,
      advisorName: advisorId ? "프리필담당" : null,
    })
    .returning({ id: customers.id });
  return {
    reqId, otherReqId, custId: cust.id,
    cleanup: async () => {
      await db.delete(customers).where(eq(customers.id, cust.id));
      await db.delete(quoteRequestsTable).where(inArray(quoteRequestsTable.id, [reqId, otherReqId]));
    },
  };
}

test("GET /api/customers/:id/quote-requests/:reqId → 200 + detail 형태·deposit 필드 왕복(소유 요청)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const f = await seedPrefillFixture();
  try {
    const res = await app.request(`/api/customers/${f.custId}/quote-requests/${f.reqId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string; trimId: number | null; paymentMethod: string | null; optionIds: number[];
      period: number | null; depositType: string | null; depositRatio: number | null; rentalDeposit: number | null;
    };
    expect(body.id).toBe(f.reqId);
    expect(Array.isArray(body.optionIds)).toBe(true);
    expect(body.period).toBe(36);
    expect(body.depositType).toBe("deposit");
    expect(body.depositRatio).toBe(10);
    expect(body.rentalDeposit).toBe(1000000);
  } finally {
    await f.cleanup();
  }
});

test("프리필 — 타 유저 요청(소유권 불일치) → 404 '요청'(임의 요청 id 프리필 봉쇄)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const f = await seedPrefillFixture();
  try {
    const res = await app.request(`/api/customers/${f.custId}/quote-requests/${f.otherReqId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("요청");
  } finally {
    await f.cleanup();
  }
});

test("프리필 — 수기 고객(app_user_id 없음) → 404 '요청'", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const db = getDefaultDb();
  const f = await seedPrefillFixture();
  const [manual] = await db
    .insert(customers)
    .values({ customerCode: `CU-QRPF-${crypto.randomUUID().slice(0, 8)}`, name: "프리필이사테스트" })
    .returning({ id: customers.id });
  try {
    const res = await app.request(`/api/customers/${manual.id}/quote-requests/${f.reqId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("요청");
  } finally {
    await db.delete(customers).where(eq(customers.id, manual.id));
    await f.cleanup();
  }
});

test("프리필 — staff 본인 담당 200(K1-a 회귀 그물) / 타 담당 staff 404 '고객'(스코프 선행)", async () => {
  const f = await seedPrefillFixture(PREFILL_STAFF);
  try {
    const own = await makeTestAuth("staff", PREFILL_STAFF);
    const ownRes = await createApp({ keyResolver: own.keyResolver, issuer: own.issuer }).request(
      `/api/customers/${f.custId}/quote-requests/${f.reqId}`,
      { headers: { Authorization: `Bearer ${own.token}` } },
    );
    expect(ownRes.status).toBe(200);
    const other = await makeTestAuth("staff", crypto.randomUUID());
    const otherRes = await createApp({ keyResolver: other.keyResolver, issuer: other.issuer }).request(
      `/api/customers/${f.custId}/quote-requests/${f.reqId}`,
      { headers: { Authorization: `Bearer ${other.token}` } },
    );
    expect(otherRes.status).toBe(404);
    expect(((await otherRes.json()) as { error: string }).error).toContain("고객");
  } finally {
    await f.cleanup();
  }
});

test("listQuoteRequests: source가 붙은 견적이 있으면 promotedQuoteCount 증가 (tx 롤백)", async () => {
  const db = getDefaultDb();
  const [cust] = await db.select({ id: customers.id }).from(customers).limit(1);
  const [req] = await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1);
  await expect(
    db.transaction(async (tx) => {
      const before = (await listQuoteRequests(tx)).find((r) => r.id === req.id);
      await createQuote(cust.id, { sourceQuoteRequestId: req.id }, tx);
      const after = (await listQuoteRequests(tx)).find((r) => r.id === req.id);
      expect(after?.promotedQuoteCount).toBe((before?.promotedQuoteCount ?? 0) + 1);
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
});

test("listQuoteRequestsByUser: 해당 user 요청만 반환(id 집합 일치)", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  const userReqIds = (
    await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).where(eq(quoteRequestsTable.userId, req.userId))
  ).map((r) => r.id);
  const result = await listQuoteRequestsByUser(req.userId);
  expect(result.length).toBe(userReqIds.length);
  const idSet = new Set(userReqIds);
  for (const r of result) expect(idSet.has(r.id)).toBe(true);
});

test("listQuoteRequestsByUser: 없는 user → 빈 배열", async () => {
  const result = await listQuoteRequestsByUser("00000000-0000-0000-0000-000000000000");
  expect(result).toEqual([]);
});

// (구 "GET /api/quote-requests/:id deposit 왕복" 테스트는 위 프리필 이사 테스트에 병합 —
//  시드 픽스처가 deposit 4필드를 결정적으로 제어해 실데이터 존재 전제도 함께 제거됐다.)

test("GET /api/quote-requests → 승격 견적 2건 생성 시 promotedQuoteIds 최신순(desc) + promotedQuoteCount +2 (실 insert, finally 삭제)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const db = getDefaultDb();
  const [cust] = await db.select({ id: customers.id }).from(customers).limit(1);
  const [req] = await db.select({ id: quoteRequestsTable.id }).from(quoteRequestsTable).limit(1);

  const beforeRes = await app.request("/api/quote-requests", { headers: { Authorization: `Bearer ${token}` } });
  const beforeBody = (await beforeRes.json()) as Array<{ id: string; promotedQuoteCount: number }>;
  const beforeCount = beforeBody.find((r) => r.id === req.id)?.promotedQuoteCount ?? 0;

  const first = await createQuote(cust.id, { sourceQuoteRequestId: req.id, status: "작성중" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = await createQuote(cust.id, { sourceQuoteRequestId: req.id, status: "작성중" });

  try {
    const res = await app.request("/api/quote-requests", { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as Array<{ id: string; promotedQuoteIds: string[]; promotedQuoteCount: number }>;
    const target = body.find((r) => r.id === req.id);
    // 공유 master라 뽑힌 요청에 기존 승격 견적이 있어도 안전(최신 2건 선두+총 길이만 단언 — desc 정렬 보장과 동치).
    expect(target?.promotedQuoteIds.slice(0, 2)).toEqual([second.id, first.id]);
    expect(target?.promotedQuoteIds.length).toBe(beforeCount + 2);
    expect(target?.promotedQuoteCount).toBe(beforeCount + 2);
  } finally {
    await db.delete(quotes).where(inArray(quotes.id, [first.id, second.id]));
  }
});

test("listQuoteRequests(전체) 길이 ≥ listQuoteRequestsByUser(부분) — 추출 회귀 가드", async () => {
  const db = getDefaultDb();
  const [req] = await db.select({ userId: quoteRequestsTable.userId }).from(quoteRequestsTable).limit(1);
  const all = await listQuoteRequests();
  const sub = await listQuoteRequestsByUser(req.userId);
  expect(all.length).toBeGreaterThanOrEqual(sub.length);
  for (const r of all) {
    expect(typeof r.optionCount).toBe("number");
    expect(["app_user", "phone", "none"]).toContain(r.matchType);
  }
});
