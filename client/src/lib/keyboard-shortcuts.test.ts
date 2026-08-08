import { describe, expect, it } from "vitest";

import type { RoleTab } from "@/data/roles";
import { SHORTCUTS, shortcutKeyLabel, shortcutKeysForAction, shortcutKeysForLabel, visibleShortcuts } from "@/lib/keyboard-shortcuts";

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
  it("딜러는 패널·사이드바·프로필·할인 업데이트 4건뿐", () => {
    expect(ids("딜러")).toEqual(["shortcuts-panel", "toggle-sidebar", "profile", "nav-mc-master"]);
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
    expect(ids("딜러")).toHaveLength(4);
    expect(ids("상담사")).toHaveLength(16);
    expect(ids("팀장")).toHaveLength(19);
    expect(ids("최고관리자")).toHaveLength(27);
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

  // 설정 6종은 계정 팝오버 블록과 같은 조건(isAdminRole)이다 — 팀장에게도 안 보인다.
  it("설정 그룹은 admin 전용", () => {
    expect(ids("팀장").filter((id) => id.startsWith("set-"))).toEqual([]);
    expect(ids("최고관리자").filter((id) => id.startsWith("set-"))).toHaveLength(6);
  });

  // S 접두를 쓴 이유가 이니셜 재사용이다 — G에서 점유된 글자를 그대로 쓴다.
  it("설정은 G에서 점유된 이니셜을 재사용한다", () => {
    const setKeys = SHORTCUTS.filter((s) => s.group === "settings").map((s) => s.keys[1]);
    expect(setKeys).toEqual(["KeyO", "KeyD", "KeyK", "KeyI", "KeyA", "KeyH"]);
  });

  it("프로필 팝오버는 전 role(딜러 포함)", () => {
    expect(shortcutKeysForAction("profile", "딜러")).toBe("O then P");
    expect(shortcutKeysForAction("profile", "상담사")).toBe("O then P");
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

// 사이드바 hover 힌트 조회(2026-08-08) — 메뉴 라벨로 단축키 표기를 찾는다. 파리티 테스트와 같은
// 어휘를 쓴다("고객 관리 · 전체 보기"). 매칭이 실패하면 힌트를 안 그릴 뿐 메뉴는 정상 동작한다.
describe("shortcutKeysForLabel", () => {
  it("최상위 메뉴는 라벨 그대로 찾는다", () => {
    expect(shortcutKeysForLabel("대시보드", "최고관리자")).toBe("G then H");
    expect(shortcutKeysForLabel("경영 리포트", "최고관리자")).toBe("G then R");
  });

  it("고객 관리 서브탭은 부모 · 자식 경로로 찾는다", () => {
    expect(shortcutKeysForLabel("고객 관리 · 보류 / 이탈", "최고관리자")).toBe("G then B");
    expect(shortcutKeysForLabel("고객 관리 · 상담 필요", "상담사")).toBe("G then N");
    // 상담사 배정도 같은 어휘 — 부모는 토글이라 목적지가 서브탭이다.
    expect(shortcutKeysForLabel("상담사 배정 · 상담 신청 DB", "팀장")).toBe("G then A");
  });

  // role 스코프가 힌트에도 걸린다 — 안 보이는 메뉴의 키를 알려주면 안 된다.
  it("노출되지 않는 메뉴는 null", () => {
    expect(shortcutKeysForLabel("경영 리포트", "상담사")).toBeNull();
    expect(shortcutKeysForLabel("앱 견적요청", "상담사")).toBeNull();
  });

  it("딜러는 자기 어휘로 찾는다", () => {
    expect(shortcutKeysForLabel("할인 업데이트", "딜러")).toBe("G then M");
    // 딜러 포털에 "MC 마스터"라는 이름은 없다.
    expect(shortcutKeysForLabel("MC 마스터", "딜러")).toBeNull();
  });

  it("단축키가 없는 메뉴는 null", () => {
    expect(shortcutKeysForLabel("고객 상세", "최고관리자")).toBeNull();
    expect(shortcutKeysForLabel("존재하지 않는 메뉴", "최고관리자")).toBeNull();
  });
});

// Topbar 아이콘 hover 버블용 조회 — 아이콘은 라벨이 아니라 자기 action id를 안다.
describe("shortcutKeysForAction", () => {
  it("전역 액션을 id로 찾는다", () => {
    expect(shortcutKeysForAction("global-search", "최고관리자")).toBe("⌘K");
    expect(shortcutKeysForAction("work-ai", "상담사")).toBe("⌘I");
    expect(shortcutKeysForAction("notifications", "최고관리자")).toBe("O then N");
  });

  // 딜러 상단바에는 내부 도구 5종이 아예 렌더되지 않는다(2026-08-02) — 조회도 null이어야 한다.
  it("딜러에게는 내부 도구 액션이 없다", () => {
    expect(shortcutKeysForAction("global-search", "딜러")).toBeNull();
    expect(shortcutKeysForAction("calculator", "딜러")).toBeNull();
    // 딜러도 갖는 것은 사이드바 토글뿐이다.
    expect(shortcutKeysForAction("toggle-sidebar", "딜러")).toBe("⌘B");
  });

  it("없는 액션은 null", () => {
    expect(shortcutKeysForAction("존재하지않음", "최고관리자")).toBeNull();
  });
});
