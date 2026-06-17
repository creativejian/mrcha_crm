// 트림 테이블 표시용 순수 포맷터/상수(컴포넌트 파일과 분리 — react-refresh).

// 트림명 다음 컬럼 수(고유번호~상태 9 + 트림명 1). 그룹 헤더 colSpan 계산에 쓴다.
export const TRIM_BODY_COLS = 10;

export function fmtDate(s: string | null): string {
  return s ? s.slice(0, 10) : "—";
}

export function discountText(amount: number | null, price: number): string {
  if (!amount) return "—";
  const rate = price > 0 ? ((amount / price) * 100).toFixed(1) : "0.0";
  return `${amount.toLocaleString()}원 (${rate}%)`;
}
