// 트림 옵션 배지 3상태(앱 패리티):
//  - has: 옵션 1개 이상 → 파란 배지 + 합계
//  - confirmed-none: 옵션 0 + 무옵션 확정 → 회색 배지 + ✓
//  - undecided: 옵션 0 + 미확정 → 빨간 배지 + ?
export type OptionBadge = "has" | "confirmed-none" | "undecided";

export function optionBadgeState(basic: number, tuning: number, noOption: boolean): OptionBadge {
  if (basic + tuning > 0) return "has";
  return noOption ? "confirmed-none" : "undecided";
}
