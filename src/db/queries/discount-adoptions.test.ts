import { beforeAll, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { profiles } from "../public-app";
import { catalogDiscountAdoptions, dealerTrimDiscounts } from "../schema";
import { upsertDealerProfile } from "./dealer-profiles";
import { adoptDealerProposal, listTrimProposals } from "./discount-adoptions";

// ── 관리자 채택(슬라이스 C) ─────────────────────────────────────────────────
// 이 테스트는 `catalog.trims`의 확정 할인을 **실제로** 바꾼다 — 앱 고객에게 보이는 금액이다.
// 그래서 afterAll 복원에 의존하지 않고 **전부 트랜잭션 롤백**으로 검증한다: 실행이 중간에
// 끊겨도(afterAll이 못 도는 그 상황이 07-09 유령 고객 사고의 원인이었다) 오염이 남을 수 없다.
// fixture-residue.test.ts가 같은 이유로 같은 패턴을 쓴다.
//
// 픽스처 유저는 **실 public.profiles 유저**다(랜덤 uuid가 아니다) — 자격 판정이 profiles.role
// read-through이므로 랜덤 uuid로는 "딜러 자격 있음" 케이스를 만들 수 없다. 롤백이라 잔재도 없다.
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §3.3·§4·§5
const db = getDefaultDb();

let trimId = 0;
let dealerId = ""; // profiles.role = 'dealer' — 자격 있음
let nonDealerId = ""; // role != 'dealer' — 자격 상실 표시 대상
let brandId = 0;

beforeAll(async () => {
  const [trim] = await db
    .select({ id: trimsInCatalog.id, brandId: modelsInCatalog.brandId })
    .from(trimsInCatalog)
    .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
    .limit(1);
  trimId = trim!.id;
  brandId = trim!.brandId;

  const [dealer] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.role, "dealer")).limit(1);
  const [other] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.role, "admin")).limit(1);
  dealerId = dealer!.id;
  nonDealerId = other!.id;
});

// 롤백 전용 실행기 — 심은 행·바뀐 확정 할인이 커밋되지 않는다.
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

async function seedProposal(
  tx: Executor,
  userId: string,
  amounts: { financialAmount: number | null; partnerAmount: number | null; cashAmount: number | null },
) {
  await upsertDealerProfile({ dealerUserId: userId, brandId, note: "동성모터스" }, tx);
  await tx.insert(dealerTrimDiscounts).values({ trimId, dealerUserId: userId, ...amounts });
}

async function trimRow(tx: Executor) {
  const [row] = await tx
    .select({
      financial: trimsInCatalog.financialDiscountAmount,
      partner: trimsInCatalog.partnerDiscountAmount,
      cash: trimsInCatalog.cashDiscountAmount,
      stampedAt: trimsInCatalog.discountUpdatedAt,
    })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.id, trimId));
  return row!;
}

test("listTrimProposals: 딜러명·비고와 함께 제안이 나오고 필드 상태가 파생된다", async () => {
  await inRollback(async (tx) => {
    await seedProposal(tx, dealerId, { financialAmount: 6_500_000, partnerAmount: null, cashAmount: 7_000_000 });

    const result = await listTrimProposals(trimId, tx);
    const mine = result.proposals.find((p) => p.dealerUserId === dealerId);
    expect(mine).toBeDefined();
    expect(mine!.dealerName).toBeTruthy(); // profiles.full_name read-through
    expect(mine!.dealerNote).toBe("동성모터스");
    expect(mine!.isDealer).toBe(true);
    expect(mine!.financial.amount).toBe(6_500_000);
    // 아직 채택 전 — 확정값과 무관하게 "미채택"이다(출처가 이 딜러가 아니므로).
    expect(mine!.financial.state).toBe("none");
    expect(mine!.partner.amount).toBeNull();
  });
});

test("listTrimProposals: role이 dealer가 아닌 제안자는 자격 상실로 표시된다", async () => {
  await inRollback(async (tx) => {
    await seedProposal(tx, nonDealerId, { financialAmount: 5_000_000, partnerAmount: null, cashAmount: null });

    const result = await listTrimProposals(trimId, tx);
    const row = result.proposals.find((p) => p.dealerUserId === nonDealerId);
    expect(row).toBeDefined();
    expect(row!.isDealer).toBe(false); // 채택 불가 — soft delete 컬럼 없이 read-through 판정
  });
});

test("adoptDealerProposal: 그 필드만 확정값으로 넘어가고 감사 1행이 남는다", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    await seedProposal(tx, dealerId, { financialAmount: 6_500_000, partnerAmount: null, cashAmount: null });

    await adoptDealerProposal({ trimId, field: "financial", dealerUserId: dealerId, adoptedBy: nonDealerId }, tx);

    const after = await trimRow(tx);
    expect(after.financial).toBe(6_500_000);
    // 자사·제휴·타사는 각각 독립이다 — 하나를 채택해도 나머지는 건드리지 않는다(이사님 요구).
    expect(after.partner).toBe(before.partner);
    expect(after.cash).toBe(before.cash);

    const audits = await tx
      .select()
      .from(catalogDiscountAdoptions)
      .where(and(eq(catalogDiscountAdoptions.trimId, trimId), eq(catalogDiscountAdoptions.field, "financial")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.amount).toBe(6_500_000);
    expect(audits[0]!.previousAmount).toBe(before.financial); // 되돌리기 근거
    expect(audits[0]!.sourceDealerUserId).toBe(dealerId);
    expect(audits[0]!.adoptedBy).toBe(nonDealerId);
  });
});

test("adoptDealerProposal: 금액은 제안 행에서 읽는다 — 호출자가 금액을 지정할 수 없다", async () => {
  await inRollback(async (tx) => {
    await seedProposal(tx, dealerId, { financialAmount: 6_500_000, partnerAmount: null, cashAmount: null });
    // 관리자가 딜러가 제안하지 않은 금액을 그 딜러 출처로 기록하면 감사가 거짓이 된다.
    // 그래서 시그니처에 amount가 없다 — 서버가 제안값을 읽는 것이 유일한 경로다.
    await adoptDealerProposal({ trimId, field: "financial", dealerUserId: dealerId, adoptedBy: nonDealerId }, tx);
    expect((await trimRow(tx)).financial).toBe(6_500_000);
  });
});

test("adoptDealerProposal: 제안이 없으면 아무것도 바꾸지 않는다(fail-closed)", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    // 제안 행 자체가 없는 딜러 — 채택할 값이 없으므로 확정값도 감사도 생기지 않아야 한다.
    const result = await adoptDealerProposal(
      { trimId, field: "financial", dealerUserId: dealerId, adoptedBy: nonDealerId },
      tx,
    );
    expect(result).toBeNull();
    expect((await trimRow(tx)).financial).toBe(before.financial);
    expect(
      await tx.select().from(catalogDiscountAdoptions).where(eq(catalogDiscountAdoptions.trimId, trimId)),
    ).toHaveLength(0);
  });
});

test("adoptDealerProposal: 제안 행은 있어도 그 필드가 비었으면 채택하지 않는다", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    // 자사만 냈고 제휴는 비웠다(= 그 필드는 미제안 — schema 주석). 확정 할인을 **비우는** 것은
    // 채택이 아니라 관리자 직접 편집의 일이므로, 여기서 null을 확정값으로 밀면 안 된다.
    await seedProposal(tx, dealerId, { financialAmount: 6_500_000, partnerAmount: null, cashAmount: null });

    const result = await adoptDealerProposal(
      { trimId, field: "partner", dealerUserId: dealerId, adoptedBy: nonDealerId },
      tx,
    );
    expect(result).toBeNull();
    expect((await trimRow(tx)).partner).toBe(before.partner);
    expect(
      await tx.select().from(catalogDiscountAdoptions).where(eq(catalogDiscountAdoptions.trimId, trimId)),
    ).toHaveLength(0);
  });
});

test("채택 후 상태가 '채택됨'으로, 제안이 바뀌면 '수정됨'으로 파생된다", async () => {
  await inRollback(async (tx) => {
    await seedProposal(tx, dealerId, { financialAmount: 6_500_000, partnerAmount: null, cashAmount: null });
    await adoptDealerProposal({ trimId, field: "financial", dealerUserId: dealerId, adoptedBy: nonDealerId }, tx);

    const adopted = await listTrimProposals(trimId, tx);
    expect(adopted.proposals.find((p) => p.dealerUserId === dealerId)!.financial.state).toBe("adopted");
    expect(adopted.adopted.financial.sourceDealerUserId).toBe(dealerId);

    // 딜러가 제안을 올려 다시 냈다 — 확정값은 그대로이므로 "재채택 필요"로 보여야 한다.
    await tx
      .update(dealerTrimDiscounts)
      .set({ financialAmount: 6_800_000 })
      .where(and(eq(dealerTrimDiscounts.trimId, trimId), eq(dealerTrimDiscounts.dealerUserId, dealerId)));

    const changed = await listTrimProposals(trimId, tx);
    expect(changed.proposals.find((p) => p.dealerUserId === dealerId)!.financial.state).toBe("changed");
  });
});

test("discount_updated_at은 트리거가 찍는다 — 우리가 넣지 않는데 값이 바뀐다", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    // 현재 확정값과 **다른** 금액이어야 트리거의 IS DISTINCT FROM 조건이 성립한다.
    const fresh = (before.financial ?? 0) + 1_234_000;
    await seedProposal(tx, dealerId, { financialAmount: fresh, partnerAmount: null, cashAmount: null });

    await adoptDealerProposal({ trimId, field: "financial", dealerUserId: dealerId, adoptedBy: nonDealerId }, tx);
    const after = await trimRow(tx);
    expect(after.stampedAt).not.toBe(before.stampedAt);
  });
});

test("같은 값 재채택은 스탬프를 움직이지 않는다(트리거 멱등 — 거짓 스탬프 방지)", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    const fresh = (before.financial ?? 0) + 2_345_000;
    await seedProposal(tx, dealerId, { financialAmount: fresh, partnerAmount: null, cashAmount: null });

    await adoptDealerProposal({ trimId, field: "financial", dealerUserId: dealerId, adoptedBy: nonDealerId }, tx);
    const first = await trimRow(tx);
    // 같은 금액을 한 번 더 채택 — 값이 안 바뀌므로 트리거가 발화하지 않아야 한다.
    // (우리가 now()를 직접 넣었다면 여기서 스탬프가 전진해 "방금 할인이 바뀐 트림"으로 오해된다.)
    await adoptDealerProposal({ trimId, field: "financial", dealerUserId: dealerId, adoptedBy: nonDealerId }, tx);
    const second = await trimRow(tx);
    expect(second.stampedAt).toBe(first.stampedAt);
    expect(second.financial).toBe(fresh);
  });
});
