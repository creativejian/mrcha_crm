import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KeyboardShortcutsPanel } from "@/components/KeyboardShortcutsPanel";

// role 스코프가 레지스트리에서 **화면까지** 도달하는지 — 판정만 맞고 UI가 전량을 그리면 의미가 없다.

function rows(): string[] {
  return screen.getAllByRole("dialog").flatMap((dialog) =>
    within(dialog)
      .getAllByText(/./, { selector: ".shortcuts-row span" })
      .map((node) => node.textContent ?? ""),
  );
}

describe("KeyboardShortcutsPanel", () => {
  it("딜러에게는 4건만 보인다", () => {
    render(<KeyboardShortcutsPanel onClose={() => {}} role="딜러" />);
    expect(rows()).toEqual(["단축키 목록", "사이드바 접기/펴기", "프로필 · 설정", "할인 업데이트"]);
  });

  // 설정 그룹은 계정 팝오버 블록과 같은 조건(admin) — 팀장 패널에도 그 섹션이 없다.
  it("설정 섹션은 admin에게만 뜬다", () => {
    const { unmount } = render(<KeyboardShortcutsPanel onClose={() => {}} role="최고관리자" />);
    expect(screen.getByText("설정")).toBeInTheDocument();
    expect(rows()).toContain("조직 / 구성원");
    unmount();

    render(<KeyboardShortcutsPanel onClose={() => {}} role="팀장" />);
    expect(screen.queryByText("설정")).not.toBeInTheDocument();
    expect(rows()).not.toContain("조직 / 구성원");
  });

  it("관리자에게는 관리자 전용 화면이 보인다", () => {
    render(<KeyboardShortcutsPanel onClose={() => {}} role="최고관리자" />);
    expect(rows()).toContain("경영 리포트");
    expect(rows()).toContain("MC 마스터"); // 딜러의 "할인 업데이트"와 같은 화면, 다른 이름
  });

  it("상담사에게는 관리자·팀 전용이 안 보인다", () => {
    render(<KeyboardShortcutsPanel onClose={() => {}} role="상담사" />);
    expect(rows()).toContain("고객 관리 · 전체 보기");
    expect(rows()).not.toContain("경영 리포트");
    expect(rows()).not.toContain("앱 견적요청");
  });

  it("검색으로 걸러진다", () => {
    render(<KeyboardShortcutsPanel onClose={() => {}} role="최고관리자" />);
    fireEvent.change(screen.getByLabelText("단축키 검색"), { target: { value: "정산" } });
    expect(rows()).toEqual(["고객 관리 · 출고 정산"]);
  });

  it("일치가 없으면 빈 상태 문구", () => {
    render(<KeyboardShortcutsPanel onClose={() => {}} role="최고관리자" />);
    fireEvent.change(screen.getByLabelText("단축키 검색"), { target: { value: "존재하지않는것" } });
    expect(screen.getByText("일치하는 단축키가 없습니다.")).toBeInTheDocument();
  });

  // 시퀀스는 배지·연결어로 쪼개 그린다(G / then / C) — 단일 문자열이 아니다.
  it("키 표기를 함께 보여준다", () => {
    render(<KeyboardShortcutsPanel onClose={() => {}} role="최고관리자" />);
    const row = screen.getByText("고객 관리 · 전체 보기").closest<HTMLElement>(".shortcuts-row")!;
    expect(within(row).getByText("G")).toBeInTheDocument();
    expect(within(row).getByText("then")).toBeInTheDocument();
    expect(within(row).getByText("C")).toBeInTheDocument();
    // 단발 조합은 토큰이 하나라 그대로 한 배지다.
    expect(screen.getByText("⌘K")).toBeInTheDocument();
    expect(screen.getByText("⇧?")).toBeInTheDocument();
  });

  // 표기가 쪼개져도 검색은 문자열 소스(shortcutKeyLabel)를 보므로 "G then"으로 찾을 수 있다.
  it("키 표기로도 검색된다", () => {
    render(<KeyboardShortcutsPanel onClose={() => {}} role="최고관리자" />);
    fireEvent.change(screen.getByLabelText("단축키 검색"), { target: { value: "⌘K" } });
    expect(rows()).toEqual(["고객 통합 검색"]);
  });

  it("닫기 버튼", () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsPanel onClose={onClose} role="최고관리자" />);
    fireEvent.click(screen.getByLabelText("닫기"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
