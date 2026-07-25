// 고객 니즈 영역 공통 상수/타입 — 훅(useCustomerNeeds)과 컴포넌트(NeedsDashboard)가 공유.
export const NEEDS_COLOR_PLACEHOLDER = "외장 컬러 미정 · 내장 컬러 미정";

// 관심 차량이 비었을 때 카드 제목 자리에 넣는 안내. 값이 아니라 **표시 전용**이라 저장되지 않는다
// (색상 플레이스홀더와 달리 needs 상태 초기값으로 쓰지 않는다 — 그러면 빈 값이 이 문자열로 저장된다).
// 카드 전체가 편집 버튼이라 "눌러서 입력하라"는 신호를 겸한다. 상담신청만으로 승격된 고객은 니즈
// 5필드가 전부 비어 있어(2026-07-25 CU-2607-0002) 이 안내가 없으면 카드가 고장난 것처럼 보였다.
export const NEEDS_MODEL_PLACEHOLDER = "관심 차량 미입력";

export type NeedsState = {
  model: string;
  trim: string;
  colors: string;
  method: string;
  memo: string;
};
