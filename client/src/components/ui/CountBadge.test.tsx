// 카운트 배지 SSOT 계약(2026-08-05). "0이면 안 그린다"가 7곳에 복제돼 있던 것을 여기로 모았다 —
// 한 곳이라도 그 규칙을 어기면 모든 항목에 "0"이 붙어 배지가 신호 구실을 못 한다.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CountBadge } from "./CountBadge";

describe("CountBadge", () => {
  it("0이면 그리지 않는다 — 모든 항목에 0이 붙으면 신호가 죽는다", () => {
    const { container } = render(<CountBadge count={0} tone="pending" label="승인 대기 0건" />);
    expect(container.querySelector(".count-badge")).toBeNull();
  });

  it("음수도 그리지 않는다 — 집계 실패가 화면에 새는 것을 막는다", () => {
    const { container } = render(<CountBadge count={-1} tone="gap" label="미부여 -1건" />);
    expect(container.querySelector(".count-badge")).toBeNull();
  });

  it("tone이 색 축을 정한다 — pending(결재할 것) / gap(마무리할 것)", () => {
    const { container } = render(
      <>
        <CountBadge count={2} tone="pending" label="승인 대기 2건" />
        <CountBadge count={7} tone="gap" label="고유번호 미부여 7건" />
      </>,
    );
    const badges = [...container.querySelectorAll(".count-badge")];
    expect(badges.map((b) => (b.classList.contains("tone-pending") ? "pending" : "gap"))).toEqual(["pending", "gap"]);
  });

  it("숫자만으로는 무엇의 개수인지 알 수 없다 — label을 접근성 이름으로 싣는다", () => {
    render(<CountBadge count={148} tone="gap" label="고유번호 미부여 148건" />);
    expect(screen.getByLabelText("고유번호 미부여 148건")).toHaveTextContent("148");
  });
});
