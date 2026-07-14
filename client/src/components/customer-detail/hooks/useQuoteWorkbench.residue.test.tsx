import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";

import type { Customer } from "@/data/customers";
import type { CustomerDetailData } from "@/lib/customers";
import type { QuoteItem } from "@/lib/quote-items";
import type { VehicleSelection } from "@/components/VehiclePicker";
import { DEFAULT_QUOTE_GUIDANCE, regionFromResidence } from "@/data/quote-guidance";
import { fetchQuoteRequestDetail } from "@/lib/quote-requests";
import { createQuote, requestSolutionQuote } from "@/lib/customer-quotes";

import { DEFAULT_CARD_UI } from "../quote-workbench-meta";
import { useQuoteWorkbench } from "./useQuoteWorkbench";
import type { useQuoteList } from "./useQuoteList";

vi.mock("@/lib/quote-requests", () => ({
  fetchQuoteRequestDetail: vi.fn(),
  fetchAppQuoteRequestsCached: vi.fn(async () => []),
}));

// 솔루션 조회 릴레이 + 저장 INSERT만 모킹(payload 관측용) — parse 헬퍼·타입 등 나머지는 원본 유지.
vi.mock("@/lib/customer-quotes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/customer-quotes")>()),
  requestSolutionQuote: vi.fn(),
  createQuote: vi.fn(),
}));

const fetchRequestDetail = vi.mocked(fetchQuoteRequestDetail);
const requestSolution = vi.mocked(requestSolutionQuote);
const createQuoteMock = vi.mocked(createQuote);

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

// 할인 구성 내역 저장본을 가진 견적(수정 진입 복원 검증) — 기본 할인 역산은 quote-workbench-meta.test.ts가 커버.
const editTargetWithDiscounts = {
  ...editTargetQuote,
  id: "q-edit-2",
  basePrice: "75300000",
  finalDiscount: "6500000",
  discountLines: [
    { label: "재구매 할인", amount: 500000, unit: "amount" },
    { label: "프로모션", amount: 1.5, unit: "percent" },
  ],
};

// 저장 guidance에 옛 고객 지역("확인 필요")이 박힌 견적 — 수정 진입 시 거주지 파생으로 덮이는지 검증.
const editStaleRegionQuote = {
  ...editTargetQuote,
  id: "q-edit-3",
  guidance: { deliveryComment: "", stockNotice: "", expectedDelivery: "", customerRegion: "확인 필요", keyPoints: [], recommendReason: "", services: [] },
};

const detail = {
  residence: "인천광역시 · 남동구",
  quotes: [editTargetQuote, editTargetWithDiscounts, editStaleRegionQuote],
} as unknown as CustomerDetailData;
const customer = { id: "cust-1", customerId: "CU-TEST-0001", name: "테스트" } as Customer;

function quoteListStub() {
  return {
    quotes: [],
    setQuotes: vi.fn(), // persistWorkbenchQuote 낙관 갱신 경로(quoteList.setQuotes) — 솔루션 저장 payload 테스트가 통과한다
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

// 이전 세션(수정 진입 등)이 남긴 카드 UI 상태를 주입한다 — 카드 모드·할인 행·취득세 모드.
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

// 카드 UI 상태가 비면 모든 카드가 DEFAULT_CARD_UI로 폴백한다(cardUiOf) — 통합 전 "Record 8벌 전부 {}"와 동치.
function expectCardUiCleared(result: ReturnType<typeof setup>["result"]) {
  expect(result.current.cardUi).toEqual({});
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

  it("openEditQuote(수정 진입)가 저장된 고객 지역을 무시하고 거주지에서 재파생한다", () => {
    const { result } = setup();
    act(() => result.current.openEditQuote(editStaleRegionQuote as unknown as QuoteItem));
    // 저장본 customerRegion은 "확인 필요"지만 거주지(인천광역시 · 남동구, 구/시까지)로 덮인다.
    expect(result.current.guidance.customerRegion).toBe("인천광역시 남동구");
    expect(result.current.guidance.customerRegion).toBe(regionFromResidence(detail.residence));
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
    // 기간 60은 시드값이자 기본값이라 DEFAULT_CARD_UI와 같다.
    expect(result.current.cardUi).toEqual({ "manual-condition-1": { ...DEFAULT_CARD_UI, depositMode: "percent" } });
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

  it("openEditQuote(수정 진입)가 견적의 acquisitionTaxMode를 복원하고, 구성 내역 없는 견적은 할인 행 잔상을 청소한다", () => {
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
    expect(result.current.discountLines).toEqual([]); // discount_lines 없는 견적 = 빈 복원(잔상 청소 겸)
    expect(result.current.cardUi).toEqual({}); // 시나리오 없는 견적 = 빈 복원(카드 모드 잔상도 함께 청소)
  });

  it("openEditQuote(수정 진입)가 저장된 할인 구성 내역을 복원한다 — 잔상이 아니라 저장본이 남는다", () => {
    const { result } = setup();
    injectResidue(result); // 잔상 1행("재구매 할인" 기본 생성) — 복원이 통째로 대체해야 함
    act(() =>
      result.current.openEditQuote({
        id: "q-edit-2",
        decisionStatus: null,
        trimId: null,
        financeType: "운용리스",
        source: "manual",
      } as unknown as QuoteItem),
    );
    // 표시값 규약: amount 행은 콤마 포맷, percent 행은 원문(소수 보존). id는 매번 새로 발급이라 비교 제외.
    expect(result.current.discountLines.map(({ label, amount, unit }) => ({ label, amount, unit }))).toEqual([
      { label: "재구매 할인", amount: "500,000", unit: "amount" },
      { label: "프로모션", amount: "1.5", unit: "percent" },
    ]);
  });
});

// ── 솔루션 조회(queryCardSolution) — DOM 계약 최소 재현 픽스처 ─────────────────────────────
// QuoteWorkbench 마크업의 data-scenario-card/data-sc-field/data-pricing 계약을 훅 ref에 직접 배선.

function buildCardDom(condId: string, values: Record<string, string> = {}) {
  const card = document.createElement("section");
  card.dataset.scenarioCard = condId;
  const lender = document.createElement("select");
  lender.dataset.scField = "lender";
  for (const label of ["미선택", "iM캐피탈"]) {
    const option = document.createElement("option");
    option.value = label;
    option.textContent = label;
    lender.append(option);
  }
  lender.value = values.lender ?? "미선택";
  card.append(lender);
  for (const field of ["deposit", "downPayment", "residual", "subsidy", "monthly", "interestRate", "totalReturn", "totalTakeover", "dueAtDelivery"]) {
    const input = document.createElement("input");
    input.dataset.scField = field;
    input.value = values[field] ?? "0";
    card.append(input);
  }
  return card;
}

function buildPricingDom() {
  const root = document.createElement("section");
  for (const key of ["base", "option", "discount", "acquisitionTax", "bond", "delivery", "incidental"]) {
    const input = document.createElement("input");
    input.dataset.pricing = key;
    input.value = "0";
    root.append(input);
  }
  return root;
}

// trimDetail 동봉 — applyTrimToPricing이 fetch 없이 차량 상태(brand/model/mcCode)와 가격패널 base를 시드.
const vehicleSelection = {
  brand: { name: "BMW" },
  model: { name: "5시리즈" },
  trim: { id: 1, name: "520i", mcCode: "MC-520I" },
  trimDetail: {
    id: 1, name: "520i", trimName: "520i", modelName: "5시리즈", modelYear: 2026, mcCode: "MC-520I",
    price: 50_000_000, financialDiscountAmount: 0, options: [], optionRelations: [], colors: [],
  },
} as unknown as VehicleSelection;

// 파트너 정상 응답(parseSolutionQuoteResult 통과 형태).
const partnerResponse = {
  ok: true,
  quote: {
    monthlyPayment: 1_234_567,
    rates: { annualRateDecimal: 0.0532, effectiveAnnualRateDecimal: 0.0555 },
    residual: { amount: 20_000_000, rateDecimal: 0.4 },
    workbookImport: { versionLabel: "2026-07 v2" },
    warnings: [],
  },
};

// 가격패널·비교카드 폼 DOM을 문서에 붙이고(isConnected 판별 전제) 차량 상태를 시드한다.
async function setupSolutionDom(result: ReturnType<typeof setup>["result"]) {
  const pricingRoot = buildPricingDom();
  const compareForm = document.createElement("div");
  document.body.append(pricingRoot, compareForm);
  result.current.pricingPanelRef.current = pricingRoot;
  result.current.quoteDetailFormRef.current = compareForm;
  await act(async () => { await result.current.handlers.applyTrimToPricing(vehicleSelection); });
  return { pricingRoot, compareForm };
}

// 작성완료(saveQuoteDetailDraft) → 모킹된 createQuote가 받은 INSERT payload의 시나리오 배열.
// 스냅샷 오염/보존은 저장 payload가 최종 관측점(AppCardModel은 파생 라벨만 담아 스냅샷을 노출하지 않는다).
async function savedScenarios(result: ReturnType<typeof setup>["result"]) {
  createQuoteMock.mockClear(); // 호출 기록은 테스트 간 누적 — 이번 저장 1건만 관측
  createQuoteMock.mockResolvedValue({ id: "srv-q-1", quoteCode: "QT-2607-0001", createdAt: "2026-07-14T00:00:00.000Z" });
  await act(async () => { result.current.handlers.saveQuoteDetailDraft(); });
  expect(createQuoteMock).toHaveBeenCalledTimes(1);
  return createQuoteMock.mock.calls[0][1].scenarios ?? [];
}

describe("useQuoteWorkbench — 솔루션 조회 결과 반영·늦은 응답 잔상 가드", () => {
  it("조회 성공: 카드 input에 결과를 채우고 스냅샷이 저장 payload 시나리오에 동봉된다(가드 대조군)", async () => {
    const { result } = setup();
    const { pricingRoot, compareForm } = await setupSolutionDom(result);
    const card = buildCardDom("manual-condition-1", { lender: "iM캐피탈" });
    compareForm.append(card);
    requestSolution.mockResolvedValue(partnerResponse);
    await act(async () => { await result.current.handlers.queryCardSolution("manual-condition-1"); });
    expect(card.querySelector<HTMLInputElement>('input[data-sc-field="monthly"]')!.value).toBe("1,234,567");
    expect(card.querySelector<HTMLInputElement>('input[data-sc-field="interestRate"]')!.value).toBe("5.32");
    const scenarios = await savedScenarios(result);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]).toMatchObject({
      monthlyPayment: "1234567",
      solutionLenderCode: "im-capital",
      solutionWorkbookVersion: "2026-07 v2",
    });
    pricingRoot.remove();
    compareForm.remove();
  });

  it("늦은 응답 가드: 조회 중 카드가 언마운트(견적 전환)되면 stale 스냅샷을 병합하지 않는다(#163 잔상 부류)", async () => {
    const { result } = setup();
    const { pricingRoot, compareForm } = await setupSolutionDom(result);
    const staleCard = buildCardDom("manual-condition-1", { lender: "iM캐피탈" });
    compareForm.append(staleCard);
    let resolveLate!: (v: unknown) => void;
    requestSolution.mockImplementation(() => new Promise((r) => { resolveLate = r; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.handlers.queryCardSolution("manual-condition-1"); });
    // 워크벤치 전환 시뮬레이션 — 카드 key 리마운트로 구 노드 detach + 다음 견적의 같은 슬롯 카드 attach(월납입 수기 입력).
    staleCard.remove();
    const nextCard = buildCardDom("manual-condition-1", { lender: "iM캐피탈", monthly: "1,200,000" });
    compareForm.append(nextCard);
    await act(async () => { resolveLate(partnerResponse); await pending; });
    // 다음 견적을 작성완료 — 채워진 카드의 시나리오는 저장되지만, 이전 견적 조건으로 계산된 스냅샷은 없어야 한다.
    const scenarios = await savedScenarios(result);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].monthlyPayment).toBe("1200000"); // 카드 자체는 채워짐(빈 추출로 인한 공허 통과 방지)
    expect(scenarios[0].solutionLenderCode).toBeUndefined(); // 가드 없으면 "im-capital"이 저장 payload에 오염된다
    expect(nextCard.querySelector<HTMLInputElement>('input[data-sc-field="monthly"]')!.value).toBe("1,200,000"); // 늦은 응답이 새 카드 입력을 덮지 않음
    pricingRoot.remove();
    compareForm.remove();
  });
});
