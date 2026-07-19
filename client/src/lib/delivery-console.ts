import { customerStatusGroups, DELIVERY_SCHEDULE_TYPE, type Customer, type NextDeliverySchedule } from "@/data/customers";
import { normalizeDateText, normalizeTimeText } from "@/lib/datetime-text";

// ── 출고 작업 큐 파생(2026-07-19 spec §5) — 전부 순수 함수. ──

// 출고 단계 = 계약완료 2차 상태(customerStatusGroups SSOT) 파생 — 어휘 사본을 만들지 않는다.
// (모듈 밖에선 DELIVERY_STAGE_PILLS만 쓰므로 아래 3개는 비공개 — knip baseline 오염 방지.)
const DELIVERY_STAGES: readonly string[] = customerStatusGroups["계약완료"];
const DELIVERY_DONE_STAGE = "출고완료";
const DELIVERY_IN_PROGRESS_STAGES: readonly string[] = DELIVERY_STAGES.filter((s) => s !== DELIVERY_DONE_STAGE);

// pill 어휘. 기본 = 진행 중 — 업무함은 소진되는 큐(#260 선례, spec D8).
export const DELIVERY_PILL_IN_PROGRESS = "진행 중";
export const DELIVERY_PILL_ALL = "전체";
export const DELIVERY_STAGE_PILLS: readonly string[] = [DELIVERY_PILL_IN_PROGRESS, ...DELIVERY_STAGES, DELIVERY_PILL_ALL];

export function matchesDeliveryPill(pill: string, status: string): boolean {
  if (pill === DELIVERY_PILL_ALL) return true;
  if (pill === DELIVERY_PILL_IN_PROGRESS) return DELIVERY_IN_PROGRESS_STAGES.includes(status);
  return status === pill;
}

export function deliveryPillCounts(statuses: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const pill of DELIVERY_STAGE_PILLS) counts[pill] = 0;
  for (const status of statuses) {
    for (const pill of DELIVERY_STAGE_PILLS) if (matchesDeliveryPill(pill, status)) counts[pill] += 1;
  }
  return counts;
}

// 헤드바 카운트 라벨 — 기본 필터(진행 중)에 "전체 N명" 고정 라벨을 쓰면 오독(spec §5.1).
export function deliveryCountLabel(pill: string): string {
  return pill === DELIVERY_PILL_IN_PROGRESS ? "진행" : pill;
}

// 정렬: 예정일 오름차순 · 미지정 뒤 · 같은 날짜의 시간 미지정 뒤 · 동률 0(sort 안정성으로 기존 순서 유지).
export function compareDeliverySchedule(a: Customer, b: Customer): number {
  const sa = a.nextDeliverySchedule ?? null;
  const sb = b.nextDeliverySchedule ?? null;
  if (!sa && !sb) return 0;
  if (!sa) return 1;
  if (!sb) return -1;
  if (sa.date !== sb.date) return sa.date < sb.date ? -1 : 1;
  if (sa.time === sb.time) return 0;
  if (sa.time == null) return 1;
  if (sb.time == null) return -1;
  return sa.time < sb.time ? -1 : 1;
}

const KST_OFFSET_MS = 9 * 3_600_000;

// KST 오늘 날짜 문자열(YYYY-MM-DD). 지남 판정에 브라우저 로컬 tz 금지(#204 파리티 부류) —
// getTime+toISOString 산술이라 실행 환경 tz에 전혀 의존하지 않는다. (라벨 함수 내부 전용 — 비공개.)
function kstTodayDateString(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// 셀 표시 라벨: "M/D (요일)" + 시간(있을 때만 HH:mm). 미완료 대표 일정이 KST 오늘 이전이면 overdue("지남").
export function deliveryScheduleLabel(
  schedule: NextDeliverySchedule | null | undefined,
  now: Date,
): { text: string; overdue: boolean } | null {
  if (!schedule) return null;
  const [y, m, d] = schedule.date.split("-").map(Number);
  if (!y || !m || !d) return null;
  const weekday = "일월화수목금토"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const time = schedule.time ? ` ${schedule.time.slice(0, 5)}` : "";
  // overdue는 원본이 아니라 파싱값 재조립(영패딩)으로 비교 — 비패딩 입력("2026-7-5")이
  // 사전식 비교를 조용히 틀리게 내는 것 방어(현 소스는 전부 영패딩이라 도달 불가지만 한 줄 봉쇄).
  const isoDate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { text: `${m}/${d} (${weekday})${time}`, overdue: isoDate < kstTodayDateString(now) };
}

// 팝오버 제출 해석: 대표 일정 있으면 그 행 PATCH, 없으면 '출고' 일정 생성. 날짜 필수(fail-loud).
export type DeliveryScheduleSubmit =
  | { kind: "create"; body: { scheduledDate: string; scheduledTime: string | null; type: string; done: false } }
  | { kind: "update"; id: string; body: { scheduledDate: string; scheduledTime: string | null } }
  | { kind: "invalid"; reason: string };

export function resolveDeliveryScheduleSubmit(
  existing: NextDeliverySchedule | null | undefined,
  draft: { date: string; time: string },
): DeliveryScheduleSubmit {
  if (!draft.date.trim()) return { kind: "invalid", reason: "날짜를 선택해 주세요." };
  const date = normalizeDateText(draft.date);
  if (!date) return { kind: "invalid", reason: "날짜는 2026-07-19처럼 년-월-일 형식으로 입력해 주세요." };
  const timeResult = normalizeTimeText(draft.time);
  if (!timeResult.ok) return { kind: "invalid", reason: "시간은 14:00처럼 24시간 형식으로 입력해 주세요." };
  const time = timeResult.value;
  if (existing) return { kind: "update", id: existing.id, body: { scheduledDate: date, scheduledTime: time } };
  return { kind: "create", body: { scheduledDate: date, scheduledTime: time, type: DELIVERY_SCHEDULE_TYPE, done: false } };
}

// 팝오버 fixed 배치 계산(spec §5.4 후속 — 콘솔 래퍼 overflow:hidden 클리핑 탈출).
// 기본 = 앵커 아래(+6px). 아래가 뷰포트를 넘으면 위로(flip-up), 좌우는 뷰포트 안으로 클램프.
export function resolveFixedPopoverPosition(
  anchor: { top: number; bottom: number; left: number },
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number; openUp: boolean } {
  const MARGIN = 8;
  const GAP = 6;
  const openUp = anchor.bottom + GAP + popover.height > viewport.height - MARGIN && anchor.top - GAP - popover.height >= MARGIN;
  const top = openUp ? anchor.top - GAP - popover.height : anchor.bottom + GAP;
  const left = Math.max(MARGIN, Math.min(anchor.left, viewport.width - popover.width - MARGIN));
  return { top, left, openUp };
}
