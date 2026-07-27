// 딜러 제안 1건 × 할인 필드 1개의 상태. **컬럼을 두지 않고 조회 시 파생**한다(spec §4).
// 금액 대조를 쓰는 이유: 제안 행 updated_at 비교는 딜러가 **다른 필드만** 고쳐도 시각이 움직여
// 오탐이 난다. 필드 단위 금액 비교가 정확하다.
//
// 서버(src/)도 이 모듈을 import한다 — 부작용 0 순수 함수라 서버→클라 순수 모듈 import 경계에
// 허용된다(AGENTS.md · quote-write-access.ts 선례).
export type ProposalState = "adopted" | "changed" | "none";

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
