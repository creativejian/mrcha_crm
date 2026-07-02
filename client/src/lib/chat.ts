// 앱 채팅(public.chat_sessions/chat_messages) 콘솔용 순수 유틸 + supabase 데이터 접근.
// 미러 원본: mr-cha-app lib/data/repositories/{chat_session_repository,supabase_chat_repository}.dart,
// lib/presentation/providers/handoff_provider.dart. payload·문구·전이 순서를 임의로 바꾸지 말 것.
import {
  CHAT_SESSION_MODES,
  CHAT_SYSTEM_MSG_RETURN,
  CHAT_SYSTEM_MSG_TAKEOVER,
  type ChatSessionMode,
} from "@/data/chat";
import { supabase } from "./supabase";

export type ChatSessionRow = {
  id: string;
  user_id: string;
  mode: string;
  assigned_staff_id: string | null;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
  profiles?: { full_name: string | null; email: string | null; role: string | null; avatar_url?: string | null } | null;
};

export type ChatMessageRow = {
  id: string;
  user_id: string;
  message: string;
  is_user: boolean;
  sender_type: string;
  session_id: string | null;
  staff_id: string | null;
  attachment_url: string | null;
  attachment_width: number | null;
  attachment_height: number | null;
  created_at: string;
};

export type ChatSession = {
  id: string;
  userId: string;
  mode: ChatSessionMode;
  assignedStaffId: string | null;
  assignedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customerName: string;
  customerEmail: string | null;
  customerAvatarUrl: string | null;
};

export type ChatSenderKind = "customer" | "ai" | "staff" | "system";

export type ChatMessage = {
  id: string;
  userId: string;
  message: string;
  senderKind: ChatSenderKind;
  staffId: string | null;
  sessionId: string | null;
  attachmentUrl: string | null;
  attachmentWidth: number | null;
  attachmentHeight: number | null;
  createdAt: string;
};

// 발신자 판별. 구세대 quirk: sender_type 컬럼이 나중에 추가돼 AI 응답 4,383건이
// sender_type='user' + is_user=false로 저장돼 있다 → staff/system 외에는 is_user로 판별.
export function senderKindOf(row: Pick<ChatMessageRow, "sender_type" | "is_user">): ChatSenderKind {
  if (row.sender_type === "staff") return "staff";
  if (row.sender_type === "system") return "system";
  return row.is_user ? "customer" : "ai";
}

function toMode(raw: string): ChatSessionMode {
  return (CHAT_SESSION_MODES as readonly string[]).includes(raw) ? (raw as ChatSessionMode) : "ai";
}

export function toChatSession(row: ChatSessionRow): ChatSession {
  return {
    id: row.id,
    userId: row.user_id,
    mode: toMode(row.mode),
    assignedStaffId: row.assigned_staff_id,
    assignedAt: row.assigned_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerName: row.profiles?.full_name ?? row.profiles?.email ?? "고객",
    customerEmail: row.profiles?.email ?? null,
    customerAvatarUrl: row.profiles?.avatar_url ?? null,
  };
}

export function toChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    userId: row.user_id,
    message: row.message,
    senderKind: senderKindOf(row),
    staffId: row.staff_id,
    sessionId: row.session_id,
    attachmentUrl: row.attachment_url,
    attachmentWidth: row.attachment_width,
    attachmentHeight: row.attachment_height,
    createdAt: row.created_at,
  };
}

// pending 대기시간 파생 표시(전용 컬럼 없음 — updated_at 경과. spec §3).
// suffix "전"은 비대기(경과 시각) 라벨용 — 표시 문자열을 밖에서 replace로 수술하지 말 것.
export function waitingLabel(sinceIso: string, now: Date, suffix: "대기" | "전" = "대기"): string {
  const min = Math.max(0, Math.floor((now.getTime() - new Date(sinceIso).getTime()) / 60000));
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 ${suffix}`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 ${suffix}`;
  return `${Math.floor(hours / 24)}일 ${suffix}`;
}

// timestamptz 직렬화 편차 흡수: REST(PostgREST)='T'+'+00:00', Realtime(wal2json)=' '+'+00' 케이스 보고됨.
// JSC(Safari)는 'T' 아닌 구분자·분 없는 오프셋(+00)을 NaN 처리하므로 반드시 이 헬퍼로 파싱한다.
// 커서(fetchChatMessages before)는 원시 문자열을 유지해야 하므로(마이크로초 정밀도) 표시/정렬에서만 파싱한다.
export function parseChatTimestamp(ts: string): Date {
  const t = ts.replace(" ", "T");
  return new Date(/[+-]\d{2}$/.test(t) ? `${t}:00` : t);
}

function toEpoch(ts: string): number {
  return parseChatTimestamp(ts).getTime();
}

// Realtime echo/낙관 반영 병합: id dedupe(교체) + 시각→id 오름차순.
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => {
    const diff = toEpoch(a.createdAt) - toEpoch(b.createdAt);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : 1;
  });
}

// ── supabase 데이터 접근 (staff JWT + RLS. 앱 admin 섹션 미러) ─────────────────

const SESSION_SELECT = "*, profiles!chat_sessions_user_id_fkey(full_name, email, role, avatar_url)";
export const CHAT_PAGE_SIZE = 50;

// 앱 getAllSessions 미러: role='customer' 필터는 쿼리가 아니라 클라이언트측(앱과 동일).
export async function fetchChatSessions(): Promise<ChatSession[]> {
  const { data, error } = await supabase
    .from("chat_sessions")
    .select(SESSION_SELECT)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as ChatSessionRow[])
    .filter((row) => (row.profiles?.role ?? "customer") === "customer")
    .map(toChatSession);
}

// user_id 기준(세션 없는 구세대 AI 대화 포함 — 상담원이 맥락을 봐야 함).
// 최신 CHAT_PAGE_SIZE건을 desc로 받아 뒤집어 반환. cursor는 created_at/id 복합(동일 타임스탬프 안전).
export async function fetchChatMessages(
  userId: string,
  before?: { createdAt: string; id: string },
): Promise<ChatMessage[]> {
  let query = supabase
    .from("chat_messages")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CHAT_PAGE_SIZE);
  if (before) {
    // PostgREST or() 값에 콜론 포함 timestamp는 큰따옴표 quoting 필요.
    query = query.or(
      `created_at.lt."${before.createdAt}",and(created_at.eq."${before.createdAt}",id.lt.${before.id})`,
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as ChatMessageRow[]).map(toChatMessage).reverse();
}

// 현재 로그인 staff의 profiles.id(=auth uid). JWT claims 기반(로컬 세션 토큰에서 읽음).
export async function getStaffId(): Promise<string> {
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (typeof sub !== "string" || sub.length === 0) throw new Error("로그인 정보가 없습니다.");
  return sub;
}

export type StaffOption = { id: string; name: string };

// 배정 드롭다운용. profiles RLS "viewable by self or staff"라 staff 계정은 전체 조회 가능(실측).
export async function fetchStaffOptions(): Promise<StaffOption[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("role", ["staff", "manager", "admin"]);
  if (error) throw error;
  return ((data ?? []) as { id: string; full_name: string | null }[]).map((row) => ({
    id: row.id,
    name: row.full_name ?? "이름 없음",
  }));
}

// 앱 insertSystemMessage 미러: staff_id 없음 + 실패는 삼킨다(상태 전이를 무르지 않음 —
// supabase_chat_repository.dart:255-271 try/catch와 동일. 실패 시 안내줄만 누락되고 Realtime 세션 상태가 진실).
async function insertSystemMessage(userId: string, sessionId: string, message: string): Promise<void> {
  const { error } = await supabase.from("chat_messages").insert({
    user_id: userId,
    session_id: sessionId,
    message,
    is_user: false,
    sender_type: "system",
  });
  if (error) console.error("system 메시지 기록 실패:", error);
}

// 배정만(목업 "지안에게 배정") — mode 유지, 고객 화면 무변화. CRM 고유(앱에는 없는 흐름).
export async function assignSession(sessionId: string, staffId: string): Promise<void> {
  const { error } = await supabase
    .from("chat_sessions")
    .update({ assigned_staff_id: staffId, assigned_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}

// 앱 takeOverSession 미러(update 먼저 → system 메시지) + 경합 가드(neq human).
// false = 이미 다른 상담원이 human 인수(마지막 쓰기 경합에서 짐) → 호출부가 reload+안내.
export async function takeOverSession(
  session: { id: string; userId: string },
  staffId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("chat_sessions")
    .update({ mode: "human", assigned_staff_id: staffId, assigned_at: new Date().toISOString() })
    .eq("id", session.id)
    .neq("mode", "human")
    .select();
  if (error) throw error;
  if (!data || (data as unknown[]).length === 0) return false;
  await insertSystemMessage(session.userId, session.id, CHAT_SYSTEM_MSG_TAKEOVER);
  return true;
}

// 앱 returnToAi 미러: system 메시지 먼저 → 세션 초기화(assigned 둘 다 null clear).
export async function returnSessionToAi(session: { id: string; userId: string }): Promise<void> {
  await insertSystemMessage(session.userId, session.id, CHAT_SYSTEM_MSG_RETURN);
  const { error } = await supabase
    .from("chat_sessions")
    .update({ mode: "ai", assigned_staff_id: null, assigned_at: null })
    .eq("id", session.id);
  if (error) throw error;
}

// 앱 sendStaffMessage payload 미러. insert 결과 row를 받아 낙관 temp 교체에 쓴다.
export async function sendStaffMessage(input: {
  userId: string;
  sessionId: string;
  staffId: string;
  message: string;
}): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      user_id: input.userId,
      session_id: input.sessionId,
      message: input.message,
      is_user: false,
      sender_type: "staff",
      staff_id: input.staffId,
    })
    .select()
    .single();
  if (error) throw error;
  return toChatMessage(data as ChatMessageRow);
}
