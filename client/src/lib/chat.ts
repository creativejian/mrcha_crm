// 앱 채팅(public.chat_sessions/chat_messages) 콘솔용 순수 유틸 + supabase 데이터 접근.
// 미러 원본: mr-cha-app lib/data/repositories/{chat_session_repository,supabase_chat_repository}.dart,
// lib/presentation/providers/handoff_provider.dart. payload·문구·전이 순서를 임의로 바꾸지 말 것.
import { CHAT_SESSION_MODES, type ChatSessionMode } from "@/data/chat";

export type ChatSessionRow = {
  id: string;
  user_id: string;
  mode: string;
  assigned_staff_id: string | null;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
  profiles?: { full_name: string | null; email: string | null; role: string | null } | null;
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
export function waitingLabel(sinceIso: string, now: Date): string {
  const min = Math.max(0, Math.floor((now.getTime() - new Date(sinceIso).getTime()) / 60000));
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 대기`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 대기`;
  return `${Math.floor(hours / 24)}일 대기`;
}

// Realtime echo/낙관 반영 병합: id dedupe(교체) + created_at→id 오름차순.
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
  );
}
