// 카운트 배지 **SSOT**(2026-08-05) — 사이드바 메뉴·브랜드 목록·모델 목록이 같은 부품을 쓴다.
//
// 여기가 소유하는 규칙 셋:
//   ① **0이면 그리지 않는다** — 모든 항목에 "0"이 붙으면 신호가 죽는다. 소비처가 매번 조건을
//      쓰지 않도록 컴포넌트가 삼킨다(구 코드는 이 조건이 7곳에 복제돼 있었다).
//   ② **tone이 의미를 정한다** — pending(빨강) = 결재할 것 / gap(파랑) = 결재 뒤에 남는 마무리.
//   ③ 크기·모양은 CSS `.count-badge`(controls.css) + `--count-badge-*`(theme.css)가 SSOT.
//
// **배치는 여기가 정하지 않는다** — 소비 컨텍스트가 정한다(사이드바는 오른쪽 끝으로 밀고, 모델
// 목록은 이름 바로 옆에 붙는다). 그래서 이 컴포넌트에 위치 관련 prop이 없다.
// 한 줄에 둘이 함께 뜰 때의 **순서는 빨강 → 파랑 고정**이고, 그건 소비처의 JSX 순서가 지킨다.

export function CountBadge({
  count,
  tone,
  label,
}: {
  count: number;
  tone: "pending" | "gap";
  /** 스크린리더용 설명. 숫자만으로는 무엇의 개수인지 알 수 없다. */
  label: string;
}) {
  if (count <= 0) return null;
  return (
    <span aria-label={label} className={`count-badge num tone-${tone}`}>
      {count}
    </span>
  );
}
