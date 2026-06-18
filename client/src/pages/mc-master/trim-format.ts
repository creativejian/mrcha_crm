// 트림 테이블 표시용 순수 포맷터/상수(컴포넌트 파일과 분리 — react-refresh).

// 트림명 다음 컬럼 수(고유번호~상태 9 + 옵션 1 + 트림명 1). 그룹 헤더 colSpan 계산에 쓴다.
export const TRIM_BODY_COLS = 11;

export function fmtDate(s: string | null): string {
  return s ? s.slice(0, 10).replace(/-/g, "/") : "—";
}

export function discountText(amount: number | null, price: number): string {
  if (!amount) return "—";
  const rate = price > 0 ? ((amount / price) * 100).toFixed(1) : "0.0";
  return `${amount.toLocaleString()}원(${rate}%)`;
}

// 원 단위 천단위 콤마 포맷(입력 중 그룹핑). 빈 값은 빈 문자열.
export function formatThousands(s: string): string {
  const digits = s.replace(/[^0-9]/g, "");
  return digits === "" ? "" : Number(digits).toLocaleString();
}

// 콤마 제거 후 정수. 빈 값/숫자 아님 → null.
export function parseWon(s: string): number | null {
  const n = Number(s.replace(/[^0-9]/g, ""));
  return s.trim() === "" || Number.isNaN(n) ? null : n;
}

// 원 표시(미정이면 '—').
export function wonText(v: number | null): string {
  return v == null ? "—" : `${v.toLocaleString()}원`;
}

// 옵션 가격은 만원 단위 표시/입력(앱과 동일). DB는 원 저장.
export function manwonText(won: number | null): string {
  return won == null ? "—" : `${(won / 10000).toLocaleString()}만원`;
}

// 만원 입력(콤마 제거 후 정수) → 원. 빈 값/숫자 아님 → null.
export function parseManwon(s: string): number | null {
  const n = Number(s.replace(/[^0-9]/g, ""));
  return s.trim() === "" || Number.isNaN(n) ? null : n * 10000;
}
