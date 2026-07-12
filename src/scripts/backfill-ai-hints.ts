// 전 고객 AI 힌트 1회 소급 생성(스펙 2026-07-12 결정 2 — 목업 하드코딩 폐기의 데이터 채움).
// 훅(ai-hint-on-write) 도입 후에는 복구/보정 도구다 — 입력 hash skip으로 재실행 저비용.
// 실행: bun run --env-file=.env.local src/scripts/backfill-ai-hints.ts
import { asc } from "drizzle-orm";

import { getDefaultDb } from "../db/client";
import { customers } from "../db/schema";
import { runAiHintJob } from "../lib/ai-hint-on-write";
import { resolveGeminiTarget } from "../lib/gemini-target";

const db = getDefaultDb();
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY is not set (.env.local)");
const target = resolveGeminiTarget({ apiKey }); // 로컬 실행 — 항상 직결(한국 IP)

const rows = await db
  .select({ id: customers.id, code: customers.customerCode, name: customers.name })
  .from(customers)
  .orderBy(asc(customers.createdAt));

const counts: Record<string, number> = {};
for (const row of rows) {
  try {
    const outcome = await runAiHintJob(row.id, target, db);
    counts[outcome] = (counts[outcome] ?? 0) + 1;
    console.log(`${row.code} ${row.name}: ${outcome}`);
  } catch (e) {
    counts.failed = (counts.failed ?? 0) + 1;
    console.error(`${row.code} ${row.name}: 실패`, e); // fail-open — 다음 고객 계속
  }
}
console.log("합계:", counts);
process.exit(0);
