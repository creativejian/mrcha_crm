// 기존 앱 연결 고객의 대표 견적요청을 **최초 요청**으로 정하고 need_* 7필드를 파생값으로 덮는다
// (2026-07-24 설계 D1·D5 — ref/specs/2026-07-24-crm-featured-quote-request-needs-design.md).
// 실행: bun run --env-file=.env.local src/scripts/backfill-featured-needs.ts
//
// ⚠️ 수기 유지 4필드(인도 방식·계약 포커스·고객/심사 특이사항)는 건드리지 않는다 — 파생 7필드만 덮는다.
// ⚠️ 이미 featured_request_id가 있는 고객은 건너뛴다(재실행 안전 · 상담사 star 선택 보존).
// ⚠️ 견적요청이 0건인 앱 연결 고객(상담신청으로만 연결)은 대표를 만들 수 없어 건너뛴다 —
//    그 고객은 파생 소스가 없으므로 수기 입력이 계속 열려 있어야 한다(설계 D2 read-only 조건).
// 실행 후 AI 프로필 청크가 바뀌므로 backfill-embeddings.ts를 이어서 돌린다.
import { asc, eq, isNotNull } from "drizzle-orm";

import { getDefaultDb } from "../db/client";
import { quoteRequests } from "../db/public-app";
import { applyFeaturedRequestNeeds } from "../db/queries/quote-requests";
import { customers } from "../db/schema";

async function main() {
  const db = getDefaultDb();
  const targets = await db
    .select({ id: customers.id, name: customers.name, appUserId: customers.appUserId, featuredRequestId: customers.featuredRequestId })
    .from(customers)
    // 대표가 이미 있는 고객도 포함한다 — 파생 규칙이 바뀌면(예: 2026-07-24 need_trim_id 추가)
    // 기존 행도 다시 적용해야 한다. applyFeaturedRequestNeeds는 멱등이라 재실행이 안전하다.
    // 대표가 있으면 그 대표를 그대로 쓰고(상담사 선택 보존), 없으면 최초 요청으로 정한다.
    .where(isNotNull(customers.appUserId));

  let applied = 0;
  for (const c of targets) {
    if (!c.appUserId) continue; // isNotNull 필터가 보장하지만 타입 좁히기용
    const [first] = await db
      .select({ id: quoteRequests.id, createdAt: quoteRequests.createdAt })
      .from(quoteRequests)
      .where(eq(quoteRequests.userId, c.appUserId))
      .orderBy(asc(quoteRequests.createdAt))
      .limit(1);
    const featured = c.featuredRequestId ?? first?.id ?? null;
    if (!featured) {
      console.log(`skip ${c.name} — 견적요청 0건(상담신청으로만 연결된 고객)`);
      continue;
    }
    await applyFeaturedRequestNeeds(c.id, featured, db);
    applied += 1;
    console.log(`ok   ${c.name} — 대표 ${featured}${c.featuredRequestId ? " (기존 유지)" : ` (최초 ${first?.createdAt})`}`);
  }
  console.log(`done: 대상 ${targets.length}명 중 ${applied}명 적용`);
  // DB 커넥션 풀이 열려 있어 명시 종료가 없으면 프로세스가 안 죽는다(backfill-embeddings.ts와 동일).
  process.exit(0);
}

void main();
