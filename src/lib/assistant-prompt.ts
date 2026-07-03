export type PromptChunk = { customerName: string; customerStatus: string; content: string };

// "근거 없음" 응답 문구 SSOT — 라우트의 직접 반환(hits 0건)과 SYSTEM_PROMPT의 모델 지시가 공유한다.
// 갈라지면 같은 상황의 답변이 경로(직접 반환 vs 모델 생성)별로 달라진다.
export const NO_HITS_ANSWER = "관련 CRM 데이터를 찾지 못했습니다.";

export const SYSTEM_PROMPT = [
  "당신은 자동차 CRM 상담사를 돕는 한국어 업무 어시스턴트입니다.",
  "아래에 제공된 근거(고객 메모·상담이력·니즈)만 사용해 답하세요. 근거에 없는 내용은 추측하지 마세요.",
  "답변은 간결한 한국어로, 관련 고객과 근거를 함께 제시하세요.",
  `관련 근거가 없으면 '${NO_HITS_ANSWER}'라고만 답하세요.`,
].join("\n");

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
