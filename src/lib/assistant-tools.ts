// 업무 AI 도구(화이트리스트 리포트) — 순수 모듈: 키·라벨·결과 타입만.
// 실행기(쿼리)는 src/db/queries/assistant-tools.ts. 설계: ref/specs/2026-07-06-crm-work-ai-tool-calling-design.md.
//
// PR1 = 빠른 질문 버튼 결정론 경로(클라가 버튼 텍스트와 정확히 일치하는 질문에 tool 키 동봉 → 서버가
// 임베딩 검색 대신 해당 리포트 쿼리 결과를 근거로 생성). 자유 질문 모델 라우팅(function calling)은 PR2.
// ⚠️ 도구 정의 중 quote_ready·delivery_risk는 07-06 잠정(이사님 취침 중 임의 결정 — 사후 컨펌 대상,
// 스펙 "이사님 결정 필요" 참조). 정의 변경은 실행기 쿼리 교체만으로 가능(키·버튼 문구 불변).

export const ASSISTANT_TOOL_KEYS = ["today_actions", "chance_ranking", "stale_customers", "quote_ready", "delivery_risk", "search_customers"] as const;
export type AssistantToolKey = (typeof ASSISTANT_TOOL_KEYS)[number];

// 근거 표시(sources)와 프롬프트 블록 헤더에 쓰는 한글 라벨.
export const ASSISTANT_TOOL_LABELS: Record<AssistantToolKey, string> = {
  today_actions: "오늘 처리할 일",
  chance_ranking: "계약 가능성 순위",
  stale_customers: "응답 지연 고객",
  quote_ready: "오늘 견적 보낼 고객",
  delivery_risk: "출고/정산 리스크",
  search_customers: "고객 검색",
};

// 실행기 반환: 사람이 읽는 행 텍스트 목록 — Gemini에 근거 블록으로 실리고, 행 수는 sources 요약에 쓰인다.
export type AssistantToolResult = { label: string; lines: string[] };

// ── PR2: 자유 질문 모델 라우팅용 함수 선언(Gemini functionDeclarations) ────────────────────────────
// RAG 근거 0건(기존 NO_HITS 지점)에서만 라우팅 호출에 동봉된다 — 근거로 답할 수 있는 질문은 라우팅
// 자체가 없어(RAG 우선) 오라우팅이 구조적으로 불가능하다. description은 모델의 유일한 선택 근거 —
// 도구 의미가 바뀌면 여기도 갱신.
export const ASSISTANT_TOOL_DECLARATIONS = [
  { name: "today_actions", description: "오늘 처리해야 할 미완료 할일(기한 급함/오늘)과 오늘 일정 목록을 조회한다." },
  { name: "chance_ranking", description: "계약 가능성(확정/높음/중간/보류/낮음)이 높은 순서로 고객 순위 목록을 조회한다." },
  { name: "stale_customers", description: "최근 활동이 7일 이상 없는 응답 지연/방치 고객 목록을 조회한다." },
  { name: "quote_ready", description: "견적을 보내야 할 고객(진행 상태가 견적 단계이거나 작성 중 견적 보유) 목록을 조회한다." },
  { name: "delivery_risk", description: "계약완료 단계인데 최근 활동이 없어 출고/정산 확인이 필요한 고객 목록을 조회한다." },
  {
    name: "search_customers",
    description: "조건으로 고객을 검색해 목록을 조회한다. 이름·진행 상태·구매방식·상담경로(유입 경로) 필터를 조합할 수 있다.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "고객 이름 부분 일치" },
        statusGroup: { type: "string", description: "진행 상태 1차: 신규/상담중/견적/차량체크/심사서류/관리중/상담완료/계약완료/불발" },
        purchaseMethod: { type: "string", description: "구매방식 부분 일치: 운용리스/장기렌트/할부/금융리스/일시불 등" },
        source: { type: "string", description: "상담경로(유입 경로) 부분 일치: 예 '앱'(앱 견적요청·앱 상담원 연결 포함), '유튜브', '카카오'" },
      },
    },
  },
] as const;
