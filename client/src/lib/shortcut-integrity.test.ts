import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SHORTCUTS } from "@/lib/keyboard-shortcuts";
import type { RoleTab } from "@/data/roles";

// 단축키 레지스트리 무결성 tripwire(2026-08-08).
// 배경: 08-08 하루에 라벨·목적지 불일치가 **세 번** 났다 — ①`G A`/`G I`가 같은 경로 ②"실시간 상담
// 요청"이 리라우트 진입점이라 자기 키가 없음 ③`G O`가 사이드바 스텁과 다른 곳으로 감. 셋 다
// **에러 없이 조용히** 어긋났고(힌트는 null을 반환할 뿐이다) 기존 파리티는 라벨만 봐서 못 잡았다.
//
// ⚠️ 정규식을 좁혀 회피하지 말 것. 새 소비처가 생기면 SOURCES에 추가한다.

const ALL_ROLES: RoleTab[] = ["최고관리자", "팀장", "상담사", "딜러"];

/** 어느 role에서든 레지스트리가 내놓을 수 있는 라벨 전체. */
const KNOWN_LABELS = new Set(ALL_ROLES.flatMap((role) => SHORTCUTS.map((shortcut) => shortcut.label(role))));

const SOURCES = ["client/src/components/Topbar.tsx", "client/src/components/Sidebar.tsx"];

describe("단축키 라벨 리터럴 드리프트", () => {
  // 소비처가 라벨을 문자열로 들고 조회한다(shortcutKeysForLabel). 레지스트리에서 라벨을 바꾸면
  // 조회가 null을 반환해 **힌트가 조용히 사라진다** — 에러도 테스트 실패도 없다. 그 공백을 막는다.
  it.each(SOURCES)("%s의 라벨 리터럴이 전부 레지스트리에 있다", (path) => {
    const source = readFileSync(path, "utf8");
    const literals = [...source.matchAll(/shortcutKeysForLabel\(\s*"([^"]+)"/g)].map((match) => match[1]);
    const unknown = literals.filter((label) => !KNOWN_LABELS.has(label));
    expect(unknown).toEqual([]);
  });

  // 템플릿 조회(`고객 관리 · ${label}`)는 위 정규식으로 못 잡는다 — 접두가 실재하는지만 확인한다.
  // 접두가 사라지면 그 서브탭 전체가 조용히 힌트를 잃는다.
  it("서브탭 접두(부모 · 자식)가 레지스트리에 실재한다", () => {
    const prefixes = [...KNOWN_LABELS].filter((label) => label.includes(" · ")).map((label) => label.split(" · ")[0]);
    expect(new Set(prefixes)).toEqual(new Set(["고객 관리", "상담사 배정"]));
  });
});

describe("단축키 목적지 무결성", () => {
  // 🔴 오늘 실제로 난 결함의 그물 — G A와 G I가 같은 /consultation-requests로 갔다.
  // 같은 목적지에 키가 둘이면 사용자는 어느 쪽이 "맞는" 키인지 알 수 없고, 패널에도 두 줄이 뜬다.
  it("같은 목적지에 키가 둘 이상 붙지 않는다", () => {
    const byPath = new Map<string, string[]>();
    for (const shortcut of SHORTCUTS) {
      if (!shortcut.path) continue;
      byPath.set(shortcut.path, [...(byPath.get(shortcut.path) ?? []), shortcut.id]);
    }
    const duplicated = [...byPath.entries()].filter(([, ids]) => ids.length > 1);
    expect(duplicated).toEqual([]);
  });

  // 경로가 App 라우팅에 실재하는지(스펙 §5의 "경로 유효성"). 오타 하나면 홈으로 폴백되는데
  // 화면에는 아무 오류도 안 뜬다.
  it("모든 목적지가 App 라우팅에 실재한다", () => {
    const app = readFileSync("client/src/App.tsx", "utf8");
    const known = new Set([...app.matchAll(/"(\/[a-z-]*)"/g)].map((match) => match[1]));
    const missing = SHORTCUTS.filter((shortcut) => shortcut.path)
      .map((shortcut) => ({ id: shortcut.id, base: shortcut.path!.split("?")[0] }))
      .filter((entry) => !known.has(entry.base));
    expect(missing).toEqual([]);
  });

  // 액션과 목적지는 배타다 — 둘 다 있으면 리스너가 어느 쪽을 실행할지 호출부 순서가 정한다.
  it("항목은 path 또는 action 하나만 갖는다", () => {
    const both = SHORTCUTS.filter((shortcut) => shortcut.path && shortcut.action).map((shortcut) => shortcut.id);
    const neither = SHORTCUTS.filter((shortcut) => !shortcut.path && !shortcut.action).map((shortcut) => shortcut.id);
    expect({ both, neither }).toEqual({ both: [], neither: [] });
  });
});
