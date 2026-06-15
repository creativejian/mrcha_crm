import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OptionPicker } from "./OptionPicker";

const options = [
  { id: 1, type: "basic" as const, name: "기본 사양 A", price: null },
  { id: 2, type: "tuning" as const, name: "선루프", price: 1500000 },
  { id: 3, type: "tuning" as const, name: "고급 시트", price: 2000000 },
];

describe("OptionPicker", () => {
  it("tuning 체크 시 onChange로 total 통지", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OptionPicker options={options} relations={[]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /옵션/ }));
    await user.click(screen.getByRole("checkbox", { name: /선루프/ }));
    expect(onChange).toHaveBeenCalledWith({ selectedIds: [2], total: 1500000 });
  });

  it("basic은 읽기전용 표시(체크박스 아님)", async () => {
    const user = userEvent.setup();
    render(<OptionPicker options={options} relations={[]} />);
    await user.click(screen.getByRole("button", { name: /옵션/ }));
    expect(screen.getByText("기본 사양 A")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /기본 사양 A/ })).toBeNull();
  });

  it("excludes 토글 시 상대 자동 해제", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <OptionPicker
        options={options}
        relations={[{ id: 1, optionId: 2, relatedOptionId: 3, type: "excludes" }]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /옵션/ }));
    await user.click(screen.getByRole("checkbox", { name: /고급 시트/ })); // 3 on
    await user.click(screen.getByRole("checkbox", { name: /선루프/ })); // 2 on → 3 해제
    expect(onChange).toHaveBeenLastCalledWith({ selectedIds: [2], total: 1500000 });
  });
});
