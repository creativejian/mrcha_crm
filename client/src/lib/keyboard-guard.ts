// 단축키를 무시해야 하는 상황 판정(순수) — 리스너는 이 결과만 보고 빠져나간다.

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * @param target 이벤트 대상(포커스된 요소)
 * @param isComposing IME 조합 중 여부 — 한글 조합 중 keydown은 조합 키로 발화한다
 *   (`ChatComposer.tsx`·`AiAssistantPanel.tsx` 선례). event.code 판정으로 바꿔도 이 가드는
 *   여전히 필요하다: 조합 중 발화 자체를 걸러야 한다.
 * @param panelOpen 단축키 패널 열림 — 그 안의 검색 입력이 네비게이션을 발동시키면 안 된다
 */
export function shouldIgnoreKeyEvent(target: EventTarget | null, isComposing: boolean, panelOpen: boolean): boolean {
  if (isComposing || panelOpen) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (EDITABLE_TAGS.has(target.tagName)) return true;
  // closest로 보는 이유 둘: ①contentEditable 안의 자식(span 등)에 포커스가 잡히는 실제 케이스를
  // 놓치지 않는다 ②jsdom에 isContentEditable이 없어 그것만 쓰면 undefined가 새어 나간다.
  return target.isContentEditable === true || target.closest('[contenteditable="true"]') != null;
}
