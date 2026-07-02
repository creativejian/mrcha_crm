// public.chat_sessions / chat_messages postgres_changes 구독(quote-requests-realtime 패턴).
// 인증: 현재 세션 JWT → RLS(staff SELECT) 통과 시 수신.
// 채널명: supabase-js v2는 같은 topic 객체를 재사용한다 — 두 구독처가 공존하면 두 번째 .on()이
// throw하고, 한쪽 removeChannel이 다른 쪽 구독까지 teardown한다(App.tsx 알림과 ChatPage 큐가
// 동시에 구독하는 구조). 호출마다 고유 suffix를 붙여 채널을 분리한다.
// (예외: joinTypingChannel은 앱과 같은 broadcast topic에 join해야 하므로 suffix를 붙이지 않는다.)
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

// 타이핑 인디케이터(앱 typing_indicator_service.dart 미러 — broadcast 상호운용).
// ⚠️ topic은 앱과 동일해야 통신되므로 channelSeq 고유화 금지. 대신 같은 topic의 즉시 재join이
// 해체 중인 옛 채널 객체를 재사용해 조용히 죽는 문제(StrictMode mount→cleanup→mount에서
// removeChannel이 비동기라 발생)를 막기 위해, 모듈 레벨 매니저가 채널을 보유하고
// 마지막 리스너 해제 후 잠깐(250ms) 유예했다가 해체한다 — 유예 안에 재join하면 산 채널 재사용.
// event 'typing', payload { sender_type: 'user'|'staff' }, config 기본(self:false, ack:false).
type TypingEntry = {
  channel: ReturnType<typeof supabase.channel>;
  listeners: Set<() => void>;
  teardownTimer: ReturnType<typeof setTimeout> | null;
};
const typingChannels = new Map<string, TypingEntry>();

export function joinTypingChannel(
  userId: string,
  onCustomerTyping: () => void,
): { sendTyping: () => void; cleanup: () => void } {
  const topic = `typing:${userId}`;
  let entry = typingChannels.get(topic);
  if (entry?.teardownTimer != null) {
    clearTimeout(entry.teardownTimer);
    entry.teardownTimer = null;
  }
  if (!entry) {
    const listeners = new Set<() => void>();
    const channel = supabase
      .channel(topic)
      .on("broadcast", { event: "typing" }, (message) => {
        // 봉투 호환(실측): JS SDK는 {payload:{…}} 중첩으로 보내지만, Dart SDK(realtime_client
        // 2.8.0 send()는 payload 맵에 type/event를 합쳐 평평하게 전송) → 앱발 메시지는
        // sender_type이 최상위에 온다. 두 형태 모두 수용.
        const raw = message as Record<string, unknown>;
        const nested = raw.payload as Record<string, unknown> | undefined;
        const senderType = nested?.sender_type ?? raw.sender_type;
        if (senderType !== "user") return; // 상대(고객)만 — 앱 admin과 동일 필터
        for (const listener of listeners) listener();
      })
      .subscribe();
    entry = { channel, listeners, teardownTimer: null };
    typingChannels.set(topic, entry);
  }
  const held = entry;
  held.listeners.add(onCustomerTyping);
  let lastSentAt = 0;
  return {
    // 앱 _sendInterval(1s) leading-edge throttle 미러(첫 입력 즉시, 이후 1s 미만 무시. stop 이벤트 없음)
    sendTyping: () => {
      const now = Date.now();
      if (now - lastSentAt < 1000) return;
      lastSentAt = now;
      // 앱 수신부(Dart onBroadcast)는 wire 맵을 그대로 받아 sender_type을 최상위에서 읽는다
      // → 평평한 키를 함께 실어 전송(중첩 payload는 JS 수신부 호환용으로 유지).
      void held.channel.send({
        type: "broadcast",
        event: "typing",
        payload: { sender_type: "staff" },
        sender_type: "staff",
      });
    },
    cleanup: () => {
      held.listeners.delete(onCustomerTyping);
      if (held.listeners.size > 0) return;
      held.teardownTimer = setTimeout(() => {
        typingChannels.delete(topic);
        void supabase.removeChannel(held.channel);
      }, 250);
    },
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
