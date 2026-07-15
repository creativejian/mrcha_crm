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
      "계약 가능성",
      "상담 메모 · 문의 사항",
      "접수 · 배정",
      "관리 상태",
      "액션",
    ]);
  });

  it("renders the all-customer console list with the same finished column rhythm", () => {
    render(<CustomerManagementPage mode="all" />);

    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "",
      "고객",
      "차종 · 구매방식",
      "진행 상태",
      "계약 가능성",
      "상담 메모 · 문의 사항",
      "접수 · 배정",
      "관리 상태",
      "액션",
    ]);
  });

  it("hides the advisor column for advisor and dealer roles", () => {
    const { rerender } = render(<CustomerManagementPage mode="all" roleTab="상담사" />);

    expect(screen.queryByRole("columnheader", { name: "담당" })).not.toBeInTheDocument();

    rerender(<CustomerManagementPage mode="all" roleTab="딜러" />);
    expect(screen.queryByRole("columnheader", { name: "담당" })).not.toBeInTheDocument();
  });

  // 5개 비-all mode도 전체 보기와 같은 콘솔 문법(1줄 rail·필터 pill·전체 N명 카운트)을 쓴다.
  // 뷰 select 3개(담당자별/상담상태별/긴급순)는 renderConsoleFilter로 흡수돼 pill(button)이 된다.
  it.each(["consulting", "contract", "delivery", "settlement", "hold"] as const)(
    "renders the console control rail for %s mode",
    (mode) => {
      render(<CustomerManagementPage mode={mode} />);
      // 콘솔 검색 래퍼(구식 <input class="input"> 아님)
      expect(document.querySelector(".customer-console-search")).not.toBeNull();
      // 공통 필터가 pill(button)로 — 구식 네이티브 select 아님
      expect(screen.getByRole("button", { name: /진행 상태 · 1차/ })).toBeInTheDocument();
      // 카운트는 "전체 N명"(구식 "TOTAL N" 아님)
      expect(screen.queryByText("TOTAL")).not.toBeInTheDocument();
      // 뷰 select 3개가 pill(button)로 흡수
      expect(screen.getByRole("button", { name: /담당자별 보기/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /상담상태별 보기/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /긴급순으로 보기/ })).toBeInTheDocument();
    },
  );

  // renderRow fallthrough는 priority 셀(action 컬럼 = 상담 메모/재컨택 성격) → advisor 셀(담당) 순으로 그린다.
  // contract만 헤더/컬럼이 담당 → action으로 뒤집혀 있어 헤더 아래에 다른 데이터가 오던 버그(프로토타입).
  // action 컬럼 라벨이 "담당"보다 앞에 오도록 잠근다(consulting/hold는 회귀 가드).
  it.each([
    ["consulting", "상담 메모"],
    ["contract", "상담 메모"],
    ["hold", "재컨택 액션"],
  ] as const)("puts the action column before 담당 for %s mode (matches renderRow priority→advisor)", (mode, actionLabel) => {
    render(<CustomerManagementPage mode={mode} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers.indexOf(actionLabel)).toBeLessThan(headers.indexOf("담당"));
  });

  // 전 mode의 헤더 th 개수 == 데이터 행 td 개수 정합을 잠근다. delivery는 헤더에 priority(action)
  // 컬럼이 없는데 renderRow fallthrough가 그 셀을 그려 데이터 행이 1칸 많았다(table-layout:fixed에서
  // 마지막 액션 셀이 colgroup 밖으로 밀려 헤더 우측이 잘리던 프로토타입 버그). fallthrough를 공유하는
  // 형제 mode(consulting/contract/hold)까지 함께 잠가 컬럼 정의↔렌더 드리프트를 광범위 방어한다.
  const MODES = ["all", "consulting", "contract", "delivery", "settlement", "hold"] as const;
  it.each(MODES.flatMap((mode) => (["최고관리자", "상담사"] as const).map((roleTab) => [mode, roleTab] as const)))(
    "keeps header and body column counts aligned (%s, %s)",
    (mode, roleTab) => {
      render(<CustomerManagementPage mode={mode} roleTab={roleTab} />);
      const rows = screen.getAllByRole("row");
      if (rows.length < 2) return; // 필터 통과 행 없음 — 헤더만이라 잘림 무관
      const headerCount = screen.getAllByRole("columnheader").length;
      const cellCount = within(rows[1]).getAllByRole("cell").length; // rows[0] = 헤더
      expect(cellCount).toBe(headerCount);
    },
  );

  it("filters rows by search keyword", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);

    await user.type(screen.getByPlaceholderText("고객명, 연락처, 차종 검색"), "Maybach");

    expect(screen.getByText("김민준")).toBeInTheDocument();
    expect(screen.queryByText("박서연")).not.toBeInTheDocument();
  });

  it("keeps console filter controls visually active until they return to their default value", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);

    const primaryStatusFilter = screen.getByRole("button", { name: /진행 상태 · 1차/ });
    await user.click(primaryStatusFilter);
    await user.click(within(screen.getByRole("listbox", { name: "진행 상태 · 1차 선택" })).getByRole("option", { name: "신규" }));

    expect(primaryStatusFilter).toHaveClass("filter-active");

    await user.click(screen.getByRole("button", { name: /담당자/ }));
    expect(primaryStatusFilter).toHaveClass("filter-active");

    await user.click(primaryStatusFilter);
    await user.click(within(screen.getByRole("listbox", { name: "진행 상태 · 1차 선택" })).getByRole("option", { name: "진행 상태 · 1차" }));
    expect(primaryStatusFilter).not.toHaveClass("filter-active");

    const chanceFilter = screen.getByRole("button", { name: /계약 가능성/ });
    await user.click(chanceFilter);
    await user.click(within(screen.getByRole("listbox", { name: "계약 가능성 선택" })).getByRole("option", { name: "높음" }));

    expect(chanceFilter).toHaveClass("filter-active");
  });

  it("paginates the customer list with 15 rows by default and supports page size changes", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);

    expect(screen.getByText(initialCustomers[0].name)).toBeInTheDocument();
    expect(screen.queryByText(initialCustomers[15].name)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByText(initialCustomers[15].name)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "15", expanded: false }));
    await user.click(within(screen.getByRole("listbox", { name: "페이지당 개수 선택" })).getByRole("option", { name: "30" }));
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

    await user.click(within(row).getByText("보증금 0/10/20% 월납입표와 보험 포함 여부 확인"));
    expect(onOpenCustomer).toHaveBeenLastCalledWith(expect.objectContaining({ name: "박서연" }));
    expect(onOpenCustomer).toHaveBeenCalledTimes(2);
  });

  it("reopens a customer by row click after a popover was opened then closed (no stuck suppress ref)", async () => {
    const user = userEvent.setup();
    const onOpenCustomer = vi.fn();
    render(<CustomerManagementPage mode="all" onOpenCustomer={onOpenCustomer} />);

    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    // 1. 진행상태 버튼 클릭 → popover 열림
    await user.click(within(row).getByRole("button", { name: "진행 1단계 변경: 견적" }));
    expect(screen.getByRole("listbox", { name: "진행 1단계 선택" })).toBeInTheDocument();

    // 2. row(고객명) 클릭 → popover 닫기(첫 클릭 소비), 패널은 안 열림
    await user.click(within(row).getByText("김민준"));
    expect(screen.queryByRole("listbox", { name: "진행 1단계 선택" })).not.toBeInTheDocument();
    expect(onOpenCustomer).not.toHaveBeenCalled();

    // 3. row 다시 클릭 → 패널 열려야 함(suppressOutsideClickRef가 stuck되면 영구 차단되던 버그)
    await user.click(within(row).getByText("김민준"));
    expect(onOpenCustomer).toHaveBeenCalledWith(expect.objectContaining({ name: "김민준" }));
  });

  it("changes a two-step row stage without opening the customer", async () => {
    const user = userEvent.setup();
    const onOpenCustomer = vi.fn();
    render(<CustomerManagementPage mode="all" onOpenCustomer={onOpenCustomer} />);

    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "진행 1단계 변경: 견적" }));
    await user.click(within(screen.getByRole("listbox", { name: "진행 1단계 선택" })).getByRole("option", { name: "상담중" }));

    expect(within(row).getByRole("button", { name: "진행 1단계 변경: 상담중" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "진행 2단계 변경: 구매방식상담중" })).toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "진행 2단계 선택" })).toBeInTheDocument();

    await user.click(within(screen.getByRole("listbox", { name: "진행 2단계 선택" })).getByRole("option", { name: "차량상담중" }));

    expect(within(row).getByRole("button", { name: "진행 2단계 변경: 차량상담중" })).toBeInTheDocument();
    expect(within(row).queryByText("견적 · 오늘 14:20")).not.toBeInTheDocument();
    expect(within(row).queryByText("응답 대기")).not.toBeInTheDocument();
    expect(onOpenCustomer).not.toHaveBeenCalled();
  });

  it("closes the stage popover from outside click and Escape", async () => {
    const user = userEvent.setup();
    const onOpenCustomer = vi.fn();
    render(<CustomerManagementPage mode="all" onOpenCustomer={onOpenCustomer} />);

    const row = screen.getByText("최유진").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "진행 1단계 변경: 계약완료" }));
    expect(screen.getByRole("listbox", { name: "진행 1단계 선택" })).toBeInTheDocument();

    await user.click(screen.getByText("박서연"));
    expect(screen.queryByRole("listbox", { name: "진행 1단계 선택" })).not.toBeInTheDocument();
    expect(onOpenCustomer).not.toHaveBeenCalled();

    await user.click(within(row).getByRole("button", { name: "진행 1단계 변경: 계약완료" }));
    expect(screen.getByRole("listbox", { name: "진행 1단계 선택" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "진행 1단계 선택" })).not.toBeInTheDocument();
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

  it("automatically confirms chance when the primary stage becomes contracted", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);

    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    expect(within(row).getByRole("button", { name: "가능성 변경: 높음" })).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "진행 1단계 변경: 견적" }));
    await user.click(within(screen.getByRole("listbox", { name: "진행 1단계 선택" })).getByRole("option", { name: "계약완료" }));

    expect(within(row).getByRole("button", { name: "진행 1단계 변경: 계약완료" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "가능성 변경: 확정" })).toBeInTheDocument();
  });

  it("blocks manual confirmed chance before the primary stage is contracted", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);

    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "가능성 변경: 높음" }));
    await user.click(within(screen.getByRole("listbox", { name: "가능성 선택" })).getByRole("option", { name: "확정" }));

    expect(within(row).getByRole("status")).toHaveTextContent("계약완료 시 자동 확정됩니다");
    expect(within(row).getByRole("button", { name: "가능성 변경: 높음" })).toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "가능성 선택" })).toBeInTheDocument();
  });

  it("switches directly between stage and chance popovers without swallowing the first click", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);

    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "진행 1단계 변경: 견적" }));
    expect(screen.getByRole("listbox", { name: "진행 1단계 선택" })).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "가능성 변경: 높음" }));
    expect(screen.queryByRole("listbox", { name: "진행 1단계 선택" })).not.toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "가능성 선택" })).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "진행 1단계 변경: 견적" }));
    expect(screen.queryByRole("listbox", { name: "가능성 선택" })).not.toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "진행 1단계 선택" })).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "진행 2단계 변경: 발송완료" }));
    expect(screen.queryByRole("listbox", { name: "진행 1단계 선택" })).not.toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "진행 2단계 선택" })).toBeInTheDocument();
  });

  it("edits the next task inline with keyboard and mouse controls", async () => {
    const user = userEvent.setup();
    const onOpenCustomer = vi.fn();
    render(<CustomerManagementPage mode="all" onOpenCustomer={onOpenCustomer} />);

    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "김민준 상담 메모 수정" }));
    const input = within(row).getByRole("textbox", { name: "김민준 상담 메모 수정" });
    await user.clear(input);
    await user.type(input, "GLC 재고 확인 후 고객에게 카톡 발송");
    await user.keyboard("{Enter}");

    expect(within(row).getByText("GLC 재고 확인 후 고객에게 카톡 발송")).toBeInTheDocument();
    expect(onOpenCustomer).not.toHaveBeenCalled();

    await user.click(within(row).getByRole("button", { name: "김민준 상담 메모 수정" }));
    const secondInput = within(row).getByRole("textbox", { name: "김민준 상담 메모 수정" });
    await user.clear(secondInput);
    await user.type(secondInput, "취소될 메모");
    await user.click(within(row).getByRole("button", { name: "상담 메모 수정 취소" }));

    expect(within(row).getByText("GLC 재고 확인 후 고객에게 카톡 발송")).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "김민준 상담 메모 수정" }));
    const thirdInput = within(row).getByRole("textbox", { name: "김민준 상담 메모 수정" });
    await user.clear(thirdInput);
    await user.type(thirdInput, "비교 견적 재송출 후 응답 시간 기록");
    await user.click(within(row).getByRole("button", { name: "상담 메모 비우기" }));
    expect(thirdInput).toHaveValue("");
    await user.type(thirdInput, "비교 견적 재송출 후 응답 시간 기록");
    await user.click(within(row).getByRole("button", { name: "상담 메모 저장" }));

    expect(within(row).getByText("비교 견적 재송출 후 응답 시간 기록")).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "김민준 상담 메모 수정" }));
    const fourthInput = within(row).getByRole("textbox", { name: "김민준 상담 메모 수정" });
    await user.clear(fourthInput);
    await user.type(fourthInput, "외부 클릭 저장 확인");
    await user.click(screen.getByPlaceholderText("고객명, 연락처, 차종 검색"));

    expect(within(row).getByText("외부 클릭 저장 확인")).toBeInTheDocument();
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
