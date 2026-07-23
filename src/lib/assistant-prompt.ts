import { kstDateLabel } from "./kst-date";

// customerContact = 헤더에 병기할 연락처 축(옵션 — 도구 경로는 고객이 아니라 리포트 1청크라 없다).
// 값은 formatContactAxis가 조립한다(라벨 어휘 SSOT).
export type PromptChunk = { customerName: string; customerStatus: string; content: string; customerContact?: string };

// 근거 헤더의 연락처 축 문자열. 도구 경로(assistant-tools.ts searchCustomers, `#332`)와 **같은 어휘**를
// 쓴다 — 같은 질문이 경로에 따라 다른 표현으로 답하면 사용자가 다른 데이터로 읽는다.
// ⚠️ 주 번호가 null이어도 축을 지우지 않고 "미입력"으로 남긴다 — 근거에 안 실린 것과 고객에게 번호가
// 없는 것을 모델이 구분할 수 있어야 한다(그러지 않으면 실기에서 본 "근거에 연락처 정보가 없습니다"가
// 미입력 고객에게도 그대로 나가 사용자는 버그인지 사실인지 알 수 없다).
export function formatContactAxis(phone: string | null, phoneSecondary: string | null): string {
  return `연락처 ${phone ?? "미입력"}${phoneSecondary ? ` · 추가 연락처 ${phoneSecondary}` : ""}`;
}

// "근거 없음" 응답 문구 SSOT — 라우트의 직접 반환(hits 0건)과 SYSTEM_PROMPT의 모델 지시가 공유한다.
// 갈라지면 같은 상황의 답변이 경로(직접 반환 vs 모델 생성)별로 달라진다.
export const NO_HITS_ANSWER = "관련 CRM 데이터를 찾지 못했습니다.";

// 범위 밖 질문 안내 문구 SSOT — 근거 0건에서 도구 라우팅까지 "해당 없음"(도구 불필요)으로 판단된 질문에
// 라우트가 직접 반환한다. NO_HITS_ANSWER로 답하면 범위 밖 질문이 고장처럼 읽히는 UX(2026-07-07 실기 지적)
// 대응. 라우팅 실패(null)는 진짜 CRM 질문일 수 있어 범위 밖 단정 없이 기존 NO_HITS_ANSWER 유지 —
// 문구 선택은 라우트(/ask)가 라우터 판정으로 분기한다.
// ⚠️ **`none`의 부류가 넓어졌다**(배치 14 K2-c): 도입 시 대상은 "잡담·일반 지식"(예: "오늘 날씨?")뿐이었는데,
// `#315`가 라우터 프롬프트에 "지원 필터로 표현할 수 없는 조건이면 호출하지 말 것"을 넣으면서 **정당한 CRM
// 질문**(예: "마이바흐 관심 고객이 누구야?" — 관심 차종은 검색 필터에 없다)도 `none`으로 온다. 그런 질문은
// 근거(hits)가 받쳐줘야만 제대로 답이 나가고, 근거가 임계값 아래로 떨어지면 이 문구가 대신 나간다.
// 즉 이 상수의 적정성은 SIMILARITY_THRESHOLD와 묶여 있다 — 원칙("진짜 CRM 질문일 수 있으면 범위 밖 단정
// 금지")은 유효하나 `none` 경로에서는 그 원칙이 자동으로 지켜지지 않는다.
export const OUT_OF_SCOPE_ANSWER = "CRM 업무 질문에 답하는 어시스턴트입니다. 고객·견적·일정·서류 등 업무 관련 질문을 해 주세요.";

// 묻지 않은 연락처 억제(2026-07-23) — 연락처가 근거 헤더(메타 병기)와 고객 검색 리포트(`#332`)에
// **상시** 실리게 되면서, 연락처를 묻지 않은 질문의 답변 표면에 번호가 덧붙는 것이 실측됐다
// (`"마이바흐 관심 고객이 누구야?"` → `"관련 고객: 김민준 (연락처: 010…)"`).
// **양 경로(RAG·도구)가 같은 문장을 공유한다** — 한쪽만 넣으면 같은 질문이 경로에 따라 다르게 답하는
// 상태로 되돌아간다(그게 이 슬라이스가 고친 결함 자체다).
// ⚠️ 근거에서 연락처를 빼는 게 아니다 — 물으면 답해야 하므로 **실어두되 쓰지 말라**는 지시다.
export const CONTACT_DISCLOSURE_RULE =
  "연락처(전화번호)는 질문이 연락처를 물었을 때만 답에 포함하세요 — 근거나 조회 결과에 함께 실려 있어도 다른 질문의 답에는 쓰지 마세요.";

export const SYSTEM_PROMPT = [
  "당신은 자동차 CRM 상담사를 돕는 한국어 업무 어시스턴트입니다.",
  "아래에 제공된 근거(고객 메모·상담이력·니즈)만 사용해 답하세요. 근거에 없는 내용은 추측하지 마세요.",
  "답변은 간결한 한국어로, 관련 고객과 근거를 함께 제시하세요.",
  CONTACT_DISCLOSURE_RULE,
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
  // "빠짐없이"와 충돌하지 않는다 — 나열 대상은 **항목(고객)**이고, 이 줄이 제한하는 것은 각 항목에
  // 딸린 **연락처 필드**다. 연락처를 물은 질문에서는 그대로 답한다(실기 12/12로 확인).
  CONTACT_DISCLOSURE_RULE,
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
// 헤더 축은 있는 것만 이어 붙인다 — 연락처는 옵션이고, customerStatus도 메타 조회 실패 시 ""가 될 수 있다.
// ⚠️ 한 고객이 여러 청크(프로필·상담이력·견적…)를 가지면 연락처가 청크 수만큼 반복된다. 의도한 것이다 —
// 이름 기준으로 중복을 제거하면 동명이인의 두 번째 고객 번호가 통째로 빠지고(청크에 customerId가 없다),
// 프롬프트에 이미 실린 이상 반복 횟수가 노출 여부를 바꾸지도 않는다(추가 비용은 청크당 ~20자).
export function buildContextBlock(chunks: PromptChunk[]): string {
  return chunks
    .map((c, i) => `[${i + 1}] (${[c.customerName, c.customerStatus, c.customerContact].filter(Boolean).join(" · ")}) ${c.content}`)
    .join("\n");
}

// 최종 사용자 프롬프트(근거 + 질문).
export function buildUserPrompt(question: string, contextBlock: string): string {
  return `# 근거\n${contextBlock || "(관련 근거 없음)"}\n\n# 질문\n${question}`;
}
