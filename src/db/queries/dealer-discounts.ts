import { and, eq, sql } from "drizzle-orm";

import { modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { dealerTrimDiscounts } from "../schema";

// 딜러 할인 제안(crm.dealer_trim_discounts) — **제안값이고 확정값이 아니다.**
// 확정 할인(catalog.trims 3컬럼)은 관리자 채택으로만 바뀐다(슬라이스 C).
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §3.2·§6.2

// 트림의 소속 브랜드. 딜러 쓰기 범위 검증의 근거다 — cross-schema 조인이라 DB CHECK로 강제할 수
// 없어서 **서버 검증이 유일한 방어선**이고, 그래서 routes/dealer.discounts.test.ts가 그 축을 잠근다.
// 없는 트림은 null → 호출부가 403으로 막는다(fail-closed).
export async function brandIdOfTrim(trimId: number, executor: Executor = getDefaultDb()) {
  const [row] = await executor
    .select({ brandId: modelsInCatalog.brandId })
    .from(trimsInCatalog)
    .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
    .where(eq(trimsInCatalog.id, trimId));
  return row?.brandId ?? null;
}

// 내 제안만(모델 단위). **다른 딜러의 제안은 절대 섞지 않는다** — 경쟁사 할인 전략 노출이다.
// (관리자 채택 화면은 전 딜러 제안을 보지만 그건 슬라이스 C의 admin 라우트다.)
export async function listMyTrimDiscounts(
  dealerUserId: string,
  modelId: number,
  executor: Executor = getDefaultDb(),
) {
  return executor
    .select({
      trimId: dealerTrimDiscounts.trimId,
      financialAmount: dealerTrimDiscounts.financialAmount,
      partnerAmount: dealerTrimDiscounts.partnerAmount,
      cashAmount: dealerTrimDiscounts.cashAmount,
      updatedAt: dealerTrimDiscounts.updatedAt,
    })
    .from(dealerTrimDiscounts)
    .innerJoin(trimsInCatalog, eq(trimsInCatalog.id, dealerTrimDiscounts.trimId))
    .where(and(eq(dealerTrimDiscounts.dealerUserId, dealerUserId), eq(trimsInCatalog.modelId, modelId)));
}

// 제안 저장. UNIQUE(trim_id, dealer_user_id) 충돌을 UPDATE로 흡수해 신규/변경이 한 경로다.
// updated_at은 인라인 sql`now()` — 앱 시계로 찍으면 스탬프가 과거로 되돌아간다(#334·#335).
//
// **세 금액이 모두 비면 행을 지운다**(2026-07-31 유슨생: "입력했다 삭제하면 기록에도 없어야 한다").
// 빈 값 = 그 필드는 미제안이므로, 셋 다 비면 그 행이 주장하는 사실이 하나도 없다. 남겨두면
// 딜러 명부 "보기(N)"·내 입력 트림 목록에 **아무 금액도 없는 유령 행**으로 뜬다(실기 발견).
// 표시 쪽에서 거르지 않고 여기서 지우는 이유: 카운트(dealer-profiles.ts의 proposal_count
// 서브쿼리)와 목록(listDealerProposalTrims)이 서로 다른 쿼리라, 읽기에서 거르면 두 곳을 늘 같이
// 고쳐야 하고 한쪽만 바뀌면 "보기(4)인데 3건"이 된다. 관리자 할인 셀도 이미 필드별로 따로
// 거르고 있어서, 원천에서 지우는 편이 규칙이 한 곳에 남는다.
// ⚠️채택 이력은 안 끊긴다 — crm.catalog_discount_adoptions가 별도 테이블이라 이 행이 사라져도
// "누가·언제·어느 딜러 값을" 감사가 남는다. 재입력도 UNIQUE upsert라 그냥 새로 만들어진다.
// 반환 null = **삭제됨**(신규/변경은 row) — 호출부는 이 둘을 구분해서 화면을 갱신해야 한다.
export async function saveDealerTrimDiscount(
  input: {
    trimId: number;
    dealerUserId: string;
    financialAmount: number | null;
    partnerAmount: number | null;
    cashAmount: number | null;
  },
  executor: Executor = getDefaultDb(),
) {
  if (input.financialAmount === null && input.partnerAmount === null && input.cashAmount === null) {
    await executor
      .delete(dealerTrimDiscounts)
      .where(
        and(
          eq(dealerTrimDiscounts.trimId, input.trimId),
          eq(dealerTrimDiscounts.dealerUserId, input.dealerUserId),
        ),
      );
    return null;
  }
  const [row] = await executor
    .insert(dealerTrimDiscounts)
    .values(input)
    .onConflictDoUpdate({
      target: [dealerTrimDiscounts.trimId, dealerTrimDiscounts.dealerUserId],
      set: {
        financialAmount: input.financialAmount,
        partnerAmount: input.partnerAmount,
        cashAmount: input.cashAmount,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row ?? null;
}
