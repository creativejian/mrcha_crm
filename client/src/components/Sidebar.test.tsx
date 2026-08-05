import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// hover prefetch(onMouseEnter)가 실 fetch를 쏘지 않게 차단 — 테스트 관심사는 navigate 배선뿐.
vi.mock("@/lib/consultations", () => ({ prefetchPendingConsultations: vi.fn() }));
vi.mock("@/lib/quote-requests", () => ({ prefetchAppQuoteRequests: vi.fn() }));

import { Sidebar } from "./Sidebar";

const baseProps = {
  activeView: "customers",
  collapsed: false,
  customerMode: "all" as const,
  financeMode: "stats" as const,
  roleTab: "최고관리자" as const,
  onCustomerModeChange: vi.fn(),
  onFinanceModeChange: vi.fn(),
};

// 상담사 배정 서브메뉴 배선 잠금(2026-07-20) — "실시간 상담 요청"은 전용 화면이 아니라 실시간
// 상담 콘솔(chat)로 리라우트한다(유슨생 결정 ① — 대기 큐가 이미 그 콘솔에 있어 전용 화면은 중복,
// 출고 관리 알림 리라우트와 같은 패턴). 스텁(하이라이트만·화면 무변화) 시절로의 회귀를 잠근다.
describe("Sidebar 상담사 배정 서브메뉴", () => {
  it("실시간 상담 요청 클릭 → 실시간 상담 콘솔(chat)로 리라우트", async () => {
    const onViewChange = vi.fn();
    render(<Sidebar {...baseProps} onViewChange={onViewChange} />);
    await userEvent.click(screen.getByRole("button", { name: "실시간 상담 요청" }));
    expect(onViewChange).toHaveBeenCalledWith("chat");
  });

  it("상담 신청 DB 클릭 → 상담신청 인박스(consultation-requests) — #274 기존 배선 잠금", async () => {
    const onViewChange = vi.fn();
    render(<Sidebar {...baseProps} onViewChange={onViewChange} />);
    await userEvent.click(screen.getByRole("button", { name: "상담 신청 DB" }));
    expect(onViewChange).toHaveBeenCalledWith("consultation-requests");
  });
});

// 인박스 진입점 role 게이트(2026-07-21 유슨생 결정 — pending 항목 16): 인박스 2종(앱 견적요청·
// 상담 신청 DB)은 admin·manager 전용. 서버 403이 진짜 게이트고 메뉴 숨김은 UX 보조지만,
// 진입점이 보이면 staff가 눌러 403/홈 폴백을 겪으므로 노출 자체를 잠근다.
describe("Sidebar 인박스 진입점 role 게이트", () => {
  it("상담사 — 앱 견적요청 메뉴 미노출", () => {
    render(<Sidebar {...baseProps} roleTab="상담사" onViewChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "앱 견적요청" })).toBeNull();
  });

  it("상담사 — 상담사 배정 그룹(상담 신청 DB 포함) 미노출(기존 canViewTeamMenu 게이트 잠금)", () => {
    render(<Sidebar {...baseProps} roleTab="상담사" onViewChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "상담사 배정" })).toBeNull();
  });

  it("최고관리자·팀장 — 앱 견적요청 메뉴 노출", () => {
    const { unmount } = render(<Sidebar {...baseProps} roleTab="최고관리자" onViewChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "앱 견적요청" })).toBeTruthy();
    unmount();
    render(<Sidebar {...baseProps} roleTab="팀장" onViewChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "앱 견적요청" })).toBeTruthy();
  });
});

// MC 마스터 진입점 role 게이트 — admin은 관리 구역(배지 포함), 팀장은 PR3(제안 축 개방)로
// 팀 구역에 배지 없는 항목이 생겼다(배지 = 승인 대기 건수 = admin의 일감 — App 폴링도 admin 전용).
describe("Sidebar MC 마스터 메뉴 role 게이트 + 승인 대기 배지", () => {
  it("최고관리자 — MC 마스터 항목 노출 + 승인 대기 배지(3) 표시", () => {
    render(<Sidebar {...baseProps} roleTab="최고관리자" pendingChangeRequestCount={3} onViewChange={vi.fn()} />);
    const button = screen.getByRole("button", { name: "MC 마스터" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("3");
  });

  it("팀장 — MC 마스터 항목 노출(PR3 제안 진입점) · 승인 대기 배지는 없음", () => {
    render(<Sidebar {...baseProps} roleTab="팀장" pendingChangeRequestCount={3} onViewChange={vi.fn()} />);
    const button = screen.getByRole("button", { name: "MC 마스터" });
    expect(button).toBeInTheDocument();
    expect(button.textContent).not.toContain("3");
  });

  // 고유번호 미부여(파랑)도 같은 자리에 붙는다(2026-08-05) — 브랜드·모델 목록과 같은 순서 규칙.
  it("고유번호 미부여(파랑)를 승인 대기(빨강) 뒤에 표시한다", () => {
    const { container } = render(
      <Sidebar {...baseProps} roleTab="최고관리자" pendingChangeRequestCount={3} mcCodeGapCount={148} onViewChange={vi.fn()} />,
    );
    const button = screen.getByRole("button", { name: "MC 마스터" });
    expect(button).toHaveTextContent("148");
    const badges = [...container.querySelectorAll(".nav-count, .nav-gap-count")];
    expect(badges.map((b) => b.className.split(" ")[0])).toEqual(["nav-count", "nav-gap-count"]);
  });

  it("미부여 0이면 파란 배지를 그리지 않는다", () => {
    render(<Sidebar {...baseProps} roleTab="최고관리자" pendingChangeRequestCount={3} mcCodeGapCount={0} onViewChange={vi.fn()} />);
    expect(screen.queryByLabelText(/고유번호 미부여/)).toBeNull();
  });
});
