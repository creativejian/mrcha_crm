import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initialCustomers } from "@/data/customers";
import { CustomerActionsCell } from "./CustomerManagementRow";

function renderCell(aiSummary: string) {
  const customer = { ...initialCustomers[0], aiSummary };
  render(
    <table>
      <tbody>
        <tr>
          <CustomerActionsCell customer={customer} onHintHover={() => {}} />
        </tr>
      </tbody>
    </table>,
  );
}

describe("CustomerActionsCell AI 힌트", () => {
  it("ai_summary 없으면 AI 힌트 버튼째 숨긴다(빈 보라 말풍선 방지) — 나머지 액션은 유지", () => {
    renderCell("");
    expect(screen.queryByLabelText("AI 힌트")).toBeNull();
    expect(screen.getByTitle("상담 열기")).toBeTruthy();
  });

  it("ai_summary 있으면 버튼 + 말풍선 strong 렌더", () => {
    renderCell("**X3** 비교 중");
    expect(screen.getByLabelText("AI 힌트")).toBeTruthy();
    const strong = screen.getByText("X3");
    expect(strong.tagName).toBe("STRONG");
  });
});
