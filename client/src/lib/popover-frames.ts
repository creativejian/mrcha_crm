// 김민준 고객 상세의 floating 편집 popover·견적 액션/툴팁의 화면 좌표 계산.
// getBoundingClientRect + 뷰포트 경계로 위치를 잡는 순수 DOM 계산이라 데이터와 무관.
// 에디터 상태 타입(OpenEditorState)은 본체 소유라, 여기 가드는 string 입력을 받아
// PurchaseFloatingKind로 좁힌다.

export type PurchaseFloatingKind =
  | "purchaseMethod"
  | "purchaseTiming"
  | "purchaseCostFocus"
  | "purchaseTerm"
  | "purchaseInitialCost"
  | "purchaseAnnualMileage"
  | "purchaseDeliveryMethod"
  | "purchaseCustomerNotes"
  | "purchaseReviewNotes";

export type PurchasePopoverFrame = { align?: "left" | "right"; top: number; left: number };
export type QuoteActionFrame = { top: number; left: number };
export type QuoteStatusTooltip = { id: string; top: number; left: number };

export function isPurchaseFloatingKind(kind: string): kind is PurchaseFloatingKind {
  return ["purchaseMethod", "purchaseTiming", "purchaseCostFocus", "purchaseTerm", "purchaseInitialCost", "purchaseAnnualMileage", "purchaseDeliveryMethod", "purchaseCustomerNotes", "purchaseReviewNotes"].includes(kind);
}

export function purchasePopoverSize(kind: PurchaseFloatingKind) {
  switch (kind) {
    case "purchaseMethod":
      return { width: 390, height: 48 };
    case "purchaseTiming":
      return { width: 318, height: 108 };
    case "purchaseCostFocus":
      return { width: 360, height: 118 };
    case "purchaseTerm":
      return { width: 352, height: 48 };
    case "purchaseInitialCost":
      return { width: 330, height: 146 };
    case "purchaseAnnualMileage":
      return { width: 360, height: 88 };
    case "purchaseDeliveryMethod":
      return { width: 340, height: 48 };
    case "purchaseCustomerNotes":
      return { width: 380, height: 154 };
    case "purchaseReviewNotes":
      return { width: 380, height: 118 };
    default:
      return { width: 340, height: 120 };
  }
}

export function calculatePurchasePopoverFrame(target: HTMLElement, kind: PurchaseFloatingKind): PurchasePopoverFrame {
  const rect = target.getBoundingClientRect();
  const gap = 8;
  const margin = 14;
  const { width, height } = purchasePopoverSize(kind);
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const alignRight = kind === "purchaseInitialCost" || kind === "purchaseTiming" || kind === "purchaseReviewNotes";
  const preferredLeft = alignRight
    ? rect.right
    : kind === "purchaseMethod" || kind === "purchaseTerm" || kind === "purchaseAnnualMileage" || kind === "purchaseDeliveryMethod" || kind === "purchaseCostFocus" || kind === "purchaseCustomerNotes"
    ? rect.left
    : rect.left + rect.width / 2 - width / 2;
  const maxLeft = alignRight ? viewportWidth - margin : Math.max(margin, viewportWidth - width - margin);
  const left = Math.min(Math.max(preferredLeft, margin), maxLeft);
  const belowTop = rect.bottom + gap;
  const aboveTop = rect.top - height - gap;
  const preferAbove = false;
  const top = (preferAbove || belowTop + height > viewportHeight - margin) && aboveTop >= margin
    ? aboveTop
    : Math.min(belowTop, Math.max(margin, viewportHeight - height - margin));
  return { align: alignRight ? "right" : "left", top, left };
}

export function calculateQuoteActionFrame(target: HTMLElement): QuoteActionFrame {
  const rect = target.getBoundingClientRect();
  const width = 214;
  const margin = 10;
  const left = Math.min(window.innerWidth - width - margin, rect.right + 8);
  const top = Math.max(margin, rect.bottom);
  return { top, left };
}

export function calculateQuoteStatusTooltip(target: HTMLElement, id: string): QuoteStatusTooltip {
  const rect = target.getBoundingClientRect();
  const margin = 10;
  const top = Math.max(margin, rect.top - 8);
  const left = Math.min(window.innerWidth - margin, Math.max(margin, rect.left));
  return { id, top, left };
}
