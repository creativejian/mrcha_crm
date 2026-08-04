// 업무 AI 대화 일괄 파기 — 앱 출시 전 1회(회원탈퇴 계약 회신 §7 "출시 전 기존 메시지 일괄 정리").
//
// ⚠️ **되돌릴 수 없다.** 전 직원의 업무 AI 대화가 사라진다(백업하지 않는다 — 백업하면 파기가
// 아니다). 계약상 **실행 시점을 직원(송실장·유슨생)에게 사전 공지**하는 것이 조건이다.
//
//   bun run purge:assistant           # 조회만(규모·구간 표시) — 기본값
//   bun run purge:assistant -- --yes  # 실제 파기
//
// 상시 운영은 30일 rolling 크론(cron/assistant-retention-cron.ts)이 담당한다. 이 스크립트는
// "출시 전 과거분 청소" 1회용이라 package.json에만 두고 크론에는 붙이지 않는다.
import { getDefaultDb } from "../db/client";
import { purgeAllAssistantMessages } from "../db/queries/assistant-messages";
import { assistantMessages } from "../db/schema";
import { sql } from "drizzle-orm";

const db = getDefaultDb();
const confirmed = process.argv.includes("--yes");

const [stat] = await db
  .select({
    total: sql<number>`count(*)::int`,
    staff: sql<number>`count(distinct ${assistantMessages.staffUserId})::int`,
    oldest: sql<string | null>`min(${assistantMessages.createdAt})::date::text`,
    newest: sql<string | null>`max(${assistantMessages.createdAt})::date::text`,
  })
  .from(assistantMessages);

const total = stat?.total ?? 0;
if (total === 0) {
  console.log("[purge:assistant] 대상 0행 — 할 일 없음");
  process.exit(0);
}
console.log(`[purge:assistant] 대상 ${total}행 · 직원 ${stat?.staff ?? 0}명 · ${stat?.oldest} ~ ${stat?.newest}`);

if (!confirmed) {
  console.log("[purge:assistant] 조회만 했다(파기하려면 `--yes`). 실행 전 직원 사전 공지가 계약 조건이다.");
  process.exit(0);
}

const purged = await purgeAllAssistantMessages(db);
console.log(`[purge:assistant] ✅ ${purged}행 파기 완료 — ${new Date().toISOString()}`);
