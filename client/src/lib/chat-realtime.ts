// public.chat_sessions / chat_messages postgres_changes 구독(quote-requests-realtime 패턴).
// 인증: 현재 세션 JWT → RLS(staff SELECT) 통과 시 수신.
// 채널명: supabase-js v2는 같은 topic 객체를 재사용한다 — 두 구독처가 공존하면 두 번째 .on()이
// throw하고, 한쪽 removeChannel이 다른 쪽 구독까지 teardown한다(App.tsx 알림과 ChatPage 큐가
// 동시에 구독하는 구조). 호출마다 고유 suffix를 붙여 채널을 분리한다.
import { supabase } from "./supabase";
import type { ChatMessageRow } from "./chat";

let channelSeq = 0;

export type ChatSessionChange = { newMode: string | null; oldMode: string | null };

function readMode(row: Record<string, unknown> | null | undefined): string | null {
  const mode = row?.mode;
  return typeof mode === "string" ? mode : null;
}

// 구독 성립(SUBSCRIBED) 시마다 onResync 호출 — ①최초 join: 초기 REST 스냅샷과 join 완료 사이
// 도착분 보정 ②드롭 후 자동 rejoin: 끊긴 사이 놓친 이벤트 보정(spec §6). 호출부는 refetch+병합.
// supabase-js가 자동 rejoin하므로 여기선 상태 전이만 관찰한다. 참고: CLOSED는 phoenix가 rejoin하지
// 않는 종료 상태(사실상 자체 removeChannel cleanup에서만 발생)라 재생성은 다루지 않는다.
function statusHandler(onResync?: () => void): (status: string) => void {
  return (status) => {
    if (status === "SUBSCRIBED") onResync?.();
  };
}

// 세션 INSERT/UPDATE 신호. 호출부 용도 2가지(공존 — 채널은 각자):
//  - ChatPage 큐: 아무 전이든 fetchChatSessions 재조회(세션 수 적음)
//  - App.tsx 알림: newMode==='pending' && oldMode!=='pending' 전이만 카운트
// oldMode는 replica identity full(앱 마이그 20260307103500) 전제 — 깨지면 UPDATE old가 부분
// payload가 되어 oldMode=null → pending 세션의 배정 UPDATE에도 알림 오탐이 난다. 전제 유지 필수.
export function subscribeChatSessions(
  onChange: (change: ChatSessionChange) => void,
  onResync?: () => void,
): () => void {
  const channel = supabase
    .channel(`crm-chat-sessions-${++channelSeq}`)
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
    .subscribe(statusHandler(onResync));
  return () => {
    void supabase.removeChannel(channel);
  };
}

// 열린 스레드의 메시지 수신(앱 admin subscribeToUserMessages와 동일한 user_id eq 필터).
export function subscribeChatMessages(
  userId: string,
  onRow: (row: ChatMessageRow) => void,
  onResync?: () => void,
): () => void {
  const filter = { schema: "public", table: "chat_messages", filter: `user_id=eq.${userId}` };
  const channel = supabase
    .channel(`crm-chat-messages-${userId}-${++channelSeq}`)
    .on("postgres_changes", { ...filter, event: "INSERT" }, (payload) => onRow(payload.new as ChatMessageRow))
    .on("postgres_changes", { ...filter, event: "UPDATE" }, (payload) => onRow(payload.new as ChatMessageRow))
    .subscribe(statusHandler(onResync));
  return () => {
    void supabase.removeChannel(channel);
  };
}
