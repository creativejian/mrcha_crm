import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OptionPicker } from "./OptionPicker";

const options = [
  { id: 1, type: "basic" as const, name: "컨비니언스 패키지", price: 800000 },
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

  it("basic도 체크 가능하고 합산에 포함", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OptionPicker options={options} relations={[]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /옵션/ }));
    await user.click(screen.getByRole("checkbox", { name: /컨비니언스 패키지/ }));
    expect(onChange).toHaveBeenCalledWith({ selectedIds: [1], total: 800000 });
  });

  it("excludes 옵션 선택 시 배타 상대가 비활성화", async () => {
    const user = userEvent.setup();
    render(
      <OptionPicker options={options} relations={[{ id: 1, optionId: 2, relatedOptionId: 3, type: "excludes" }]} />,
    );
    await user.click(screen.getByRole("button", { name: /옵션/ }));
    await user.click(screen.getByRole("checkbox", { name: /선루프/ })); // 2 on
    expect(screen.getByRole("checkbox", { name: /고급 시트/ })).toBeDisabled(); // 3 비활성화
  });

  it("배타 옵션에 중복 선택 불가 설명을 표시", async () => {
    const user = userEvent.setup();
    render(
      <OptionPicker options={options} relations={[{ id: 1, optionId: 2, relatedOptionId: 3, type: "excludes" }]} />,
    );
    await user.click(screen.getByRole("button", { name: /옵션/ }));
    expect(screen.getAllByText(/중복 선택 불가/).length).toBeGreaterThan(0);
  });
});
