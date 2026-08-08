import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/consultations", () => ({ prefetchPendingConsultations: vi.fn() }));
vi.mock("@/lib/quote-requests", () => ({ prefetchAppQuoteRequests: vi.fn() }));

import { Sidebar } from "@/components/Sidebar";
import type { RoleTab } from "@/data/roles";
import { visibleShortcuts } from "@/lib/keyboard-shortcuts";

// 사이드바 메뉴 ↔ 단축키 네비게이션 **양방향** 드리프트 가드(2026-08-08).
// 한쪽만 늘면 잡는다: 메뉴를 추가하고 키를 안 주는 것도, 화면 없는 곳에 키를 주는 것도.
// 두 표면이 nav-visibility SSOT를 공유해도 **목록 자체는 따로**라 이 대조가 필요하다.

const baseProps = {
  activeView: "customers",
  collapsed: false,
  customerMode: "all" as const,
  financeMode: "stats" as const,
  onCustomerModeChange: vi.fn(),
  onFinanceModeChange: vi.fn(),
  onViewChange: vi.fn(),
};

/** 사이드바가 실제로 그리는 메뉴 라벨(비활성 제외 — 목적지 없는 항목은 갈 수 없다). */
function sidebarLabels(role: RoleTab): Set<string> {
  const { unmount } = render(<Sidebar {...baseProps} roleTab={role} />);
  const labels = screen
    .getAllByRole("button")
    .filter((button) => button.hasAttribute("data-label") && !(button as HTMLButtonElement).disabled)
    .map((button) => button.getAttribute("data-label") ?? "");
  unmount();
  return new Set(labels);
}

/** 단축키 네비게이션 라벨 — 고객 관리 서브탭은 부모 메뉴 이름으로 정규화한다. */
function shortcutNavLabels(role: RoleTab): Set<string> {
  return new Set(
    visibleShortcuts(role)
      .filter((shortcut) => shortcut.group === "navigation")
      .map((shortcut) => shortcut.label(role).replace(/ · .*$/, "")),
  );
}

// 의도적 비대칭 — 새로 생기면 테스트가 실패하니 여기 사유와 함께 등록해야 한다.
const SIDEBAR_ONLY = new Set([
  // 대상 고객이 지정돼야 의미가 있는 화면이라 전역 키에 맞지 않다(스펙 §6 범위 밖).
  "고객 상세",
]);
// 단축키에만 있는 화면 — 지금은 없다. 고객 관리·상담사 배정 서브탭은 "부모 · 자식" 어휘를 써서
// 정규화로 부모 메뉴와 매칭된다(예외가 필요 없다는 뜻이고, 생기면 여기 사유와 함께 등록한다).
const SHORTCUT_ONLY = new Set<string>([]);

const ROLES: RoleTab[] = ["최고관리자", "팀장", "상담사", "딜러"];

describe("사이드바 ↔ 단축키 파리티", () => {
  it.each(ROLES)("%s — 단축키에 있는 화면은 사이드바에도 있다", (role) => {
    const missing = [...shortcutNavLabels(role)].filter((label) => !sidebarLabels(role).has(label) && !SHORTCUT_ONLY.has(label));
    expect(missing).toEqual([]);
  });

  it.each(ROLES)("%s — 사이드바에 있는 화면은 단축키에도 있다", (role) => {
    const missing = [...sidebarLabels(role)].filter((label) => !shortcutNavLabels(role).has(label) && !SIDEBAR_ONLY.has(label));
    expect(missing).toEqual([]);
  });

  // 딜러 메뉴 4개 중 3개는 목적지가 없어 disabled다. 양쪽 **모두에서** 빠져야 한다 —
  // 아무 일도 안 일어나는 단축키는 버튼보다 나쁘다(왜 안 되는지 화면에 단서가 없다).
  it("딜러의 미구현 메뉴 3종은 사이드바 활성 목록에도, 단축키에도 없다", () => {
    const sidebar = sidebarLabels("딜러");
    const shortcuts = shortcutNavLabels("딜러");
    for (const label of ["대시보드", "고객 관리", "재고 업로드"]) {
      expect(sidebar.has(label)).toBe(false);
      expect(shortcuts.has(label)).toBe(false);
    }
    expect(shortcuts).toEqual(new Set(["할인 업데이트"]));
  });
});

// hover 힌트 배선(2026-08-08) — data-shortcut 속성이 실제로 붙는지. hover 표시 자체는 CSS라
// 여기서는 "메뉴가 자기 단축키를 들고 있다"만 잠근다.
describe("사이드바 hover 단축키 힌트", () => {
  function hintOf(label: string, props: Partial<typeof baseProps> & { roleTab: RoleTab }): string | null {
    const { unmount } = render(<Sidebar {...baseProps} {...props} />);
    const button = screen.getAllByRole("button").find((node) => node.getAttribute("data-label") === label);
    const hint = button?.getAttribute("data-shortcut") ?? null;
    unmount();
    return hint;
  }

  it("펼친 사이드바의 메뉴는 자기 단축키를 들고 있다", () => {
    expect(hintOf("대시보드", { roleTab: "최고관리자" })).toBe("G then H");
    expect(hintOf("경영 리포트", { roleTab: "최고관리자" })).toBe("G then R");
  });

  // 요구사항: 사이드바가 펼쳐졌을 때만 — 접히면 라벨 자체가 안 보이므로 힌트도 없다.
  it("접힌 사이드바에는 힌트가 없다", () => {
    expect(hintOf("대시보드", { collapsed: true, roleTab: "최고관리자" })).toBeNull();
  });

  it("단축키가 없는 메뉴엔 속성이 없다", () => {
    expect(hintOf("고객 상세", { roleTab: "최고관리자" })).toBeNull();
  });

  it("딜러의 목적지 없는 메뉴엔 힌트가 없고, 할인 업데이트에만 붙는다", () => {
    expect(hintOf("할인 업데이트", { roleTab: "딜러" })).toBe("G then M");
    expect(hintOf("재고 업로드", { roleTab: "딜러" })).toBeNull();
  });

  it("고객 관리 서브탭도 힌트를 갖는다", () => {
    const { unmount } = render(<Sidebar {...baseProps} roleTab="최고관리자" />);
    const hold = screen.getByRole("button", { name: "보류 / 이탈" });
    expect(hold.getAttribute("data-shortcut")).toBe("G then B");
    unmount();
  });
});
