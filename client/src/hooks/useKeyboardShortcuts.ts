import { useEffect, useRef } from "react";

import type { RoleTab } from "@/data/roles";
import { shouldIgnoreKeyEvent } from "@/lib/keyboard-guard";
import { EMPTY_SEQUENCE, matchKeyEvent, type SequenceState } from "@/lib/keyboard-sequence";
import { visibleShortcuts, type Shortcut } from "@/lib/keyboard-shortcuts";

// 전역 단축키 리스너 — 판정은 전부 순수 모듈(keyboard-guard·keyboard-sequence)에 위임하고
// 여기서는 등록/해제와 시퀀스 상태 보관만 한다. 설계 = ref/specs/2026-08-08-crm-keyboard-shortcuts-design.md.
//
// ⚠️ 기존 전역 keydown 리스너는 전부 Escape 전용(usePopoverDismiss·알림 패널)이라 문자 키와
// 축이 겹치지 않는다(2026-08-08 전수 확인). 새 Escape 처리를 여기 넣지 말 것 — 그 축은 그쪽 소유다.
export function useKeyboardShortcuts(options: {
  role: RoleTab;
  /** 단축키 패널 열림 — 그 안의 검색 입력이 네비게이션을 발동시키지 않게 전부 무시한다. */
  panelOpen: boolean;
  onShortcut: (shortcut: Shortcut) => void;
}) {
  const { role, panelOpen, onShortcut } = options;
  const sequenceRef = useRef<SequenceState>(EMPTY_SEQUENCE);
  // 콜백을 ref로 잡아 리스너를 매 렌더 재등록하지 않는다(Topbar가 인라인 함수를 넘겨도 안전).
  // 쓰기는 effect에서 — 렌더 중 ref 접근은 react-hooks/refs 위반이다.
  const onShortcutRef = useRef(onShortcut);
  useEffect(() => {
    onShortcutRef.current = onShortcut;
  }, [onShortcut]);

  useEffect(() => {
    const shortcuts = visibleShortcuts(role);

    function handleKeyDown(event: KeyboardEvent) {
      if (shouldIgnoreKeyEvent(event.target, event.isComposing, panelOpen)) {
        sequenceRef.current = EMPTY_SEQUENCE;
        return;
      }
      const { next, hit } = matchKeyEvent(sequenceRef.current, event, Date.now(), shortcuts);
      sequenceRef.current = next;
      if (!hit) return;
      // 브라우저 기본 동작(⌘K 주소창 등)을 막는다 — 매칭된 경우에만.
      event.preventDefault();
      onShortcutRef.current(hit);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [role, panelOpen]);
}
