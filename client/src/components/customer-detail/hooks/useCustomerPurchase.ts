import { useState, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction, type SyntheticEvent } from "react";

import { formatKimNumberWithCommas } from "@/lib/kim-detail-utils";
import { calculateKimPurchasePopoverFrame, type KimPurchaseFloatingKind, type KimPurchasePopoverFrame } from "@/lib/kim-popover-frames";
import { type CustomerDetailData, type CustomerWritePatch } from "@/lib/customers";

import { type OpenEditorState } from "../types";
import {
  kimContractFocusOptions,
  kimContractTermOptions,
  kimCustomerNoteOptions,
  kimMethodOptions,
  kimMinjunPurchaseFields,
  kimPurchaseTagSelectionLimit,
  kimReviewNoteOptions,
  parseKimInitialCost,
  PURCHASE_FIELD_KEY,
  type KimInitialCostKind,
  type KimInitialCostSelection,
  type KimInitialCostUnit,
} from "../purchase-meta";

type UseCustomerPurchaseArgs = {
  detail: CustomerDetailData; // purchaseFields 초기값 매핑 소스(PURCHASE_FIELD_KEY로 9필드 전부)
  onToast: (message: string) => void;
  // 부모 소유 공유 인프라(상태·니즈도 사용). 훅은 인자로만 받아 쓴다.
  openEditor: OpenEditorState | null;
  setOpenEditor: Dispatch<SetStateAction<OpenEditorState | null>>;
  kimEditorMatches: (openEditor: OpenEditorState | null, next: OpenEditorState) => boolean;
  savePatch: (patch: CustomerWritePatch, rollback: () => void) => void;
  markRecentUpdate: (section: string) => void;
  // purchasePopoverFrame 상태는 부모 소유(toggleEditor·외부클릭 dismiss effect가 기록) — 쓰기 setter만 주입.
  setPurchasePopoverFrame: Dispatch<SetStateAction<KimPurchasePopoverFrame | null>>;
};

export function useCustomerPurchase({
  detail,
  onToast,
  openEditor,
  setOpenEditor,
  kimEditorMatches,
  savePatch,
  markRecentUpdate,
  setPurchasePopoverFrame,
}: UseCustomerPurchaseArgs) {
  const [purchaseFields, setPurchaseFields] = useState(() =>
    kimMinjunPurchaseFields.map((field) => {
      const key = PURCHASE_FIELD_KEY[field.label];
      const stored = key ? (detail as Record<string, unknown>)[key] : undefined;
      return typeof stored === "string" && stored ? { ...field, value: stored } : field;
    }),
  );
  const [showTimingMonths, setShowTimingMonths] = useState(false);
  const [initialCostKind, setInitialCostKind] = useState<KimInitialCostSelection>("보증금");
  const [initialCostUnit, setInitialCostUnit] = useState<KimInitialCostUnit>("%");
  const [initialCostAmount, setInitialCostAmount] = useState("30");

  function openPurchaseFloatingEditor(event: ReactMouseEvent<HTMLButtonElement>, next: Extract<OpenEditorState, { kind: KimPurchaseFloatingKind }>) {
    if (openEditor && kimEditorMatches(openEditor, next)) {
      setOpenEditor(null);
      setPurchasePopoverFrame(null);
      return;
    }
    setPurchasePopoverFrame(calculateKimPurchasePopoverFrame(event.currentTarget, next.kind));
    setOpenEditor(next);
  }

  function savePurchaseConditions(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setPurchaseFields((current) => current.map((field) => {
      const value = String(formData.get(field.label) ?? "").trim();
      return { ...field, value: value || "미정" };
    }));
    setOpenEditor(null);
    markRecentUpdate("상세 구매조건");
    onToast("상세 구매조건 수정 완료");
  }

  function togglePurchaseMethod(option: string) {
    const currentMethodField = purchaseFields.find((field) => field.label === "구매방식");
    const selectedMethods = new Set((currentMethodField?.value ?? "").split("·").map((value) => value.trim()).filter((value) => kimMethodOptions.includes(value)));
    if (selectedMethods.has(option)) {
      selectedMethods.delete(option);
    } else {
      selectedMethods.add(option);
    }
    const orderedMethods = kimMethodOptions.filter((method) => selectedMethods.has(method));
    const nextValue = orderedMethods.length > 0 ? orderedMethods.join(" · ") : "확인 필요";
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "구매방식" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("구매방식 수정 완료");
    savePatch({ needMethod: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }

  function togglePurchaseTerm(option: string) {
    const currentTermField = purchaseFields.find((field) => field.label === "계약기간");
    const selectedTerms = new Set((currentTermField?.value ?? "").split("·").map((value) => value.trim()).filter((value) => kimContractTermOptions.includes(value)));
    if (selectedTerms.has(option)) {
      selectedTerms.delete(option);
    } else {
      selectedTerms.add(option);
    }
    const orderedTerms = kimContractTermOptions.filter((term) => selectedTerms.has(term));
    const nextValue = orderedTerms.length > 0 ? orderedTerms.join(" · ") : "확인 필요";
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "계약기간" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("계약기간 수정 완료");
    savePatch({ needContractTerm: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }

  function openPurchaseInitialCostEditor(event: ReactMouseEvent<HTMLButtonElement>) {
    const nextEditor = { kind: "purchaseInitialCost" } as const;
    if (openEditor && kimEditorMatches(openEditor, nextEditor)) {
      setOpenEditor(null);
      setPurchasePopoverFrame(null);
      return;
    }
    const currentInitialCostField = purchaseFields.find((field) => field.label === "초기비용");
    const parsedInitialCost = parseKimInitialCost(currentInitialCostField?.value ?? "보증금 30%");
    setInitialCostKind(parsedInitialCost.kind);
    setInitialCostUnit(parsedInitialCost.unit);
    setInitialCostAmount(parsedInitialCost.amount);
    setPurchasePopoverFrame(calculateKimPurchasePopoverFrame(event.currentTarget, "purchaseInitialCost"));
    setOpenEditor(nextEditor);
  }

  function selectInitialCostKind(option: KimInitialCostKind) {
    const nextKind: KimInitialCostSelection = initialCostKind === option ? "" : option;
    setInitialCostKind(nextKind);
    if (!nextKind || nextKind === "무보증") {
      setInitialCostAmount("");
    } else if (!initialCostAmount) {
      setInitialCostAmount(initialCostUnit === "%" ? "30" : "");
    }
  }

  function applyPurchaseInitialCost() {
    const trimmedAmount = initialCostAmount.replace(/[^\d]/g, "");
    if (initialCostKind && initialCostKind !== "무보증" && !trimmedAmount) {
      onToast("초기비용 값을 입력해 주세요.");
      return;
    }
    const formattedAmount = initialCostUnit === "금액" ? formatKimNumberWithCommas(trimmedAmount) : trimmedAmount;
    const nextValue = !initialCostKind
      ? "확인 필요"
      : initialCostKind === "무보증"
      ? "무보증"
      : `${initialCostKind} ${formattedAmount}${initialCostUnit === "%" ? "%" : "만원"}`;
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "초기비용" ? { ...field, value: nextValue } : field
    )));
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("초기비용 수정 완료");
    savePatch({ needInitialCost: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }

  function selectPurchaseTiming(option: string) {
    if (option === "특정 월") {
      setShowTimingMonths(true);
      return;
    }
    const currentTimingField = purchaseFields.find((field) => field.label === "출고 희망 시기");
    const nextValue = currentTimingField?.value === option ? "확인 필요" : option;
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "출고 희망 시기" ? { ...field, value: nextValue } : field
    )));
    setShowTimingMonths(false);
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("출고 희망 시기 수정 완료");
    savePatch({ needTiming: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }

  function selectPurchaseTimingMonth(month: string) {
    const currentTimingField = purchaseFields.find((field) => field.label === "출고 희망 시기");
    const monthValue = `${month} 출고 희망`;
    const nextValue = currentTimingField?.value === monthValue ? "확인 필요" : monthValue;
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "출고 희망 시기" ? { ...field, value: nextValue } : field
    )));
    setShowTimingMonths(false);
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("출고 희망 시기 수정 완료");
    savePatch({ needTiming: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }

  function togglePurchaseCostFocus(option: string) {
    const currentCostFocusField = purchaseFields.find((field) => field.label === "계약 포커스");
    const selectedFocuses = new Set((currentCostFocusField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => kimContractFocusOptions.includes(value)));
    if (selectedFocuses.has(option)) {
      selectedFocuses.delete(option);
    } else {
      if (selectedFocuses.size >= kimPurchaseTagSelectionLimit) {
        onToast("최대 4개까지만 선택 가능합니다.");
        return;
      }
      selectedFocuses.add(option);
    }
    const orderedFocuses = kimContractFocusOptions.filter((focus) => selectedFocuses.has(focus));
    const nextValue = orderedFocuses.length > 0 ? orderedFocuses.map((focus) => `#${focus}`).join(" ") : "확인 필요";
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "계약 포커스" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("계약 포커스 수정 완료");
    savePatch({ needContractFocus: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }

  function togglePurchaseCustomerNote(option: string) {
    const currentCustomerNoteField = purchaseFields.find((field) => field.label === "고객 특이사항");
    const selectedNotes = new Set((currentCustomerNoteField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => kimCustomerNoteOptions.includes(value)));
    if (selectedNotes.has(option)) {
      selectedNotes.delete(option);
    } else {
      if (selectedNotes.size >= kimPurchaseTagSelectionLimit) {
        onToast("최대 4개까지만 선택 가능합니다.");
        return;
      }
      selectedNotes.add(option);
    }
    const orderedNotes = kimCustomerNoteOptions.filter((note) => selectedNotes.has(note));
    const nextValue = orderedNotes.length > 0 ? orderedNotes.map((note) => `#${note}`).join(" ") : "확인 필요";
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "고객 특이사항" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("고객 특이사항 수정 완료");
    savePatch({ needCustomerNote: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }

  function togglePurchaseReviewNote(option: string) {
    const currentReviewNoteField = purchaseFields.find((field) => field.label === "심사 특이사항");
    const selectedNotes = new Set((currentReviewNoteField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => kimReviewNoteOptions.includes(value)));
    if (selectedNotes.has(option)) {
      selectedNotes.delete(option);
    } else {
      if (selectedNotes.size >= kimPurchaseTagSelectionLimit) {
        onToast("최대 4개까지만 선택 가능합니다.");
        return;
      }
      selectedNotes.add(option);
    }
    const orderedNotes = kimReviewNoteOptions.filter((note) => selectedNotes.has(note));
    const nextValue = orderedNotes.length > 0 ? orderedNotes.map((note) => `#${note}`).join(" ") : "확인 필요";
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "심사 특이사항" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("심사 특이사항 수정 완료");
    savePatch({ needReviewNote: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }

  function selectPurchaseAnnualMileage(option: string) {
    const currentMileageField = purchaseFields.find((field) => field.label === "연간 주행거리");
    const nextValue = currentMileageField?.value === option ? "확인 필요" : option;
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "연간 주행거리" ? { ...field, value: nextValue } : field
    )));
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("연간 주행거리 수정 완료");
    savePatch({ needAnnualMileage: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }

  function selectPurchaseDeliveryMethod(option: string) {
    const currentDeliveryField = purchaseFields.find((field) => field.label === "인도 방식");
    const nextValue = currentDeliveryField?.value === option ? "확인 필요" : option;
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "인도 방식" ? { ...field, value: nextValue } : field
    )));
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("인도 방식 수정 완료");
    savePatch({ needDeliveryMethod: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }

  return {
    fields: purchaseFields,
    showTimingMonths,
    setShowTimingMonths,
    initialCostKind,
    initialCostUnit,
    setInitialCostUnit,
    initialCostAmount,
    setInitialCostAmount,
    handlers: {
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
    },
  };
}
