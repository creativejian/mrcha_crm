import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CustomerManagementPage } from "./CustomerManagementPage";

describe("CustomerManagementPage", () => {
  it("renders the all-customer list with the confirmed first-pass columns", () => {
    render(<CustomerManagementPage mode="all" />);

    expect(screen.getByRole("columnheader", { name: "고객" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "단계" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "담당" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "차량 / 방식" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "유입 / 상담" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "다음 액션" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "AI 요약" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "가능성" })).toBeInTheDocument();
  });

  it("filters rows by search keyword", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);

    await user.type(screen.getByPlaceholderText("고객명, 차량, 연락처 검색"), "BMW X3");

    expect(screen.getByText("김민준")).toBeInTheDocument();
    expect(screen.queryByText("박서연")).not.toBeInTheDocument();
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
});
