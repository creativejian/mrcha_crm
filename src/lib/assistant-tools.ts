// 업무 AI 도구(화이트리스트 리포트) — 순수 모듈: 키·라벨·결과 타입만.
// 실행기(쿼리)는 src/db/queries/assistant-tools.ts. 설계: ref/specs/2026-07-06-crm-work-ai-tool-calling-design.md.
//
// PR1 = 빠른 질문 버튼 결정론 경로(클라가 버튼 텍스트와 정확히 일치하는 질문에 tool 키 동봉 → 서버가
// 임베딩 검색 대신 해당 리포트 쿼리 결과를 근거로 생성). 자유 질문 모델 라우팅(function calling)은 PR2.
// ⚠️ 도구 정의 중 quote_ready·delivery_risk는 07-06 잠정(이사님 취침 중 임의 결정 — 사후 컨펌 대상,
// 스펙 "이사님 결정 필요" 참조). 정의 변경은 실행기 쿼리 교체만으로 가능(키·버튼 문구 불변).

export const ASSISTANT_TOOL_KEYS = ["today_actions", "chance_ranking", "stale_customers", "quote_ready", "delivery_risk"] as const;
export type AssistantToolKey = (typeof ASSISTANT_TOOL_KEYS)[number];

// 근거 표시(sources)와 프롬프트 블록 헤더에 쓰는 한글 라벨.
export const ASSISTANT_TOOL_LABELS: Record<AssistantToolKey, string> = {
  today_actions: "오늘 처리할 일",
  chance_ranking: "계약 가능성 순위",
  stale_customers: "응답 지연 고객",
  quote_ready: "오늘 견적 보낼 고객",
  delivery_risk: "출고/정산 리스크",
};

// 실행기 반환: 사람이 읽는 행 텍스트 목록 — Gemini에 근거 블록으로 실리고, 행 수는 sources 요약에 쓰인다.
export type AssistantToolResult = { label: string; lines: string[] };
