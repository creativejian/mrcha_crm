import { act, renderHook, waitFor } from "@testing-library/react";
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

const TEMP_ID = "kim-quote-workbench-1234567890";
const detail = {
  id: "d-1",
  quotes: [{ id: TEMP_ID, quoteCode: "QT-TEMP", status: "작성중", appStatus: "sent", scenarios: [] }],
} as unknown as CustomerDetailData;
const customer = { id: "cust-1", name: "김민준" } as Customer;

function setup() {
  const onToast = vi.fn();
  const hook = renderHook(() =>
    useQuoteList({ detail, customer, onToast, markRecentUpdate: vi.fn(), reloadAppRequests: vi.fn(), onCustomerListChanged: vi.fn() }),
  );
  return { ...hook, onToast };
}

// 낙관 카드(`kim-` temp id)는 아직 서버에 없다. 예전에는 가드가 API 호출만 건너뛰고 **성공 토스트는
// 그대로 나가서**, 사용자는 "지웠다/보냈다"고 믿는데 서버엔 반영이 없었다(삭제 확인창은 "고객 앱
// 견적함에서도 사라지며, 되돌릴 수 없습니다"까지 약속한다). 창은 INSERT 왕복 동안이고 워크벤치가
// "작성 후 발송"에서 동기적으로 닫혀 낙관 카드가 즉시 노출되므로 실제로 열린다.
// (2026-07-31 타깃 렌즈 배치 — fail-silent UI 경로)
describe("낙관 카드(temp id) 행 액션 차단", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("삭제: API를 부르지 않고 목록에서도 지우지 않는다(성공 토스트 대신 안내)", async () => {
    const { result, onToast } = setup();

    act(() => result.current.handlers.deleteQuote(TEMP_ID));

    expect(deleteQuoteMock).not.toHaveBeenCalled();
    // 화면에서 사라지면 사용자는 지워졌다고 믿는다 — 남아 있어야 한다.
    expect(result.current.quotes.some((quote) => quote.id === TEMP_ID)).toBe(true);
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("저장하는 중"));
    expect(onToast).not.toHaveBeenCalledWith(expect.stringContaining("삭제했습니다"));
  });

  it("앱 발송: API를 부르지 않고 발송완료로 표시하지도 않는다", async () => {
    const { result, onToast } = setup();

    act(() => result.current.handlers.sendQuoteToApp(TEMP_ID));

    expect(updateQuoteMock).not.toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("저장하는 중"));
    expect(onToast).not.toHaveBeenCalledWith(expect.stringContaining("발송했습니다"));
  });

  it("대표 시나리오·결정 상태도 같은 가드를 탄다", async () => {
    const { result } = setup();

    act(() => result.current.handlers.setPrimaryScenario(TEMP_ID, "s-1"));
    act(() => result.current.handlers.updateQuoteDecisionStatus(TEMP_ID, "contracting"));

    expect(updateQuoteMock).not.toHaveBeenCalled();
  });

  it("서버 id 견적은 그대로 통과한다(가드가 정상 경로를 막지 않는다)", async () => {
    const { result } = setup();

    act(() => result.current.handlers.deleteQuote("q-real-1"));

    await waitFor(() => expect(deleteQuoteMock).toHaveBeenCalledWith("cust-1", "q-real-1"));
  });
});
