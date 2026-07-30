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
import { parseSolutionQuoteResult } from "./solution-quote";

// 잔존 max인데 실채택 금액을 모를 때의 표시(파트너 조회 전·스냅샷 유실). residualLabelOf 참조.
const RESIDUAL_MAX_FALLBACK = "최대";

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

// 취득원가 항목(공채/탁송료/부대비용) 라벨 — 금액에 포함/불포함을 병기(2026-07-30 실동작화 spec D4).
// 포함 = 취득원가 합산(금융 원금行), 불포함 = 출고 시 고객 직접 부담. 어휘는 carTaxLabel(포함/불포함) 재사용.
// 앱은 라벨 문자열을 그대로 그리므로 payload 구조 변경 없음(앱 팀 무변경).
export function costItemLabelOf(amount: number, included: boolean): string {
  return `${formatMoney(amount)} · ${included ? "포함" : "불포함(고객 부담)"}`;
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
  if (mode === "max") return RESIDUAL_MAX_FALLBACK; // 잔존 전용 모드 — 스냅샷 반영은 residualLabelOf가 담당
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

// 잔존가치 라벨 — max 모드만 특별 취급한다(보증금·선수금엔 max 자체가 없다: DB 실측 none/percent/amount뿐).
//
// max는 "얼마"를 사람이 입력하지 않고 파트너 잔존 매트릭스가 정하는 모드라, DB `residual_value`가 null이다
// (의도된 추출 규칙). 실채택 금액·율은 `solution_raw`에만 산다 — 워크벤치 재진입이 이미 같은 비대칭을
// residualDisplayFromSnapshot(quote-workbench-meta)으로 풀고 있는데, 앱카드 라벨만 그걸 안 읽어서
// 미리보기·고객 발송 payload가 둘 다 "최대"라는 맨 문자열로 나갔다(2026-07-27 이사님 지적, 발송 7건 실측).
//
// %는 스냅샷 rateDecimal을 그대로 쓴다 — 금액÷차량가로 재계산하면 파트너 견적서와 숫자가 어긋난다.
// (실측: 6건 중 5건은 파트너 기준가 = 우리 finalVehiclePrice로 동일. iM캐피탈 1건만 기본 트림가로 잡혀
//  56% vs 60%로 갈리는데, 그건 파트너 쪽 트림 매칭 확인 사항이지 라벨이 덮을 문제가 아니다.)
// 스냅샷이 없거나(파트너 조회 없이 max만 선택) 잔존 금액이 빠졌으면 기존 "최대" 폴백.
export function residualLabelOf(
  mode: string | null | undefined,
  value: string | null | undefined,
  finalVehiclePrice: number,
  solutionRaw: unknown,
  opts: { noneLabel: string; percentFirst: boolean },
): string {
  if (mode !== "max") return moneyModeLabel(mode, value, finalVehiclePrice, opts);
  const parsed = parseSolutionQuoteResult(solutionRaw);
  if (!parsed) return RESIDUAL_MAX_FALLBACK;
  const amount = `${formatMoney(parsed.residualAmount)}원`;
  const pct = `${parsed.residualRatePct}%`;
  return opts.percentFirst ? `(${pct}) ${amount}` : `${amount} (${pct})`;
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
