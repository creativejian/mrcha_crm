// 실시간 상담 전사 운영 설정(public.human_handoff_settings) 접근 + 순수 파생.
// 계약 SSOT = ref/specs/2026-07-11-crm-handoff-operation-settings-design.md (앱 이슈 #582,
// 앱 마이그 20260711170000). 쓰기는 update_human_handoff_settings RPC 단일 경로 —
// 테이블 직접 쓰기는 REVOKE돼 있고(admin 검사+감사 기록이 RPC 안에서 원자), CRM 서버 경유도 없다.
import { HANDOFF_DAY_KEYS, HANDOFF_DAY_LABELS, HANDOFF_MODE_LABELS, HANDOFF_TIMEZONE, type HandoffDayKey, type HandoffMode } from "@/data/chat";
import { supabase } from "./supabase";

export type DaySchedule = { start: string; end: string } | null;
export type WeekSchedule = Record<HandoffDayKey, DaySchedule>;

export type HandoffSettings = {
  mode: HandoffMode;
  timezone: string;
  schedule: WeekSchedule;
  forceMessage: string;
  outsideHoursMessage: string;
  updatedAt: string;
};

export type HandoffReason = "available" | "force_off" | "outside_hours";

export type HandoffAvailability = {
  available: boolean;
  mode: HandoffMode;
  reason: HandoffReason;
  scheduleDescription: string;
  nextOpenAt: string | null; // outside_hours일 때만 non-NULL
  message: string | null; // 불가 시에만 non-NULL({schedule} 치환 완료본)
  settingsUpdatedAt: string;
};

export type HandoffAudit = {
  id: number;
  changedBy: string;
  reason: string | null;
  oldValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  createdAt: string;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // "HH:MM" 24시간제(계약: 두 자리 시 고정)

function parseDay(raw: unknown): DaySchedule {
  if (raw == null || typeof raw !== "object") return null;
  const { start, end } = raw as Record<string, unknown>;
  if (typeof start !== "string" || typeof end !== "string") return null;
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return null;
  return { start, end };
}

// jsonb 방어 파싱 — DB CHECK+RPC가 형식을 지키지만, 깨진 값이 폼에 번지면 다음 저장이
// 계약 위반 payload가 되므로 이상한 요일은 휴무(null)로 읽는다(fail-safe).
export function parseWeekSchedule(raw: unknown): WeekSchedule {
  const source = raw != null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(HANDOFF_DAY_KEYS.map((day) => [day, parseDay(source[day])])) as WeekSchedule;
}

// 저장 전 draft 검증. <input type="time">이 형식을 보장하지만 프로그램 경로(붙여넣기·미래 코드) 방어.
export function scheduleDraftErrors(draft: WeekSchedule): string[] {
  const errors: string[] = [];
  for (const day of HANDOFF_DAY_KEYS) {
    const slot = draft[day];
    if (slot == null) continue;
    if (!TIME_RE.test(slot.start) || !TIME_RE.test(slot.end)) {
      errors.push(`${HANDOFF_DAY_LABELS[day]}요일 시간을 HH:MM 형식으로 입력해 주세요.`);
    }
  }
  return errors;
}

export type HandoffBadge = { label: string; tone: "on" | "off" | "outside" };

// 판정 결과 → 배지 라벨·톤(설정 페이지 상태 카드·ChatPage 배지 공유).
export function availabilityBadge(a: Pick<HandoffAvailability, "available" | "mode" | "reason">): HandoffBadge {
  if (a.available) {
    return a.mode === "force_on" ? { label: "강제 ON · 상담 접수 중", tone: "on" } : { label: "상담 접수 중", tone: "on" };
  }
  if (a.reason === "force_off") return { label: "강제 OFF · 접수 차단", tone: "off" };
  return { label: "운영시간 외 · 접수 중지", tone: "outside" };
}

// 앱 채팅 버블은 MarkdownBody(softLineBreak: true)로 단일 개행을 실제 줄바꿈으로 렌더한다
// (chat_message_bubble.dart 실측). react-markdown 기본(CommonMark)은 단일 \n을 공백으로 접으므로,
// 미리보기가 앱 실물과 같아지도록 단일 \n만 hard break("  \n")로 승격한다(문단 \n\n은 보존).
export function withAppLineBreaks(markdown: string): string {
  return markdown
    .split("\n\n")
    .map((paragraph) => paragraph.replace(/\n/g, "  \n"))
    .join("\n\n");
}

// 감사 행의 old/new(설정 행 전체 스냅샷·snake_case) 차이를 이력 목록 한 줄 요약으로.
export function auditSummary(oldValue: Record<string, unknown>, newValue: Record<string, unknown>): string {
  const modeLabel = (v: unknown) =>
    typeof v === "string" && v in HANDOFF_MODE_LABELS ? HANDOFF_MODE_LABELS[v as HandoffMode] : String(v);
  const parts: string[] = [];
  if (oldValue.mode !== newValue.mode) parts.push(`${modeLabel(oldValue.mode)} → ${modeLabel(newValue.mode)}`);
  if (JSON.stringify(oldValue.schedule) !== JSON.stringify(newValue.schedule)) parts.push("운영시간 변경");
  if (oldValue.force_message !== newValue.force_message || oldValue.outside_hours_message !== newValue.outside_hours_message) {
    parts.push("안내 문구 변경");
  }
  if (oldValue.timezone !== newValue.timezone) parts.push("타임존 변경");
  return parts.length > 0 ? parts.join(" · ") : "변경 없음";
}

type SettingsRow = {
  mode: HandoffMode;
  timezone: string;
  schedule: unknown;
  force_message: string;
  outside_hours_message: string;
  updated_at: string;
};

function settingsFromRow(row: SettingsRow): HandoffSettings {
  return {
    mode: row.mode,
    timezone: row.timezone,
    schedule: parseWeekSchedule(row.schedule),
    forceMessage: row.force_message,
    outsideHoursMessage: row.outside_hours_message,
    updatedAt: row.updated_at,
  };
}

export async function fetchHandoffSettings(): Promise<HandoffSettings> {
  const { data, error } = await supabase
    .from("human_handoff_settings")
    .select("mode, timezone, schedule, force_message, outside_hours_message, updated_at")
    .eq("id", 1)
    .single<SettingsRow>();
  if (error) throw new Error(`운영 설정을 불러오지 못했습니다: ${error.message}`);
  return settingsFromRow(data);
}

type AvailabilityRow = {
  available: boolean;
  mode: HandoffMode;
  reason: HandoffReason;
  schedule_description: string;
  next_open_at: string | null;
  message: string | null;
  settings_updated_at: string;
};

export async function fetchHandoffAvailability(): Promise<HandoffAvailability> {
  const { data, error } = await supabase.rpc("get_human_handoff_availability").single<AvailabilityRow>();
  if (error) throw new Error(`상담 가용성 판정을 불러오지 못했습니다: ${error.message}`);
  return {
    available: data.available,
    mode: data.mode,
    reason: data.reason,
    scheduleDescription: data.schedule_description,
    nextOpenAt: data.next_open_at,
    message: data.message,
    settingsUpdatedAt: data.settings_updated_at,
  };
}

// 저장 = RPC 한 방(admin 검사 + UPDATE + 감사 INSERT 원자). 권한 실패는 42501 → PostgREST 403.
export async function saveHandoffSettings(
  draft: Pick<HandoffSettings, "mode" | "schedule" | "forceMessage" | "outsideHoursMessage">,
  reason: string,
): Promise<HandoffSettings> {
  const { data, error } = await supabase
    .rpc("update_human_handoff_settings", {
      p_mode: draft.mode,
      p_schedule: draft.schedule,
      p_force_message: draft.forceMessage,
      p_outside_hours_message: draft.outsideHoursMessage,
      p_reason: reason,
      // DB DEFAULT에 기대지 않고 명시 전달한다(2026-07-22 앱 팀 권고 수용). timezone은 앱의
      // 운영시간 판정(private.handoff_availability_at의 AT TIME ZONE)이 쓰는 기준 시각이라,
      // DEFAULT가 흘리면 저장 한 번에 판정이 통째로 밀린다. 명시하면 그 사고와 무관해진다.
      p_timezone: HANDOFF_TIMEZONE,
    })
    .single<SettingsRow>();
  if (error) {
    if (error.code === "42501") throw new Error("최고관리자만 운영 설정을 변경할 수 있습니다.");
    throw new Error(`운영 설정 저장에 실패했습니다: ${error.message}`);
  }
  return settingsFromRow(data);
}

type AuditRow = {
  id: number;
  changed_by: string;
  reason: string | null;
  old_value: Record<string, unknown>;
  new_value: Record<string, unknown>;
  created_at: string;
};

// 감사 조회는 admin 전용 RLS — 비admin은 빈 배열이 아니라 에러가 아닌 0행으로 온다(RLS 특성).
// 페이지 자체가 admin 게이트라 실사용 경로에서는 항상 보인다.
export async function fetchHandoffAudits(limit = 20): Promise<HandoffAudit[]> {
  const { data, error } = await supabase
    .from("human_handoff_setting_audits")
    .select("id, changed_by, reason, old_value, new_value, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`변경 이력을 불러오지 못했습니다: ${error.message}`);
  return (data as AuditRow[]).map((row) => ({
    id: row.id,
    changedBy: row.changed_by,
    reason: row.reason,
    oldValue: row.old_value,
    newValue: row.new_value,
    createdAt: row.created_at,
  }));
}

// 설정 행 UPDATE 실시간 구독(chat-realtime.ts 패턴 — supabase-js는 같은 topic 객체를 재사용하므로
// 구독처마다 고유 suffix 필수). 판정은 시각 의존이라 구독자는 행이 아니라 재판정 신호로만 쓴다.
let channelSeq = 0;

export function subscribeHandoffSettings(onChange: () => void): () => void {
  const channel = supabase
    .channel(`crm-handoff-settings-${++channelSeq}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "human_handoff_settings" }, () => onChange())
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
