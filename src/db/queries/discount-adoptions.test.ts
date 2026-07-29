import { beforeAll, expect, test } from "bun:test";
import { and, eq, ne, sql } from "drizzle-orm";

import { brandsInCatalog, modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { profiles } from "../public-app";
import { catalogDiscountAdoptions, dealerProfiles, dealerTrimDiscounts } from "../schema";
import { updateTrim } from "./catalog-admin";
import { upsertDealerProfile } from "./dealer-profiles";
import { adoptDealerProposal, listModelProposals, recordAdminDiscountEdits, undoLatestAdoption } from "./discount-adoptions";

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
let modelId = 0;
let dealerId = ""; // profiles.role = 'dealer' — 자격 있음
let nonDealerId = ""; // role != 'dealer' — 자격 상실 표시 대상
let brandId = 0;
let otherBrandId = 0; // 트림의 브랜드가 아닌 브랜드 — 이직 시나리오용

beforeAll(async () => {
  const [trim] = await db
    .select({ id: trimsInCatalog.id, modelId: trimsInCatalog.modelId, brandId: modelsInCatalog.brandId })
    .from(trimsInCatalog)
    .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
    .limit(1);
  trimId = trim!.id;
  modelId = trim!.modelId;
  brandId = trim!.brandId;

  // 트림의 브랜드와 **다른** 브랜드(하드코딩 금지 — 환경마다 id가 다르다).
  const [otherBrand] = await db
    .select({ id: brandsInCatalog.id })
    .from(brandsInCatalog)
    .where(ne(brandsInCatalog.id, trim!.brandId))
    .limit(1);
  otherBrandId = otherBrand!.id;

  const [dealer] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.role, "dealer")).limit(1);
  const [admin] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.role, "admin")).limit(1);
  dealerId = dealer!.id;
  nonDealerId = admin!.id;
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

// 조회는 모델 단위이므로(화면이 셀마다 단서를 달아야 한다) 검증 대상 트림만 골라 본다.
async function proposalsOf(tx: Executor) {
  const all = await listModelProposals(modelId, tx);
  return all.find((e) => e.trimId === trimId);
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

test("listModelProposals: 딜러명·비고와 함께 제안이 나오고 필드 상태가 파생된다", async () => {
  await inRollback(async (tx) => {
    await seedProposal(tx, dealerId, { financialAmount: 6_500_000, partnerAmount: null, cashAmount: 7_000_000 });

    const result = (await proposalsOf(tx))!;
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

test("listModelProposals: role이 dealer가 아닌 제안자는 자격 상실로 표시된다", async () => {
  await inRollback(async (tx) => {
    await seedProposal(tx, nonDealerId, { financialAmount: 5_000_000, partnerAmount: null, cashAmount: null });

    const result = (await proposalsOf(tx))!;
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

// ── 관리자 직접 입력 감사(spec §3.4) ───────────────────────────────────────
// 딜러 채택만 감사에 남기면 **감사가 거짓을 말한다**: 관리자가 TrimEditPanel로 확정값을 바꿔도
// 최신 감사 행은 옛 딜러 채택이라, 팝오버가 "출처 ○○딜러 · 어제 채택"을 계속 보여준다
// (2026-07-28 유슨생 실기에서 실제로 그렇게 표시됐다 — 확정 5,500,000인데 감사는 5,000,000/딜러).
test("recordAdminDiscountEdits: 바뀐 필드만 관리자 출처(NULL)로 남는다", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    const nextFinancial = (before.financial ?? 0) + 1_500_000;

    await recordAdminDiscountEdits(
      { trimId, before, patch: { financialDiscountAmount: nextFinancial }, adoptedBy: nonDealerId },
      tx,
    );

    const audits = await tx
      .select()
      .from(catalogDiscountAdoptions)
      .where(eq(catalogDiscountAdoptions.trimId, trimId));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.field).toBe("financial");
    expect(audits[0]!.amount).toBe(nextFinancial);
    expect(audits[0]!.previousAmount).toBe(before.financial);
    // NULL = 관리자 직접 입력. 이 값이 팝오버의 "관리자 직접 입력" 표기와 상태 파생을 가른다.
    expect(audits[0]!.sourceDealerUserId).toBeNull();
    expect(audits[0]!.adoptedBy).toBe(nonDealerId);
  });
});

test("recordAdminDiscountEdits: 값이 그대로면 남기지 않는다(트리거와 같은 멱등 사상)", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    await recordAdminDiscountEdits(
      { trimId, before, patch: { financialDiscountAmount: before.financial }, adoptedBy: nonDealerId },
      tx,
    );
    expect(
      await tx.select().from(catalogDiscountAdoptions).where(eq(catalogDiscountAdoptions.trimId, trimId)),
    ).toHaveLength(0);
  });
});

test("recordAdminDiscountEdits: 할인 아닌 필드만 고치면 남기지 않는다", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    await recordAdminDiscountEdits({ trimId, before, patch: { modelYear: 2027 }, adoptedBy: nonDealerId }, tx);
    expect(
      await tx.select().from(catalogDiscountAdoptions).where(eq(catalogDiscountAdoptions.trimId, trimId)),
    ).toHaveLength(0);
  });
});

test("recordAdminDiscountEdits: 두 필드를 함께 바꾸면 2행(필드 단위 감사)", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    await recordAdminDiscountEdits(
      {
        trimId,
        before,
        patch: { financialDiscountAmount: (before.financial ?? 0) + 1, cashDiscountAmount: (before.cash ?? 0) + 2 },
        adoptedBy: nonDealerId,
      },
      tx,
    );
    const audits = await tx
      .select()
      .from(catalogDiscountAdoptions)
      .where(eq(catalogDiscountAdoptions.trimId, trimId));
    expect(audits.map((a) => a.field).sort()).toEqual(["cash", "financial"]);
  });
});

test("관리자 직접 입력 후 그 딜러 제안은 '미채택'이 된다(거짓 출처 재발 방지)", async () => {
  await inRollback(async (tx) => {
    await seedProposal(tx, dealerId, { financialAmount: 6_500_000, partnerAmount: null, cashAmount: null });

    // "어제 이 딜러 값이 채택됐다"를 심는다. ⚠️ adopted_at을 **명시**해야 한다: 같은 트랜잭션에서
    // adoptDealerProposal을 부르면 PostgreSQL의 now()가 트랜잭션 시작 시각이라 두 감사 행의 시각이
    // 완전히 같아지고, "필드별 최신 1건" 정렬이 불확정해진다(운영에선 요청마다 트랜잭션이 달라
    // 발생하지 않는다 — 테스트 특유의 조건이다). DB 시계로 심어 앱 시계를 섞지 않는다.
    await updateTrim(trimId, { financialDiscountAmount: 6_500_000 }, tx);
    await tx.insert(catalogDiscountAdoptions).values({
      trimId,
      field: "financial",
      amount: 6_500_000,
      previousAmount: null,
      sourceDealerUserId: dealerId,
      adoptedBy: nonDealerId,
      adoptedAt: sql`now() - interval '1 day'`,
    });
    expect((await proposalsOf(tx))!.proposals[0]!.financial.state).toBe("adopted");

    // 관리자가 확정값을 직접 딴 값으로 바꾼다 — 이제 출처는 딜러가 아니다.
    const manual = 9_999_000;
    const afterAdopt = await trimRow(tx);
    await recordAdminDiscountEdits(
      { trimId, before: afterAdopt, patch: { financialDiscountAmount: manual }, adoptedBy: nonDealerId },
      tx,
    );
    await updateTrim(trimId, { financialDiscountAmount: manual }, tx);

    const view = (await proposalsOf(tx))!;
    expect(view.adopted.financial.sourceDealerUserId).toBeNull(); // "관리자 직접 입력"
    // 구 동작에서는 여기가 "changed"("새 제안")로 보여 딜러가 제안을 올린 것처럼 읽혔다.
    expect(view.proposals[0]!.financial.state).toBe("none");
    expect(view.adopted.financial.amount).toBe(manual);
  });
});

test("adoptDealerProposal: 자격 상실(role != dealer) 제안자의 제안은 채택되지 않는다", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    await seedProposal(tx, nonDealerId, { financialAmount: 5_000_000, partnerAmount: null, cashAmount: null });

    // 화면은 이 제안에 "채택 불가"를 달지만, 그건 표시일 뿐이다 — API를 직접 부르면 뚫린다.
    // 딜러를 그만둔 사람의 값이 앱 고객에게 보이는 확정 할인으로 올라가는 경로를 서버가 막는다.
    const result = await adoptDealerProposal(
      { trimId, field: "financial", dealerUserId: nonDealerId, adoptedBy: nonDealerId },
      tx,
    );
    expect(result).toBeNull();
    expect((await trimRow(tx)).financial).toBe(before.financial);
    expect(
      await tx.select().from(catalogDiscountAdoptions).where(eq(catalogDiscountAdoptions.trimId, trimId)),
    ).toHaveLength(0);
  });
});

// ── 브랜드 이동/이직 (2026-07-28 유슨생) ────────────────────────────────────
// 딜러는 이직·퇴사한다. 담당 브랜드가 바뀌면 **옛 브랜드 제안은 채택할 수 없어야** 한다 —
// 그 딜러사와의 관계가 끝났는데 그때 조건을 확정 할인으로 올리는 셈이 된다.
// 쓰기 경로는 이미 브랜드 소유권으로 403인데(routes/dealer.ts) 채택 경로에는 검증이 없어서,
// **딜러 본인은 손댈 수 없게 된 제안을 관리자가 채택할 수 있었다**(실측으로 확인 후 이 가드 추가).
// ⚠️ 데이터는 지우지 않는다 — 브랜드를 되돌리면 예전 입력값을 그대로 이어 쓴다(아래 마지막 케이스).
test("adoptDealerProposal: 담당 브랜드가 다른 딜러의 제안은 채택되지 않는다", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    await seedProposal(tx, dealerId, { financialAmount: 6_500_000, partnerAmount: null, cashAmount: null });
    // 관리자가 이 딜러를 다른 브랜드로 옮긴다(이직) — 트림의 브랜드와 어긋난다.
    await upsertDealerProfile({ dealerUserId: dealerId, brandId: otherBrandId, note: "이직" }, tx);

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

test("listModelProposals: 브랜드가 어긋난 제안은 brandMatches=false로 표시된다", async () => {
  await inRollback(async (tx) => {
    await seedProposal(tx, dealerId, { financialAmount: 6_500_000, partnerAmount: null, cashAmount: null });
    expect((await proposalsOf(tx))!.proposals[0]!.brandMatches).toBe(true);

    await upsertDealerProfile({ dealerUserId: dealerId, brandId: otherBrandId, note: "이직" }, tx);
    const moved = (await proposalsOf(tx))!.proposals[0]!;
    expect(moved.brandMatches).toBe(false);
    // 자격(role)은 그대로다 — 표시가 갈려야 관리자가 이유를 안다("채택 불가" vs "브랜드 변경됨").
    expect(moved.isDealer).toBe(true);
  });
});

test("브랜드를 되돌리면 예전 입력값을 그대로 이어 쓴다(데이터는 지우지 않는다)", async () => {
  await inRollback(async (tx) => {
    await seedProposal(tx, dealerId, { financialAmount: 6_500_000, partnerAmount: null, cashAmount: null });
    const [origin] = await tx
      .select({ brandId: dealerProfiles.brandId })
      .from(dealerProfiles)
      .where(eq(dealerProfiles.dealerUserId, dealerId));

    await upsertDealerProfile({ dealerUserId: dealerId, brandId: otherBrandId, note: null }, tx);
    expect((await proposalsOf(tx))!.proposals[0]!.brandMatches).toBe(false);

    // 다시 원래 브랜드로 복귀 — 제안 행은 건드리지 않았으므로 금액이 살아 있고 채택도 된다.
    await upsertDealerProfile({ dealerUserId: dealerId, brandId: origin!.brandId, note: null }, tx);
    const back = (await proposalsOf(tx))!.proposals[0]!;
    expect(back.brandMatches).toBe(true);
    expect(back.financial.amount).toBe(6_500_000);
    expect(
      await adoptDealerProposal({ trimId, field: "financial", dealerUserId: dealerId, adoptedBy: nonDealerId }, tx),
    ).not.toBeNull();
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

    const adopted = (await proposalsOf(tx))!;
    expect(adopted.proposals.find((p) => p.dealerUserId === dealerId)!.financial.state).toBe("adopted");
    expect(adopted.adopted.financial.sourceDealerUserId).toBe(dealerId);

    // 딜러가 제안을 올려 다시 냈다 — 확정값은 그대로이므로 "재채택 필요"로 보여야 한다.
    await tx
      .update(dealerTrimDiscounts)
      .set({ financialAmount: 6_800_000 })
      .where(and(eq(dealerTrimDiscounts.trimId, trimId), eq(dealerTrimDiscounts.dealerUserId, dealerId)));

    const changed = (await proposalsOf(tx))!;
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

// ── 되돌리기(undo, 2026-07-29) ──────────────────────────────────────────────
// 토글 의미론: 최신 감사 행의 previous_amount를 복원하고 그 사실을 undo_of 행으로 남긴다.
// ⚠️ 같은 트랜잭션에선 now()가 동일해 감사 시각이 전부 같아지므로(위 "거짓 출처" 테스트 주석),
// 선행 행을 백데이트해 "최신"을 확정한다 — 운영은 요청별 트랜잭션이라 이 조작이 필요 없다.
async function backdateAudit(tx: Executor, auditId: string, interval: string) {
  await tx
    .update(catalogDiscountAdoptions)
    .set({ adoptedAt: sql`now() - ${sql.raw(`interval '${interval}'`)}` })
    .where(eq(catalogDiscountAdoptions.id, auditId));
}

test("undoLatestAdoption: 확정값이 직전 값으로 돌아가고 undo_of 감사 행이 남는다", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    const fresh = (before.financial ?? 0) + 3_456_000;
    await seedProposal(tx, dealerId, { financialAmount: fresh, partnerAmount: null, cashAmount: null });
    const adoptRow = (await adoptDealerProposal(
      { trimId, field: "financial", dealerUserId: dealerId, adoptedBy: nonDealerId },
      tx,
    ))!;
    await backdateAudit(tx, adoptRow.id, "2 hours");

    const undoRow = await undoLatestAdoption({ trimId, field: "financial", adoptedBy: nonDealerId }, tx);
    expect(undoRow).not.toBeNull();
    expect((await trimRow(tx)).financial).toBe(before.financial); // 복원
    expect(undoRow!.amount).toBe(before.financial);
    expect(undoRow!.previousAmount).toBe(fresh);
    expect(undoRow!.undoOf).toBe(adoptRow.id);
    // 최초 채택의 undo — 복원되는 값은 감사 이전 상태라 출처 불명(NULL). 딜러 채택분으로
    // 되돌아가는 경우는 출처를 이어받는다(아래 토글·직접 입력 테스트).
    expect(undoRow!.sourceDealerUserId).toBeNull();

    // 조회 파생: 출처는 "되돌림"(isUndo)으로 갈리고, 그 딜러는 "미채택"으로 돌아가 재채택 가능하다.
    const view = (await proposalsOf(tx))!;
    expect(view.adopted.financial.isUndo).toBe(true);
    expect(view.adopted.financial.previousAmount).toBe(fresh); // 다음 되돌리기(토글)가 갈 값
    expect(view.proposals.find((r) => r.dealerUserId === dealerId)!.financial.state).toBe("none");
  });
});

test("undoLatestAdoption: 토글 — 한 번 더 부르면 방금 되돌린 값이 복원된다", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    const fresh = (before.financial ?? 0) + 4_567_000;
    await seedProposal(tx, dealerId, { financialAmount: fresh, partnerAmount: null, cashAmount: null });
    const adoptRow = (await adoptDealerProposal(
      { trimId, field: "financial", dealerUserId: dealerId, adoptedBy: nonDealerId },
      tx,
    ))!;
    await backdateAudit(tx, adoptRow.id, "2 hours");

    const first = (await undoLatestAdoption({ trimId, field: "financial", adoptedBy: nonDealerId }, tx))!;
    await backdateAudit(tx, first.id, "1 hour");

    const second = (await undoLatestAdoption({ trimId, field: "financial", adoptedBy: nonDealerId }, tx))!;
    expect((await trimRow(tx)).financial).toBe(fresh); // c → b → 다시 c
    expect(second.undoOf).toBe(first.id); // 사슬이 선형으로 이어진다

    // 복원된 값은 그 딜러의 채택분이다 — 출처를 이어받아 "채택됨"이 다시 선다(2026-07-29 유슨생).
    expect(second.sourceDealerUserId).toBe(dealerId);
    const view = (await proposalsOf(tx))!;
    expect(view.adopted.financial.sourceDealerUserId).toBe(dealerId);
    expect(view.proposals.find((r) => r.dealerUserId === dealerId)!.financial.state).toBe("adopted");
  });
});

test("undoLatestAdoption: 관리자 직접 입력을 되돌리면 딜러 출처가 복귀한다", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    const fresh = (before.financial ?? 0) + 6_789_000;
    await seedProposal(tx, dealerId, { financialAmount: fresh, partnerAmount: null, cashAmount: null });
    const adoptRow = (await adoptDealerProposal(
      { trimId, field: "financial", dealerUserId: dealerId, adoptedBy: nonDealerId },
      tx,
    ))!;
    await backdateAudit(tx, adoptRow.id, "2 hours");

    // 관리자가 확정값을 직접 딴 값으로 덮는다(감사 포함 — 라우트가 하는 그대로).
    const manual = fresh + 111_000;
    const afterAdopt = await trimRow(tx);
    const [manualRow] = await recordAdminDiscountEdits(
      { trimId, before: afterAdopt, patch: { financialDiscountAmount: manual }, adoptedBy: nonDealerId },
      tx,
    );
    await updateTrim(trimId, { financialDiscountAmount: manual }, tx);
    await backdateAudit(tx, manualRow!.id, "1 hour");

    // 직접 입력을 되돌리면 값과 함께 **원 출처(딜러)가 복귀**해 "채택됨"이 다시 선다.
    const undoRow = (await undoLatestAdoption({ trimId, field: "financial", adoptedBy: nonDealerId }, tx))!;
    expect((await trimRow(tx)).financial).toBe(fresh);
    expect(undoRow.sourceDealerUserId).toBe(dealerId);
    const view = (await proposalsOf(tx))!;
    expect(view.proposals.find((r) => r.dealerUserId === dealerId)!.financial.state).toBe("adopted");
  });
});

test("undoLatestAdoption: 감사 이력이 없으면 아무것도 바꾸지 않는다(fail-closed)", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    const result = await undoLatestAdoption({ trimId, field: "financial", adoptedBy: nonDealerId }, tx);
    expect(result).toBeNull();
    expect((await trimRow(tx)).financial).toBe(before.financial);
    expect(
      await tx.select().from(catalogDiscountAdoptions).where(eq(catalogDiscountAdoptions.trimId, trimId)),
    ).toHaveLength(0);
  });
});

test("undoLatestAdoption: 확정값이 감사와 어긋나면 복원하지 않는다(드리프트 fail-closed)", async () => {
  await inRollback(async (tx) => {
    const before = await trimRow(tx);
    const fresh = (before.financial ?? 0) + 5_678_000;
    await seedProposal(tx, dealerId, { financialAmount: fresh, partnerAmount: null, cashAmount: null });
    const adoptRow = (await adoptDealerProposal(
      { trimId, field: "financial", dealerUserId: dealerId, adoptedBy: nonDealerId },
      tx,
    ))!;
    await backdateAudit(tx, adoptRow.id, "2 hours");

    // 감사 밖의 쓰기(psql 수동 조작 등) — 감사가 "직전 값"을 보증할 수 없는 상태를 흉내낸다.
    await updateTrim(trimId, { financialDiscountAmount: fresh + 1 }, tx);

    const result = await undoLatestAdoption({ trimId, field: "financial", adoptedBy: nonDealerId }, tx);
    expect(result).toBeNull();
    expect((await trimRow(tx)).financial).toBe(fresh + 1); // 손대지 않는다
  });
});
