// 고객 니즈 영역 공통 상수/타입 — 훅(useCustomerNeeds)과 컴포넌트(NeedsDashboard)가 공유.
export const KIM_NEEDS_COLOR_PLACEHOLDER = "외장 컬러 미정 · 내장 컬러 미정";

export type KimNeedsState = {
  model: string;
  trim: string;
  colors: string;
  method: string;
  memo: string;
};
