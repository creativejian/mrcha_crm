import { useEffect } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Customer } from "@/data/customers";
import type { CustomerDetailData } from "@/lib/customers";
import type { QuoteItem } from "@/lib/quote-items";

import { QuoteList } from "./QuoteList";
import { useQuoteList } from "./hooks/useQuoteList";

vi.mock("@/lib/customer-quotes", () => ({
  updateQuote: vi.fn(async () => ({})),
  deleteQuote: vi.fn(async () => ({})),
  uploadQuoteOriginal: vi.fn(async () => ({})),
  deleteQuoteOriginal: vi.fn(async () => ({})),
  getQuoteOriginalUrl: vi.fn(async () => ""),
}));
vi.mock("@/lib/quote-requests", () => ({ fetchAppQuoteRequestsCached: vi.fn(async () => []) }));
vi.mock("@/lib/vehicles-cache", () => ({ prefetchWorkbenchVehicle: vi.fn() }));

const detail = { id: "d-1", quotes: [] } as unknown as CustomerDetailData;
const customer = { id: "cust-1", no: 11, name: "김지안", customerId: "CU-1", statusGroup: "견적", status: "발송완료" } as Customer;

const baseQuote: QuoteItem = {
  id: "q-1",
  quoteCode: "QT-1",
  title: "테스트 견적",
  meta: "",
  status: "작성중",
  source: "manual",
  appStatus: "draft",
  decisionStatus: "none",
};

// 행 액션 팝오버의 "오프너" = 클릭해도 팝오버를 열어 둔 채 자기 확인창만 여는 버튼(6곳).
// "견적 원본 보기/첨부"는 closeQuoteActionPopover로 닫는 계열이라 오프너가 아니다.
// ⚠️ 이 목록은 전수여야 한다 — 배치 12(B#1)가 5곳만 손대는 바람에 "견적 수정" 하나가 빠졌고,
//    그 결과 넛지와 "계약 관리에서 수정" 안내가 같은 팝오버에 동시 렌더됐다(배치 13 K2-a).
const OPENERS = ["앱 발송", "견적 수정", "최종 고민중", "고객 확정", "계약 진행", "삭제"] as const;

// downgrade(계약 진행 해제 확인)를 자기 토글 대상으로 쓰는 "최종 고민중"·"고객 확정"만 제외한 나머지 —
// 이들은 남의 확인창인 downgrade를 반드시 지워야 한다(안 지우면 확인창 2개가 겹쳐 렌더).
const DOWNGRADE_CLEARING_OPENERS = ["앱 발송", "견적 수정", "계약 진행", "삭제"] as const;

let hookRef: ReturnType<typeof useQuoteList> | null = null;
const onEditQuote = vi.fn();

function Harness() {
  const quoteList = useQuoteList({
    detail,
    customer,
    onToast: vi.fn(),
    markRecentUpdate: vi.fn(),
    reloadAppRequests: vi.fn(),
    onCustomerListChanged: vi.fn(),
    onWorkflowChange: vi.fn(),
  });
  // 훅 상태 관측 프로브 — 렌더 중 대입은 side effect라 effect에서 갱신한다(react-hooks/globals).
  useEffect(() => { hookRef = quoteList; });
  return (
    <QuoteList
      quoteList={quoteList}
      customer={customer}
      appUserId={null}
      onToast={vi.fn()}
      onOpenNewWorkbench={vi.fn()}
      onEditQuote={onEditQuote}
      quoteWritable
    />
  );
}

function mount(quote: QuoteItem) {
  render(<Harness />);
  act(() => hookRef!.setQuotes([quote]));
}

const popover = () => screen.getByRole("dialog", { name: "견적 작업" });
const openerButton = (label: string) => within(popover()).getByRole("button", { name: label });

describe("견적 행 액션 오프너 — 팝오버-내부 상태 동반 클리어 전수 (배치 12 B#1 · 배치 13 K2-a)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookRef = null;
  });

  // OPENERS는 손으로 적은 목록이라, **새 오프너가 추가되면 이 파일은 조용히 그걸 건너뛴다**
  // (배치 14 K4-a 실증: 미등재 7번째 오프너를 주입해도 163 tests green — 손으로 등재만 하면 즉시 RED).
  // 반대 방향(오프너 삭제·라벨 변경)은 `getByRole({name})`이 이미 잡으므로, 비어 있던 `DOM ⊆ OPENERS`
  // 쪽만 닫는다. 표준 상태(draft·쓰기 가능·원본 없음)의 팝오버 버튼이 정확히 이 6개여야 한다.
  // "견적 원본 첨부"는 `<label>`+file input이라 button role이 아니다 — 늘어나면 여기서 먼저 멈춘다.
  it("팝오버 버튼 집합 = OPENERS(신규 오프너가 목록에 등재되지 않으면 RED)", async () => {
    const user = userEvent.setup();
    mount(baseQuote);
    await user.click(screen.getByRole("button", { name: "테스트 견적 견적 작업 열기" }));

    const rendered = within(popover()).getAllByRole("button").map((b) => b.textContent?.trim() ?? "");
    expect([...rendered].sort()).toEqual([...OPENERS].sort());
  });

  it.each(OPENERS)("오프너 '%s'는 열려 있던 계약완료 전이 넛지를 클리어한다", async (label) => {
    const user = userEvent.setup();
    mount(baseQuote);
    // arrange — 계약 진행 확정으로 넛지를 실제로 띄운다(넛지는 마킹 직후에만 열린다).
    await user.click(screen.getByRole("button", { name: "테스트 견적 견적 작업 열기" }));
    await user.click(openerButton("계약 진행"));
    await user.click(within(popover()).getByRole("button", { name: "확정" }));
    expect(hookRef!.contractStageNudgeQuoteId).toBe("q-1");

    await user.click(openerButton(label));

    // 넛지는 어느 오프너의 토글 대상도 아니다 → 6곳 전부 무조건 null.
    expect(hookRef!.contractStageNudgeQuoteId).toBeNull();
  });

  it.each(DOWNGRADE_CLEARING_OPENERS)("오프너 '%s'는 열려 있던 계약 진행 해제 확인을 클리어한다", async (label) => {
    const user = userEvent.setup();
    mount({ ...baseQuote, decisionStatus: "contracting" });
    await user.click(screen.getByRole("button", { name: "테스트 견적 견적 작업 열기" }));
    act(() => hookRef!.handlers.setConfirmingQuoteContractDowngrade({ id: "q-1", status: "considering" }));
    expect(screen.getByRole("dialog", { name: "계약 진행 해제 확인" })).toBeTruthy();

    await user.click(openerButton(label));

    expect(hookRef!.confirmingQuoteContractDowngrade).toBeNull();
  });

  it("'견적 수정' 오프너는 안내 다이얼로그와 넛지를 동시 렌더하지 않는다(K2-a 사용자 증상)", async () => {
    const user = userEvent.setup();
    // 실제 useQuoteWorkbench.openEditQuote의 계약 진행 분기를 모사 — 안내 확인창만 연다.
    onEditQuote.mockImplementation((q: QuoteItem) => {
      hookRef!.handlers.setConfirmingQuoteContractEditId((current) => (current === q.id ? null : q.id));
    });
    mount(baseQuote);
    await user.click(screen.getByRole("button", { name: "테스트 견적 견적 작업 열기" }));
    await user.click(openerButton("계약 진행"));
    await user.click(within(popover()).getByRole("button", { name: "확정" }));

    await user.click(openerButton("견적 수정"));

    expect(screen.getByRole("dialog", { name: "계약 진행 견적 수정 안내" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "진행 상태 계약완료 변경 확인" })).toBeNull();
  });
});
