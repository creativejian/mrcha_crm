import { eq, sql } from "drizzle-orm";

import { brandsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { dealerProfiles } from "../schema";

// 딜러 프로필(브랜드 매칭 + 비고) — 관리자 전용 도메인.
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §3.1

// 전 딜러 프로필. **public.profiles를 조인하지 않는다** — 조직 화면이 이미 구성원 목록을 갖고 있어
// 클라에서 dealerUserId로 merge하면 되고, profiles는 read 전용 계약이라 접점을 늘릴 이유가 없다.
// 브랜드명은 **leftJoin**: brand_id에 FK가 없어(정책 — 스키마 주석 참조) 삭제된 브랜드를 가리킬 수
// 있고, 그때 inner join이면 행이 사라져 "브랜드 미지정"으로 고칠 기회조차 없어진다(null = 삭제됨).
export async function listDealerProfiles(executor: Executor = getDefaultDb()) {
  return executor
    .select({
      dealerUserId: dealerProfiles.dealerUserId,
      brandId: dealerProfiles.brandId,
      brandName: brandsInCatalog.name,
      note: dealerProfiles.note,
    })
    .from(dealerProfiles)
    .leftJoin(brandsInCatalog, eq(brandsInCatalog.id, dealerProfiles.brandId));
}

// 브랜드·비고 저장(관리자). PK 충돌을 UPDATE로 흡수해 신규/변경이 한 경로다.
// updated_at은 인라인 sql`now()` — 앱 시계(new Date())로 찍으면 앱↔DB 시계가 어긋난 만큼
// 스탬프가 과거로 되돌아간다(#334·#335, updated-at-clock-guard.test.ts가 소스를 스캔).
// 딜러 본인 프로필 단건 — **브랜드 소유권 검증(서버)** 과 Topbar 조직 라벨(B2)이 쓴다.
// null = 브랜드 미지정 → 쓰기 경로는 403(fail-closed), 화면은 안내 문구를 낸다.
// 목록(listDealerProfiles)과 달리 admin 게이트가 없다 — 자기 것만 돌려주므로 노출이 없다.
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
