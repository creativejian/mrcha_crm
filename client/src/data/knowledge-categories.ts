// 지식베이스 카테고리 SSOT — 앱 lib/core/constants/knowledge_categories.dart 복제(KB v1 1~12장).
// DB(knowledge_articles.category)는 영문 slug, 화면 표시만 한글 라벨. 앱과 항상 동일해야 한다.

export const KNOWLEDGE_BLOCK_TO_SLUG: Record<number, string> = {
  1: "identity-role",
  2: "purchase-structure",
  3: "lump-sum",
  4: "installment",
  5: "lease",
  6: "long-term-rental",
  7: "purchase-selection",
  8: "quote-comparison",
  9: "financial-review",
  10: "purchase-process",
  11: "dealer-service",
  12: "purchase-risk",
};

const KNOWLEDGE_SLUG_TO_LABEL: Record<string, string> = {
  "identity-role": "차선생의 정체성과 역할 기준",
  "purchase-structure": "신차 구매 구조의 기본 이해",
  "lump-sum": "일시불 구매",
  installment: "할부 구매",
  lease: "리스",
  "long-term-rental": "장기렌트",
  "purchase-selection": "구매방식 선택 기준",
  "quote-comparison": "견적서 해석과 비교 검증",
  "financial-review": "금융 심사와 승인 전략",
  "purchase-process": "계약부터 출고까지의 진행 과정",
  "dealer-service": "출고 서비스와 딜러 서비스 판단 기준",
  "purchase-risk": "자동차 구매 피해와 리스크 방어",
};

// 미등록 slug(향후 새 카테고리)는 slug 그대로 노출 — 앱 label() 동작 미러.
export function knowledgeCategoryLabel(slug: string): string {
  return KNOWLEDGE_SLUG_TO_LABEL[slug] ?? slug;
}
