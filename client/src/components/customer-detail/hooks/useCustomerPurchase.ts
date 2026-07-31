import { useEffect, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction, type SyntheticEvent } from "react";

import { PURCHASE_UNSET_SENTINEL } from "@/data/customers";
import { formatNumberWithCommas } from "@/lib/detail-utils";
import { timingTextFromPreset } from "@/lib/quote-request-needs";
import { calculatePurchasePopoverFrame, type PurchaseFloatingKind, type PurchasePopoverFrame } from "@/lib/popover-frames";
import { type CustomerDetailData, type CustomerWritePatch } from "@/lib/customers";

import { type OpenEditorState } from "../types";
import {
  contractFocusOptions,
  contractTermOptions,
  customerNoteOptions,
  DERIVED_PURCHASE_LABELS,
  methodOptions,
  purchaseFieldScaffold,
  purchaseTagSelectionLimit,
  reviewNoteOptions,
  parseInitialCost,
  PURCHASE_EDITOR_LABEL,
  PURCHASE_FIELD_KEY,
  type InitialCostKind,
  type InitialCostSelection,
  type InitialCostUnit,
} from "../purchase-meta";

type UseCustomerPurchaseArgs = {
  detail: CustomerDetailData; // purchaseFields 초기값 매핑 소스(PURCHASE_FIELD_KEY로 9필드 전부)
  onToast: (message: string) => void;
  // 부모 소유 공유 인프라(상태·니즈도 사용). 훅은 인자로만 받아 쓴다.
  openEditor: OpenEditorState | null;
  setOpenEditor: Dispatch<SetStateAction<OpenEditorState | null>>;
  editorMatches: (openEditor: OpenEditorState | null, next: OpenEditorState) => boolean;
  savePatch: (patch: CustomerWritePatch, rollback: () => void) => void;
  markRecentUpdate: (section: string) => void;
  // purchasePopoverFrame 상태는 부모 소유(toggleEditor·외부클릭 dismiss effect가 기록) — 쓰기 setter만 주입.
  setPurchasePopoverFrame: Dispatch<SetStateAction<PurchasePopoverFrame | null>>;
  // 구매방식은 목록 "차종·구매방식" 열과 같은 need_method 컬럼이다 — 그 행만 즉시 갱신한다
  // (전체 재페치를 기다리면 목록만 뒤늦게 바뀐다, #354와 같은 결).
  onVehicleChange?: (next: { vehicle?: string; vehicleTrim?: string; method?: string }) => void;
};

export function useCustomerPurchase({
  detail,
  onToast,
  openEditor,
  setOpenEditor,
  editorMatches,
  savePatch,
  markRecentUpdate,
  setPurchasePopoverFrame,
  onVehicleChange,
}: UseCustomerPurchaseArgs) {
  const [purchaseFields, setPurchaseFields] = useState(() =>
    purchaseFieldScaffold.map((field) => {
      const key = PURCHASE_FIELD_KEY[field.label];
      const stored = key ? (detail as Record<string, unknown>)[key] : undefined;
      return typeof stored === "string" && stored ? { ...field, value: stored } : field;
    }),
  );
  // 대표 견적요청이 바뀌면(설계 D1) 서버가 파생 5필드를 한꺼번에 갈아끼우고 호출부가 상세를 다시 받는다.
  // purchaseFields는 useState 초기화 함수로만 detail을 읽어 최초 마운트 값에 고정되므로, 여기서 새 detail을
  // 따라가지 않으면 "별을 눌렀는데 구매조건이 그대로"가 된다(리로드해야 반영 — 2026-07-24 실기 발견).
  // ⚠️ 파생 5필드만 동기화한다. 수기 유지 4필드(인도 방식·계약 포커스·고객/심사 특이사항)를 함께 덮으면
  //    상담사가 방금 편집한 값이 서버 왕복 사이에 되돌아갈 수 있다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 값(detail) 동기화. 값이 같으면 아래에서 같은 배열을 반환해 리렌더가 멈춘다.
    setPurchaseFields((current) => {
      let changed = false;
      const next = current.map((field) => {
        if (!DERIVED_PURCHASE_LABELS.has(field.label)) return field;
        const key = PURCHASE_FIELD_KEY[field.label];
        const stored = key ? (detail as Record<string, unknown>)[key] : undefined;
        const value = typeof stored === "string" && stored ? stored : "";
        if (field.value === value) return field;
        changed = true;
        return { ...field, value };
      });
      return changed ? next : current;
    });
  }, [detail]);

  const [initialCostKind, setInitialCostKind] = useState<InitialCostSelection>("보증금");
  const [initialCostUnit, setInitialCostUnit] = useState<InitialCostUnit>("%");
  const [initialCostAmount, setInitialCostAmount] = useState("30");

  // 대표 견적요청이 있으면 파생 5필드는 read-only(설계 D2) — 값의 정본이 그 요청이라 손으로 고칠 수
  // 없다. 바꾸려면 대표를 바꾼다(앱 카드 star). 서버도 409로 막는다(D7) — 여기는 UX 보조다.
  // 대표가 없으면(앱 미연결 고객 · 견적요청 0건인 앱 고객) 파생 소스가 없으므로 전부 편집 가능하다.
  const derivedLocked = detail.featuredRequestId != null;
  function isFieldLocked(label: string): boolean {
    return derivedLocked && DERIVED_PURCHASE_LABELS.has(label);
  }

  function openPurchaseFloatingEditor(event: ReactMouseEvent<HTMLButtonElement>, next: Extract<OpenEditorState, { kind: PurchaseFloatingKind }>) {
    // 잠긴 필드는 팝오버 자체를 열지 않는다 — 셀 버튼도 disabled지만 다른 경로로 불릴 수 있다.
    if (isFieldLocked(PURCHASE_EDITOR_LABEL[next.kind] ?? "")) return;
    if (openEditor && editorMatches(openEditor, next)) {
      setOpenEditor(null);
      setPurchasePopoverFrame(null);
      return;
    }
    setPurchasePopoverFrame(calculatePurchasePopoverFrame(event.currentTarget, next.kind));
    setOpenEditor(next);
  }

  // ⚠️ 9개 필드를 통째로 로컬 갱신하고 "수정 완료" 토스트까지 띄우는데 **savePatch 호출이 없다** —
  // 서버에 아무것도 안 간다. 지금은 도달 불가라 무해하다: 렌더 조건이 `openEditor?.kind === "purchase"`
  // (PurchaseConditions의 renderPurchaseEditor)인데 `{ kind: "purchase" }`를 만드는 코드가 레포에
  // 0건이다(types.ts의 타입 선언과 editorMatches 비교만 존재). 되살리려면 이 함수에 savePatch부터
  // 배선할 것 — 안 그러면 "수정 완료라는데 새로고침하면 사라진다"가 된다. 덧붙여 그 에디터를 다시
  // 열려면 fixed 래퍼 경로에 얹어야 한다(.kim-workspace-band .kim-purchase-conditions가 overflow:hidden
  // 이라 absolute 팝오버는 저장 버튼이 잘린다 — 다른 9개 kind가 그래서 이주했다).
  // (2026-07-31 타깃 렌즈 배치 발굴)
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
    const selectedMethods = new Set((currentMethodField?.value ?? "").split("·").map((value) => value.trim()).filter((value) => methodOptions.includes(value)));
    if (selectedMethods.has(option)) {
      selectedMethods.delete(option);
    } else {
      selectedMethods.add(option);
    }
    const orderedMethods = methodOptions.filter((method) => selectedMethods.has(method));
    const nextValue = orderedMethods.length > 0 ? orderedMethods.join(" · ") : "확인 필요";
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "구매방식" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("구매방식 수정 완료");
    onVehicleChange?.({ method: nextValue });
    savePatch({ needMethod: nextValue }, () => {
      setPurchaseFields(prevPurchaseFields);
      onVehicleChange?.({ method: currentMethodField?.value ?? "" }); // 목록 행도 되돌린다
    });
  }

  function togglePurchaseTerm(option: string) {
    const currentTermField = purchaseFields.find((field) => field.label === "계약기간");
    const selectedTerms = new Set((currentTermField?.value ?? "").split("·").map((value) => value.trim()).filter((value) => contractTermOptions.includes(value)));
    if (selectedTerms.has(option)) {
      selectedTerms.delete(option);
    } else {
      selectedTerms.add(option);
    }
    const orderedTerms = contractTermOptions.filter((term) => selectedTerms.has(term));
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
    if (isFieldLocked("초기비용")) return; // 초기비용은 전용 진입점이라 위 가드를 안 탄다
    const nextEditor = { kind: "purchaseInitialCost" } as const;
    if (openEditor && editorMatches(openEditor, nextEditor)) {
      setOpenEditor(null);
      setPurchasePopoverFrame(null);
      return;
    }
    const currentInitialCostField = purchaseFields.find((field) => field.label === "초기비용");
    const parsedInitialCost = parseInitialCost(currentInitialCostField?.value ?? "보증금 30%");
    setInitialCostKind(parsedInitialCost.kind);
    setInitialCostUnit(parsedInitialCost.unit);
    setInitialCostAmount(parsedInitialCost.amount);
    setPurchasePopoverFrame(calculatePurchasePopoverFrame(event.currentTarget, "purchaseInitialCost"));
    setOpenEditor(nextEditor);
  }

  function selectInitialCostKind(option: InitialCostKind) {
    const nextKind: InitialCostSelection = initialCostKind === option ? "" : option;
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
    const formattedAmount = initialCostUnit === "금액" ? formatNumberWithCommas(trimmedAmount) : trimmedAmount;
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

  // 프리셋을 고른 **시점**을 참조월로 절대화해 저장한다(설계 D4) — 앱 연결 고객이 요청에서 받는 값과
  // 같은 어휘가 되고, 상대 표현이 컬럼에 남아 시간이 지나며 부패하는 것을 막는다.
  // 같은 값을 다시 누르면 해제(미입력 센티넬).
  function selectPurchaseTiming(option: string) {
    const currentTimingField = purchaseFields.find((field) => field.label === "출고 희망 시기");
    const now = new Date();
    const referenceMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const nextText = timingTextFromPreset(option, referenceMonth);
    const nextValue = currentTimingField?.value === nextText ? PURCHASE_UNSET_SENTINEL : nextText;
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "출고 희망 시기" ? { ...field, value: nextValue } : field
    )));
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("출고 희망 시기 수정 완료");
    savePatch({ needTiming: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }

  function togglePurchaseCostFocus(option: string) {
    const currentCostFocusField = purchaseFields.find((field) => field.label === "계약 포커스");
    const selectedFocuses = new Set((currentCostFocusField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => contractFocusOptions.includes(value)));
    if (selectedFocuses.has(option)) {
      selectedFocuses.delete(option);
    } else {
      if (selectedFocuses.size >= purchaseTagSelectionLimit) {
        onToast("최대 4개까지만 선택 가능합니다.");
        return;
      }
      selectedFocuses.add(option);
    }
    const orderedFocuses = contractFocusOptions.filter((focus) => selectedFocuses.has(focus));
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
    const selectedNotes = new Set((currentCustomerNoteField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => customerNoteOptions.includes(value)));
    if (selectedNotes.has(option)) {
      selectedNotes.delete(option);
    } else {
      if (selectedNotes.size >= purchaseTagSelectionLimit) {
        onToast("최대 4개까지만 선택 가능합니다.");
        return;
      }
      selectedNotes.add(option);
    }
    const orderedNotes = customerNoteOptions.filter((note) => selectedNotes.has(note));
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
    const selectedNotes = new Set((currentReviewNoteField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => reviewNoteOptions.includes(value)));
    if (selectedNotes.has(option)) {
      selectedNotes.delete(option);
    } else {
      if (selectedNotes.size >= purchaseTagSelectionLimit) {
        onToast("최대 4개까지만 선택 가능합니다.");
        return;
      }
      selectedNotes.add(option);
    }
    const orderedNotes = reviewNoteOptions.filter((note) => selectedNotes.has(note));
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
    isFieldLocked,
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
      togglePurchaseCostFocus,
      togglePurchaseCustomerNote,
      togglePurchaseReviewNote,
      selectPurchaseAnnualMileage,
      selectPurchaseDeliveryMethod,
    },
  };
}
