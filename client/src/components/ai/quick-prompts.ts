// 빠른 질문 = 집계·조건형 질의라 RAG(임베딩 검색)로 원리적 불가 — 텍스트가 그대로 전송되면 서버가
// 도구 키(화이트리스트 리포트 쿼리)로 결정론 라우팅한다. 문구는 이사님 소유(수정 시 매핑 유지),
// 키 어휘는 서버 ASSISTANT_TOOL_KEYS와 파리티 테스트(quick-prompt-tools.test.ts)가 잠근다.
// (컴포넌트 파일 밖 분리 = react-refresh/only-export-components 준수)
export const QUICK_AI_PROMPTS = [
  { text: "오늘 내가 먼저 처리할 일 정리해줘", tool: "today_actions" },
  { text: "계약 가능성 높은 고객 순위 뽑아줘", tool: "chance_ranking" },
  { text: "응답 지연 고객 알려줘", tool: "stale_customers" },
  { text: "오늘 견적 보낼 고객 정리해줘", tool: "quote_ready" },
  { text: "출고/정산 리스크 찾아줘", tool: "delivery_risk" },
] as const;
