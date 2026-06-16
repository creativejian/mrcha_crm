import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ColorPicker } from "./ColorPicker";

const colors = [
  { id: 1, colorType: "exterior" as const, name: "폴라 화이트 (149U)", code: "C11", hexValue: "#ffffff", sortOrder: 1 },
  { id: 2, colorType: "exterior" as const, name: "옵시디안 블랙 (197U)", code: "C13", hexValue: "#0c0c0c", sortOrder: 0 },
  { id: 3, colorType: "interior" as const, name: "블랙 투톤", code: "I1", hexValue: "#000000", sortOrder: 0 },
];

describe("ColorPicker", () => {
  it("colorType으로 필터하고 색상 클릭 시 onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorPicker colorType="exterior" colors={colors} value={null} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /외장/ }));
    expect(screen.queryByText("블랙 투톤")).toBeNull(); // 내장은 안 보임
    await user.click(screen.getByText("옵시디안 블랙 (197U)"));
    expect(onChange).toHaveBeenCalledWith(colors[1]);
  });

  it("value가 있으면 버튼에 색상명 표시", () => {
    render(<ColorPicker colorType="exterior" colors={colors} value={colors[0]} />);
    expect(screen.getByText("폴라 화이트 (149U)")).toBeInTheDocument();
  });

  it("해당 타입 색상이 없으면 버튼 비활성", () => {
    render(<ColorPicker colorType="interior" colors={[colors[0]]} value={null} />);
    expect(screen.getByRole("button", { name: /내장/ })).toBeDisabled();
  });
});
