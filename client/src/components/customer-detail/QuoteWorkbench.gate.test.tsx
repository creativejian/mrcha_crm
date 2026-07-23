import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import type { Customer } from "@/data/customers";
import type { CustomerDetailData } from "@/lib/customers";
import type { QuoteItem } from "@/lib/quote-items";
import type { SolutionRankingEntry } from "@/lib/solution-ranking";
import { resetSupportMatrixCache } from "@/lib/support-matrix";

import { QuoteWorkbench } from "./QuoteWorkbench";
import { useQuoteWorkbench } from "./hooks/useQuoteWorkbench";
import type { useQuoteList } from "./hooks/useQuoteList";

// ── 지원집합 게이트(spec 2026-07-21) 배선 회귀 그물 ─────────────────────────────────
// 순수 판정층(support-matrix.test.ts)·옵션 조립층(quote-workbench-meta.test.ts)은 이미 촘촘한데,
// **훅 ↔ 컴포넌트 배선층**(금융사 값 생명주기)이 무테스트였다. 배치 13 K1에서 거기서만 결함 4종이
// 나왔다(수정 진입 잔상·구매방식 전환·초기화·랭킹 선택).
//
// ⚠️ **배치 13 별건 ②c 이후**: 금융사 값의 진실이 구 거울(lenderByCard) + 매 커밋 재동기화 effect에서
// **카드 controlled state(manualQuoteCards[].lender)**로 옮겨졌다. 거울·effect는 폐기됐고, select는
// bindSelect로 controlled다. 그래서 이 스위트는 "거울 ≡ DOM"이 아니라 "게이트 ≡ 화면 금융사(=state)"를
// 잠근다. 아래 케이스가 여전히 유효한 이유: 게이트 결함군은 "화면 금융사와 게이트가 어긋난다"는 관계
// 결함이라, 진실이 거울이든 state든 그 관계 불변식은 그대로다(정책이 바뀌어도 유지된다).
//
// 그래서 이 파일은 훅 단독(renderHook)이 아니라 **실 컴포넌트를 렌더**한다 — 결함이 사는 배선층이 거기고,
// controlled select의 bindSelect·구매방식 전환 D4 정리도 실 컴포넌트에서만 관측된다. 각 케이스는 실
// 생명주기 전이를 arrange로 재현한다(단언 추가만으로는 안 잡힌다 — 배치 12 교훈).

vi.mock("@/lib/quote-requests", () => ({
  fetchQuoteRequestDetail: vi.fn(),
  fetchAppQuoteRequestsCached: vi.fn(async () => []),
}));

// 판매사 목록 릴레이 — 금융사 변경마다 호출된다(게이트와 무관, 빈 목록 고정).
vi.mock("@/lib/solution-dealers", () => ({ fetchSolutionDealers: vi.fn(async () => []) }));

// 차량 피커는 catalog fetch 덩어리 — 게이트와 무관하므로 스텁(실 API 차단).
vi.mock("./WorkbenchVehiclePickers", () => ({
  WorkbenchVehiclePicker: () => <div data-testid="vehicle-picker" />,
  WorkbenchOptionPicker: () => <div />,
  WorkbenchColorPicker: () => <div />,
}));

// 지원집합 매트릭스 목 — MG는 12·24개월 미취급 + 약정거리 3종, BNK는 전량 지원(대비군).
// 실 파트너 응답 구조 그대로 넣어 파싱층(parseSupportMatrix)까지 함께 통과시킨다.
const MATRIX_FIXTURE = {
  matrix: [
    { lenderCode: "mg-capital", productType: "operating_lease", leaseTermMonths: [36, 48, 60], annualMileageKm: [10000, 20000, 30000] },
    {
      lenderCode: "bnk-capital",
      productType: "operating_lease",
      leaseTermMonths: [12, 24, 36, 48, 60],
      annualMileageKm: [10000, 15000, 20000, 25000, 30000, 35000, 40000],
    },
  ],
};

vi.mock("@/lib/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http")>()),
  getJson: vi.fn(async (url: string) => (url.includes("support-matrix") ? MATRIX_FIXTURE : {})),
}));

// 수정 진입(케이스 3)용 저장본 — 시나리오 1장이 BNK캐피탈(=MG와 지원집합이 다른 금융사).
const bnkQuote = {
  id: "q-bnk",
  acquisitionTaxMode: "normal",
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
  scenarios: [
    {
      id: "sc-1",
      scenarioNo: 1,
      purchaseMethod: "운용리스",
      lender: "BNK캐피탈",
      termMonths: 60,
      monthlyPayment: "1000000",
      residualMode: "max",
      residualValue: null,
      mileageMode: "basic",
      mileageValue: "20,000km / 년",
      isSaved: true,
    },
  ],
};

// 레거시 어휘 금융사(현행 solutionLenderOptions·CRM_EXTRA 어디에도 없음)를 저장한 견적 — ②b 회피 검증용.
// 수정 재진입하면 그 값이 카드 lenderSeed로 시드돼 "구 어휘 표시 유지" option의 원천이 된다.
const legacyQuote = {
  ...bnkQuote,
  id: "q-legacy",
  scenarios: [{ ...bnkQuote.scenarios[0], id: "sc-legacy", lender: "구캐피탈" }],
};

const detail = { residence: "인천광역시 · 남동구", quotes: [bnkQuote, legacyQuote] } as unknown as CustomerDetailData;
const customer = { id: "cust-1", customerId: "CU-TEST-0001", name: "테스트" } as Customer;

function quoteListStub() {
  return {
    quotes: [],
    setQuotes: vi.fn(),
    handlers: {
      setConfirmingQuoteDeleteId: vi.fn(),
      setConfirmingQuoteSendId: vi.fn(),
      setConfirmingQuoteContractId: vi.fn(),
      setConfirmingQuoteContractEditId: vi.fn(),
      setOpenQuoteActionId: vi.fn(),
      setQuoteActionFrame: vi.fn(),
      closeQuoteActionPopover: vi.fn(), // 수정 진입의 팝오버 닫힘 단일 지점(배치 13 K2-a)
      setQuotes: vi.fn(),
    },
  } as unknown as ReturnType<typeof useQuoteList>;
}

type Workbench = ReturnType<typeof useQuoteWorkbench>;

// 훅 + 실 컴포넌트를 한 트리에 렌더한다. seam(openNewWorkbench/openEditQuote/pickRankingEntry)은
// 부모(CustomerDetailPage/QuoteList)가 부르는 자리라 핸들로 노출해 명령형 호출한다 — 그 외 조작은
// 전부 실제 DOM 이벤트(금융사 select·세그먼트 버튼·구매방식 메뉴·초기화/수정 버튼)로 몬다.
function setup() {
  const onToast = vi.fn();
  const ref: { current: Workbench | null } = { current: null };
  function Harness() {
    const workbench = useQuoteWorkbench({
      detail,
      customer,
      onToast,
      markRecentUpdate: vi.fn(),
      quoteList: quoteListStub(),
      purchaseFields: [{ label: "구매방식", value: "운용리스" }],
      reloadAppRequests: vi.fn(),
    });
    ref.current = workbench;
    return <QuoteWorkbench workbench={workbench} customer={customer} onToast={onToast} />;
  }
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  return { onToast, wb: () => ref.current! };
}

// ── DOM 조회 헬퍼(실 마크업 계약: data-scenario-card / data-sc-field) ─────────────
const card = (id = "manual-condition-1") => document.querySelector<HTMLElement>(`[data-scenario-card="${id}"]`)!;
const lenderSelect = (el: HTMLElement = card()) => el.querySelector<HTMLSelectElement>('select[data-sc-field="lender"]')!;
// 기간 세그먼트 = 유일하게 "NN개월" 라벨을 쓰는 버튼 그룹(보증금·잔가 등 다른 SegmentGroup과 구분).
const termButtons = (el: HTMLElement = card()) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).filter((b) => /^\d+개월$/.test(b.textContent ?? ""));
// 약정거리 select = option에 km 표기가 있는 유일한 select.
const mileageSelect = (el: HTMLElement = card()) =>
  Array.from(el.querySelectorAll<HTMLSelectElement>("select")).find((s) => Array.from(s.options).some((o) => o.value.includes("km")))!;
const mileageOptions = (el: HTMLElement = card()) => Array.from(mileageSelect(el).options).map((o) => o.value);

// 금융사 선택 = 실제 브라우저 발화 순서 재현(input → change). Safari는 controlled select에서 이 순서 때문에
// 선택이 유실되지만(select-bind.ts), 이 select는 bindSelect(onInput+onChange 병행)라 양쪽을 받는다(②c).
// ⚠️ 그래서 커밋 핸들러(setManualLender)는 **항상 2회** 돈다(setState 멱등) — 토스트 "횟수" 단언 금지.
function selectLender(value: string, el: HTMLElement = card()) {
  const select = lenderSelect(el);
  fireEvent.input(select, { target: { value } });
  fireEvent.change(select, { target: { value } });
}

async function flush() {
  // 매트릭스 fetch(목)·딜러 fetch(목)의 마이크로태스크 소진.
  await act(async () => {
    await Promise.resolve();
  });
}

async function openNewWorkbench(wb: () => Workbench) {
  await act(async () => {
    wb().openNewWorkbench();
  });
  await flush();
  await waitFor(() => expect(card()).toBeTruthy());
}

// ★ 불변식 — 게이트는 **화면 select가 실제로 보여주는 금융사(=controlled state)**를 따라야 한다.
// 값이 아니라 "관계"를 단언하는 게 핵심이다: 진실이 거울이든 state든, "초기화가 금융사를 지워야 하는가"
// 같은 별건 정책 결정과 무관하게 성립해야 하고, 정책이 바뀌어도 이 그물은 계속 유효하다.
function expectGateFollowsSelectedLender(el: HTMLElement = card()) {
  const lender = lenderSelect(el).value;
  const expectedDisabledTerms = lender === "MG캐피탈" ? ["12개월", "24개월"] : [];
  const expectedMileageCount = lender === "MG캐피탈" ? 3 : 7;
  expect(
    termButtons(el)
      .filter((b) => b.disabled)
      .map((b) => b.textContent),
  ).toEqual(expectedDisabledTerms);
  expect(mileageOptions(el)).toHaveLength(expectedMileageCount);
}

beforeEach(() => {
  resetSupportMatrixCache(); // 세션 캐시(모듈 전역) 케이스 간 누수 차단
});

describe("QuoteWorkbench 지원집합 게이트 — 렌더·폴백(대조군)", () => {
  it("MG캐피탈을 고르면 12·24개월이 비활성되고 약정거리가 지원 3종으로 줄어든다", async () => {
    const { wb } = setup();
    await openNewWorkbench(wb);

    // 게이트 전(금융사 미선택) = 전량 노출 — fail-open 기준선.
    expect(termButtons().filter((b) => b.disabled)).toHaveLength(0);
    expect(mileageOptions()).toHaveLength(7);

    selectLender("MG캐피탈");
    await flush();

    expect(termButtons().map((b) => `${b.textContent}:${b.disabled}`)).toEqual([
      "12개월:true",
      "24개월:true",
      "36개월:false",
      "48개월:false",
      "60개월:false",
    ]);
    expect(mileageOptions()).toEqual(["10,000km / 년", "20,000km / 년", "30,000km / 년"]);
  });

  it("24개월 상태에서 MG캐피탈로 바꾸면 60개월로 옮기고 사유를 알린다", async () => {
    const { wb, onToast } = setup();
    await openNewWorkbench(wb);

    fireEvent.click(termButtons().find((b) => b.textContent === "24개월")!);
    await flush();
    expect(wb().cardUi["manual-condition-1"].termMonths).toBe(24);

    selectLender("MG캐피탈");
    await flush();

    // 폴백은 금융사 변경 경로에서만 돈다(spec D3 정밀화) — 값 이동 + 화면 활성 표시 + 사유 고지.
    expect(wb().cardUi["manual-condition-1"].termMonths).toBe(60);
    expect(termButtons().find((b) => b.textContent === "60개월")!.className).toContain("active");
    // ⚠️ 호출 "횟수"는 단언하지 않는다 — input+change 이중 발화로 2회 도는 게 정상이고(멱등),
    // showToast가 단일 슬롯 교체라 사용자에겐 1회다. 문구만 잠근다.
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("기간 60개월"));
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("MG캐피탈 미취급"));
    // 약정거리 기본값 20,000km는 MG도 지원 → 함께 옮기지 않는다(문구에 미포함).
    expect(onToast).not.toHaveBeenCalledWith(expect.stringContaining("약정거리"));
  });
});

describe("QuoteWorkbench 지원집합 게이트 — 금융사 값 생명주기(배치 13 K1 회귀 그물 · ②c state 전환)", () => {
  it("수정 진입은 이전 세션 금융사 잔상을 물려받지 않는다(잠금 해제 직후 게이트는 저장본 금융사를 따른다)", async () => {
    const { wb } = setup();
    await openNewWorkbench(wb);
    selectLender("MG캐피탈"); // 이전 세션: 신규 작성에서 MG를 골랐다
    await flush();
    expect(lenderSelect().value).toBe("MG캐피탈"); // 금융사 = controlled state(②c) — select가 곧 진실

    // ── arrange 핵심: 다른 견적(BNK 저장본) 수정 진입 → 저장 카드라 게이트는 잠시 꺼져 있다.
    await act(async () => {
      wb().openEditQuote({
        id: "q-bnk",
        decisionStatus: null,
        trimId: null,
        financeType: "운용리스",
        source: "manual",
      } as unknown as QuoteItem);
    });
    await flush();
    await waitFor(() => expect(lenderSelect().value).toBe("BNK캐피탈"));

    // "수정" 클릭 = 잠금 해제 → 이 순간 게이트가 켜진다. 잔상이 남으면 MG 제약이 BNK 카드에 걸린다.
    fireEvent.click(within(card()).getByRole("button", { name: "수정" }));
    await flush();

    expect(lenderSelect().value).toBe("BNK캐피탈"); // 저장본 금융사 = 카드 state로 복원
    expectGateFollowsSelectedLender();
    // BNK가 취급하는데 MG 잔상이면 사라지는 값들 — 소실 방향을 직접 잠근다(fail-closed 검출).
    expect(mileageOptions()).toContain("40,000km / 년");
    expect(termButtons().find((b) => b.textContent === "12개월")!.disabled).toBe(false);
  });

  it("구매방식 왕복(운용리스→금융리스→운용리스) 후 게이트는 화면 금융사를 따른다", async () => {
    const { wb } = setup();
    await openNewWorkbench(wb);
    selectLender("MG캐피탈");
    await flush();
    expect(termButtons().find((b) => b.textContent === "12개월")!.disabled).toBe(true);

    // ── arrange 핵심: 구매방식 전환. 금융사 option 목록이 통째로 바뀌면 select.value가
    //    **change/input 발화 없이** "미선택"으로 되돌아간다(2026-07-22 실측) — 이벤트 배선으로는 못 잡는 경로.
    await switchPurchaseMethod("금융리스");
    await switchPurchaseMethod("운용리스");
    await waitFor(() => expect(Array.from(lenderSelect().options).map((o) => o.value)).toContain("MG캐피탈"));
    await flush();

    expect(lenderSelect().value).toBe("미선택"); // 화면상 아무 금융사도 선택돼 있지 않다
    expectGateFollowsSelectedLender(); // → 게이트도 걸려 있으면 안 된다(fail-open)
  });

  it("초기화 후에도 게이트는 화면 금융사와 일치한다(미선택 = fail-open)", async () => {
    const { wb } = setup();
    await openNewWorkbench(wb);
    selectLender("MG캐피탈");
    await flush();

    // ── arrange 핵심: 초기화 버튼. controlled state를 emptyQuoteConditionCards로 되돌리면 금융사도 미선택으로
    //    함께 초기화된다(구 uncontrolled에서 금융사만 살아남던 #327 함정이 구조적으로 사라졌다).
    fireEvent.click(document.querySelector<HTMLButtonElement>("button.kim-quote-workbench-action.ghost")!);
    await flush();

    // 값이 아니라 관계를 단언한다 — 게이트는 언제나 화면 금융사(=미선택 → fail-open)를 따른다.
    expect(lenderSelect().value).toBe("미선택");
    expectGateFollowsSelectedLender();
  });

  // ②c 이후: 초기화는 controlled state를 되돌려 금융사·판매사까지 함께 비운다. 구 별건(#327)의 "금융사만
  // DOM에 살아남던" 함정은 uncontrolled의 증상이었고, state가 진실이 되면서 그 자체가 소멸했다. DOM(controlled
  // 렌더)과 state(진실)를 둘 다 잠가, 초기화가 두 축을 모두 미선택으로 되돌리는지 확인한다.
  it("초기화는 금융사를 state·화면 둘 다 '미선택'으로 되돌린다(②c)", async () => {
    const { wb } = setup();
    await openNewWorkbench(wb);
    selectLender("MG캐피탈");
    await flush();
    expect(lenderSelect().value).toBe("MG캐피탈");

    fireEvent.click(document.querySelector<HTMLButtonElement>("button.kim-quote-workbench-action.ghost")!);
    await flush();

    expect(lenderSelect().value).toBe("미선택"); // controlled 렌더
    expect(wb().manualQuoteCards.find((c) => c.id === "manual-condition-1")!.lender).toBe("미선택"); // 진실(state)
  });

  it("조건 복사가 대상 카드 게이트에 반영된다(복사는 대상 카드 state에 금융사를 직접 세팅 — 이벤트 없음)", async () => {
    const { wb } = setup();
    await openNewWorkbench(wb);
    selectLender("MG캐피탈");
    await flush();

    // ── arrange 핵심: "1번 복사"는 대상 카드 state에 금융사를 직접 세팅한다(select 이벤트 없음 · ②c).
    //    controlled라 그 state가 select 렌더·게이트로 곧장 반영되는지 잠근다(구 거울 위임 경로는 폐기).
    fireEvent.click(within(card("manual-condition-2")).getByRole("button", { name: "1번 복사" }));
    await flush();

    expect(lenderSelect(card("manual-condition-2")).value).toBe("MG캐피탈");
    expectGateFollowsSelectedLender(card("manual-condition-2"));
    expectGateFollowsSelectedLender(card("manual-condition-3")); // 복사 안 한 카드는 게이트 없음(스코프 누수 검출)
  });

  it("랭킹 모달 행 선택(프로그램 쓰기)이 게이트에 즉시 반영된다", async () => {
    const { wb } = setup();
    await openNewWorkbench(wb);
    expect(termButtons().filter((b) => b.disabled)).toHaveLength(0); // 미선택 = 게이트 없음

    // ── arrange 핵심: applySolutionResult가 카드 state에 금융사를 **프로그램적으로** 세팅한다(이벤트 없음 · ②c).
    await act(async () => {
      wb().handlers.pickRankingEntry("manual-condition-1", mgRankingEntry);
    });
    await flush();

    expect(lenderSelect().value).toBe("MG캐피탈");
    expectGateFollowsSelectedLender();
  });
});

// ②c 고유 계약 — controlled 전환이 새로 확보/방어하는 것(구 uncontrolled에선 성립하지 않았거나 무의미).
describe("QuoteWorkbench 금융사 controlled 전환(배치 13 별건 ②c)", () => {
  const lenderOptions = () => Array.from(lenderSelect().options).map((o) => o.value);

  it("금융사 select는 onInput 단독 발화만으로도 선택이 반영된다(Safari controlled 함정 — bindSelect 병행 바인딩)", async () => {
    const { wb } = setup();
    await openNewWorkbench(wb);

    // Safari는 controlled select에서 input→React 복원→change(구값) 순서라 onChange만 들으면 선택이 유실된다.
    // bindSelect(onChange+onInput 병행)가 onInput에서 커밋하므로 change 없이 input만으로도 반영돼야 한다.
    // (jsdom은 Safari 복원을 재현하지 못하므로 이건 "bindSelect가 onInput에 배선됐다"의 배선 잠금이다.)
    fireEvent.input(lenderSelect(), { target: { value: "MG캐피탈" } });
    await flush();

    expect(lenderSelect().value).toBe("MG캐피탈");
    expectGateFollowsSelectedLender(); // 선택이 실제로 state에 반영됐는지 게이트로 교차 확인
  });

  it("레거시 어휘 금융사는 타사를 골랐다가 되돌아올 수 있다(seed가 option을 살려 둠 — ②b 회피)", async () => {
    const { wb } = setup();
    await openNewWorkbench(wb);
    await act(async () => {
      wb().openEditQuote({
        id: "q-legacy",
        decisionStatus: null,
        trimId: null,
        financeType: "운용리스",
        source: "manual",
      } as unknown as QuoteItem);
    });
    await flush();
    await waitFor(() => expect(lenderSelect().value).toBe("구캐피탈"));
    fireEvent.click(within(card()).getByRole("button", { name: "수정" })); // 잠금 해제(편집 가능)
    await flush();

    // 레거시 option이 렌더돼 있다(seed 원천).
    expect(lenderOptions()).toContain("구캐피탈");

    // 현행 어휘 금융사(MG)로 바꾼다 — 라이브 lender는 MG가 되지만…
    selectLender("MG캐피탈");
    await flush();
    expect(lenderSelect().value).toBe("MG캐피탈");
    // …seed 기반이라 레거시 option은 그대로 살아 있어야 한다(구 안 ②b가 여기서 값을 잃었다).
    expect(lenderOptions()).toContain("구캐피탈");

    // 되돌아갈 수 있다.
    selectLender("구캐피탈");
    await flush();
    expect(lenderSelect().value).toBe("구캐피탈");
  });
});

// 구매방식 전환 = 헤더 팝오버(버튼 → 메뉴 항목). 실 UI 경로 그대로 몬다.
async function switchPurchaseMethod(next: string) {
  const scope = document.querySelector<HTMLElement>('[data-workbench-mode="purchase"]')!;
  fireEvent.click(within(scope).getByRole("button", { expanded: false }));
  fireEvent.click(within(scope).getByRole("menuitem", { name: next }));
  await flush();
}

// 랭킹 모달이 이미 받아둔 응답(재호출 없음 — 개정 2 R4-3). parseSolutionQuoteResult가 읽는 최소 형태.
const mgRankingEntry = {
  lenderCode: "mg-capital",
  label: "MG캐피탈",
  monthlyDisplay: 1_234_600,
  ratePct: 5.32,
  residualAmount: 20_000_000,
  residualPct: 40,
  totalCost: 1_234_600 * 60 + 20_000_000,
  warnings: [],
  raw: {
    ok: true,
    quote: {
      monthlyPayment: 1_234_567,
      rates: { annualRateDecimal: 0.0532, effectiveAnnualRateDecimal: 0.0555 },
      residual: { amount: 20_000_000, rateDecimal: 0.4 },
      workbookImport: { versionLabel: "2026-07 v2" },
      warnings: [],
    },
  },
} as unknown as SolutionRankingEntry;
