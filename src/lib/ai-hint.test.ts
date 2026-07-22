import { test, expect } from "bun:test";
import { createHash } from "node:crypto";

import { aiHintSourceHash, buildAiHintMaterial, sanitizeAiHint, type AiHintMaterialInput } from "./ai-hint";
import { embeddingContentHash } from "./assistant-corpus";

const BASE: AiHintMaterialInput = {
  name: "김민준",
  statusGroup: "견적", status: "발송완료", chance: "높음", priority: "긴급",
  profileText: "거주지 인천광역시 남동구 · 직군 개인·4대보험 · 관심 차종 Maybach S-Class",
  memos: [{ body: "GLC 재고 확인 후 재견적" }],
  tasks: [{ category: "급함", due: "오늘", body: "X3 조건 비교" }],
  quote: { modelName: "S-Class", trimName: "S 500 4M Long", appStatus: "sent" },
  consultationNote: "중도해지 위약금이 궁금합니다",
};

test("buildAiHintMaterial: 전 재료 조립 — 섹션 라벨·발송 라벨·상담 문의 포함", () => {
  const m = buildAiHintMaterial(BASE);
  expect(m).toContain("고객 김민준");
  expect(m).toContain("진행 견적·발송완료");
  expect(m).toContain("계약 가능성 높음");
  expect(m).toContain("우선순위 긴급");
  expect(m).toContain("프로필: 거주지 인천광역시 남동구");
  expect(m).toContain("최근 메모:\n- GLC 재고 확인 후 재견적");
  expect(m).toContain("미완료 할 일:\n- 급함 · 오늘 · X3 조건 비교");
  expect(m).toContain("최신 견적: S-Class S 500 4M Long — 발송완료");
  expect(m).toContain("앱 상담 문의: 중도해지 위약금이 궁금합니다");
});

test("buildAiHintMaterial: 재료 전무(이름·상태만) → null", () => {
  expect(buildAiHintMaterial({
    ...BASE, profileText: "", memos: [], tasks: [], quote: null, consultationNote: null,
  })).toBeNull();
});

test("buildAiHintMaterial: 미발송 견적은 '작성 중', 진행/가능성 없으면 상태 라인 생략", () => {
  const m = buildAiHintMaterial({
    ...BASE, statusGroup: null, status: null, chance: null, priority: null,
    memos: [], tasks: [], consultationNote: null,
    quote: { modelName: "쏘렌토", trimName: null, appStatus: "draft" },
  });
  expect(m).toContain("최신 견적: 쏘렌토 — 작성 중");
  expect(m).not.toContain("진행 ");
  expect(m).not.toContain("우선순위");
});

test("buildAiHintMaterial: 200자 초과 재료는 클립(… 접미)", () => {
  const long = "가".repeat(300);
  const m = buildAiHintMaterial({ ...BASE, memos: [{ body: long }] });
  expect(m).toContain(`- ${"가".repeat(200)}…`);
  expect(m).not.toContain("가".repeat(201));
});

test("sanitizeAiHint: 다줄 출력 → 첫 비공백 줄만, 리스트 마커·앞뒤 따옴표 제거·공백 정규화", () => {
  expect(sanitizeAiHint('\n- "**X3 · GLC** 비교  중"\n부연 설명')).toBe("**X3 · GLC** 비교 중");
});

test("sanitizeAiHint: ** 짝이 안 맞으면 굵게 서식 전체 제거", () => {
  expect(sanitizeAiHint("**깨진 마크다운 문장")).toBe("깨진 마크다운 문장");
});

test("sanitizeAiHint: 빈/공백 출력 → 빈 문자열", () => {
  expect(sanitizeAiHint("  \n  ")).toBe("");
});

// 해시 네임스페이스 분리(배치 14 K1-a) — 이 해시는 `customers.ai_summary_source_hash`의 캐시 키이고
// 임베딩 벡터 공간과 아무 관계가 없다. 임베딩용 해시(모델명 salt 포함)를 재사용하면 **모델 상수를
// 교체하는 것만으로 전 고객 힌트가 무효화돼** 재생성 폭발 + 문구 무음 churn이 난다(#312에서 실제로
// 발생 — 실측 22/22가 구 스킴 해시를 들고 있었다). 두 도메인은 영원히 분리한다.
test("aiHintSourceHash: 재료만 해싱한다(임베딩 모델과 무결합)", () => {
  const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
  expect(aiHintSourceHash("m")).toBe(sha256("m"));
  expect(aiHintSourceHash("m")).not.toBe(embeddingContentHash("m")); // 임베딩 해시를 다시 끌어다 쓰면 RED
});
