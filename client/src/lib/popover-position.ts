// 콘솔 테이블 행 팝오버 fixed 배치 계산(중립 모듈 — 출고 예정 T13에서 신설, 2026-07-19 확산 픽스에서
// 진행 상태·가능성 팝오버가 공유하게 되며 delivery-console.ts에서 이동).
// 배경: 콘솔 래퍼 `.console-table-scroll{overflow:hidden}`(콘솔 서피스 SSOT·불가침 #247)이 absolute
// 팝오버를 마지막 행에서 절단한다 — fixed는 조상 overflow 클리핑을 받지 않아 탈출한다.
// 기본 = 앵커 아래(+6px). 아래가 뷰포트를 넘으면 위로(flip-up), 좌우는 뷰포트 안으로 클램프.
export function resolveFixedPopoverPosition(
  anchor: { top: number; bottom: number; left: number },
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number; openUp: boolean; maxHeight: number } {
  const MARGIN = 8;
  const GAP = 6;
  const openUp = anchor.bottom + GAP + popover.height > viewport.height - MARGIN && anchor.top - GAP - popover.height >= MARGIN;
  const top = openUp ? anchor.top - GAP - popover.height : anchor.bottom + GAP;
  const left = Math.max(MARGIN, Math.min(anchor.left, viewport.width - popover.width - MARGIN));
  // 배치가 정해진 뒤 **남는 세로 공간**. 소비처가 max-height로 걸면 넘치는 대신 스크롤이 생긴다.
  // ⚠️ 이게 없으면 **위아래 모두 부족할 때 조용히 잘린다** — 위 flip 조건은 "아래로 넘치고 && 위에
  // 충분한 공간"이라 둘 다 부족하면 뒤집지 못하고 아래로 붙는데, 그때 넘친 부분이 화면 밖으로
  // 사라진다(2026-08-05 실화면: 출고 정보 팝오버에 정산 비용 행이 붙으면서 "실입금액" 아래가
  // 통째로 안 보였다). 팝오버 내용이 가변인 곳(행을 추가할 수 있는 폼)은 반드시 이걸 걸 것.
  const maxHeight = openUp ? anchor.top - GAP - MARGIN : viewport.height - top - MARGIN;
  return { top, left, openUp, maxHeight };
}
