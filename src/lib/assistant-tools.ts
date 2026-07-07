// 업무 AI 도구(화이트리스트 리포트) — 순수 모듈: 키·라벨·결과 타입만.
// 실행기(쿼리)는 src/db/queries/assistant-tools.ts. 설계: ref/specs/2026-07-06-crm-work-ai-tool-calling-design.md.
//
// PR1 = 빠른 질문 버튼 결정론 경로(클라가 버튼 텍스트와 정확히 일치하는 질문에 tool 키 동봉 → 서버가
// 임베딩 검색 대신 해당 리포트 쿼리 결과를 근거로 생성). 자유 질문 모델 라우팅(function calling)은 PR2.
// 도구 정의는 07-06 이사님 컨펌 완료(①quote_ready 의도대로 ②delivery_risk: 계약완료="출고 준비·정산
// 준비" 개념 — 출고/정산 화면 구현 후 데이터 기반으로 교체 ③chance=상담사 수동 입력값). 스펙 참조.

export const ASSISTANT_TOOL_KEYS = ["today_actions", "chance_ranking", "stale_customers", "quote_ready", "delivery_risk", "search_customers", "current_user"] as const;
export type AssistantToolKey = (typeof ASSISTANT_TOOL_KEYS)[number];

// 근거 표시(sources)와 프롬프트 블록 헤더에 쓰는 한글 라벨.
export const ASSISTANT_TOOL_LABELS: Record<AssistantToolKey, string> = {
  today_actions: "오늘 처리할 일",
  chance_ranking: "계약 가능성 순위",
  stale_customers: "응답 지연 고객",
  quote_ready: "오늘 견적 보낼 고객",
  delivery_risk: "출고/정산 리스크",
  search_customers: "고객 검색",
  current_user: "내 정보",
};

// CRM 역할 한글 라벨 — /ask 프롬프트 사용자 컨텍스트·current_user 리포트가 공유. 어휘 = auth CRM_ROLES
// (키 집합은 파리티 테스트가 잠금 — Set이라 union 타입 파생 불가), 한글 값 = 클라 UI(data/roles.ts)와 일치.
export const CRM_ROLE_LABELS: Record<string, string> = {
  admin: "최고관리자",
  manager: "팀장",
  staff: "상담사",
  dealer: "딜러",
};

// 실행기 반환: 사람이 읽는 행 텍스트 목록 — Gemini에 근거 블록으로 실리고, 행 수는 sources 요약에 쓰인다.
export type AssistantToolResult = { label: string; lines: string[] };

// ── PR2: 자유 질문 모델 라우팅용 함수 선언(Gemini functionDeclarations) ────────────────────────────
// RAG 근거 0건(기존 NO_HITS 지점)에서만 라우팅 호출에 동봉된다 — 근거로 답할 수 있는 질문은 라우팅
// 자체가 없어(RAG 우선) 오라우팅이 구조적으로 불가능하다. description은 모델의 유일한 선택 근거 —
// 도구 의미가 바뀌면 여기도 갱신.
// Record<AssistantToolKey, …>로 선언(LABELS와 동일 패턴, 배치 C) — 새 도구를 KEYS에 추가하고 선언을
// 빠뜨리면(라우팅 영원 불가) 또는 name 오타(화이트리스트 무음 드롭)면 컴파일 에러로 잡힌다.
type ToolDeclarationDef = { description: string; parameters?: Record<string, unknown> };
const TOOL_DECLARATION_DEFS: Record<AssistantToolKey, ToolDeclarationDef> = {
  today_actions: { description: "오늘 처리해야 할 미완료 할일(기한 급함/오늘)과 오늘 일정 목록을 조회한다." },
  chance_ranking: { description: "계약 가능성(확정/높음/중간/보류/낮음 — 상담사가 수동 판단해 입력한 값)이 높은 순서로 고객 순위 목록을 조회한다." },
  stale_customers: { description: "최근 활동이 7일 이상 없는 응답 지연/방치 고객 목록을 조회한다." },
  quote_ready: { description: "견적을 보내야 할 고객(진행 상태가 견적 단계이거나 작성 중 견적 보유) 목록을 조회한다." },
  delivery_risk: { description: "계약완료 단계인데 최근 활동이 없어 출고/정산 확인이 필요한 고객 목록을 조회한다." },
  search_customers: {
    description: "조건으로 고객을 검색해 목록을 조회한다. 이름·진행 상태·구매방식·상담경로(유입 경로)·내 담당 여부 필터를 조합할 수 있다.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "고객 이름 부분 일치" },
        statusGroup: { type: "string", description: "진행 상태 1차: 신규/상담중/견적/차량체크/심사서류/관리중/상담완료/계약완료/불발" },
        purchaseMethod: { type: "string", description: "구매방식 부분 일치: 운용리스/장기렌트/할부/금융리스/일시불 등" },
        source: { type: "string", description: "상담경로(유입 경로) 부분 일치: 예 '앱'(앱 견적요청·앱 상담원 연결 포함), '유튜브', '카카오'" },
        mine: { type: "boolean", description: "'내/제 담당', '내가 계약한'처럼 1인칭으로 물으면 true — 현재 로그인 사용자가 담당자인 고객으로 좁힌다" },
      },
    },
  },
  current_user: { description: "현재 로그인한 사용자(나)가 누구인지 조회한다 — 이름·역할·담당 고객 수. '난 누구야?', '내 계정/역할 뭐야?' 류 질문." },
};
// 배열은 KEYS 순서로 파생 — 기존 리터럴 배열과 요청 payload byte-동일.
export const ASSISTANT_TOOL_DECLARATIONS = ASSISTANT_TOOL_KEYS.map((name) => ({ name, ...TOOL_DECLARATION_DEFS[name] }));
