import { Calculator, Check, ChevronDown, ChevronRight, FilePlus2, FileText, FileUp, RotateCcw, Smartphone, Trash2, X } from "lucide-react";

import { type Customer } from "@/data/customers";
import { formatMoney } from "@/lib/quote-pricing";
import { CRM_EXTRA_LENDERS, SOLUTION_LEASE_TERMS, solutionLenderOptions } from "@/lib/solution-quote";
import { type SolutionDealer } from "@/lib/solution-dealers";
import { bindSelect } from "@/lib/select-bind";
import { isDocumentFileDrag } from "@/lib/detail-utils";
import { QUOTE_GUIDANCE_OPTIONS } from "@/data/quote-guidance";
import { AppCardPreview } from "@/components/AppCardPreview";
import { CondCombo, CondRow, DiscountLineRow, FeeCombo, FormRow, MoneyField, PriceCell, SegmentGroup, SummaryRow, ValueSelect } from "@/components/quote-fields/QuoteFields";
import { SolutionLenderRankingModal } from "./SolutionLenderRankingModal";
import { WorkbenchColorPicker, WorkbenchOptionPicker, WorkbenchVehiclePicker } from "./WorkbenchVehiclePickers";

import {
  ACQUISITION_TAX_MODE_LABELS,
  cardUiOf,
  DEALER_MODE_SEGMENT_OPTIONS,
  dealerSelectPlaceholder,
  effectiveMileageValue,
  manualMileageOptions,
  emptyQuotePricing,
  quotePurchaseMethodOptions,
} from "./quote-workbench-meta";
import { type useQuoteWorkbench } from "./hooks/useQuoteWorkbench";

// 세그먼트 어휘 — 기간은 SOLUTION_LEASE_TERMS 파생·취득세는 라벨 SSOT zip(계산기도 같은 소스에서
// 파생 — 값 타입만 화면 상태 계약을 따름: 워크벤치 number/normal ↔ 계산기 string/none).
const leaseTermSegmentOptions = SOLUTION_LEASE_TERMS.map((m) => ({ value: m, label: `${m}개월` }));
const acquisitionTaxModeOptions = (["normal", "hybrid", "electric", "manual"] as const).map((value, i) => ({ value, label: ACQUISITION_TAX_MODE_LABELS[i] }));

// 딜러 option 라벨 — % 병기(계산기 미러). ⚠ %의 의미는 금융사별로 다르다(BNK=기준 IRR / 우리=합산
// 수수료율 / 메리츠=딜러 fee 율 — solution-dealers.ts 원문). 워크벤치 목록은 카드의 선택 금융사
// 단일 스코프라 계산기 union과 달리 lender 접두는 생략한다.
const dealerOptionLabel = (d: SolutionDealer) => `${d.dealerName} (${(d.baseIrrRate * 100).toFixed(2)}%)`;

type QuoteWorkbenchProps = {
  workbench: ReturnType<typeof useQuoteWorkbench>;
  customer: Customer;
  onToast: (message: string) => void;
};

// 견적 솔루션 워크벤치 모달(9b~9e). 닫힘이면 null. 가격패널 + 차량/옵션/컬러 + 비교카드 + 추가안내 + 앱카드는
// pricingPanelRef/quoteDetailFormRef querySelector 무결성을 위해 한 컴포넌트로 묶어 유지한다.
export function QuoteWorkbench({ workbench, customer, onToast }: QuoteWorkbenchProps) {
  const {
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
    solutionWorkbenchCanQuery,
    quoteDraftReady,
    workbenchVehicleLabel,
    appCardModel,
    workbenchFirstTermMonths,
    quotesLength,
    pricingPanelRef,
    quoteDetailFormRef,
    quoteWorkbenchOriginalInputRef,
  } = workbench;
  const {
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
    applyTrimToPricing,
    applyOptionTotal,
    openQuoteActionTrimId,
    addDiscountLine,
    removeDiscountLine,
    setDiscountLineLabel,
    setPrimaryDiscountMode,
    setDiscountLineMode,
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
    handleSolutionQueryClick,
    buildCardSolutionBaseArgs,
    pickRankingEntry,
    setSolutionLenderPickerId,
    saveQuoteDetailDraft,
    saveQuoteFromWorkbench,
    guardQuoteDraftOutput,
    resetQuoteWorkbench,
    selectQuoteWorkbenchOriginalFile,
    dropQuoteOriginalToWorkbench,
  } = workbench.handlers;

  // controlled select Safari 병행 바인딩 규칙(실측 배경 포함)은 lib/select-bind.ts 참조.
  const bindGuidanceSelect = (field: "deliveryComment" | "stockNotice" | "expectedDelivery") =>
    bindSelect(guidance[field], (v) => setGuidance((g) => ({ ...g, [field]: v })));

  // 금융사 어휘 = 파트너 목록(구매방식 종속 — 장기렌트는 취급 3사만) + CRM 수기 전용 확장(개정 1 R2 상위집합).
  // 파트너 지원 판정은 select가 아니라 계산기 클릭 시점(handleSolutionQueryClick 3분기)이 담당.
  const solutionLenders = solutionLenderOptions(solutionWorkbenchPurchaseMethod);
  const lenderOptionLabels = [...solutionLenders.map((l) => l.label), ...CRM_EXTRA_LENDERS];

  if (!isQuoteSolutionWorkbenchOpen) return null;

  return (
    <div className="kim-quote-modal-backdrop kim-quote-workbench-backdrop" onClick={() => setIsQuoteSolutionWorkbenchOpen(false)} role="presentation">
      <div
        className="kim-quote-modal kim-quote-solution-modal"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (solutionWorkbenchModeMenu && target.closest(`[data-workbench-mode="${solutionWorkbenchModeMenu}"]`)) return;
          setSolutionWorkbenchModeMenu(null);
        }}
        role="dialog"
        aria-modal="true"
        aria-label="솔루션 견적 워크벤치"
      >
        <div
          className={`kim-quote-modal-head kim-quote-workbench-head${solutionWorkbenchEntryMode === "original" ? " is-original-input" : ""}${isQuoteWorkbenchOriginalDragActive ? " is-original-drop-active" : ""}${recognizedQuoteFile ? " has-original-file" : ""}`}
          onDragEnter={(event) => {
            if (!isDocumentFileDrag(event)) return;
            event.preventDefault();
            setIsQuoteWorkbenchOriginalDragActive(true);
          }}
          onDragLeave={(event) => {
            const nextTarget = event.relatedTarget;
            if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
            setIsQuoteWorkbenchOriginalDragActive(false);
          }}
          onDragOver={(event) => {
            if (!isDocumentFileDrag(event)) return;
            event.preventDefault();
            setIsQuoteWorkbenchOriginalDragActive(true);
          }}
          onDrop={dropQuoteOriginalToWorkbench}
        >
          <input
            accept="image/*,application/pdf"
            aria-label="원본 견적서 첨부"
            className="kim-quote-workbench-original-input"
            onChange={selectQuoteWorkbenchOriginalFile}
            ref={quoteWorkbenchOriginalInputRef}
            type="file"
          />
          <div className="kim-quote-workbench-head-copy">
            <h2>
              <span>고객 관리</span>
              <ChevronRight size={18} strokeWidth={2.4} />
              <span>{customer.name}</span>
              <em className="num">{customer.customerId}</em>
              <ChevronRight size={18} strokeWidth={2.4} />
              <strong>{editingQuoteId ? "견적 수정" : "새 견적 작성"}</strong>
            </h2>
            <p><span>최근 견적 {quotesLength}개</span><i aria-hidden="true" /><mark>{workbenchVehicleLabel} · {solutionWorkbenchPurchaseMethod} {workbenchFirstTermMonths}개월</mark><span>{editingQuoteId ? "견적 수정 중" : "견적 작성"}</span></p>
          </div>
          <div className="kim-quote-workbench-head-tools" aria-label="견적 작성 모드">
            <div className="kim-quote-workbench-mode-select" data-workbench-mode="purchase">
              <span>구매방식</span>
              <div className="kim-quote-workbench-mode-control">
                <button
                  aria-expanded={solutionWorkbenchModeMenu === "purchase"}
                  aria-haspopup="menu"
                  onClick={() => setSolutionWorkbenchModeMenu((current) => (current === "purchase" ? null : "purchase"))}
                  type="button"
                >
                  {solutionWorkbenchPurchaseMethod}
                  <ChevronDown size={14} strokeWidth={2.3} />
                </button>
                {solutionWorkbenchModeMenu === "purchase" ? (
                  <div className="kim-quote-workbench-mode-menu" role="menu">
                    {quotePurchaseMethodOptions.filter((option) => option !== solutionWorkbenchPurchaseMethod).map((option) => (
                      <button
                        key={option}
                        onClick={() => {
                          setSolutionWorkbenchPurchaseMethod(option);
                          markQuoteDraftChanged();
                          if (option !== "운용리스" && option !== "장기렌트" && solutionWorkbenchEntryMode === "solution") {
                            setSolutionWorkbenchEntryMode("manual");
                          }
                          setSolutionWorkbenchModeMenu(null);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <span>{option}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="kim-quote-workbench-mode-select" data-workbench-mode="entry">
              <span>작성방식</span>
              <div className="kim-quote-workbench-mode-control">
                <button
                  aria-expanded={solutionWorkbenchModeMenu === "entry"}
                  aria-haspopup="menu"
                  onClick={() => setSolutionWorkbenchModeMenu((current) => (current === "entry" ? null : "entry"))}
                  type="button"
                >
                  {solutionWorkbenchEntryMode === "solution" ? "솔루션 조회" : solutionWorkbenchEntryMode === "original" ? "원본 인식" : "수기 작성"}
                  <ChevronDown size={14} strokeWidth={2.3} />
                </button>
                {solutionWorkbenchModeMenu === "entry" ? (
                  <div className="kim-quote-workbench-mode-menu narrow" role="menu">
                    {[
                      { key: "manual" as const, label: "수기 작성", disabled: false },
                      { key: "solution" as const, label: "솔루션 조회", disabled: !solutionWorkbenchCanQuery },
                      { key: "original" as const, label: "원본 인식", disabled: false },
                    ].filter((option) => option.key !== solutionWorkbenchEntryMode).map((option) => (
                      <button
                        disabled={option.disabled}
                        key={option.key}
                        onClick={() => {
                          if (option.disabled) return;
                          setSolutionWorkbenchEntryMode(option.key);
                          markQuoteDraftChanged();
                          if (option.key === "original") {
                            window.requestAnimationFrame(() => quoteWorkbenchOriginalInputRef.current?.click());
                          }
                          setSolutionWorkbenchModeMenu(null);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="kim-quote-workbench-actions" aria-label="견적 실행">
              <div className="kim-quote-workbench-action-group">
                <button
                  className="kim-quote-workbench-action ghost"
                  onClick={resetQuoteWorkbench}
                  type="button"
                >
                  <RotateCcw size={13} strokeWidth={2.2} />
                  초기화
                </button>
                <button
                  className={`kim-quote-workbench-action complete${isQuoteDraftSaved && !isQuoteDraftDirty ? " is-saved" : ""}${!trimDetail ? " is-disabled" : ""}`}
                  onClick={saveQuoteDetailDraft}
                  type="button"
                >
                  <Check size={13} strokeWidth={2.35} />
                  작성완료
                </button>
              </div>
              <div className="kim-quote-workbench-action-group output">
                <button
                  className="kim-quote-workbench-action muted"
                  onClick={() => onToast("솔루션 조회는 비교 카드의 계산기 버튼으로 실행합니다.")}
                  type="button"
                >
                  <Calculator size={13} strokeWidth={2.2} />
                  솔루션조회
                </button>
                <button
                  className={`kim-quote-workbench-action muted quote-doc${quoteDraftReady ? " is-ready-blue" : " is-disabled"}`}
                  onClick={() => {
                    if (!guardQuoteDraftOutput("견적서 보기")) return;
                    onToast("견적서 보기 화면은 다음 단계에서 연결합니다.");
                  }}
                  type="button"
                >
                  <FileText size={13} strokeWidth={2.2} />
                  견적서보기
                </button>
                <button
                  className={`kim-quote-workbench-action muted app-card${quoteDraftReady ? " is-ready-green" : " is-disabled"}`}
                  onClick={() => {
                    if (!guardQuoteDraftOutput("앱카드 보기")) return;
                    setIsQuoteAppCardPreviewOpen(true);
                  }}
                  type="button"
                >
                  <Smartphone size={13} strokeWidth={2.2} />
                  앱카드보기
                </button>
                <button
                  className={`kim-quote-workbench-action primary${!trimDetail ? " is-disabled" : ""}`}
                  onClick={saveQuoteFromWorkbench}
                  type="button"
                >
                  <FilePlus2 size={13} strokeWidth={2.2} />
                  {editingQuoteId ? "수정 후 발송" : "작성 후 발송"}
                </button>
              </div>
            </div>
          </div>
          <div className="kim-file-drop-overlay kim-quote-workbench-drop-overlay" aria-hidden="true">
            <FileUp size={22} strokeWidth={1.9} />
            <strong>원본 견적서 인식</strong>
            <span>첨부한 견적서의 값으로 자동 입력합니다</span>
          </div>
        </div>
        <div
          className="kim-quote-solution-shell kim-jeff-quote-body"
          onBeforeInput={handleJeffMoneyInputBeforeInput}
          onBlur={handleJeffMoneyInputBlur}
          onChange={handleJeffMoneyInputChange}
          onFocus={handleJeffMoneyInputFocus}
          onKeyDown={handleJeffMoneyInputKeyDown}
          onMouseDown={handleJeffMoneyInputMouseDown}
          onMouseUp={handleJeffMoneyInputMouseUp}
          onPaste={handleJeffMoneyInputPaste}
        >
          <section className="kim-jeff-top-panel" ref={pricingPanelRef} onInput={handlePricingPanelInput}>
            <div className="kim-jeff-top-grid">
              <div className="kim-jeff-section">
                <h4>🚘 차량 선택</h4>
                <WorkbenchVehiclePicker key={editingQuoteId ?? "new"} initialTrimId={editingQuoteId ? openQuoteActionTrimId() : (quoteRequestPrefill?.trimId ?? undefined)} onChange={(selection) => { void applyTrimToPricing(selection); }} />
              </div>
              <div className="kim-jeff-section">
                <h4>🎨 옵션 / 컬러</h4>
                {editingQuoteId && !trimDetail ? (
                  <div className="kim-jeff-skeleton-group" aria-hidden="true">
                    <div className="kim-jeff-skeleton-row" />
                    <div className="kim-jeff-skeleton-row" />
                    <div className="kim-jeff-skeleton-row" />
                  </div>
                ) : (
                  <>
                    <WorkbenchOptionPicker options={trimDetail?.options ?? []} relations={trimDetail?.optionRelations ?? []} selectedIds={selectedWorkbenchOptionIds} trimLabel={workbenchVehicleLabel} onChange={applyOptionTotal} />
                    <WorkbenchColorPicker colorType="exterior" colors={trimDetail?.colors ?? []} value={exteriorColor} onChange={(c) => { setExteriorColor(c); markQuoteDraftChanged(); }} />
                    <WorkbenchColorPicker colorType="interior" colors={trimDetail?.colors ?? []} value={interiorColor} onChange={(c) => { setInteriorColor(c); markQuoteDraftChanged(); }} />
                  </>
                )}
              </div>
              <div className="kim-jeff-section">
                <h4>💰 할인</h4>
                <DiscountLineRow
                  label="기본 할인"
                  unit={primaryDiscountUnit}
                  onUnitChange={setPrimaryDiscountMode}
                  inputProps={{ "data-discount-line": "true", "data-discount-primary": "true", "data-discount-unit": primaryDiscountUnit, defaultValue: formatMoney(emptyQuotePricing.discount) }}
                  action={{ kind: "add", onClick: addDiscountLine }}
                />
                {discountLines.map((line) => (
                  <DiscountLineRow
                    key={line.id}
                    label="추가 할인"
                    labelSelect={{ value: line.label, onSelect: (v) => setDiscountLineLabel(line.id, v) }}
                    unit={line.unit}
                    onUnitChange={(unit) => setDiscountLineMode(line.id, unit)}
                    inputProps={{ "data-discount-id": line.id, "data-discount-line": "true", "data-discount-unit": line.unit, defaultValue: line.amount }}
                    action={{ kind: "remove", onClick: () => removeDiscountLine(line.id) }}
                  />
                ))}
              </div>
            </div>

            <div className="kim-jeff-price-grid">
              <PriceCell label="기본 가격" inputProps={{ "data-pricing": "base", defaultValue: formatMoney(emptyQuotePricing.basePrice) }} />
              <PriceCell label="(+) 옵션 금액" inputProps={{ "data-pricing": "option", defaultValue: formatMoney(emptyQuotePricing.optionPrice) }} />
              <PriceCell label="(-) 최종 할인" inputProps={{ "data-pricing": "discount", defaultValue: formatMoney(emptyQuotePricing.discount) }} />
            </div>

            <div className="kim-jeff-cost-grid">
              <div className="kim-jeff-section kim-jeff-cost-section">
                <h4>⚙️ 취득원가 설정</h4>
                <FormRow label="취득세" className="kim-jeff-acquisition-tax-row">
                  <SegmentGroup value={acquisitionTaxMode} options={acquisitionTaxModeOptions} onSelect={setAcquisitionTaxMode} />
                  <MoneyField suffix="원" inputProps={{ "data-pricing": "acquisitionTax", defaultValue: formatMoney(emptyQuotePricing.acquisitionTax), readOnly: acquisitionTaxMode !== "manual" }} />
                </FormRow>
                {/* 공채/탁송료/부대비용 토글 = 현행 장식(무핸들러 고정 — spec D6, 실동작화는 별도 제품 결정). */}
                <FormRow label="공채" className="kim-jeff-cost-toggle-row">
                  <SegmentGroup value="included" options={[{ value: "included", label: "포함" }, { value: "excluded", label: "불포함" }]} />
                  <MoneyField suffix="원" inputProps={{ "data-pricing": "bond", defaultValue: formatMoney(emptyQuotePricing.bond) }} />
                </FormRow>
                <FormRow label="탁송료" className="kim-jeff-cost-toggle-row">
                  <SegmentGroup value="excluded" options={[{ value: "included", label: "포함" }, { value: "excluded", label: "불포함" }]} />
                  <MoneyField suffix="원" inputProps={{ "data-pricing": "delivery", defaultValue: formatMoney(emptyQuotePricing.delivery) }} />
                </FormRow>
                <FormRow label="부대비용" className="kim-jeff-cost-toggle-row">
                  <SegmentGroup value="excluded" options={[{ value: "included", label: "포함" }, { value: "excluded", label: "불포함" }]} />
                  <MoneyField suffix="원" inputProps={{ "data-pricing": "incidental", defaultValue: formatMoney(emptyQuotePricing.incidental) }} />
                </FormRow>
              </div>
              <div className="kim-jeff-section kim-jeff-summary-section">
                <h4>📋 최종 가격</h4>
                <SummaryRow label="최종 차량가(계산서 발행금액)" value={formatMoney(pricing.finalVehiclePrice)} />
                <SummaryRow label="등록비용(취득원가 포함)" value={formatMoney(pricing.registrationCost)} />
                <SummaryRow label="기타비용(취득원가 불포함, 고객 부담)" value={formatMoney(pricing.otherCost)} className="no-divider" />
                <SummaryRow label="취득원가" value={formatMoney(pricing.acquisitionCost)} className="emphasized" />
              </div>
            </div>
          </section>

          <section className="kim-app-quote-builder" aria-label="앱 견적카드 수기 작성">
            <div
              className="kim-app-quote-form"
              key="quote-detail-manual-v2"
              onChange={handleManualCardFieldEdit}
              onInput={handleManualCardFieldEdit}
              ref={quoteDetailFormRef}
            >
              <section className="kim-app-form-section kim-manual-compare-section">
                <div className="kim-manual-compare-grid">
                  {manualQuoteCards.map((condition) => {
                    const isConditionSaved = savedManualQuoteConditionIds.includes(condition.id);
                    const ui = cardUiOf(cardUi, condition.id);
                    const depositMode = ui.depositMode;
                    const downPaymentMode = ui.downPaymentMode;
                    const residualMode = ui.residualMode;
                    const mileageMode = ui.mileageMode;
                    const mileageValue = effectiveMileageValue(ui);
                    const carTaxOn = ui.carTaxIncluded;
                    const subsidyOn = ui.subsidyApplicable;
                    const dealerMode = ui.dealerMode;
                    const dealerList = dealerOptionsByCard[condition.id] ?? [];
                    // 저장/복사 재시드 값(condition.dealerName) — 목록 도착 전엔 이름만, 도착 후 % 병기로 승격.
                    const savedDealerInList = condition.dealerName ? dealerList.find((d) => d.dealerName === condition.dealerName) : undefined;

                    return (
                      <section className={`kim-manual-compare-card${isConditionSaved ? " is-saved" : ""}`} data-scenario-card={condition.id} key={`${editingQuoteId ?? "new"}-${condition.id}`}>
                        <header>
                          <strong>{condition.title} <span>{condition.round}</span></strong>
                          <div>
                            {/* solutionLoadingId 가드 = 조회 in-flight 중 조건 통째 교체 차단(계산기 버튼 disabled 미러 — 배치 7 C#2).
                                부분 개선 — in-flight 중 수동 편집 미가드는 스냅샷 무효화 정책(배치 7 C#1 기록)과 함께 별도 판단. */}
                            {condition.copyLabel ? <button className="copy" disabled={isConditionSaved || solutionLoadingId !== null} onClick={() => copyManualQuoteCondition(condition.id, condition.round)} type="button">{condition.copyLabel}</button> : null}
                            {isConditionSaved ? (
                              <button className="edit" onClick={() => editManualQuoteCondition(condition.id, condition.round)} type="button">수정</button>
                            ) : null}
                          </div>
                        </header>
                        <div className="kim-manual-compare-body">
                          <CondRow label="금융사" className="select-value"><select data-sc-field="lender" defaultValue={condition.lender} disabled={isConditionSaved}>
                            <option>미선택</option>
                            {solutionLenders.map((l) => <option key={l.code}>{l.label}</option>)}
                            {CRM_EXTRA_LENDERS.map((label) => <option key={label}>{label}</option>)}
                            {condition.lender && condition.lender !== "미선택" && !lenderOptionLabels.includes(condition.lender)
                              ? <option>{condition.lender}</option> /* 구 어휘 저장 견적 표시 유지(스펙 결정 1) — 새 선택지는 아님 */
                              : null}
                          </select></CondRow>
                          <CondRow label="기간"><SegmentGroup wide value={ui.termMonths} options={leaseTermSegmentOptions} disabled={isConditionSaved} onSelect={(m) => setManualTermMonthsFor(condition.id, m)} /></CondRow>
                          <CondRow label="보증금"><CondCombo><SegmentGroup value={depositMode} options={[{ value: "none", label: "없음" }, { value: "amount", label: "금액" }, { value: "percent", label: "%" }]} disabled={isConditionSaved} onSelect={(m) => setManualDepositMode(condition.id, m)} /><MoneyField fixed={depositMode === "none"} suffix={depositMode === "percent" ? "%" : "원"} inputProps={{ "data-sc-field": "deposit", "data-discount-unit": depositMode === "percent" ? "percent" : "amount", defaultValue: condition.depositValue, disabled: isConditionSaved, readOnly: depositMode === "none" }} /></CondCombo></CondRow>
                          {/* 선수금/선납금 라벨 SSOT = appCardModel.downPaymentRowLabel(구매방식 종속 도메인 규칙 — app-card.ts) */}
                          <CondRow label={appCardModel.downPaymentRowLabel}><CondCombo><SegmentGroup value={downPaymentMode} options={[{ value: "none", label: "없음" }, { value: "amount", label: "금액" }, { value: "percent", label: "%" }]} disabled={isConditionSaved} onSelect={(m) => setManualDownPaymentMode(condition.id, m)} /><MoneyField fixed={downPaymentMode === "none"} suffix={downPaymentMode === "percent" ? "%" : "원"} inputProps={{ "data-sc-field": "downPayment", "data-discount-unit": downPaymentMode === "percent" ? "percent" : "amount", defaultValue: condition.downPaymentValue, disabled: isConditionSaved, readOnly: downPaymentMode === "none" }} /></CondCombo></CondRow>
                          <CondRow label="잔존가치"><CondCombo><SegmentGroup value={residualMode} options={[{ value: "max", label: "최대" }, { value: "amount", label: "금액" }, { value: "percent", label: "%" }]} disabled={isConditionSaved} onSelect={(m) => setManualResidualMode(condition.id, m)} /><MoneyField fixed={residualMode === "max"} suffix={residualMode === "percent" ? "%" : "원"} inputProps={{ "data-sc-field": "residual", "data-discount-unit": residualMode === "percent" ? "percent" : "amount", defaultValue: condition.residualValue, disabled: isConditionSaved, readOnly: residualMode === "max" }} /></CondCombo></CondRow>
                          <CondRow label="약정거리"><CondCombo><SegmentGroup value={mileageMode} options={[{ value: "basic", label: "기본" }, { value: "custom", label: "변경" }]} disabled={isConditionSaved} onSelect={(m) => setManualMileageMode(condition.id, m)} /><ValueSelect fixed={mileageMode === "basic"} selectProps={{ disabled: isConditionSaved || mileageMode === "basic", ...bindSelect(mileageValue, (v) => setManualMileageValue(condition.id, v)) }}>{manualMileageOptions.map((option) => <option key={option}>{option}</option>)}</ValueSelect></CondCombo></CondRow>
                          <CondRow label="자동차세"><SegmentGroup value={carTaxOn ? "on" : "off"} options={[{ value: "off", label: "불포함" }, { value: "on", label: "포함" }]} disabled={isConditionSaved} onSelect={(v) => setManualCarTaxFor(condition.id, v === "on")} /></CondRow>
                          <CondRow label="보조금"><CondCombo><SegmentGroup value={subsidyOn ? "on" : "off"} options={[{ value: "off", label: "비해당" }, { value: "on", label: "해당" }]} disabled={isConditionSaved} onSelect={(v) => setManualSubsidyFor(condition.id, v === "on")} /><MoneyField fixed={!subsidyOn} suffix="원" inputProps={{ "aria-label": "보조금 금액", "data-sc-field": "subsidy", defaultValue: condition.subsidyAmount, disabled: isConditionSaved, readOnly: !subsidyOn }} /></CondCombo></CondRow>
                          {/* 판매사(T2 — 계산기 판매사 행 미러, 스코프는 카드의 선택 금융사 단일): 목록 = 훅 dealerOptionsByCard
                              (금융사 변경·브랜드 도착 시 재적재), 값 = uncontrolled select(data-sc-field 추출 계약 — 금융사 select 문법).
                              저장값(condition.dealerName)은 목록 fetch 도착 전에도 option으로 상시 렌더(구 어휘 금융사 "표시 유지" 미러)
                              + 리마운트 키(재진입/복사/리셋 재시드). 단일 금융사 목록이라 계산기와 달리 lender 접두·합성값 없음.
                              세그먼트 어휘·폭 = 표준 행과 통일(DEALER_MODE_SEGMENT_OPTIONS — 구 자연폭 변형 폐기, #265 그리드). */}
                          <CondRow label="판매사">
                            <CondCombo>
                              <SegmentGroup value={dealerMode} options={DEALER_MODE_SEGMENT_OPTIONS} disabled={isConditionSaved} onSelect={(m) => setManualDealerMode(condition.id, m)} />
                              <ValueSelect
                                key={`dealer-${condition.dealerName}`}
                                fixed={dealerMode === "nonAffiliated"}
                                selectProps={{
                                  "aria-label": "판매사",
                                  "data-sc-field": "dealer",
                                  defaultValue: condition.dealerName,
                                  // 금융사 미선택·브랜드 미선택·해당 사 딜러 0건 = 목록 없음(저장 표시값도 없으면) → 비활성.
                                  disabled: isConditionSaved || dealerMode === "nonAffiliated" || (dealerList.length === 0 && !condition.dealerName),
                                }}
                              >
                                {/* 빈 목록 placeholder = 이유 표면화(차량/금융사 먼저·등록 딜러 없음) — 죽은 select 오인 방지.
                                    lenderReady = 키 존재(금융사 스코프 로드 결과 — 훅 loadCardDealers 키 계약). 로드 in-flight
                                    순간엔 "금융사 먼저 선택"이 잠깐 보일 수 있음(sub-second·캐시 히트 즉시 — 상태 3분화는 과설계). */}
                                <option value="">{dealerSelectPlaceholder({ hasChoices: dealerList.length > 0 || condition.dealerName !== "", vehicleReady: trimDetail !== null, lenderReady: condition.id in dealerOptionsByCard })}</option>
                                {condition.dealerName
                                  ? <option value={condition.dealerName}>{savedDealerInList ? dealerOptionLabel(savedDealerInList) : condition.dealerName}</option>
                                  : null}
                                {dealerList.filter((d) => d.dealerName !== condition.dealerName).map((d) => (
                                  <option key={d.dealerName} value={d.dealerName}>{dealerOptionLabel(d)}</option>
                                ))}
                              </ValueSelect>
                            </CondCombo>
                          </CondRow>
                          {/* CM/AG 수수료(계산기 패리티 2026-07-16) — %는 파트너 계산 입력(cmFeeRate/agFeeRate 분율·저장 cm_fee_percent),
                              원 칸은 최종 차량가 기준 파생 미리보기(deriveAndFillCardResults가 채움 — 추출·저장에 안 실림). */}
                          <CondRow label="CM수수료"><FeeCombo><MoneyField suffix="%" inputProps={{ "aria-label": "CM수수료 퍼센트", "data-discount-unit": "percent", "data-sc-field": "cmFeePercent", defaultValue: condition.cmFeePercent, disabled: isConditionSaved }} /><MoneyField fixed suffix="원" inputProps={{ "aria-label": "CM수수료 환산 금액", "data-fee-preview": "cm", defaultValue: "0", disabled: isConditionSaved, readOnly: true }} /></FeeCombo></CondRow>
                          <CondRow label="AG수수료" className="before-emphasis"><FeeCombo><MoneyField suffix="%" inputProps={{ "aria-label": "AG수수료 퍼센트", "data-discount-unit": "percent", "data-sc-field": "agFeePercent", defaultValue: condition.agFeePercent, disabled: isConditionSaved }} /><MoneyField fixed suffix="원" inputProps={{ "aria-label": "AG수수료 환산 금액", "data-fee-preview": "ag", defaultValue: "0", disabled: isConditionSaved, readOnly: true }} /></FeeCombo></CondRow>
                          <div className="kim-manual-compare-row amount emphasis"><span>월 납입금</span><div className="kim-manual-monthly-control"><button aria-label="솔루션 조회" className="kim-manual-solution-query" disabled={isConditionSaved || !solutionWorkbenchCanQuery || solutionLoadingId !== null} onClick={() => handleSolutionQueryClick(condition.id)} title="솔루션 조회" type="button"><Calculator size={14} strokeWidth={2.15} /></button><div className="kim-jeff-money-input"><input aria-label="월 납입금" data-sc-field="monthly" defaultValue={condition.monthlyPayment} disabled={isConditionSaved} /><em>원</em></div></div></div>
                          {/* 결과 4필드 = 읽기 전용 파생값(개정 1 R3) — 월납입·카드 조건·가격패널에서 deriveAndFillCardResults가
                              자동 계산해 채운다(readOnly — jeff money 핸들러도 readOnly는 스킵). data-sc-field/defaultValue 추출 계약 불변
                              (저장본 프리필은 파생 재계산 전까지 표시). 금리 = 리스계산기 실질 금리(제프 표면금리 아님 — 스펙 개정 1). */}
                          <div className="kim-manual-result-grid">
                            <label><span>반납 총비용</span><div className="kim-jeff-money-input is-fixed"><input aria-label="반납 총비용" data-sc-field="totalReturn" defaultValue={condition.totalReturn} disabled={isConditionSaved} readOnly /><em>원</em></div></label>
                            <label><span>인수 총비용</span><div className="kim-jeff-money-input is-fixed"><input aria-label="인수 총비용" data-sc-field="totalTakeover" defaultValue={condition.totalTakeover} disabled={isConditionSaved} readOnly /><em>원</em></div></label>
                            <label><span>출고 전 납입</span><div className="kim-jeff-money-input is-fixed"><input aria-label="출고 전 납입" data-sc-field="dueAtDelivery" defaultValue={condition.dueAtDelivery} disabled={isConditionSaved} readOnly /><em>원</em></div></label>
                            <label><span>금리</span><div className="kim-jeff-money-input is-fixed"><input aria-label="금리" data-discount-unit="percent" data-sc-field="interestRate" defaultValue={condition.interestRate} disabled={isConditionSaved} readOnly /><em>%</em></div></label>
                          </div>
                          <button
                            className="kim-manual-condition-save"
                            disabled={isConditionSaved}
                            onClick={() => saveManualQuoteCondition(condition.id, condition.round)}
                            type="button"
                          >
                            {isConditionSaved ? (
                              <>
                                <Check size={14} strokeWidth={2.4} />
                                {condition.round}번 조건 저장됨
                              </>
                            ) : `${condition.round}번 조건 저장`}
                          </button>
                        </div>
                      </section>
                    );
                  })}
                </div>
              </section>

              <div className="kim-app-form-split kim-app-legacy-form-split">
                <div className="kim-app-form-section kim-app-delivery-section">
                  <header>
                    <strong>📋 추가 안내 사항</strong>
                  </header>
                  <div className="kim-app-form-section-body">
                    <div className="kim-app-guidance-grid">
                      <label>
                        <span>출고시기 코멘트</span>
                        <select {...bindGuidanceSelect("deliveryComment")}>
                          {QUOTE_GUIDANCE_OPTIONS.deliveryComment.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>재고여부</span>
                        <select {...bindGuidanceSelect("stockNotice")}>
                          {QUOTE_GUIDANCE_OPTIONS.stockNotice.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>예상 출고 기간</span>
                        <select {...bindGuidanceSelect("expectedDelivery")}>
                          {QUOTE_GUIDANCE_OPTIONS.expectedDelivery.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      </label>
                      <div className="wide guidance-list" role="group" aria-label="핵심포인트 목록">
                        <span>핵심포인트</span>
                        {guidance.keyPoints.map((point, i) => (
                          <div className="guidance-list-row" key={i}>
                            <input
                              list="guidance-keypoint-options"
                              placeholder="카드에 bullet로 노출됩니다"
                              value={point}
                              onChange={(e) => { const v = e.currentTarget.value; setGuidance((g) => { const k = [...g.keyPoints]; k[i] = v; return { ...g, keyPoints: k }; }); }}
                            />
                            <button aria-label={`핵심포인트 ${i + 1} 삭제`} onClick={() => setGuidance((g) => ({ ...g, keyPoints: g.keyPoints.filter((_, idx) => idx !== i) }))} type="button"><Trash2 size={13} strokeWidth={2.1} /></button>
                          </div>
                        ))}
                        <button className="guidance-list-add" onClick={() => setGuidance((g) => ({ ...g, keyPoints: [...g.keyPoints, ""] }))} type="button">+ 핵심포인트 추가</button>
                        <datalist id="guidance-keypoint-options">
                          {QUOTE_GUIDANCE_OPTIONS.keyPoint.map((o) => <option key={o} value={o} />)}
                        </datalist>
                      </div>
                      <div className="wide guidance-list" role="group" aria-label="서비스 목록">
                        <span>서비스 목록</span>
                        {guidance.services.map((service, i) => (
                          <div className="guidance-list-row" key={i}>
                            <input
                              placeholder="라벨: 내용 (예: 썬팅: 후퍼옵틱 KBR 전면)"
                              value={service}
                              onChange={(e) => { const v = e.currentTarget.value; setGuidance((g) => { const s = [...g.services]; s[i] = v; return { ...g, services: s }; }); }}
                            />
                            <button aria-label={`서비스 ${i + 1} 삭제`} onClick={() => setGuidance((g) => ({ ...g, services: g.services.filter((_, idx) => idx !== i) }))} type="button"><Trash2 size={13} strokeWidth={2.1} /></button>
                          </div>
                        ))}
                        <button className="guidance-list-add" onClick={() => setGuidance((g) => ({ ...g, services: [...g.services, ""] }))} type="button">+ 서비스 추가</button>
                      </div>
                      <label className="wide"><span>추천이유</span><textarea value={guidance.recommendReason} onChange={(e) => { const v = e.currentTarget.value; setGuidance((g) => ({ ...g, recommendReason: v })); }} rows={2} /></label>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <AppCardPreview model={appCardModel} />
          </section>
        </div>
        {isQuoteAppCardPreviewOpen ? (
          <div
            className="kim-app-card-preview-modal"
            onClick={() => setIsQuoteAppCardPreviewOpen(false)}
            role="presentation"
          >
            <div
              className="kim-app-card-preview-dialog"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-label="앱카드 미리보기"
              aria-modal="true"
            >
              <header>
                <div>
                  <span>고객 견적함 화면</span>
                  <strong>앱카드 미리보기</strong>
                </div>
                <button aria-label="앱카드 미리보기 닫기" onClick={() => setIsQuoteAppCardPreviewOpen(false)} type="button">
                  <X size={18} strokeWidth={2.2} />
                </button>
              </header>
              <AppCardPreview model={appCardModel} inModal />
            </div>
          </div>
        ) : null}
        {solutionLenderPickerId ? (
          /* 개정 2 R4: 금융사 미선택 상태에서 계산기 클릭 → 지원 금융사 일괄 조회 랭킹 모달(행 선택 = 카드 채움).
             오픈마다 새 마운트(조건부 렌더) — 병렬 배치가 마운트 1회 발화. 닫힘 경로(backdrop/X/취소/Esc 분기·
             잔상 리셋)는 개정 1 그대로. */
          <SolutionLenderRankingModal
            key={solutionLenderPickerId} /* 카드 전환 시 강제 리마운트 보험 — "오픈 = fresh mount" 계약을 구조로 보장 */
            condId={solutionLenderPickerId}
            purchaseMethod={solutionWorkbenchPurchaseMethod}
            buildBaseArgs={buildCardSolutionBaseArgs}
            onPick={pickRankingEntry}
            onClose={() => setSolutionLenderPickerId(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
