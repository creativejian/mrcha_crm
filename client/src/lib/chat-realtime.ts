// public.chat_sessions / chat_messages postgres_changes 구독(quote-requests-realtime 패턴).
// 채널명은 CRM 로컬 토픽이라 앱과 충돌 없음. 인증: 현재 세션 JWT → RLS(staff SELECT) 통과 시 수신.
import { supabase } from "./supabase";
import type { ChatMessageRow } from "./chat";

export type ChatSessionChange = { newMode: string | null; oldMode: string | null };

function readMode(row: Record<string, unknown> | null | undefined): string | null {
  const mode = row?.mode;
  return typeof mode === "string" ? mode : null;
}

// 세션 INSERT/UPDATE 신호. 호출부 용도 2가지:
//  - ChatPage 큐: 아무 전이든 fetchChatSessions 재조회(세션 수 적음)
//  - App.tsx 알림: newMode==='pending' && oldMode!=='pending' 전이만 카운트
export function subscribeChatSessions(onChange: (change: ChatSessionChange) => void): () => void {
  const channel = supabase
    .channel("crm-chat-sessions")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_sessions" },
      (payload) => onChange({ newMode: readMode(payload.new as Record<string, unknown>), oldMode: null }),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "chat_sessions" },
      (payload) =>
        onChange({
          newMode: readMode(payload.new as Record<string, unknown>),
          oldMode: readMode(payload.old as Record<string, unknown>),
        }),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// 열린 스레드의 메시지 수신(앱 admin subscribeToUserMessages와 동일한 user_id eq 필터).
export function subscribeChatMessages(userId: string, onRow: (row: ChatMessageRow) => void): () => void {
  const filter = { schema: "public", table: "chat_messages", filter: `user_id=eq.${userId}` };
  const channel = supabase
    .channel(`crm-chat-messages-${userId}`)
    .on("postgres_changes", { ...filter, event: "INSERT" }, (payload) => onRow(payload.new as ChatMessageRow))
    .on("postgres_changes", { ...filter, event: "UPDATE" }, (payload) => onRow(payload.new as ChatMessageRow))
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
