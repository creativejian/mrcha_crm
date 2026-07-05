import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";

import type { Customer } from "@/data/customers";
import type { CustomerDetailData } from "@/lib/customers";
import type { QuoteItem } from "@/lib/quote-items";
import { DEFAULT_QUOTE_GUIDANCE, regionFromResidence } from "@/data/quote-guidance";
import { fetchQuoteRequestDetail } from "@/lib/quote-requests";

import { useQuoteWorkbench } from "./useQuoteWorkbench";
import type { useQuoteList } from "./useQuoteList";

vi.mock("@/lib/quote-requests", () => ({
  fetchQuoteRequestDetail: vi.fn(),
  fetchAppQuoteRequestsCached: vi.fn(async () => []),
}));

const fetchRequestDetail = vi.mocked(fetchQuoteRequestDetail);

// 수정 진입 복원 검증용 견적(취득세 hybrid 저장본). 시나리오 없음 — 카드 복원은 빈 카드 폴백.
const editTargetQuote = {
  id: "q-edit-1",
  acquisitionTaxMode: "hybrid",
  scenarios: [],
  options: [],
  exteriorColorId: null,
  interiorColorId: null,
  basePrice: "0",
  optionTotal: "0",
  finalDiscount: "0",
  acquisitionTax: "0",
  bond: "0",
  delivery: "0",
  incidental: "0",
  guidance: null,
};

const detail = {
  residence: "서울 강남구",
  quotes: [editTargetQuote],
} as unknown as CustomerDetailData;
const customer = { customerId: "CU-TEST-0001", name: "테스트" } as Customer;

function quoteListStub() {
  return {
    quotes: [],
    handlers: {
      setConfirmingQuoteDeleteId: vi.fn(),
      setConfirmingQuoteSendId: vi.fn(),
      setConfirmingQuoteContractId: vi.fn(),
      setConfirmingQuoteContractEditId: vi.fn(),
      setOpenQuoteActionId: vi.fn(),
      setQuoteActionFrame: vi.fn(),
      setQuotes: vi.fn(),
    },
  } as unknown as ReturnType<typeof useQuoteList>;
}

function setup() {
  return renderHook(
    () =>
      useQuoteWorkbench({
        detail,
        customer,
        onToast: vi.fn(),
        markRecentUpdate: vi.fn(),
        quoteList: quoteListStub(),
        purchaseFields: [{ label: "구매방식", value: "운용리스" }],
        reloadAppRequests: vi.fn(),
      }),
    { wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter> },
  );
}

// 이전 세션(수정 진입 등)이 남긴 카드 UI 상태를 주입한다 — 모드 Record·할인 행·취득세 모드.
function injectResidue(result: ReturnType<typeof setup>["result"]) {
  act(() => {
    result.current.handlers.setManualDepositMode("manual-condition-1", "percent");
    result.current.handlers.setManualDownPaymentMode("manual-condition-1", "amount");
    result.current.handlers.setManualResidualMode("manual-condition-1", "percent");
    result.current.handlers.setManualMileageMode("manual-condition-1", "custom");
    result.current.handlers.setManualMileageValue("manual-condition-1", "30,000km / 년");
    result.current.handlers.addDiscountLine();
    result.current.handlers.setAcquisitionTaxMode("electric");
  });
}

function expectCardUiCleared(result: ReturnType<typeof setup>["result"]) {
  expect(result.current.manualDepositModes).toEqual({});
  expect(result.current.manualDownPaymentModes).toEqual({});
  expect(result.current.manualResidualModes).toEqual({});
  expect(result.current.manualMileageModes).toEqual({});
  expect(result.current.manualMileageValues).toEqual({});
  expect(result.current.discountLines).toEqual([]);
  expect(result.current.acquisitionTaxMode).toBe("normal");
}

describe("useQuoteWorkbench — 오픈/리셋 경로의 카드 UI 상태 잔상 (extractWorkbenchScenarios/persist가 읽어 저장까지 오염)", () => {
  it("openNewWorkbench(견적함 +)가 이전 세션 모드·할인·취득세 잔상을 청소한다", () => {
    const { result } = setup();
    injectResidue(result);
    act(() => result.current.openNewWorkbench());
    expectCardUiCleared(result);
  });

  it("resetQuoteWorkbench(초기화 버튼)가 모드·할인·취득세·guidance까지 초기화한다", () => {
    const { result } = setup();
    injectResidue(result);
    act(() => result.current.handlers.setGuidance((g) => ({ ...g, deliveryComment: "즉시 출고" })));
    act(() => result.current.handlers.resetQuoteWorkbench());
    expectCardUiCleared(result);
    expect(result.current.guidance).toEqual({ ...DEFAULT_QUOTE_GUIDANCE, customerRegion: regionFromResidence(detail.residence) });
  });

  it("openWorkbenchForQuoteRequest(승격)가 잔상을 청소한 뒤 시드 모드만 남긴다", async () => {
    fetchRequestDetail.mockResolvedValue({
      period: 60,
      depositType: "deposit",
      depositRatio: 20,
      rentalDeposit: null,
      purchaseMethod: "운용리스",
      trimId: null,
      optionIds: [],
    } as unknown as Awaited<ReturnType<typeof fetchQuoteRequestDetail>>);
    const { result } = setup();
    injectResidue(result);
    await act(async () => result.current.openWorkbenchForQuoteRequest("req-1"));
    // 시드가 세팅하는 보증금 %만 남고, 나머지 잔상(잔존가치/약정거리/할인/취득세)은 청소돼야 한다.
    expect(result.current.manualDepositModes).toEqual({ "manual-condition-1": "percent" });
    expect(result.current.manualResidualModes).toEqual({});
    expect(result.current.manualMileageModes).toEqual({});
    expect(result.current.manualMileageValues).toEqual({});
    expect(result.current.discountLines).toEqual([]);
    expect(result.current.acquisitionTaxMode).toBe("normal");
  });

  it("setDiscountLineLabel이 할인 행 항목명을 state에 반영한다(#157 select 미배선 — 프리뷰 라벨 스테일 픽스)", () => {
    const { result } = setup();
    act(() => result.current.handlers.addDiscountLine());
    const lineId = result.current.discountLines[0].id;
    expect(result.current.discountLines[0].label).toBe("재구매 할인"); // 생성 기본값
    act(() => result.current.handlers.setDiscountLineLabel(lineId, "제휴 할인"));
    expect(result.current.discountLines[0].label).toBe("제휴 할인");
  });

  it("openEditQuote(수정 진입)가 견적의 acquisitionTaxMode를 복원하고 할인 행 잔상을 청소한다", () => {
    const { result } = setup();
    injectResidue(result); // 잔상 electric — 복원 없으면 hybrid 견적이 electric으로 저장되는 데이터 오염
    act(() =>
      result.current.openEditQuote({
        id: "q-edit-1",
        decisionStatus: null,
        trimId: null,
        financeType: "운용리스",
        source: "manual",
      } as unknown as QuoteItem),
    );
    expect(result.current.acquisitionTaxMode).toBe("hybrid");
    expect(result.current.discountLines).toEqual([]);
  });
});
