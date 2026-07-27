import { afterAll, beforeAll, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { modelsInCatalog, trimsInCatalog } from "../db/catalog";
import { getDefaultDb } from "../db/client";
import { upsertDealerProfile } from "../db/queries/dealer-profiles";
import { dealerProfiles, dealerTrimDiscounts } from "../db/schema";

// ── 딜러 할인 제안 쓰기: allowlist 개방 + 브랜드 소유권(fail-closed) ──────────
// 딜러 쓰기는 dealerWriteGate가 전면 차단하고 DEALER_WRITE_ALLOWLIST 한 줄로만 열린다.
// 그 위에 소유권 검증이 얹혀 "내 브랜드 트림만" 쓰게 만든다 — cross-schema 조인이라 DB CHECK로
// 강제할 수 없어 **서버가 유일한 방어선**이고, 그래서 이 파일이 그 축을 잠근다.
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §6.1·§6.2
const db = getDefaultDb();
const DEALER_ID = crypto.randomUUID();
let myTrimId = 0;
let otherBrandTrimId = 0;

beforeAll(async () => {
  // 서로 다른 브랜드의 트림 2개를 실 catalog에서 집는다(하드코딩 id 금지).
  const rows = await db
    .select({ trimId: trimsInCatalog.id, brandId: modelsInCatalog.brandId })
    .from(trimsInCatalog)
    .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
    .orderBy(asc(trimsInCatalog.id));
  const first = rows[0]!;
  const other = rows.find((r) => r.brandId !== first.brandId)!;
  myTrimId = first.trimId;
  otherBrandTrimId = other.trimId;
  // 이 딜러는 first의 브랜드 소속이다. **쿼리 함수로 만든다** — db.insert(dealerProfiles)를 직접
  // 쓰면 profiles-write-guard 탐지기에 걸려 예외를 하나 더 등록해야 한다(예외는 최소로).
  await upsertDealerProfile({ dealerUserId: DEALER_ID, brandId: first.brandId, note: null }, db);
});

afterAll(async () => {
  await db.delete(dealerTrimDiscounts).where(eq(dealerTrimDiscounts.dealerUserId, DEALER_ID));
  await db.delete(dealerProfiles).where(eq(dealerProfiles.dealerUserId, DEALER_ID));
});

async function put(role: "dealer" | "staff" | "admin", userId: string, trimId: number, body: unknown) {
  const { token, keyResolver, issuer } = await makeTestAuth(role, userId);
  const app = createApp({ keyResolver, issuer });
  return app.request(`/api/dealer/discounts/${trimId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const AMOUNTS = { financialAmount: 6_500_000, partnerAmount: null, cashAmount: null };

test("내 브랜드 트림 → 200 (allowlist가 열려 dealerWriteGate를 통과한다)", async () => {
  const res = await put("dealer", DEALER_ID, myTrimId, AMOUNTS);
  expect(res.status).toBe(200);
});

test("다른 브랜드 트림 → 403 (브랜드 소유권 검증)", async () => {
  const res = await put("dealer", DEALER_ID, otherBrandTrimId, AMOUNTS);
  expect(res.status).toBe(403);
});

test("없는 트림 → 403 (brandIdOfTrim null = fail-closed)", async () => {
  const res = await put("dealer", DEALER_ID, 999_999_999, AMOUNTS);
  expect(res.status).toBe(403);
});

test("프로필 없는 딜러 → 403 (브랜드 미지정은 아무것도 못 쓴다)", async () => {
  const res = await put("dealer", crypto.randomUUID(), myTrimId, AMOUNTS);
  expect(res.status).toBe(403);
});

test("allowlist는 그 경로만 연다 — 딜러의 catalog 쓰기는 여전히 403", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("dealer", DEALER_ID);
  const app = createApp({ keyResolver, issuer });
  const res = await app.request(`/api/catalog/trims/${myTrimId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ financialDiscountAmount: 1 }),
  });
  expect(res.status).toBe(403);
});

test("allowlist는 딜러 프로필 쓰기를 열지 않는다 — 자기 브랜드 변경 403", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("dealer", DEALER_ID);
  const app = createApp({ keyResolver, issuer });
  const res = await app.request(`/api/dealer/profiles/${DEALER_ID}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ brandId: 1 }),
  });
  expect(res.status).toBe(403);
});
