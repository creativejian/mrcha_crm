import { type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type FocusEvent as ReactFocusEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type SyntheticEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { type Customer } from "@/data/customers";
import { type CustomerDetailData } from "@/lib/customers";
import { dedupedModelTrim, flattenPrimaryScenario, type CustomerDetailScenario, type QuoteDiscountLine, type QuoteItem } from "@/lib/quote-items";
import { DEFAULT_QUOTE_GUIDANCE, normalizeQuoteGuidance, sanitizeQuoteGuidance, type QuoteGuidance, regionFromResidence } from "@/data/quote-guidance";
import { updateQuote as apiUpdateQuote, createQuote as apiCreateQuote, parseMonthlyPayment, parseInterestRate, type QuoteWritePatch, type QuoteCreatePayload, type ScenarioInput } from "@/lib/customer-quotes";
import { fetchQuoteRequestDetail, fetchAppQuoteRequestsCached } from "@/lib/quote-requests";
import { seedScenarioCardFromRequest } from "@/lib/quote-request-seed";
import { type VehicleSelection } from "@/components/VehiclePicker";
import { buildAppCardModel, type AppCardModel } from "@/lib/app-card";
import { computePricing, formatMoney, parseMoney, type PricingInputs, type PricingResult } from "@/lib/quote-pricing";
import { fetchTrimDetail, type TrimColor, type TrimDetail } from "@/lib/vehicles";
import { nowMs, formatKoreanShortTime } from "@/lib/detail-utils";

import { purchaseFieldScaffold } from "../purchase-meta";
import {
  createQuoteCode,
  emptyQuoteConditionCards,
  emptyQuotePricing,
  initialQuotePricingResult,
  quotePurchaseMethodOptions,
  normalizeQuotePurchaseMethod,
  primaryQuotePurchaseMethod,
  restoreDiscountLines,
  type AcquisitionTaxMode,
  type DiscountLine,
  type DiscountUnit,
  type EditPrefill,
  type EditScenario,
  type ManualCard,
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
  const [manualTermMonths, setManualTermMonths] = useState<Record<string, number>>({});
  const [manualQuoteCards, setManualQuoteCards] = useState<ManualCard[]>(() => [...emptyQuoteConditionCards]);
  const [manualDepositModes, setManualDepositModes] = useState<Record<string, ManualDepositMode>>({});
  const [manualDownPaymentModes, setManualDownPaymentModes] = useState<Record<string, ManualDepositMode>>({});
  const [manualResidualModes, setManualResidualModes] = useState<Record<string, ManualResidualMode>>({});
  const [manualMileageModes, setManualMileageModes] = useState<Record<string, ManualMileageMode>>({});
  const [manualMileageValues, setManualMileageValues] = useState<Record<string, string>>({});
  const [manualCarTaxIncluded, setManualCarTaxIncluded] = useState<Record<string, boolean>>({});
  const [manualSubsidyApplicable, setManualSubsidyApplicable] = useState<Record<string, boolean>>({});
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  // 신규 작성완료 후 "이후 UPDATE 대상 id". editingQuoteId(=비교카드 key·prefill)를 안 건드려야 카드 리마운트(입력 리셋)를 막는다.
  const persistedQuoteIdRef = useRef<string | null>(null);
  const [guidance, setGuidance] = useState<QuoteGuidance>(DEFAULT_QUOTE_GUIDANCE);
  // 신규 워크벤치 guidance 시드 — 고객 지역은 거주지에서 파생(미입력이면 "확인 필요", 임의 지역 확정 표기 방지).
  const seedGuidance = () => ({ ...DEFAULT_QUOTE_GUIDANCE, customerRegion: regionFromResidence(detail.residence) });
  const [editPrefill, setEditPrefill] = useState<EditPrefill | null>(null);
  // 앱 견적요청 승격(S3) prefill. editPrefill(수정·가격 포함)과 별개 — 차량/옵션만 채우고 가격은 catalog 계산.
  const [quoteRequestPrefill, setQuoteRequestPrefill] = useState<{ trimId: number | null; optionIds: number[] } | null>(null);
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
  const quoteWorkbenchOriginalInputRef = useRef<HTMLInputElement>(null);
  const quoteDetailFormRef = useRef<HTMLDivElement>(null);
  // 수정 진입 시점의 trimId를 고정. 작성완료(send:false)의 optimistic setQuotes가 quote.trimId를 새 차량으로 덮으면
  // openQuoteActionTrimId→VehiclePicker initialTrimId가 흔들려 effect 재발화→applyTrimToPricing 2회 실행(editPrefill 소비됨)
  // →exteriorColor/interiorColor/options 리셋되던 기존 버그 방지(리로딩 전 화면 보존).
  const editEntryTrimIdRef = useRef<number | undefined>(undefined);

  // 앱 견적요청 → 워크벤치 prefill 오픈(차량/구매방식/옵션). 가격은 catalog 계산 보존.
  // 인박스 진입(URL ?quoteRequest=) + 니즈 카드 "견적 작성" 양쪽이 호출. hoisted 함수(useCallback 미사용 — 기존 패턴).
  function openWorkbenchForQuoteRequest(reqId: string): Promise<void> {
    return fetchQuoteRequestDetail(reqId).then((detail) => {
      // 신규 워크벤치 열기와 동일한 리셋(견적함 + 버튼 onClick과 정렬)
      quoteList.handlers.setConfirmingQuoteDeleteId(null);
      setEditingQuoteId(null);
      persistedQuoteIdRef.current = null;
      setEditPrefill(null);
      resetWorkbenchVehicle();
      setGuidance(seedGuidance());
      // 앱 견적요청 조건(기간·보증금/선수금 유형·비율/금액) → 카드1 시드(도메인 규칙: quote-request-seed.ts).
      const seed = seedScenarioCardFromRequest(detail);
      setManualQuoteCards([
        {
          ...emptyQuoteConditionCards[0],
          depositMode: seed.depositMode ?? "none",
          depositValue: seed.depositValue ?? "0",
          downPaymentMode: seed.downPaymentMode ?? "none",
          downPaymentValue: seed.downPaymentValue ?? "0",
        },
        emptyQuoteConditionCards[1],
        emptyQuoteConditionCards[2],
      ]);
      clearCardUiState(); // 이전 세션 잔상(잔존가치/약정거리 모드·할인 행·취득세 등) 청소 후 시드만 얹는다
      if (seed.termMonths != null) setManualTermMonths({ "manual-condition-1": seed.termMonths });
      if (seed.depositMode) setManualDepositModes({ "manual-condition-1": seed.depositMode });
      if (seed.downPaymentMode) setManualDownPaymentModes({ "manual-condition-1": seed.downPaymentMode });
      setSavedManualQuoteConditionIds([]);
      setRecognizedQuoteFile(null);
      setSolutionWorkbenchEntryMode("manual");
      setSolutionWorkbenchModeMenu(null);
      setSolutionWorkbenchPurchaseMethod(primaryQuotePurchaseMethod(purchaseFields)); // 고객 기본값 먼저(+onClick과 동일)
      // 견적요청 prefill 설정
      setQuoteRequestPrefill({ trimId: detail.trimId, optionIds: detail.optionIds });
      setSourceQuoteRequestId(reqId);
      // purchaseMethod(한글)가 워크벤치 옵션 목록에 있으면 override, 없으면 위 고객 기본값 유지(stale 방지).
      if (detail.purchaseMethod && quotePurchaseMethodOptions.includes(detail.purchaseMethod as QuotePurchaseMethod)) {
        setSolutionWorkbenchPurchaseMethod(detail.purchaseMethod as QuotePurchaseMethod);
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
  const workbenchFirstTermMonths = manualQuoteCards[0] ? (manualTermMonths[manualQuoteCards[0].id] ?? 60) : 60;

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

  function parsePercent(value: string) {
    const normalized = value.replace(/[^\d.]/g, "");
    const [head = "", ...rest] = normalized.split(".");
    const n = Number(rest.length ? `${head}.${rest.join("")}` : head);
    return Number.isFinite(n) ? n : 0;
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
  function buildManualCardsFromScenarios(scenarios: EditScenario[]): ManualCard[] {
    return emptyQuoteConditionCards.map((base) => {
      const sc = scenarios.find((s) => String(s.scenarioNo) === base.round);
      if (!sc) return base;
      return {
        ...base,
        lender: sc.lender || "미선택",
        monthlyPayment: sc.monthlyPayment ? formatMoney(Number(sc.monthlyPayment)) : "0",
        depositMode: sc.depositMode,
        depositValue: sc.depositMode === "percent" ? sc.depositValue : (sc.depositValue ? formatMoney(Number(sc.depositValue)) : "0"),
        downPaymentMode: sc.downPaymentMode,
        downPaymentValue: sc.downPaymentMode === "percent" ? sc.downPaymentValue : (sc.downPaymentValue ? formatMoney(Number(sc.downPaymentValue)) : "0"),
        residualMode: sc.residualMode,
        residualValue: sc.residualMode === "max" ? "-" : (sc.residualMode === "percent" ? sc.residualValue : (sc.residualValue ? formatMoney(Number(sc.residualValue)) : "0")),
        subsidyAmount: sc.subsidyAmount && Number(sc.subsidyAmount) > 0 ? formatMoney(Number(sc.subsidyAmount)) : "0",
        totalReturn: sc.totalReturnCost ? formatMoney(Number(sc.totalReturnCost)) : "0",
        totalTakeover: sc.totalTakeoverCost ? formatMoney(Number(sc.totalTakeoverCost)) : "0",
        dueAtDelivery: sc.dueAtDelivery ? formatMoney(Number(sc.dueAtDelivery)) : "0",
        interestRate: sc.interestRate || "0",
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
  }

  // 추가 할인 행 영속 스냅샷(crm.quotes.discount_lines) — 금액의 진실 원본은 uncontrolled DOM input
  // (state amount는 초기 표시값이라 입력 후 stale). root 없으면 state 표시값 폴백. 빈 배열은 null
  // (스키마 기본값과 정렬 — 추가 행 없는 견적은 행 자체가 없다는 의미로 저장).
  function readDiscountLineSnapshots(root: HTMLElement | null): QuoteDiscountLine[] | null {
    const rows = discountLines.map((line) => {
      const raw = root?.querySelector<HTMLInputElement>(`input[data-discount-id="${line.id}"]`)?.value ?? line.amount;
      return { label: line.label, amount: line.unit === "percent" ? parsePercent(raw) : parseMoney(raw), unit: line.unit };
    });
    return rows.length ? rows : null;
  }

  function syncDiscountTotalFromRows(root: HTMLElement) {
    const discountInputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[data-discount-line="true"]'));
    if (!discountInputs.length) return;
    const basePrice = parseMoney(root.querySelector<HTMLInputElement>('input[data-pricing="base"]')?.value ?? "");
    const optionPrice = parseMoney(root.querySelector<HTMLInputElement>('input[data-pricing="option"]')?.value ?? "");
    const discountBasis = basePrice + optionPrice;
    const total = discountInputs.reduce((sum, input) => {
      const value = input.dataset.discountUnit === "percent" ? parsePercent(input.value) : parseMoney(input.value);
      return sum + (input.dataset.discountUnit === "percent" ? Math.round(discountBasis * value / 100) : value);
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
    const value = from === "percent" ? parsePercent(input.value) : parseMoney(input.value);
    if (!value || !basis) {
      input.value = "0";
      return;
    }
    input.value = to === "percent" ? formatPercent(value / basis * 100) : formatMoney(Math.round(basis * value / 100));
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

  // 워크벤치 열기/승격/초기화 시 카드 UI 상태 잔상 제거 — 모드 Record·할인 행·취득세 모드는
  // extractWorkbenchScenarios/persist가 읽어 화면 잔상이 아니라 저장까지 오염되므로 가격과 함께 반드시 청소한다.
  // (수정 진입은 시나리오에서 전량 재구성하므로 Record는 복원 setter가 대체 — discountLines/취득세만 별도 처리.)
  function clearCardUiState() {
    setManualTermMonths({});
    setManualDepositModes({});
    setManualDownPaymentModes({});
    setManualResidualModes({});
    setManualMileageModes({});
    setManualMileageValues({});
    setManualCarTaxIncluded({});
    setManualSubsidyApplicable({});
    setDiscountLines([]);
    setAcquisitionTaxMode("normal");
    setPrimaryDiscountUnit("amount");
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
      setExteriorColor(prefill ? detail.colors.find((c) => c.id === prefill.exteriorColorId) ?? null : null);
      setInteriorColor(prefill ? detail.colors.find((c) => c.id === prefill.interiorColorId) ?? null : null);
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

  function setManualDepositMode(conditionId: string, mode: ManualDepositMode) {
    setManualDepositModes((prev) => ({ ...prev, [conditionId]: mode }));
    markQuoteDraftChanged();
  }

  function setManualDownPaymentMode(conditionId: string, mode: ManualDepositMode) {
    setManualDownPaymentModes((prev) => ({ ...prev, [conditionId]: mode }));
    markQuoteDraftChanged();
  }

  function setManualResidualMode(conditionId: string, mode: ManualResidualMode) {
    setManualResidualModes((prev) => ({ ...prev, [conditionId]: mode }));
    markQuoteDraftChanged();
  }

  function setManualMileageMode(conditionId: string, mode: ManualMileageMode) {
    setManualMileageModes((prev) => ({ ...prev, [conditionId]: mode }));
    if (mode === "basic") setManualMileageValues((prev) => ({ ...prev, [conditionId]: "20,000km / 년" }));
    markQuoteDraftChanged();
  }

  function setManualMileageValue(conditionId: string, value: string) {
    setManualMileageValues((prev) => ({ ...prev, [conditionId]: value }));
    markQuoteDraftChanged();
  }

  function setManualTermMonthsFor(conditionId: string, months: number) {
    setManualTermMonths((current) => ({ ...current, [conditionId]: months }));
    markQuoteDraftChanged();
  }

  function setManualCarTaxFor(conditionId: string, included: boolean) {
    setManualCarTaxIncluded((current) => ({ ...current, [conditionId]: included }));
    markQuoteDraftChanged();
  }

  function setManualSubsidyFor(conditionId: string, applicable: boolean) {
    setManualSubsidyApplicable((current) => ({ ...current, [conditionId]: applicable }));
    markQuoteDraftChanged();
  }

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
  }, [isQuoteSolutionWorkbenchOpen, solutionWorkbenchModeMenu]);

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
      const depositMode = manualDepositModes[condId] ?? card.depositMode ?? null;
      const downPaymentMode = manualDownPaymentModes[condId] ?? card.downPaymentMode ?? null;
      const residualMode = manualResidualModes[condId] ?? card.residualMode ?? null;
      const mileageMode = manualMileageModes[condId] ?? "basic";
      const mileageValue = mileageMode === "basic" ? "20,000km / 년" : (manualMileageValues[condId] ?? "20,000km / 년");
      scenarios.push({
        scenarioNo: Number(card.round ?? 1),
        isSaved: true,
        purchaseMethod: solutionWorkbenchPurchaseMethod,
        termMonths: manualTermMonths[condId] ?? 60,
        lender,
        monthlyPayment,
        depositMode,
        depositValue: depositMode === "none" ? null : parseMonthlyPayment(fieldVal("deposit") ?? ""),
        downPaymentMode,
        downPaymentValue: downPaymentMode === "none" ? null : parseMonthlyPayment(fieldVal("downPayment") ?? ""),
        residualMode,
        residualValue: residualMode === "max" ? null : parseMonthlyPayment(fieldVal("residual") ?? ""),
        mileageMode,
        mileageValue,
        carTaxIncluded: manualCarTaxIncluded[condId] ?? false,
        subsidyApplicable: manualSubsidyApplicable[condId] ?? false,
        subsidyAmount: (manualSubsidyApplicable[condId] ?? false) ? nz(parseMonthlyPayment(fieldVal("subsidy") ?? "")) : null,
        totalReturnCost: nz(parseMonthlyPayment(fieldVal("totalReturn") ?? "")),
        totalTakeoverCost: nz(parseMonthlyPayment(fieldVal("totalTakeover") ?? "")),
        dueAtDelivery: nz(parseMonthlyPayment(fieldVal("dueAtDelivery") ?? "")),
        interestRate: parseInterestRate(fieldVal("interestRate") ?? ""),
      });
    }
    return scenarios;
  }

  // 대표 시나리오(앱 미리보기 카드 model.scenario) 재계산 — DOM querySelector라 render 중이 아닌 핸들러/effect에서만 호출.
  function refreshCardScenarioPreview() {
    setCardScenario(extractWorkbenchScenarios()[0] ?? null);
  }

  // 카드 입력(금융사 select·월납입/보증금 등 input)이 바뀌면 미리보기 즉시 갱신 + draft dirty 표시.
  // 폼 컨테이너 onInput/onChange가 카드 텍스트/select 변경을 위임 캐치(QuoteWorkbench.tsx). 저장 여부와 무관하게 갱신.
  function handleManualCardFieldEdit() {
    refreshCardScenarioPreview();
    markQuoteDraftChanged();
  }

  // 저장/수정 클릭(savedIds)·모드/기간/주행/구매방식 등 state 변경 시 미리보기 동기화(state-driven 갱신).
  // DOM 텍스트/금융사 select 변경은 handleManualCardFieldEdit가 담당(uncontrolled라 state에 없음).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 비교카드 state 변경 시 대표 시나리오 재추출(의도된 동기화 effect)
    setCardScenario(extractWorkbenchScenarios()[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 아래 dep 변경 시점에만 재추출(extract가 읽는 DOM/내부 state는 그 시점 최신; 함수/객체 dep 추가 시 매 렌더 실행)
  }, [savedManualQuoteConditionIds, manualQuoteCards, manualTermMonths, manualDepositModes, manualDownPaymentModes, manualResidualModes, manualMileageModes, manualMileageValues, manualCarTaxIncluded, manualSubsidyApplicable, solutionWorkbenchPurchaseMethod]);

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
            if (sourceQuoteRequestId) { void fetchAppQuoteRequestsCached(true); reloadAppRequests(); } // 견적요청→견적 INSERT 시 인박스 캐시 + 니즈 카드 배지 갱신
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
    // 비교카드 복원: 카드 데이터 + 저장됨 표시 + mode/기간 state
    setManualQuoteCards(editScenarios.length ? buildManualCardsFromScenarios(editScenarios) : [...emptyQuoteConditionCards]);
    setSavedManualQuoteConditionIds(editScenarios.map((s) => `manual-condition-${s.scenarioNo}`));
    setManualDepositModes(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.depositMode])));
    setManualDownPaymentModes(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.downPaymentMode])));
    setManualResidualModes(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.residualMode])));
    setManualMileageModes(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.mileageMode])));
    setManualMileageValues(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.mileageValue])));
    setManualTermMonths(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.termMonths])));
    setManualCarTaxIncluded(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.carTaxIncluded])));
    setManualSubsidyApplicable(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.subsidyApplicable])));
    // 취득세 모드는 견적 저장본에서 복원(미복원 시 이전 세션 잔상이 persist payload에 실려 수정 저장을 오염).
    setAcquisitionTaxMode((dq?.acquisitionTaxMode as AcquisitionTaxMode) ?? "normal");
    setDiscountLines(restoredDiscount.lines); // 저장본 복원(없으면 빈 행 — 다른 견적 잔상도 함께 청소)
    setPrimaryDiscountUnit("amount");
    setEditingQuoteId(quote.id);
    persistedQuoteIdRef.current = null;
    setSourceQuoteRequestId(null);
    resetWorkbenchVehicle();
    resetWorkbenchPricing();
    setGuidance(normalizeQuoteGuidance(dq?.guidance) ?? DEFAULT_QUOTE_GUIDANCE);
    setSolutionWorkbenchPurchaseMethod(normalizeQuotePurchaseMethod(quote.financeType));
    setSolutionWorkbenchEntryMode(quote.source === "solution" ? "solution" : quote.source === "original" ? "original" : "manual");
    setSolutionWorkbenchModeMenu(null);
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
    manualTermMonths,
    manualQuoteCards,
    manualDepositModes,
    manualDownPaymentModes,
    manualResidualModes,
    manualMileageModes,
    manualMileageValues,
    manualCarTaxIncluded,
    manualSubsidyApplicable,
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
      setManualDepositMode,
      setManualDownPaymentMode,
      setManualResidualMode,
      setManualMileageMode,
      setManualMileageValue,
      setManualTermMonthsFor,
      setManualCarTaxFor,
      setManualSubsidyFor,
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
