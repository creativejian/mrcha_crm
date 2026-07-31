import { afterAll, expect, test } from "bun:test";
import { and, asc, eq, sql } from "drizzle-orm";

import { modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb } from "../client";
import { dealerTrimDiscounts } from "../schema";
import { brandIdOfTrim, listMyTrimDiscounts, saveDealerTrimDiscount } from "./dealer-discounts";

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
  await saveDealerTrimDiscount(
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
  await saveDealerTrimDiscount(
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

// 2026-07-31 유슨생: "입력했다 삭제하면 기록에도 없어야 한다". 셋 다 비면 그 행이 주장하는
// 사실이 하나도 없는데, 예전에는 upsert가 빈 행을 남겨 딜러 명부 "보기(N)"·내 입력 트림 목록에
// 아무 금액도 없는 유령 행으로 떴다(실기 발견). 표시에서 거르지 않고 원천에서 지운다 —
// 카운트(proposal_count 서브쿼리)와 목록이 다른 쿼리라 읽기 필터는 두 곳을 늘 같이 고쳐야 한다.
test("세 금액을 다 비우면 행이 삭제된다 · 반환은 null", async () => {
  const trim = await pickTrim();
  await saveDealerTrimDiscount(
    { trimId: trim!.trimId, dealerUserId: DEALER_ID, financialAmount: 4_000_000, partnerAmount: null, cashAmount: null },
    db,
  );
  expect((await listMyTrimDiscounts(DEALER_ID, trim!.modelId, db)).some((r) => r.trimId === trim!.trimId)).toBe(true);

  const returned = await saveDealerTrimDiscount(
    { trimId: trim!.trimId, dealerUserId: DEALER_ID, financialAmount: null, partnerAmount: null, cashAmount: null },
    db,
  );

  expect(returned).toBeNull(); // 호출부(클라 Map)가 이 null로 "지워졌다"를 판별한다
  expect((await listMyTrimDiscounts(DEALER_ID, trim!.modelId, db)).some((r) => r.trimId === trim!.trimId)).toBe(false);
  const left = await db
    .select({ id: dealerTrimDiscounts.id })
    .from(dealerTrimDiscounts)
    .where(and(eq(dealerTrimDiscounts.dealerUserId, DEALER_ID), eq(dealerTrimDiscounts.trimId, trim!.trimId)));
  expect(left.length).toBe(0); // 목록에서만 감춘 게 아니라 실제로 행이 없다
});

test("삭제 후 재입력하면 새로 만들어진다(UNIQUE upsert — 되돌릴 수 없는 삭제가 아니다)", async () => {
  const trim = await pickTrim();
  await saveDealerTrimDiscount(
    { trimId: trim!.trimId, dealerUserId: DEALER_ID, financialAmount: null, partnerAmount: null, cashAmount: null },
    db,
  );
  const row = await saveDealerTrimDiscount(
    { trimId: trim!.trimId, dealerUserId: DEALER_ID, financialAmount: 3_300_000, partnerAmount: null, cashAmount: null },
    db,
  );
  expect(row).not.toBeNull();
  expect(row!.financialAmount).toBe(3_300_000);
});

test("한 필드만 남아도 행은 유지된다(부분 비우기는 삭제가 아니다)", async () => {
  const trim = await pickTrim();
  const row = await saveDealerTrimDiscount(
    { trimId: trim!.trimId, dealerUserId: DEALER_ID, financialAmount: null, partnerAmount: null, cashAmount: 1_200_000 },
    db,
  );
  expect(row).not.toBeNull();
  expect(row!.cashAmount).toBe(1_200_000);
  expect(row!.financialAmount).toBeNull();
});

test("다른 딜러의 제안은 내 목록에 섞이지 않는다(경쟁사 노출 금지)", async () => {
  const trim = await pickTrim();
  const other = crypto.randomUUID();
  try {
    await saveDealerTrimDiscount(
      { trimId: trim!.trimId, dealerUserId: other, financialAmount: 7_000_000, partnerAmount: null, cashAmount: null },
      db,
    );
    const rows = await listMyTrimDiscounts(DEALER_ID, trim!.modelId, db);
    expect(rows.every((r) => r.financialAmount !== 7_000_000)).toBe(true);
  } finally {
    await db.delete(dealerTrimDiscounts).where(eq(dealerTrimDiscounts.dealerUserId, other));
  }
});
