import type { CSSProperties } from "react";

// 버튼 앵커 팝오버의 fixed 좌표 계산(공용 SSOT, 2026-08-03 통합) — 이 레포의 팝오버는 전부
// .table-scroll(overflow) 안이나 sticky 셀 안에 살아서 absolute면 잘린다. fixed로 띄우고
// 좌표를 손으로 계산하는 이유가 그것이다(각 팝오버 CSS 주석 참조).
// 소비처: 입력 트림 팝오버(딜러 명부·내 입력 트림) · 승인 대기열 · 내 요청 · 행 승인 대기 배지.
// 구 popoverPosFromRect(top 앵커 전용) + badgePopoverPos(플립판)를 한 벌로 합친 것 —
// 클램프·간격·하한이 원래 같은 값이었고 갈라진 것은 플립 분기 하나뿐이었다.

export type PopoverPos = {
  /** 아래로 펼 때의 앵커. 위로 펼 때(bottom)는 undefined — 둘은 배타다. */
  top?: number;
  /** 위로 펼 때의 앵커(뷰포트 하단 기준). 높이 측정 없이 내용이 위로 자란다. */
  bottom?: number;
  left: number;
  maxHeight: number;
};

/** 팝오버 최대 폭(720) + 여백 — left 클램프 기준. */
const POPOVER_WIDTH = 736;
/** 앵커(버튼·배지)와의 간격. */
const GAP = 4;
/** 뷰포트 가장자리 여백. */
const EDGE = 16;
/** maxHeight 하한 — 이보다 낮으면 내용이 한 줄도 안 보인다. */
const MIN_HEIGHT = 160;

export function popoverPos(
  rect: DOMRect | undefined,
  viewport: { width: number; height: number },
  opts?: {
    /**
     * 아래 남은 공간이 이 값 미만이면 위로 편다(bottom 앵커). 생략 = 항상 아래.
     * 표 **마지막 행**에 사는 앵커(행 배지)에만 필요하다 — 헤더 버튼은 아래가 늘 넉넉하다.
     */
    flipBelow?: number;
  },
): PopoverPos | null {
  if (!rect) return null;
  const left = Math.max(8, Math.min(rect.left, viewport.width - POPOVER_WIDTH));
  const below = viewport.height - rect.bottom - EDGE;
  if (opts?.flipBelow != null && below < opts.flipBelow) {
    return { bottom: viewport.height - rect.top + GAP, left, maxHeight: Math.max(MIN_HEIGHT, rect.top - EDGE) };
  }
  return { top: rect.bottom + GAP, left, maxHeight: Math.max(MIN_HEIGHT, below) };
}

/** 현재 창을 뷰포트로 쓰는 축약(플립 없음) — 헤더 버튼 팝오버 4곳의 호출 형태. */
export function popoverPosFromRect(rect: DOMRect | undefined): PopoverPos | null {
  return popoverPos(rect, { width: window.innerWidth, height: window.innerHeight });
}

/**
 * 좌표를 style로 — top/bottom을 함께 실어 어느 앵커든 그대로 동작한다(미사용 축은 undefined).
 * 소비처가 top만 싣던 시절엔 플립을 켠 팝오버만 style을 따로 써야 했다.
 */
export function popoverStyle(pos: PopoverPos | null): CSSProperties | undefined {
  return pos ? { top: pos.top, bottom: pos.bottom, left: pos.left, maxHeight: pos.maxHeight } : undefined;
}
