import { describe, expect, it } from "vitest";

import type { RoleTab } from "@/data/roles";
import { canViewAdminMenu, canViewTeamMenu, isDealer } from "@/lib/nav-visibility";

// 메뉴 가시성 판정 SSOT — 사이드바(Sidebar.tsx)와 단축키 레지스트리가 **같은 함수**를 쓴다.
// 두 곳이 독자 계산하면 "화면엔 없는데 키로는 열리는" 뒷문이 생긴다(스펙 §3.2).
const ROLES: RoleTab[] = ["최고관리자", "팀장", "상담사", "딜러"];

describe("nav-visibility", () => {
  it("canViewAdminMenu = 최고관리자만", () => {
    expect(ROLES.filter(canViewAdminMenu)).toEqual(["최고관리자"]);
  });

  it("canViewTeamMenu = 최고관리자·팀장", () => {
    expect(ROLES.filter(canViewTeamMenu)).toEqual(["최고관리자", "팀장"]);
  });

  it("isDealer = 딜러만", () => {
    expect(ROLES.filter(isDealer)).toEqual(["딜러"]);
  });

  // 딜러는 팀·관리자 메뉴를 통째로 못 본다 — 외부 사용자라 내부 업무 도구가 미표시다(2026-08-02).
  it("딜러는 팀·관리자 메뉴 어느 쪽도 아니다", () => {
    expect(canViewTeamMenu("딜러")).toBe(false);
    expect(canViewAdminMenu("딜러")).toBe(false);
  });
});
