import type { ReactNode, RefObject } from "react";

import { useFixedPopoverPosition } from "@/lib/use-fixed-popover-position";

// 행 우측 액션(완료/삭제) 확인 팝오버 공용 셸 — `.kim-check-confirm-popover`(fixed)의 좌표를
// useFixedPopoverPosition으로 공급한다. 2026-07-26 할일 카드에 도입된 패턴(클리핑 탈출)을
// 공용화한 것: 같은 fixed 클래스를 좌표 없이 raw div로 렌더하면 뷰포트 밖에 그려져 "버튼을
// 눌러도 아무 일 없음"이 된다(서류·일정 팝오버가 그렇게 07-26~07-31 조용히 불능이었다).
// anchorSelector는 팝오버를 감싼 행 요소의 클래스여야 한다 — 조상에서 안 잡히면 영구 hidden
// (useFixedPopoverPosition의 fail-silent 계약 참조).
export function ConfirmPopover({ anchorSelector, ariaLabel, className, popRef, children }: {
  anchorSelector: string;
  ariaLabel: string;
  className: string;
  popRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const pos = useFixedPopoverPosition(popRef, anchorSelector, undefined, "end");
  return (
    <div
      aria-label={ariaLabel}
      className={className}
      onClick={(event) => event.stopPropagation()}
      ref={popRef}
      role="dialog"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
    >
      {children}
    </div>
  );
}
