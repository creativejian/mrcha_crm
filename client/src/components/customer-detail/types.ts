// 고객 상세(KimMinjunDetailContent) 분해를 위한 공유 타입.
// 본체에서 추출한 에디터 상태 타입 — 분해될 자식 컴포넌트들이 공유한다.
// (이 단계는 타입 이동만, 동작/로직 무변경)

export type KimStatusFieldKey = "phone" | "job" | "location" | "source" | "advisor" | "assignedAt";
export type KimWorkflowKey = "stage" | "chance" | "manage";

export type KimRecentUpdate = {
  section: string;
  updatedAt: number;
};

export type OpenEditorState =
  | { kind: "status"; key: KimStatusFieldKey }
  | { kind: "workflow"; key: KimWorkflowKey }
  | { kind: "needs" }
  | { kind: "purchase" }
  | { kind: "purchaseMethod" }
  | { kind: "purchaseTiming" }
  | { kind: "purchaseCostFocus" }
  | { kind: "purchaseTerm" }
  | { kind: "purchaseInitialCost" }
  | { kind: "purchaseAnnualMileage" }
  | { kind: "purchaseDeliveryMethod" }
  | { kind: "purchaseCustomerNotes" }
  | { kind: "purchaseReviewNotes" }
  | { kind: "timeline" }
  | { kind: "schedule" };
