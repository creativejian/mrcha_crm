import { describe, expect, it } from "vitest";

import type { RoleTab } from "@/data/roles";
import { SHORTCUTS, shortcutKeyLabel, visibleShortcuts } from "@/lib/keyboard-shortcuts";

// 배정표 SSOT = ref/specs/2026-08-08-crm-keyboard-shortcuts-design.md §2.
// role별 노출은 **id 집합**으로 잠근다 — 개수만 세면 항목이 교체돼도 통과한다.

function ids(role: RoleTab): string[] {
  return visibleShortcuts(role).map((s) => s.id);
}

describe("keyboard-shortcuts 레지스트리", () => {
  it("id는 전역 고유", () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
  });

  // 딜러 = 외부 사용자. 상단바 내부 도구 5종이 미표시고(2026-08-02), 사이드바 메뉴 4개 중
  // 목적지가 있는 건 "할인 업데이트" 하나뿐이다(나머지 3개는 화면 자체가 없어 disabled).
  it("딜러는 패널·사이드바·할인 업데이트 3건뿐", () => {
    expect(ids("딜러")).toEqual(["shortcuts-panel", "toggle-sidebar", "nav-mc-master"]);
  });

  it("상담사는 관리자·팀 전용 항목을 못 본다", () => {
    const staff = ids("상담사");
    expect(staff).toContain("nav-customers-all");
    expect(staff).not.toContain("nav-admin-dashboard"); // admin 전용
    expect(staff).not.toContain("nav-app-requests"); // team 전용
  });

  it("팀장은 팀 항목까지, 관리자 전용은 제외", () => {
    const manager = ids("팀장");
    expect(manager).toContain("nav-app-requests");
    expect(manager).toContain("nav-mc-master");
    expect(manager).not.toContain("nav-admin-dashboard");
    expect(manager).not.toContain("nav-finance");
  });

  it("최고관리자는 전량", () => {
    expect(ids("최고관리자")).toEqual(SHORTCUTS.map((s) => s.id));
  });

  // 노출 규모 회귀 — 집합 단언을 통과시키면서 항목을 통째로 빠뜨리는 변이를 잡는다.
  it("role별 노출 수", () => {
    expect(ids("딜러")).toHaveLength(3);
    expect(ids("상담사")).toHaveLength(15);
    expect(ids("팀장")).toHaveLength(20);
    expect(ids("최고관리자")).toHaveLength(22);
  });

  // 같은 /mc-master인데 딜러 포털에서는 "할인 업데이트"로 부른다(dealerMenuItems).
  it("G M 라벨은 role에 따라 다르다", () => {
    const mc = SHORTCUTS.find((s) => s.id === "nav-mc-master")!;
    expect(mc.label("최고관리자")).toBe("MC 마스터");
    expect(mc.label("딜러")).toBe("할인 업데이트");
  });

  it("고객 관리 서브탭은 최상위 시퀀스로 목적지까지 간다", () => {
    const hold = SHORTCUTS.find((s) => s.id === "nav-customers-hold")!;
    expect(hold.keys).toEqual(["KeyG", "KeyB"]);
    expect(hold.path).toBe("/customers?view=hold");
  });

  // H는 대시보드(Supabase 관례) — 보류/이탈은 B다. 초안에서 실제로 충돌했던 자리.
  it("KeyH는 대시보드", () => {
    const byKeys = SHORTCUTS.filter((s) => s.keys[0] === "KeyG" && s.keys[1] === "KeyH");
    expect(byKeys.map((s) => s.path)).toEqual(["/"]);
  });

  it("시퀀스 조합에 중복이 없다", () => {
    const combos = SHORTCUTS.map((s) => s.keys.join("+"));
    expect(new Set(combos).size).toBe(combos.length);
  });

  it("표기는 ⌘·⇧·then 어휘를 쓴다", () => {
    expect(shortcutKeyLabel(SHORTCUTS.find((s) => s.id === "global-search")!)).toBe("⌘K");
    expect(shortcutKeyLabel(SHORTCUTS.find((s) => s.id === "shortcuts-panel")!)).toBe("⇧?");
    expect(shortcutKeyLabel(SHORTCUTS.find((s) => s.id === "nav-customers-all")!)).toBe("G then C");
  });
});
