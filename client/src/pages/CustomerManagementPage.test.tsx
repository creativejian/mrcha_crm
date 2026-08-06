import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { initialCustomers } from "@/data/customers";
import { CustomerManagementPage } from "./CustomerManagementPage";

vi.mock("@/lib/customer-children", () => ({
  addSchedule: vi.fn().mockResolvedValue({ id: "sch-new", createdAt: "2026-07-19T00:00:00Z" }),
  updateSchedule: vi.fn().mockResolvedValue(undefined),
  deleteSchedule: vi.fn().mockResolvedValue(undefined),
  saveCustomerDelivery: vi.fn().mockResolvedValue(undefined),
  // 정산(2026-08-03) — 팝오버가 admin일 때 열리자마자 조회한다. 기본 roleTab이 "최고관리자"라
  // 기존 출고 테스트도 이 경로를 탄다(모킹이 없으면 전부 깨진다).
  // ⚠️ **서버 응답 전체 형태로 둔다**(costs·status 포함) — 라우트가 행 없는 고객에도 네 필드를
  // 다 채워 응답하므로(customers.ts `?? { settledAt, feeAmount, costs, status }`), 부분 모킹은
  // 실제로 올 수 없는 페이로드로 테스트를 통과시킨다.
  fetchCustomerSettlement: vi.fn().mockResolvedValue({ settledAt: null, feeAmount: null, costs: [], status: "미정산" }),
  saveCustomerSettlement: vi.fn().mockResolvedValue(undefined),
  requestCustomerSettlement: vi.fn().mockResolvedValue(undefined),
}));

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

  // 담당자 필터도 담당 컬럼과 같은 노출 축 — staff는 목록이 본인 담당만이라(#301 scope) 이 필터가
  // 죽은 컨트롤이고, 옵션으로 전 직원 이름까지 노출됐다(2026-07-21 staff 실기 감사).
  it("hides the advisor filter for advisor and dealer roles (same axis as the column)", () => {
    const { rerender } = render(<CustomerManagementPage mode="all" roleTab="최고관리자" />);
    expect(screen.getByRole("button", { name: /담당자/ })).toBeInTheDocument();

    rerender(<CustomerManagementPage mode="all" roleTab="상담사" />);
    expect(screen.queryByRole("button", { name: /^담당자$/ })).not.toBeInTheDocument();

    rerender(<CustomerManagementPage mode="all" roleTab="딜러" />);
    expect(screen.queryByRole("button", { name: /^담당자$/ })).not.toBeInTheDocument();
  });

  // 5개 비-all mode도 전체 보기와 같은 콘솔 문법(1줄 rail·필터 pill·전체 N명 카운트)을 쓴다.
  it.each(["consulting", "contract", "delivery", "settlement", "hold"] as const)("renders the console control rail for %s mode", (mode) => {
    render(<CustomerManagementPage mode={mode} />);
    // 콘솔 검색 래퍼(구식 <input class="input"> 아님)
    expect(document.querySelector(".customer-console-search")).not.toBeNull();
    // 카운트는 "전체 N명"(구식 "TOTAL N" 아님)
    expect(screen.queryByText("TOTAL")).not.toBeInTheDocument();
  });

  // 공통 진행 상태 1차/2차 필터가 pill(button)로 — 구식 네이티브 select 아님. delivery는 제외
  // (Task 6 보강 — 단계 pill과 완전 중복·모순 조합이라 숨김, "출고 관리(delivery) 콘솔" describe에서 별도 검증).
  it.each(["consulting", "contract", "settlement", "hold"] as const)("renders the shared stage filter pills for %s mode", (mode) => {
    render(<CustomerManagementPage mode={mode} />);
    expect(screen.getByRole("button", { name: /진행 상태 · 1차/ })).toBeInTheDocument();
  });

  // 뷰 select 3개(담당자별/상담상태별/긴급순)는 renderConsoleFilter로 흡수돼 pill(button)이 된다.
  // delivery는 출고 단계 필터 pill로 대체(Task 6) — "출고 관리(delivery) 콘솔" describe에서 별도 검증.
  it.each(["consulting", "contract", "settlement", "hold"] as const)("renders the mock view-select pills for %s mode", (mode) => {
    render(<CustomerManagementPage mode={mode} />);
    expect(screen.getByRole("button", { name: /담당자별 보기/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /상담상태별 보기/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /긴급순으로 보기/ })).toBeInTheDocument();
  });

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

  // 상담 메모 칩 = 계약 가능성(0726 축 교체) — 구 priority(쓰기 경로 0인 시드 박제)가 아니라
  // 드로어·전체 보기와 같은 resolveChance 파생값을 그린다. mock 김민준은 priority "긴급"인데
  // chance 어휘에 긴급이 없어 파생 "높음"으로 흡수되는 것까지 잠근다(축 교체의 관측 가능한 차이).
  it("renders the chance badge (not legacy priority) in the consulting 상담 메모 cell", () => {
    render(<CustomerManagementPage mode="consulting" />);
    const row = screen.getByText("김민준").closest("tr")!;
    expect(within(row).getByText("높음")).toBeInTheDocument();
    expect(within(row).queryByText("긴급")).not.toBeInTheDocument();
  });

  // 상담 메모 인라인 편집 실저장 배선(0726 A안) — 저장이 onNextActionSave(App 서버 핸들러: 최신
  // 미완료 할일 update-or-create·빈 값=삭제)로 흘러야 리로드에도 남는다. 구 프로토타입은 로컬
  // state만 바꿔 저장되는 척 후 리로드에 사라졌다(김지운 실사고 2026-07-26).
  it("forwards 상담 메모 saves to onNextActionSave (실저장 배선)", async () => {
    const user = userEvent.setup();
    const onNextActionSave = vi.fn();
    render(<CustomerManagementPage mode="all" onNextActionSave={onNextActionSave} />);
    await user.click(screen.getByRole("button", { name: "김민준 상담 메모 수정" }));
    const textarea = screen.getByRole("textbox", { name: "김민준 상담 메모 수정" });
    await user.clear(textarea);
    await user.type(textarea, "새 메모");
    await user.click(screen.getByRole("button", { name: "상담 메모 저장" }));
    expect(onNextActionSave).toHaveBeenCalledWith(11417, "새 메모");
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
    render(<CustomerManagementPage customers={[{ ...first, phone: "", phoneSecondary: "010-9876-5432" }]} mode="all" />);

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
    await user.click(
      within(screen.getByRole("listbox", { name: "진행 상태 · 1차 선택" })).getByRole("option", { name: "진행 상태 · 1차" }),
    );
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

  // 배치 10 B#3: 형제 토글 5곳 중 chance만 +N 말풍선 닫기가 누락이던 비대칭(선재 — 6077e3d^ 실증).
  // 동시 오픈되면 외부 클릭 1회에 extra만 닫혀(등록 순 stopImmediatePropagation 선점) 닫기 2회 필요.
  it("chance 팝오버를 열면 열려 있던 +N 말풍선이 닫힌다(형제 토글 대칭)", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);
    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    const extraBtn = within(row).getByRole("button", { name: /추가 차종 보기/ });
    await user.click(extraBtn);
    expect(extraBtn).toHaveAttribute("aria-expanded", "true");
    await user.click(within(row).getByRole("button", { name: /가능성 변경/ }));
    expect(screen.getByRole("listbox", { name: "가능성 선택" })).toBeInTheDocument();
    expect(extraBtn).toHaveAttribute("aria-expanded", "false");
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
// 기본 pill = "진행 중"(Task 6) — 계약완료 3명(최유진 출고완료·한지훈 배정완료·김도현 딜러사계약중) 중
// 출고완료(최유진)는 기본 노출에서 빠지고, 진행 중 단계인 한지훈·김도현만 노출된다.
describe("출고 관리(delivery) 콘솔", () => {
  it("헤더 = 선택/고객/차량/출고 단계/출고 예정/출고 정보/인도 방식/담당/관리", () => {
    render(<CustomerManagementPage mode="delivery" />);
    const heads = screen.getAllByRole("columnheader").map((th) => th.textContent);
    // index 0(선택) 헤더는 텍스트가 아니라 전체선택 체크박스를 렌더한다(기존 all mode 테스트와 동일 관례).
    expect(heads).toEqual(["", "고객", "차량", "출고 단계", "출고 예정", "출고 정보", "인도 방식", "담당", "관리"]);
  });

  it("출고 단계 셀 = 2차 상태 버튼(1차 버튼 없음), 팝오버 옵션 = 계약완료 2차 5종", async () => {
    render(<CustomerManagementPage mode="delivery" />);
    const stageButton = screen.getByRole("button", { name: "진행 2단계 변경: 배정완료" });
    expect(screen.queryByRole("button", { name: "진행 1단계 변경: 계약완료" })).toBeNull();
    fireEvent.click(stageButton);
    const listbox = screen.getByRole("listbox", { name: "진행 2단계 선택" });
    const options = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent);
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

  // 진행 상태 1차/2차 필터는 단계 pill과 완전 중복이라 delivery에서 숨긴다(1440px 실측 보강 — 겹침·
  // 모순 조합 방지). 잔존 statusGroup/status state 미적용 게이트는 아래 rerender 테스트가 기계 잠금
  // (배치 10 B#6 — 구 "코드 리뷰로 확인" 주석의 승격).
  it("delivery mode에선 진행 상태 1차/2차 필터가 렌더되지 않는다", () => {
    render(<CustomerManagementPage mode="delivery" />);
    expect(screen.queryByRole("button", { name: /진행 상태 · 1차/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /진행 상태 · 2차/ })).toBeNull();
  });

  // 배치 10 B#6: all에서 1차 필터를 걸고 delivery로 전환해도 잔존 state가 큐를 조용히 좁히면 안 된다
  // (activeStatusGroup/activeStatus 게이트 — 게이트가 사라지면 "신규" 필터 ∧ 계약완료 큐 = 상시 0명,
  // 정확히 spec §5.1이 차단하려던 모순 조합이다).
  it("all에서 1차 필터를 걸고 delivery로 전환해도 계약완료 큐가 좁혀지지 않는다", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CustomerManagementPage mode="all" />);
    await user.click(screen.getByRole("button", { name: /진행 상태 · 1차/ }));
    await user.click(within(screen.getByRole("listbox", { name: "진행 상태 · 1차 선택" })).getByRole("option", { name: "신규" }));
    rerender(<CustomerManagementPage mode="delivery" />);
    expect(screen.getByText("한지훈")).toBeInTheDocument(); // 계약완료·배정완료 — 게이트가 새면 사라진다
  });

  // 배치 10 B#7: 출고 예정 팝오버 스크롤 닫기(T13 원조)를 잠근다 — #289가 stage/chance 미러만
  // 잠그고 원조는 무테스트였던 비대칭 해소.
  it("스크롤이 나면 출고 예정 팝오버를 닫는다(fixed는 앵커를 따라가지 않음)", () => {
    render(<CustomerManagementPage mode="delivery" />);
    fireEvent.click(screen.getAllByRole("button", { name: /^출고 예정/ })[0]);
    expect(screen.getByRole("dialog", { name: "출고 예정 편집" })).toBeInTheDocument();
    fireEvent.scroll(document.body);
    expect(screen.queryByRole("dialog", { name: "출고 예정 편집" })).toBeNull();
  });

  // 배치 10 B#1: App reloadCustomers는 실패 시 reject가 아니라 false를 반환한다 — 반환값을 버리면
  // 저장 성공+리로드 실패가 무음으로 "+ 미지정" 잔존 → 재저장이 create로 해석돼 '출고' 2행이 실생성.
  // 실패 분기는 팝오버를 유지한 채 안내한다(deleteSelected 미러 불가 — notice가 팝오버 안에만 렌더).
  it("저장 후 리로드 실패(false)면 팝오버를 유지하고 안내를 보여준다", async () => {
    const reload = vi.fn().mockResolvedValue(false);
    const customers = [
      {
        ...initialCustomers[4],
        id: "cid-4",
        no: 90004,
        customerId: "CU-2605-9004",
        name: "출고리로드실패",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomerListChanged={reload} onCustomersChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^출고 예정 입력:/ }));
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026-07-24" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toHaveTextContent("목록을 불러오지");
    expect(screen.getByRole("dialog", { name: "출고 예정 편집" })).toBeInTheDocument();
  });

  it("행 정렬 = 출고 예정일 오름차순, 미지정은 뒤", () => {
    const base = initialCustomers[4]; // 한지훈 형태 복제
    const customers = [
      {
        ...base,
        no: 91001,
        customerId: "CU-2605-9101",
        name: "출고정렬셋째",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
      },
      {
        ...base,
        no: 91002,
        customerId: "CU-2605-9102",
        name: "출고정렬둘째",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: { id: "s2", date: "2026-08-02", time: null },
      },
      {
        ...base,
        no: 91003,
        customerId: "CU-2605-9103",
        name: "출고정렬첫째",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: { id: "s1", date: "2026-07-21", time: null },
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent ?? "");
    expect(names.findIndex((t) => t.includes("출고정렬첫째"))).toBeLessThan(names.findIndex((t) => t.includes("출고정렬둘째")));
    expect(names.findIndex((t) => t.includes("출고정렬둘째"))).toBeLessThan(names.findIndex((t) => t.includes("출고정렬셋째")));
  });

  it("미지정 클릭 → 팝오버에서 날짜 저장 = '출고' 일정 생성 호출", async () => {
    const { addSchedule } = await import("@/lib/customer-children");
    const customers = [
      {
        ...initialCustomers[4], // 한지훈(배정완료) 형태 복제
        id: "cid-1",
        no: 90001,
        customerId: "CU-2605-9001",
        name: "출고팝오버검증",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^출고 예정 입력:/ }));
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026-07-24" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(addSchedule).toHaveBeenCalledWith("cid-1", { scheduledDate: "2026-07-24", scheduledTime: null, type: "출고", done: false });
    });
  });

  it("대표 일정 있는 행 = 라벨 표시 + 저장 시 그 id PATCH", async () => {
    const { updateSchedule } = await import("@/lib/customer-children");
    const customers = [
      {
        ...initialCustomers[4],
        id: "cid-2",
        no: 90002,
        customerId: "CU-2605-9002",
        name: "출고팝오버수정",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: { id: "sch-1", date: "2026-07-24", time: "14:00" },
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^출고 예정 7\/24/ }));
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026-07-31" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(updateSchedule).toHaveBeenCalledWith("cid-2", "sch-1", { scheduledDate: "2026-07-31", scheduledTime: "14:00" });
    });
  });

  it("날짜 텍스트 형식이 틀리면 저장을 막고 안내 문구를 보여준다(년-월-일 고정, 로케일 무관 — 2026-07-19)", async () => {
    const { addSchedule } = await import("@/lib/customer-children");
    const customers = [
      {
        ...initialCustomers[4],
        id: "cid-3",
        no: 90003,
        customerId: "CU-2605-9003",
        name: "출고팝오버형식오류",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^출고 예정 입력:/ }));
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "0724" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("년-월-일");
    expect(addSchedule).not.toHaveBeenCalledWith("cid-3", expect.anything());
  });

  it("저장 성공 시 onCustomerListChanged(서버 리로드)를 호출한다", async () => {
    const reload = vi.fn().mockResolvedValue(true);
    const customers = [
      {
        ...initialCustomers[4],
        id: "cid-1",
        no: 90001,
        customerId: "CU-2605-9001",
        name: "출고팝오버검증",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomerListChanged={reload} onCustomersChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^출고 예정 입력:/ }));
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026-07-24" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  // ── 정산 비용 UI(2026-08-04 이사님 확정 5종) ───────────────────────────────
  // 비용은 admin에게만 보이지만 **정산 요청 버튼은 담당자에게도 보인다** — 정산 축이 admin
  // 단독인데 요청만 담당자 행위라서다(spec §6a). 이 둘이 뒤집히면 금액이 새거나 요청이 막힌다.
  it("출고 정보 팝오버: 정산 요청 버튼은 항상 있고, 비용 입력은 관리자에게만 열린다", () => {
    // ⚠️ **실 고객(id 보유)이어야 한다** — 요청 버튼은 `customerId`가 있을 때만 뜬다(목업 행은
    // 서버에 없어서 요청할 대상이 없다). 목업으로 쓰면 "버튼이 사라졌다"로 오해하게 된다.
    const customers = [
      {
        ...initialCustomers[4],
        id: "cid-settlement",
        no: 90101,
        customerId: "CU-2605-9101",
        name: "정산요청검증",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^출고 정보 입력:/ })[0]);
    const dialog = screen.getByRole("dialog", { name: "출고 정보 편집" });
    // 요청 버튼 — 담당자도 눌러야 하므로 admin 게이트 밖에 있다.
    expect(within(dialog).getByRole("button", { name: "정산 요청" })).toBeTruthy();
    // 기본 roleTab이 최고관리자라 비용 UI가 열려 있다.
    expect(within(dialog).getByRole("button", { name: "+ 비용 추가" })).toBeTruthy();
  });

  it("금액 칸: 입력 즉시 천단위 콤마가 붙고 숫자 외 문자는 지워진다", () => {
    render(<CustomerManagementPage mode="delivery" />);
    fireEvent.click(screen.getAllByRole("button", { name: /^출고 정보 입력:/ })[0]);
    const dialog = screen.getByRole("dialog", { name: "출고 정보 편집" });
    fireEvent.click(within(dialog).getByRole("button", { name: "+ 비용 추가" }));

    const amount = within(dialog).getByLabelText("비용 1 금액");
    // 문자가 섞여 들어와도 숫자만 남는다(붙여넣기·IME 오입력 방어) — 저장 파서가 400을 내기 전에
    // 화면에서 먼저 정리한다.
    fireEvent.change(amount, { target: { value: "3452abc34" } });
    expect((amount as HTMLInputElement).value).toBe("345,234");
  });

  it("비용 행: '직접입력'을 고를 때만 항목명 칸이 열린다(고정 항목엔 라벨을 붙이지 않는다)", () => {
    render(<CustomerManagementPage mode="delivery" />);
    fireEvent.click(screen.getAllByRole("button", { name: /^출고 정보 입력:/ })[0]);
    const dialog = screen.getByRole("dialog", { name: "출고 정보 편집" });
    fireEvent.click(within(dialog).getByRole("button", { name: "+ 비용 추가" }));

    // 기본값은 첫 항목(썬팅) — 항목명 칸이 없어야 한다. 고정 항목에 이름이 붙으면 집계 키가 갈린다.
    expect(within(dialog).queryByLabelText("비용 1 항목명")).toBeNull();

    // 종류를 직접입력으로 바꾸면 항목명 칸이 생긴다(광택·언더코팅 등을 여기 적는다).
    fireEvent.change(within(dialog).getByLabelText("비용 1 종류"), { target: { value: "직접입력" } });
    expect(within(dialog).getByLabelText("비용 1 항목명")).toBeTruthy();
  });

  // ── 출고 정보 셀·팝오버(2026-07-20 출고 2단계 spec §5) ─────────────────────
  it("출고 정보 미입력 셀 = '+ 미입력' 버튼, 클릭 시 폼형 팝오버(저장·취소)", () => {
    render(<CustomerManagementPage mode="delivery" />);
    fireEvent.click(screen.getAllByRole("button", { name: /^출고 정보 입력:/ })[0]);
    const dialog = screen.getByRole("dialog", { name: "출고 정보 편집" });
    expect(within(dialog).getByRole("button", { name: "저장" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "취소" })).toBeInTheDocument();
  });

  // ── 정산 섹션(2026-08-03, admin 단독 — 유슨생 결정) ────────────────────────
  // 서버 requireRoles가 진짜 게이트지만, UI가 새면 상담사 화면에 회사 수입 칸이 뜬다.
  // 출고 후 미확정 배지(2026-08-03 이사님 — 1일 초과부터). 인도와 확정 사이가 취소·지연 구간이라
  // 이 배지가 안 뜨면 상담사가 챙겨야 할 건을 놓친다.
  it("인도됐는데 계약 확정이 안 된 건에 '미확정 N일' 배지가 뜬다", () => {
    const customers = [
      {
        ...initialCustomers[4],
        id: "cid-unconfirmed",
        no: 90010,
        customerId: "CU-2605-9010",
        name: "미확정검증",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
        delivery: {
          contractVehicle: "BMW 520i",
          contractDate: null,
          lender: null,
          deliveredDate: "2020-01-01", // 충분히 과거 — 임계값 변경과 무관하게 항상 뜬다
          contractConfirmedDate: null,
          deliveryMemo: null,
          sourceQuoteId: null,
        },
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
    expect(screen.getByText(/미확정 \d+일/)).toBeInTheDocument();
  });

  it("확정일이 채워지면 배지가 사라진다", () => {
    const customers = [
      {
        ...initialCustomers[4],
        id: "cid-confirmed",
        no: 90011,
        customerId: "CU-2605-9011",
        name: "확정검증",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
        delivery: {
          contractVehicle: "BMW 520i",
          contractDate: null,
          lender: null,
          deliveredDate: "2020-01-01",
          contractConfirmedDate: "2020-01-03",
          deliveryMemo: null,
          sourceQuoteId: null,
        },
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
    expect(screen.queryByText(/미확정 \d+일/)).toBeNull();
  });

  it("정산 칸은 최고관리자에게만 보인다", () => {
    render(<CustomerManagementPage mode="delivery" roleTab="최고관리자" />);
    fireEvent.click(screen.getAllByRole("button", { name: /^출고 정보 입력:|^출고 정보:/ })[0]);
    const dialog = screen.getByRole("dialog", { name: "출고 정보 편집" });
    expect(within(dialog).getByLabelText(/입금일/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/실입금액/)).toBeInTheDocument();
  });

  // ── 정산 단계 편집(2026-08-05) ─────────────────────────────────────────────
  // 담당자 "정산요청" → admin "정산완료"로 넘기는 **유일한 화면**이다. 서버(PUT settlement의 zod
  // status)는 진작 준비돼 있었는데 화면이 없어 워크플로가 끊겨 있었다 — 담당자가 요청을 올려도
  // admin이 보지도 넘기지도 못했다.
  const settlementRow = (id: string, no: number, name: string) => ({
    ...initialCustomers[4],
    id,
    no,
    customerId: `CU-2605-${no}`,
    name,
    statusGroup: "계약완료" as const,
    status: "배정완료" as const,
    nextDeliverySchedule: null,
    delivery: null,
    contractingQuote: null,
  });

  it("담당자가 올린 '정산요청'이 단계 select에 그대로 보인다(정산은 목록에 안 실려 여기가 유일한 접점)", async () => {
    const { fetchCustomerSettlement } = await import("@/lib/customer-children");
    vi.mocked(fetchCustomerSettlement).mockResolvedValueOnce({ settledAt: null, feeAmount: null, costs: [], status: "정산요청" });
    render(
      <CustomerManagementPage
        customers={[settlementRow("cid-stage-1", 90201, "단계표시검증")]}
        mode="delivery"
        onCustomersChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "출고 정보 입력: 단계표시검증" }));
    expect(await screen.findByLabelText("단계")).toHaveValue("정산요청");
  });

  it("단계를 바꿔 저장하면 status가 정산 body에 실린다", async () => {
    const { fetchCustomerSettlement, saveCustomerSettlement } = await import("@/lib/customer-children");
    vi.mocked(fetchCustomerSettlement).mockResolvedValueOnce({ settledAt: null, feeAmount: null, costs: [], status: "정산요청" });
    vi.mocked(saveCustomerSettlement).mockClear();
    render(
      <CustomerManagementPage
        customers={[settlementRow("cid-stage-2", 90202, "단계저장검증")]}
        mode="delivery"
        onCustomersChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "출고 정보 입력: 단계저장검증" }));
    fireEvent.change(await screen.findByLabelText("단계"), { target: { value: "정산완료" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(saveCustomerSettlement).toHaveBeenCalled());
    expect(vi.mocked(saveCustomerSettlement).mock.calls[0][1]).toMatchObject({ status: "정산완료" });
  });

  // 이 그물이 없으면 다음과 같이 조용히 깨진다: admin이 팝오버를 열어 둔 사이 담당자가 정산요청을
  // 올리고, admin이 입금일만 고쳐 저장하면 그 요청이 "미정산"으로 되돌아간다(양쪽 다 모른다).
  it("단계를 건드리지 않으면 status를 아예 보내지 않는다(담당자 요청 덮어쓰기 방지)", async () => {
    const { fetchCustomerSettlement, saveCustomerSettlement } = await import("@/lib/customer-children");
    vi.mocked(fetchCustomerSettlement).mockResolvedValueOnce({ settledAt: null, feeAmount: null, costs: [], status: "미정산" });
    vi.mocked(saveCustomerSettlement).mockClear();
    render(
      <CustomerManagementPage
        customers={[settlementRow("cid-stage-3", 90203, "단계미변경검증")]}
        mode="delivery"
        onCustomersChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "출고 정보 입력: 단계미변경검증" }));
    await screen.findByLabelText("단계");
    fireEvent.change(screen.getByLabelText("입금일"), { target: { value: "2026-08-05" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(saveCustomerSettlement).toHaveBeenCalled());
    expect(vi.mocked(saveCustomerSettlement).mock.calls[0][1]).not.toHaveProperty("status");
  });

  // ── 정산 조회 실패·미완료 보호(2026-08-06 배치 16 S1) ─────────────────────────
  // 이 그물이 없으면 조용히 이렇게 깨진다: 정산 GET이 실패했거나 아직 안 왔는데 admin이 저장을
  // 누르면, 빈 state가 "빈 값"으로 단정돼 `{settledAt:null, feeAmount:null, costs:[]}`가 나가
  // **기존 실입금액·입금일·비용이 지워진다**. 이력 테이블·트리거가 없어 복구가 불가능하고,
  // 화면은 "저장 실패"가 아니라 정상 저장으로 보인다.
  it("정산 조회가 실패하면 저장이 정산을 건드리지 않는다(금액 null 덮어쓰기 방지)", async () => {
    const { fetchCustomerSettlement, saveCustomerDelivery, saveCustomerSettlement } = await import("@/lib/customer-children");
    vi.mocked(fetchCustomerSettlement).mockRejectedValueOnce(new Error("조회 실패"));
    vi.mocked(saveCustomerSettlement).mockClear();
    vi.mocked(saveCustomerDelivery).mockClear();
    render(
      <CustomerManagementPage
        customers={[settlementRow("cid-stage-4", 90204, "정산조회실패검증")]}
        mode="delivery"
        onCustomersChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "출고 정보 입력: 정산조회실패검증" }));
    await screen.findByText("정산 정보를 불러오지 못했습니다.");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    // 출고 정보 저장은 막지 않는다 — 정산 조회 실패가 다른 편집을 인질로 잡으면 안 된다.
    await waitFor(() => expect(saveCustomerDelivery).toHaveBeenCalled());
    expect(saveCustomerSettlement).not.toHaveBeenCalled();
  });

  // 거울면(같은 원인): 조회가 도착하기 전 입력할 수 있으면, 늦게 온 응답이 그 입력을 덮는다.
  it("정산 조회가 도착하기 전에는 정산 입력이 비활성이다", async () => {
    const { fetchCustomerSettlement } = await import("@/lib/customer-children");
    vi.mocked(fetchCustomerSettlement).mockReturnValueOnce(new Promise(() => {})); // 영원히 미완료
    render(
      <CustomerManagementPage
        customers={[settlementRow("cid-stage-5", 90205, "정산로딩중검증")]}
        mode="delivery"
        onCustomersChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "출고 정보 입력: 정산로딩중검증" }));
    // 칸은 그대로 렌더된다(팝오버 높이가 변하면 위치가 다시 잡혀 화면이 튄다) — 비활성만 된다.
    expect(await screen.findByLabelText("입금일")).toBeDisabled();
    expect(screen.getByLabelText("단계")).toBeDisabled();
  });

  it("정산 칸은 팀장·상담사에게 보이지 않는다(출고 정보 칸은 그대로)", () => {
    for (const roleTab of ["팀장", "상담사"] as const) {
      const { unmount } = render(<CustomerManagementPage mode="delivery" roleTab={roleTab} />);
      fireEvent.click(screen.getAllByRole("button", { name: /^출고 정보 입력:|^출고 정보:/ })[0]);
      const dialog = screen.getByRole("dialog", { name: "출고 정보 편집" });
      expect(within(dialog).queryByLabelText(/입금일/)).toBeNull();
      expect(within(dialog).queryByLabelText(/실입금액/)).toBeNull();
      // 단계도 같은 축 — 금액이 가려져도 단계가 보이면 담당자가 admin 전용 전이를 직접 할 수 있다.
      expect(within(dialog).queryByLabelText("단계")).toBeNull();
      // 출고 정보 자체는 계속 편집 가능해야 한다 — 정산만 가리는 것이지 팝오버를 막는 게 아니다.
      expect(within(dialog).getByLabelText(/계약 차량/)).toBeInTheDocument();
      unmount();
    }
  });

  it("팝오버는 contracting 견적에서 차량·금융사를 프리필한다(soft pipe)", () => {
    const customers = [
      {
        ...initialCustomers[4],
        id: "cid-5",
        no: 90005,
        customerId: "CU-2605-9005",
        name: "프리필검증",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
        delivery: null,
        contractingQuote: {
          id: "q-1",
          brandName: "BMW",
          modelName: "5 Series",
          trimName: "520i",
          purchaseMethod: null,
          lender: "iM캐피탈",
        },
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "출고 정보 입력: 프리필검증" }));
    // 라벨 매칭이 정규식인 이유: 프리필된 칸에는 "견적에서 가져옴" 힌트가 라벨 안에 붙는다
    // (aria-hidden이어도 getByLabelText는 textContent를 보므로 정확 일치가 깨진다).
    const vehicle = screen.getByLabelText(/계약 차량/);
    const lender = screen.getByLabelText(/금융사/);
    expect(vehicle).toHaveValue("BMW 5 Series 520i");
    expect(lender).toHaveValue("iM캐피탈");
    // 프리필 힌트 — 견적에서 채운 두 칸에만 붙는다(2026-08-03).
    expect(screen.getAllByText("견적에서 가져옴")).toHaveLength(2);
    // 사용자가 고치면 그 칸의 힌트만 사라진다(남으면 "견적값"이라는 거짓 표시가 된다).
    fireEvent.change(vehicle, { target: { value: "직접 수정" } });
    expect(screen.getAllByText("견적에서 가져옴")).toHaveLength(1);
    expect(screen.getByLabelText(/금융사/)).toHaveValue("iM캐피탈");
  });

  it("저장은 정규화 body로 saveCustomerDelivery를 호출하고, 리로드 실패(false)면 팝오버 유지+안내(B#1 미러)", async () => {
    const { saveCustomerDelivery } = await import("@/lib/customer-children");
    const reload = vi.fn().mockResolvedValue(false);
    const customers = [
      {
        ...initialCustomers[4],
        id: "cid-6",
        no: 90006,
        customerId: "CU-2605-9006",
        name: "출고정보저장검증",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
        delivery: null,
        contractingQuote: null,
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomerListChanged={reload} onCustomersChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "출고 정보 입력: 출고정보저장검증" }));
    fireEvent.change(screen.getByLabelText("계약일"), { target: { value: "2026-07-15" } });
    fireEvent.change(screen.getByLabelText("금융사"), { target: { value: "iM캐피탈" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(saveCustomerDelivery).toHaveBeenCalledWith("cid-6", {
        contractVehicle: null,
        contractDate: "2026-07-15",
        lender: "iM캐피탈",
        deliveredDate: null,
        contractConfirmedDate: null,
        deliveryMemo: null,
        sourceQuoteId: null,
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("목록을 불러오지");
    expect(screen.getByRole("dialog", { name: "출고 정보 편집" })).toBeInTheDocument();
  });

  it("delivery mode 차량 셀은 계약 차량 저장값을 우선 표시한다(니즈 파생 대체 — spec §5.2)", () => {
    const customers = [
      {
        ...initialCustomers[4],
        id: "cid-7",
        no: 90007,
        customerId: "CU-2605-9007",
        name: "차량폴백검증",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
        vehicle: "니즈차종",
        delivery: {
          contractVehicle: "계약차량 520i",
          contractDate: null,
          lender: null,
          deliveredDate: null,
          contractConfirmedDate: null,
          deliveryMemo: null,
          sourceQuoteId: null,
        },
        contractingQuote: null,
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
    expect(screen.getByText("계약차량 520i")).toBeInTheDocument();
    expect(screen.queryByText("니즈차종")).toBeNull();
  });

  // 배치 11 B#1: 팝오버 입력의 Enter keydown이 행까지 버블되면 드로어가 팝오버 위로 열리고 초안이
  // 묻힌다(행 Enter 핸들러 openCustomerByKeyboard). Enter만 차단 — 무차별 stopPropagation은 dismiss
  // 훅의 Escape 닫기(document 버블 리스너)를 죽이는 회귀(적대 검증 V2)라 Escape 생존을 함께 잠근다.
  it("팝오버 입력에서 Enter를 쳐도 드로어가 열리지 않고, Escape 닫기는 살아 있다", () => {
    const onOpenCustomer = vi.fn();
    render(<CustomerManagementPage mode="delivery" onOpenCustomer={onOpenCustomer} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^출고 정보 입력:/ })[0]);
    fireEvent.keyDown(screen.getByLabelText("계약 차량"), { key: "Enter" });
    expect(onOpenCustomer).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("계약 차량"), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "출고 정보 편집" })).toBeNull();
  });

  it("출고 예정 팝오버 입력의 Enter도 드로어를 열지 않는다(B#1 동반)", () => {
    const onOpenCustomer = vi.fn();
    render(<CustomerManagementPage mode="delivery" onOpenCustomer={onOpenCustomer} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^출고 예정 입력:/ })[0]);
    fireEvent.keyDown(screen.getByLabelText("날짜"), { key: "Enter" });
    expect(onOpenCustomer).not.toHaveBeenCalled();
  });

  // 배치 11 C#1: 폼형 관례(담당자 변경·고객 삭제·고객 등록 — 전부 가시 타이틀)에 정합 + fixed 팝오버라
  // 행과 시각 분리될 수 있어 고객명 병기로 오행 편집을 방지한다(spec §6).
  it("팝오버는 가시 타이틀에 고객명을 병기한다", () => {
    render(<CustomerManagementPage mode="delivery" />);
    fireEvent.click(screen.getByRole("button", { name: "출고 정보 입력: 한지훈" }));
    const dialog = screen.getByRole("dialog", { name: "출고 정보 편집" });
    expect(within(dialog).getByText("출고 정보 — 한지훈")).toBeInTheDocument();
  });

  // 배치 11 B#2: delivery 차량 셀은 계약 차량을 표시하므로 검색도 그 텍스트를 매칭해야 한다(표시·검색
  // 축 정합 — delivery mode 한정 편입·타 mode 검색 불변).
  it("delivery mode 검색은 계약 차량 텍스트도 매칭한다", () => {
    const customers = [
      {
        ...initialCustomers[4],
        id: "cid-9",
        no: 90009,
        customerId: "CU-2605-9009",
        name: "검색축검증",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
        vehicle: "니즈차종",
        delivery: {
          contractVehicle: "계약차량G80",
          contractDate: null,
          lender: null,
          deliveredDate: null,
          contractConfirmedDate: null,
          deliveryMemo: null,
          sourceQuoteId: null,
        },
        contractingQuote: null,
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/차종 검색/), { target: { value: "계약차량G80" } });
    expect(screen.getByText("검색축검증")).toBeInTheDocument();
  });

  // 배치 11 B#6ⓐ: 저장 성공(리로드 true) 경로의 팝오버 닫힘 — reload false 테스트는 유지 분기만
  // 잠가서, 성공 닫힘(같은 파일 "저장 성공 시 팝오버 닫힘" 케이스류)이 제거돼도 무증상이던 갭.
  it("저장 성공(리로드 true)이면 출고 정보 팝오버가 닫힌다", async () => {
    const reload = vi.fn().mockResolvedValue(true);
    const customers = [
      {
        ...initialCustomers[4],
        id: "cid-10",
        no: 90010,
        customerId: "CU-2605-9010",
        name: "성공닫힘검증",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
        delivery: null,
        contractingQuote: null,
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomerListChanged={reload} onCustomersChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "출고 정보 입력: 성공닫힘검증" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "출고 정보 편집" })).toBeNull());
  });

  it("저장 성공(리로드 true)이면 출고 예정 팝오버도 닫힌다(B#6ⓐ 동반)", async () => {
    const reload = vi.fn().mockResolvedValue(true);
    const customers = [
      {
        ...initialCustomers[4],
        id: "cid-11",
        no: 90011,
        customerId: "CU-2605-9011",
        name: "예정닫힘검증",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
        delivery: null,
        contractingQuote: null,
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomerListChanged={reload} onCustomersChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "출고 예정 입력: 예정닫힘검증" }));
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026-07-24" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "출고 예정 편집" })).toBeNull());
  });

  // 배치 11 B#6ⓒ: fixed 팝오버 스크롤 닫기 — 출고 예정 팝오버 케이스류만 잠겨 있던 비대칭.
  it("스크롤이 나면 출고 정보 팝오버를 닫는다(fixed는 앵커를 따라가지 않음)", () => {
    render(<CustomerManagementPage mode="delivery" />);
    fireEvent.click(screen.getAllByRole("button", { name: /^출고 정보 입력:/ })[0]);
    expect(screen.getByRole("dialog", { name: "출고 정보 편집" })).toBeInTheDocument();
    fireEvent.scroll(document.body);
    expect(screen.queryByRole("dialog", { name: "출고 정보 편집" })).toBeNull();
  });

  it("출고 정보 저장값이 있으면 셀에 계약·출고 요약 줄을 보여준다", () => {
    const customers = [
      {
        ...initialCustomers[4],
        id: "cid-8",
        no: 90008,
        customerId: "CU-2605-9008",
        name: "출고요약검증",
        statusGroup: "계약완료",
        status: "배정완료",
        nextDeliverySchedule: null,
        delivery: {
          contractVehicle: null,
          contractDate: "2026-07-15",
          lender: "iM캐피탈",
          deliveredDate: "2026-07-20",
          contractConfirmedDate: null,
          deliveryMemo: null,
          sourceQuoteId: null,
        },
        contractingQuote: null,
      },
    ];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
    expect(screen.getByText("계약 7/15 · iM캐피탈")).toBeInTheDocument();
    expect(screen.getByText("출고 7/20")).toBeInTheDocument();
  });
});

// 콘솔 행 팝오버 fixed 배치(2026-07-19 클리핑 확산 픽스) — 진행 상태·가능성 팝오버가
// .console-table-scroll{overflow:hidden}(콘솔 서피스 SSOT·불가침)에 마지막 행에서 절단되던 결함을
// 출고 예정 팝오버와 같은 fixed+flip-up 패턴으로 전환. 측정(useLayoutEffect)이 안 돌면 팝오버가
// visibility:hidden에 갇혀 아예 안 보이므로 "인라인 좌표가 실린다" 단언이 배선 자체를 잠근다.
describe("콘솔 행 팝오버 fixed 배치(클리핑 확산 픽스)", () => {
  it("진행 1단계 팝오버는 인라인 fixed 좌표를 받고 visibility:hidden에 갇히지 않는다", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);
    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "진행 1단계 변경: 견적" }));
    const popover = screen.getByRole("listbox", { name: "진행 1단계 선택" });
    expect(popover.style.top).not.toBe("");
    expect(popover.style.visibility).not.toBe("hidden");
  });

  it("진행 2단계 팝오버(레벨 전환 재마운트)도 인라인 좌표를 받는다", async () => {
    // 1차 선택 → 2차 자동 오픈 = 다른 앵커(.stage-control)에서 재마운트되는 경로 — 앵커 재계산 잠금.
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);
    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "진행 1단계 변경: 견적" }));
    await user.click(within(screen.getByRole("listbox", { name: "진행 1단계 선택" })).getByRole("option", { name: "상담중" }));
    const popover = screen.getByRole("listbox", { name: "진행 2단계 선택" });
    expect(popover.style.top).not.toBe("");
    expect(popover.style.visibility).not.toBe("hidden");
  });

  it("가능성 팝오버도 인라인 좌표를 받는다", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);
    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "가능성 변경: 높음" }));
    const popover = screen.getByRole("listbox", { name: "가능성 선택" });
    expect(popover.style.top).not.toBe("");
    expect(popover.style.visibility).not.toBe("hidden");
  });

  it("스크롤이 나면 진행 상태 팝오버를 닫는다(fixed는 앵커를 따라가지 않음 — T13 미러)", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);
    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "진행 1단계 변경: 견적" }));
    expect(screen.getByRole("listbox", { name: "진행 1단계 선택" })).toBeInTheDocument();
    fireEvent.scroll(document.body);
    expect(screen.queryByRole("listbox", { name: "진행 1단계 선택" })).not.toBeInTheDocument();
  });

  it("스크롤이 나면 가능성 팝오버를 닫는다", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);
    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "가능성 변경: 높음" }));
    expect(screen.getByRole("listbox", { name: "가능성 선택" })).toBeInTheDocument();
    fireEvent.scroll(document.body);
    expect(screen.queryByRole("listbox", { name: "가능성 선택" })).not.toBeInTheDocument();
  });

  // 배치 10 B#4: fixed 팝오버는 리사이즈도 따라가지 못한다 — 스크롤 닫기와 같은 근거로 닫는다
  // (absolute 시절엔 앵커-상대라 자동 추종 — fixed 전환이 만든 갭).
  it("창 리사이즈가 나면 진행 상태 팝오버를 닫는다(스크롤 닫기 미러)", async () => {
    const user = userEvent.setup();
    render(<CustomerManagementPage mode="all" />);
    const row = screen.getByText("김민준").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: "진행 1단계 변경: 견적" }));
    expect(screen.getByRole("listbox", { name: "진행 1단계 선택" })).toBeInTheDocument();
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("listbox", { name: "진행 1단계 선택" })).not.toBeInTheDocument();
  });
});

// ── 정산(settlement) 콘솔 목록 컬럼(2026-08-05) ──────────────────────────────
// 이 탭은 도입 이래 **실 데이터에서 늘 빈 목록**이었다: 필터가 목업 전용 필드
// (`customer.settlementStatus`)를 봐서 서버 행은 전부 탈락했고, 금액 3열도 목업의 자유 문자열
// (`fee: "슬라이딩 118만원"`)을 그렸다. 확정 설계(금액=number·비용=배열·마진=파생)로 다시 지었다.
describe("정산(settlement) 콘솔 목록", () => {
  const settled = (over: Partial<(typeof initialCustomers)[number]> = {}) => ({
    ...initialCustomers[4],
    id: "cid-settle-list",
    no: 90301,
    customerId: "CU-2605-9301",
    name: "정산목록검증",
    statusGroup: "계약완료",
    status: "출고완료",
    nextDeliverySchedule: null,
    delivery: {
      contractVehicle: "BMW 520i",
      contractDate: "2026-07-01",
      lender: "iM캐피탈",
      deliveredDate: "2026-07-20",
      contractConfirmedDate: "2026-07-25", // 이게 있어야 정산 대상이다
      deliveryMemo: null,
      sourceQuoteId: null,
    },
    ...over,
  });

  it("실입금액·비용합·마진을 실 데이터에서 그린다(마진은 저장 안 하는 파생)", () => {
    const customers = [
      settled({
        settlement: {
          settledAt: "2026-08-01",
          feeAmount: 2_000_000,
          costs: [
            { kind: "썬팅" as const, label: null, amount: 300_000 },
            { kind: "탁송" as const, label: null, amount: 120_000 },
          ],
          status: "정산완료" as const,
        },
      }),
    ];
    render(<CustomerManagementPage customers={customers} mode="settlement" onCustomersChange={() => {}} />);
    const row = screen.getByText("정산목록검증").closest("tr") as HTMLTableRowElement;
    expect(within(row).getByText("2,000,000")).toBeInTheDocument(); // 실입금액
    expect(within(row).getByText("420,000")).toBeInTheDocument(); // 비용합 = 300,000 + 120,000
    expect(within(row).getByText("1,580,000")).toBeInTheDocument(); // 마진 = 2,000,000 − 420,000
    // 출고일 = 계약 확정일. 표시는 **슬래시**(저장은 하이픈 — 두 축이 다르다, formatDateDisplay).
    expect(within(row).getByText("2026/07/25")).toBeInTheDocument();
  });

  // 비admin은 서버가 `settlement`을 null로 비운다(lib/settlement-visibility) — 화면은 그 상태에서
  // **깨지지 않고 "—"**로 떨어져야 한다. 여기가 무너지면 상담사 화면이 빈 칸이 아니라 에러가 된다.
  it("정산이 null이면(비admin 응답) 금액 3열이 '—'로 떨어진다", () => {
    render(<CustomerManagementPage customers={[settled({ settlement: null })]} mode="settlement" onCustomersChange={() => {}} />);
    const row = screen.getByText("정산목록검증").closest("tr") as HTMLTableRowElement;
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  // 정산을 아직 시작 안 한 건(2026-08-05 실화면 제임스) — 실입금액·마진이 "—"인 줄에서 비용만
  // 0이면 "비용은 0원인데 나머지는 모른다"로 읽힌다. 빈 배열은 DB 기본값이라 "비용 없음"과
  // "아직 입력 안 함"이 구분되지 않으므로, 0으로 단정하지 않는다(입력한 적 없는 값을 지어내지 않는다).
  it("비용 항목이 하나도 없으면 비용도 '—'(0으로 단정하지 않는다)", () => {
    const customers = [settled({ settlement: { settledAt: null, feeAmount: null, costs: [], status: "미정산" as const } })];
    render(<CustomerManagementPage customers={customers} mode="settlement" onCustomersChange={() => {}} />);
    const row = screen.getByText("정산목록검증").closest("tr") as HTMLTableRowElement;
    expect(within(row).queryByText("0")).toBeNull();
  });

  // 반대 축: 사람이 실제로 넣은 항목이 있으면 그 합을 낸다(0원 항목만 있으면 0이 맞다).
  it("비용 항목이 있으면 합계를 그린다", () => {
    const customers = [
      settled({
        settlement: {
          settledAt: null,
          feeAmount: null,
          costs: [{ kind: "페이백" as const, label: null, amount: 500_000 }],
          status: "미정산" as const,
        },
      }),
    ];
    render(<CustomerManagementPage customers={customers} mode="settlement" onCustomersChange={() => {}} />);
    const row = screen.getByText("정산목록검증").closest("tr") as HTMLTableRowElement;
    expect(within(row).getByText("500,000")).toBeInTheDocument();
  });

  // 담당자가 올린 "정산요청"이 admin 목록에서 눈에 띄어야 한다 — 처리 대기 건이기 때문이다.
  it("단계 배지는 정산요청만 강조 톤(yellow)을 쓴다", () => {
    const customers = [settled({ settlement: { settledAt: null, feeAmount: null, costs: [], status: "정산요청" as const } })];
    render(<CustomerManagementPage customers={customers} mode="settlement" onCustomersChange={() => {}} />);
    const badge = screen.getByText("정산요청");
    expect(badge.className).toContain("yellow");
  });

  // 필터 회귀 그물 — 이 조건이 목업 필드로 되돌아가면 탭이 다시 통째로 빈다(2년치 버그의 정체).
  it("계약 확정일이 없는 고객은 정산 목록에 뜨지 않는다", () => {
    const customers = [
      settled({ name: "확정됨" }),
      settled({
        id: "cid-unconfirmed",
        no: 90302,
        customerId: "CU-2605-9302",
        name: "미확정",
        delivery: {
          contractVehicle: "BMW 520i",
          contractDate: "2026-07-01",
          lender: null,
          deliveredDate: "2026-07-20",
          contractConfirmedDate: null,
          deliveryMemo: null,
          sourceQuoteId: null,
        },
      }),
    ];
    render(<CustomerManagementPage customers={customers} mode="settlement" onCustomersChange={() => {}} />);
    expect(screen.getByText("확정됨")).toBeInTheDocument();
    expect(screen.queryByText("미확정")).toBeNull();
  });

  it("목록 헤더는 팝오버와 같은 말을 쓴다 — '수수료'가 아니라 '실입금액'", () => {
    render(<CustomerManagementPage mode="settlement" />);
    expect(screen.getByRole("columnheader", { name: "실입금액" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "수수료" })).toBeNull();
  });

  // ⚠️ 목업 행이 이 탭에 **실제로 뜨는지**를 잠근다. 목업에 정산만 넣고 `delivery`(계약 확정일)를
  // 빠뜨리면 필터를 통과하지 못해 **넣은 목업이 화면에 영원히 안 보이는 죽은 데이터**가 된다
  // (2026-08-05에 실제로 그 상태로 한 번 커밋됐고, 화면이 0건이라 유슨생이 발견했다).
  // Storybook·목업 모드의 유일한 표본이라 여기가 비면 개발 중 이 화면을 아예 볼 수 없다.
  it("목업 모드에서도 정산 행이 보인다(delivery 없이 settlement만 넣으면 필터에서 탈락한다)", () => {
    render(<CustomerManagementPage mode="settlement" />);
    expect(screen.getByText("이나경")).toBeInTheDocument();
    expect(screen.getByText("1,180,000")).toBeInTheDocument(); // 실입금액
    expect(screen.getByText("760,000")).toBeInTheDocument(); // 마진 = 1,180,000 − 420,000
  });
});
