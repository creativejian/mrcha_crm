// 앱 견적요청(public.quote_requests) 코드값 → 한글 라벨 — 서버 SSOT.
// 클라 quote-requests.ts의 PAYMENT_METHOD_LABEL/DEPOSIT_TYPE_LABEL과 어휘 동일(물리 공유는
// 클라↔서버 라벨 헬퍼 공유 팀 합의 보류 항목 — 값만 맞춘다). 소비: 견적요청 승격 니즈 시드
// (queries/quote-requests)·업무 AI 요청 청크(assistant-corpus).

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  lease: "운용리스",
  rent: "장기렌트",
  installment: "할부",
  cash: "일시불",
};

export const DEPOSIT_TYPE_LABEL: Record<string, string> = {
  deposit: "보증금",
  advance: "선수금",
  prepayment: "선납금",
};
