import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Customer } from "@/data/customers";
import { updateQuote as apiUpdateQuote } from "@/lib/customer-quotes";
import type { CustomerDetailData } from "@/lib/customers";

import { useQuoteList } from "./useQuoteList";

vi.mock("@/lib/customer-quotes", () => ({
  updateQuote: vi.fn(async () => ({})),
  deleteQuote: vi.fn(async () => ({})),
  uploadQuoteOriginal: vi.fn(async () => ({})),
  deleteQuoteOriginal: vi.fn(async () => ({})),
  getQuoteOriginalUrl: vi.fn(async () => ""),
}));
vi.mock("@/lib/quote-requests", () => ({
  fetchAppQuoteRequestsCached: vi.fn(async () => []),
}));

const updateQuoteMock = vi.mocked(apiUpdateQuote);

const detail = { id: "d-1", quotes: [] } as unknown as CustomerDetailData;
const baseCustomer = { id: "cust-1", no: 11, name: "김지안", statusGroup: "견적", status: "발송완료" } as Customer;

function setup(customer: Customer = baseCustomer) {
  const onWorkflowChange = vi.fn();
  const hook = renderHook(() =>
    useQuoteList({
      detail,
      customer,
      onToast: vi.fn(),
      markRecentUpdate: vi.fn(),
      reloadAppRequests: vi.fn(),
      onCustomerListChanged: vi.fn(),
      onWorkflowChange,
    }),
  );
  return { ...hook, onWorkflowChange };
}

// 계약 진행 마킹 → 계약완료 전이 확인 넛지(2026-07-21 이사님 ①ⓑ, delivery-step2 spec §8).
// 마킹만 하면 출고 큐 미진입(비계약완료 고객)이라, 마킹 확정 직후 발주 경로 선택형 넛지를 띄운다.
describe("계약 진행 마킹 → 계약완료 전이 넛지", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("비계약완료 고객의 신규 마킹이면 넛지가 열리고 마킹 PATCH는 그대로 나간다", async () => {
    const { result } = setup();
    act(() => result.current.handlers.confirmContractDecision("q-1", "none"));
    expect(result.current.contractStageNudgeQuoteId).toBe("q-1");
    await waitFor(() => expect(updateQuoteMock).toHaveBeenCalledWith("cust-1", "q-1", { decisionStatus: "contracting" }));
  });

  it("이미 계약완료 고객이면 넛지를 열지 않는다", () => {
    const { result } = setup({ ...baseCustomer, statusGroup: "계약완료", status: "딜러사계약중" } as Customer);
    act(() => result.current.handlers.confirmContractDecision("q-1", "none"));
    expect(result.current.contractStageNudgeQuoteId).toBeNull();
  });

  it("해제 경로(contracting → none)는 넛지를 열지 않는다", async () => {
    const { result } = setup();
    act(() => result.current.handlers.confirmContractDecision("q-1", "contracting"));
    expect(result.current.contractStageNudgeQuoteId).toBeNull();
    await waitFor(() => expect(updateQuoteMock).toHaveBeenCalledWith("cust-1", "q-1", { decisionStatus: "none" }));
  });

  it("발주 경로 선택 = onWorkflowChange(계약완료·선택 상태) 정확 인자 + 넛지·팝오버 닫힘", () => {
    const { result, onWorkflowChange } = setup();
    act(() => result.current.handlers.confirmContractDecision("q-1", "none"));
    act(() => result.current.handlers.applyContractStageNudge("대리점발주중"));
    expect(onWorkflowChange).toHaveBeenCalledTimes(1);
    expect(onWorkflowChange).toHaveBeenCalledWith(11, { statusGroup: "계약완료", status: "대리점발주중" });
    expect(result.current.contractStageNudgeQuoteId).toBeNull();
  });

  it("진행 상태 유지(거절) = onWorkflowChange 미호출·넛지만 닫힘", () => {
    const { result, onWorkflowChange } = setup();
    act(() => result.current.handlers.confirmContractDecision("q-1", "none"));
    act(() => result.current.handlers.dismissContractStageNudge());
    expect(onWorkflowChange).not.toHaveBeenCalled();
    expect(result.current.contractStageNudgeQuoteId).toBeNull();
  });
});
