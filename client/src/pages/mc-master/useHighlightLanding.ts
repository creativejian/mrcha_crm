import { useEffect, useRef, type RefObject } from "react";

// 딥링크 착지 마킹의 공용 규칙(2026-08-03 통합) — 두 축이 같은 순서를 쓴다:
//   ①명부·제안 링크의 `?hl=트림 id`(2026-07-29) ②대기열·내 요청의 신규 트림 `?hlreq=요청 id`
//   (2026-08-03 — 트림이 아직 없어 hl을 못 쓰고 미리보기 행을 요청 id로 찾는다).
// 규칙: 대상이 접힌 서브라인 안이면 펼치고 → 가운데로 스크롤 → 플래시(va-row-flash)로 마킹 →
// 파라미터를 소비(replace)한다. 남겨두면 새로고침·북마크마다 재발동한다.
// setState·DOM 접근은 전부 타이머 콜백에서 한다(effect 본문 setState는 lint 기준선 위반).

/** 플래시가 끝나는 시점 = URL 파라미터 소비 시각(va-row-flash 애니메이션 길이와 한 쌍). */
const CONSUME_MS = 2600;
/** 그룹 펼침 커밋 후의 DOM에서 찾아야 한다 — 접혀 있던 행은 그 전엔 존재하지 않는다. */
const SCROLL_MS = 80;

export function useHighlightLanding({
  selector,
  group,
  scrollRef,
  expandGroup,
  onConsume,
}: {
  /** 착지 행의 앵커 선택자(data-trim-id / data-request-id) — 대상을 못 찾았으면 null. */
  selector: string | null;
  /** 대상이 든 접힘 그룹 키 — 그룹 뷰(국산차)가 아니면 null. */
  group: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  expandGroup: (key: string) => void;
  /** URL 파라미터 소비(navigate replace). */
  onConsume: () => void;
}): void {
  // onConsume은 렌더마다 새 함수다 — ref로 최신본만 참조해 effect가 selector·group에만 반응하게
  // 한다(재조회마다 타이머가 리셋되지 않는다).
  const consumeRef = useRef(onConsume);
  useEffect(() => {
    consumeRef.current = onConsume;
  });

  useEffect(() => {
    if (selector == null) return;
    const t0 = window.setTimeout(() => {
      if (group) expandGroup(group);
    }, 0);
    const t1 = window.setTimeout(() => {
      scrollRef.current?.querySelector(selector)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, SCROLL_MS);
    const t2 = window.setTimeout(() => consumeRef.current(), CONSUME_MS);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [selector, group, expandGroup, scrollRef]);
}
