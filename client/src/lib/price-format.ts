// 차량 가격 표시 공용 포맷터. 앱 price_format.dart와 패리티 유지.

// 원 단위 가격 → "4,506만" / "1억 7,910만" / "2억". 만원 미만은 절삭(floor). '원'은 호출부에서 붙인다.
function fmtManwon(priceWon: number): string {
  const man = Math.floor(priceWon / 10000);
  if (man >= 10000) {
    const eok = Math.floor(man / 10000);
    const remain = man % 10000;
    return remain === 0 ? `${eok}억` : `${eok}억 ${remain.toLocaleString()}만`;
  }
  return `${man.toLocaleString()}만`;
}

// "4,506만 ~ 6,224만원" / "1억 5,000만 ~ 2억원" 형식(한글 가독성 우선, 어드민 차량 관리·모델 카드 공용).
// ~ 앞뒤 공백은 CRM 가독성용(앱은 공백 없음). minPrice 미정(null·<=0)이면 emptyText. maxPrice 미정·동일이면 단일가.
export function formatPriceRangeKorean(
  minPrice: number | null,
  maxPrice: number | null,
  emptyText = "—",
): string {
  if (minPrice == null || minPrice <= 0) return emptyText;
  if (maxPrice == null || maxPrice === minPrice) return `${fmtManwon(minPrice)}원`;
  return `${fmtManwon(minPrice)} ~ ${fmtManwon(maxPrice)}원`;
}
