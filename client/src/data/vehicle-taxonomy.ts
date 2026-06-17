// 차량 status enum(DB 저장값, public.car_status)과 모델 카테고리 옵션 SSOT.
// 표시 라벨은 앱 admin과 동일(사전예약→예약판매, 블라인드→숨김). 저장은 항상 enum 값.
export const VEHICLE_STATUSES = ["판매중", "출시예정", "사전예약", "단종", "블라인드"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

const STATUS_LABEL: Record<VehicleStatus, string> = {
  판매중: "판매중",
  출시예정: "출시예정",
  사전예약: "예약판매",
  단종: "단종",
  블라인드: "숨김",
};
export function statusLabel(s: VehicleStatus): string {
  return STATUS_LABEL[s];
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
