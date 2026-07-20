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
