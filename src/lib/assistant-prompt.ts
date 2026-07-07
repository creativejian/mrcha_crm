import { kstDateLabel } from "./kst-date";

export type PromptChunk = { customerName: string; customerStatus: string; content: string };

// "근거 없음" 응답 문구 SSOT — 라우트의 직접 반환(hits 0건)과 SYSTEM_PROMPT의 모델 지시가 공유한다.
// 갈라지면 같은 상황의 답변이 경로(직접 반환 vs 모델 생성)별로 달라진다.
export const NO_HITS_ANSWER = "관련 CRM 데이터를 찾지 못했습니다.";

// 범위 밖 질문 안내 문구 SSOT — 근거 0건에서 도구 라우팅까지 "해당 없음"(도구 불필요)으로 판단된 질문
// (잡담·일반 지식, 예: "오늘 날씨?")에 라우트가 직접 반환한다. NO_HITS_ANSWER로 답하면 범위 밖 질문이
// 고장처럼 읽히는 UX(2026-07-07 실기 지적) 대응. 라우팅 실패(null)는 진짜 CRM 질문일 수 있어 범위 밖
// 단정 없이 기존 NO_HITS_ANSWER 유지 — 문구 선택은 라우트(/ask)가 라우터 판정으로 분기한다.
export const OUT_OF_SCOPE_ANSWER = "CRM 업무 질문에 답하는 어시스턴트입니다. 고객·견적·일정·서류 등 업무 관련 질문을 해 주세요.";

export const SYSTEM_PROMPT = [
  "당신은 자동차 CRM 상담사를 돕는 한국어 업무 어시스턴트입니다.",
  "아래에 제공된 근거(고객 메모·상담이력·니즈)만 사용해 답하세요. 근거에 없는 내용은 추측하지 마세요.",
  "답변은 간결한 한국어로, 관련 고객과 근거를 함께 제시하세요.",
  `관련 근거가 없으면 '${NO_HITS_ANSWER}'라고만 답하세요.`,
].join("\n");

// 도구(리포트) 답변 전용 — RAG SYSTEM_PROMPT의 NO_HITS 지시를 제거한다. 리포트 결과가 프롬프트에
// 실려 있는데도 모델이 보수적으로 "관련 CRM 데이터를 찾지 못했습니다"를 뱉는 실측 결함(2026-07-06
// PR2 e2e, 8건 조회에 NO_HITS 답변) 대응. 0건은 "조회 결과 없음" 블록을 그대로 정리하게 지시.
export const TOOL_SYSTEM_PROMPT = [
  "당신은 자동차 CRM 상담사를 돕는 한국어 업무 어시스턴트입니다.",
  "아래에 제공된 리포트 조회 결과를 사용해 질문에 답하세요. 결과에 없는 내용은 추측하지 마세요.",
  // "빠짐없이"는 실측 대응(2026-07-07): 계약완료 7건 조회에 모델이 5명만 나열 — 요약하며 항목을 떨어뜨림.
  "답변은 간결한 한국어로, 목록은 조회 결과의 항목을 빠짐없이 나열하세요.",
  "조회 결과가 '조회 결과 없음'이면 해당하는 고객/항목이 없다고 답하세요.",
].join("\n");

// 시스템 프롬프트에 오늘 날짜(KST·요일) 컨텍스트를 붙인다 — 일정 청크 등 절대 날짜가 박힌 근거의
// 과거/미래 판단 기준. 청크 쪽에 상대 라벨(예정/지남)을 박으면 다음 날 스테일이라, 날짜 비교는 생성
// 시점의 이 라인이 전담한다(assistant-corpus buildScheduleChunkText 주석과 짝).
// 마지막 문장은 실측 결함 대응(2026-07-06 e2e): 지난 일정 근거만 잡힌 "다음 일정" 질문에 모델이
// NO_HITS 고정 문구로 도망갔다(근거가 있으니 오답) — 없음을 명시하고 지난 일정을 언급하게 지시.
export function withTodayContext(prompt: string, now: Date = new Date()): string {
  return `${prompt}\n오늘은 ${kstDateLabel(now)}입니다. 근거의 날짜는 이 날짜 기준으로 과거/미래(예: 다음 일정)를 판단하세요. 다가올 일정을 묻는 질문에 미래 일정 근거가 없으면 예정된 일정이 없다고 답하고, 지난 일정 근거가 있으면 함께 언급하세요.`;
}

// 현재 로그인 사용자 컨텍스트 — 질문의 1인칭("나/내/제")을 해석할 기준(양 경로 공통, withTodayContext와
// 짝). 도구 쪽 대응물은 current_user 리포트·search_customers의 mine 필터 — 프롬프트 주입만으로는 근거
// 0건 고정 답변 경로(생성 미호출)를 못 바꾸므로 이 라인은 생성이 도는 경우의 맥락 보강이 역할이다.
export function withCurrentUserContext(prompt: string, userLabel: string): string {
  return `${prompt}\n현재 로그인 사용자는 ${userLabel}입니다. 질문의 '나/내/제'는 이 사용자를 뜻합니다.`;
}

// 검색된 청크를 번호 매긴 근거 블록으로.
export function buildContextBlock(chunks: PromptChunk[]): string {
  return chunks
    .map((c, i) => `[${i + 1}] (${c.customerName} · ${c.customerStatus}) ${c.content}`)
    .join("\n");
}

// 최종 사용자 프롬프트(근거 + 질문).
export function buildUserPrompt(question: string, contextBlock: string): string {
  return `# 근거\n${contextBlock || "(관련 근거 없음)"}\n\n# 질문\n${question}`;
}
