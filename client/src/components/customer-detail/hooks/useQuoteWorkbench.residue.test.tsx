import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode, SyntheticEvent } from "react";
import { MemoryRouter } from "react-router";

import type { Customer } from "@/data/customers";
import type { CustomerDetailData } from "@/lib/customers";
import type { QuoteItem } from "@/lib/quote-items";
import type { VehicleSelection } from "@/components/customer-detail/WorkbenchVehiclePickers";
import { DEFAULT_QUOTE_GUIDANCE, regionFromResidence } from "@/data/quote-guidance";
import { fetchQuoteRequestDetail } from "@/lib/quote-requests";
import { createQuote, requestSolutionQuote } from "@/lib/customer-quotes";
import { fetchSolutionDealers } from "@/lib/solution-dealers";

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

// 판매사(딜러) 목록 릴레이(T2) — 기본 빈 목록(딜러 없음), 테스트별 mockResolvedValue로 채운다.
vi.mock("@/lib/solution-dealers", () => ({
  fetchSolutionDealers: vi.fn(async () => []),
}));

const fetchRequestDetail = vi.mocked(fetchQuoteRequestDetail);
const requestSolution = vi.mocked(requestSolutionQuote);
const createQuoteMock = vi.mocked(createQuote);
const fetchDealers = vi.mocked(fetchSolutionDealers);

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

// max 모드 + 솔루션 스냅샷 저장본 — 수정 재진입 시 잔가 표시값(DB residualValue는 max에서 null)이
// 스냅샷 raw의 실채택 잔가(20,000,000)로 재시드되는지 검증(무재조회 재저장 시 인수·금리 소실 방지).
const editSolutionMaxQuote = {
  ...editTargetQuote,
  id: "q-edit-4",
  scenarios: [{
    id: "sc-solution-1",
    scenarioNo: 1,
    purchaseMethod: "운용리스",
    lender: "iM캐피탈",
    termMonths: 60,
    monthlyPayment: "1234567",
    residualMode: "max",
    residualValue: null,
    isSaved: true,
    solutionLenderCode: "im-capital",
    solutionWorkbookVersion: "2026-07 v2",
    solutionCalculatedAt: "2026-07-14T02:00:00.000Z",
    solutionRaw: {
      ok: true,
      quote: { monthlyPayment: 1_234_567, rates: { annualRateDecimal: 0.0532 }, residual: { amount: 20_000_000 } },
    },
  }],
};

// solution 도입 이전 수기 견적(스냅샷 없음, interestRate = 수기 표면금리) — 실 DB QT-2606-0005 형태.
// 재진입 시 저장 카드 게이트(2-A)로 결과 4필드가 파생값에 덮이지 않고 보존되는지 검증한다.
const editLegacyManualQuote = {
  ...editTargetQuote,
  id: "q-edit-legacy",
  scenarios: [{
    id: "sc-legacy-1",
    scenarioNo: 1,
    purchaseMethod: "운용리스",
    lender: "iM캐피탈",
    termMonths: 60,
    monthlyPayment: "2398000",
    residualMode: "amount",
    residualValue: "5300000",
    interestRate: "11.3", // 수기 표면금리 — 실질 IRR 파생값(≠11.3)으로 덮이면 안 된다
    totalReturnCost: "143880000",
    totalTakeoverCost: "149180000",
    dueAtDelivery: "0",
    isSaved: true,
    // solution 스냅샷 필드 없음(solutionLenderCode/CalculatedAt/Raw = null)
  }],
};

const detail = {
  residence: "인천광역시 · 남동구",
  quotes: [editTargetQuote, editTargetWithDiscounts, editStaleRegionQuote, editSolutionMaxQuote, editLegacyManualQuote],
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
  const onToast = vi.fn();
  const hook = renderHook(
    () =>
      useQuoteWorkbench({
        detail,
        customer,
        onToast,
        markRecentUpdate: vi.fn(),
        quoteList: quoteListStub(),
        purchaseFields: [{ label: "구매방식", value: "운용리스" }],
        reloadAppRequests: vi.fn(),
      }),
    { wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter> },
  );
  return Object.assign(hook, { onToast });
}

// 이전 세션(수정 진입 등)이 남긴 카드 UI 상태를 주입한다 — 카드 모드·할인 행·취득세 모드.
function injectResidue(result: ReturnType<typeof setup>["result"]) {
  act(() => {
    result.current.handlers.setManualDepositMode("manual-condition-1", "percent");
    result.current.handlers.setManualDownPaymentMode("manual-condition-1", "amount");
    result.current.handlers.setManualResidualMode("manual-condition-1", "percent");
    result.current.handlers.setManualMileageMode("manual-condition-1", "custom");
    result.current.handlers.setManualMileageValue("manual-condition-1", "30,000km / 년");
    result.current.handlers.setManualDealerMode("manual-condition-1", "input");
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
  // 판매사 select(T2) — 프로덕션 option은 dealerOptionsByCard(비동기 fetch) 산물. 테스트는 값 대입이
  // 가능하도록 "" + 전달된 값을 정적 option으로 깐다(uncontrolled select 값 대입은 option 기존재가 전제).
  const dealer = document.createElement("select");
  dealer.dataset.scField = "dealer";
  for (const value of ["", ...(values.dealer ? [values.dealer] : [])]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value || "선택";
    dealer.append(option);
  }
  dealer.value = values.dealer ?? "";
  card.append(dealer);
  for (const field of ["deposit", "downPayment", "residual", "subsidy", "cmFeePercent", "agFeePercent", "monthly", "interestRate", "totalReturn", "totalTakeover", "dueAtDelivery"]) {
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
  it("조회 성공: 월납입(표시 라운딩)·잔가 채움 + 결과 4필드는 리스계산기 파생 + 스냅샷이 저장 payload에 동봉된다(가드 대조군)", async () => {
    const { result } = setup();
    const { pricingRoot, compareForm } = await setupSolutionDom(result);
    const card = buildCardDom("manual-condition-1", { lender: "iM캐피탈", cmFeePercent: "1.5", agFeePercent: "2" });
    compareForm.append(card);
    requestSolution.mockResolvedValue(partnerResponse);
    await act(async () => { await result.current.handlers.queryCardSolution("manual-condition-1"); });
    const cardField = (f: string) => card.querySelector<HTMLInputElement>(`input[data-sc-field="${f}"]`)!.value;
    expect(cardField("monthly")).toBe("1,234,600"); // 운용리스 표시 라운딩(100원 올림 — 개정 2 R4, 원값 1,234,567은 raw 스냅샷)
    expect(cardField("residual")).toBe("20,000,000"); // 최대 모드 실채택 잔가(제프 응답) — 파생의 잔가 입력
    // 결과 4필드 = 제프 응답이 아니라 파생값: 취득원가 50,000,000·기간 60·선수금/보증금 0·기타비용 0 기준.
    expect(cardField("totalReturn")).toBe("74,076,000"); // 1,234,600×60 + 0
    expect(cardField("totalTakeover")).toBe("94,076,000"); // + 잔가 20,000,000
    expect(cardField("dueAtDelivery")).toBe("0"); // 보증금 0 + 선수금 0 + 기타비용 0
    expect(cardField("interestRate")).toBe("23.16"); // RATE 역산 실질 금리(제프 표면금리 5.32와 다름 — 개정 1 의미론)
    const scenarios = await savedScenarios(result);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]).toMatchObject({
      monthlyPayment: "1234600",
      totalReturnCost: "74076000",
      totalTakeoverCost: "94076000",
      dueAtDelivery: null, // 파생 0 → nz()가 null 처리(가짜 0 영속 방지)
      interestRate: "23.16",
      // CM/AG %(#264) — 추출(저장 스냅샷)이 카드 DOM 입력을 payload에 싣는지 잠금(상이 값 = 교차 배선 검출).
      cmFeePercent: "1.5",
      agFeePercent: "2",
      solutionLenderCode: "im-capital",
      solutionWorkbookVersion: "2026-07 v2",
    });
    pricingRoot.remove();
    compareForm.remove();
  });

  it("수정 재진입: max 모드 + 스냅샷 견적은 잔가 표시값을 스냅샷 실채택 잔가로 재시드한다(무재조회 재저장 인수·금리 보존)", () => {
    const { result } = setup();
    act(() =>
      result.current.openEditQuote({
        id: "q-edit-4",
        decisionStatus: null,
        trimId: null,
        financeType: "운용리스",
        source: "solution",
      } as unknown as QuoteItem),
    );
    // 구현 전엔 "-"(placeholder) → 파생이 잔가 null로 보고 인수·금리를 "0"으로 덮었다(조용한 소실).
    expect(result.current.manualQuoteCards[0].residualValue).toBe("20,000,000");
  });

  it("2-A 저장 카드 게이트: 레거시 견적(수기 금리) 재진입은 결과 4필드를 파생값으로 덮지 않는다", async () => {
    const { result } = setup();
    const { pricingRoot, compareForm } = await setupSolutionDom(result);
    // QuoteWorkbench가 렌더하는 저장값 DOM을 수동 시드(훅만 렌더하므로) — 저장 금리 11.3%.
    const card = buildCardDom("manual-condition-1", {
      lender: "iM캐피탈", monthly: "2,398,000", residual: "5,300,000", interestRate: "11.3",
    });
    compareForm.append(card);
    // openEditQuote가 전 시나리오를 saved로 세팅 → deriveAndFillCardResults(effect)가 저장 카드를 건너뛴다.
    await act(async () => { result.current.openEditQuote({ id: "q-edit-legacy" } as unknown as QuoteItem); });
    const interestRate = card.querySelector<HTMLInputElement>('input[data-sc-field="interestRate"]')!.value;
    expect(interestRate).toBe("11.3"); // 게이트 없으면 실질 IRR(≠11.3)로 덮여 재발송 시 저장값이 조용히 바뀐다
    pricingRoot.remove();
    compareForm.remove();
  });

  it("계산기 3분기(개정 2 R4): 미선택 → 랭킹 모달 / 행 선택 → 재호출 없이 카드 채움 / 미지원사 → 미취급 경고", async () => {
    const { result, onToast } = setup();
    const { pricingRoot, compareForm } = await setupSolutionDom(result);
    const card = buildCardDom("manual-condition-1"); // lender 기본값 = 미선택
    compareForm.append(card);
    requestSolution.mockClear();
    // ① 미선택 → 사전 검증(차량/가격 프로브) 통과 → 랭킹 모달 오픈. 병렬 배치는 모달 컴포넌트 몫이라
    //    훅 레벨에서는 호출 0(컴포넌트 테스트 SolutionLenderRankingModal.test.tsx가 배치를 잠근다).
    act(() => result.current.handlers.handleSolutionQueryClick("manual-condition-1"));
    expect(result.current.solutionLenderPickerId).toBe("manual-condition-1");
    expect(requestSolution).not.toHaveBeenCalled();
    // ② 랭킹 행 선택 → 재호출 없음(모달이 받아둔 raw 그대로 영속) + select 세팅 + 표시 월납입 채움 + 모달 닫힘
    const entry = {
      lenderCode: "im-capital" as const,
      label: "iM캐피탈",
      monthlyDisplay: 1_234_600,
      ratePct: 5.32,
      residualAmount: 20_000_000,
      residualPct: 40,
      totalCost: 1_234_600 * 60 + 20_000_000,
      warnings: [],
      raw: partnerResponse,
    };
    act(() => result.current.handlers.pickRankingEntry("manual-condition-1", entry));
    expect(card.querySelector<HTMLSelectElement>('select[data-sc-field="lender"]')!.value).toBe("iM캐피탈");
    expect(card.querySelector<HTMLInputElement>('input[data-sc-field="monthly"]')!.value).toBe("1,234,600");
    expect(result.current.solutionLenderPickerId).toBeNull();
    expect(requestSolution).not.toHaveBeenCalled(); // 행 선택은 재계산하지 않는다(개정 2 R4-3)
    // ③ 미지원사(레거시 저장 어휘) → 계산 없이 경고 토스트(R1-3, 카드 불변)
    const select = card.querySelector<HTMLSelectElement>('select[data-sc-field="lender"]')!;
    const legacy = document.createElement("option");
    legacy.value = "우리금융캐피탈";
    legacy.textContent = "우리금융캐피탈";
    select.append(legacy);
    select.value = "우리금융캐피탈";
    act(() => result.current.handlers.handleSolutionQueryClick("manual-condition-1"));
    expect(requestSolution).not.toHaveBeenCalled(); // 증가 없음
    expect(onToast).toHaveBeenCalledWith("「우리금융캐피탈」은(는) 솔루션 미취급 금융사입니다 — 수기로 작성해 주세요");
    pricingRoot.remove();
    compareForm.remove();
  });

  it("파생 % 상한 미러: 선수금 콤마 오입력(45,5 → 455%)은 파생값에 미반영(0 처리 — 무음 부풀림 차단)", async () => {
    const { result } = setup();
    const { pricingRoot, compareForm } = await setupSolutionDom(result);
    const card = buildCardDom("manual-condition-1", { monthly: "1,200,000", downPayment: "45,5" });
    compareForm.append(card);
    // 선수금 % 모드 전환 → 동기화 effect(cardUi dep)가 파생 재계산. 조회 경로(빌더)는 토스트 fail-loud지만
    // 수기 파생 경로는 매 키스트로크라 0 처리로 오염만 차단(residualAmountOf와 동일 상한 의미론).
    act(() => result.current.handlers.setManualDownPaymentMode("manual-condition-1", "percent"));
    const totalReturn = card.querySelector<HTMLInputElement>('input[data-sc-field="totalReturn"]')!.value;
    expect(totalReturn).toBe("72,000,000"); // 1,200,000×60 + 선수금 0(455%는 미반영 — 상한 없으면 299,500,000)
    pricingRoot.remove();
    compareForm.remove();
  });

  it("Esc 모달 우선 분기: 금융사 모달만 닫고 워크벤치는 유지, 다음 Esc가 워크벤치를 닫는다", async () => {
    const { result } = setup();
    act(() => result.current.openNewWorkbench()); // Esc 리스너는 워크벤치 열림 상태에서만 부착(차량 리셋보다 먼저)
    const { pricingRoot, compareForm } = await setupSolutionDom(result); // 모달 오픈 사전 검증(차량/가격 프로브) 충족
    compareForm.append(buildCardDom("manual-condition-1")); // lender 미선택 → 클릭 시 모달
    act(() => result.current.handlers.handleSolutionQueryClick("manual-condition-1"));
    expect(result.current.solutionLenderPickerId).toBe("manual-condition-1");
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(result.current.solutionLenderPickerId).toBeNull(); // 모달만 닫힘
    expect(result.current.isQuoteSolutionWorkbenchOpen).toBe(true); // 워크벤치 유지(유령 모달·통닫힘 방지)
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(result.current.isQuoteSolutionWorkbenchOpen).toBe(false); // 기존 규칙 불변
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

  it("2-C in-flight 모드 레이스: 조회 중 잔가 모드를 max→amount로 바꾸면 응답이 stale max로 residual을 덮지 않는다", async () => {
    const { result } = setup();
    const { pricingRoot, compareForm } = await setupSolutionDom(result);
    const card = buildCardDom("manual-condition-1", { lender: "iM캐피탈", residual: "7,000,000" });
    compareForm.append(card);
    let resolveLate!: (v: unknown) => void;
    requestSolution.mockImplementation(() => new Promise((r) => { resolveLate = r; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.handlers.queryCardSolution("manual-condition-1"); }); // 시작 모드 = max(기본)
    act(() => { result.current.handlers.setManualResidualMode("manual-condition-1", "amount"); }); // in-flight 중 모드 변경
    await act(async () => { resolveLate(partnerResponse); await pending; });
    // stale(max) 클로저면 residual을 파트너 잔가 20,000,000으로 덮었다 — cardUiRef로 최신 모드(amount)를 읽어 사용자 입력 보존.
    expect(card.querySelector<HTMLInputElement>('input[data-sc-field="residual"]')!.value).toBe("7,000,000");
    pricingRoot.remove();
    compareForm.remove();
  });
});

// ── 판매사(딜러) T2 — 모드 게이트·전사 프로브 strip·금융사 변경 리셋 ─────────────────────────────
// 값의 진실 원본 = 카드 DOM select(data-sc-field="dealer", uncontrolled) — 금융사 select 계약 미러.

describe("useQuoteWorkbench — 판매사(딜러) 조회 payload·영속·리셋", () => {
  it("판매사 입력 모드: 직접 계산 payload에 dealerName 동봉(해당 금융사 단일 요청) + 저장 시나리오에 plain dealer_name 영속", async () => {
    const { result } = setup();
    const { pricingRoot, compareForm } = await setupSolutionDom(result);
    const card = buildCardDom("manual-condition-1", { lender: "iM캐피탈", dealer: "도이치모터스" });
    compareForm.append(card);
    act(() => result.current.handlers.setManualDealerMode("manual-condition-1", "input"));
    requestSolution.mockClear();
    requestSolution.mockResolvedValue(partnerResponse);
    await act(async () => { await result.current.handlers.queryCardSolution("manual-condition-1"); });
    // 직접 계산은 금융사가 동일 값(멱등)이라 딜러 리셋이 발동하면 안 된다 — 리셋되면 아래 payload·저장이 비어 실패.
    expect(requestSolution).toHaveBeenCalledWith(expect.objectContaining({ dealerName: "도이치모터스" }));
    const scenarios = await savedScenarios(result);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].dealerName).toBe("도이치모터스"); // plain 이름(계산기 `lenderCode::dealerName` 합성 아님)
    pricingRoot.remove();
    compareForm.remove();
  });

  it("비제휴 계산(기본 모드): DOM에 딜러 값이 남아 있어도 조회 payload 미전송·저장 null(모드 게이트)", async () => {
    const { result } = setup();
    const { pricingRoot, compareForm } = await setupSolutionDom(result);
    const card = buildCardDom("manual-condition-1", { lender: "iM캐피탈", dealer: "도이치모터스" });
    compareForm.append(card);
    requestSolution.mockClear();
    requestSolution.mockResolvedValue(partnerResponse);
    await act(async () => { await result.current.handlers.queryCardSolution("manual-condition-1"); });
    expect(requestSolution.mock.calls[0][0].dealerName).toBeUndefined();
    const scenarios = await savedScenarios(result);
    expect(scenarios[0].dealerName).toBeNull();
    pricingRoot.remove();
    compareForm.remove();
  });

  it("랭킹 모달 조립(buildCardSolutionBaseArgs)은 딜러를 항상 벗긴다 — 전사 병렬 프로브의 타사 무음 오염 구조 차단", async () => {
    const { result } = setup();
    const { pricingRoot, compareForm } = await setupSolutionDom(result);
    const card = buildCardDom("manual-condition-1", { lender: "iM캐피탈", dealer: "도이치모터스" });
    compareForm.append(card);
    act(() => result.current.handlers.setManualDealerMode("manual-condition-1", "input"));
    // 같은 카드·같은 조건 — 직접 계산 조립엔 실리는 값(위 테스트)이 프로브 조립에선 null이어야 한다.
    expect(result.current.handlers.buildCardSolutionBaseArgs("manual-condition-1")?.dealerName).toBeNull();
    pricingRoot.remove();
    compareForm.remove();
  });

  it("금융사 변경(델리게이션 이벤트): 딜러 선택 리셋(타사 딜러 잔존 = 무음 오계산) + (금융사,브랜드) 목록 적재", async () => {
    const { result } = setup();
    const { pricingRoot, compareForm } = await setupSolutionDom(result); // 브랜드 = BMW
    const card = buildCardDom("manual-condition-1", { lender: "미선택", dealer: "도이치모터스" }); // 잔존 딜러 재현
    compareForm.append(card);
    fetchDealers.mockClear();
    fetchDealers.mockResolvedValue([{ dealerName: "바바리안모터스", baseIrrRate: 0.0681 }]);
    const lenderSelect = card.querySelector<HTMLSelectElement>('select[data-sc-field="lender"]')!;
    lenderSelect.value = "iM캐피탈"; // 사용자 변경 재현 — uncontrolled select는 실변경에서만 change/input 발화
    await act(async () => {
      result.current.handlers.handleManualCardFieldEdit({ target: lenderSelect } as unknown as SyntheticEvent<HTMLElement>);
      await new Promise((resolve) => setTimeout(resolve, 0)); // fetch(mock)·setState 마이크로태스크 소진
    });
    expect(domField(card, "dealer")).toBe("");
    expect(fetchDealers).toHaveBeenCalledWith("im-capital", "BMW");
    expect(result.current.dealerOptionsByCard["manual-condition-1"]).toEqual([{ dealerName: "바바리안모터스", baseIrrRate: 0.0681 }]);
    pricingRoot.remove();
    compareForm.remove();
  });
});

// 승격 컬러 프리필(2026-07-14): selected 요청 → 워크벤치 외장/내장 프리필. applyTrimToPricing이 catalog
// detail.colors에서 id로 TrimColor를 찾는다(옵션 프리필과 대칭 — qrPrefill 폴백). 비 selected면 id null → 미프리필.
const vehicleSelectionWithColors = {
  ...vehicleSelection,
  trimDetail: {
    ...vehicleSelection.trimDetail,
    colors: [
      { id: 101, colorType: "exterior", name: "케이프 요크 그린", code: "C5Y", hexValue: "#3a4a3a", sortOrder: 1 },
      { id: 202, colorType: "interior", name: "에스프레소 브라운", code: null, hexValue: "#3a2a1a", sortOrder: 1 },
    ],
  },
} as unknown as VehicleSelection;

describe("useQuoteWorkbench — 승격 컬러 프리필", () => {
  it("selected 컬러 id로 외장·내장을 프리필한다", async () => {
    fetchRequestDetail.mockResolvedValue({
      period: 60, depositType: "deposit", depositRatio: 20, rentalDeposit: null,
      purchaseMethod: "운용리스", trimId: 1, optionIds: [],
      exteriorColorId: 101, interiorColorId: 202,
    } as unknown as Awaited<ReturnType<typeof fetchQuoteRequestDetail>>);
    const { result } = setup();
    await act(async () => result.current.openWorkbenchForQuoteRequest("req-1"));
    await act(async () => { await result.current.handlers.applyTrimToPricing(vehicleSelectionWithColors); });
    expect(result.current.exteriorColor?.id).toBe(101);
    expect(result.current.interiorColor?.id).toBe(202);
  });

  it("컬러 id 없으면(비 selected) 외장·내장을 프리필하지 않는다", async () => {
    fetchRequestDetail.mockResolvedValue({
      period: 60, depositType: "deposit", depositRatio: 20, rentalDeposit: null,
      purchaseMethod: "운용리스", trimId: 1, optionIds: [],
      exteriorColorId: null, interiorColorId: null,
    } as unknown as Awaited<ReturnType<typeof fetchQuoteRequestDetail>>);
    const { result } = setup();
    await act(async () => result.current.openWorkbenchForQuoteRequest("req-1"));
    await act(async () => { await result.current.handlers.applyTrimToPricing(vehicleSelectionWithColors); });
    expect(result.current.exteriorColor).toBeNull();
    expect(result.current.interiorColor).toBeNull();
  });
});

// ── N번 조건 복사(비교카드 헤더 "1번 복사"/"2번 복사") ─────────────────────────────
// 값의 진실 원본이 uncontrolled DOM(금융사 select·금액 input)이라 state가 아닌 카드 DOM을 직접 대조한다.

function setupCopyDom(result: ReturnType<typeof setup>["result"], sourceValues: Record<string, string> = {}) {
  const compareForm = document.createElement("div");
  document.body.append(compareForm);
  result.current.quoteDetailFormRef.current = compareForm;
  const card1 = buildCardDom("manual-condition-1", sourceValues);
  const card2 = buildCardDom("manual-condition-2");
  const card3 = buildCardDom("manual-condition-3");
  compareForm.append(card1, card2, card3);
  return { card1, card2, card3 };
}

const domField = (card: HTMLElement, f: string) =>
  card.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-sc-field="${f}"]`)!.value;

describe("useQuoteWorkbench — N번 조건 복사(비교카드 헤더)", () => {
  it("1번 복사: 금융사·조건 입력값(DOM)과 카드 UI 상태(기간/모드/약정거리/자동차세/보조금)를 카드2로 복사한다", () => {
    const hook = setup();
    const { result, onToast } = hook;
    const { card2 } = setupCopyDom(result, {
      lender: "iM캐피탈", deposit: "5,000,000", downPayment: "3,000,000", residual: "20,000,000", subsidy: "1,000,000",
      cmFeePercent: "1.5", agFeePercent: "2", dealer: "도이치모터스",
    });
    act(() => {
      result.current.handlers.setManualTermMonthsFor("manual-condition-1", 48);
      result.current.handlers.setManualDepositMode("manual-condition-1", "amount");
      result.current.handlers.setManualDownPaymentMode("manual-condition-1", "amount");
      result.current.handlers.setManualResidualMode("manual-condition-1", "amount");
      result.current.handlers.setManualMileageMode("manual-condition-1", "custom");
      result.current.handlers.setManualMileageValue("manual-condition-1", "30,000km / 년");
      result.current.handlers.setManualCarTaxFor("manual-condition-1", true);
      result.current.handlers.setManualSubsidyFor("manual-condition-1", true);
      result.current.handlers.setManualDealerMode("manual-condition-1", "input");
    });
    act(() => { result.current.handlers.copyManualQuoteCondition("manual-condition-2", "2"); });
    expect(domField(card2, "lender")).toBe("iM캐피탈");
    expect(domField(card2, "deposit")).toBe("5,000,000");
    expect(domField(card2, "downPayment")).toBe("3,000,000");
    expect(domField(card2, "residual")).toBe("20,000,000");
    expect(domField(card2, "subsidy")).toBe("1,000,000");
    // CM/AG %(#264) — 복사 루프(if (src && dst) null-가드)가 필드명 이탈 시 무음 no-op이라 여기서 잠근다.
    // 상이 값(1.5 ≠ 2)이라 cm↔ag 교차 배선도 정확히 실패한다.
    expect(domField(card2, "cmFeePercent")).toBe("1.5");
    expect(domField(card2, "agFeePercent")).toBe("2");
    // 판매사(T2): 딜러 option은 비동기 fetch 산물이라 값은 DOM 직접 쓰기가 아니라 ManualCard.dealerName
    // 재시드(딜러 select 리마운트 키 + defaultValue)로 복사된다 — 여기선 그 state 계약을 잠근다
    // (dealerMode 복사는 아래 cardUi 통째 비교가 커버).
    expect(result.current.manualQuoteCards.find((c) => c.id === "manual-condition-2")!.dealerName).toBe("도이치모터스");
    expect(result.current.cardUi["manual-condition-2"]).toEqual(result.current.cardUi["manual-condition-1"]);
    expect(onToast).toHaveBeenCalledWith("1번 조건을 복사했습니다.");
  });

  it("월납입·결과 4필드는 조회 파생값이라 복사하지 않는다", () => {
    const { result } = setup();
    const { card2 } = setupCopyDom(result, {
      lender: "iM캐피탈", monthly: "1,234,600", interestRate: "5.32",
      totalReturn: "80,000,000", totalTakeover: "95,000,000", dueAtDelivery: "5,000,000",
    });
    act(() => { result.current.handlers.copyManualQuoteCondition("manual-condition-2", "2"); });
    expect(domField(card2, "lender")).toBe("iM캐피탈"); // 복사 자체는 수행됐다(대조군)
    for (const f of ["monthly", "interestRate", "totalReturn", "totalTakeover", "dueAtDelivery"]) {
      expect(domField(card2, f)).toBe("0");
    }
  });

  it("2번 복사: 카드3은 카드2(직전 카드)에서 복사한다 — 카드1이 아니라", () => {
    const { result } = setup();
    const { card2, card3 } = setupCopyDom(result);
    const card2Lender = card2.querySelector<HTMLSelectElement>('select[data-sc-field="lender"]')!;
    card2Lender.value = "iM캐피탈";
    card2.querySelector<HTMLInputElement>('input[data-sc-field="deposit"]')!.value = "7,000,000";
    act(() => { result.current.handlers.setManualTermMonthsFor("manual-condition-2", 24); });
    act(() => { result.current.handlers.copyManualQuoteCondition("manual-condition-3", "3"); });
    expect(domField(card3, "lender")).toBe("iM캐피탈");
    expect(domField(card3, "deposit")).toBe("7,000,000");
    expect(result.current.cardUi["manual-condition-3"].termMonths).toBe(24);
  });

  it("저장(잠금)된 대상 카드에는 복사하지 않는다 — 버튼 disabled 미러 가드", () => {
    const { result } = setup();
    const { card2 } = setupCopyDom(result, { lender: "iM캐피탈", deposit: "5,000,000" });
    act(() => { result.current.handlers.saveManualQuoteCondition("manual-condition-2", "2"); });
    act(() => { result.current.handlers.copyManualQuoteCondition("manual-condition-2", "2"); });
    expect(domField(card2, "lender")).toBe("미선택");
    expect(domField(card2, "deposit")).toBe("0");
    expect(result.current.cardUi["manual-condition-2"]).toBeUndefined();
  });

  it("구 어휘 금융사(대상 select에 option 없음)는 무음 부분 복사 대신 토스트로 제외를 알린다 — 그 금융사 귀속인 딜러도 함께 제외", () => {
    const hook = setup();
    const { result, onToast } = hook;
    const { card1, card2 } = setupCopyDom(result, { deposit: "5,000,000", dealer: "모터원" });
    const legacyOption = document.createElement("option");
    legacyOption.value = "구캐피탈";
    legacyOption.textContent = "구캐피탈";
    const card1Lender = card1.querySelector<HTMLSelectElement>('select[data-sc-field="lender"]')!;
    card1Lender.append(legacyOption); // 수정 재진입 카드만 렌더하는 "구 어휘 표시 유지" option 재현
    card1Lender.value = "구캐피탈";
    act(() => { result.current.handlers.setManualDealerMode("manual-condition-1", "input"); });
    act(() => { result.current.handlers.copyManualQuoteCondition("manual-condition-2", "2"); });
    expect(domField(card2, "lender")).toBe("미선택"); // option 부재 — 세팅 무시
    expect(domField(card2, "deposit")).toBe("5,000,000"); // 나머지 조건은 복사됨
    // 딜러는 금융사 귀속 값 — 금융사가 복사에서 빠지면 딜러 재시드도 하지 않는다(타사 딜러 이식 방지).
    expect(result.current.manualQuoteCards.find((c) => c.id === "manual-condition-2")!.dealerName).toBe("");
    expect(onToast).toHaveBeenCalledWith('1번 조건을 복사했습니다. (금융사 "구캐피탈"은 지원 목록에 없어 제외)');
  });
});
