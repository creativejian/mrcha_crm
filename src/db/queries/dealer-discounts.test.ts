import { afterAll, expect, test } from "bun:test";
import { and, asc, eq, sql } from "drizzle-orm";

import { modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb } from "../client";
import { dealerTrimDiscounts } from "../schema";
import { brandIdOfTrim, listMyTrimDiscounts, upsertDealerTrimDiscount } from "./dealer-discounts";

// 실 DB(공유 master). FK가 없어(loose id 정책) 랜덤 uuid로 완결되지만 afterAll 정리는 필수다
// (uuid PK라 코드 리터럴 registry(fixture-codes.ts)로는 잔재를 탐지할 수 없다).
const db = getDefaultDb();
const DEALER_ID = crypto.randomUUID();

afterAll(async () => {
  await db.delete(dealerTrimDiscounts).where(eq(dealerTrimDiscounts.dealerUserId, DEALER_ID));
});

// 실 catalog에서 트림 하나를 집는다(하드코딩 id 금지 — 환경마다 다르다).
async function pickTrim() {
  const [row] = await db
    .select({ trimId: trimsInCatalog.id, modelId: trimsInCatalog.modelId, brandId: modelsInCatalog.brandId })
    .from(trimsInCatalog)
    .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
    .orderBy(asc(trimsInCatalog.id))
    .limit(1);
  return row;
}

test("brandIdOfTrim: 트림의 소속 브랜드를 2단 조인으로 돌려준다", async () => {
  const trim = await pickTrim();
  expect(trim).toBeDefined();
  expect(await brandIdOfTrim(trim!.trimId, db)).toBe(trim!.brandId);
});

test("brandIdOfTrim: 없는 트림은 null (fail-closed 판정의 근거)", async () => {
  expect(await brandIdOfTrim(999_999_999, db)).toBeNull();
});

test("upsert 신규 → 내 제안 목록에 뜬다", async () => {
  const trim = await pickTrim();
  await upsertDealerTrimDiscount(
    {
      trimId: trim!.trimId,
      dealerUserId: DEALER_ID,
      financialAmount: 6_500_000,
      partnerAmount: null,
      cashAmount: null,
    },
    db,
  );

  const mine = (await listMyTrimDiscounts(DEALER_ID, trim!.modelId, db)).find((r) => r.trimId === trim!.trimId);
  expect(mine).toBeDefined();
  expect(mine!.financialAmount).toBe(6_500_000);
  expect(mine!.partnerAmount).toBeNull();
});

test("upsert 재호출 → 1행 유지 · 금액 교체 · updated_at 전진", async () => {
  const trim = await pickTrim();
  await upsertDealerTrimDiscount(
    {
      trimId: trim!.trimId,
      dealerUserId: DEALER_ID,
      financialAmount: null,
      partnerAmount: 6_000_000,
      cashAmount: 5_500_000,
    },
    db,
  );

  const rows = (await listMyTrimDiscounts(DEALER_ID, trim!.modelId, db)).filter((r) => r.trimId === trim!.trimId);
  expect(rows.length).toBe(1); // UNIQUE 충돌이 UPDATE로 흡수됐다
  expect(rows[0]!.financialAmount).toBeNull(); // 비우기도 저장된다(= 그 필드 미제안)
  expect(rows[0]!.partnerAmount).toBe(6_000_000);

  // ⚠️ 스탬프 전진은 **DB 안에서** 비교한다(timestamptz = 마이크로초). JS Date로 꺼내 비교하면
  // ms 절삭으로 거짓 실패하고, 시계 스큐가 클수록 잘 통과해 결함을 가린다(#334·#335).
  const [chk] = await db
    .select({ advanced: sql<boolean>`${dealerTrimDiscounts.updatedAt} > ${dealerTrimDiscounts.createdAt}` })
    .from(dealerTrimDiscounts)
    .where(and(eq(dealerTrimDiscounts.dealerUserId, DEALER_ID), eq(dealerTrimDiscounts.trimId, trim!.trimId)));
  expect(chk!.advanced).toBe(true);
});

test("다른 딜러의 제안은 내 목록에 섞이지 않는다(경쟁사 노출 금지)", async () => {
  const trim = await pickTrim();
  const other = crypto.randomUUID();
  try {
    await upsertDealerTrimDiscount(
      { trimId: trim!.trimId, dealerUserId: other, financialAmount: 7_000_000, partnerAmount: null, cashAmount: null },
      db,
    );
    const rows = await listMyTrimDiscounts(DEALER_ID, trim!.modelId, db);
    expect(rows.every((r) => r.financialAmount !== 7_000_000)).toBe(true);
  } finally {
    await db.delete(dealerTrimDiscounts).where(eq(dealerTrimDiscounts.dealerUserId, other));
  }
});
