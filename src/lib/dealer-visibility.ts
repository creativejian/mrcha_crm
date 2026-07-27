// 딜러에게 감추는 값(2026-07-27 유슨생 결정) — **딜러는 자기 제안만 본다.**
//
// 관리자가 확정한 할인(catalog.trims 3금액)을 딜러가 보면 ①다른 딜러의 제안이 채택된 결과를
// 역산할 수 있고(경쟁사 할인 전략 노출) ②관리자가 얼마로 확정했는지 알고 제안을 맞추게 된다.
// 딜러가 볼 것은 crm.dealer_trim_discounts의 자기 행뿐이다(그건 별도 API로 내려간다).
//
// ⚠️ **화면에서 감추는 것으로는 부족하다** — 응답에 실려 있으면 DevTools로 보인다. 그래서
// 서버가 비운다. 브랜드 스코프(MCMasterPage)는 "앱에서 고객에게 공개되는 정보라 클라 차단으로
// 족하다"고 판단했지만 **확정 할인은 다르다**: 앱도 그 값을 관리자 화면에서만 쓴다
// (2026-07-27 실측 — mr-cha-app `lib/presentation/screens/admin/trim_list/` 2파일이 전부이고
// 고객 화면 사용처 0건). 즉 딜러가 앱으로 우회해 볼 경로가 없어 이 차단이 실효를 갖는다.
//
// discount_updated_at도 함께 비운다: 금액을 감춰도 "언제 확정이 바뀌었다"가 남으면 경쟁 딜러의
// 제안이 채택된 시점이 새고, 딜러 화면의 그 열은 자기 제안과 무관해 의미도 없다.
// discountUpdatedAt이 optional인 이유: 확정 할인을 내리는 응답이 두 종류다 — catalog 트림 목록은
// 할인변경일을 함께 싣지만, 견적용 트림 상세(queries/vehicles.ts getTrimDetail)는 3금액만 싣는다.
type ConfirmedDiscountFields = {
  financialDiscountAmount: number | null;
  partnerDiscountAmount: number | null;
  cashDiscountAmount: number | null;
  discountUpdatedAt?: string | null;
};

function maskConfirmedDiscounts<T extends ConfirmedDiscountFields>(trim: T): T {
  const masked: T = {
    ...trim,
    financialDiscountAmount: null,
    partnerDiscountAmount: null,
    cashDiscountAmount: null,
  };
  // 원래 없던 키를 새로 만들지 않는다 — 응답 형태가 role에 따라 달라지면 클라 파싱이 갈린다.
  if ("discountUpdatedAt" in trim) masked.discountUpdatedAt = null;
  return masked;
}

// role 판정을 **이 파일 한 곳에만** 둔다(두 라우터가 각자 문자열을 비교하면 한쪽만 고쳐질 수 있다).
export function visibleTrimsFor<T extends ConfirmedDiscountFields>(role: string, trims: T[]): T[] {
  return role === "dealer" ? trims.map(maskConfirmedDiscounts) : trims;
}

export function visibleTrimFor<T extends ConfirmedDiscountFields>(role: string, trim: T): T {
  return role === "dealer" ? maskConfirmedDiscounts(trim) : trim;
}
