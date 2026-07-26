import { useLayoutEffect, useState, type RefObject } from "react";

import { resolveFixedPopoverPosition } from "./popover-position";

// 행 팝오버 fixed 배치 공유 훅 — CustomerManagementRow 로컬 정의에서 추출(0726: 드로어 "해야 할 일"
// 확인 팝오버도 같은 클리핑을 밟아 소비처가 페이지 밖으로 늘었다). 원 배경(2026-07-19 클리핑 확산
// 픽스): 콘솔 래퍼 `.console-table-scroll{overflow:hidden}`(콘솔 서피스 SSOT·불가침)이 absolute
// 팝오버를 마지막 행에서 절단하던 결함의 탈출 경로. 팝오버 루트에서 closest(anchorSelector)로 앵커를
// 찾아 뷰포트 rect 기준 좌표를 계산한다(useLayoutEffect = paint 전 1회 — pos 미확정 구간은 호출부가
// visibility:hidden 방어). fixed는 스크롤·리사이즈를 따라가지 않으므로 열림 상태의 닫기는 호출부
// 쪽 effect가 담당한다.
// heightDep: 마운트 후 팝오버 높이를 바꾸는 상태(notice 등)가 있으면 넘겨 재계산한다.
// align "end": 팝오버 오른쪽 모서리를 앵커 오른쪽에 맞춘다(행 우측 액션 버튼 곁 팝오버용).
// ⚠️계약(배치 10 B#8): anchorSelector가 조상에서 안 잡히면 pos가 영구 null = 팝오버가 **무경고로
// 영구 hidden**(fail-silent — "버튼 눌러도 아무 일 없음"으로 보인다). 재사용 시 팝오버를 반드시
// 앵커 요소의 서브트리 안에 렌더하고, 셀렉터 오타를 의심할 것.
export function useFixedPopoverPosition(
  rootRef: RefObject<HTMLElement | null>,
  anchorSelector: string,
  heightDep?: unknown,
  align: "start" | "end" = "start",
) {
  const [pos, setPos] = useState<ReturnType<typeof resolveFixedPopoverPosition> | null>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    const anchorEl = el?.closest(anchorSelector);
    if (!el || !anchorEl) return;
    const anchor = anchorEl.getBoundingClientRect();
    setPos(resolveFixedPopoverPosition(
      { top: anchor.top, bottom: anchor.bottom, left: align === "end" ? anchor.right - el.offsetWidth : anchor.left },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    ));
  }, [rootRef, anchorSelector, heightDep, align]);
  return pos;
}
