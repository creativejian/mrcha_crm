import { ListChecks } from "lucide-react";
import { type Dispatch, type RefObject, type SetStateAction } from "react";

import { formatKimNumberWithCommas, isKimPurchaseTagField, kimPurchaseTags, kimPurchaseValueClass } from "@/lib/detail-utils";
import { isKimPurchaseFloatingKind, type KimPurchasePopoverFrame } from "@/lib/popover-frames";

import {
  kimAnnualMileageOptions,
  kimContractFocusOptions,
  kimContractTermOptions,
  kimCustomerNoteOptions,
  kimDeliveryMethodOptions,
  kimInitialCostKindOptions,
  kimInitialCostUnitOptions,
  kimMethodOptions,
  kimReviewNoteOptions,
  kimTimingMonthOptions,
  kimTimingPresetOptions,
} from "./purchase-meta";
import { type OpenEditorState } from "./types";
import type { useCustomerPurchase } from "./hooks/useCustomerPurchase";

type PurchaseConditionsProps = {
  onToast: (message: string) => void;
  // 부모 소유 공유 인프라(상태·니즈도 사용) — props로 받는다.
  openEditor: OpenEditorState | null;
  setOpenEditor: Dispatch<SetStateAction<OpenEditorState | null>>;
  editorRef: RefObject<HTMLDivElement | null>;
  purchasePopoverFrame: KimPurchasePopoverFrame | null;
  purchase: ReturnType<typeof useCustomerPurchase>;
};

export function PurchaseConditions({ onToast, openEditor, setOpenEditor, editorRef, purchasePopoverFrame, purchase }: PurchaseConditionsProps) {
  const {
    fields: purchaseFields,
    showTimingMonths,
    setShowTimingMonths,
    initialCostKind,
    initialCostUnit,
    setInitialCostUnit,
    initialCostAmount,
    setInitialCostAmount,
    handlers,
  } = purchase;
  const {
    openPurchaseFloatingEditor,
    savePurchaseConditions,
    togglePurchaseMethod,
    togglePurchaseTerm,
    openPurchaseInitialCostEditor,
    selectInitialCostKind,
    applyPurchaseInitialCost,
    selectPurchaseTiming,
    selectPurchaseTimingMonth,
    togglePurchaseCostFocus,
    togglePurchaseCustomerNote,
    togglePurchaseReviewNote,
    selectPurchaseAnnualMileage,
    selectPurchaseDeliveryMethod,
  } = handlers;

  function renderPurchaseEditor() {
    return (
      <div className="kim-edit-popover purchase" role="dialog" aria-label="상세 구매조건 수정">
        <form className="kim-edit-form purchase" onSubmit={savePurchaseConditions}>
          <div className="kim-edit-grid purchase">
            {purchaseFields.map((field, index) => (
              <label key={field.label}>
                <span>{field.label}</span>
                <input autoFocus={index === 0} defaultValue={field.value === "미정" ? "" : field.value} name={field.label} placeholder="미정" />
              </label>
            ))}
          </div>
          <div className="kim-edit-actions">
            <button type="button" onClick={() => setOpenEditor(null)}>취소</button>
            <button className="primary" type="submit">저장</button>
          </div>
        </form>
      </div>
    );
  }

  function renderPurchaseMethodEditor() {
    const currentMethodField = purchaseFields.find((field) => field.label === "구매방식");
    const selectedMethods = new Set((currentMethodField?.value ?? "").split("·").map((value) => value.trim()).filter((value) => kimMethodOptions.includes(value)));

    return (
      <div className="kim-edit-popover purchase-method" role="dialog" aria-label="구매방식 수정">
        <div className="kim-method-segmented" role="group" aria-label="구매방식 선택">
          {kimMethodOptions.map((option) => (
            <button
              aria-pressed={selectedMethods.has(option)}
              className={selectedMethods.has(option) ? "active" : ""}
              key={option}
              onClick={() => togglePurchaseMethod(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderPurchaseTermEditor() {
    const currentTermField = purchaseFields.find((field) => field.label === "계약기간");
    const selectedTerms = new Set((currentTermField?.value ?? "").split("·").map((value) => value.trim()).filter((value) => kimContractTermOptions.includes(value)));

    return (
      <div className="kim-edit-popover purchase-term" role="dialog" aria-label="계약기간 수정">
        <div className="kim-method-segmented" role="group" aria-label="계약기간 선택">
          {kimContractTermOptions.map((option) => (
            <button
              aria-pressed={selectedTerms.has(option)}
              className={selectedTerms.has(option) ? "active" : ""}
              key={option}
              onClick={() => togglePurchaseTerm(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderPurchaseInitialCostEditor() {
    return (
      <div className="kim-edit-popover purchase-initial-cost" role="dialog" aria-label="초기비용 수정">
        <div className="kim-initial-cost-editor">
          <div className="kim-initial-cost-group" role="group" aria-label="초기비용 유형 선택">
            {kimInitialCostKindOptions.map((option) => (
              <button
                aria-pressed={initialCostKind === option}
                className={initialCostKind === option ? "active" : ""}
                key={option}
                onClick={() => selectInitialCostKind(option)}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
          {initialCostKind && initialCostKind !== "무보증" ? (
            <div className="kim-initial-cost-entry">
              <div className="kim-initial-cost-unit" role="group" aria-label="초기비용 입력 방식">
                {kimInitialCostUnitOptions.map((option) => (
                  <button
                    aria-pressed={initialCostUnit === option}
                    className={initialCostUnit === option ? "active" : ""}
                    key={option}
                    onClick={() => setInitialCostUnit(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
              <label className="kim-initial-cost-input">
                <span>{initialCostUnit === "%" ? "비율" : "금액"}</span>
                <div>
                  <input
                    inputMode="numeric"
                    onChange={(event) => setInitialCostAmount(event.target.value.replace(/[^\d]/g, ""))}
                    placeholder={initialCostUnit === "%" ? "30" : "1000"}
                    value={initialCostUnit === "금액" ? formatKimNumberWithCommas(initialCostAmount) : initialCostAmount}
                  />
                  <em>{initialCostUnit === "%" ? "%" : "만원"}</em>
                </div>
              </label>
            </div>
          ) : null}
          <div className="kim-edit-actions compact">
            <button type="button" onClick={() => setOpenEditor(null)}>취소</button>
            <button className="primary" type="button" onClick={applyPurchaseInitialCost}>적용</button>
          </div>
        </div>
      </div>
    );
  }

  function renderPurchaseAnnualMileageEditor() {
    const currentMileageField = purchaseFields.find((field) => field.label === "연간 주행거리");
    const currentValue = currentMileageField?.value ?? "확인 필요";

    return (
      <div className="kim-edit-popover purchase-annual-mileage" role="dialog" aria-label="연간 주행거리 수정">
        <div className="kim-mileage-picker" role="group" aria-label="연간 주행거리 선택">
          {kimAnnualMileageOptions.map((option) => (
            <button
              aria-pressed={currentValue === option}
              className={currentValue === option ? "active" : ""}
              key={option}
              onClick={() => selectPurchaseAnnualMileage(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderPurchaseDeliveryMethodEditor() {
    const currentDeliveryField = purchaseFields.find((field) => field.label === "인도 방식");
    const currentValue = currentDeliveryField?.value ?? "확인 필요";

    return (
      <div className="kim-edit-popover purchase-delivery-method" role="dialog" aria-label="인도 방식 수정">
        <div className="kim-delivery-method-picker" role="group" aria-label="인도 방식 선택">
          {kimDeliveryMethodOptions.map((option) => (
            <button
              aria-pressed={currentValue === option}
              className={currentValue === option ? "active" : ""}
              key={option}
              onClick={() => selectPurchaseDeliveryMethod(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderPurchaseTimingEditor() {
    const currentTimingField = purchaseFields.find((field) => field.label === "출고 희망 시기");
    const currentValue = currentTimingField?.value ?? "좋은 조건 즉시";
    const selectedOption = currentValue.endsWith("출고 희망") ? "특정 월" : currentValue;
    const selectedMonth = currentValue.endsWith("출고 희망") ? currentValue.replace(" 출고 희망", "") : "";
    const showMonthPicker = showTimingMonths || selectedOption === "특정 월";

    return (
      <div className="kim-edit-popover purchase-timing" role="dialog" aria-label="출고 희망 시기 수정">
        <div className="kim-timing-picker">
          <div className="kim-timing-options" role="group" aria-label="출고 희망 시기 선택">
            {kimTimingPresetOptions.map((option) => (
              <button
                aria-pressed={selectedOption === option}
                className={selectedOption === option ? "active" : ""}
                key={option}
                onClick={() => selectPurchaseTiming(option)}
                type="button"
              >
                {option}
              </button>
            ))}
            <button
              aria-expanded={showMonthPicker}
              aria-pressed={selectedOption === "특정 월"}
              className={`kim-timing-month-trigger${showMonthPicker ? " active" : ""}`}
              onClick={() => selectPurchaseTiming("특정 월")}
              type="button"
            >
              특정 월
            </button>
          </div>
          {showMonthPicker ? (
            <div className="kim-month-options" role="group" aria-label="특정 월 선택">
              {kimTimingMonthOptions.map((month) => (
                <button
                  aria-pressed={selectedMonth === month}
                  className={selectedMonth === month ? "active" : ""}
                  key={month}
                  onClick={() => selectPurchaseTimingMonth(month)}
                  type="button"
                >
                  {month}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function renderPurchaseCostFocusEditor() {
    const currentCostFocusField = purchaseFields.find((field) => field.label === "계약 포커스");
    const selectedFocuses = new Set((currentCostFocusField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => kimContractFocusOptions.includes(value)));

    return (
      <div className="kim-edit-popover purchase-cost-focus" role="dialog" aria-label="계약 포커스 수정">
        <div className="kim-cost-focus-picker" role="group" aria-label="계약 포커스 선택">
          {kimContractFocusOptions.map((option) => (
            <button
              aria-pressed={selectedFocuses.has(option)}
              className={selectedFocuses.has(option) ? "active" : ""}
              key={option}
              onClick={() => togglePurchaseCostFocus(option)}
              type="button"
            >
              #{option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderPurchaseCustomerNotesEditor() {
    const currentCustomerNoteField = purchaseFields.find((field) => field.label === "고객 특이사항");
    const selectedNotes = new Set((currentCustomerNoteField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => kimCustomerNoteOptions.includes(value)));

    return (
      <div className="kim-edit-popover purchase-customer-notes" role="dialog" aria-label="고객 특이사항 수정">
        <div className="kim-customer-note-picker" role="group" aria-label="고객 특이사항 선택">
          {kimCustomerNoteOptions.map((option) => (
            <button
              aria-pressed={selectedNotes.has(option)}
              className={selectedNotes.has(option) ? "active" : ""}
              key={option}
              onClick={() => togglePurchaseCustomerNote(option)}
              type="button"
            >
              #{option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderPurchaseReviewNotesEditor() {
    const currentReviewNoteField = purchaseFields.find((field) => field.label === "심사 특이사항");
    const selectedNotes = new Set((currentReviewNoteField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => kimReviewNoteOptions.includes(value)));

    return (
      <div className="kim-edit-popover purchase-review-notes" role="dialog" aria-label="심사 특이사항 수정">
        <div className="kim-review-note-picker" role="group" aria-label="심사 특이사항 선택">
          {kimReviewNoteOptions.map((option) => (
            <button
              aria-pressed={selectedNotes.has(option)}
              className={selectedNotes.has(option) ? "active" : ""}
              key={option}
              onClick={() => togglePurchaseReviewNote(option)}
              type="button"
            >
              #{option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderFloatingPurchaseEditor() {
    if (!openEditor || !isKimPurchaseFloatingKind(openEditor.kind) || !purchasePopoverFrame) return null;

    return (
      <div
        className={`kim-purchase-floating-popover align-${purchasePopoverFrame.align ?? "left"}`}
        ref={editorRef}
        style={{ left: purchasePopoverFrame.left, top: purchasePopoverFrame.top }}
      >
        {openEditor.kind === "purchaseMethod" ? renderPurchaseMethodEditor() : null}
        {openEditor.kind === "purchaseTiming" ? renderPurchaseTimingEditor() : null}
        {openEditor.kind === "purchaseCostFocus" ? renderPurchaseCostFocusEditor() : null}
        {openEditor.kind === "purchaseTerm" ? renderPurchaseTermEditor() : null}
        {openEditor.kind === "purchaseInitialCost" ? renderPurchaseInitialCostEditor() : null}
        {openEditor.kind === "purchaseAnnualMileage" ? renderPurchaseAnnualMileageEditor() : null}
        {openEditor.kind === "purchaseDeliveryMethod" ? renderPurchaseDeliveryMethodEditor() : null}
        {openEditor.kind === "purchaseCustomerNotes" ? renderPurchaseCustomerNotesEditor() : null}
        {openEditor.kind === "purchaseReviewNotes" ? renderPurchaseReviewNotesEditor() : null}
      </div>
    );
  }

  return (
    <>
      <section className="detail-section kim-purchase-conditions" aria-label="상세 구매조건" ref={openEditor?.kind === "purchase" ? editorRef : undefined}>
        <div className="kim-mvp-card-head">
          <div className="kim-mvp-title-row">
            <i aria-hidden="true" className="kim-mvp-title-icon"><ListChecks size={14} strokeWidth={2.2} /></i>
            <h3>상세 구매조건</h3>
          </div>
        </div>
        <div className="kim-purchase-condition-body">
          {purchaseFields.map((field) => {
            const displayValue = field.value || "미정";
            const itemButton = (
              <button
                className="kim-purchase-condition-item"
                onClick={(event) => {
                  if (field.label === "구매방식") {
                    openPurchaseFloatingEditor(event, { kind: "purchaseMethod" });
                    return;
                  }
                  if (field.label === "출고 희망 시기") {
                    setShowTimingMonths(field.value.endsWith("출고 희망"));
                    openPurchaseFloatingEditor(event, { kind: "purchaseTiming" });
                    return;
                  }
                  if (field.label === "계약 포커스") {
                    openPurchaseFloatingEditor(event, { kind: "purchaseCostFocus" });
                    return;
                  }
                  if (field.label === "계약기간") {
                    openPurchaseFloatingEditor(event, { kind: "purchaseTerm" });
                    return;
                  }
                  if (field.label === "초기비용") {
                    openPurchaseInitialCostEditor(event);
                    return;
                  }
                  if (field.label === "연간 주행거리") {
                    openPurchaseFloatingEditor(event, { kind: "purchaseAnnualMileage" });
                    return;
                  }
                  if (field.label === "인도 방식") {
                    openPurchaseFloatingEditor(event, { kind: "purchaseDeliveryMethod" });
                    return;
                  }
                  if (field.label === "고객 특이사항") {
                    openPurchaseFloatingEditor(event, { kind: "purchaseCustomerNotes" });
                    return;
                  }
                  if (field.label === "심사 특이사항") {
                    openPurchaseFloatingEditor(event, { kind: "purchaseReviewNotes" });
                    return;
                  }
                  onToast(`${field.label} 수정은 다음 단계에서 연결합니다.`);
                }}
                type="button"
              >
                <span>{field.label}</span>
                {isKimPurchaseTagField(field.label) && field.value !== "확인 필요" && field.value.trim() !== "" ? (
                  <strong className="is-tag-list">
                    {kimPurchaseTags(field.value).map((tag) => <span key={tag}>{tag}</span>)}
                  </strong>
                ) : (
                  <strong className={kimPurchaseValueClass(displayValue)}>{displayValue}</strong>
                )}
              </button>
            );

            return (
              <div
                className={`kim-purchase-condition-anchor editable${isKimPurchaseTagField(field.label) ? " judgment" : ""}${(field.label === "구매방식" && openEditor?.kind === "purchaseMethod") || (field.label === "출고 희망 시기" && openEditor?.kind === "purchaseTiming") || (field.label === "계약 포커스" && openEditor?.kind === "purchaseCostFocus") || (field.label === "계약기간" && openEditor?.kind === "purchaseTerm") || (field.label === "초기비용" && openEditor?.kind === "purchaseInitialCost") || (field.label === "연간 주행거리" && openEditor?.kind === "purchaseAnnualMileage") || (field.label === "인도 방식" && openEditor?.kind === "purchaseDeliveryMethod") || (field.label === "고객 특이사항" && openEditor?.kind === "purchaseCustomerNotes") || (field.label === "심사 특이사항" && openEditor?.kind === "purchaseReviewNotes") ? " active" : ""}`}
                key={field.label}
              >
                {itemButton}
              </div>
            );
          })}
        </div>
        {openEditor?.kind === "purchase" ? renderPurchaseEditor() : null}
      </section>
      {renderFloatingPurchaseEditor()}
    </>
  );
}
