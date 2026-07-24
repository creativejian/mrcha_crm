// 앱 견적요청 → crm.customers.need_* 파생 SSOT(2026-07-24 대표 견적요청 설계 D2).
// 설계 = ref/specs/2026-07-24-crm-featured-quote-request-needs-design.md
//
// ⚠️ 부작용 0 순수 모듈이다 — 서버(src/)가 import한다(AGENTS.md "서버→클라 순수 모듈 import 경계").
//    http/supabase/React 체인을 절대 끌어들이지 말 것. 숫자 포맷도 lib/detail-utils를 쓰지 않는다
//    (그 파일은 react 타입을 import한다) — toLocaleString을 직접 부른다.
// ⚠️ 출력은 need_* 컬럼에 그대로 박히고 AI 프로필 청크 텍스트(buildCustomerProfileChunkText)가 된다 —
//    형식을 바꾸면 임베딩이 전량 재백필된다(embeddingContentHash 변경).

import { ANNUAL_MILEAGE_OPTIONS, PURCHASE_UNSET_SENTINEL } from "@/data/customers";
import { DEPOSIT_TYPE_LABEL, PAYMENT_METHOD_LABEL } from "@/data/quote-request-labels";
import { deliveryTimingTextOf } from "@/lib/quote-delivery";

// 대표 요청에서 파생되는 need_* 컬럼(설계 D2·D7). 대표가 있으면 이 필드들은 read-only다 —
// 서버 PATCH가 409로 거부하고(routes/customers.ts) 화면도 편집 팝오버를 열지 않는다.
// 차종 2개(needModel·needTrim)는 catalog 조인이 필요해 서버가 따로 채우지만 "파생이라 수정 불가"라는
// 성격이 같아 여기 함께 둔다.
export const DERIVED_NEED_KEYS = [
  "needModel",
  "needTrim",
  "needMethod",
  "needContractTerm",
  "needInitialCost",
  "needAnnualMileage",
  "needTiming",
] as const;

export type QuoteRequestNeedsSource = {
  paymentMethod: string | null;
  period: number | null;
  depositType: string | null;
  depositRatio: number | null;
  rentalDeposit: number | null;
  annualMileageKm: number | null;
  deliveryTimingMode: string | null;
  deliveryTimingReferenceMonth: string | null;
  deliveryTargetMonth: string | null;
};

// 차종 2개를 뺀 5필드 — 서버가 catalog 조인 결과와 합쳐 7필드를 만든다.
export type DerivedNeeds = {
  needMethod: string | null;
  needContractTerm: string | null;
  needInitialCost: string | null;
  needAnnualMileage: string | null;
  needTiming: string | null;
};

export function contractTermTextOf(period: number | null): string | null {
  // CONTRACT_TERM_OPTIONS 밖 값이어도 그대로 쓴다 — need_contract_term에는 DB CHECK가 없고(실측),
  // read-only라 편집 선택지와 맞출 필요도 없다. 사실을 그대로 보여주는 편이 낫다.
  return period == null ? null : `${period}개월`;
}

export function annualMileageTextOf(km: number | null): string | null {
  if (km == null) return null;
  const text = `${km.toLocaleString("ko-KR")}km`;
  // need_annual_mileage는 DB CHECK가 8종으로 닫혀 있다 — 어휘 밖 값이면 그 필드만 버린다(나머지 파생은
  // 살린다). 앱이 chat_quote_flow.dart:379에서 검증하므로 현재는 도달하지 않는 방어선이다.
  // annual_mileage_is_minimum(렌트+40000일 때만 true = "40,000km 이상")은 CRM 어휘에 대응이 없어 버린다.
  return ANNUAL_MILEAGE_OPTIONS.includes(text) ? text : null;
}

// 비율 우선·금액 폴백(설계 D2-a). ⚠️ 앱카드 라벨(lib/quote-requests depositLabelOf —
// "보증금 (20%) 1,180만원" 병기)과 형식이 다르다. 상세 구매조건은 parseInitialCost가 읽는 CRM 어휘여야
// 앱 미연결 고객의 수기값과 같은 어휘가 된다. 복붙 금지.
export function initialCostTextOf(
  depositType: string | null,
  ratio: number | null,
  amountWon: number | null,
): string | null {
  if (!depositType) return null;
  if (depositType === "none") return DEPOSIT_TYPE_LABEL.none;
  const name = DEPOSIT_TYPE_LABEL[depositType] ?? depositType;
  if (ratio != null && ratio > 0) return `${name} ${ratio}%`;
  if (amountWon != null && amountWon > 0) {
    return `${name} ${Math.round(amountWon / 10000).toLocaleString("ko-KR")}만원`;
  }
  return name;
}

// 상세 구매조건 "출고 희망 시기" 프리셋 → 앱 delivery_timing_mode(설계 D4). 앱 UI 4종과 어휘를 맞춘다.
// ⚠️ 앱의 within_three_months는 "3개월 **이내**"다 — "이후"는 뜻이 반대라 그대로 옮기면 오독된다.
// 앱이 예약해 둔 2종(as_soon_as_favorable·specific_month)은 UI에 노출하지 않는다(앱과 동일).
const TIMING_PRESET_MODE: Record<string, string> = {
  "이번 달": "current_month",
  "다음 달": "next_month",
  "3개월 이내": "within_three_months",
  "미정": "undecided",
};

export const timingPresetOptions = Object.keys(TIMING_PRESET_MODE);

// 프리셋 선택 → 저장값. 고른 시점(referenceMonth = 'YYYY-MM')을 앵커로 **절대화**한다(설계 D4).
// 앱 연결 고객은 요청에 참조월이 실려 오지만 수기 입력에는 없어서, 고른 시점을 그 자리에 놓는다.
// undecided·모르는 프리셋은 deliveryTimingTextOf가 null을 주므로 미입력 센티넬로 떨어진다.
export function timingTextFromPreset(preset: string, referenceMonth: string): string {
  return deliveryTimingTextOf(TIMING_PRESET_MODE[preset] ?? null, referenceMonth, null) ?? PURCHASE_UNSET_SENTINEL;
}

export function deriveNeedsFromRequest(req: QuoteRequestNeedsSource): DerivedNeeds {
  return {
    needMethod: req.paymentMethod ? (PAYMENT_METHOD_LABEL[req.paymentMethod] ?? req.paymentMethod) : null,
    needContractTerm: contractTermTextOf(req.period),
    needInitialCost: initialCostTextOf(req.depositType, req.depositRatio, req.rentalDeposit),
    needAnnualMileage: annualMileageTextOf(req.annualMileageKm),
    needTiming: deliveryTimingTextOf(req.deliveryTimingMode, req.deliveryTimingReferenceMonth, req.deliveryTargetMonth),
  };
}
