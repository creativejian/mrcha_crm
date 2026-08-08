import { useMemo, useRef, useState } from "react";

import type { RoleTab } from "@/data/roles";
import { usePopoverDismiss } from "@/lib/usePopoverDismiss";
import { shortcutKeyLabel, visibleShortcuts, type Shortcut } from "@/lib/keyboard-shortcuts";

// 단축키 목록 패널 — Supabase 대시보드의 Keyboard shortcuts 미러(2026-08-08 유슨생 요청).
// 목록은 role 스코프를 그대로 따른다: 사이드바에 없는 메뉴는 여기에도 없다(nav-visibility 공유).
// 1차 범위는 **목록·검색만**이다(스펙 §6) — 항목 클릭으로 실행하는 건 후속.

const GROUP_TITLE: Record<Shortcut["group"], string> = {
  global: "전역 액션",
  navigation: "화면 이동",
};

export function KeyboardShortcutsPanel({ role, onClose }: { role: RoleTab; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");

  usePopoverDismiss(panelRef, true, onClose);

  const groups = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const matched = visibleShortcuts(role).filter((shortcut) => {
      if (!keyword) return true;
      return `${shortcut.label(role)} ${shortcutKeyLabel(shortcut)}`.toLowerCase().includes(keyword);
    });
    return (["global", "navigation"] as const)
      .map((group) => ({ group, items: matched.filter((shortcut) => shortcut.group === group) }))
      .filter((entry) => entry.items.length > 0);
  }, [role, query]);

  return (
    <div className="shortcuts-backdrop">
      <div className="shortcuts-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="키보드 단축키">
        <header>
          <strong>키보드 단축키</strong>
          <button aria-label="닫기" className="icon-btn" onClick={onClose} type="button">
            ✕
          </button>
        </header>

        <input
          aria-label="단축키 검색"
          autoFocus
          className="shortcuts-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="단축키 검색…"
          value={query}
        />

        <div className="shortcuts-body">
          {groups.map(({ group, items }) => (
            <section key={group}>
              <h3>{GROUP_TITLE[group]}</h3>
              {items.map((shortcut) => (
                <div className="shortcuts-row" key={shortcut.id}>
                  <span>{shortcut.label(role)}</span>
                  <kbd>{shortcutKeyLabel(shortcut)}</kbd>
                </div>
              ))}
            </section>
          ))}
          {groups.length === 0 && <p className="shortcuts-empty">일치하는 단축키가 없습니다.</p>}
        </div>
      </div>
    </div>
  );
}
