import { eq, sql } from "drizzle-orm";

import { brandsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { profiles } from "../public-app";
import { dealerProfiles, dealerTrimDiscounts } from "../schema";

// 딜러 프로필(브랜드 매칭 + 비고) — 관리자 전용 도메인.
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §3.1

// 브랜드·비고 저장(관리자). PK 충돌을 UPDATE로 흡수해 신규/변경이 한 경로다.
// updated_at은 인라인 sql`now()` — 앱 시계(new Date())로 찍으면 앱↔DB 시계가 어긋난 만큼
// 스탬프가 과거로 되돌아간다(#334·#335, updated-at-clock-guard.test.ts가 소스를 스캔).
// 딜러 본인 프로필 단건 — **브랜드 소유권 검증(서버)** 과 Topbar 조직 라벨(B2)이 쓴다.
// null = 브랜드 미지정 → 쓰기 경로는 403(fail-closed), 화면은 안내 문구를 낸다.
// 명부(listDealerRoster)와 달리 admin 게이트가 없다 — 자기 것만 돌려주므로 노출이 없다.
export async function getDealerProfile(dealerUserId: string, executor: Executor = getDefaultDb()) {
  const [row] = await executor
    .select({
      dealerUserId: dealerProfiles.dealerUserId,
      brandId: dealerProfiles.brandId,
      brandName: brandsInCatalog.name,
      note: dealerProfiles.note,
    })
    .from(dealerProfiles)
    .leftJoin(brandsInCatalog, eq(brandsInCatalog.id, dealerProfiles.brandId))
    .where(eq(dealerProfiles.dealerUserId, dealerUserId));
  return row ?? null;
}

// 대상이 **지금** 딜러인가 — profiles.role read-through(계약상 읽기만 — staff.ts 선례).
// 브랜드 저장(PUT /profiles/:userId)의 대상 가드가 쓴다: 딜러가 아닌(또는 profiles에 없는)
// uuid에 매칭을 만들면 명부 합집합(listDealerRoster)에 유령 행("현재 딜러 아님")이 생긴다.
// 판정 기준은 채택 가드(adoptDealerProposal)와 같아야 한다 — 둘이 어긋나면 "저장은 되는데
// 채택은 안 되는" 매칭이 생긴다. 행 없음 = false(fail-closed).
export async function isDealerRole(userId: string, executor: Executor = getDefaultDb()) {
  const [row] = await executor.select({ role: profiles.role }).from(profiles).where(eq(profiles.id, userId));
  return row?.role === "dealer";
}

// 딜러 명부(조직 화면의 별도 "딜러" 테이블 — 2026-07-28 유슨생).
//
// **합집합인 이유**: 목록 기준을 `profiles.role = 'dealer'`로만 잡으면 앱에서 role이 내려간 순간
// 그 사람이 화면에서 사라지고, **그때부터 그 딜러의 데이터를 정리할 방법이 없어진다**(삭제 버튼을
// 누를 행 자체가 없다). 반대로 dealer_profiles만 보면 매칭 전 딜러에게 브랜드를 줄 수 없다.
//   role = 'dealer'          → 매칭이 없어도 보인다(브랜드 지정용)
//   OR dealer_profiles 존재  → role이 바뀌었어도 보인다(데이터 정리용, isDealer=false 배지)
//
// profiles는 **읽기만** 한다(계약 — staff.ts 선례). 제안 수는 삭제 확인 팝업이 "지울 N건"을
// 보여주는 데 쓴다 — 무엇을 지우는지 모르고 누르는 상황을 만들지 않는다.
//
// ⚠️ **한계**: FROM이 `public.profiles`라 **profiles에 없는 고아는 나오지 않는다**(앱이 유저를
// 하드 삭제하면 dealer_profiles·제안만 남는다). 그건 화면 대상이 아니라 잔재 정리 대상이고,
// `check:residue`의 고아 판정이 이미 잡는다(test-utils/fixture-residue.ts). 여기서 그런 행까지
// 보여주면 "앱에 없는 사람"이 딜러 명부에 유령으로 뜬다.
export async function listDealerRoster(executor: Executor = getDefaultDb()) {
  const rows = await executor.execute(sql`
    select
      p.id::text                                as dealer_user_id,
      p.full_name                               as name,
      p.phone_number                            as phone,
      (p.role = 'dealer')                       as is_dealer,
      dp.brand_id                               as brand_id,
      b.name                                    as brand_name,
      dp.note                                   as note,
      (select count(*) from crm.dealer_trim_discounts d where d.dealer_user_id = p.id)::int as proposal_count
    from public.profiles p
    left join crm.dealer_profiles dp on dp.dealer_user_id = p.id
    left join catalog.brands b on b.id = dp.brand_id
    where p.role = 'dealer' or dp.dealer_user_id is not null
    order by (p.role = 'dealer') desc, p.full_name`);
  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    dealerUserId: String(r.dealer_user_id),
    name: r.name === null ? null : String(r.name),
    phone: r.phone === null ? null : String(r.phone),
    isDealer: r.is_dealer === true,
    brandId: r.brand_id === null ? null : Number(r.brand_id),
    /** null = 브랜드 미지정, 또는 그 브랜드가 catalog에서 삭제됨(brandId가 있는데 이름이 null). */
    brandName: r.brand_name === null ? null : String(r.brand_name),
    note: r.note === null ? null : String(r.note),
    proposalCount: Number(r.proposal_count ?? 0),
  }));
}

// 그 딜러가 입력한 **제안 전부** 삭제(관리자). 브랜드 매칭은 남으므로 딜러가 다시 입력할 수 있다.
//
// ⚠️ **채택된 확정 할인(catalog.trims)과 채택 감사는 건드리지 않는다.** 채택은 관리자의 결정이었고
// 이미 고객 견적 계산에 반영된 값이다 — 지우면 고객에게 가는 금액이 조용히 바뀐다(spec §5).
// 감사를 지우면 "누가 확정 할인을 바꿨는지"와 되돌리기 근거(previous_amount)가 사라진다.
export async function deleteDealerProposals(dealerUserId: string, executor: Executor = getDefaultDb()) {
  const rows = await executor
    .delete(dealerTrimDiscounts)
    .where(eq(dealerTrimDiscounts.dealerUserId, dealerUserId))
    .returning({ id: dealerTrimDiscounts.id });
  return rows.length;
}

// 딜러 해제(관리자) — 제안 + 브랜드 매칭을 함께 지운다. 목록에서 그 행이 사라진다(role이 dealer면
// 남지만 브랜드 미지정 상태가 된다).
//
// ⚠️ **앱의 role은 그대로다** — CRM은 `public.profiles`에 쓸 수 없다(앱과 합의한 read 전용 계약).
// 그 사람은 여전히 CRM에 로그인해 "담당 브랜드가 지정되지 않았습니다"를 보게 된다. role까지
// 내리려면 앱 어드민에서 따로 해야 하고, 화면 팝업이 이 사실을 알린다.
export async function deleteDealerProfile(dealerUserId: string, executor: Executor = getDefaultDb()) {
  const proposals = await deleteDealerProposals(dealerUserId, executor);
  const rows = await executor
    .delete(dealerProfiles)
    .where(eq(dealerProfiles.dealerUserId, dealerUserId))
    .returning({ id: dealerProfiles.dealerUserId });
  return { proposals, profileRemoved: rows.length > 0 };
}

export async function upsertDealerProfile(
  input: { dealerUserId: string; brandId: number; note: string | null },
  executor: Executor = getDefaultDb(),
) {
  const [row] = await executor
    .insert(dealerProfiles)
    .values({ dealerUserId: input.dealerUserId, brandId: input.brandId, note: input.note })
    .onConflictDoUpdate({
      target: dealerProfiles.dealerUserId,
      set: { brandId: input.brandId, note: input.note, updatedAt: sql`now()` },
    })
    .returning();
  return row ?? null;
}
