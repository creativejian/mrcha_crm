// 앱카드 라벨 순수 헬퍼 — 클라 미리보기 조립기(app-card.ts)와 서버 발송 조립기(src/lib/app-card-payload.ts)가
// 물리 공유하는 1벌(2026-07-07 — 구 서버 "클라 재현 복제" ~150줄 해소, 파리티는 조립기 출력 테스트가 계속 잠금).
//
// ⚠️ 부작용 0 유지 계약: 이 파일은 순수 모듈만 import할 수 있다(http/supabase/React 체인 금지) —
// 서버(src/)가 import하는 클라 모듈이기 때문(경계 규칙은 AGENTS.md). formatActivity(customers.ts →
// http 체인)류가 필요한 라벨은 여기 두지 말고 각 조립기 로컬에 둔다(stampLabelOf가 그 예 — 타임존
// semantics도 클라(브라우저 로컬)/서버(KST 고정) 상이).
//
// ⚠️ 여기 값/포맷 변경 = 발송 payload·CRM 미리보기·업무 AI 견적 청크(assistant-corpus) content가 함께
// 바뀐다 — 청크가 바뀌면 백필 재실행 소급 필수(hash 불일치).

import { formatMoney } from "./quote-pricing";

// 계산엔진 미연결 필드는 가짜 숫자 대신 정직한 안내 텍스트로 표시한다.
export const CALC_PENDING = "계산 후 안내";
export const NO_SOURCE = "—";

const TAX_MODE_LABELS: Record<string, string> = {
  normal: "일반", hybrid: "하이브리드 감면", electric: "전기차 감면", manual: "직접 입력",
};

// 취득세 모드 라벨 — 미지/null 모드는 normal 폴백(서버는 DB 원시 문자열, 클라는 union 타입이라 항상 유효).
export function acquisitionTaxModeLabelOf(mode: string | null | undefined): string {
  return TAX_MODE_LABELS[mode ?? "normal"] ?? TAX_MODE_LABELS.normal;
}

export function formatTerm(termMonths: number | null): string {
  return termMonths != null ? `${termMonths}개월` : "조건 미정";
}

export function numOr(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

export function moneyLabelOf(raw: string | null | undefined, fallback: string): string {
  const n = numOr(raw);
  return n == null ? fallback : `${formatMoney(n)}원`;
}

// 카탈로그 트림명이 모델명을 접두로 포함하는 경우(BMW 등) 중복 제거 — 카드·견적함·워크벤치 공통 표시 규칙.
// 둘 다 없으면 빈 문자열(폴백 문구는 호출부 소관 — 앱카드 "차량 미선택", 견적함 quoteCode 등).
export function dedupedModelTrim(modelName?: string | null, trimName?: string | null): string {
  const model = modelName?.trim() ?? "";
  const trim = trimName?.trim() ?? "";
  if (!model) return trim;
  if (!trim) return model;
  return trim.startsWith(model) ? trim : `${model} ${trim}`;
}

// 모델+트림 표시명(앱카드 어휘) — dedupe 규칙 + "차량 미선택" 폴백.
export function vehicleTitleOf(modelName: string | null, trimName: string | null): string {
  return dedupedModelTrim(modelName, trimName) || "차량 미선택";
}

// 구매방식 종속 초기비용 행 라벨(이사님 도메인 규칙 표): 할부=선납금(금액만), 리스/렌트=선수금.
// 앱카드 모델·견적함 요약 칩(QuoteList)·서버 발송 조립기가 공유.
export function downPaymentRowLabelOf(purchaseMethod?: string | null): "선납금" | "선수금" {
  return purchaseMethod === "할부" ? "선납금" : "선수금";
}

// mode+value 병기 포맷. percent 금액 환산 기준 = finalVehiclePrice(0이면 %만).
// percentFirst: 보증금/선수금 "(20%) 28,560,000원" ↔ 잔존가치 "82,824,000원 (58%)" 어순.
export function moneyModeLabel(
  mode: string | null | undefined,
  value: string | null | undefined,
  finalVehiclePrice: number,
  opts: { noneLabel: string; percentFirst: boolean },
): string {
  if (mode == null || mode === "none") return opts.noneLabel;
  if (mode === "max") return "최대";
  if (mode === "percent") {
    const v = numOr(value);
    if (v == null) return opts.noneLabel;
    if (!finalVehiclePrice) return `${v}%`;
    const amount = `${formatMoney(Math.round(finalVehiclePrice * v / 100))}원`;
    return opts.percentFirst ? `(${v}%) ${amount}` : `${amount} (${v}%)`;
  }
  const n = numOr(value);
  return n == null ? opts.noneLabel : `${formatMoney(n)}원`;
}

// "20,000km / 년" → "연 20,000km"(디자인 표기). "/" 앞부분에 "연 " 접두, 빈 head면 원문 유지.
export function mileageLabelOf(raw: string | null | undefined): string {
  if (!raw) return "연 20,000km";
  const head = raw.split("/")[0]?.trim();
  return head ? `연 ${head}` : raw;
}

// "썬팅: 후퍼옵틱 …" → {label: "썬팅", value: "후퍼옵틱 …"}. 콜론 없으면 label 없이 전체.
export function splitService(raw: string): { label: string; value: string } {
  const idx = raw.indexOf(":");
  if (idx === -1) return { label: "", value: raw.trim() };
  return { label: raw.slice(0, idx).trim(), value: raw.slice(idx + 1).trim() };
}
