import { expect, test } from "bun:test";
import { eq, isNotNull } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { trimsInCatalog } from "../db/catalog";
import { getDefaultDb } from "../db/client";
import { dealerProfiles } from "../db/schema";

const db = getDefaultDb();

// ── /api/dealer/profiles role 게이트(admin 전용) ──────────────────────────────
// 딜러 브랜드 매칭은 조직 운영 정보다 — 조직 화면(GET /api/staff/org)과 같은 게이트를 쓴다.
// **dealer 본인도 못 바꾼다**: 자기 브랜드를 스스로 바꿀 수 있으면 브랜드 소유권 검증
// (trims→models.brand_id 대조, 슬라이스 B)이 무의미해진다 — 아무 브랜드로 갈아타면 그만이다.
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §6.3
async function reqFor(role: "admin" | "manager" | "staff" | "dealer", path: string, init?: RequestInit) {
  const { token, keyResolver, issuer } = await makeTestAuth(role, crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  return app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

const BODY = JSON.stringify({ brandId: 1, note: "동성모터스" });

for (const role of ["manager", "staff", "dealer"] as const) {
  test(`PUT /api/dealer/profiles/:userId — ${role} 403 (게이트가 zod·본 처리보다 앞)`, async () => {
    const res = await reqFor(role, `/api/dealer/profiles/${crypto.randomUUID()}`, { method: "PUT", body: BODY });
    expect(res.status).toBe(403);
  });
}

// ── 확정 할인 비노출(2026-07-27 유슨생 결정) ─────────────────────────────────
// 딜러는 **자기 제안만** 본다. 화면에서 감추는 것으로는 부족해서(DevTools) 서버가 응답을 비운다
// — 마스킹 로직 자체는 lib/dealer-visibility.test.ts(순수·CI)가 잠그고, 여기서는 그 함수가
// **실제 HTTP 경로에 물려 있는지**를 본다(배선 누락은 순수 테스트로 잡히지 않는다).
const trimWithDiscount = async () => {
  const [row] = await db
    .select({ id: trimsInCatalog.id, modelId: trimsInCatalog.modelId })
    .from(trimsInCatalog)
    .where(isNotNull(trimsInCatalog.financialDiscountAmount))
    .limit(1);
  return row;
};

test("GET /api/catalog/trims — 딜러 응답에 확정 3금액·할인변경일이 없다", async () => {
  const [any] = await db.select({ modelId: trimsInCatalog.modelId }).from(trimsInCatalog).limit(1);
  const res = await reqFor("dealer", `/api/catalog/trims?modelId=${any!.modelId}`);
  expect(res.status).toBe(200);
  const trims = (await res.json()) as Record<string, unknown>[];
  expect(trims.length).toBeGreaterThan(0);
  for (const t of trims) {
    expect(t.financialDiscountAmount).toBeNull();
    expect(t.partnerDiscountAmount).toBeNull();
    expect(t.cashDiscountAmount).toBeNull();
    expect(t.discountUpdatedAt).toBeNull();
    expect(t.price).toBeGreaterThan(0); // 가격·트림명은 감추지 않는다(앱 공개 정보)
  }
});

test("GET /api/catalog/trims — 같은 요청을 admin이 하면 확정값이 온다(마스킹이 role로 갈린다)", async () => {
  // ⚠️ 확정 할인이 하나도 없는 DB에서는 이 대조가 성립하지 않는다 — 그때는 "딜러가 null을 받는다"만
  //    검증되고 role 분기는 순수 테스트가 담당한다. 조용히 넘기지 않고 이유를 남긴다.
  const target = await trimWithDiscount();
  if (!target) {
    console.warn("[dealer-visibility] 확정 할인이 있는 트림이 없어 admin 대조를 건너뜁니다");
    return;
  }
  const res = await reqFor("admin", `/api/catalog/trims?modelId=${target.modelId}`);
  const trims = (await res.json()) as { id: number; financialDiscountAmount: number | null }[];
  expect(trims.find((t) => t.id === target.id)?.financialDiscountAmount).not.toBeNull();
});

test("GET /api/vehicles/trims/:trimId — 딜러 응답에 확정 3금액이 없다(견적용 상세 경로)", async () => {
  const [any] = await db.select({ id: trimsInCatalog.id }).from(trimsInCatalog).limit(1);
  const res = await reqFor("dealer", `/api/vehicles/trims/${any!.id}`);
  expect(res.status).toBe(200);
  const detail = (await res.json()) as Record<string, unknown>;
  expect(detail.financialDiscountAmount).toBeNull();
  expect(detail.partnerDiscountAmount).toBeNull();
  expect(detail.cashDiscountAmount).toBeNull();
});

// ── 딜러 데이터 삭제 게이트(2026-07-28) ─────────────────────────────────────
// 삭제는 되돌릴 수 없다 — **admin만** 부를 수 있어야 한다. dealerWriteGate가 딜러의 쓰기를 막지만
// (DELETE도 쓰기다) manager·staff는 그 게이트 밖이라 requireRoles가 유일한 방어선이다.
for (const role of ["manager", "staff", "dealer"] as const) {
  test(`DELETE /api/dealer/profiles/:userId — ${role} 403 (딜러 해제)`, async () => {
    const res = await reqFor(role, `/api/dealer/profiles/${crypto.randomUUID()}`, { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  test(`DELETE /api/dealer/profiles/:userId/proposals — ${role} 403 (입력값 삭제)`, async () => {
    const res = await reqFor(role, `/api/dealer/profiles/${crypto.randomUUID()}/proposals`, { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  test(`GET /api/dealer/roster — ${role} 403 (명부는 조직 운영 정보다)`, async () => {
    expect((await reqFor(role, "/api/dealer/roster")).status).toBe(403);
  });
}

test("GET /api/dealer/roster — admin 200", async () => {
  const res = await reqFor("admin", "/api/dealer/roster");
  expect(res.status).toBe(200);
  expect(Array.isArray(await res.json())).toBe(true);
});

// ── 브랜드 저장 대상 가드(2026-07-28 유슨생) ────────────────────────────────
// 화면은 "현재 딜러 아님" 행의 편집을 disabled로 막지만 그건 표시일 뿐이다(DevTools로 뚫린다).
// admin이 딜러 아닌(또는 profiles에 없는) uuid에 PUT하면 딜러였던 적 없는 사람에게 매칭이 생겨
// 명부 합집합(listDealerRoster)에 유령 행("현재 딜러 아님")이 뜬다 — 서버가 409로 거부한다.
// 판정은 채택 가드(adoptDealerProposal)와 같은 read-through 기준(isDealerRole)이다.
test("PUT /api/dealer/profiles/:userId — 대상이 딜러가 아니면 409 + 매칭 미생성", async () => {
  const ghost = crypto.randomUUID(); // profiles에 없는 uuid = 딜러 아님(fail-closed 축까지 함께 본다)
  const res = await reqFor("admin", `/api/dealer/profiles/${ghost}`, { method: "PUT", body: BODY });
  // 단언보다 **정리를 먼저** 한다 — 가드가 깨진 상태(RED)에서는 여기서 실 행이 생기는데,
  // 단언이 먼저 실패하면 정리가 안 돌아 공유 master에 고아가 남는다(check:residue가 잡는 그 유형).
  const rows = await db.select().from(dealerProfiles).where(eq(dealerProfiles.dealerUserId, ghost));
  await db.delete(dealerProfiles).where(eq(dealerProfiles.dealerUserId, ghost));
  expect(res.status).toBe(409);
  expect(rows).toHaveLength(0);
});

test("삭제: admin이 없는 유저를 지우면 0건으로 응답한다(존재 확인 없이 멱등)", async () => {
  // 랜덤 uuid라 지울 것이 없다 — 게이트 통과와 멱등 동작을 함께 본다(실 데이터 무영향).
  const ghost = crypto.randomUUID();
  const proposals = await reqFor("admin", `/api/dealer/profiles/${ghost}/proposals`, { method: "DELETE" });
  expect(proposals.status).toBe(200);
  expect(await proposals.json()).toEqual({ deleted: 0 });

  const release = await reqFor("admin", `/api/dealer/profiles/${ghost}`, { method: "DELETE" });
  expect(release.status).toBe(200);
  expect(await release.json()).toEqual({ proposals: 0, profileRemoved: false });
});
