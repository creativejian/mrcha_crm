import { and, desc, eq, inArray } from "drizzle-orm";

import {
  DISCOUNT_FIELDS,
  proposalState,
  type DiscountField,
  type ProposalState,
} from "../../../client/src/lib/discount-adoption";
import { modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { profiles } from "../public-app";
import { catalogDiscountAdoptions, dealerProfiles, dealerTrimDiscounts } from "../schema";
import { updateTrim, type TrimPatch } from "./catalog-admin";
import { brandIdOfTrim } from "./dealer-discounts";

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
  /**
   * 제안자의 현재 담당 브랜드가 **이 트림의 브랜드와 같은가**. false면 채택 불가 —
   * 딜러는 이직·퇴사한다(2026-07-28 유슨생). 담당이 바뀐 뒤 옛 브랜드 제안을 확정으로 올리면
   * 관계가 끝난 딜러사의 조건을 쓰는 셈이다. `isDealer`와 **따로 두는 이유**: 화면이 "채택 불가"와
   * "브랜드 변경됨"을 구분해 보여줘야 관리자가 이유를 안다.
   * 쓰기 경로는 이미 같은 기준으로 403이었는데(routes/dealer.ts) 채택 경로에만 없어서,
   * **딜러 본인은 손댈 수 없게 된 제안을 관리자가 채택할 수 있었다**(실측 확인 후 추가).
   */
  brandMatches: boolean;
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
  /** 최신 감사 행의 직전 값 — 되돌리기 버튼이 "무엇으로 돌아가는지"를 누르기 전에 보여준다. */
  previousAmount: number | null;
  /** 최신 감사 행이 되돌림(undo_of 보유)인가 — 출처 라벨을 "되돌림"으로 가른다. */
  isUndo: boolean;
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
  // 모델의 브랜드는 하나다 — 트림마다 조회할 필요 없이 여기서 한 번 얻어 brandMatches에 쓴다.
  const trims = await executor
    .select({
      id: trimsInCatalog.id,
      brandId: modelsInCatalog.brandId,
      financial: trimsInCatalog.financialDiscountAmount,
      partner: trimsInCatalog.partnerDiscountAmount,
      cash: trimsInCatalog.cashDiscountAmount,
    })
    .from(trimsInCatalog)
    .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
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
      previousAmount: catalogDiscountAdoptions.previousAmount,
      undoOf: catalogDiscountAdoptions.undoOf,
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
      dealerBrandId: dealerProfiles.brandId, // 현재 담당 브랜드 — 트림 브랜드와 대조(brandMatches)
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
        previousAmount: latest?.previousAmount ?? null,
        isUndo: latest ? latest.undoOf !== null : false,
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
          // 프로필이 없으면(매칭 삭제) null이라 자동으로 false — fail-closed.
          brandMatches: r.dealerBrandId === trim.brandId,
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

// 관리자 직접 입력 감사(spec §3.4) — `PATCH /api/catalog/trims/:id`(TrimEditPanel 저장)가 부른다.
//
// ⚠️ 이게 없으면 **감사가 거짓을 말한다**: 딜러 채택만 기록되므로, 관리자가 확정값을 직접 바꿔도
// 최신 감사 행은 옛 딜러 채택이고 팝오버가 "출처 ○○딜러 · 어제 채택"을 계속 보여준다.
// 2026-07-28 유슨생 실기에서 실제로 그렇게 됐다(확정 5,500,000 · 감사 5,000,000/딜러). 게다가
// proposalState가 그 딜러를 출처로 보고 "수정됨"(새 제안)으로 판정해, 딜러가 제안을 올린 것처럼
// 읽혔다 — `source_dealer_user_id = NULL`이 들어가면 그 딜러는 "미채택"으로 정확히 떨어진다.
//
// **바뀐 필드만** 남긴다: 같은 값 재저장에 행을 쌓으면 감사가 노이즈가 되고, 트리거가
// discount_updated_at을 안 찍는 것과도 어긋난다(두 기록이 같은 사상이어야 읽는 사람이 안 헷갈린다).
export async function recordAdminDiscountEdits(
  input: {
    trimId: number;
    /** 갱신 **전** 확정 3금액. 호출자가 같은 트랜잭션에서 먼저 읽어 넘긴다. */
    before: { financial: number | null; partner: number | null; cash: number | null };
    /** 라우트가 받은 patch 그대로(할인 외 키는 무시된다). */
    patch: TrimPatch;
    adoptedBy: string;
  },
  executor: Executor = getDefaultDb(),
) {
  const rows = DISCOUNT_FIELDS.flatMap((field) => {
    const key = FIELD_MAP[field].trim;
    // 패치에 그 키가 아예 없으면 "안 건드림"이다(null을 보낸 "비우기"와 구분해야 한다).
    if (!(key in input.patch)) return [];
    const next = input.patch[key] ?? null;
    const previous = input.before[field];
    if (next === previous) return [];
    return [
      {
        trimId: input.trimId,
        field,
        amount: next,
        previousAmount: previous,
        sourceDealerUserId: null, // = 관리자 직접 입력
        adoptedBy: input.adoptedBy,
      },
    ];
  });
  if (rows.length === 0) return [];
  return executor.insert(catalogDiscountAdoptions).values(rows).returning();
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

  // **담당 브랜드 대조**(2026-07-28) — 딜러는 이직·퇴사한다. 담당이 바뀐 뒤 옛 브랜드 제안을
  // 확정으로 올리면 관계가 끝난 딜러사의 조건을 쓰는 셈이다. 쓰기 경로(routes/dealer.ts)가 쓰는
  // `brandIdOfTrim`을 **그대로 재사용**한다 — 기준이 갈리면 "쓰기는 403인데 채택은 통과"가 다시 생긴다.
  // 프로필이 없으면(매칭 삭제) 대조 대상이 없으니 거부한다(fail-closed).
  const [dealerProfile] = await executor
    .select({ brandId: dealerProfiles.brandId })
    .from(dealerProfiles)
    .where(eq(dealerProfiles.dealerUserId, input.dealerUserId));
  const trimBrandId = await brandIdOfTrim(input.trimId, executor);
  if (!dealerProfile || trimBrandId === null || dealerProfile.brandId !== trimBrandId) return null;

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

// 되돌리기(undo, 2026-07-29) — 최신 감사 행의 previous_amount를 확정 할인으로 복원하고,
// 그 사실을 **새 감사 행**(undo_of = 취소한 행)으로 남긴다. 사슬이 선형으로 유지되므로
// 한 번 더 누르면 방금 되돌린 값이 복원된다(**토글 의미론** — 유슨생 확정. c→b, 다시 c).
//
// ⚠️ **드리프트 검증**: 현재 확정값 ≠ 최신 감사 행 amount면 거부한다(fail-closed). 모든 쓰기
// 경로(채택·관리자 직접 입력)가 감사를 남기므로 정상 상태에선 항상 일치하는데, 만약 어긋났다면
// (psql 수동 조작 등 감사 밖의 쓰기) "직전 값"이 무엇인지 감사가 보증할 수 없다 — 그 상태에서
// 복원하면 되돌리기가 엉뚱한 값을 만든다.
//
// ⚠️ **원자성은 호출자 책임**(adoptDealerProposal과 같은 관례) — 라우트가 트랜잭션을 연다.
// discount_updated_at은 여기서도 넣지 않는다 — 트리거가 값 변경 시에만 찍는다(위 채택 주석).
export async function undoLatestAdoption(
  input: { trimId: number; field: DiscountField; adoptedBy: string },
  executor: Executor = getDefaultDb(),
) {
  // 최신 1건 = 되돌릴 사건, 그 직전 1건 = **복원되는 값을 만든 행**(출처 이어받기용 — 아래).
  const [latest, prior] = await executor
    .select({
      id: catalogDiscountAdoptions.id,
      amount: catalogDiscountAdoptions.amount,
      previousAmount: catalogDiscountAdoptions.previousAmount,
      sourceDealerUserId: catalogDiscountAdoptions.sourceDealerUserId,
    })
    .from(catalogDiscountAdoptions)
    .where(and(eq(catalogDiscountAdoptions.trimId, input.trimId), eq(catalogDiscountAdoptions.field, input.field)))
    .orderBy(desc(catalogDiscountAdoptions.adoptedAt))
    .limit(2);
  if (!latest) return null; // 이력 없음 — 되돌릴 사건이 없다

  const [trim] = await executor
    .select({
      financial: trimsInCatalog.financialDiscountAmount,
      partner: trimsInCatalog.partnerDiscountAmount,
      cash: trimsInCatalog.cashDiscountAmount,
    })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.id, input.trimId));
  if (!trim) return null;
  if (trim[input.field] !== latest.amount) return null; // 감사·확정 드리프트 — 위 주석

  await updateTrim(input.trimId, { [FIELD_MAP[input.field].trim]: latest.previousAmount }, executor);

  // 출처는 **복원되는 값의 원 출처**를 이어받는다(2026-07-29 유슨생 — 딜러 채택분으로 되돌리면
  // "채택됨"이 다시 서야 한다). source_dealer_user_id의 의미가 "어느 딜러의 값인가"이고 주체는
  // adopted_by가 말하므로, 값이 실제로 그 딜러의 채택분인 한 이어받는 게 감사로서 참이다 —
  // 2026-07-28 "거짓 출처" 사고는 딜러가 내지 않은 값에 출처가 붙는 반대 방향이었다.
  // 직전 행이 없거나(최초 채택의 undo — 감사 이전 값이라 출처 불명) 금액 사슬이 어긋나면
  // (모든 쓰기가 감사를 남기는 한 없는 상태) NULL로 남긴다(fail-closed).
  const restoredSource =
    prior && prior.amount === latest.previousAmount ? prior.sourceDealerUserId : null;

  const [audit] = await executor
    .insert(catalogDiscountAdoptions)
    .values({
      trimId: input.trimId,
      field: input.field,
      amount: latest.previousAmount,
      previousAmount: latest.amount,
      sourceDealerUserId: restoredSource,
      adoptedBy: input.adoptedBy,
      undoOf: latest.id,
    })
    .returning();
  return audit ?? null;
}
