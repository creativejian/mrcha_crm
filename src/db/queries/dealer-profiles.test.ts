import { afterAll, expect, test } from "bun:test";
import { asc, eq, sql } from "drizzle-orm";

import { brandsInCatalog } from "../catalog";
import { getDefaultDb } from "../client";
import { dealerProfiles } from "../schema";
import { listDealerProfiles, upsertDealerProfile } from "./dealer-profiles";

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

  const mine = (await listDealerProfiles(db)).find((r) => r.dealerUserId === DEALER_ID);
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

  const rows = (await listDealerProfiles(db)).filter((r) => r.dealerUserId === DEALER_ID);
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
