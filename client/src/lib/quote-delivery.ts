// 앱 견적요청 출고 정보 파생 — 클라·서버 공용 **순수 모듈**(부작용 0, http/supabase/React 체인 없음).
// 서버가 import한다(AGENTS.md "서버→클라 순수 모듈 import 경계") — lib/quote-requests.ts는 ./http 체인이라
// 서버에서 못 쓴다(phone-format.ts 분리와 같은 사유).
// 계약 SSOT = ref/2026-07-24-app-delivery-contract-reply.md (앱 원문은 앱 레포 reference/design/...proposal.md).
//
// 소비: 견적요청 카드 표시 · 승격 시 need_timing 시드(2단계) · 업무 AI 요청 청크(3단계).
// ⚠️ deliveryTimingTextOf의 출력 형식은 need_timing으로 DB에 박히고 AI 청크 텍스트가 된다 —
//    바꾸면 청크 content가 전부 달라져 임베딩 전량 재백필이다(계약 §5-5). 형식 변경 금지.

// 등록 지역을 쓰는 구매방식. 그 외(lease·rent·null=미정)는 인수 지역을 쓴다.
// 앱이 either/or로 수집하지만 플로우 중 구매방식을 바꾸면 두 버킷이 동시에 찰 수 있어(reconciledFor),
// "무엇을 표시할지"는 이 분기가 정본이고 반대 버킷은 보조 정보다.
const REGISTRATION_REGION_METHODS = new Set(["installment", "cash"]);

type QuoteRegionSource = {
  paymentMethod: string | null;
  deliveryRegionCode: string | null;
  deliveryRegionName: string | null;
  registrationRegionCode: string | null;
  registrationRegionName: string | null;
};

// 표시용 지역 1개. name(정식명 스냅샷)이 정본이고 code는 폴백 — 앱이 쌍으로 보내지만 신뢰하지 않는다.
export function deliveryRegionOf(row: QuoteRegionSource): string | null {
  const useRegistration = row.paymentMethod != null && REGISTRATION_REGION_METHODS.has(row.paymentMethod);
  return useRegistration
    ? (row.registrationRegionName ?? row.registrationRegionCode)
    : (row.deliveryRegionName ?? row.deliveryRegionCode);
}

// 상대 mode → reference_month에 더할 개월 수. undecided는 여기 없다(시드 안 함 = null).
const RELATIVE_MONTH_OFFSET: Record<string, number> = {
  current_month: 0,
  next_month: 1,
  within_three_months: 3,
};

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

// 'YYYY-MM' → 절대 월 인덱스(year*12 + month-1). Date를 경유하지 않는다 — 타임존·말일 함정을 피하려고
// 정수 연산만 쓴다(월 덧셈이 연을 넘어가는 게 이 함수의 유일한 계산이다).
function parseMonthIndex(value: string | null): number | null {
  if (!value) return null;
  const matched = MONTH_PATTERN.exec(value);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
}

function formatMonthIndex(index: number): string {
  return `${Math.floor(index / 12)}년 ${(index % 12) + 1}월`;
}

// 출고 희망 시기 → 절대화 텍스트. 시드·표시 공용 SSOT.
// 절대화하는 이유: 상대 답변("이번 달")은 시간이 지나면 부패한다. 원 답변은 quote_requests에 그대로 남아
// 복원 가능하므로 앵커는 병기하지 않는다(계약 D3).
// ⚠️ **과거 월이 나오는 것은 정상이다** — 2026-07에 "이번 달"이라 답한 요청을 2026-09에 승격하면
//    "2026년 7월"이 된다. 버그가 아니라 사실 기록이고 "오래된 요청 = 재확인 필요" 신호다.
//    승격 시점 기준으로 바꾸지 말 것(계약 §5-3 — 바꾸면 재백필이 재발한다).
export function deliveryTimingTextOf(
  mode: string | null,
  referenceMonth: string | null,
  targetMonth: string | null,
): string | null {
  if (mode === "as_soon_as_favorable") return "좋은 조건 즉시";
  if (mode === "specific_month") {
    const target = parseMonthIndex(targetMonth);
    return target == null ? null : formatMonthIndex(target);
  }
  // undecided·레거시(null)·미지의 mode는 전부 여기서 빠진다 — 앱이 어휘를 늘려도 화면이 깨지지 않는다.
  const offset = mode == null ? undefined : RELATIVE_MONTH_OFFSET[mode];
  if (offset === undefined) return null;
  const base = parseMonthIndex(referenceMonth);
  if (base == null) return null;
  const text = formatMonthIndex(base + offset);
  // 마감형(계약 D4) — "이내"는 상대 표현이 남아 절대화 취지가 무너진다.
  return mode === "within_three_months" ? `${text}까지` : text;
}
