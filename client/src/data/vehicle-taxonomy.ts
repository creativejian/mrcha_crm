// 차량 status enum(DB 저장값, public.car_status)과 모델 카테고리 옵션 SSOT.
// 표시 라벨은 앱 admin과 동일하게 enum 원값 그대로 노출한다(사전예약·블라인드).
export const VEHICLE_STATUSES = ["판매중", "출시예정", "사전예약", "단종", "블라인드"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export function statusLabel(s: VehicleStatus): string {
  return s;
}

// 단종 모델의 트림은 단종/블라인드만 허용(앱 trim_status_helpers + 서버 트리거와 동일).
// 모델이 단종이고 트림을 판매중/출시예정/사전예약으로 두면 저장 불가 → 배너/버튼 비활성.
export function isTrimStatusBlockedByModel(modelStatus: VehicleStatus | null, trimStatus: VehicleStatus): boolean {
  if (modelStatus !== "단종") return false;
  return trimStatus === "판매중" || trimStatus === "출시예정" || trimStatus === "사전예약";
}

export type BadgeTone = "green" | "yellow" | "red" | "gray" | "purple";
const STATUS_TONE: Record<VehicleStatus, BadgeTone> = {
  판매중: "green",
  출시예정: "yellow",
  사전예약: "purple",
  단종: "gray",
  블라인드: "gray",
};
export function statusBadgeTone(s: VehicleStatus): BadgeTone {
  return STATUS_TONE[s];
}

// 모델 카테고리 — 앱 model_add_panel 분류(그룹 × 차종)를 평면 옵션으로. 자유 텍스트 컬럼이라 문자열 저장.
const SIZE_GROUPS = ["경형", "소형", "준중형", "중형", "준대형", "대형", "스포츠카", "버스"] as const;
const BODY_TYPES = ["세단", "해치백", "SUV", "RV", "MPV", "쿠페", "컨버터블", "트럭", "밴"] as const;
export const MODEL_CATEGORIES: string[] = SIZE_GROUPS.flatMap((g) => BODY_TYPES.map((b) => `${g} ${b}`));

// 트림 폼 옵션(앱 trim_add_panel). DB는 자유 텍스트라 문자열 저장.
export const FUEL_TYPES = ["가솔린", "디젤", "하이브리드", "전기", "LPG", "가솔린 LPG", "전기 수소"] as const;
export const DRIVE_SYSTEMS = ["RWD", "FWD", "AWD", "4WD"] as const;
export const TRANSMISSION_TYPES = ["A/T", "M/T"] as const;
