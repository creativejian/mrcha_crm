import { app } from "./app";

// Workers 엔트리(Pages functions/[[path]].ts의 대체) — wrangler.worker.jsonc의
// `run_worker_first: ["/api/*"]` 덕에 /api/* 만 여기로 오고, 나머지 경로는 Worker를 거치지
// 않고 assets(client/dist, SPA fallback)가 직접 서빙한다.
// 모듈 워커는 ExecutionContext를 fetch 3번째 인자로 자동 전달한다 — Pages 엔트리의 수동 전달
// 누락 → dbHold 인라인 대기 → SSE 데드락 함정(2026-07-03 prod 524)이 구조적으로 소멸.
export default app;
