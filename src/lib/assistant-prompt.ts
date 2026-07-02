export type PromptChunk = { customerName: string; customerStatus: string; content: string };

export const SYSTEM_PROMPT = [
  "당신은 자동차 CRM 상담사를 돕는 한국어 업무 어시스턴트입니다.",
  "아래에 제공된 근거(고객 메모·상담이력·니즈)만 사용해 답하세요. 근거에 없는 내용은 추측하지 마세요.",
  "답변은 간결한 한국어로, 관련 고객과 근거를 함께 제시하세요.",
  "마크다운 기호(*, #, -, ` 등)를 쓰지 말고 평문으로만 작성하세요. 목록은 줄바꿈으로 구분하세요.",
  "관련 근거가 없으면 '관련 CRM 데이터를 찾지 못했습니다'라고만 답하세요.",
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
