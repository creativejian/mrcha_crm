import { test, expect } from "bun:test";

import { buildContextBlock, buildUserPrompt, NO_HITS_ANSWER, SYSTEM_PROMPT, type PromptChunk } from "./assistant-prompt";

const chunks: PromptChunk[] = [
  { customerName: "김민준", content: "고객 김민준 상담메모: GLC 재고 문의", customerStatus: "견적·발송완료" },
  { customerName: "박서연", content: "고객 박서연 니즈메모: 보증금 조건별 견적", customerStatus: "상담중" },
];

test("buildContextBlock: 번호 매긴 근거 목록", () => {
  const block = buildContextBlock(chunks);
  expect(block).toContain("[1] (김민준 · 견적·발송완료) 고객 김민준 상담메모: GLC 재고 문의");
  expect(block).toContain("[2] (박서연 · 상담중) 고객 박서연 니즈메모: 보증금 조건별 견적");
});

test("buildUserPrompt: 질문 + 근거 블록 포함", () => {
  const p = buildUserPrompt("계약 가능성 높은 고객은?", buildContextBlock(chunks));
  expect(p).toContain("계약 가능성 높은 고객은?");
  expect(p).toContain("[1]");
});

test("SYSTEM_PROMPT: 근거 기반·모르면 모른다 지침 포함", () => {
  expect(SYSTEM_PROMPT).toContain("근거");
  expect(SYSTEM_PROMPT).toContain("찾지 못");
  expect(SYSTEM_PROMPT).not.toContain("마크다운 기호"); // 평문 강제 제거됨(마크다운 렌더 도입)
});

// SSOT 가드 — 보간을 리터럴로 되돌리면 라우트 직접 반환(hits 0건)과 모델 지시 문구가 다시 갈라진다.
test("SYSTEM_PROMPT: NO_HITS_ANSWER 문구를 그대로 포함(보간 SSOT)", () => {
  expect(SYSTEM_PROMPT).toContain(`'${NO_HITS_ANSWER}'`);
});
