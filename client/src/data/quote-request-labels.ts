// 앱 견적요청(public.quote_requests) 코드값 → 한글 라벨 — 클라·서버 공용 SSOT(순수 데이터).
// Flutter 앱 SSOT(purchase_method.dart / deposit_type.dart)와 어휘 일치.
// 서버 → client/src/data import는 확립 경계(lookup-validate·schema·assistant-corpus 선례) — 0706 배치 E에서
// 서버 복제본(구 src/lib/quote-request-labels.ts)을 이 파일로 수렴해 물리 2벌을 해소했다.
// 소비: 클라 견적요청 카드 라벨(lib/quote-requests) · 서버 승격 니즈 시드(db/queries/quote-requests) ·
// 업무 AI 요청 청크(lib/assistant-corpus — 라벨 변경 = 청크 content 변경이라 백필 재실행 소급 필요).

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
