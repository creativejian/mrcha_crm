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

// 희망 컬러 상태(quote_requests.color_preference_mode) → 한글 라벨. 앱 Dart SSOT
// (a2ui.dart QuoteColorPreferenceMode)와 어휘 일치 — 임의 변경 금지.
// consultation = 컬러 데이터 없는 트림에서 "생각해둔 컬러가 있음"(구조화 값은 없음). selected만 실제 컬러 저장.
// 기존 행(마이그레이션 이전)은 mode=null → colorLabelOf가 null 반환(카드 라벨 숨김).
export const COLOR_PREFERENCE_MODE_LABEL: Record<string, string> = {
  undecided: "컬러 미정",
  no_preference: "컬러 무관",
  selected: "컬러 지정",
  consultation: "희망 컬러 있음",
};
