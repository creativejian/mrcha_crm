import { afterAll, expect, test } from "bun:test";
import { asc, eq, sql } from "drizzle-orm";

import { brandsInCatalog, modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { catalogDiscountAdoptions, dealerProfiles, dealerTrimDiscounts } from "../schema";
import { profiles } from "../public-app";
import {
  deleteDealerProfile,
  deleteDealerProposals,
  getDealerProfile,
  listDealerRoster,
  upsertDealerProfile,
} from "./dealer-profiles";

// 실 DB(공유 master) 테스트. dealer_profiles는 profiles에 FK가 없어(loose id 정책) 실제 계정 없이
// 랜덤 uuid로 완결된다 — 대신 afterAll 정리를 반드시 남긴다(uuid PK라 코드 리터럴 registry
// (fixture-codes.ts)로는 잔재를 탐지할 수 없다 — 실행이 끊기면 조용히 남는다).
// 브랜드는 실 catalog에서 집는다(하드코딩 id 금지 — 환경마다 다르다). raw execute는 쓰지 않는다:
// 레포에 사용례가 0건이고 반환 형태가 드라이버 의존이라, 쿼리 빌더가 타입까지 잠근다.
const db = getDefaultDb();
const DEALER_ID = crypto.randomUUID();

afterAll(async () => {
  await db.delete(dealerProfiles).where(eq(dealerProfiles.dealerUserId, DEALER_ID));
});

async function pickBrands(limit: number) {
  return db
    .select({ id: brandsInCatalog.id, name: brandsInCatalog.name })
    .from(brandsInCatalog)
    .orderBy(asc(brandsInCatalog.sortOrder))
    .limit(limit);
}

test("upsert 신규 → 목록에 브랜드명과 함께 뜬다", async () => {
  const [brand] = await pickBrands(1);
  expect(brand).toBeDefined();

  await upsertDealerProfile({ dealerUserId: DEALER_ID, brandId: brand!.id, note: "동성모터스" }, db);

  const mine = await getDealerProfile(DEALER_ID, db);
  expect(mine).toBeDefined();
  expect(mine!.brandId).toBe(brand!.id);
  expect(mine!.brandName).toBe(brand!.name);
  expect(mine!.note).toBe("동성모터스");
});

test("upsert 재호출 → 1행 유지 · 브랜드 교체 · updated_at 전진", async () => {
  const brands = await pickBrands(2);
  expect(brands.length).toBe(2);
  const other = brands[1]!.id;

  await upsertDealerProfile({ dealerUserId: DEALER_ID, brandId: other, note: null }, db);

  const rows = [await getDealerProfile(DEALER_ID, db)].filter((r) => r !== null);
  expect(rows.length).toBe(1); // PK 충돌이 UPDATE로 흡수됐다 — 신규/변경이 한 경로
  expect(rows[0]!.brandId).toBe(other);
  expect(rows[0]!.note).toBeNull();

  // ⚠️ 스탬프 전진은 **DB 안에서** 비교한다(timestamptz = 마이크로초). JS Date로 꺼내 비교하면
  // ms 절삭으로 빠른 연속 호출에서 거짓 실패하고, 더 나쁘게는 시계 스큐가 클수록 잘 통과해
  // 결함을 가린다(#334·#335 — updated_at은 앱 시계가 아니라 sql`now()`로 찍어야 한다).
  const [chk] = await db
    .select({ advanced: sql<boolean>`${dealerProfiles.updatedAt} > ${dealerProfiles.createdAt}` })
    .from(dealerProfiles)
    .where(eq(dealerProfiles.dealerUserId, DEALER_ID));
  expect(chk!.advanced).toBe(true);
});

// ── 딜러 명부 + 데이터 삭제 (2026-07-28) ────────────────────────────────────
// 삭제는 **되돌릴 수 없다**. 그래서 "무엇을 지우는가"보다 **"무엇을 지우지 않는가"**를 잠근다:
// 채택된 확정 할인(catalog.trims)과 채택 감사는 어느 버튼에서도 건드리지 않는다(spec §5).
// 전부 트랜잭션 롤백으로 검증한다 — 실 catalog·실 profiles를 읽으므로 커밋하면 공유 master가 바뀐다.
async function inRollback(fn: (tx: Executor) => Promise<void>): Promise<void> {
  await db
    .transaction(async (tx) => {
      await fn(tx);
      throw new Error("rollback");
    })
    .catch((e: unknown) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
}

test("listDealerRoster: role이 dealer면 매칭이 없어도 명부에 뜬다(브랜드 지정용)", async () => {
  await inRollback(async (tx) => {
    const [realDealer] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.role, "dealer")).limit(1);
    await tx.delete(dealerProfiles).where(eq(dealerProfiles.dealerUserId, realDealer!.id));

    const row = (await listDealerRoster(tx)).find((r) => r.dealerUserId === realDealer!.id);
    expect(row).toBeDefined();
    expect(row!.isDealer).toBe(true);
    expect(row!.brandId).toBeNull(); // 매칭이 없어도 행은 있다 — 여기서 브랜드를 준다
  });
});

test("listDealerRoster: role이 내려가도 매칭이 있으면 명부에 남는다(데이터 정리용)", async () => {
  await inRollback(async (tx) => {
    // role이 dealer가 아닌 실 유저에게 매칭을 심는다 = 앱에서 role이 내려간 딜러와 같은 상태.
    const [nonDealer] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.role, "admin")).limit(1);
    const [brand] = await pickBrands(1);
    await upsertDealerProfile({ dealerUserId: nonDealer!.id, brandId: brand!.id, note: "퇴사" }, tx);

    const row = (await listDealerRoster(tx)).find((r) => r.dealerUserId === nonDealer!.id);
    expect(row).toBeDefined();
    // 이 행이 사라지면 그 사람의 데이터를 정리할 방법이 없어진다 — 합집합이 필요한 이유.
    expect(row!.isDealer).toBe(false);
    expect(row!.note).toBe("퇴사");
  });
});

test("deleteDealerProposals: 제안만 지우고 브랜드 매칭·확정 할인·감사는 남긴다", async () => {
  await inRollback(async (tx) => {
    const [trim] = await tx
      .select({ id: trimsInCatalog.id, brandId: modelsInCatalog.brandId })
      .from(trimsInCatalog)
      .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
      .limit(1);
    const [admin] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.role, "admin")).limit(1);
    await upsertDealerProfile({ dealerUserId: DEALER_ID, brandId: trim!.brandId, note: "동성모터스" }, tx);
    await tx.insert(dealerTrimDiscounts).values({
      trimId: trim!.id, dealerUserId: DEALER_ID, financialAmount: 1_234_000, partnerAmount: null, cashAmount: null,
    });
    // 채택 감사도 심어 둔다 — 삭제가 이걸 건드리면 "누가 확정 할인을 바꿨는지"가 사라진다.
    await tx.insert(catalogDiscountAdoptions).values({
      trimId: trim!.id, field: "financial", amount: 1_234_000, previousAmount: null,
      sourceDealerUserId: DEALER_ID, adoptedBy: admin!.id,
    });
    const trimBefore = await tx
      .select({ financial: trimsInCatalog.financialDiscountAmount })
      .from(trimsInCatalog)
      .where(eq(trimsInCatalog.id, trim!.id));

    expect(await deleteDealerProposals(DEALER_ID, tx)).toBe(1);

    expect(
      await tx.select().from(dealerTrimDiscounts).where(eq(dealerTrimDiscounts.dealerUserId, DEALER_ID)),
    ).toHaveLength(0);
    // 남아야 하는 것 3가지
    expect(await tx.select().from(dealerProfiles).where(eq(dealerProfiles.dealerUserId, DEALER_ID))).toHaveLength(1);
    expect(
      await tx.select().from(catalogDiscountAdoptions).where(eq(catalogDiscountAdoptions.sourceDealerUserId, DEALER_ID)),
    ).toHaveLength(1);
    expect(
      (await tx.select({ financial: trimsInCatalog.financialDiscountAmount }).from(trimsInCatalog).where(eq(trimsInCatalog.id, trim!.id)))[0]!.financial,
    ).toBe(trimBefore[0]!.financial);
  });
});

test("deleteDealerProfile: 제안 + 매칭을 함께 지우고 감사·확정 할인은 남긴다", async () => {
  await inRollback(async (tx) => {
    const [trim] = await tx.select({ id: trimsInCatalog.id, brandId: modelsInCatalog.brandId })
      .from(trimsInCatalog)
      .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
      .limit(1);
    const [admin] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.role, "admin")).limit(1);
    await upsertDealerProfile({ dealerUserId: DEALER_ID, brandId: trim!.brandId, note: null }, tx);
    await tx.insert(dealerTrimDiscounts).values({
      trimId: trim!.id, dealerUserId: DEALER_ID, financialAmount: 2_345_000, partnerAmount: null, cashAmount: null,
    });
    await tx.insert(catalogDiscountAdoptions).values({
      trimId: trim!.id, field: "cash", amount: 2_345_000, previousAmount: null,
      sourceDealerUserId: DEALER_ID, adoptedBy: admin!.id,
    });

    expect(await deleteDealerProfile(DEALER_ID, tx)).toEqual({ proposals: 1, profileRemoved: true });

    expect(await tx.select().from(dealerProfiles).where(eq(dealerProfiles.dealerUserId, DEALER_ID))).toHaveLength(0);
    expect(
      await tx.select().from(dealerTrimDiscounts).where(eq(dealerTrimDiscounts.dealerUserId, DEALER_ID)),
    ).toHaveLength(0);
    // 감사는 남는다 — 이걸 지우면 previous_amount(되돌리기 근거)까지 사라진다.
    expect(
      await tx.select().from(catalogDiscountAdoptions).where(eq(catalogDiscountAdoptions.sourceDealerUserId, DEALER_ID)),
    ).toHaveLength(1);
  });
});

test("삭제는 그 딜러만 건드린다(다른 딜러 제안은 남는다)", async () => {
  await inRollback(async (tx) => {
    const [trim] = await tx.select({ id: trimsInCatalog.id, brandId: modelsInCatalog.brandId })
      .from(trimsInCatalog)
      .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
      .limit(1);
    const other = crypto.randomUUID();
    for (const id of [DEALER_ID, other]) {
      await upsertDealerProfile({ dealerUserId: id, brandId: trim!.brandId, note: null }, tx);
      await tx.insert(dealerTrimDiscounts).values({
        trimId: trim!.id, dealerUserId: id, financialAmount: 3_456_000, partnerAmount: null, cashAmount: null,
      });
    }

    await deleteDealerProfile(DEALER_ID, tx);

    expect(await tx.select().from(dealerTrimDiscounts).where(eq(dealerTrimDiscounts.dealerUserId, other))).toHaveLength(1);
    expect(await tx.select().from(dealerProfiles).where(eq(dealerProfiles.dealerUserId, other))).toHaveLength(1);
  });
});
