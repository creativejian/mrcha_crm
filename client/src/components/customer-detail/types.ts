// 고객 상세(CustomerDetailContent) 분해를 위한 공유 타입.
// 본체에서 추출한 에디터 상태 타입 — 분해될 자식 컴포넌트들이 공유한다.
// (이 단계는 타입 이동만, 동작/로직 무변경)

export type StatusFieldKey = "phone" | "phoneSecondary" | "job" | "location" | "source" | "advisor" | "assignedAt";
export type WorkflowKey = "stage" | "chance" | "manage";

export type RecentUpdate = {
  section: string;
  updatedAt: number;
};

export type OpenEditorState =
  | { kind: "status"; key: StatusFieldKey }
  | { kind: "workflow"; key: WorkflowKey }
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

// 서류함 항목(업로드 직후 메모리 file/objectUrl 포함). 서류 영역 훅·컴포넌트가 공유한다.
export type DocumentItem = {
  id: string;
  title: string;
  status: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  objectUrl?: string;
  file?: File;
};
