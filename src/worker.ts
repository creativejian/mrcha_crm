import { app } from "./app";
import { runAccountDeletionCron, type DeletionCronEnv } from "./cron/account-deletion-cron";
import { runAssistantRetentionCron } from "./cron/assistant-retention-cron";

// Workers 엔트리(Pages functions/[[path]].ts의 대체) — wrangler.worker.jsonc의
// `run_worker_first: ["/api/*"]` 덕에 /api/* 만 여기로 오고, 나머지 경로는 Worker를 거치지
// 않고 assets(client/dist, SPA fallback)가 직접 서빙한다.
// 모듈 워커는 ExecutionContext를 fetch 3번째 인자로 자동 전달한다 — Pages 엔트리의 수동 전달
// 누락 → dbHold 인라인 대기 → SSE 데드락 함정(2026-07-03 prod 524)이 구조적으로 소멸.
//
// scheduled(2026-08-01): 탈퇴 잡 일일 크론(wrangler.jsonc triggers.crons — D+3 재촉·D+5 자동 실행).
// `export default app`(Hono 객체)에서 명시 핸들러 객체로 전환 — fetch 동작은 동일(app.fetch는
// Hono가 바인딩한 프로퍼티라 참조 전달 안전).
// 2026-08-04: 업무 AI 30일 rolling 파기가 같은 트리거에 합류. **waitUntil을 따로 건다** —
// 한 잡의 실패·지연이 다른 잡을 막지 않게(개인정보 파기가 탈퇴 재촉 실패에 끌려가면 안 된다).
export default {
  fetch: app.fetch,
  scheduled: (_event: unknown, env: DeletionCronEnv, ctx: { waitUntil: (p: Promise<unknown>) => void }) => {
    ctx.waitUntil(runAccountDeletionCron(env));
    ctx.waitUntil(runAssistantRetentionCron(env));
  },
};
