// MC 마스터 변경 요청 kind 어휘(SSOT — discount-adoption.ts와 동형). 서버(src/db/schema.ts —
// DB CHECK 파생·레지스트리 키)와 클라(대기열 라벨)가 이 배열 하나를 본다. 부작용 0 순수 모듈이라
// 서버→클라 import 경계(AGENTS.md)에 허용된다. 9번째 kind 추가 시 여기 + 라벨 + 서버 레지스트리.
export const CHANGE_REQUEST_KINDS = [
  "model.create", "model.update",
  "trim.create", "trim.update",
  "option.create", "option.update",
  "trim.no-option.set", "trim.no-option.unset",
] as const;
export type ChangeRequestKind = (typeof CHANGE_REQUEST_KINDS)[number];

export const CHANGE_KIND_LABELS: Record<ChangeRequestKind, string> = {
  "model.create": "모델 추가",
  "model.update": "모델 수정",
  "trim.create": "트림 추가",
  "trim.update": "트림 수정",
  "option.create": "옵션 추가",
  "option.update": "옵션 수정",
  "trim.no-option.set": "무옵션 확정",
  "trim.no-option.unset": "무옵션 해제",
};

// diff 필드 한글 라벨 — 트림/모델/옵션 payload 키 전체(스냅샷 selector와 같은 어휘).
// 할인 3필드는 DISCOUNT_FIELD_LABELS(discount-adoption.ts)와 표기를 맞춘다.
export const CHANGE_FIELD_LABELS: Record<string, string> = {
  trimName: "트림명", price: "가격", modelYear: "연식", fuelType: "연료",
  driveSystem: "구동", displacementCc: "배기량", transmissionType: "변속기",
  bodyStyle: "차체", seatingCapacity: "승차정원", status: "상태",
  financialDiscountAmount: "자사할인", partnerDiscountAmount: "제휴할인", cashDiscountAmount: "타사할인",
  category: "카테고리", name: "이름", type: "종류", brandId: "브랜드", modelId: "모델", trimId: "트림",
};
