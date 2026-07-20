// 테스트 픽스처 잔재 검사·정리 (2026-07-10).
//
//   bun run check:residue              잔재가 있으면 목록 출력 후 exit 1
//   bun run check:residue -- --clean   crm 스키마의 잔재를 실제로 삭제
//
// 검사 자체는 `src/test-utils/fixture-residue.test.ts`가 매 `test:server`마다 돌린다.
// 이 스크립트는 **정리**와 **아무 때나 확인**을 위한 것이다.
//
// ⚠️ `--clean`은 crm 스키마만 지운다. `public.advisor_quotes` 고아 카드는 **보고만** 한다 —
// 앱 소유 스키마의 행을 스크립트가 자동 삭제하지 않는다(고객 삭제 슬라이스의 소유권 경계와 동일).
import { sql } from "drizzle-orm";

import { getDefaultDb } from "../db/client";
import {
  customerResidueWhere, formatResidue, QUOTE_CODE_REGEX, residueCount, scanFixtureResidue,
} from "../test-utils/fixture-residue";

const db = getDefaultDb();
const clean = process.argv.includes("--clean");

const residue = await scanFixtureResidue(db);
if (residueCount(residue) === 0) {
  console.log("[residue] 테스트 픽스처 잔재 없음 ✅");
  process.exit(0);
}

console.error(`\n[residue] ⚠️ 공유 master에 테스트 잔재가 남아 있습니다 (${residueCount(residue)}건)\n`);
console.error(formatResidue(residue).replace(/^/gm, "  "));

if (!clean) {
  console.error(`\n  정리: bun run check:residue -- --clean   (crm 스키마만 지웁니다)`);
  if (residue.orphanAppCards > 0) {
    console.error(`  고아 앱 카드는 자동 삭제하지 않습니다 — public은 앱 소유입니다. 수동 확인 후 처리하세요.`);
  }
  if (residue.consultations.length > 0) {
    console.error(`  상담신청 잔재도 자동 삭제하지 않습니다 — public.consultations는 앱 소유입니다. 수동 psql DELETE로 정리하세요(DELETE는 알림 트리거 무관).`);
  }
  process.exit(1);
}

// crm.quotes → customers FK는 NO ACTION이라 견적을 먼저 지운다. 자식 6종(출고 정보 포함)과 임베딩은 CASCADE.
// ⚠️ 이 crm.quotes 직접 DELETE는 deleteQuote()의 임베딩 정리를 우회한다 — 지금은 전 픽스처 견적이
// 픽스처 고객 소속이라 아래 customers DELETE의 embeddings CASCADE가 흡수하지만, **실고객 소속
// 픽스처 견적을 만들면 고아 임베딩이 남는다**(금지 — 픽스처 견적은 항상 픽스처 고객에 건다).
// customer_deletions는 두 조건으로 지운다: ①이름 잔재 고객의 감사 행(서브셀렉트 — customers delete보다
// 먼저 와야 한다) ②scan(scanFixtureResidue.deletionAudits)과 동일 술어 customerResidueWhere()
// (코드 정규식 + 이름 registry — 감사 행은 고객 행이 이미 없어도 남는다).
await db.transaction(async (tx) => {
  await tx.execute(sql`delete from crm.quotes where quote_code ~ ${QUOTE_CODE_REGEX}`);
  await tx.execute(sql`delete from crm.quotes where customer_id in (select id from crm.customers where ${customerResidueWhere()})`);
  await tx.execute(sql`delete from crm.customer_deletions where customer_code in (select customer_code from crm.customers where ${customerResidueWhere()})`);
  await tx.execute(sql`delete from crm.customers where ${customerResidueWhere()}`);
  await tx.execute(sql`delete from crm.customer_deletions where ${customerResidueWhere()}`);
});
console.error(`\n[residue] crm 스키마 잔재를 삭제했습니다.`);
if (residue.orphanAppCards > 0) console.error(`  고아 앱 카드 ${residue.orphanAppCards}건은 그대로 두었습니다(앱 소유).`);
if (residue.consultations.length > 0) {
  console.error(`  상담신청 잔재 ${residue.consultations.length}건은 그대로 두었습니다(public 앱 소유) — 수동 psql DELETE로 정리하세요.`);
}
process.exit(1); // 정리했어도 "잔재가 있었다"는 사실은 실패로 알린다
