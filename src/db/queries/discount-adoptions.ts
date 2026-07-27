import { and, desc, eq, inArray } from "drizzle-orm";

import {
  DISCOUNT_FIELDS,
  proposalState,
  type DiscountField,
  type ProposalState,
} from "../../../client/src/lib/discount-adoption";
import { trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { profiles } from "../public-app";
import { catalogDiscountAdoptions, dealerProfiles, dealerTrimDiscounts } from "../schema";
import { updateTrim } from "./catalog-admin";

// 관리자 채택(슬라이스 C) — 딜러 제안(crm.dealer_trim_discounts)을 확정 할인(catalog.trims)으로
// 올리고 그 사실을 감사에 남긴다. 자사·제휴·타사는 **각각 독립**이다(이사님 요구 — 자사는
// 동성모터스, 제휴는 코오롱 값을 채택할 수 있다). 그래서 감사가 필드 단위 1행이다.
// 필드 어휘(DiscountField)는 client/src/lib/discount-adoption.ts가 SSOT다 — 라우트 zod enum과
// 클라 팝오버가 같은 값을 봐야 하고, 부작용 0 순수 모듈이라 서버가 import할 수 있다(AGENTS.md).
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §3.3·§4·§5

// 필드 하나가 세 곳을 가리킨다: 제안 컬럼 · 확정 컬럼 · updateTrim 패치 키.
// 한 곳에 모아 두지 않으면 필드를 추가할 때 세 군데가 어긋난다(어긋나도 타입은 통과한다).
const FIELD_MAP = {
  financial: { proposal: "financialAmount", trim: "financialDiscountAmount" },
  partner: { proposal: "partnerAmount", trim: "partnerDiscountAmount" },
  cash: { proposal: "cashAmount", trim: "cashDiscountAmount" },
} as const satisfies Record<DiscountField, { proposal: string; trim: string }>;

// 아래 세 타입은 TrimProposals의 구성 요소일 뿐이라 export하지 않는다 — 소비자는
// `TrimProposals["proposals"][number]`로 닿을 수 있고, 같은 파일에서만 쓰는 export는
// knip 기준선 0을 깨뜨린다(#333 선례).
type TrimProposalField = { amount: number | null; state: ProposalState };

type TrimProposal = {
  dealerUserId: string;
  /** public.profiles.full_name read-through — 계약상 읽기만 한다(staff.ts 선례). */
  dealerName: string | null;
  /** crm.dealer_profiles.note = 딜러사명("동성모터스") — 관리자가 조직 화면에서 입력. */
  dealerNote: string | null;
  /**
   * profiles.role === 'dealer'. false면 **채택 불가**(자격 상실) — 딜러를 그만둔 사람의 제안이
   * 확정 할인으로 올라가는 것을 막는다. soft delete 컬럼을 두지 않고 read-through로 판정한다:
   * 자격의 출처가 앱 profiles이므로 CRM이 사본을 들면 그 순간부터 어긋난다(spec §5).
   */
  isDealer: boolean;
  financial: TrimProposalField;
  partner: TrimProposalField;
  cash: TrimProposalField;
  updatedAt: string;
};

type TrimAdoptedField = {
  amount: number | null;
  /** NULL = 관리자 직접 입력(TrimEditPanel 경로) 또는 채택 이력 없음. */
  sourceDealerUserId: string | null;
  adoptedAt: string | null;
};

export type TrimProposals = {
  trimId: number;
  adopted: Record<DiscountField, TrimAdoptedField>;
  proposals: TrimProposal[];
};


// 모델 1개의 전 트림 × 전 딜러 제안(admin 전용 — 딜러에게 남의 제안을 보여주면 경쟁사 할인
// 전략 노출이고, 라우트가 requireRoles(["admin"])로 막는다).
//
// **모델 단위인 이유**: 화면은 트림 표의 할인 셀마다 "제안 있음" 단서를 달아야 하므로 목록
// 전체의 제안을 알아야 한다. 트림 단위로 받으면 트림 수만큼 왕복한다(5시리즈는 13개).
// 딜러 쪽 listMyTrimDiscounts(dealerUserId, modelId)와 같은 축이다.
//
// **제안이 0건인 트림은 반환하지 않는다** — 채택할 것이 없어 팝오버를 열 이유가 없고,
// 확정 할인 자체는 트림 목록 응답에 이미 있다(페이로드를 두 번 싣지 않는다).
export async function listModelProposals(
  modelId: number,
  executor: Executor = getDefaultDb(),
): Promise<TrimProposals[]> {
  const trims = await executor
    .select({
      id: trimsInCatalog.id,
      financial: trimsInCatalog.financialDiscountAmount,
      partner: trimsInCatalog.partnerDiscountAmount,
      cash: trimsInCatalog.cashDiscountAmount,
    })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.modelId, modelId));
  if (trims.length === 0) return [];
  const trimIds = trims.map((t) => t.id);

  // 필드별 **최신 1건**만 의미가 있다(그 이전 채택은 이미 덮였다). distinct on 대신 시각
  // 역순으로 받아 (트림, 필드)별 첫 건을 집는다 — 트림당 채택 횟수는 사람 손 단위라 작다.
  const audits = await executor
    .select({
      trimId: catalogDiscountAdoptions.trimId,
      field: catalogDiscountAdoptions.field,
      sourceDealerUserId: catalogDiscountAdoptions.sourceDealerUserId,
      adoptedAt: catalogDiscountAdoptions.adoptedAt,
    })
    .from(catalogDiscountAdoptions)
    .where(inArray(catalogDiscountAdoptions.trimId, trimIds))
    .orderBy(desc(catalogDiscountAdoptions.adoptedAt));

  const rows = await executor
    .select({
      trimId: dealerTrimDiscounts.trimId,
      dealerUserId: dealerTrimDiscounts.dealerUserId,
      financialAmount: dealerTrimDiscounts.financialAmount,
      partnerAmount: dealerTrimDiscounts.partnerAmount,
      cashAmount: dealerTrimDiscounts.cashAmount,
      updatedAt: dealerTrimDiscounts.updatedAt,
      dealerName: profiles.fullName,
      role: profiles.role,
      dealerNote: dealerProfiles.note,
    })
    .from(dealerTrimDiscounts)
    .leftJoin(profiles, eq(profiles.id, dealerTrimDiscounts.dealerUserId))
    .leftJoin(dealerProfiles, eq(dealerProfiles.dealerUserId, dealerTrimDiscounts.dealerUserId))
    .where(inArray(dealerTrimDiscounts.trimId, trimIds))
    .orderBy(dealerTrimDiscounts.createdAt);

  const out: TrimProposals[] = [];
  for (const trim of trims) {
    const mine = rows.filter((r) => r.trimId === trim.id);
    if (mine.length === 0) continue;

    const adopted = {} as Record<DiscountField, TrimAdoptedField>;
    for (const field of DISCOUNT_FIELDS) {
      const latest = audits.find((a) => a.trimId === trim.id && a.field === field);
      adopted[field] = {
        amount: trim[field],
        sourceDealerUserId: latest?.sourceDealerUserId ?? null,
        adoptedAt: latest ? latest.adoptedAt.toISOString() : null,
      };
    }

    out.push({
      trimId: trim.id,
      adopted,
      proposals: mine.map((r) => {
        const field = (f: DiscountField): TrimProposalField => {
          const amount = r[FIELD_MAP[f].proposal];
          return {
            amount,
            state: proposalState({
              proposalAmount: amount,
              adoptedAmount: adopted[f].amount,
              adoptedFromThisDealer: adopted[f].sourceDealerUserId === r.dealerUserId,
            }),
          };
        };
        return {
          dealerUserId: r.dealerUserId,
          dealerName: r.dealerName,
          dealerNote: r.dealerNote,
          isDealer: r.role === "dealer",
          financial: field("financial"),
          partner: field("partner"),
          cash: field("cash"),
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
    });
  }
  return out;
}

// 필드 단위 채택 — 딜러 제안값을 확정 할인으로 올리고 감사 1행을 남긴다.
//
// ⚠️ **금액을 인자로 받지 않는다.** 호출자가 금액을 정할 수 있으면 관리자가 딜러가 제안하지도
// 않은 값을 그 딜러 출처로 기록할 수 있고, 그 순간 감사가 거짓이 된다(감사의 존재 이유가
// "딜러가 낸 값이 확정으로 올라간 경위"이므로 출처와 금액은 한 몸이어야 한다).
//
// ⚠️ **discount_updated_at을 넣지 않는다.** 트리거 trims_discount_updated(BEFORE UPDATE →
// catalog.update_discount_timestamp)가 3할인 중 하나라도 IS DISTINCT FROM일 때만 now()를 찍는다.
// 직접 찍으면 같은 값 재채택에도 스탬프가 전진해 "방금 할인이 바뀐 트림"으로 오해된다.
//
// ⚠️ **원자성은 호출자 책임이다.** executor가 트랜잭션이 아니면 확정 갱신과 감사가 따로 커밋된다
// (updateQuote 선례와 같은 관례 — 라우트가 c.var.db.transaction()을 연다).
export async function adoptDealerProposal(
  input: { trimId: number; field: DiscountField; dealerUserId: string; adoptedBy: string },
  executor: Executor = getDefaultDb(),
) {
  // 자격 상실자(딜러를 그만둔 사람)의 제안은 확정 할인으로 올라갈 수 없다. 화면이 "채택 불가"를
  // 달아 주지만 그건 표시일 뿐이고, API를 직접 부르면 뚫린다 — 여기가 유일한 방어선이다.
  // 판정은 listModelProposals의 isDealer와 같은 read-through 기준이어야 한다(둘이 어긋나면
  // 화면엔 채택 가능으로 보이는데 눌러도 안 되는 상태가 된다).
  const [author] = await executor
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, input.dealerUserId));
  if (author?.role !== "dealer") return null;

  const [proposal] = await executor
    .select({
      financialAmount: dealerTrimDiscounts.financialAmount,
      partnerAmount: dealerTrimDiscounts.partnerAmount,
      cashAmount: dealerTrimDiscounts.cashAmount,
    })
    .from(dealerTrimDiscounts)
    .where(
      and(eq(dealerTrimDiscounts.trimId, input.trimId), eq(dealerTrimDiscounts.dealerUserId, input.dealerUserId)),
    );
  if (!proposal) return null;

  // 그 필드가 비어 있으면 "미제안"이다(schema 주석) — 채택할 값이 없으므로 아무것도 하지 않는다.
  // 확정 할인을 **비우는** 것은 채택이 아니라 관리자 직접 편집(TrimEditPanel)의 일이다.
  const amount = proposal[FIELD_MAP[input.field].proposal];
  if (amount === null) return null;

  const [trim] = await executor
    .select({
      financial: trimsInCatalog.financialDiscountAmount,
      partner: trimsInCatalog.partnerDiscountAmount,
      cash: trimsInCatalog.cashDiscountAmount,
    })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.id, input.trimId));
  if (!trim) return null;

  await updateTrim(input.trimId, { [FIELD_MAP[input.field].trim]: amount }, executor);

  const [audit] = await executor
    .insert(catalogDiscountAdoptions)
    .values({
      trimId: input.trimId,
      field: input.field,
      amount,
      previousAmount: trim[input.field],
      sourceDealerUserId: input.dealerUserId,
      adoptedBy: input.adoptedBy,
    })
    .returning();
  return audit ?? null;
}
