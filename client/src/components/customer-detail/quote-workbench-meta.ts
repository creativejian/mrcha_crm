// 견적 워크벤치 영역(9b~9e)의 타입·상수·순수 헬퍼 — 본체에서 이동(동작/값 무변경).
// 훅(useQuoteWorkbench)과 컴포넌트(QuoteWorkbench)가 공유한다.

import { PURCHASE_METHOD_OPTIONS, type PurchaseMethod } from "@/data/customers";
import { type CustomerDetailScenario, type QuoteDiscountLine, type QuoteItem } from "@/lib/quote-items";
import { type QuoteGuidance } from "@/data/quote-guidance";
import { computePricing, formatMoney, percentToWon, type PricingInputs } from "@/lib/quote-pricing";
import { type ScenarioCardSeed } from "@/lib/quote-request-seed";
import { parseSolutionQuoteResult, solutionMileageOf, solutionProductTypeOf, SOLUTION_LEASE_TERMS, type SolutionProductType, type SolutionSnapshot } from "@/lib/solution-quote";
import { resolveGateFallback } from "@/lib/support-matrix";

export type DiscountUnit = "amount" | "percent";
export type DiscountLine = { id: string; label: string; amount: string; unit: DiscountUnit };

// 할인 행 1개의 원화 환산 — percent 행 환산 기준(basis) = basePrice + optionTotal.
// 역산 복원(restoreDiscountLines)·총액 합산(syncDiscountTotalFromRows)·단위 전환(convertDiscountInputUnit)
// 3소비처가 공유하는 단일 산술(배치 F) — 역산↔정산 산술이 어긋나면 수정 재진입 때 기본 할인이
// 조용히 오염되는 load-bearing 불변이라, 주석 계약이 아니라 함수 1벌로 잠근다.
export function discountLineWon(unit: DiscountUnit, value: number, basis: number): number {
  return unit === "percent" ? percentToWon(basis, value) : value;
}

// 수정 진입 복원: 저장된 할인 구성 내역(crm.quotes.discount_lines) → 워크벤치 행 state + 기본 할인 분리 산술.
// 기본 할인은 별도 저장하지 않는다 — finalDiscount(총액) − Σ추가 행 환산액(discountLineWon 공유 산술)으로 역산.
// 행 id는 idBase(nowMs)+index로 매번 새로 발급 — uncontrolled input(defaultValue)의 리마운트를 보장.
export function restoreDiscountLines(
  saved: QuoteDiscountLine[] | null | undefined,
  discountBasis: number, // basePrice + optionTotal
  finalDiscount: number,
  idBase: number,
): { lines: DiscountLine[]; primaryDiscount: number } {
  const rows = saved ?? [];
  const lines: DiscountLine[] = rows.map((s, i) => ({
    id: `discount-${idBase}-${i}`,
    label: s.label,
    // percent는 원문(소수 보존 — 콤마 포맷 우회 표시 규약), amount는 콤마 포맷(금액 입력칸 표시 규약).
    amount: s.unit === "percent" ? String(s.amount) : formatMoney(s.amount),
    unit: s.unit,
  }));
  const additional = rows.reduce((sum, s) => sum + discountLineWon(s.unit, s.amount, discountBasis), 0);
  // 음수 클램프: 총액보다 행 합이 크면(과거 데이터 드리프트) parseMoney가 음수 부호를 버려 오염되므로 0이 안전.
  return { lines, primaryDiscount: Math.max(0, finalDiscount - additional) };
}
export type ManualDepositMode = "none" | "amount" | "percent";
export type ManualResidualMode = "max" | "amount" | "percent";
export type ManualMileageMode = "basic" | "custom";
// 판매사 모드(T2 — 계산기 ScenarioState.dealerType 미러). 딜러 "선택값"은 여기 없다 —
// 값의 진실 원본은 카드 DOM select(data-sc-field="dealer", uncontrolled — 금융사 select와 동일 계약).
export type ManualDealerMode = "nonAffiliated" | "input";

// 판매사 모드 세그먼트 어휘 — 워크벤치·계산기 공용 1벌(취득세 ACQUISITION_TAX_MODE_LABELS 선례).
// 제프 원문(비제휴 계산/판매사 입력)을 축약: 표준 2버튼 세그먼트의 버튼당 텍스트 상한이 한글 3자
// (1440px 실측 31.4px — 자동차세 "불포함"과 동일 폭)라, 원문(5~6자 = 자연폭 149.7px)은 세그먼트가
// 값 트랙까지 침범해 전 행 폭 통일(#265 고정 칸 그리드)을 깬다. 라벨만 축약 — value 계약 불변
// (계산기 ScenarioState.dealerType과 동일 리터럴). 행 라벨 "판매사"가 문맥을 제공한다.
export const DEALER_MODE_SEGMENT_OPTIONS: readonly { value: ManualDealerMode; label: string }[] = [
  { value: "nonAffiliated", label: "비제휴" },
  { value: "input", label: "입력" },
];

// 판매사 select의 빈 목록 placeholder — 선택지가 없는 "이유"를 표면화(안내 없는 죽은 select가
// 고장으로 읽히던 실기 지적, 2026-07-17). 워크벤치·계산기 공용 1벌(문구 SSOT):
// 워크벤치는 딜러 스코프가 카드의 선택 금융사라 lenderReady = "금융사 스코프 로드 시도 결과 존재",
// 계산기는 전사 union이라 금융사 단계가 없어 lenderReady 상수 true(0건이면 곧장 "등록 딜러 없음").
// loadFailed(배치 8 A#2): fetch 실패를 데이터-부재 어휘("등록 딜러 없음")와 구분 — 옵션/색상
// '불러오지 못했습니다' 배선(배치 7 A#1)과 같은 원칙. 선행 조건 안내(차량/금융사)가 실패보다 우선.
export function dealerSelectPlaceholder(state: { hasChoices: boolean; vehicleReady: boolean; lenderReady: boolean; loadFailed: boolean }): string {
  if (state.hasChoices) return "선택";
  if (!state.vehicleReady) return "차량 먼저 선택"; // 픽커 "트림 먼저 선택" 문법 미러
  if (!state.lenderReady) return "금융사 먼저 선택";
  if (state.loadFailed) return "딜러 목록을 불러오지 못했습니다";
  return "등록 딜러 없음";
}

// 약정거리 "기본" 모드의 고정 표시값 — 화면·추출·복원이 공유하는 유일 리터럴.
export const MILEAGE_BASIC_VALUE = "20,000km / 년";

// 금융사 "미선택" sentinel — 카드 시드·option 텍스트·게이트 판정·딜러 적재가 공유하는 유일 리터럴.
// 이 값은 **select option의 표시 텍스트가 곧 값**이라(value 속성 없음) 화면 문구와 판정 기준이 한 몸이다.
// 그래서 문구만 바꿀 생각으로 손대면 `lender !== 미선택` 류 판정이 조용히 전부 참이 되어 지원집합
// 게이트·딜러 적재가 풀린다. 여기 한 곳에서만 바꾼다.
// ⚠️ **색상 쪽 "미선택"과 같은 문자열이지만 다른 도메인이다**(2026-07-22 실측 — 프로덕션 21건이 세
// 도메인에 겹쳐 있었다). `app-card.ts`·`src/lib/app-card-payload.ts`의 `exteriorColorLabel`/
// `interiorColorLabel` 폴백은 **앱 발송 payload에 실리는 계약값**이고, `WorkbenchVehiclePickers`의
// 것은 피커 UI 폴백이다. 셋을 하나로 묶지 말 것 — 한쪽을 바꾸면 다른 쪽이 조용히 깨진다.
export const LENDER_UNSELECTED = "미선택";

// 비교카드 한 장의 UI 상태. 통합 전에는 속성별 Record 8벌로 흩어져 있었고, 키 누락이
// 읽는 쪽 폴백(?? 60 등)에 조용히 흡수돼 저장 payload를 오염시켰다(#163). 카드 = 객체 1개가 SSOT.
export type CardUiState = {
  termMonths: number;
  depositMode: ManualDepositMode;
  downPaymentMode: ManualDepositMode;
  residualMode: ManualResidualMode;
  mileageMode: ManualMileageMode;
  mileageValue: string;
  carTaxIncluded: boolean;
  subsidyApplicable: boolean;
  dealerMode: ManualDealerMode;
};

// 통합 전 8개 Record의 읽기 폴백과 동일한 값(테스트로 잠금). 변경 = 저장 payload 변경.
export const DEFAULT_CARD_UI: CardUiState = {
  termMonths: 60,
  depositMode: "none",
  downPaymentMode: "none",
  residualMode: "max",
  mileageMode: "basic",
  mileageValue: MILEAGE_BASIC_VALUE,
  carTaxIncluded: false,
  subsidyApplicable: false,
  dealerMode: "nonAffiliated", // 계산기 defaultScenario.dealerType 미러(비제휴 계산이 기본)
};

export function cardUiOf(map: Record<string, CardUiState>, conditionId: string): CardUiState {
  return map[conditionId] ?? DEFAULT_CARD_UI;
}

// basic 모드는 저장된 mileageValue를 무시하고 고정값을 쓴다(추출·렌더 공통 규칙).
export function effectiveMileageValue(ui: CardUiState): string {
  return ui.mileageMode === "basic" ? MILEAGE_BASIC_VALUE : ui.mileageValue;
}

// 앱 견적요청 승격 → 카드1 UI 상태. 시드가 없는 필드는 기본값 유지(통합 전 "Record에 키를 안 넣던" 동작과 동일).
// 금액 문자열(depositValue/downPaymentValue)은 카드의 표시 초기값(uncontrolled defaultValue)이라 여기 없다.
export function cardUiFromSeed(seed: ScenarioCardSeed): CardUiState {
  return {
    ...DEFAULT_CARD_UI,
    ...(seed.termMonths != null ? { termMonths: seed.termMonths } : {}),
    ...(seed.depositMode ? { depositMode: seed.depositMode } : {}),
    ...(seed.downPaymentMode ? { downPaymentMode: seed.downPaymentMode } : {}),
  };
}

// 비교카드의 표시 데이터(금액 문자열은 uncontrolled input의 defaultValue).
// 모드(보증금/선수금/잔존가치)는 여기 두지 않는다 — CardUiState가 단일 소스.
export type ManualCard = {
  id: string; title: string; round: string; copyLabel: string;
  lender: string; monthlyPayment: string;
  totalReturn: string; totalTakeover: string; dueAtDelivery: string; interestRate: string;
  depositValue: string;
  downPaymentValue: string;
  residualValue: string;
  subsidyAmount: string;
  // CM/AG 수수료 %(계산기 패리티) — 원 환산 미리보기는 파생(deriveAndFillCardResults)이라 표시값은 % 원문만.
  cmFeePercent: string;
  agFeePercent: string;
  // 판매사(T2) — 딜러 select의 초기 표시값(defaultValue)이자 "저장값 표시 유지" option의 원천.
  // 딜러 목록(fetch)이 아직 없어도 이 값이 option으로 렌더돼 재진입 복원이 성립한다(금융사 구 어휘
  // option 패턴 미러). 이 값이 바뀌면 select가 리마운트 재시드된다(uncontrolled 재시드 키 — 복사/리셋 경로).
  dealerName: string;
};
export const discountLabelOptions = ["재구매 할인", "법인 추가 할인", "기타"] as const;
const manualMileageOptions = [
  "10,000km / 년",
  "15,000km / 년",
  "20,000km / 년",
  "25,000km / 년",
  "30,000km / 년",
  "35,000km / 년",
  "40,000km / 년",
] as const;
export type AcquisitionTaxMode = "normal" | "hybrid" | "electric" | "manual";
// 취득세 4모드 라벨 어휘 SSOT(quote-fields 프리미티브 UI SSOT와 짝) — 모드 value는 화면별 상태
// 계약(워크벤치 normal·계산기 none)이라 각자 zip한다(라벨만 1벌).
export const ACQUISITION_TAX_MODE_LABELS = ["일반", "하이브리드 감면", "전기차 감면", "직접 입력"] as const;

export type QuoteEntryMode = "solution" | "manual" | "original";
export type QuotePurchaseMethod = PurchaseMethod;
export type RecognizedQuoteFile = { file: File; fileName: string; fileSize: number; mimeType: string };
export type EditScenario = {
  scenarioNo: number;
  lender: string;
  monthlyPayment: string;
  termMonths: number;
  depositMode: ManualDepositMode;
  depositValue: string;
  downPaymentMode: ManualDepositMode;
  downPaymentValue: string;
  residualMode: ManualResidualMode;
  residualValue: string;
  mileageMode: ManualMileageMode;
  mileageValue: string;
  carTaxIncluded: boolean;
  subsidyApplicable: boolean;
  subsidyAmount: string;
  totalReturnCost: string;
  totalTakeoverCost: string;
  dueAtDelivery: string;
  interestRate: string;
  cmFeePercent: string;
  agFeePercent: string;
  // 판매사(T2) — cm/ag의 `|| "0"` 폴백과 달리 `?? null`(빈 문자열 저장 금지 — 값 없음 = null 계약).
  dealerName: string | null;
};

// 비교카드 id 규약 — 시나리오 번호(scenario_no)와 1:1. 복원·저장 양쪽이 이 함수를 쓴다.
export function cardIdOfScenarioNo(scenarioNo: number): string {
  return `manual-condition-${scenarioNo}`;
}

export function cardUiFromScenario(s: EditScenario): CardUiState {
  return {
    termMonths: s.termMonths,
    depositMode: s.depositMode,
    downPaymentMode: s.downPaymentMode,
    residualMode: s.residualMode,
    mileageMode: s.mileageMode,
    mileageValue: s.mileageValue,
    carTaxIncluded: s.carTaxIncluded,
    subsidyApplicable: s.subsidyApplicable,
    // 판매사 모드는 컬럼이 아니라 저장값 유무에서 파생 — dealer_name이 있으면 "판매사 입력"으로 복원
    // (계산기 dealerType 대응. 모드 자체를 저장하지 않는 근거: 비제휴 = dealer_name null과 동치).
    dealerMode: s.dealerName ? "input" : "nonAffiliated",
  };
}

export function cardUiMapFromScenarios(scenarios: EditScenario[]): Record<string, CardUiState> {
  return Object.fromEntries(scenarios.map((s) => [cardIdOfScenarioNo(s.scenarioNo), cardUiFromScenario(s)]));
}

// 저장 시나리오 행에서 스냅샷 판독에 필요한 서브셋(CustomerDetailScenario 동형 — 서버 select() 전체 반환).
type ScenarioSnapshotRow = Pick<
  CustomerDetailScenario,
  "scenarioNo" | "solutionLenderCode" | "solutionWorkbookVersion" | "solutionCalculatedAt" | "solutionRaw"
>;

// 수정 재진입 스냅샷 시드 — 시나리오 저장이 전체 교체(서버 insertScenarios delete→insert)라, 워크벤치가
// 재조회 없이 재저장할 때 이 시드가 저장 payload에 스냅샷을 되실어 소실을 막는다(마이그 0031 계약).
// 카드 대응 규칙은 cardUiMapFromScenarios와 동일(cardIdOfScenarioNo). lenderCode·calculatedAt·raw 셋 다
// 있어야 스냅샷 실존으로 본다(수기 시나리오·반쪽 행 제외). raw가 null이면 residualDisplayFromSnapshot이
// "-"로 폴백해 max 잔가 재시드가 인수·금리를 소실시키므로(이 함수가 막으려던 바로 그 소실) 스냅샷으로 보지 않는다.
// solutionCalculatedAt·workbookVersion은 저장본 값 그대로 왕복(재변환·기본값 승격 없음 — 구 행의 버전 null이
// 재저장에서 ""로 드리프트하면 안 된다).
export function solutionSnapshotsFromScenarios(scenarios: ScenarioSnapshotRow[]): Record<string, SolutionSnapshot> {
  const entries: [string, SolutionSnapshot][] = [];
  for (const s of scenarios) {
    if (s.solutionLenderCode == null || s.solutionCalculatedAt == null || s.solutionRaw == null) continue;
    entries.push([cardIdOfScenarioNo(s.scenarioNo ?? 1), {
      solutionLenderCode: s.solutionLenderCode,
      solutionWorkbookVersion: s.solutionWorkbookVersion,
      solutionCalculatedAt: s.solutionCalculatedAt,
      solutionRaw: s.solutionRaw,
    }]);
  }
  return Object.fromEntries(entries);
}

// 수정 재진입 max 잔가 재시드: max 모드는 DB residualValue가 null(추출 규칙)이라 카드 표시값이 "-"로
// 시드되는데, 그대로 두면 재진입 직후 파생(residualAmountOf("max","-") → null)이 인수 총비용·금리를 "0"으로
// 덮어 무재조회 재저장 시 이전 저장값이 조용히 소실된다(스냅샷 raw에는 실채택 잔가가 살아 있는 비대칭).
// 스냅샷 raw에서 실채택 잔가를 조회 채움(queryCardSolution의 formatMoney)과 동일 포맷으로 복원 —
// 스냅샷 시드의 "보존 담당" 계약(solutionSnapshotsFromScenarios)과 정합. 해석 불능이면 null(호출부 "-" 폴백).
export function residualDisplayFromSnapshot(snapshot: SolutionSnapshot | undefined): string | null {
  if (!snapshot) return null;
  const parsed = parseSolutionQuoteResult(snapshot.solutionRaw);
  return parsed ? formatMoney(parsed.residualAmount) : null;
}

export type EditPrefill = {
  optionIds: number[];
  exteriorColorId: number | null;
  interiorColorId: number | null;
  // discount는 총액(data-pricing="discount" 입력), primaryDiscount는 기본 할인 행(총액 − 추가 행 환산 합 —
  // restoreDiscountLines 역산 결과. 추가 행 없으면 총액과 동일).
  pricing: { base: number; option: number; discount: number; primaryDiscount: number; acquisitionTax: number; bond: number; delivery: number; incidental: number };
  scenarios: EditScenario[];
  guidance: QuoteGuidance | null;
};

export const emptyQuotePricing: PricingInputs = {
  basePrice: 0,
  optionPrice: 0,
  discount: 0,
  acquisitionTax: 0,
  bond: 0,
  delivery: 0,
  incidental: 0,
};
// 워크벤치 pricing 초기 state(빈 기본값 계산 결과) — 이름은 목업 시절 maybachQuotePricingResult에서 정리(0705 배치 D).
export const initialQuotePricingResult = computePricing(emptyQuotePricing);

export const emptyQuoteConditionCards: ManualCard[] = [
  {
    id: "manual-condition-1",
    title: "견적 작성",
    round: "1",
    copyLabel: "",
    // round1도 비교 슬롯(2·3)과 동일한 빈 기본값 — 미입력 시 extractWorkbenchScenarios가 filled로 보지 않아
    // 신규 작성완료 시 가짜 금융 mock이 저장되지 않는다(사용자 입력 시에만 저장). display-only 필드도 0/placeholder.
    lender: LENDER_UNSELECTED,
    monthlyPayment: "0",
    totalReturn: "0",
    totalTakeover: "0",
    dueAtDelivery: "0",
    interestRate: "0",
    depositValue: "0",
    downPaymentValue: "0",
    residualValue: "-",
    subsidyAmount: "0",
    cmFeePercent: "0",
    agFeePercent: "0",
    dealerName: "",
  },
  {
    id: "manual-condition-2",
    title: "견적 작성",
    round: "2",
    copyLabel: "1번 복사",
    lender: LENDER_UNSELECTED,
    monthlyPayment: "0",
    totalReturn: "0",
    totalTakeover: "0",
    dueAtDelivery: "0",
    interestRate: "0",
    depositValue: "0",
    downPaymentValue: "0",
    residualValue: "-",
    subsidyAmount: "0",
    cmFeePercent: "0",
    agFeePercent: "0",
    dealerName: "",
  },
  {
    id: "manual-condition-3",
    title: "견적 작성",
    round: "3",
    copyLabel: "2번 복사",
    lender: LENDER_UNSELECTED,
    monthlyPayment: "0",
    totalReturn: "0",
    totalTakeover: "0",
    dueAtDelivery: "0",
    interestRate: "0",
    depositValue: "0",
    downPaymentValue: "0",
    residualValue: "-",
    subsidyAmount: "0",
    cmFeePercent: "0",
    agFeePercent: "0",
    dealerName: "",
  },
] as const;

export const quotePurchaseMethodOptions = PURCHASE_METHOD_OPTIONS;

export function normalizeQuotePurchaseMethod(value?: string): QuotePurchaseMethod {
  if (value && quotePurchaseMethodOptions.includes(value as QuotePurchaseMethod)) return value as QuotePurchaseMethod;
  return "운용리스";
}

export function primaryQuotePurchaseMethod(fields: { label: string; value: string }[]) {
  return normalizeQuotePurchaseMethod(fields.find((field) => field.label === "구매방식")?.value);
}

export function createQuoteCode(existingQuotes: QuoteItem[]) {
  const yearMonth = "2606";
  const nextSequence = existingQuotes.reduce((max, quote) => {
    const match = quote.quoteCode.match(/^QT-\d{4}-(\d{4})$/);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0) + 1;
  return `QT-${yearMonth}-${String(nextSequence).padStart(4, "0")}`;
}

// 지원집합 게이트(spec 2026-07-21-crm-support-matrix-gate-design) 폴백값.
// ⚠️ 60개월·20,000km는 파트너 운용리스 5사가 **전부** 지원한다(2026-07-21 실측 매트릭스) —
// 그래서 어느 금융사로 바꿔도 폴백이 다시 미지원으로 튀지 않는다. 이 전제가 깨지면
// (파트너가 어느 사에서 60개월/20,000km를 내리면) 폴백이 무의미해지므로 함께 재검토할 것.
const GATE_FALLBACK_TERM_MONTHS = 60;
const GATE_FALLBACK_MILEAGE_KM = 20000;

// 이 카드가 게이트 대상인지 — 아니면 null(게이트 해제).
// ⚠️ **저장된 카드는 제외**한다. 편집 불가라 "잘못 고르는 것"을 막을 목적이 없고, 약정거리 option을
// 지우면 저장된 값이 목록에 없어 select 표시가 빈칸으로 깨진다(과거 MG+25,000km 견적을 열었을 때).
// 파트너 미구현 구매방식(금융리스·할부·일시불)도 게이트 대상이 아니다.
export function gateProductFor(isConditionSaved: boolean, purchaseMethod: string): SolutionProductType | null {
  if (isConditionSaved) return null;
  return solutionProductTypeOf(purchaseMethod);
}

// 기간 세그먼트 어휘 — SOLUTION_LEASE_TERMS 파생(계산기와 같은 소스).
const leaseTermSegmentOptions = SOLUTION_LEASE_TERMS.map((m) => ({ value: m, label: `${m}개월` }));

// 지원집합(null = 미확정 → 게이트 없음)으로 기간 세그먼트 옵션을 만든다.
// 미지원 값은 `disabled`로만 표시하고 목록에서 빼지 않는다 — 세그먼트는 칸 수가 고정된 UI라
// 빼면 레이아웃이 흔들리고, 어떤 기간이 왜 안 되는지도 안 보인다.
export function gatedTermOptions(supported: number[] | null): { value: number; label: string; disabled?: boolean }[] {
  if (supported === null) return leaseTermSegmentOptions.map((o) => ({ ...o }));
  return leaseTermSegmentOptions.map((o) => ({ ...o, disabled: !supported.includes(o.value) }));
}

// 약정거리는 select라 미지원 값을 목록에서 제거한다(유슨생 결정).
// ⚠️ `current`(현재 선택값)는 미지원이어도 항상 살린다 — 폴백은 금융사 변경에서만 돌기 때문에
// 수정 진입 시 과거 미취급 값이 목록에서 사라지면 select 표시가 빈칸으로 깨진다.
export function gatedMileageOptions(supported: number[] | null, current: string): readonly string[] {
  if (supported === null) return manualMileageOptions;
  return manualMileageOptions.filter((option) => {
    if (option === current) return true;
    const km = solutionMileageOf(option);
    return km !== null && supported.includes(km);
  });
}

// 금융사 변경 시 미취급이 된 조건을 폴백값으로 옮기는 "계획". 실제 setState·토스트는 훅이 한다
// (여기는 순수 — 무엇을 어디로 옮기고 뭐라 안내할지만 결정).
export type GateFallbackPlan = { termMonths: number | null; mileageValue: string | null; moved: string[] };

export function planGateFallback(
  ui: CardUiState,
  supportedTerms: number[] | null,
  supportedMileages: number[] | null,
): GateFallbackPlan {
  const plan: GateFallbackPlan = { termMonths: null, mileageValue: null, moved: [] };

  const nextTerm = resolveGateFallback(ui.termMonths, supportedTerms, GATE_FALLBACK_TERM_MONTHS);
  if (nextTerm !== null) {
    plan.termMonths = nextTerm;
    plan.moved.push(`기간 ${nextTerm}개월`);
  }

  // 약정거리 상태값은 표시 문자열("20,000km / 년")이라 km 왕복이 필요하다.
  const currentKm = solutionMileageOf(effectiveMileageValue(ui));
  if (currentKm !== null) {
    const nextKm = resolveGateFallback(currentKm, supportedMileages, GATE_FALLBACK_MILEAGE_KM);
    const nextLabel = nextKm === null ? undefined : manualMileageOptions.find((o) => solutionMileageOf(o) === nextKm);
    if (nextLabel) {
      plan.mileageValue = nextLabel;
      plan.moved.push(`약정거리 ${nextLabel}`);
    }
  }

  return plan;
}
