// 업무 AI 히스토리 페이지 크기 — 서버 GET /api/assistant/messages의 DISPLAY_LIMIT(src/routes/assistant.ts)와
// 반드시 일치. 클라는 `rows.length === AI_HISTORY_PAGE`로 hasMore를 판정하므로, 서버 LIMIT만 바뀌면
// 이전 대화 페이지네이션이 에러 없이 조용히 죽는다(서버 테스트의 파리티 케이스가 드리프트를 잡는다).
// 주의: 서버 bun 테스트가 이 모듈을 직접 import한다 — 의존성 없는 모듈로 유지할 것(supabase env 등 부작용 금지).
export const AI_HISTORY_PAGE = 30;
