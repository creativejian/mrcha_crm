import { Calculator, Check, ChevronDown, ChevronRight, FilePlus2, FileText, FileUp, RotateCcw, Smartphone, Trash2, X } from "lucide-react";

import { type Customer } from "@/data/customers";
import { formatMoney } from "@/lib/quote-pricing";
import { isDocumentFileDrag } from "@/lib/detail-utils";
import { QUOTE_GUIDANCE_OPTIONS } from "@/data/quote-guidance";
import { ColorPicker } from "@/components/ColorPicker";
import { AppCardPreview } from "@/components/AppCardPreview";
import { OptionPicker } from "@/components/OptionPicker";
import { VehiclePicker } from "@/components/VehiclePicker";

import {
  discountLabelOptions,
  manualMileageOptions,
  emptyQuotePricing,
  quotePurchaseMethodOptions,
} from "./quote-workbench-meta";
import { type useQuoteWorkbench } from "./hooks/useQuoteWorkbench";

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
    setPrimaryDiscountMode,
    setDiscountLineMode,
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
    saveQuoteDetailDraft,
    saveQuoteFromWorkbench,
    guardQuoteDraftOutput,
    resetQuoteWorkbench,
    selectQuoteWorkbenchOriginalFile,
    dropQuoteOriginalToWorkbench,
  } = workbench.handlers;

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
                  onClick={() => onToast("financial-dolim-solution 연결 전 임시 워크벤치입니다.")}
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
                <VehiclePicker key={editingQuoteId ?? "new"} initialTrimId={editingQuoteId ? openQuoteActionTrimId() : (quoteRequestPrefill?.trimId ?? undefined)} onChange={(selection) => { void applyTrimToPricing(selection); }} />
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
                    <OptionPicker key={trimDetail?.id ?? "none"} options={trimDetail?.options ?? []} relations={trimDetail?.optionRelations ?? []} initialSelectedIds={selectedWorkbenchOptionIds} onChange={applyOptionTotal} />
                    <ColorPicker colorType="exterior" colors={trimDetail?.colors ?? []} value={exteriorColor} onChange={(c) => { setExteriorColor(c); markQuoteDraftChanged(); }} />
                    <ColorPicker colorType="interior" colors={trimDetail?.colors ?? []} value={interiorColor} onChange={(c) => { setInteriorColor(c); markQuoteDraftChanged(); }} />
                  </>
                )}
              </div>
              <div className="kim-jeff-section">
                <h4>💰 할인</h4>
                <div className="kim-jeff-form-row kim-jeff-discount-row">
                  <span>기본 할인</span>
                  <span className="kim-jeff-discount-label-placeholder" aria-hidden="true" />
                  <div className="kim-jeff-segment">
                    <button className={primaryDiscountUnit === "amount" ? "active" : ""} onClick={() => setPrimaryDiscountMode("amount")} type="button">금액</button>
                    <button className={primaryDiscountUnit === "percent" ? "active" : ""} onClick={() => setPrimaryDiscountMode("percent")} type="button">%</button>
                  </div>
                  <div className="kim-jeff-money-input"><input data-discount-line="true" data-discount-primary="true" data-discount-unit={primaryDiscountUnit} defaultValue={formatMoney(emptyQuotePricing.discount)} /><em>{primaryDiscountUnit === "percent" ? "%" : "원"}</em></div>
                  <button className="kim-jeff-discount-add" aria-label="할인 항목 추가" onClick={addDiscountLine} type="button">+</button>
                </div>
                {discountLines.map((line) => (
                  <div className="kim-jeff-form-row kim-jeff-discount-row" key={line.id}>
                    <span>추가 할인</span>
                    <select className="kim-jeff-discount-label" aria-label="할인 항목명" defaultValue={line.label}>
                      {discountLabelOptions.map((option) => <option key={option}>{option}</option>)}
                    </select>
                    <div className="kim-jeff-segment">
                      <button className={line.unit === "amount" ? "active" : ""} onClick={() => setDiscountLineMode(line.id, "amount")} type="button">금액</button>
                      <button className={line.unit === "percent" ? "active" : ""} onClick={() => setDiscountLineMode(line.id, "percent")} type="button">%</button>
                    </div>
                    <div className="kim-jeff-money-input"><input data-discount-id={line.id} data-discount-line="true" data-discount-unit={line.unit} defaultValue={line.amount} /><em>{line.unit === "percent" ? "%" : "원"}</em></div>
                    <button className="kim-jeff-discount-remove" aria-label="할인 항목 삭제" onClick={() => removeDiscountLine(line.id)} type="button"><Trash2 size={13} strokeWidth={2.1} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="kim-jeff-price-grid">
              <div className="kim-jeff-price-cell"><strong>기본 가격</strong><div className="kim-jeff-money-input"><input data-pricing="base" defaultValue={formatMoney(emptyQuotePricing.basePrice)} /><em>원</em></div></div>
              <div className="kim-jeff-price-cell"><strong>(+) 옵션 금액</strong><div className="kim-jeff-money-input"><input data-pricing="option" defaultValue={formatMoney(emptyQuotePricing.optionPrice)} /><em>원</em></div></div>
              <div className="kim-jeff-price-cell"><strong>(-) 최종 할인</strong><div className="kim-jeff-money-input"><input data-pricing="discount" defaultValue={formatMoney(emptyQuotePricing.discount)} /><em>원</em></div></div>
            </div>

            <div className="kim-jeff-cost-grid">
              <div className="kim-jeff-section kim-jeff-cost-section">
                <h4>⚙️ 취득원가 설정</h4>
                <div className="kim-jeff-form-row kim-jeff-acquisition-tax-row">
                  <span>취득세</span>
                  <div className="kim-jeff-segment">
                    <button className={acquisitionTaxMode === "normal" ? "active" : ""} onClick={() => setAcquisitionTaxMode("normal")} type="button">일반</button>
                    <button className={acquisitionTaxMode === "hybrid" ? "active" : ""} onClick={() => setAcquisitionTaxMode("hybrid")} type="button">하이브리드 감면</button>
                    <button className={acquisitionTaxMode === "electric" ? "active" : ""} onClick={() => setAcquisitionTaxMode("electric")} type="button">전기차 감면</button>
                    <button className={acquisitionTaxMode === "manual" ? "active" : ""} onClick={() => setAcquisitionTaxMode("manual")} type="button">직접 입력</button>
                  </div>
                  <div className="kim-jeff-money-input"><input data-pricing="acquisitionTax" defaultValue={formatMoney(emptyQuotePricing.acquisitionTax)} readOnly={acquisitionTaxMode !== "manual"} /><em>원</em></div>
                </div>
                <div className="kim-jeff-form-row kim-jeff-cost-toggle-row"><span>공채</span><div className="kim-jeff-segment"><button className="active" type="button">포함</button><button type="button">불포함</button></div><div className="kim-jeff-money-input"><input data-pricing="bond" defaultValue={formatMoney(emptyQuotePricing.bond)} /><em>원</em></div></div>
                <div className="kim-jeff-form-row kim-jeff-cost-toggle-row"><span>탁송료</span><div className="kim-jeff-segment"><button type="button">포함</button><button className="active" type="button">불포함</button></div><div className="kim-jeff-money-input"><input data-pricing="delivery" defaultValue={formatMoney(emptyQuotePricing.delivery)} /><em>원</em></div></div>
                <div className="kim-jeff-form-row kim-jeff-cost-toggle-row"><span>부대비용</span><div className="kim-jeff-segment"><button type="button">포함</button><button className="active" type="button">불포함</button></div><div className="kim-jeff-money-input"><input data-pricing="incidental" defaultValue={formatMoney(emptyQuotePricing.incidental)} /><em>원</em></div></div>
              </div>
              <div className="kim-jeff-section kim-jeff-summary-section">
                <h4>📋 최종 가격</h4>
                <div className="kim-jeff-summary-row"><span>최종 차량가(계산서 발행금액)</span><b><span>{formatMoney(pricing.finalVehiclePrice)}</span><em>원</em></b></div>
                <div className="kim-jeff-summary-row"><span>등록비용(취득원가 포함)</span><b><span>{formatMoney(pricing.registrationCost)}</span><em>원</em></b></div>
                <div className="kim-jeff-summary-row no-divider"><span>기타비용(취득원가 불포함, 고객 부담)</span><b><span>{formatMoney(pricing.otherCost)}</span><em>원</em></b></div>
                <div className="kim-jeff-summary-row emphasized"><span>취득원가</span><b><span>{formatMoney(pricing.acquisitionCost)}</span><em>원</em></b></div>
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
                    const depositMode = manualDepositModes[condition.id] ?? condition.depositMode;
                    const downPaymentMode = manualDownPaymentModes[condition.id] ?? condition.downPaymentMode;
                    const residualMode = manualResidualModes[condition.id] ?? condition.residualMode;
                    const mileageMode = manualMileageModes[condition.id] ?? "basic";
                    const mileageValue = mileageMode === "basic" ? "20,000km / 년" : manualMileageValues[condition.id] ?? "20,000km / 년";
                    const carTaxOn = manualCarTaxIncluded[condition.id] ?? false;
                    const subsidyOn = manualSubsidyApplicable[condition.id] ?? false;

                    return (
                      <section className={`kim-manual-compare-card${isConditionSaved ? " is-saved" : ""}`} data-scenario-card={condition.id} key={`${editingQuoteId ?? "new"}-${condition.id}`}>
                        <header>
                          <strong>{condition.title} <span>{condition.round}</span></strong>
                          <div>
                            {condition.copyLabel ? <button className="copy" type="button">{condition.copyLabel}</button> : null}
                            {isConditionSaved ? (
                              <button className="edit" onClick={() => editManualQuoteCondition(condition.id, condition.round)} type="button">수정</button>
                            ) : null}
                          </div>
                        </header>
                        <div className="kim-manual-compare-body">
                          <label className="select-value"><span>금융사</span><select data-sc-field="lender" defaultValue={condition.lender} disabled={isConditionSaved}><option>미선택</option><option>우리금융캐피탈</option><option>iM캐피탈</option><option>하나캐피탈</option></select></label>
                          <label><span>기간</span><div className="kim-jeff-segment wide">{[12, 24, 36, 48, 60].map((m) => { const cur = manualTermMonths[condition.id] ?? 60; return <button key={m} className={cur === m ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualTermMonthsFor(condition.id, m)} type="button">{m}개월</button>; })}</div></label>
                          <label><span>보증금</span><div className="kim-manual-combo"><div className="kim-jeff-segment"><button className={depositMode === "none" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualDepositMode(condition.id, "none")} type="button">없음</button><button className={depositMode === "amount" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualDepositMode(condition.id, "amount")} type="button">금액</button><button className={depositMode === "percent" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualDepositMode(condition.id, "percent")} type="button">%</button></div><div className={`kim-jeff-money-input${depositMode === "none" ? " is-fixed" : ""}`}><input data-sc-field="deposit" data-discount-unit={depositMode === "percent" ? "percent" : "amount"} defaultValue={condition.depositValue} disabled={isConditionSaved} readOnly={depositMode === "none"} /><em>{depositMode === "percent" ? "%" : "원"}</em></div></div></label>
                          <label><span>선수금</span><div className="kim-manual-combo"><div className="kim-jeff-segment"><button className={downPaymentMode === "none" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualDownPaymentMode(condition.id, "none")} type="button">없음</button><button className={downPaymentMode === "amount" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualDownPaymentMode(condition.id, "amount")} type="button">금액</button><button className={downPaymentMode === "percent" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualDownPaymentMode(condition.id, "percent")} type="button">%</button></div><div className={`kim-jeff-money-input${downPaymentMode === "none" ? " is-fixed" : ""}`}><input data-sc-field="downPayment" data-discount-unit={downPaymentMode === "percent" ? "percent" : "amount"} defaultValue={condition.downPaymentValue} disabled={isConditionSaved} readOnly={downPaymentMode === "none"} /><em>{downPaymentMode === "percent" ? "%" : "원"}</em></div></div></label>
                          <label><span>잔존가치</span><div className="kim-manual-combo"><div className="kim-jeff-segment"><button className={residualMode === "max" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualResidualMode(condition.id, "max")} type="button">최대</button><button className={residualMode === "amount" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualResidualMode(condition.id, "amount")} type="button">금액</button><button className={residualMode === "percent" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualResidualMode(condition.id, "percent")} type="button">%</button></div><div className={`kim-jeff-money-input${residualMode === "max" ? " is-fixed" : ""}`}><input data-sc-field="residual" data-discount-unit={residualMode === "percent" ? "percent" : "amount"} defaultValue={condition.residualValue} disabled={isConditionSaved} readOnly={residualMode === "max"} /><em>{residualMode === "percent" ? "%" : "원"}</em></div></div></label>
                          <label><span>약정거리</span><div className="kim-manual-combo"><div className="kim-jeff-segment"><button className={mileageMode === "basic" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualMileageMode(condition.id, "basic")} type="button">기본</button><button className={mileageMode === "custom" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualMileageMode(condition.id, "custom")} type="button">변경</button></div><select className={`kim-manual-value-select${mileageMode === "basic" ? " is-fixed" : ""}`} value={mileageValue} disabled={isConditionSaved || mileageMode === "basic"} onChange={(event) => setManualMileageValue(condition.id, event.currentTarget.value)}>{manualMileageOptions.map((option) => <option key={option}>{option}</option>)}</select></div></label>
                          <label><span>자동차세</span><div className="kim-jeff-segment"><button className={!carTaxOn ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualCarTaxFor(condition.id, false)} type="button">불포함</button><button className={carTaxOn ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualCarTaxFor(condition.id, true)} type="button">포함</button></div></label>
                          <label className="before-emphasis"><span>보조금</span><div className="kim-manual-combo"><div className="kim-jeff-segment"><button className={!subsidyOn ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualSubsidyFor(condition.id, false)} type="button">비해당</button><button className={subsidyOn ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualSubsidyFor(condition.id, true)} type="button">해당</button></div><div className={`kim-jeff-money-input${!subsidyOn ? " is-fixed" : ""}`}><input aria-label="보조금 금액" data-sc-field="subsidy" defaultValue={condition.subsidyAmount} disabled={isConditionSaved} readOnly={!subsidyOn} /><em>원</em></div></div></label>
                          <div className="kim-manual-compare-row amount emphasis"><span>월 납입금</span><div className="kim-manual-monthly-control"><button aria-label="솔루션 조회" className="kim-manual-solution-query" disabled={isConditionSaved || !solutionWorkbenchCanQuery} onClick={() => onToast("financial-dolim-solution 연결 전 임시 조회 버튼입니다.")} title="솔루션 조회" type="button"><Calculator size={14} strokeWidth={2.15} /></button><div className="kim-jeff-money-input"><input aria-label="월 납입금" data-sc-field="monthly" defaultValue={condition.monthlyPayment} disabled={isConditionSaved} /><em>원</em></div></div></div>
                          <div className="kim-manual-result-grid">
                            <label><span>반납 총비용</span><div className="kim-jeff-money-input"><input aria-label="반납 총비용" data-sc-field="totalReturn" defaultValue={condition.totalReturn} disabled={isConditionSaved} /><em>원</em></div></label>
                            <label><span>인수 총비용</span><div className="kim-jeff-money-input"><input aria-label="인수 총비용" data-sc-field="totalTakeover" defaultValue={condition.totalTakeover} disabled={isConditionSaved} /><em>원</em></div></label>
                            <label><span>출고 전 납입</span><div className="kim-jeff-money-input"><input aria-label="출고 전 납입" data-sc-field="dueAtDelivery" defaultValue={condition.dueAtDelivery} disabled={isConditionSaved} /><em>원</em></div></label>
                            <label><span>금리</span><div className="kim-jeff-money-input"><input aria-label="금리" data-discount-unit="percent" data-sc-field="interestRate" defaultValue={condition.interestRate} disabled={isConditionSaved} /><em>%</em></div></label>
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
                        <select value={guidance.deliveryComment} onChange={(e) => { const v = e.currentTarget.value; setGuidance((g) => ({ ...g, deliveryComment: v })); }}>
                          {QUOTE_GUIDANCE_OPTIONS.deliveryComment.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>재고여부</span>
                        <select value={guidance.stockNotice} onChange={(e) => { const v = e.currentTarget.value; setGuidance((g) => ({ ...g, stockNotice: v })); }}>
                          {QUOTE_GUIDANCE_OPTIONS.stockNotice.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>예상 출고 기간</span>
                        <select value={guidance.expectedDelivery} onChange={(e) => { const v = e.currentTarget.value; setGuidance((g) => ({ ...g, expectedDelivery: v })); }}>
                          {QUOTE_GUIDANCE_OPTIONS.expectedDelivery.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>고객 지역</span>
                        <select value={guidance.customerRegion} onChange={(e) => { const v = e.currentTarget.value; setGuidance((g) => ({ ...g, customerRegion: v })); }}>
                          {QUOTE_GUIDANCE_OPTIONS.customerRegion.map((o) => <option key={o}>{o}</option>)}
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
      </div>
    </div>
  );
}
