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
    // 팝오버를 실제로 열어 둔다(B#6① — arrange 없이 openQuoteActionId를 단언하면 세팅된 적이 없어
    // 항상 null = 변이 무증상. V2가 setOpenQuoteActionId(null) 제거 변이 green을 실측했다).
    act(() => result.current.handlers.setOpenQuoteActionId("q-1"));
    act(() => result.current.handlers.confirmContractDecision("q-1", "none"));
    act(() => result.current.handlers.applyContractStageNudge("대리점발주중"));
    expect(onWorkflowChange).toHaveBeenCalledTimes(1);
    expect(onWorkflowChange).toHaveBeenCalledWith(11, { statusGroup: "계약완료", status: "대리점발주중" });
    expect(result.current.contractStageNudgeQuoteId).toBeNull();
    expect(result.current.openQuoteActionId).toBeNull();
  });

  it("진행 상태 유지(거절) = onWorkflowChange 미호출·넛지만 닫힘", () => {
    const { result, onWorkflowChange } = setup();
    act(() => result.current.handlers.confirmContractDecision("q-1", "none"));
    act(() => result.current.handlers.dismissContractStageNudge());
    expect(onWorkflowChange).not.toHaveBeenCalled();
    expect(result.current.contractStageNudgeQuoteId).toBeNull();
  });
});

// 배치 12 B#1 — 넛지 클리어 경로 전수(잔존 = editorOpen OR가 남아 드로어 Escape 무음 차단·스테일 재등장).
describe("넛지 상태 클리어 경로 (배치 12 B#1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function openNudge(result: ReturnType<typeof setup>["result"]) {
    act(() => result.current.handlers.setOpenQuoteActionId("q-1"));
    act(() => result.current.handlers.confirmContractDecision("q-1", "none"));
    expect(result.current.contractStageNudgeQuoteId).toBe("q-1");
  }

  it("팝오버 닫힘(closeQuoteActionPopover — 트리거 토글·보기 계열) = 넛지 동반 클리어", () => {
    const { result } = setup();
    openNudge(result);
    act(() => result.current.handlers.closeQuoteActionPopover());
    expect(result.current.contractStageNudgeQuoteId).toBeNull();
    expect(result.current.openQuoteActionId).toBeNull();
    expect(result.current.editorOpen).toBe(false); // 드로어 Escape 차단 해소의 실체
  });

  it("행 전환 오픈(openQuoteActionPopover) = 이전 행 넛지 클리어(스테일 재등장 차단)", () => {
    const { result } = setup();
    openNudge(result);
    act(() => result.current.handlers.openQuoteActionPopover("q-2", null));
    expect(result.current.contractStageNudgeQuoteId).toBeNull();
    expect(result.current.openQuoteActionId).toBe("q-2");
  });

  it("마킹 해제(contracting → none) = 열려 있던 넛지 무효(시나리오 b — contracting 0 전이 차단)", () => {
    const { result } = setup();
    openNudge(result);
    act(() => result.current.handlers.confirmContractDecision("q-1", "contracting"));
    expect(result.current.contractStageNudgeQuoteId).toBeNull();
  });

  it("견적 삭제 = 그 견적의 넛지 클리어(죽은 id로 editorOpen 영구 true 차단)", () => {
    const { result } = setup();
    openNudge(result);
    act(() => result.current.handlers.deleteQuote("q-1"));
    expect(result.current.contractStageNudgeQuoteId).toBeNull();
  });

  // 배치 13 K2-b — 마킹 PATCH 실패 롤백. 넛지 렌더 조건은 decisionStatus를 보지 않으므로
  // (contractStageNudgeQuoteId === openQuoteAction.id) 롤백해도 넛지가 그대로 남아, 발주 경로를 누르면
  // contracting 견적 0인데 계약완료로 전이된다(서버는 status 조합만 검증 — 교차 검증 없음).
  // ⚠️ 이 테스트가 잠그는 건 "롤백 착지 후" 뿐이다 — 롤백 전에 누르는 클릭-선행 레이스는 잔존(수용).
  it("마킹 PATCH 실패 롤백 = 넛지 무효(K2-b — 마킹 없는 계약완료 전이 차단)", async () => {
    updateQuoteMock.mockRejectedValueOnce(new Error("patch failed"));
    const { result } = setup();
    act(() => result.current.setQuotes([{ id: "q-1", quoteCode: "QT-1", title: "테스트 견적", meta: "", status: "작성중", source: "manual", appStatus: "draft", decisionStatus: "none" }]));
    openNudge(result);
    // 낙관 반영은 contracting
    expect(result.current.quotes[0].decisionStatus).toBe("contracting");
    // 롤백 착지 — decisionStatus 원복 + 넛지 동반 무효
    await waitFor(() => expect(result.current.quotes[0].decisionStatus).toBe("none"));
    expect(result.current.contractStageNudgeQuoteId).toBeNull();
  });

  it("외부 pointerdown·Escape = 넛지 거절(spec §8 계약 3 — B#6② 리스너 실커버)", () => {
    const { result } = setup();
    openNudge(result);
    act(() => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(result.current.contractStageNudgeQuoteId).toBeNull();
    expect(result.current.openQuoteActionId).toBeNull();

    openNudge(result);
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(result.current.contractStageNudgeQuoteId).toBeNull();
    expect(result.current.openQuoteActionId).toBeNull();
  });
});
