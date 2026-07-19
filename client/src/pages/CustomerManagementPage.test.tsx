import { fireEvent, render, screen, within } from "@testing-library/react";
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
    },
  );

  // 뷰 select 3개(담당자별/상담상태별/긴급순)는 renderConsoleFilter로 흡수돼 pill(button)이 된다.
  // delivery는 출고 단계 필터 pill로 대체(Task 6) — "출고 관리(delivery) 콘솔" describe에서 별도 검증.
  it.each(["consulting", "contract", "settlement", "hold"] as const)(
    "renders the mock view-select pills for %s mode",
    (mode) => {
      render(<CustomerManagementPage mode={mode} />);
      expect(screen.getByRole("button", { name: /담당자별 보기/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /상담상태별 보기/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /긴급순으로 보기/ })).toBeInTheDocument();
    },
  );

  // 상담필요(consulting) = 미배정 고객 업무함(2026-07-16 확정). 담당자가 배정된 고객은
  // 계약 전 단계여도 이 목록에 들어오지 않는다 — 배정되면 담당자 관리 흐름으로 넘어간다.
  it("keeps only unassigned customers in consulting mode", () => {
    render(<CustomerManagementPage mode="consulting" />);

    // mock에서 계약 전 단계 & 미배정은 김민준(견적)뿐.
    expect(screen.getByText("김민준")).toBeInTheDocument();
    // 배정된 계약 전 고객은 제외: 문태호(신규·김지안), 오세린(상담중·이주선), 박서연(견적·이주선).
    expect(screen.queryByText("문태호")).not.toBeInTheDocument();
    expect(screen.queryByText("오세린")).not.toBeInTheDocument();
    expect(screen.queryByText("박서연")).not.toBeInTheDocument();
  });

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

  // 추가 연락처(phoneSecondary)는 검색에 포함된다(2026-07-17 결정 — plan T5).
  // 하이픈 포맷 질의 케이스 — 배치 9 A#1 정규화 후에도 포맷 질의가 계속 매칭됨을 잠근다(연속 숫자는 아래 테스트).
  it("finds a customer by the hyphen-formatted secondary phone", async () => {
    const user = userEvent.setup();
    const [first, second] = initialCustomers;
    render(
      <CustomerManagementPage
        customers={[
          { ...first, name: "추가연락처보유", phone: "010-1111-2222", phoneSecondary: "010-1233-4444" },
          { ...second, name: "추가연락처없음", phone: "010-3333-5555", phoneSecondary: undefined },
        ]}
        mode="all"
      />,
    );

    await user.type(screen.getByPlaceholderText("고객명, 연락처, 차종 검색"), "1233-4444");

    expect(screen.getByText("추가연락처보유")).toBeInTheDocument();
    expect(screen.queryByText("추가연락처없음")).not.toBeInTheDocument();
  });

  // 배치 9 A#1: 목록 검색도 통합검색(normalizeSearchValue)과 같은 정규화 — 연속 숫자 질의가
  // 하이픈 포맷 phone에 매칭돼야 상단 통합검색과 같은 질의에 같은 결과를 낸다(#281 표면 간 드리프트 해소).
  it("finds a customer by contiguous digits against the hyphen-formatted phone", async () => {
    const user = userEvent.setup();
    const [first, second] = initialCustomers;
    render(
      <CustomerManagementPage
        customers={[
          { ...first, name: "연속숫자매칭", phone: "010-9588-0812", phoneSecondary: undefined },
          { ...second, name: "연속숫자무관", phone: "010-3333-5555", phoneSecondary: undefined },
        ]}
        mode="all"
      />,
    );

    await user.type(screen.getByPlaceholderText("고객명, 연락처, 차종 검색"), "95880812");

    expect(screen.getByText("연속숫자매칭")).toBeInTheDocument();
    expect(screen.queryByText("연속숫자무관")).not.toBeInTheDocument();
  });

  // 목록 병기(주 · 추가)는 값이 있는 항목만 잇는다 — 주 번호 공란 + 추가 연락처만 있으면
  // 선행 " · " 없이 추가 연락처만 표시(배치 8 C#9).
  it("omits the separator when only the secondary phone exists", () => {
    const [first] = initialCustomers;
    render(
      <CustomerManagementPage
        customers={[{ ...first, phone: "", phoneSecondary: "010-9876-5432" }]}
        mode="all"
      />,
    );

    expect(document.querySelector(".customer-phone")?.textContent).toBe("010-9876-5432");
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

  it("does not fabricate a 정상 관리 상태 badge when saving the (unpersisted) 상담 메모", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" onOpenCustomer={vi.fn()} />);

    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    // 저장 전: 김민준은 lastActivityAt·수동 관리 상태가 없어 관리 상태 배지가 공백이다.
    expect(within(row).getByLabelText("최종 업데이트 없음")).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "김민준 상담 메모 수정" }));
    const input = within(row).getByRole("textbox", { name: "김민준 상담 메모 수정" });
    await user.clear(input);
    await user.type(input, "재고 확인 후 카톡 안내");
    await user.click(within(row).getByRole("button", { name: "상담 메모 저장" }));

    // 상담 메모는 서버에 저장되지 않으므로(프로토타입 전용), 저장이 관리 상태 배지를
    // "방금 전(정상)"으로 바꿔선 안 된다. 리로드하면 사라지는 거짓 배지를 만들던 회귀.
    expect(within(row).queryByLabelText("최종 업데이트: 정상")).not.toBeInTheDocument();
    expect(within(row).getByLabelText("최종 업데이트 없음")).toBeInTheDocument();
  });

  // 배치 6 A#3: chance/finalUpdate 필터 pill은 all mode에만 있다(다른 mode엔 해제 UI 없음).
  // 비-all mode에선 이 필터를 적용하지 않아야 한다 — 잔존 필터가 목록을 조용히 좁히면 "고객이 사라졌다" 혼동.
  it("does not carry the 계약가능성 filter into non-all modes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CustomerManagementPage mode="all" />);

    // "확정"은 계약완료 단계 종속이라 상담중(consulting) 고객은 하나도 매칭되지 않는다.
    await user.click(screen.getByRole("button", { name: /계약 가능성/ }));
    await user.click(within(screen.getByRole("listbox", { name: "계약 가능성 선택" })).getByRole("option", { name: "확정" }));

    rerender(<CustomerManagementPage mode="consulting" />);

    // 구 코드는 "확정" 필터가 consulting에도 적용돼 목록이 비었다(헤더만). 파생 수정 후엔 미적용 → 고객 표시.
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
  });

  // 배치 6 A#1: 비-all mode의 mock 뷰 pill은 열 옵션이 없으므로 확장 가능(aria-expanded) 신호를 주면 안 된다.
  it("does not signal an expandable popover on mock view pills", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="consulting" />);

    const pill = screen.getByRole("button", { name: "담당자별 보기" });
    expect(pill).not.toHaveAttribute("aria-expanded");
    await user.click(pill);
    expect(pill).not.toHaveAttribute("aria-expanded");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
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

// 출고 관리(delivery) 콘솔 1단계 — 계약완료 2차 상태를 출고 단계 작업 큐로 재구성.
// 이 시점(Task 5)은 기본 pill 필터가 아직 없어(Task 6) mode 필터(statusGroup === "계약완료")를
// 통과한 계약완료 3명(최유진 출고완료·한지훈 배정완료·김도현 딜러사계약중)이 전부 노출된다.
describe("출고 관리(delivery) 콘솔", () => {
  it("헤더 = 선택/고객/차량/출고 단계/출고 예정/인도 방식/담당/관리", () => {
    render(<CustomerManagementPage mode="delivery" />);
    const heads = screen.getAllByRole("columnheader").map((th) => th.textContent);
    // index 0(선택) 헤더는 텍스트가 아니라 전체선택 체크박스를 렌더한다(기존 all mode 테스트와 동일 관례).
    expect(heads).toEqual(["", "고객", "차량", "출고 단계", "출고 예정", "인도 방식", "담당", "관리"]);
  });

  it("출고 단계 셀 = 2차 상태 버튼(1차 버튼 없음), 팝오버 옵션 = 계약완료 2차 5종", async () => {
    render(<CustomerManagementPage mode="delivery" />);
    const stageButton = screen.getByRole("button", { name: "진행 2단계 변경: 배정완료" });
    expect(screen.queryByRole("button", { name: "진행 1단계 변경: 계약완료" })).toBeNull();
    fireEvent.click(stageButton);
    const listbox = screen.getByRole("listbox", { name: "진행 2단계 선택" });
    const options = within(listbox).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["딜러사계약중", "대리점발주중", "특판발주중", "배정완료", "출고완료"]);
  });

  it("기본 pill = 진행 중: 출고완료(최유진) 미노출, 배정완료(한지훈) 노출", () => {
    render(<CustomerManagementPage mode="delivery" />);
    expect(screen.getByText("한지훈")).toBeInTheDocument();
    expect(screen.queryByText("최유진")).toBeNull();
  });

  it("출고완료 pill 클릭 시 출고완료만 노출 + 카운트 라벨 전환", () => {
    render(<CustomerManagementPage mode="delivery" />);
    fireEvent.click(screen.getByRole("button", { name: /^출고완료 \d+$/ }));
    expect(screen.getByText("최유진")).toBeInTheDocument();
    expect(screen.queryByText("한지훈")).toBeNull();
    expect(screen.getByText("출고완료", { selector: ".total-count" })).toBeInTheDocument();
  });

  it("delivery mode에선 mock 뷰 select 3개가 렌더되지 않는다", () => {
    render(<CustomerManagementPage mode="delivery" />);
    expect(screen.queryByRole("button", { name: /담당자별 보기/ })).toBeNull();
  });
});
