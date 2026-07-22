import { type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type FocusEvent as ReactFocusEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type SyntheticEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { type Customer } from "@/data/customers";
import { type CustomerDetailData } from "@/lib/customers";
import { dedupedModelTrim, flattenPrimaryScenario, type CustomerDetailScenario, type QuoteDiscountLine, type QuoteItem } from "@/lib/quote-items";
import { DEFAULT_QUOTE_GUIDANCE, normalizeQuoteGuidance, sanitizeQuoteGuidance, type QuoteGuidance, regionFromResidence } from "@/data/quote-guidance";
import { updateQuote as apiUpdateQuote, createQuote as apiCreateQuote, parseMonthlyPayment, parseInterestRate, requestSolutionQuote, type QuoteWritePatch, type QuoteCreatePayload, type ScenarioInput } from "@/lib/customer-quotes";
import { buildSolutionQuoteInput, parseSolutionQuoteResult, solutionLenderOptions, solutionProductTypeOf, type BuildArgs, type SolutionLenderCode, type SolutionQuoteParsed, type SolutionSnapshot } from "@/lib/solution-quote";
import { supportedMileagesFor, supportedTermsFor, useSupportMatrix } from "@/lib/support-matrix";
import { fetchSolutionDealers, type SolutionDealer } from "@/lib/solution-dealers";
import { solutionMonthlyDisplay, type SolutionRankingEntry } from "@/lib/solution-ranking";
import { deriveCardResults, residualAmountOf } from "@/lib/lease-rate";
import { fetchQuoteRequestDetail, fetchAppQuoteRequestsCached } from "@/lib/quote-requests";
import { seedScenarioCardFromRequest } from "@/lib/quote-request-seed";
import { type VehicleSelection } from "@/components/customer-detail/WorkbenchVehiclePickers";
import { buildAppCardModel, type AppCardModel } from "@/lib/app-card";
import { computePricing, formatMoney, parseMoney, parsePercentInput, type PricingInputs, type PricingResult } from "@/lib/quote-pricing";
import { fetchTrimDetail, type TrimColor, type TrimDetail } from "@/lib/vehicles";
import { nowMs, formatKoreanShortTime } from "@/lib/detail-utils";

import { purchaseFieldScaffold } from "../purchase-meta";
import {
  cardIdOfScenarioNo,
  cardUiFromSeed,
  cardUiMapFromScenarios,
  cardUiOf,
  createQuoteCode,
  effectiveMileageValue,
  emptyQuoteConditionCards,
  emptyQuotePricing,
  discountLineWon,
  initialQuotePricingResult,
  MILEAGE_BASIC_VALUE,
  planGateFallback,
  quotePurchaseMethodOptions,
  normalizeQuotePurchaseMethod,
  primaryQuotePurchaseMethod,
  residualDisplayFromSnapshot,
  restoreDiscountLines,
  solutionSnapshotsFromScenarios,
  type AcquisitionTaxMode,
  type CardUiState,
  type DiscountLine,
  type DiscountUnit,
  type EditPrefill,
  type EditScenario,
  type ManualCard,
  type ManualDealerMode,
  type ManualDepositMode,
  type ManualMileageMode,
  type ManualResidualMode,
  type QuoteEntryMode,
  type QuotePurchaseMethod,
  type RecognizedQuoteFile,
} from "../quote-workbench-meta";
import { type useQuoteList } from "./useQuoteList";

type UseQuoteWorkbenchArgs = {
  detail: CustomerDetailData; // onEditQuote가 detail.quotes에서 시나리오/가격 복원
  customer: Customer; // persist(customer.id) + 워크벤치 헤더(customer.name/customerId) + ?quoteRequest navigate
  onToast: (message: string) => void;
  // 부모 소유 — markRecentUpdate(최근 갱신 타임스탬프)는 persist에서 호출. 콜백 주입.
  markRecentUpdate: (section: string) => void;
  // 부모 prop — 견적 저장/발송 성공 후 detail 재동기화.
  onQuotesPersisted?: () => void;
  // 9a 견적함 목록 훅 — persist의 낙관 setQuotes/롤백·createQuoteCode(quotes)·editingQuote 조회 + seam 진입 시 액션 팝오버 리셋.
  // setQuotes는 9a에서 그대로 주입(명명 핸들러 tighten은 후속 follow-up).
  quoteList: ReturnType<typeof useQuoteList>;
  // 구매조건 훅의 fields(구매방식 기본값) — 신규/리셋/요청 prefill 진입 시 읽음. 부모 relay.
  purchaseFields: { label: string; value: string }[];
  // 니즈 훅의 reloadAppRequests — 견적요청→견적 INSERT 성공 시 배지 갱신. 부모 relay.
  reloadAppRequests: () => void;
};

// 게이트 거울 재동기화 bail-out용 얕은 비교 — 매 커밋 setState가 무한 렌더로 번지지 않게 하는 안전핀.
function sameStringMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

// 견적 워크벤치(9b~9e 통합): 솔루션 워크벤치 모달의 전체 상태/가격패널/비교카드/추가안내/앱카드/PDF원본/영속화.
// cross-cutting(markRecentUpdate/quoteList/purchaseFields/reloadAppRequests)은 부모 보유 → 인자 주입.
export function useQuoteWorkbench({
  detail,
  customer,
  onToast,
  markRecentUpdate,
  onQuotesPersisted,
  quoteList,
  purchaseFields,
  reloadAppRequests,
}: UseQuoteWorkbenchArgs) {
  const [isQuoteSolutionWorkbenchOpen, setIsQuoteSolutionWorkbenchOpen] = useState(false);
  const [solutionWorkbenchPurchaseMethod, setSolutionWorkbenchPurchaseMethod] = useState<QuotePurchaseMethod>(() => primaryQuotePurchaseMethod(purchaseFieldScaffold));
  const [solutionWorkbenchEntryMode, setSolutionWorkbenchEntryMode] = useState<QuoteEntryMode>("manual");
  const [solutionWorkbenchModeMenu, setSolutionWorkbenchModeMenu] = useState<"purchase" | "entry" | null>(null);
  const [isQuoteAppCardPreviewOpen, setIsQuoteAppCardPreviewOpen] = useState(false);
  const [isQuoteDraftSaved, setIsQuoteDraftSaved] = useState(false);
  const [isQuoteDraftDirty, setIsQuoteDraftDirty] = useState(false);
  const [savedManualQuoteConditionIds, setSavedManualQuoteConditionIds] = useState<string[]>([]);
  const [manualQuoteCards, setManualQuoteCards] = useState<ManualCard[]>(() => [...emptyQuoteConditionCards]);
  // 비교카드 UI 상태(카드 id → CardUiState). 통합 전 속성별 Record 8벌 — 카드 하나를 다루는 모든
  // 동작이 8곳을 건드려야 했고 키 누락을 컴파일러가 못 잡았다(#163 저장 payload 오염).
  const [cardUi, setCardUi] = useState<Record<string, CardUiState>>({});
  // in-flight 솔루션 조회(~1s)의 응답이 호출 시점 클로저가 아니라 응답 시점의 최신 모드를 읽도록 미러(2-C).
  // 조회 중 잔가 모드를 max↔percent 바꾸면 applySolutionResult가 stale 모드로 residual을 세팅하던 레이스 차단.
  const cardUiRef = useRef(cardUi);
  cardUiRef.current = cardUi;
  // 솔루션 조회: 전역 1건 in-flight(연타·동시 조회 방지 — 자동 재계산 없는 명시 버튼이라 파트너 서버 보호)와
  // 카드별 재현성 스냅샷(저장 시 시나리오에 동봉 — 마이그 0031. 수정 재진입 시드가 전체 교체 저장에서 보존 담당).
  const [solutionLoadingId, setSolutionLoadingId] = useState<string | null>(null);
  const [solutionSnapshots, setSolutionSnapshots] = useState<Record<string, SolutionSnapshot>>({});
  // 개정 1 R1: 금융사 미선택 상태로 계산기를 누르면 여는 지원 금융사 모달(열린 카드 id, null=닫힘).
  const [solutionLenderPickerId, setSolutionLenderPickerId] = useState<string | null>(null);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  // 신규 작성완료 후 "이후 UPDATE 대상 id". editingQuoteId(=비교카드 key·prefill)를 안 건드려야 카드 리마운트(입력 리셋)를 막는다.
  const persistedQuoteIdRef = useRef<string | null>(null);
  const [guidance, setGuidance] = useState<QuoteGuidance>(DEFAULT_QUOTE_GUIDANCE);
  // 신규 워크벤치 guidance 시드 — 고객 지역은 거주지에서 파생(미입력이면 "확인 필요", 임의 지역 확정 표기 방지).
  const seedGuidance = () => ({ ...DEFAULT_QUOTE_GUIDANCE, customerRegion: regionFromResidence(detail.residence) });
  const [editPrefill, setEditPrefill] = useState<EditPrefill | null>(null);
  // 앱 견적요청 승격(S3) prefill. editPrefill(수정·가격 포함)과 별개 — 차량/옵션만 채우고 가격은 catalog 계산.
  const [quoteRequestPrefill, setQuoteRequestPrefill] = useState<{ trimId: number | null; optionIds: number[]; exteriorColorId: number | null; interiorColorId: number | null } | null>(null);
  const [sourceQuoteRequestId, setSourceQuoteRequestId] = useState<string | null>(null);
  const [recognizedQuoteFile, setRecognizedQuoteFile] = useState<RecognizedQuoteFile | null>(null);
  const [isQuoteWorkbenchOriginalDragActive, setIsQuoteWorkbenchOriginalDragActive] = useState(false);
  const [pricing, setPricing] = useState<PricingResult>(initialQuotePricingResult);
  const [pricingInputs, setPricingInputs] = useState<PricingInputs>(emptyQuotePricing);
  const [cardScenario, setCardScenario] = useState<ScenarioInput | null>(null);
  const pricingPanelRef = useRef<HTMLElement>(null);
  const [primaryDiscountUnit, setPrimaryDiscountUnit] = useState<DiscountUnit>("amount");
  const [discountLines, setDiscountLines] = useState<DiscountLine[]>([]);
  const [acquisitionTaxMode, setAcquisitionTaxMode] = useState<AcquisitionTaxMode>("normal");
  const [trimDetail, setTrimDetail] = useState<TrimDetail | null>(null);
  const [exteriorColor, setExteriorColor] = useState<TrimColor | null>(null);
  const [interiorColor, setInteriorColor] = useState<TrimColor | null>(null);
  // #4c-2 워크벤치 저장용: VehiclePicker가 고른 brand/model(applyTrimToPricing이 버리던 값)과 선택 옵션 ids.
  const [workbenchVehicle, setWorkbenchVehicle] = useState<VehicleSelection | null>(null);
  const [selectedWorkbenchOptionIds, setSelectedWorkbenchOptionIds] = useState<number[]>([]);
  // 판매사(딜러) 목록 — 카드별, 스코프 = (카드의 선택 금융사, 워크벤치 브랜드) (T2). 계산기의 전사 union과
  // 다른 설계: 비교카드는 단일 금융사 조건이라 그 금융사 딜러만 노출하고, 저장값도 plain dealer_name
  // (금융사는 카드 lender 컬럼이 보유 — `lenderCode::dealerName` 합성 불필요). 딜러 "선택값"은 state가
  // 아니라 카드 DOM select(uncontrolled — 금융사 select 계약 미러)에 산다.
  // 값 "failed" = 로드 시도했으나 실패(배치 8 A#2) — 종전엔 실패를 빈 목록(성공 모양)으로 기록해
  // placeholder가 "등록 딜러 없음"(데이터-부재 어휘)으로 오표기했다. 배열 = 로드 성공 목록.
  const [dealerOptionsByCard, setDealerOptionsByCard] = useState<Record<string, SolutionDealer[] | "failed">>({});
  // 카드별 현재 선택 금융사 라벨 — 지원집합 게이트(기간·약정거리) 렌더 파생용 거울이다.
  // 금융사 "값"의 진실은 계속 카드 DOM select(uncontrolled 계약 유지 — 딜러와 동일 설계).
  // 갱신 생명주기도 딜러와 같다: 금융사 변경·조건 복사·초기화.
  const [lenderByCard, setLenderByCard] = useState<Record<string, string>>({});
  // 파트너 지원집합 매트릭스(세션 캐시 1회 로드). 미로드·실패·미확정은 전부 빈/null → 게이트 해제.
  const supportMatrix = useSupportMatrix();
  // (lenderCode, brand) 키 fetch 메모 — 같은 조합 재조회·카드 간 중복 조회 방지(내용 주소형이라 세션 내 유지).
  const dealerFetchCacheRef = useRef(new Map<string, Promise<SolutionDealer[] | "failed">>());
  // 늦은 응답 가드용 브랜드 미러(cardUiRef 패턴) — await 뒤 클로저 브랜드는 stale일 수 있다.
  const workbenchBrandRef = useRef<string | null>(null);
  // 브랜드 "도착"(재진입 복원 — 딜러 보존)과 "전환"(구 브랜드 딜러 청소)을 구분하는 직전 브랜드.
  const prevDealerBrandRef = useRef<string | null>(null);
  const quoteWorkbenchOriginalInputRef = useRef<HTMLInputElement>(null);
  const quoteDetailFormRef = useRef<HTMLDivElement>(null);
  // 수정 진입 시점의 trimId를 고정. 작성완료(send:false)의 optimistic setQuotes가 quote.trimId를 새 차량으로 덮으면
  // openQuoteActionTrimId→VehiclePicker initialTrimId가 흔들려 effect 재발화→applyTrimToPricing 2회 실행(editPrefill 소비됨)
  // →exteriorColor/interiorColor/options 리셋되던 기존 버그 방지(리로딩 전 화면 보존).
  const editEntryTrimIdRef = useRef<number | undefined>(undefined);

  // 앱 견적요청 → 워크벤치 prefill 오픈(차량/구매방식/옵션). 가격은 catalog 계산 보존.
  // 인박스 진입(URL ?quoteRequest=) + 니즈 카드 "견적 작성" 양쪽이 호출. hoisted 함수(useCallback 미사용 — 기존 패턴).
  function openWorkbenchForQuoteRequest(reqId: string): Promise<void> {
    return fetchQuoteRequestDetail(detail.id, reqId).then((prefill) => {
      // 신규 워크벤치 열기와 동일한 리셋(견적함 + 버튼 onClick과 정렬)
      quoteList.handlers.setConfirmingQuoteDeleteId(null);
      setEditingQuoteId(null);
      persistedQuoteIdRef.current = null;
      setEditPrefill(null);
      resetWorkbenchVehicle();
      setGuidance(seedGuidance());
      // 앱 견적요청 조건(기간·보증금/선수금 유형·비율/금액) → 카드1 시드(도메인 규칙: quote-request-seed.ts).
      const seed = seedScenarioCardFromRequest(prefill);
      // 모드는 아래 setCardUi(cardUiFromSeed)가 담당 — 카드는 표시 금액만 시드한다.
      setManualQuoteCards([
        {
          ...emptyQuoteConditionCards[0],
          depositValue: seed.depositValue ?? "0",
          downPaymentValue: seed.downPaymentValue ?? "0",
        },
        emptyQuoteConditionCards[1],
        emptyQuoteConditionCards[2],
      ]);
      clearCardUiState(); // 이전 세션 잔상(잔존가치/약정거리 모드·할인 행·취득세 등) 청소 후 시드만 얹는다
      setCardUi({ [emptyQuoteConditionCards[0].id]: cardUiFromSeed(seed) });
      setSavedManualQuoteConditionIds([]);
      setRecognizedQuoteFile(null);
      setSolutionWorkbenchEntryMode("manual");
      setSolutionWorkbenchModeMenu(null);
      setSolutionWorkbenchPurchaseMethod(primaryQuotePurchaseMethod(purchaseFields)); // 고객 기본값 먼저(+onClick과 동일)
      // 견적요청 prefill 설정 — 컬러 id는 selected일 때만 non-null(그 외 mode는 서버가 null로 저장). applyTrimToPricing이 소비.
      setQuoteRequestPrefill({ trimId: prefill.trimId, optionIds: prefill.optionIds, exteriorColorId: prefill.exteriorColorId, interiorColorId: prefill.interiorColorId });
      setSourceQuoteRequestId(reqId);
      // purchaseMethod(한글)가 워크벤치 옵션 목록에 있으면 override, 없으면 위 고객 기본값 유지(stale 방지).
      if (prefill.purchaseMethod && quotePurchaseMethodOptions.includes(prefill.purchaseMethod as QuotePurchaseMethod)) {
        setSolutionWorkbenchPurchaseMethod(prefill.purchaseMethod as QuotePurchaseMethod);
      }
      resetWorkbenchPricing();
      setIsQuoteSolutionWorkbenchOpen(true);
    });
  }

  // 앱 견적요청 승격(S3): 인박스에서 /customer-detail/:code?quoteRequest=<id>로 진입하면 워크벤치 prefill 오픈.
  const location = useLocation();
  const navigate = useNavigate();
  const quoteRequestPrefillRef = useRef(false); // StrictMode/재렌더 중복 방지
  useEffect(() => {
    const reqId = new URLSearchParams(location.search).get("quoteRequest");
    if (!reqId || quoteRequestPrefillRef.current) return;
    quoteRequestPrefillRef.current = true;
    let cancelled = false; // unmount/이동 가드(quoteRequestPrefillRef 중복방지와 별개)
    void openWorkbenchForQuoteRequest(reqId)
      .catch(() => { if (!cancelled) onToast("견적요청 정보를 불러오지 못했습니다."); })
      .finally(() => {
        // URL에서 파라미터 제거(뒤로가기/재렌더 재오픈 방지). unmount 후엔 navigate 금지.
        if (!cancelled) navigate(`/customer-detail/${customer.customerId}`, { replace: true });
      });
    return () => { cancelled = true; };
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps -- 진입 시 1회 prefill

  const solutionWorkbenchCanQuery =solutionWorkbenchPurchaseMethod === "운용리스" || solutionWorkbenchPurchaseMethod === "장기렌트";
  const quoteDraftReady = isQuoteDraftSaved && !isQuoteDraftDirty;
  // 워크벤치 헤더 차량명: 실시간 선택(workbenchVehicle/trimDetail) 우선, prefill 로드 전엔 수정 견적 저장 텍스트로 폴백(잔상/빈깜빡임 제거).
  const editingQuote = editingQuoteId ? quoteList.quotes.find((q) => q.id === editingQuoteId) : undefined;
  const workbenchVehicleLabel =
    [workbenchVehicle?.brand?.name, dedupedModelTrim(workbenchVehicle?.model?.name, trimDetail?.trimName ?? trimDetail?.name)].filter(Boolean).join(" ")
    || [editingQuote?.brand, dedupedModelTrim(editingQuote?.model, editingQuote?.trim)].filter(Boolean).join(" ")
    || "차량 미선택";
  // 앱카드 푸터/디데이용 영속 견적(수정 진입 editingQuoteId 또는 신규 첫 작성완료 persistedQuoteIdRef).
  // ref 읽기지만 quoteCode 도착(detail 재페치/quotes swap) 자체가 재렌더를 유발해 최신값이 잡힌다.
  const persistedQuoteId = editingQuoteId ?? persistedQuoteIdRef.current;
  const persistedQuote = persistedQuoteId ? detail.quotes.find((q) => q.id === persistedQuoteId) : undefined;
  const appCardModel: AppCardModel = buildAppCardModel({
    brandName: workbenchVehicle?.brand?.name ?? null,
    modelName: workbenchVehicle?.model?.name ?? trimDetail?.modelName ?? null,
    trimName: trimDetail?.trimName ?? trimDetail?.name ?? null,
    modelYear: trimDetail?.modelYear ?? null,
    basePrice: pricingInputs.basePrice,
    optionTotal: pricingInputs.optionPrice,
    optionNames: trimDetail ? trimDetail.options.filter((o) => selectedWorkbenchOptionIds.includes(o.id)).map((o) => o.name) : [],
    discount: pricingInputs.discount,
    discountLabels: discountLines.map((line) => line.label),
    finalVehiclePrice: pricing.finalVehiclePrice,
    acquisitionTax: pricingInputs.acquisitionTax,
    acquisitionTaxMode,
    bond: pricingInputs.bond,
    delivery: pricingInputs.delivery,
    incidental: pricingInputs.incidental,
    registrationCost: pricing.registrationCost,
    acquisitionCost: pricing.acquisitionCost,
    exteriorColorName: exteriorColor?.name ?? null,
    interiorColorName: interiorColor?.name ?? null,
    guidance,
    purchaseMethod: solutionWorkbenchPurchaseMethod,
    scenario: cardScenario,
    quoteCode: persistedQuote?.quoteCode ?? null,
    appStatus: persistedQuote?.appStatus ?? null,
    sentAtIso: persistedQuote?.sentAt ?? null,
    validUntilIso: persistedQuote?.validUntil ?? null,
    nowMs: nowMs(),
  });
  const workbenchFirstTermMonths = manualQuoteCards[0] ? cardUiOf(cardUi, manualQuoteCards[0].id).termMonths : 60;

  function jeffMoneyInputFromTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLInputElement) || !target.closest(".kim-jeff-money-input")) return null;
    if (target.readOnly) return null;
    return target;
  }

  function clearJeffMoneyInputPreview(input: HTMLInputElement) {
    delete input.dataset.replaceOnInput;
    input.classList.remove("is-replace-preview");
  }

  function formatJeffMoneyInput(input: HTMLInputElement) {
    if (input.dataset.discountUnit === "percent") {
      // percent도 빈값 blur는 amount처럼 "0" 복원 — 빈 문자열 잔존이 프리필/검증 경계로 새는 것 방지.
      // 값이 있으면 그대로(소수점 보존 — 콤마 포맷 우회가 percent 분기의 존재 이유).
      if (!input.value.trim()) input.value = "0";
      return;
    }
    const value = parseMoney(input.value);
    input.value = value ? formatMoney(value) : "0";
  }

  function handleJeffMoneyInputFocus(event: ReactFocusEvent<HTMLDivElement>) {
    const target = jeffMoneyInputFromTarget(event.target);
    if (!target) return;
    target.dataset.replaceOnInput = "true";
    target.classList.add("is-replace-preview");
    target.setSelectionRange(target.value.length, target.value.length);
  }

  function handleJeffMoneyInputMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.closest(".kim-jeff-money-input")) return;
    event.preventDefault();
    target.focus();
    target.dataset.replaceOnInput = "true";
    target.classList.add("is-replace-preview");
    target.setSelectionRange(target.value.length, target.value.length);
  }

  function handleJeffMoneyInputBeforeInput(event: SyntheticEvent<HTMLDivElement>) {
    const target = jeffMoneyInputFromTarget(event.target);
    if (!target || target.dataset.replaceOnInput !== "true") return;
    const nativeEvent = event.nativeEvent as InputEvent;
    if (nativeEvent.inputType !== "insertText" || !nativeEvent.data) return;
    event.preventDefault();
    target.value = nativeEvent.data;
    formatJeffMoneyInput(target);
    clearJeffMoneyInputPreview(target);
    markQuoteDraftChanged();
    target.setSelectionRange(target.value.length, target.value.length);
  }

  function handleJeffMoneyInputBlur(event: ReactFocusEvent<HTMLDivElement>) {
    const target = jeffMoneyInputFromTarget(event.target);
    if (!target) return;
    clearJeffMoneyInputPreview(target);
    formatJeffMoneyInput(target);
    markQuoteDraftChanged();
    recomputePricing();
  }

  function handleJeffMoneyInputChange(event: ChangeEvent<HTMLDivElement>) {
    const target = jeffMoneyInputFromTarget(event.target);
    if (!target) return;
    clearJeffMoneyInputPreview(target);
    if (target.dataset.discountUnit !== "percent") {
      window.requestAnimationFrame(() => formatJeffMoneyInput(target));
    }
  }

  function handleJeffMoneyInputPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    const target = jeffMoneyInputFromTarget(event.target);
    if (!target || target.dataset.replaceOnInput !== "true") return;
    event.preventDefault();
    target.value = event.clipboardData.getData("text");
    formatJeffMoneyInput(target);
    clearJeffMoneyInputPreview(target);
    markQuoteDraftChanged();
    target.setSelectionRange(target.value.length, target.value.length);
  }

  function handleJeffMoneyInputKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = jeffMoneyInputFromTarget(event.target);
    if (!target || target.dataset.replaceOnInput !== "true") return;
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      target.value = "";
      clearJeffMoneyInputPreview(target);
      markQuoteDraftChanged();
      window.requestAnimationFrame(handlePricingPanelInput);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
    event.preventDefault();
    target.value = event.key;
    formatJeffMoneyInput(target);
    clearJeffMoneyInputPreview(target);
    markQuoteDraftChanged();
    target.setSelectionRange(target.value.length, target.value.length);
    window.requestAnimationFrame(handlePricingPanelInput);
  }

  function handleJeffMoneyInputMouseUp(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.closest(".kim-jeff-money-input") || target.dataset.replaceOnInput !== "true") return;
    event.preventDefault();
    target.setSelectionRange(target.value.length, target.value.length);
  }

  // 수정 진입 시 기존 시나리오(round)를 비교카드 골격에 덮어쓴다(빈 슬롯은 기본 mock).
  // snapshots = 그 견적의 솔루션 스냅샷 시드(solutionSnapshotsFromScenarios 결과) — max 잔가 표시값 복원용.
  function buildManualCardsFromScenarios(scenarios: EditScenario[], snapshots: Record<string, SolutionSnapshot>): ManualCard[] {
    return emptyQuoteConditionCards.map((base) => {
      const sc = scenarios.find((s) => String(s.scenarioNo) === base.round);
      if (!sc) return base;
      return {
        ...base,
        lender: sc.lender || "미선택",
        monthlyPayment: sc.monthlyPayment ? formatMoney(Number(sc.monthlyPayment)) : "0",
        // 모드는 cardUi(setCardUi ← cardUiMapFromScenarios)가 갖는다. 여기선 표시 금액 포맷에만 쓴다.
        depositValue: sc.depositMode === "percent" ? sc.depositValue : (sc.depositValue ? formatMoney(Number(sc.depositValue)) : "0"),
        downPaymentValue: sc.downPaymentMode === "percent" ? sc.downPaymentValue : (sc.downPaymentValue ? formatMoney(Number(sc.downPaymentValue)) : "0"),
        // max 모드는 DB residualValue가 null — 스냅샷 있으면 실채택 잔가 복원(재진입 직후 파생이 인수·금리를
        // 보존 계산, 무재조회 재저장 소실 방지), 없으면(구 수기 견적) 기존 "-" placeholder 유지.
        residualValue: sc.residualMode === "max"
          ? (residualDisplayFromSnapshot(snapshots[cardIdOfScenarioNo(sc.scenarioNo)]) ?? "-")
          : (sc.residualMode === "percent" ? sc.residualValue : (sc.residualValue ? formatMoney(Number(sc.residualValue)) : "0")),
        subsidyAmount: sc.subsidyAmount && Number(sc.subsidyAmount) > 0 ? formatMoney(Number(sc.subsidyAmount)) : "0",
        totalReturn: sc.totalReturnCost ? formatMoney(Number(sc.totalReturnCost)) : "0",
        totalTakeover: sc.totalTakeoverCost ? formatMoney(Number(sc.totalTakeoverCost)) : "0",
        dueAtDelivery: sc.dueAtDelivery ? formatMoney(Number(sc.dueAtDelivery)) : "0",
        interestRate: sc.interestRate || "0",
        // % 원문 표시(콤마 포맷 우회 규약 — 금리와 동일). 원 환산 미리보기는 파생이 채운다.
        cmFeePercent: sc.cmFeePercent || "0",
        agFeePercent: sc.agFeePercent || "0",
        // 판매사(T2) — cm/ag `|| "0"`과 달리 빈 문자열이 "값 없음"(select "선택" option) 그 자체다.
        // 이 값이 곧 딜러 select의 defaultValue + "저장값 표시 유지" option(목록 fetch 도착 전에도 표시).
        dealerName: sc.dealerName ?? "",
      };
    });
  }

  function saveManualQuoteCondition(conditionId: string, conditionRound: string) {
    setSavedManualQuoteConditionIds((current) => (
      current.includes(conditionId) ? current : [...current, conditionId]
    ));
    onToast(`${conditionRound}번 조건을 담았습니다. "작성완료"를 누르면 저장됩니다.`);
  }

  function editManualQuoteCondition(conditionId: string, conditionRound: string) {
    setSavedManualQuoteConditionIds((current) => current.filter((id) => id !== conditionId));
    onToast(`${conditionRound}번 조건을 수정할 수 있습니다.`);
  }

  // N번 복사(비교카드 헤더): 직전 카드의 조건 — 금융사·기간·보증금·선수금·잔존가치·약정거리·자동차세·보조금
  // (모드+입력값) — 을 이 카드로 복사한다. 월납입·결과 4필드·솔루션 스냅샷은 조회 파생값이라 복사하지 않는다
  // (조건만 — 복사 후 계산기 재조회가 채운다). 값은 uncontrolled DOM 직접 쓰기(applySolutionResult 관례),
  // 모드는 patchCardUi — cardUi 변경이 파생·미리보기 effect를 발화시켜 별도 refresh 호출이 없다.
  function copyManualQuoteCondition(targetId: string, targetRound: string) {
    if (savedManualQuoteConditionIds.includes(targetId)) return; // 저장(잠금) 카드 보호 — 버튼 disabled 미러
    const sourceRound = Number(targetRound) - 1;
    const sourceId = cardIdOfScenarioNo(sourceRound);
    const compareForm = quoteDetailFormRef.current;
    const sourceEl = compareForm?.querySelector<HTMLElement>(`[data-scenario-card="${sourceId}"]`);
    const targetEl = compareForm?.querySelector<HTMLElement>(`[data-scenario-card="${targetId}"]`);
    if (!sourceEl || !targetEl) return;
    const sourceLender = sourceEl.querySelector<HTMLSelectElement>('select[data-sc-field="lender"]')?.value ?? "미선택";
    const targetLender = targetEl.querySelector<HTMLSelectElement>('select[data-sc-field="lender"]');
    // 대상 select에 없는 값 대입은 선택을 비워버린다(selectedIndex -1) — 구 어휘 금융사(수정 재진입 견적의
    // "표시 유지" option)는 대상 카드에 렌더되지 않으므로, option 존재를 확인하고 없으면 건드리지 않는다.
    const lenderCopyable = targetLender != null && Array.from(targetLender.options).some((o) => o.value === sourceLender);
    if (targetLender && lenderCopyable) targetLender.value = sourceLender;
    for (const field of ["deposit", "downPayment", "residual", "subsidy", "cmFeePercent", "agFeePercent"]) {
      const src = sourceEl.querySelector<HTMLInputElement>(`input[data-sc-field="${field}"]`);
      const dst = targetEl.querySelector<HTMLInputElement>(`input[data-sc-field="${field}"]`);
      if (src && dst) dst.value = src.value;
    }
    // 판매사(T2): 금융사가 함께 복사되므로 (금융사, 브랜드) 딜러 목록도 대상에 그대로 유효 — 목록 state 복사 +
    // ManualCard.dealerName 재시드(딜러 select 리마운트 키)로 "대상 select에 option이 아직 없는" 타이밍을
    // 우회한다(딜러 option은 비동기 fetch 산물이라 직접 DOM 쓰기는 option 부재 시 무음 no-op — 정적 어휘인
    // 금융사 select와 다른 지점). DOM 쓰기는 option 기존재 시 즉시 반영(빈값 "" 포함 — 소스가 미선택이면
    // 대상 선택도 청소). 금융사가 복사에서 제외됐으면(구 어휘) 그 금융사 귀속인 딜러도 함께 제외.
    // 모드(dealerMode)는 아래 patchCardUi(cardUi 통째 복사)가 담당.
    if (lenderCopyable) {
      const sourceDealer = sourceEl.querySelector<HTMLSelectElement>('select[data-sc-field="dealer"]')?.value ?? "";
      const dstDealer = targetEl.querySelector<HTMLSelectElement>('select[data-sc-field="dealer"]');
      if (dstDealer) dstDealer.value = sourceDealer;
      setDealerOptionsByCard((prev) => (prev[sourceId] ? { ...prev, [targetId]: prev[sourceId] } : prev));
      // 게이트 거울은 여기서 복사하지 않는다 — 위 :436에서 대상 select DOM에 금융사를 이미 썼고,
      // 아래 patchCardUi가 커밋을 유발하므로 재동기화 effect가 같은 값을 읽는다(배치 13 K1).
      setManualQuoteCards((cards) => cards.map((c) => (c.id === targetId ? { ...c, dealerName: sourceDealer } : c)));
    }
    patchCardUi(targetId, cardUiOf(cardUi, sourceId));
    onToast(targetLender != null && !lenderCopyable
      ? `${sourceRound}번 조건을 복사했습니다. (금융사 "${sourceLender}"은 지원 목록에 없어 제외)`
      : `${sourceRound}번 조건을 복사했습니다.`);
  }

  function markQuoteDraftChanged() {
    if (!isQuoteDraftSaved) return;
    setIsQuoteDraftDirty(true);
    setIsQuoteAppCardPreviewOpen(false);
  }

  function readPricingInputs(root: HTMLElement): PricingInputs {
    const read = (key: string) =>
      parseMoney(root.querySelector<HTMLInputElement>(`input[data-pricing="${key}"]`)?.value ?? "");
    return {
      basePrice: read("base"),
      optionPrice: read("option"),
      discount: read("discount"),
      acquisitionTax: read("acquisitionTax"),
      bond: read("bond"),
      delivery: read("delivery"),
      incidental: read("incidental"),
    };
  }

  function recomputePricing() {
    const root = pricingPanelRef.current;
    if (!root) return;
    const inputs = readPricingInputs(root);
    setPricingInputs(inputs);
    setPricing(computePricing(inputs));
    // 가격패널 변경(기타비용·취득원가·차량가)도 결과 4필드 파생 입력이다(개정 1 R3) — 카드 편집과 같은
    // 수렴점(refreshCardScenarioPreview: derive → extract)으로 재계산해 미리보기·저장 정합을 유지.
    refreshCardScenarioPreview();
  }

  // 추가 할인 행 영속 스냅샷(crm.quotes.discount_lines) — 금액의 진실 원본은 uncontrolled DOM input
  // (state amount는 초기 표시값이라 입력 후 stale). root 없으면 state 표시값 폴백. 빈 배열은 null
  // (스키마 기본값과 정렬 — 추가 행 없는 견적은 행 자체가 없다는 의미로 저장).
  function readDiscountLineSnapshots(root: HTMLElement | null): QuoteDiscountLine[] | null {
    const rows = discountLines.map((line) => {
      const raw = root?.querySelector<HTMLInputElement>(`input[data-discount-id="${line.id}"]`)?.value ?? line.amount;
      return { label: line.label, amount: line.unit === "percent" ? parsePercentInput(raw) : parseMoney(raw), unit: line.unit };
    });
    return rows.length ? rows : null;
  }

  function syncDiscountTotalFromRows(root: HTMLElement) {
    const discountInputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[data-discount-line="true"]'));
    if (!discountInputs.length) return;
    // 환산 산술은 discountLineWon(quote-workbench-meta) 1벌 — 역산 복원(restoreDiscountLines)과 동일해야
    // 수정 재진입 기본 할인이 안 어긋난다. basis 읽기도 discountBasis 헬퍼 1벌(배치 F).
    const basis = discountBasis(root);
    const total = discountInputs.reduce((sum, input) => {
      const unit: DiscountUnit = input.dataset.discountUnit === "percent" ? "percent" : "amount";
      const value = unit === "percent" ? parsePercentInput(input.value) : parseMoney(input.value);
      return sum + discountLineWon(unit, value, basis);
    }, 0);
    const discountTotal = root.querySelector<HTMLInputElement>('input[data-pricing="discount"]');
    if (discountTotal) discountTotal.value = formatMoney(total);
  }

  function discountBasis(root: HTMLElement) {
    return parseMoney(root.querySelector<HTMLInputElement>('input[data-pricing="base"]')?.value ?? "") +
      parseMoney(root.querySelector<HTMLInputElement>('input[data-pricing="option"]')?.value ?? "");
  }

  function formatPercent(value: number) {
    return value.toFixed(2).replace(/\.?0+$/, "");
  }

  function convertDiscountInputUnit(input: HTMLInputElement, from: DiscountUnit, to: DiscountUnit, basis: number) {
    if (from === to) return;
    const value = from === "percent" ? parsePercentInput(input.value) : parseMoney(input.value);
    if (!value || !basis) {
      input.value = "0";
      return;
    }
    // %→금액 환산은 discountLineWon 공유 산술(합산·역산과 동일 라운딩).
    input.value = to === "percent" ? formatPercent(value / basis * 100) : formatMoney(discountLineWon("percent", value, basis));
  }

  function handlePricingPanelInput() {
    const root = pricingPanelRef.current;
    if (!root) return;
    syncDiscountTotalFromRows(root);
    recomputePricing();
  }

  function addDiscountLine() {
    setDiscountLines((prev) => [...prev, { id: `discount-${nowMs()}`, label: "재구매 할인", amount: "0", unit: "amount" }]);
    markQuoteDraftChanged();
  }

  function removeDiscountLine(id: string) {
    setDiscountLines((prev) => prev.filter((line) => line.id !== id));
    window.requestAnimationFrame(() => {
      const root = pricingPanelRef.current;
      if (!root) return;
      syncDiscountTotalFromRows(root);
      recomputePricing();
    });
    markQuoteDraftChanged();
  }

  function setPrimaryDiscountMode(unit: DiscountUnit) {
    const root = pricingPanelRef.current;
    const input = root?.querySelector<HTMLInputElement>('input[data-discount-primary="true"]');
    if (root && input) convertDiscountInputUnit(input, primaryDiscountUnit, unit, discountBasis(root));
    setPrimaryDiscountUnit(unit);
    window.requestAnimationFrame(() => {
      const root = pricingPanelRef.current;
      if (!root) return;
      syncDiscountTotalFromRows(root);
      recomputePricing();
    });
    markQuoteDraftChanged();
  }

  // 추가 할인 행 항목명 변경 — select가 defaultValue만 갖고 state 미배선이라 라벨이 "재구매 할인"으로 박제되던 것 픽스.
  function setDiscountLineLabel(id: string, label: string) {
    setDiscountLines((prev) => prev.map((line) => (line.id === id ? { ...line, label } : line)));
    markQuoteDraftChanged();
  }

  function setDiscountLineMode(id: string, unit: DiscountUnit) {
    const current = discountLines.find((line) => line.id === id);
    const root = pricingPanelRef.current;
    const input = root?.querySelector<HTMLInputElement>(`input[data-discount-id="${id}"]`);
    if (root && input && current) convertDiscountInputUnit(input, current.unit, unit, discountBasis(root));
    setDiscountLines((prev) => prev.map((line) => line.id === id ? { ...line, unit } : line));
    window.requestAnimationFrame(() => {
      const root = pricingPanelRef.current;
      if (!root) return;
      syncDiscountTotalFromRows(root);
      recomputePricing();
    });
    markQuoteDraftChanged();
  }

  // 워크벤치 열기/수정 진입 시 이전 견적 차량 잔상 제거(비동기 prefill 전 즉시 리셋).
  function resetWorkbenchVehicle() {
    setTrimDetail(null);
    setWorkbenchVehicle(null);
    setSelectedWorkbenchOptionIds([]);
    setExteriorColor(null);
    setInteriorColor(null);
  }

  // 워크벤치 열기/수정 진입/초기화 시 이전 세션 가격 잔상 제거(트림 로드 전 최종가 표시 오염 방지).
  // 수정 진입에도 안전: editPrefill 가격은 applyTrimToPricing(비동기 트림 로드 후)이 DOM+state를 다시 쓴다.
  function resetWorkbenchPricing() {
    setPricingInputs(emptyQuotePricing);
    setPricing(computePricing(emptyQuotePricing));
  }

  // 워크벤치 열기/승격/초기화 시 카드 UI 상태 잔상 제거 — 카드 모드·할인 행·취득세 모드는
  // extractWorkbenchScenarios/persist가 읽어 화면 잔상이 아니라 저장까지 오염되므로 가격과 함께 반드시 청소한다.
  // (수정 진입은 시나리오에서 전량 재구성하므로 cardUi는 복원 setter가 대체 — discountLines/취득세만 별도 처리.)
  function clearCardUiState() {
    setCardUi({});
    setDiscountLines([]);
    setAcquisitionTaxMode("normal");
    setPrimaryDiscountUnit("amount");
    // 솔루션 스냅샷도 저장 payload에 실리는 값 — 이전 견적 스냅샷이 새 견적에 새는 잔상 방지(#163 부류).
    setSolutionSnapshots({});
    setSolutionLenderPickerId(null); // 모달 열린 채 워크벤치가 닫힌 경우의 유령 모달 방어
    setDealerOptionsByCard({}); // 딜러 목록도 카드 종속 상태 — 이전 견적 금융사의 목록 잔존 방지(T2)
    // 게이트 거울(lenderByCard)은 여기서 지우지 않는다 — 배치 13 K1-d: 이 자리의 클리어는 DOM select는
    // 그대로 둔 채 거울만 비워 "거울 ≠ 화면"을 만들었다(초기화 후 게이트 전면 해제 실측). 재동기화 effect가 담당.
  }

  async function applyTrimToPricing(selection: VehicleSelection) {
    const trim = selection.trim;
    if (!trim) return;
    try {
      const detail = selection.trimDetail ?? await fetchTrimDetail(trim.id);
      const prefill = editPrefill;
      const qrPrefill = quoteRequestPrefill; // 견적요청 옵션(가격은 catalog 계산)
      setTrimDetail(detail);
      setWorkbenchVehicle(selection);
      setSelectedWorkbenchOptionIds(prefill ? prefill.optionIds : (qrPrefill?.optionIds ?? []));
      // 컬러 프리필: 수정 재진입(editPrefill) 우선, 승격(qrPrefill) 폴백 — 옵션과 대칭. 승격은 selected일 때만 id가
      // 있고(그 외 null), find가 못 찾으면 null이라 mode 분기 불필요. ColorPicker가 hexValue로 스와치를 렌더.
      const colorFrom = prefill ?? qrPrefill;
      setExteriorColor(colorFrom ? detail.colors.find((c) => c.id === colorFrom.exteriorColorId) ?? null : null);
      setInteriorColor(colorFrom ? detail.colors.find((c) => c.id === colorFrom.interiorColorId) ?? null : null);
      const root = pricingPanelRef.current;
      if (!root) { setEditPrefill(null); return; }
      const setInput = (key: string, value: number) => {
        const el = root.querySelector<HTMLInputElement>(`input[data-pricing="${key}"]`);
        if (el) el.value = formatMoney(value);
      };
      const primaryDiscount = root.querySelector<HTMLInputElement>('input[data-discount-primary="true"]');
      if (prefill) {
        setInput("base", prefill.pricing.base);
        setInput("option", prefill.pricing.option);
        setInput("discount", prefill.pricing.discount);
        setInput("acquisitionTax", prefill.pricing.acquisitionTax);
        setInput("bond", prefill.pricing.bond);
        setInput("delivery", prefill.pricing.delivery);
        setInput("incidental", prefill.pricing.incidental);
        // 기본 할인 행은 총액이 아니라 분리 산술값(총액 − 추가 행 환산 합) — 추가 행은 복원된
        // discountLines가 자기 입력칸(defaultValue)으로 렌더되므로 여기서 총액을 넣으면 이중 계상된다.
        if (primaryDiscount) primaryDiscount.value = formatMoney(prefill.pricing.primaryDiscount);
      } else {
        setInput("base", detail.price);
        const qrOptionTotal = qrPrefill
          ? detail.options.filter((o) => qrPrefill.optionIds.includes(o.id)).reduce((s, o) => s + (o.price ?? 0), 0)
          : 0;
        setInput("option", qrOptionTotal);
        setInput("discount", detail.financialDiscountAmount ?? 0);
        if (primaryDiscount) primaryDiscount.value = formatMoney(detail.financialDiscountAmount ?? 0);
      }
      setPrimaryDiscountUnit("amount");
      recomputePricing();
      markQuoteDraftChanged();
      setEditPrefill(null);
      setQuoteRequestPrefill(null); // 견적요청 차량/옵션 prefill 1회 소비(차량 재선택 시 재적용 방지). sourceQuoteRequestId는 저장 때 필요해 유지.
    } catch (error) {
      console.warn("트림 상세 로드 실패", error);
    }
  }

  function applyOptionTotal(next: { selectedIds: number[]; total: number }) {
    setSelectedWorkbenchOptionIds(next.selectedIds);
    const root = pricingPanelRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLInputElement>('input[data-pricing="option"]');
    if (el) el.value = formatMoney(next.total);
    recomputePricing();
    markQuoteDraftChanged();
  }

  // 수정모드 대상 견적의 catalog trimId(VehiclePicker 차량 복원용, PR1). 신규면 undefined.
  function openQuoteActionTrimId(): number | undefined {
    if (!editingQuoteId) return undefined;
    return editEntryTrimIdRef.current; // live quotes 대신 진입 스냅샷 — optimistic trimId 갱신에 흔들리지 않음
  }

  // 카드 UI 상태 부분 갱신 — 없던 카드는 기본값에서 시작(cardUiOf). 모든 카드 setter의 유일 진입점.
  function patchCardUi(conditionId: string, patch: Partial<CardUiState>) {
    setCardUi((prev) => ({ ...prev, [conditionId]: { ...cardUiOf(prev, conditionId), ...patch } }));
    markQuoteDraftChanged();
  }

  function setManualDepositMode(conditionId: string, mode: ManualDepositMode) {
    patchCardUi(conditionId, { depositMode: mode });
  }

  function setManualDownPaymentMode(conditionId: string, mode: ManualDepositMode) {
    patchCardUi(conditionId, { downPaymentMode: mode });
  }

  function setManualResidualMode(conditionId: string, mode: ManualResidualMode) {
    patchCardUi(conditionId, { residualMode: mode });
  }

  // 기본 모드로 되돌리면 표시값도 고정값으로 리셋(통합 전 setManualMileageValues 동반 호출과 동일).
  function setManualMileageMode(conditionId: string, mode: ManualMileageMode) {
    patchCardUi(conditionId, mode === "basic" ? { mileageMode: mode, mileageValue: MILEAGE_BASIC_VALUE } : { mileageMode: mode });
  }

  function setManualMileageValue(conditionId: string, value: string) {
    patchCardUi(conditionId, { mileageValue: value });
  }

  function setManualTermMonthsFor(conditionId: string, months: number) {
    patchCardUi(conditionId, { termMonths: months });
  }

  function setManualCarTaxFor(conditionId: string, included: boolean) {
    patchCardUi(conditionId, { carTaxIncluded: included });
  }

  function setManualSubsidyFor(conditionId: string, applicable: boolean) {
    patchCardUi(conditionId, { subsidyApplicable: applicable });
  }

  // 비제휴 전환은 선택값을 지우지 않는다(DOM 잔존 — 계산기 dealerType 토글 미러, 되돌리면 복원).
  // 추출·조회 payload가 모드로 게이트하므로 잔존 값은 저장·전송에 안 실린다.
  function setManualDealerMode(conditionId: string, mode: ManualDealerMode) {
    patchCardUi(conditionId, { dealerMode: mode });
  }

  // ── 판매사(딜러) 목록 적재/리셋(T2) ─────────────────────────────────────────
  // 스코프 = 카드의 선택 금융사 + 워크벤치 브랜드(계산기의 전사 union fetch와 다름 — 단일 금융사 조건
  // 카드라 그 금융사 딜러만 의미가 있고, option 라벨에 lender 접두도 불필요).

  async function loadCardDealers(condId: string, lenderLabel: string) {
    const brand = workbenchVehicle?.brand?.name ?? null;
    const lender = solutionLenderOptions(solutionWorkbenchPurchaseMethod).find((l) => l.label === lenderLabel);
    // 브랜드 미선택·파트너 미지원 금융사(CRM 수기 어휘 포함)는 목록 없음 → 키 삭제(빈 배열 아님).
    // 키 존재 = "금융사 스코프 로드 시도 결과"라는 계약 — placeholder(dealerSelectPlaceholder)가
    // "금융사 먼저 선택"(키 부재)과 "등록 딜러 없음"(성공 0건)·"불러오지 못했습니다"("failed")를 구분하는 근거.
    if (!brand || !lender) {
      setDealerOptionsByCard((prev) => {
        if (!(condId in prev)) return prev;
        const next = { ...prev };
        delete next[condId];
        return next;
      });
      return;
    }
    const key = `${lender.code}::${brand}`;
    let pending = dealerFetchCacheRef.current.get(key);
    if (!pending) {
      // 실패 = "failed" 마커(배치 8 A#2 — 구 빈 목록 기록은 성공 모양이라 "등록 딜러 없음" 오표기)
      // + 캐시 키 삭제 — 일시 장애가 세션 내내 실패로 박제되지 않게(금융사/브랜드 재전환이 재시도 트리거).
      pending = fetchSolutionDealers(lender.code, brand).catch(() => {
        dealerFetchCacheRef.current.delete(key);
        console.warn(`[workbench] 딜러 목록 조회 실패 lender=${lender.code} brand=${brand}`);
        return "failed" as const;
      });
      dealerFetchCacheRef.current.set(key, pending);
    }
    const list = await pending;
    // 늦은 응답 가드(#163 부류): 응답 시점 카드의 금융사·브랜드가 요청과 다르면 버린다(카드 detach 포함).
    const cardEl = quoteDetailFormRef.current?.querySelector<HTMLElement>(`[data-scenario-card="${condId}"]`);
    const liveLender = cardEl?.querySelector<HTMLSelectElement>('select[data-sc-field="lender"]')?.value;
    if (!cardEl?.isConnected || liveLender !== lenderLabel || workbenchBrandRef.current !== brand) return;
    setDealerOptionsByCard((prev) => ({ ...prev, [condId]: list }));
  }

  // 금융사/브랜드 전환 시 딜러 선택 청소 — 타사(타 브랜드) 딜러 잔존은 무음 오계산(T1 useMultiQuote 스코프
  // 가드와 같은 근거). DOM 값 + 저장 표시 option 원천(ManualCard.dealerName — 지우면 select 리마운트) 양쪽.
  function resetCardDealer(cardEl: HTMLElement, condId: string) {
    const dealerSelect = cardEl.querySelector<HTMLSelectElement>('select[data-sc-field="dealer"]');
    if (dealerSelect) dealerSelect.value = "";
    setManualQuoteCards((cards) => cards.map((c) => (c.id === condId && c.dealerName ? { ...c, dealerName: "" } : c)));
  }

  // 델리게이션(handleManualCardFieldEdit) 경유 금융사 select 변경 감지. uncontrolled select의 change/input은
  // 실제 값 변경에서만 발화하므로(같은 값 재선택 = 무이벤트) 이벤트 자체가 "금융사가 바뀌었다"는 신호다.
  // onInput+onChange 이중 발화(Safari 병행 바인딩 관례)는 리셋·적재 모두 멱등이라 무해.
  function syncDealerOnLenderChange(target: EventTarget | null) {
    if (!(target instanceof HTMLSelectElement) || target.dataset.scField !== "lender") return;
    const cardEl = target.closest<HTMLElement>("[data-scenario-card]");
    const condId = cardEl?.dataset.scenarioCard;
    if (!cardEl || !condId) return;
    setLenderByCard((prev) => ({ ...prev, [condId]: target.value }));
    applyGateFallback(condId, target.value);
    resetCardDealer(cardEl, condId);
    void loadCardDealers(condId, target.value);
  }

  // 금융사 변경으로 현재 기간·약정거리가 그 금융사 미취급이 되면 폴백값으로 옮기고 1회 안내한다.
  // ⚠️ 폴백은 **이 경로(금융사 변경)에서만** 돈다 — 마운트·수정 진입에서 돌리면 상담사가 견적을
  // 열자마자 저장값이 조용히 바뀐다. 과거 견적의 미취급 조합은 그대로 보여야 정직하고, 그 표시는
  // 렌더 쪽 "현재 선택값은 목록에서 항상 살린다" 규칙이 지킨다(spec §4.4 폴백 시점).
  function applyGateFallback(condId: string, lenderLabel: string) {
    const product = solutionProductTypeOf(solutionWorkbenchPurchaseMethod);
    if (!product) return; // 금융리스·할부 등 파트너 미구현 = 게이트 대상 아님
    const plan = planGateFallback(
      cardUiOf(cardUi, condId),
      supportedTermsFor(supportMatrix, lenderLabel, product),
      supportedMileagesFor(supportMatrix, lenderLabel, product),
    );
    if (plan.termMonths !== null) setManualTermMonthsFor(condId, plan.termMonths);
    if (plan.mileageValue !== null) setManualMileageValue(condId, plan.mileageValue);
    if (plan.moved.length > 0) onToast(`${lenderLabel} 미취급 조건이라 ${plan.moved.join(" · ")}(으)로 변경했습니다`);
  }

  // 브랜드 확정/변경 시 카드별 딜러 목록 재적재 — 재진입 복원의 핵심 경로: openEditQuote 시점엔 차량이 아직
  // 없어(resetWorkbenchVehicle → VehiclePicker 비동기 복원 → applyTrimToPricing) 목록을 못 얻고, 브랜드
  // 도착이 그 신호다. 신규 워크벤치는 카드 금융사가 전부 "미선택"이라 자연 no-op. 세션 중 브랜드 "전환"
  // (직전 브랜드 존재)은 구 브랜드 딜러 선택까지 청소한다 — "도착"(재진입 복원, 직전 null)과 구분.
  const workbenchBrand = workbenchVehicle?.brand?.name ?? null;
  workbenchBrandRef.current = workbenchBrand;
  useEffect(() => {
    const prevBrand = prevDealerBrandRef.current;
    prevDealerBrandRef.current = workbenchBrand;
    if (!workbenchBrand) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 계산기 미러: 브랜드 해제 시 딜러 목록 클리어
      setDealerOptionsByCard({});
      return;
    }
    const compareForm = quoteDetailFormRef.current;
    for (const card of manualQuoteCards) {
      const cardEl = compareForm?.querySelector<HTMLElement>(`[data-scenario-card="${card.id}"]`);
      if (!cardEl) continue;
      if (prevBrand && prevBrand !== workbenchBrand) resetCardDealer(cardEl, card.id);
      const lender = cardEl.querySelector<HTMLSelectElement>('select[data-sc-field="lender"]')?.value;
      if (lender && lender !== "미선택") void loadCardDealers(card.id, lender);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 브랜드 변경 시점에만 재적재(카드 금융사는 그 시점 DOM이 최신 — uncontrolled 계약)
  }, [workbenchBrand]);

  function validateQuoteDetailDraft() {
    const form = quoteDetailFormRef.current;
    if (!form) return ["세부 견적 작성 영역을 확인해 주세요."];
    const missing: string[] = [];
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((field) => {
      if (field.closest(".kim-app-guidance-grid")) return; // 추가 안내 사항은 선택 입력(빈값 허용)
      const label = field.closest("label")?.querySelector("span")?.textContent?.trim() ?? "필수 항목";
      const value = field.value.trim();
      if (!value) {
        missing.push(`${label} 입력이 필요합니다.`);
        return;
      }
      if (field.dataset.rejectValue && value === field.dataset.rejectValue) {
        missing.push(`${label}가 ${field.dataset.rejectValue} 상태입니다.`);
      }
    });
    return missing;
  }

  function saveQuoteDetailDraft() {
    persistWorkbenchQuote({ send: false });
  }

  function guardQuoteDraftOutput(outputLabel: string) {
    if (quoteDraftReady) return true;
    const missing = validateQuoteDetailDraft();
    if (missing.length > 0) {
      onToast(missing.slice(0, 3).join(" "));
      return false;
    }
    onToast(`${outputLabel} 전에 먼저 "작성완료"로 저장해 주세요.`);
    return false;
  }

  useEffect(() => {
    if (!solutionWorkbenchCanQuery && solutionWorkbenchEntryMode === "solution") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 솔루션 조회 불가 구매방식에서 작성 방식을 수기로 되돌리는 의도된 가드 effect
      setSolutionWorkbenchEntryMode("manual");
    }
  }, [solutionWorkbenchCanQuery, solutionWorkbenchEntryMode]);

  useEffect(() => {
    if (!isQuoteSolutionWorkbenchOpen) return;

    function closeQuoteSolutionWorkbenchByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      // 모달 스택 관례: 금융사 선택 모달이 열려 있으면 Esc는 모달만 닫는다(워크벤치 유지) —
      // 분기 없이 워크벤치가 닫히면 pickerId가 남아 재오픈 시 유령 모달(#163 잔상 부류).
      if (solutionLenderPickerId) {
        setSolutionLenderPickerId(null);
        return;
      }
      if (solutionWorkbenchModeMenu) {
        setSolutionWorkbenchModeMenu(null);
        return;
      }
      setIsQuoteSolutionWorkbenchOpen(false);
    }

    function closeQuoteSolutionWorkbenchMenu(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (solutionWorkbenchModeMenu && target.closest(`[data-workbench-mode="${solutionWorkbenchModeMenu}"]`)) return;
      setSolutionWorkbenchModeMenu(null);
    }

    document.addEventListener("keydown", closeQuoteSolutionWorkbenchByKeyboard);
    document.addEventListener("pointerdown", closeQuoteSolutionWorkbenchMenu, true);
    return () => {
      document.removeEventListener("keydown", closeQuoteSolutionWorkbenchByKeyboard);
      document.removeEventListener("pointerdown", closeQuoteSolutionWorkbenchMenu, true);
    };
  }, [isQuoteSolutionWorkbenchOpen, solutionWorkbenchModeMenu, solutionLenderPickerId]);

  // 카드 1장의 조건 스냅샷 → 파트너 입력 조립 인자(금융사 제외). 직접 계산(queryCardSolution)과
  // 랭킹 모달 배치(SolutionLenderRankingModal — 금융사별 병렬, 개정 2 R4)가 같은 조립을 공유한다.
  function buildCardSolutionArgs(condId: string): { cardEl: HTMLElement; base: Omit<BuildArgs, "lenderLabel"> } | null {
    const compareForm = quoteDetailFormRef.current;
    const cardEl = compareForm?.querySelector<HTMLElement>(`[data-scenario-card="${condId}"]`);
    if (!cardEl) return null;
    const fieldVal = (f: string) => cardEl.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-sc-field="${f}"]`)?.value ?? "";
    const ui = cardUiOf(cardUi, condId);
    // 할인 전 차량가(base+option)·할인 총액은 가격패널(pricingPanelRef) uncontrolled input에서 읽는다
    // (readPricingInputs 재사용 — 저장 추출과 동일 관례. 비교카드 폼(quoteDetailFormRef)에는 data-pricing이 없다).
    const pricingRoot = pricingPanelRef.current;
    const pricingNow = pricingRoot ? readPricingInputs(pricingRoot) : null;
    return {
      cardEl,
      base: {
        purchaseMethod: solutionWorkbenchPurchaseMethod,
        termMonths: ui.termMonths,
        depositMode: ui.depositMode,
        depositRaw: fieldVal("deposit"),
        downPaymentMode: ui.downPaymentMode,
        downPaymentRaw: fieldVal("downPayment"),
        residualMode: ui.residualMode,
        residualRaw: fieldVal("residual"),
        mileageValue: effectiveMileageValue(ui),
        subsidyApplicable: ui.subsidyApplicable,
        subsidyRaw: fieldVal("subsidy"),
        cmFeeRaw: fieldVal("cmFeePercent"),
        agFeeRaw: fieldVal("agFeePercent"),
        // 판매사(T2) — 카드의 선택 금융사에 귀속(입력 모드 + 선택값 있을 때만 — 추출과 동일 게이트).
        dealerName: ui.dealerMode === "input" ? (fieldVal("dealer") || null) : null,
        vehicle: {
          brand: workbenchVehicle?.brand?.name ?? null,
          model: workbenchVehicle?.model?.name ?? trimDetail?.modelName ?? null,
          mcCode: workbenchVehicle?.trim?.mcCode ?? trimDetail?.mcCode ?? null,
        },
        pricing: {
          baseAndOption: (pricingNow?.basePrice ?? 0) + (pricingNow?.optionPrice ?? 0),
          discount: pricingNow?.discount ?? 0,
        },
      },
    };
  }

  // 랭킹 모달용 조립 인자 — 컴포넌트에 카드 DOM은 노출하지 않는다(base만, 채움은 pickRankingEntry가 담당).
  // 딜러는 항상 미전송(비제휴 고정 — T2): 랭킹은 전사 병렬 프로브인데 딜러는 단일 금융사 귀속 값이라,
  // 실으면 타사 견적이 무음 오염된다(BNK 미매칭 하드 폴백/메리츠 fee 0 — T1 useMultiQuote 스코프 가드와
  // 같은 근거). 금융사 미선택 카드는 딜러도 고를 수 없어 보통 자연 성립하지만, 구매방식 전환 등으로
  // 금융사만 리셋된 잔존 케이스까지 구조적으로 차단한다.
  function buildCardSolutionBaseArgs(condId: string): Omit<BuildArgs, "lenderLabel"> | null {
    const base = buildCardSolutionArgs(condId)?.base;
    return base ? { ...base, dealerName: null } : null;
  }

  // 조회 결과를 카드에 채우는 단일 경로 — 직접 계산(queryCardSolution)·랭킹 모달 행 선택(pickRankingEntry) 공유.
  // 월납입 = 표시 라운딩 값(개정 2 R4: 운용리스 100원 올림·렌트 raw — 모달 행과 카드 일치, 원값은 raw 스냅샷 보존).
  function applySolutionResult(args: {
    cardEl: HTMLElement;
    condId: string;
    lenderLabel: string;
    lenderCode: SolutionLenderCode;
    parsed: SolutionQuoteParsed;
    raw: unknown;
    monthlyDisplay: number;
  }) {
    const { cardEl, condId, lenderLabel, lenderCode, parsed, raw, monthlyDisplay } = args;
    // 워크벤치 전환/닫힘 후 늦은 응답/지연 선택 가드 — 카드 key(`${editingQuoteId ?? "new"}-${condId}`) 리마운트
    // 구조상 detach가 완전한 판별자. 없으면 stale 스냅샷 병합 + dirty 마킹이 다음 견적 저장 payload를 오염(#163 잔상 부류).
    if (!cardEl.isConnected) return;
    // 금융사 select 세팅(uncontrolled DOM) — 모달 선택 경로의 확정, 직접 계산 경로는 이미 그 값(멱등).
    const lenderSelect = cardEl.querySelector<HTMLSelectElement>('select[data-sc-field="lender"]');
    if (lenderSelect) {
      // 프로그램적 쓰기는 델리게이션 이벤트가 없다 — 금융사가 실제로 바뀐 경로(랭킹 모달 선택)만 여기서
      // 딜러 리셋 + 목록 재적재. 무조건 리셋하면 직접 계산(동일 값 멱등)이 사용자가 고른 딜러를 지운다
      // (조회가 제 입력을 파괴 — 그 딜러가 방금 계산 입력이었는데도).
      const lenderChanged = lenderSelect.value !== lenderLabel;
      lenderSelect.value = lenderLabel;
      if (lenderChanged) {
        resetCardDealer(cardEl, condId);
        void loadCardDealers(condId, lenderLabel);
      }
    }
    const setField = (f: string, v: string) => {
      const el = cardEl.querySelector<HTMLInputElement>(`input[data-sc-field="${f}"]`);
      if (el) el.value = v;
    };
    setField("monthly", formatMoney(monthlyDisplay));
    // "최대" 모드 표시값 "-"(placeholder) → 실채택 잔가로 갱신(표시 전용 — extract는 max 모드 residualValue를 null 유지.
    // 인수 총비용·금리 파생의 잔가 입력이기도 하다 — residualAmountOf가 이 값을 읽는다).
    if (cardUiOf(cardUiRef.current, condId).residualMode === "max") setField("residual", formatMoney(parsed.residualAmount));
    // 결과 4필드(반납/인수/출고 전/금리)는 제프 응답으로 채우지 않는다(개정 1 R3) — 아래
    // handleManualCardFieldEdit → deriveAndFillCardResults가 리스계산기 산식으로 파생해 채운다.
    // 제프 금리·확장 필드는 solutionRaw 스냅샷에만 보존.
    setSolutionSnapshots((prev) => ({
      ...prev,
      [condId]: {
        solutionLenderCode: lenderCode,
        solutionWorkbookVersion: parsed.workbookVersion,
        solutionCalculatedAt: new Date().toISOString(),
        solutionRaw: raw,
      },
    }));
    if (parsed.warnings.length > 0) onToast(parsed.warnings.join(" · "));
    handleManualCardFieldEdit();
  }

  // 비교카드 1장의 조건으로 파트너 계산(POST /api/solution/calculate) 직접 호출(금융사 선택된 카드).
  // in-flight는 카드 단위가 아니라 전역 1건 — 파트너 서버 보호(자동 재계산 없음, 명시 버튼 조회만).
  async function queryCardSolution(condId: string) {
    if (solutionLoadingId) return;
    const assembled = buildCardSolutionArgs(condId);
    if (!assembled) return;
    const { cardEl, base } = assembled;
    const lenderLabel = cardEl.querySelector<HTMLSelectElement>('select[data-sc-field="lender"]')?.value ?? "";
    const built = buildSolutionQuoteInput({ ...base, lenderLabel: lenderLabel || null });
    if (!built.ok) {
      onToast(built.reason); // fail-loud 매핑 사유(미지원 금융사·MC코드 부재·% 상한 등)를 그대로 표면화
      return;
    }
    setSolutionLoadingId(condId);
    try {
      const raw = await requestSolutionQuote(built.input);
      const parsed = parseSolutionQuoteResult(raw);
      if (!parsed) {
        if (cardEl.isConnected) onToast("계산 응답을 해석하지 못했습니다"); // detach 후 늦은 응답은 침묵(가드 관례)
        return;
      }
      applySolutionResult({
        cardEl,
        condId,
        lenderLabel,
        lenderCode: built.input.lenderCode,
        parsed,
        raw,
        monthlyDisplay: solutionMonthlyDisplay(built.input.productType, parsed.monthlyPayment),
      });
    } catch (e) {
      // 서버 릴레이가 파트너 error 문구를 {error}로 매핑 → HttpError.message(한글)를 그대로 표면화.
      onToast(e instanceof Error ? e.message : "계산에 실패했습니다");
    } finally {
      setSolutionLoadingId(null);
    }
  }

  // 계산기 버튼 3분기(개정 1 R1·개정 2 R4): ①금융사 미선택 → 일괄 조회 랭킹 모달 ②파트너 지원사 → 즉시 계산
  // ③미지원사(레거시 저장값·CRM_EXTRA_LENDERS 등) → 계산 없이 경고(수기 몫 안내). 지원 판정은
  // select 옵션이 아니라 이 클릭 시점(R2 — 어휘가 파트너 상위집합이라 옵션 존재 ≠ 계산 가능).
  function handleSolutionQueryClick(condId: string) {
    const cardEl = quoteDetailFormRef.current?.querySelector<HTMLElement>(`[data-scenario-card="${condId}"]`);
    const lender = cardEl?.querySelector<HTMLSelectElement>('select[data-sc-field="lender"]')?.value ?? "";
    if (!lender || lender === "미선택") {
      // 모달 오픈 전 사전 검증(금융사 외 공통 조건 — 차량/MC코드/가격/기간/약정거리): 전 금융사가 같은 사유로
      // 실패할 모달 대신 기존 fail-loud 토스트. 프로브 금융사 = 지원 목록 1번(목록에서 뽑아 금융사 게이트는 항상 통과).
      const options = solutionLenderOptions(solutionWorkbenchPurchaseMethod);
      const assembled = buildCardSolutionArgs(condId);
      if (!assembled || options.length === 0) return; // 미지원 구매방식은 버튼 disabled라 실도달 없음(방어)
      const probe = buildSolutionQuoteInput({ ...assembled.base, lenderLabel: options[0].label });
      if (!probe.ok) {
        onToast(probe.reason);
        return;
      }
      setSolutionLenderPickerId(condId);
      return;
    }
    if (solutionLenderOptions(solutionWorkbenchPurchaseMethod).some((l) => l.label === lender)) {
      void queryCardSolution(condId);
      return;
    }
    onToast(`「${lender}」은(는) 솔루션 미취급 금융사입니다 — 수기로 작성해 주세요`);
  }

  // 랭킹 모달 행 선택(개정 2 R4-3): 그 금융사 결과(entry.raw)로 카드 채움 + 스냅샷 → 모달 닫기.
  // 재호출 없음 — 모달 배치가 이미 받아둔 응답을 그대로 영속(모달 행 표시값과 카드 채움 값 일치).
  function pickRankingEntry(condId: string, entry: SolutionRankingEntry) {
    setSolutionLenderPickerId(null);
    const cardEl = quoteDetailFormRef.current?.querySelector<HTMLElement>(`[data-scenario-card="${condId}"]`);
    if (!cardEl) return;
    const parsed = parseSolutionQuoteResult(entry.raw); // entry가 이 raw로 조립됐으므로 항상 해석 가능(방어 겸)
    if (!parsed) return;
    applySolutionResult({
      cardEl,
      condId,
      lenderLabel: entry.label,
      lenderCode: entry.lenderCode,
      parsed,
      raw: entry.raw,
      monthlyDisplay: entry.monthlyDisplay,
    });
  }

  // 비교카드 → 시나리오 추출. INSERT/UPDATE 공유. termMonths 포함(PR2c-2).
  // 화면에 보이는 모든 카드(manualQuoteCards) 중 "채워진 카드"만 추출한다 — "조건 저장" 클릭 여부와 무관.
  // 채워짐 = 저장된 카드(savedIds) OR 금융사 선택(미선택 아님) OR 월 납입금 입력(>0).
  // 빈 비교 슬롯(manual-condition-2/3 기본값: 미선택·0)은 제외 → 불필요한 빈 시나리오/"비교 N" 오표시·데이터 손실 방지.
  // 순서는 manualQuoteCards 순(round1 우선)이라 [0]=대표(round1) 보장. 빈 배열 가능 → 호출부에서 scenarios 키를 누락(서버 delete→insert 미발동).
  function extractWorkbenchScenarios(): ScenarioInput[] {
    // 결과 필드 0/빈값은 null(가짜 0 영속 방지 — 계획서 설계 결정 10).
    const nz = (raw: string | null) => (raw != null && Number(raw) > 0 ? raw : null);
    const compareForm = quoteDetailFormRef.current;
    const scenarios: ScenarioInput[] = [];
    for (const card of manualQuoteCards) {
      const condId = card.id;
      const cardEl = compareForm?.querySelector<HTMLElement>(`[data-scenario-card="${condId}"]`);
      const fieldVal = (f: string) => cardEl?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-sc-field="${f}"]`)?.value ?? null;
      const lenderRaw = fieldVal("lender");
      const lender = lenderRaw && lenderRaw !== "미선택" ? lenderRaw : null;
      const monthlyPayment = parseMonthlyPayment(fieldVal("monthly") ?? "");
      const isFilled = savedManualQuoteConditionIds.includes(condId) || lender !== null || (monthlyPayment !== null && Number(monthlyPayment) > 0);
      if (!isFilled) continue; // 빈 슬롯 제외(저장도 채워짐도 아님)
      const ui = cardUiOf(cardUi, condId);
      scenarios.push({
        scenarioNo: Number(card.round ?? 1),
        isSaved: true,
        purchaseMethod: solutionWorkbenchPurchaseMethod,
        termMonths: ui.termMonths,
        lender,
        monthlyPayment,
        depositMode: ui.depositMode,
        depositValue: ui.depositMode === "none" ? null : parseMonthlyPayment(fieldVal("deposit") ?? ""),
        downPaymentMode: ui.downPaymentMode,
        downPaymentValue: ui.downPaymentMode === "none" ? null : parseMonthlyPayment(fieldVal("downPayment") ?? ""),
        residualMode: ui.residualMode,
        residualValue: ui.residualMode === "max" ? null : parseMonthlyPayment(fieldVal("residual") ?? ""),
        mileageMode: ui.mileageMode,
        mileageValue: effectiveMileageValue(ui),
        carTaxIncluded: ui.carTaxIncluded,
        subsidyApplicable: ui.subsidyApplicable,
        subsidyAmount: ui.subsidyApplicable ? nz(parseMonthlyPayment(fieldVal("subsidy") ?? "")) : null,
        totalReturnCost: nz(parseMonthlyPayment(fieldVal("totalReturn") ?? "")),
        totalTakeoverCost: nz(parseMonthlyPayment(fieldVal("totalTakeover") ?? "")),
        dueAtDelivery: nz(parseMonthlyPayment(fieldVal("dueAtDelivery") ?? "")),
        interestRate: parseInterestRate(fieldVal("interestRate") ?? ""),
        // CM/AG %(계산기 패리티) — parseInterestRate 재사용(소수 보존·0/100 초과 null. 0% = 미입력과 동등).
        cmFeePercent: parseInterestRate(fieldVal("cmFeePercent") ?? ""),
        agFeePercent: parseInterestRate(fieldVal("agFeePercent") ?? ""),
        // 판매사(T2) — plain dealer_name 저장(금융사는 lender 컬럼이 보유 — 계산기 합성값과 다른 근거).
        // 비제휴 모드·미선택(빈 문자열 저장 금지)·금융사 없음(딜러는 금융사 귀속 값 — 구매방식 전환으로
        // 금융사만 리셋된 잔존 포함)은 null.
        dealerName: ui.dealerMode === "input" && lender !== null ? (fieldVal("dealer") || null) : null,
        // 솔루션 조회 스냅샷 동봉(조회한 카드만 키 존재) — 서버 시나리오 저장이 전체 교체(delete→insert)라
        // 미동봉 재저장은 저장된 스냅샷을 null로 덮는다. 수정 재진입 시드(openEditQuote)와 한 쌍.
        ...(solutionSnapshots[condId] ?? {}),
      });
    }
    return scenarios;
  }

  // 개정 1 R3: 결과 4필드(반납/인수/출고 전 납입/금리)는 읽기 전용 파생값 — 카드 조건(월납입·기간·보증금·
  // 선수금·잔가)과 가격패널(기타비용·취득원가)에서 재계산해 readOnly input에 쓴다. 파생 불능은 "0"
  // (저장은 기존 nz()/parseInterestRate가 null 처리). 프로그램 .value 쓰기는 React 이벤트를 발화하지
  // 않아 루프 없음. 항상 미리보기 재추출 직전에 호출된다(derive → extract 순서 — 추출·저장이 최신 파생값을 싣는다).
  function deriveAndFillCardResults() {
    const compareForm = quoteDetailFormRef.current;
    if (!compareForm) return;
    const pricingRoot = pricingPanelRef.current;
    const inputs = pricingRoot ? readPricingInputs(pricingRoot) : emptyQuotePricing;
    const derivedPricing = computePricing(inputs); // otherCost·acquisitionCost SSOT(quote-pricing)
    const basis = inputs.basePrice + inputs.optionPrice; // %→원 환산 기준 = 할인 전 차량가(솔루션 입력과 동일)
    for (const card of manualQuoteCards) {
      const cardEl = compareForm.querySelector<HTMLElement>(`[data-scenario-card="${card.id}"]`);
      if (!cardEl) continue;
      const fieldVal = (f: string) => cardEl.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-sc-field="${f}"]`)?.value ?? "";
      // CM/AG 원 환산 미리보기(계산기 basePriceForFeePreview 미러 — 기준 = 최종 차량가). 표시 전용
      // (data-fee-preview — data-sc-field 아님 = 추출·저장에 안 실림)이라 saved 카드에도 채운다(값 고정이니 멱등).
      // 100 초과(콤마 오입력)는 0 표시 — 아래 wonOfMode fail-loud 상한과 동일 방침.
      const feePreviewWon = (raw: string) => {
        const pct = parsePercentInput(raw);
        return pct > 100 ? 0 : Math.round(derivedPricing.finalVehiclePrice * pct / 100);
      };
      const setPreview = (key: string, v: number) => {
        const el = cardEl.querySelector<HTMLInputElement>(`input[data-fee-preview="${key}"]`);
        if (el) el.value = formatMoney(v);
      };
      setPreview("cm", feePreviewWon(fieldVal("cmFeePercent")));
      setPreview("ag", feePreviewWon(fieldVal("agFeePercent")));
      // 저장된(조건 미편집) 카드는 결과 4필드를 재파생하지 않는다(배치 5 2-A) — solution 도입 이전 수기 견적의
      // 저장값(표면금리 등)이 재진입만 해도 실질 IRR 파생값에 덮여 재발송 시 조용히 바뀌던 것을 차단.
      // 수정 클릭(editManualQuoteCondition)이 saved에서 빼면 그 카드만 다시 파생된다.
      if (savedManualQuoteConditionIds.includes(card.id)) continue;
      const ui = cardUiOf(cardUi, card.id);
      // 보증금/선수금 % 모드는 할인 전 차량가 기준 원 환산(discountLineWon 공유 산술). % 100 초과
      // (콤마 오입력 "45,5"→455)는 0 처리 — 빌더 wonOf·residualAmountOf의 fail-loud 상한 미러.
      // 파생 경로는 매 키스트로크 재계산이라 토스트 없이 오염(무음 부풀림·저장 영속)만 차단한다.
      const wonOfMode = (mode: ManualDepositMode, raw: string) => {
        if (mode === "none") return 0;
        if (mode === "percent") {
          const pct = parsePercentInput(raw); // 비유한 입력은 parsePercentInput이 이미 0
          return pct > 100 ? 0 : discountLineWon("percent", pct, basis);
        }
        return parseMoney(raw);
      };
      const derived = deriveCardResults({
        monthly: parseMoney(fieldVal("monthly")),
        termMonths: ui.termMonths,
        downPayment: wonOfMode(ui.downPaymentMode, fieldVal("downPayment")),
        deposit: wonOfMode(ui.depositMode, fieldVal("deposit")),
        residualAmount: residualAmountOf(ui.residualMode, fieldVal("residual"), basis),
        otherCost: derivedPricing.otherCost,
        acquisitionCost: derivedPricing.acquisitionCost,
      });
      const setField = (f: string, v: string) => {
        const el = cardEl.querySelector<HTMLInputElement>(`input[data-sc-field="${f}"]`);
        if (el) el.value = v;
      };
      setField("totalReturn", derived.totalReturn != null ? formatMoney(derived.totalReturn) : "0");
      setField("totalTakeover", derived.totalTakeover != null ? formatMoney(derived.totalTakeover) : "0");
      setField("dueAtDelivery", derived.dueAtDelivery != null ? formatMoney(derived.dueAtDelivery) : "0");
      setField("interestRate", derived.ratePct != null ? String(derived.ratePct) : "0"); // percent 칸 — 콤마 없는 원문 숫자
    }
  }

  // 대표 시나리오(앱 미리보기 카드 model.scenario) 재계산 — DOM querySelector라 render 중이 아닌 핸들러/effect에서만 호출.
  function refreshCardScenarioPreview() {
    deriveAndFillCardResults(); // 파생 → 추출 순서(개정 1 R3) — 추출이 항상 최신 파생 4필드를 읽는다
    setCardScenario(extractWorkbenchScenarios()[0] ?? null);
  }

  // 카드 입력(금융사 select·월납입/보증금 등 input)이 바뀌면 미리보기 즉시 갱신 + draft dirty 표시.
  // 폼 컨테이너 onInput/onChange가 카드 텍스트/select 변경을 위임 캐치(QuoteWorkbench.tsx). 저장 여부와 무관하게 갱신.
  function handleManualCardFieldEdit(event?: SyntheticEvent<HTMLElement>) {
    // 금융사 select 변경(델리게이션 이벤트)은 딜러 리셋 + 목록 재적재를 동반한다(T2). 프로그램적 변경은
    // 이벤트가 없어 여기로 안 온다 — applySolutionResult(랭킹 선택)·copy(조건 복사)가 각자 처리.
    if (event) syncDealerOnLenderChange(event.target);
    refreshCardScenarioPreview();
    markQuoteDraftChanged();
  }

  // 저장/수정 클릭(savedIds)·모드/기간/주행/구매방식 등 state 변경 시 미리보기 동기화(state-driven 갱신).
  // DOM 텍스트/금융사 select 변경은 handleManualCardFieldEdit가 담당(uncontrolled라 state에 없음).
  useEffect(() => {
    deriveAndFillCardResults(); // state-driven 갱신(기간/모드/구매방식 등)도 파생 → 추출 순서 유지(개정 1 R3)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 비교카드 state 변경 시 대표 시나리오 재추출(의도된 동기화 effect)
    setCardScenario(extractWorkbenchScenarios()[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 아래 dep 변경 시점에만 재추출(extract가 읽는 DOM/내부 state는 그 시점 최신; 함수/객체 dep 추가 시 매 렌더 실행)
  }, [savedManualQuoteConditionIds, manualQuoteCards, cardUi, solutionWorkbenchPurchaseMethod, solutionSnapshots]);

  // ── 지원집합 게이트 거울(lenderByCard) 재동기화 ─────────────────────────────────
  // 금융사 값의 진실은 카드 DOM select(uncontrolled — spec D6)이고 거울은 그 파생이다.
  // 사용자 선택은 델리게이션(syncDealerOnLenderChange)이 즉시 갱신하지만, **이벤트 없이** DOM이
  // 바뀌는 경로가 여럿이라 커밋 후 다시 읽는다(전부 2026-07-22 배치 13 실측):
  //   ① 구매방식 전환 — option 목록에서 선택지가 빠지면 select.value가 change/input 발화 없이 "미선택"으로 되돌아간다
  //   ② 수정 진입/신규 오픈/초기화 — 카드 재시드. 리마운트가 없으면 DOM 값은 살아남고(React는 non-multiple
  //      select의 defaultValue 갱신을 무시한다) 거울만 지워져 반대 방향으로 어긋난다
  //   ③ 랭킹 모달 선택(applySolutionResult) — 프로그램 쓰기라 이벤트가 없다
  //   ④ 저장 카드 "수정"(잠금 해제) — 그 순간 게이트가 켜진다
  // dep을 열거하지 않는 것이 의도다 — "동기화 지점 N개를 사람이 기억"이 이 거울 결함군의 원인이었다
  // (구 스펙 §4.4의 4지점 목록 자체가 틀렸다: ①④ 누락 + clear 지시는 오히려 DOM과의 어긋남을 만들었다).
  // useLayoutEffect = paint 전 반영(게이트가 한 프레임 늦게 켜지는 깜빡임 제거).
  // 무한 갱신은 sameStringMap bail-out이 막는다(같은 값이면 setState가 리렌더를 안 낸다).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dep 없이 매 커밋 재동기화가 목적. [manualQuoteCards]를 주면 구매방식 전환(①)처럼 카드 배열이 그대로인 경로에서 다시 어긋난다
  useLayoutEffect(() => {
    const form = quoteDetailFormRef.current;
    const next: Record<string, string> = {};
    if (form) {
      for (const card of manualQuoteCards) {
        const value = form.querySelector<HTMLSelectElement>(`[data-scenario-card="${card.id}"] select[data-sc-field="lender"]`)?.value;
        if (value) next[card.id] = value;
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 거울은 커밋된 DOM(진실)의 파생 — 같으면 bail out
    setLenderByCard((prev) => (sameStringMap(prev, next) ? prev : next));
  });

  // 워크벤치 견적 영속. send=false: 작성완료(DB 저장, 발송X, 워크벤치 유지). send=true: 발송(저장+sent, 닫기).
  // 신규는 첫 INSERT 후 반환 id를 editingQuoteId로 세팅 → 이후 UPDATE(중복 INSERT 방지).
  function persistWorkbenchQuote({ send }: { send: boolean }) {
    const missing = validateQuoteDetailDraft();
    if (missing.length > 0) { onToast(missing.slice(0, 3).join(" ")); return; }
    // 차량 로딩/선택 가드: trimDetail은 fetchTrimDetail(async) 완료 후 채워진다.
    // 로딩 중(null)에 저장하면 brand/model/trim/trimId가 null로 UPDATE되어
    // 수정 시 기존 차량 정보를 덮어쓴다(데이터 손실). 로딩 완료까지 차단.
    if (!trimDetail || !workbenchVehicle) {
      onToast(editingQuoteId ? "차량 정보를 불러오는 중입니다. 잠시 후 다시 시도해 주세요." : "차량을 먼저 선택해 주세요.");
      return;
    }

    const source: QuoteItem["source"] = solutionWorkbenchEntryMode === "solution" ? "solution" : solutionWorkbenchEntryMode === "original" ? "original" : "manual";
    const sourceLabel = source === "solution" ? "솔루션 조회 조건" : source === "original" ? "원본 인식 후 보정" : "수기 입력 조건";
    const savedAt = formatKoreanShortTime();
    const root = pricingPanelRef.current;
    const inputs = root ? readPricingInputs(root) : null;
    const brandName = workbenchVehicle?.brand?.name ?? null;
    const modelName = workbenchVehicle?.model?.name ?? null;
    const trimName = trimDetail?.trimName ?? trimDetail?.name ?? null;
    const selectedOptions = trimDetail
      ? trimDetail.options.filter((o) => selectedWorkbenchOptionIds.includes(o.id)).map((o) => ({ id: o.id, name: o.name, price: o.price }))
      : [];
    const vehicleName = [brandName, dedupedModelTrim(modelName, trimName)].filter(Boolean).join(" ") || "차량 미선택";
    const num = (n: number | undefined | null) => (n == null ? null : String(n));

    // UPDATE patch / INSERT payload 공유 스냅샷 컬럼
    const snapshot = {
      brandName, modelName, trimName,
      trimId: trimDetail?.id ?? null,
      basePrice: inputs ? num(inputs.basePrice) : null,
      optionTotal: inputs ? num(inputs.optionPrice) : null,
      options: selectedOptions.length ? selectedOptions : null,
      finalDiscount: inputs ? num(inputs.discount) : null,
      discountLines: readDiscountLineSnapshots(root),
      acquisitionTax: inputs ? num(inputs.acquisitionTax) : null,
      acquisitionTaxMode,
      bond: inputs ? num(inputs.bond) : null,
      delivery: inputs ? num(inputs.delivery) : null,
      incidental: inputs ? num(inputs.incidental) : null,
      finalVehiclePrice: num(pricing.finalVehiclePrice),
      acquisitionCost: num(pricing.acquisitionCost),
      exteriorColorId: exteriorColor?.id ?? null,
      exteriorColorName: exteriorColor?.name ?? null,
      exteriorColorHex: exteriorColor?.hexValue ?? null,
      interiorColorId: interiorColor?.id ?? null,
      interiorColorName: interiorColor?.name ?? null,
      interiorColorHex: interiorColor?.hexValue ?? null,
      // 동적 입력칸(+)의 빈 줄/공백은 저장 직전 제거(빈 항목 영속 방지).
      guidance: sanitizeQuoteGuidance(guidance),
    };
    // 작성완료 시 화면의 채워진 카드 전체를 추출(savedIds 의존 제거). 빈 배열이면 scenarios 키를 누락 →
    // 서버 delete→insert(customer-quotes.ts: if(patch.scenarios) {delete; insert})가 발동하지 않아 기존 시나리오 보존(빈배열 wipe 방지).
    const scenarios = extractWorkbenchScenarios();
    const scenarioField = scenarios.length ? { scenarios } : {};
    const optimisticVehicle = {
      source,
      brand: brandName ?? undefined,
      model: modelName ?? undefined,
      trim: trimName ?? undefined,
      vehicleName,
      finalVehiclePrice: pricing.finalVehiclePrice,
      exteriorColorName: exteriorColor?.name,
      exteriorColorHex: exteriorColor?.hexValue ?? undefined,
      interiorColorName: interiorColor?.name,
      interiorColorHex: interiorColor?.hexValue ?? undefined,
      trimId: trimDetail?.id ?? undefined,
      exteriorColorId: exteriorColor?.id ?? undefined,
      interiorColorId: interiorColor?.id ?? undefined,
    };
    // 견적함 카드 즉시 반영(화면-only): 추출 시나리오(ScenarioInput[]) → 화면 타입(CustomerDetailScenario[]) +
    // 대표 평탄화 4필드(financeType/term/monthlyPayment/lender, 카드 요약줄이 읽음) + primaryScenarioId(비교 아코디언 ★).
    // 빈 배열이면 빈 객체 → optimistic도 기존 q 유지(빈 카드 작성완료 화면 정합, DB empty-wipe 가드와 동일 분기).
    // 임시 scenario id(kim-scenario-…)는 서버 재페치 전까지만. setPrimaryScenario는 미매칭 id를 서버가 무시(no-op).
    const optimisticScenarioFields: Partial<Pick<QuoteItem, "scenarios" | "primaryScenarioId" | "financeType" | "term" | "monthlyPayment" | "lender">> = (() => {
      if (!scenarios.length) return {};
      const tempBase = nowMs();
      const displayScenarios: CustomerDetailScenario[] = scenarios.map((sc, i) => ({
        id: `kim-scenario-${tempBase}-${sc.scenarioNo ?? i}`,
        scenarioNo: sc.scenarioNo ?? null,
        purchaseMethod: sc.purchaseMethod ?? null,
        lender: sc.lender ?? null,
        termMonths: sc.termMonths ?? null,
        monthlyPayment: sc.monthlyPayment ?? null,
        depositMode: sc.depositMode ?? null,
        depositValue: sc.depositValue ?? null,
        downPaymentMode: sc.downPaymentMode ?? null,
        downPaymentValue: sc.downPaymentValue ?? null,
        residualMode: sc.residualMode ?? null,
        residualValue: sc.residualValue ?? null,
        mileageMode: sc.mileageMode ?? null,
        mileageValue: sc.mileageValue ?? null,
        isSaved: sc.isSaved ?? false,
        carTaxIncluded: sc.carTaxIncluded ?? null,
        subsidyApplicable: sc.subsidyApplicable ?? null,
        subsidyAmount: sc.subsidyAmount ?? null,
        totalReturnCost: sc.totalReturnCost ?? null,
        totalTakeoverCost: sc.totalTakeoverCost ?? null,
        dueAtDelivery: sc.dueAtDelivery ?? null,
        interestRate: sc.interestRate ?? null,
        cmFeePercent: sc.cmFeePercent ?? null,
        agFeePercent: sc.agFeePercent ?? null,
        dealerName: sc.dealerName ?? null,
        // 솔루션 조회 스냅샷(마이그 0031) — 낙관 표시에도 전달(서버 재페치 값과 동형 유지).
        solutionLenderCode: sc.solutionLenderCode ?? null,
        solutionWorkbookVersion: sc.solutionWorkbookVersion ?? null,
        solutionCalculatedAt: sc.solutionCalculatedAt ?? null,
        solutionRaw: sc.solutionRaw ?? null,
      }));
      // 대표 = scenario_no 최소(서버 insertScenarios 로직과 동일). 추출은 round1 우선이라 보통 [0].
      const primary = displayScenarios.reduce((m, s) => ((s.scenarioNo ?? 0) < (m.scenarioNo ?? 0) ? s : m), displayScenarios[0]);
      return { scenarios: displayScenarios, primaryScenarioId: primary.id, ...flattenPrimaryScenario(primary) };
    })();

    // 수정 진입(editingQuoteId) 또는 신규 첫 작성완료 후(persistedQuoteIdRef)면 UPDATE.
    const targetId = editingQuoteId ?? persistedQuoteIdRef.current;
    if (targetId) {
      const prevQuotes = quoteList.quotes;
      quoteList.setQuotes((current) => current.map((q) => (q.id === targetId ? {
        ...q,
        ...optimisticVehicle,
        ...optimisticScenarioFields,
        ...(send
          ? { status: "고객 확인 전", appStatus: "sent" as const, revision: (q.revision ?? 1) + 1, meta: `${savedAt} · 수정 후 재발송` }
          : { meta: `${savedAt} · 저장` }),
      } : q)));
      if (customer.id && !targetId.startsWith("kim-")) {
        const patch: QuoteWritePatch = {
          entryMode: source,
          ...snapshot,
          ...scenarioField,
          ...(send ? { status: "고객 확인 전", appStatus: "sent", bumpRevision: true } : {}),
        };
        void apiUpdateQuote(customer.id, targetId, patch).then(() => onQuotesPersisted?.()).catch(() => { quoteList.setQuotes(prevQuotes); onToast(send ? "발송에 실패했습니다." : "저장에 실패했습니다."); });
      }
    } else {
      const tempId = `kim-quote-workbench-${nowMs()}`;
      const tempQuoteCode = createQuoteCode(quoteList.quotes);
      quoteList.setQuotes((current) => [...current, {
        id: tempId,
        quoteCode: tempQuoteCode,
        title: vehicleName,
        meta: `${savedAt} · ${sourceLabel}`,
        status: "작성중",
        ...optimisticVehicle,
        appStatus: send ? "sent" : "draft",
        // 승격 작성이면 낙관 카드에도 출처를 실어 "앱 요청" 배지가 리로딩 없이 즉시 표시되게(서버 payload와 동일 값).
        sourceQuoteRequestId: sourceQuoteRequestId ?? undefined,
        quoteRound: "1차",
        financeType: solutionWorkbenchPurchaseMethod,
        term: "조건 미정",
        lender: "금융사 미정",
        stockStatus: "재고확인중",
        note: sourceLabel,
        decisionStatus: "none",
        ...(recognizedQuoteFile ? { fileName: recognizedQuoteFile.fileName, fileSize: recognizedQuoteFile.fileSize, mimeType: recognizedQuoteFile.mimeType, file: recognizedQuoteFile.file } : {}),
        ...optimisticScenarioFields, // 채워진 카드 있으면 대표 평탄화(financeType/term/lender) + scenarios 즉시 표시
      }]);
      if (customer.id) {
        const cid = customer.id; // .then 콜백에서 narrow 유지용
        const payload: QuoteCreatePayload = {
          entryMode: source,
          status: "작성중",
          quoteRound: "1차",
          stockStatus: "재고확인중",
          note: sourceLabel,
          sourceQuoteRequestId: sourceQuoteRequestId ?? null,
          ...snapshot,
          // 채워진 카드가 있으면 그 시나리오로 INSERT, 전혀 없으면 최소 대표(구매방식)만 — 절대 빈 배열을 보내지 않음.
          ...(scenarios.length ? { scenarios } : { scenario: { purchaseMethod: solutionWorkbenchPurchaseMethod } }),
        };
        void apiCreateQuote(cid, payload)
          .then(({ id, quoteCode }) => {
            quoteList.setQuotes((current) => current.map((q) => (q.id === tempId ? { ...q, id, quoteCode } : q)));
            persistedQuoteIdRef.current = id; // 이후 작성완료/발송은 같은 견적 UPDATE (editingQuoteId/key는 안 건드림)
            if (send && !id.startsWith("kim-")) {
              void apiUpdateQuote(cid, id, { status: "고객 확인 전", appStatus: "sent", bumpRevision: true }).catch(() => onToast("발송에 실패했습니다."));
            }
            // 인박스 캐시는 admin·manager 전용 API(#302) — staff는 403 무음(배치 12 K1-c, useQuoteList 미러).
            if (sourceQuoteRequestId) { void fetchAppQuoteRequestsCached(true).catch(() => {}); reloadAppRequests(); } // 견적요청→견적 INSERT 시 인박스 캐시 + 니즈 카드 배지 갱신
            onQuotesPersisted?.();
          })
          .catch(() => { quoteList.setQuotes((current) => current.filter((q) => q.id !== tempId)); onToast("저장에 실패했습니다."); });
      }
    }

    setIsQuoteDraftSaved(true);
    setIsQuoteDraftDirty(false);
    setRecognizedQuoteFile(null);
    markRecentUpdate("견적함");
    if (send) {
      setIsQuoteSolutionWorkbenchOpen(false);
      setSolutionWorkbenchModeMenu(null);
      setEditingQuoteId(null);
      setEditPrefill(null);
      persistedQuoteIdRef.current = null;
    }
    onToast(send ? "저장하고 고객 앱으로 발송했습니다." : "견적을 저장했습니다.");
  }

  function saveQuoteFromWorkbench() {
    persistWorkbenchQuote({ send: true });
  }

  function resetQuoteWorkbench() {
    setSolutionWorkbenchPurchaseMethod(primaryQuotePurchaseMethod(purchaseFields));
    setSolutionWorkbenchEntryMode("manual");
    setSolutionWorkbenchModeMenu(null);
    setRecognizedQuoteFile(null);
    setIsQuoteWorkbenchOriginalDragActive(false);
    setIsQuoteDraftSaved(false);
    setIsQuoteDraftDirty(false);
    setSavedManualQuoteConditionIds([]);
    setManualQuoteCards([...emptyQuoteConditionCards]);
    clearCardUiState();
    setGuidance(seedGuidance()); // 추가 안내(섹션4)도 워크벤치 입력값 — 초기화 의미론에 포함
    setIsQuoteAppCardPreviewOpen(false);
    resetWorkbenchPricing();
    onToast("워크벤치 입력값을 초기화했습니다.");
  }

  function recognizeQuoteOriginalForWorkbench(file: File) {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      onToast("견적 원본은 이미지 또는 PDF 파일만 인식할 수 있습니다.");
      return;
    }
    setRecognizedQuoteFile({
      file,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream"),
    });
    setSolutionWorkbenchEntryMode("original");
    setSolutionWorkbenchModeMenu(null);
    onToast("견적 원본을 인식해 워크벤치에 반영했습니다.");
  }

  function selectQuoteWorkbenchOriginalFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    recognizeQuoteOriginalForWorkbench(file);
    event.target.value = "";
  }

  function dropQuoteOriginalToWorkbench(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsQuoteWorkbenchOriginalDragActive(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    recognizeQuoteOriginalForWorkbench(file);
  }

  // 견적함 "+" (신규 작성) seam — 워크벤치 클린 시드(9b/9d/9e 상태). 9a QuoteList의 "+" 버튼이 호출.
  function openNewWorkbench() {
    quoteList.handlers.setConfirmingQuoteDeleteId(null);
    setEditingQuoteId(null);
    persistedQuoteIdRef.current = null;
    setEditPrefill(null);
    setSourceQuoteRequestId(null);
    resetWorkbenchVehicle();
    setGuidance(seedGuidance());
    setManualQuoteCards([...emptyQuoteConditionCards]);
    clearCardUiState();
    setSavedManualQuoteConditionIds([]);
    setRecognizedQuoteFile(null);
    setSolutionWorkbenchPurchaseMethod(primaryQuotePurchaseMethod(purchaseFields));
    setSolutionWorkbenchEntryMode("manual");
    setSolutionWorkbenchModeMenu(null);
    resetWorkbenchPricing();
    setIsQuoteSolutionWorkbenchOpen(true);
  }

  // 견적 "수정" seam — detail.quotes에서 시나리오/비교카드/맵 복원(9b/9d/9e 상태). 9a 액션 팝오버가 호출.
  function openEditQuote(quote: QuoteItem) {
    if (quote.decisionStatus === "contracting") {
      quoteList.handlers.setConfirmingQuoteSendId(null);
      quoteList.handlers.setConfirmingQuoteDeleteId(null);
      quoteList.handlers.setConfirmingQuoteContractId(null);
      quoteList.handlers.setConfirmingQuoteContractEditId((current) => (current === quote.id ? null : quote.id));
      return;
    }
    editEntryTrimIdRef.current = quote.trimId ?? undefined; // 진입 trimId 스냅샷 → openQuoteActionTrimId가 반환해 initialTrimId 안정화
    const dq = detail.quotes.find((q) => q.id === quote.id);
    const editScenarios: EditScenario[] = (dq?.scenarios ?? []).map((s) => ({
      scenarioNo: s.scenarioNo ?? 1,
      lender: s.lender ?? "미선택",
      monthlyPayment: s.monthlyPayment ?? "",
      termMonths: s.termMonths ?? 60,
      depositMode: (s.depositMode as ManualDepositMode) ?? "none",
      depositValue: s.depositValue ?? "0",
      downPaymentMode: (s.downPaymentMode as ManualDepositMode) ?? "none",
      downPaymentValue: s.downPaymentValue ?? "0",
      residualMode: (s.residualMode as ManualResidualMode) ?? "max",
      residualValue: s.residualValue ?? "-",
      mileageMode: (s.mileageMode as ManualMileageMode) ?? "basic",
      mileageValue: s.mileageValue ?? "20,000km / 년",
      carTaxIncluded: s.carTaxIncluded ?? false,
      subsidyApplicable: s.subsidyApplicable ?? false,
      subsidyAmount: s.subsidyAmount ?? "0",
      totalReturnCost: s.totalReturnCost ?? "",
      totalTakeoverCost: s.totalTakeoverCost ?? "",
      dueAtDelivery: s.dueAtDelivery ?? "",
      interestRate: s.interestRate ?? "",
      cmFeePercent: s.cmFeePercent ?? "0",
      agFeePercent: s.agFeePercent ?? "0",
      // 판매사(T2) — cm/ag `?? "0"`과 달리 `?? null`(빈 문자열 저장 금지 계약 — 값 없음 = null 왕복).
      dealerName: s.dealerName ?? null,
    }));
    // 할인 구성 내역 복원(discount_lines 영속화) — 기본 할인은 finalDiscount(총액) − 추가 행 환산 합으로 역산.
    // 행 state는 아래 setDiscountLines, 기본 할인 값은 applyTrimToPricing이 prefill.pricing.primaryDiscount로 쓴다.
    const restoredDiscount = restoreDiscountLines(
      dq?.discountLines,
      Number(dq?.basePrice ?? 0) + Number(dq?.optionTotal ?? 0),
      Number(dq?.finalDiscount ?? 0),
      nowMs(),
    );
    setEditPrefill(dq ? {
      optionIds: dq.options?.map((o) => o.id) ?? [],
      exteriorColorId: dq.exteriorColorId,
      interiorColorId: dq.interiorColorId,
      pricing: {
        base: Number(dq.basePrice ?? 0),
        option: Number(dq.optionTotal ?? 0),
        discount: Number(dq.finalDiscount ?? 0),
        primaryDiscount: restoredDiscount.primaryDiscount,
        acquisitionTax: Number(dq.acquisitionTax ?? 0),
        bond: Number(dq.bond ?? 0),
        delivery: Number(dq.delivery ?? 0),
        incidental: Number(dq.incidental ?? 0),
      },
      scenarios: editScenarios,
      guidance: normalizeQuoteGuidance(dq.guidance) ?? null,
    } : null);
    // 솔루션 스냅샷 시드 — 시나리오 저장이 전체 교체라, 재조회 없이 재저장해도 저장된 스냅샷이 보존되게
    // 저장본에서 카드 id 맵으로 복원(extractWorkbenchScenarios가 되실어 보낸다). 새 조회는 카드별로 덮어쓴다.
    // 카드 조립(max 잔가 표시값 복원)과 스냅샷 state가 같은 시드를 공유한다.
    const seededSnapshots = solutionSnapshotsFromScenarios(dq?.scenarios ?? []);
    // 비교카드 복원: 카드 데이터 + 저장됨 표시 + mode/기간 state
    setManualQuoteCards(editScenarios.length ? buildManualCardsFromScenarios(editScenarios, seededSnapshots) : [...emptyQuoteConditionCards]);
    setSavedManualQuoteConditionIds(editScenarios.map((s) => cardIdOfScenarioNo(s.scenarioNo)));
    setCardUi(cardUiMapFromScenarios(editScenarios));
    setSolutionSnapshots(seededSnapshots);
    // 딜러 목록은 여기서 못 채운다(차량이 아직 없음) — 브랜드 도착 effect가 카드 금융사 기준으로 재적재.
    // 그때까지 저장 딜러 표시는 ManualCard.dealerName의 "표시 유지" option이 담당(clearCardUiState 미경유 경로).
    setDealerOptionsByCard({});
    // 취득세 모드는 견적 저장본에서 복원(미복원 시 이전 세션 잔상이 persist payload에 실려 수정 저장을 오염).
    setAcquisitionTaxMode((dq?.acquisitionTaxMode as AcquisitionTaxMode) ?? "normal");
    setDiscountLines(restoredDiscount.lines); // 저장본 복원(없으면 빈 행 — 다른 견적 잔상도 함께 청소)
    setPrimaryDiscountUnit("amount");
    setEditingQuoteId(quote.id);
    persistedQuoteIdRef.current = null;
    setSourceQuoteRequestId(null);
    resetWorkbenchVehicle();
    resetWorkbenchPricing();
    // 고객 지역은 저장본을 따르지 않고 항상 거주지에서 재파생 — 입력 UI를 없애 거주지가 단일 소스(발송 시 payload에 이 값이 박제).
    setGuidance({ ...(normalizeQuoteGuidance(dq?.guidance) ?? DEFAULT_QUOTE_GUIDANCE), customerRegion: regionFromResidence(detail.residence) });
    setSolutionWorkbenchPurchaseMethod(normalizeQuotePurchaseMethod(quote.financeType));
    setSolutionWorkbenchEntryMode(quote.source === "solution" ? "solution" : quote.source === "original" ? "original" : "manual");
    setSolutionWorkbenchModeMenu(null);
    setSolutionLenderPickerId(null); // clearCardUiState 미경유 경로 — 유령 모달 방어(#163 부류)
    setRecognizedQuoteFile(null);
    setIsQuoteSolutionWorkbenchOpen(true);
    quoteList.handlers.setOpenQuoteActionId(null);
    quoteList.handlers.setQuoteActionFrame(null);
    quoteList.handlers.setConfirmingQuoteSendId(null);
    quoteList.handlers.setConfirmingQuoteDeleteId(null);
    quoteList.handlers.setConfirmingQuoteContractId(null);
  }

  // 부모 detailOverlayOpen OR용(배경 스크롤 잠금) — 워크벤치 열림.
  const overlayOpen = isQuoteSolutionWorkbenchOpen;
  // 부모 onEditorOpenChange OR용 — 워크벤치 열림 또는 수정 진입.
  const editorOpen = isQuoteSolutionWorkbenchOpen || editingQuoteId !== null;

  return {
    // seam(부모가 QuoteList/NeedsDashboard에 중계)
    openNewWorkbench,
    openEditQuote,
    openWorkbenchForQuoteRequest,
    // overlay 플래그(부모 OR용)
    overlayOpen,
    editorOpen,
    // 컴포넌트 JSX가 직접 읽는 state
    isQuoteSolutionWorkbenchOpen,
    solutionWorkbenchPurchaseMethod,
    solutionWorkbenchEntryMode,
    solutionWorkbenchModeMenu,
    isQuoteAppCardPreviewOpen,
    isQuoteDraftSaved,
    isQuoteDraftDirty,
    savedManualQuoteConditionIds,
    manualQuoteCards,
    cardUi,
    dealerOptionsByCard,
    lenderByCard,
    supportMatrix,
    solutionLoadingId,
    solutionLenderPickerId,
    editingQuoteId,
    guidance,
    quoteRequestPrefill,
    recognizedQuoteFile,
    isQuoteWorkbenchOriginalDragActive,
    pricing,
    primaryDiscountUnit,
    discountLines,
    acquisitionTaxMode,
    trimDetail,
    exteriorColor,
    interiorColor,
    selectedWorkbenchOptionIds,
    // derived
    solutionWorkbenchCanQuery,
    quoteDraftReady,
    workbenchVehicleLabel,
    appCardModel,
    workbenchFirstTermMonths,
    quotesLength: quoteList.quotes.length,
    // refs
    pricingPanelRef,
    quoteDetailFormRef,
    quoteWorkbenchOriginalInputRef,
    handlers: {
      // 인라인 setter(JSX가 직접 사용)
      setIsQuoteSolutionWorkbenchOpen,
      setSolutionWorkbenchPurchaseMethod,
      setSolutionWorkbenchEntryMode,
      setSolutionWorkbenchModeMenu,
      setIsQuoteAppCardPreviewOpen,
      setIsQuoteWorkbenchOriginalDragActive,
      setExteriorColor,
      setInteriorColor,
      setAcquisitionTaxMode,
      setGuidance,
      // 가격 패널 핸들러
      handleJeffMoneyInputFocus,
      handleJeffMoneyInputMouseDown,
      handleJeffMoneyInputBeforeInput,
      handleJeffMoneyInputBlur,
      handleJeffMoneyInputChange,
      handleJeffMoneyInputPaste,
      handleJeffMoneyInputKeyDown,
      handleJeffMoneyInputMouseUp,
      handlePricingPanelInput,
      markQuoteDraftChanged,
      handleManualCardFieldEdit,
      // 차량/옵션/할인
      applyTrimToPricing,
      applyOptionTotal,
      openQuoteActionTrimId,
      addDiscountLine,
      removeDiscountLine,
      setPrimaryDiscountMode,
      setDiscountLineMode,
      setDiscountLineLabel,
      // 비교카드
      saveManualQuoteCondition,
      editManualQuoteCondition,
      copyManualQuoteCondition,
      setManualDepositMode,
      setManualDownPaymentMode,
      setManualResidualMode,
      setManualMileageMode,
      setManualMileageValue,
      setManualTermMonthsFor,
      setManualCarTaxFor,
      setManualSubsidyFor,
      setManualDealerMode,
      queryCardSolution,
      handleSolutionQueryClick,
      buildCardSolutionBaseArgs,
      pickRankingEntry,
      setSolutionLenderPickerId,
      // 저장/발송/초기화
      saveQuoteDetailDraft,
      saveQuoteFromWorkbench,
      guardQuoteDraftOutput,
      resetQuoteWorkbench,
      // 원본 인식
      selectQuoteWorkbenchOriginalFile,
      dropQuoteOriginalToWorkbench,
    },
  };
}
