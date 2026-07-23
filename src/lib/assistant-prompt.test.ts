import { test, expect } from "bun:test";

import { buildContextBlock, buildUserPrompt, formatContactAxis, NO_HITS_ANSWER, SYSTEM_PROMPT, TOOL_SYSTEM_PROMPT, withTodayContext, type PromptChunk } from "./assistant-prompt";

const chunks: PromptChunk[] = [
  { customerName: "김민준", content: "고객 김민준 상담메모: GLC 재고 문의", customerStatus: "견적·발송완료" },
  { customerName: "박서연", content: "고객 박서연 니즈메모: 보증금 조건별 견적", customerStatus: "상담중" },
];

test("buildContextBlock: 번호 매긴 근거 목록", () => {
  const block = buildContextBlock(chunks);
  expect(block).toContain("[1] (김민준 · 견적·발송완료) 고객 김민준 상담메모: GLC 재고 문의");
  expect(block).toContain("[2] (박서연 · 상담중) 고객 박서연 니즈메모: 보증금 조건별 견적");
});

// 연락처 축(2026-07-23 D1) — 코퍼스는 phone을 PII로 제외했고(assistant-corpus.ts) 앞으로도 제외한다.
// 대신 조회 시점 메타로 병기해 RAG 경로에서도 연락처 질문에 답이 나오게 한다(진행 상태와 같은 처지·같은 해법).
test("buildContextBlock: 연락처 축이 헤더에 실린다(주 번호 · 추가 연락처 라벨 구분)", () => {
  const block = buildContextBlock([
    { customerName: "제임스", customerStatus: "상담중", customerContact: formatContactAxis("01012345678", "01098765432"), content: "프로필: 거주지 서울특별시" },
  ]);
  // 표기는 화면(고객 목록·상세 formatPhone)과 같은 하이픈 포맷 — 같은 데이터가 경로마다 다르게 보이면 안 된다.
  expect(block).toBe("[1] (제임스 · 상담중 · 연락처 010-1234-5678 · 추가 연락처 010-9876-5432) 프로필: 거주지 서울특별시");
});

// 도구(리포트) 경로는 고객 축이 아니라 리포트 1청크라 연락처가 없다 — 축을 통째로 생략한다.
test("buildContextBlock: 연락처 축이 없으면 기존 헤더 그대로", () => {
  expect(buildContextBlock(chunks)).toContain("[1] (김민준 · 견적·발송완료) 고객 김민준");
});

// "미입력"을 명시하는 이유: 축을 아예 빼면 모델이 "근거에 연락처가 없다"(=실려오지 않음)와
// "고객에게 번호가 없다"(=미입력)를 구분하지 못해 실기에서 본 오답 문구가 그대로 남는다.
test("formatContactAxis: 주 번호 미입력도 명시한다", () => {
  expect(formatContactAxis(null, null)).toBe("연락처 미입력");
});

// 추가 연락처는 회사·배우자 번호일 수 있어 본인 번호로 뭉뚱그리면 안 된다(소유권 계약 #276 — 매칭 금지 축).
test("formatContactAxis: 추가 연락처만 있으면 라벨을 구분해 싣는다", () => {
  expect(formatContactAxis(null, "01098765432")).toBe("연락처 미입력 · 추가 연락처 010-9876-5432");
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

// 묻지 않은 연락처 억제(2026-07-23) — 근거·리포트에 연락처가 상시 실리게 된 뒤, 연락처를 묻지 않은
// 질문("마이바흐 관심 고객이 누구야?")의 답변 표면에 번호가 덧붙는 것이 실측됐다. **양 경로에 같은
// 지시**를 넣는다 — 한쪽만 넣으면 이 PR이 고친 "경로에 따라 답이 갈린다"가 다시 생긴다.
// ⚠️ LLM 행위라 이 잠금은 문구 존재만 보증한다. 실제 억제는 실기(전/후 대조)로만 확인 가능하다.
test("SYSTEM_PROMPT·TOOL_SYSTEM_PROMPT: 묻지 않은 연락처를 답에 쓰지 말라는 지시(양 경로 동일)", () => {
  for (const prompt of [SYSTEM_PROMPT, TOOL_SYSTEM_PROMPT]) {
    expect(prompt).toContain("연락처");
    expect(prompt).toContain("물었을 때만");
  }
});

// 표기 유지 지시(2026-07-23 prod 실기 후속) — 자료를 하이픈으로 줘도 모델이 가끔 digits로
// **정규화해 버린다**(prod 9회 중 1회 실측: `01095880812`). 자료 형식만으로는 부족해서
// 지시를 한 겹 더 얹는다. ⚠️ 이것도 보증이 아니다(LLM 행위) — 확률을 올릴 뿐이고,
// 확정적으로 만들려면 클라 후처리가 필요한데 그건 "AI 답변을 사후 변조"라 채택하지 않았다.
test("SYSTEM_PROMPT·TOOL_SYSTEM_PROMPT: 연락처 표기를 조회 결과 그대로 옮기라는 지시", () => {
  for (const prompt of [SYSTEM_PROMPT, TOOL_SYSTEM_PROMPT]) {
    expect(prompt).toContain("그대로 옮기");
  }
});

// SSOT 가드 — 보간을 리터럴로 되돌리면 라우트 직접 반환(hits 0건)과 모델 지시 문구가 다시 갈라진다.
test("SYSTEM_PROMPT: NO_HITS_ANSWER 문구를 그대로 포함(보간 SSOT)", () => {
  expect(SYSTEM_PROMPT).toContain(`'${NO_HITS_ANSWER}'`);
});

// 일정 청크(schedule) 도입 전제 — 근거의 절대 날짜를 과거/미래로 판단하려면 모델이 오늘을 알아야 한다.
test("withTodayContext: 원문 프롬프트 뒤에 오늘 날짜(KST·요일) 라인 추가", () => {
  // 2026-07-05T23:30Z = KST 2026-07-06(월) 08:30 — UTC 달력일이었다면 07-05로 밀린다.
  const p = withTodayContext(SYSTEM_PROMPT, new Date("2026-07-05T23:30:00Z"));
  expect(p.startsWith(SYSTEM_PROMPT)).toBe(true);
  expect(p).toContain("오늘은 2026-07-06(월)");
});
