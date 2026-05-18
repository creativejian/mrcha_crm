import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { initialCustomers } from "@/data/customers";
import { CustomerManagementPage } from "./CustomerManagementPage";

describe("CustomerManagementPage", () => {
  it("renders the all-customer list with vehicle context right after the customer", () => {
    render(<CustomerManagementPage mode="all" />);

    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "",
      "고객",
      "차종 · 구매방식",
      "진행 상태",
      "다음 액션",
      "AI 요약",
      "유입 · 상담",
      "담당",
      "계약 가능성",
      "관리",
    ]);
  });

  it("hides the advisor column for advisor and dealer roles", () => {
    const { rerender } = render(<CustomerManagementPage mode="all" roleTab="상담사" />);

    expect(screen.queryByRole("columnheader", { name: "담당" })).not.toBeInTheDocument();

    rerender(<CustomerManagementPage mode="all" roleTab="딜러" />);
    expect(screen.queryByRole("columnheader", { name: "담당" })).not.toBeInTheDocument();
  });

  it("filters rows by search keyword", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);

    await user.type(screen.getByPlaceholderText("고객명, 차량, 연락처 검색"), "Maybach");

    expect(screen.getByText("김민준")).toBeInTheDocument();
    expect(screen.queryByText("박서연")).not.toBeInTheDocument();
  });

  it("paginates the customer list with 15 rows by default and supports page size changes", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);

    expect(screen.getByText(initialCustomers[0].name)).toBeInTheDocument();
    expect(screen.queryByText(initialCustomers[15].name)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByText(initialCustomers[15].name)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: /페이지당/ }), "30");
    expect(screen.getByText(initialCustomers[0].name)).toBeInTheDocument();
    expect(screen.getByText(initialCustomers[initialCustomers.length - 1].name)).toBeInTheDocument();
  });

  it("opens a customer from row click while keeping row controls independent", async () => {
    const user = userEvent.setup();
    const onOpenCustomer = vi.fn();
    render(<CustomerManagementPage mode="all" onOpenCustomer={onOpenCustomer} />);

    await user.click(screen.getByText("김민준").closest("tr") as HTMLTableRowElement);
    expect(onOpenCustomer).toHaveBeenCalledWith(expect.objectContaining({ name: "김민준" }));

    const row = screen.getByText("박서연").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("checkbox"));
    expect(onOpenCustomer).toHaveBeenCalledTimes(1);
  });

  it("changes a row stage from the stage button without opening the customer", async () => {
    const user = userEvent.setup();
    const onOpenCustomer = vi.fn();
    render(<CustomerManagementPage mode="all" onOpenCustomer={onOpenCustomer} />);

    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "진행 상태 변경: 견적발송" }));
    await user.click(within(screen.getByRole("listbox", { name: "진행 상태 선택" })).getByRole("option", { name: "상담중" }));

    expect(within(row).getByRole("button", { name: "진행 상태 변경: 상담중" })).toBeInTheDocument();
    expect(within(row).getByText("상담 · 오늘 14:20")).toBeInTheDocument();
    expect(within(row).getByText("방식 확정")).toBeInTheDocument();
    expect(onOpenCustomer).not.toHaveBeenCalled();
  });

  it("closes the stage popover from outside click and Escape", async () => {
    const user = userEvent.setup();
    const onOpenCustomer = vi.fn();
    render(<CustomerManagementPage mode="all" onOpenCustomer={onOpenCustomer} />);

    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "진행 상태 변경: 견적발송" }));
    expect(screen.getByRole("listbox", { name: "진행 상태 선택" })).toBeInTheDocument();

    await user.click(screen.getByText("박서연"));
    expect(screen.queryByRole("listbox", { name: "진행 상태 선택" })).not.toBeInTheDocument();
    expect(onOpenCustomer).not.toHaveBeenCalled();

    await user.click(within(row).getByRole("button", { name: "진행 상태 변경: 견적발송" }));
    expect(screen.getByRole("listbox", { name: "진행 상태 선택" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "진행 상태 선택" })).not.toBeInTheDocument();
  });

  it("changes a row chance from the chance button", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);

    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "가능성 변경: 높음" }));
    await user.click(within(screen.getByRole("listbox", { name: "가능성 선택" })).getByRole("option", { name: "보류" }));

    expect(within(row).getByRole("button", { name: "가능성 변경: 보류" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "가능성 선택" })).not.toBeInTheDocument();
  });

  it("closes the chance popover from an outside row click without opening the customer", async () => {
    const user = userEvent.setup();
    const onOpenCustomer = vi.fn();
    render(<CustomerManagementPage mode="all" onOpenCustomer={onOpenCustomer} />);

    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "가능성 변경: 높음" }));
    expect(screen.getByRole("listbox", { name: "가능성 선택" })).toBeInTheDocument();

    await user.click(screen.getByText("박서연"));
    expect(screen.queryByRole("listbox", { name: "가능성 선택" })).not.toBeInTheDocument();
    expect(onOpenCustomer).not.toHaveBeenCalled();
  });
});
