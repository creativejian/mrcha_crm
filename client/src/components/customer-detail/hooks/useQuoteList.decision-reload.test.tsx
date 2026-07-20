import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Customer } from "@/data/customers";
import { deleteQuote as apiDeleteQuote, updateQuote as apiUpdateQuote } from "@/lib/customer-quotes";
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
const deleteQuoteMock = vi.mocked(apiDeleteQuote);

const detail = { id: "d-1", quotes: [] } as unknown as CustomerDetailData;
const customer = { id: "cust-1", name: "김민준" } as Customer;

function setup(onCustomerListChanged = vi.fn()) {
  const hook = renderHook(() =>
    useQuoteList({ detail, customer, onToast: vi.fn(), markRecentUpdate: vi.fn(), reloadAppRequests: vi.fn(), onCustomerListChanged }),
  );
  return { ...hook, onCustomerListChanged };
}

// 결정 상태(계약 진행 등) 마킹 → 목록 리로드 배선(2026-07-20 출고 2단계 follow-up).
// contractingQuote(soft pipe 프리필 소스)는 목록 파생이라, 마킹 PATCH 성공이 목록을 리프레시하지
// 않으면 같은 세션의 출고 콘솔 프리필이 스테일(F5 전까지 빈 폼) — savePatch의 onCustomerListChanged
// 관례와 동일 경로(유슨생 실기 리포트로 발견).
describe("updateQuoteDecisionStatus → onCustomerListChanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PATCH 성공 시 목록 리로드를 호출한다(계약 진행 마킹·해제 공통 경로)", async () => {
    const { result, onCustomerListChanged } = setup();
    result.current.handlers.updateQuoteDecisionStatus("q-1", "contracting");
    await waitFor(() => expect(updateQuoteMock).toHaveBeenCalledWith("cust-1", "q-1", { decisionStatus: "contracting" }));
    await waitFor(() => expect(onCustomerListChanged).toHaveBeenCalledTimes(1));
  });

  it("PATCH 실패 시 리로드하지 않는다(롤백 경로 — 목록은 원래 값이 이미 진실)", async () => {
    updateQuoteMock.mockRejectedValueOnce(new Error("fail"));
    const { result, onCustomerListChanged } = setup();
    result.current.handlers.updateQuoteDecisionStatus("q-1", "contracting");
    await waitFor(() => expect(updateQuoteMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onCustomerListChanged).not.toHaveBeenCalled();
  });

  // 배치 11 B#3: 견적 삭제도 contractingQuote 파생의 입력 — 미리로드면 저장된 delivery.sourceQuoteId가
  // 죽은 견적 id로 승계 시드돼 출고 정보 저장이 400("이 고객의 견적이 아닙니다")에 막힌다(원 시나리오는
  // contracting 삭제 UI 가드가 차단 — 마킹 해제 후 삭제 경로가 실경로, 적대 검증 V2 재구성).
  it("견적 삭제 성공 시에도 목록 리로드를 호출한다", async () => {
    const { result, onCustomerListChanged } = setup();
    result.current.handlers.deleteQuote("q-1");
    await waitFor(() => expect(deleteQuoteMock).toHaveBeenCalledWith("cust-1", "q-1"));
    await waitFor(() => expect(onCustomerListChanged).toHaveBeenCalledTimes(1));
  });

  // 배치 11 B#4: contracting 견적의 대표 시나리오 변경 = 목록 contractingQuote.lender 입력.
  it("대표 시나리오 변경 성공 시에도 목록 리로드를 호출한다", async () => {
    const { result, onCustomerListChanged } = setup();
    result.current.handlers.setPrimaryScenario("q-1", "s-1");
    await waitFor(() => expect(updateQuoteMock).toHaveBeenCalledWith("cust-1", "q-1", { primaryScenarioId: "s-1" }));
    await waitFor(() => expect(onCustomerListChanged).toHaveBeenCalledTimes(1));
  });
});
