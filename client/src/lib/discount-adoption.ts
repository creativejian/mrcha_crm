// 딜러 제안 1건 × 할인 필드 1개의 상태. **컬럼을 두지 않고 조회 시 파생**한다(spec §4).
// 금액 대조를 쓰는 이유: 제안 행 updated_at 비교는 딜러가 **다른 필드만** 고쳐도 시각이 움직여
// 오탐이 난다. 필드 단위 금액 비교가 정확하다.
//
// 서버(src/)도 이 모듈을 import한다 — 부작용 0 순수 함수라 서버→클라 순수 모듈 import 경계에
// 허용된다(AGENTS.md · quote-write-access.ts 선례).
export type ProposalState = "adopted" | "changed" | "none";

// 할인 3필드 어휘 SSOT — 서버 쿼리·라우트 zod enum·클라 팝오버가 같은 값을 봐야 한다
// (catalog.trims 컬럼명 매핑은 각자 자기 층에 둔다 — SQL 컬럼명은 클라의 관심사가 아니다).
// crm.catalog_discount_adoptions의 CHECK도 같은 3값이다(schema.ts).
export const DISCOUNT_FIELDS = ["financial", "partner", "cash"] as const;
export type DiscountField = (typeof DISCOUNT_FIELDS)[number];

// 화면 표기 — 관리자 트림 표 헤더(자사할인·제휴할인·타사할인)와 같은 어휘를 쓴다.
export const DISCOUNT_FIELD_LABELS: Record<DiscountField, string> = {
  financial: "자사할인",
  partner: "제휴할인",
  cash: "타사할인",
};

// 셀 안 병기용 짧은 라벨 — 헤더는 "자사할인"이지만 할인 셀은 폭이 좁아 접두만 쓴다.
// 확정 할인이 없어 `—`만 뜨는 셀에서 "이 배지가 어느 할인 건지" 알려주는 용도다
// (2026-07-31 유슨생: 빈 셀 셋이 나란하면 자사·제휴·타사를 구분할 수 없다).
export const DISCOUNT_FIELD_SHORT: Record<DiscountField, string> = {
  financial: "자사",
  partner: "제휴",
  cash: "타사",
};

export function proposalState(input: {
  proposalAmount: number | null;
  adoptedAmount: number | null;
  adoptedFromThisDealer: boolean;
}): ProposalState {
  // 출처가 이 딜러가 아니면 금액이 우연히 같아도 "채택됨"이 아니다 — 그렇게 보이면 채택 버튼이
  // 사라져 이사님이 이 딜러 값으로 재채택할 수 없다.
  if (!input.adoptedFromThisDealer) return "none";
  return input.proposalAmount === input.adoptedAmount ? "adopted" : "changed";
}
