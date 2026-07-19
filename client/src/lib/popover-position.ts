// 콘솔 테이블 행 팝오버 fixed 배치 계산(중립 모듈 — 출고 예정 T13에서 신설, 2026-07-19 확산 픽스에서
// 진행 상태·가능성 팝오버가 공유하게 되며 delivery-console.ts에서 이동).
// 배경: 콘솔 래퍼 `.console-table-scroll{overflow:hidden}`(콘솔 서피스 SSOT·불가침 #247)이 absolute
// 팝오버를 마지막 행에서 절단한다 — fixed는 조상 overflow 클리핑을 받지 않아 탈출한다.
// 기본 = 앵커 아래(+6px). 아래가 뷰포트를 넘으면 위로(flip-up), 좌우는 뷰포트 안으로 클램프.
export function resolveFixedPopoverPosition(
  anchor: { top: number; bottom: number; left: number },
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number; openUp: boolean } {
  const MARGIN = 8;
  const GAP = 6;
  const openUp = anchor.bottom + GAP + popover.height > viewport.height - MARGIN && anchor.top - GAP - popover.height >= MARGIN;
  const top = openUp ? anchor.top - GAP - popover.height : anchor.bottom + GAP;
  const left = Math.max(MARGIN, Math.min(anchor.left, viewport.width - popover.width - MARGIN));
  return { top, left, openUp };
}
