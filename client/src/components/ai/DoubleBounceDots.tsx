// 앱 _ChaDoubleBounceIndicator 포팅: 브랜드색 두 원이 위상차로 펄스(1600ms). 색상은 CSS 토큰(--brand).
export function DoubleBounceDots() {
  return (
    <span className="db-dots" aria-label="생각 중" role="status">
      <span className="db-dot" />
      <span className="db-dot" />
    </span>
  );
}
