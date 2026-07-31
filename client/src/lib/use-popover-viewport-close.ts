import { useEffect, useRef } from "react";

// fixed 팝오버가 열려 있는 동안 뷰포트 시프트(스크롤·리사이즈)가 오면 닫는 공용 훅 —
// `useFixedPopoverPosition`이 좌표를 useLayoutEffect로 **1회만** 계산하므로 팝오버는 스크롤을
// 따라가지 못하고 앵커에서 떨어져 나온다. 그 훅 주석이 "열림 상태의 닫기는 호출부 쪽 effect가
// 담당한다"고 명시한 책임의 이행 단위이고, **fixed 팝오버를 새로 배선하면 이것도 함께 건다.**
// 2026-07-31 실측(드로어 3카드가 미배선이던 상태): 드로어를 400px 굴리면 대상 행은 400px
// 이동하는데 확인 팝오버는 0px에 머물러, "삭제하시겠습니까?"가 할일 카드가 아닌 상세 구매조건
// 섹션 한복판에 떠 있었다(팝오버는 계속 열린 채라 사용자는 엉뚱한 행을 대상으로 오인한다).
// scroll은 **capture**로 듣는다 — 드로어·카드 바디 같은 내부 스크롤 컨테이너의 scroll 이벤트는
// 버블하지 않아 document 레벨 비캡처 리스너로는 잡히지 않는다.
// onClose는 ref로 최신값을 잡아 deps에서 뺀다(호출부가 인라인 화살표를 넘겨도 열림 중 재구독이
// 생기지 않는다).
export function usePopoverViewportClose(active: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;

    function closeOnShift() {
      onCloseRef.current();
    }

    document.addEventListener("scroll", closeOnShift, true);
    window.addEventListener("resize", closeOnShift);
    return () => {
      document.removeEventListener("scroll", closeOnShift, true);
      window.removeEventListener("resize", closeOnShift);
    };
  }, [active]);
}
