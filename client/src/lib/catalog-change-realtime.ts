// MC 마스터 변경 요청 큐의 교차 세션 실시간 신호(2026-07-31 유슨생) — 같은 탭 안은
// catalog-change-requests.ts의 모듈 pub/sub이 즉시 갱신하지만, 관리자 승인/반려 ↔ 팀장
// 적재/취소는 서로 다른 브라우저라 신호가 닿지 않았다(60s 폴링·focus 재조회가 상한).
// supabase broadcast로 "큐가 움직였다"만 알리고 받은 쪽은 자기 fetch를 다시 돈다 —
// payload를 신뢰하지 않는다(서버가 SSOT라 행 데이터를 실어 나르지 않는다). DB
// publication/RLS 무관(신호 전용 채널).
//
// 채널 수명은 joinTypingChannel(chat-realtime.ts) 매니저 미러: 모듈이 채널을 보유하고
// 마지막 리스너 해제 후 250ms 유예 뒤 해체 — StrictMode mount→cleanup→mount에서
// removeChannel(비동기) 중인 옛 채널 객체를 재사용해 조용히 죽는 문제 회피. topic은 전
// 세션이 같아야 통신되므로 suffix 고유화 금지(같은 topic 공존 구독 충돌은 이 매니저의
// 단일 채널 보유가 원천 차단한다).
import { supabase } from "./supabase";

const TOPIC = "crm-catalog-change-queue";

type Entry = {
  channel: ReturnType<typeof supabase.channel>;
  listeners: Set<() => void>;
  teardownTimer: ReturnType<typeof setTimeout> | null;
};
let entry: Entry | null = null;

// 다른 세션의 큐 변동 신호를 구독한다(반환 = 해지). 첫 구독이 채널을 열고 마지막 해지가 닫는다.
export function onCatalogQueueRemoteChanged(listener: () => void): () => void {
  if (entry?.teardownTimer != null) {
    clearTimeout(entry.teardownTimer);
    entry.teardownTimer = null;
  }
  if (entry == null) {
    const listeners = new Set<() => void>();
    const channel = supabase
      .channel(TOPIC)
      .on("broadcast", { event: "queue-changed" }, () => {
        for (const l of listeners) l();
      })
      .subscribe();
    entry = { channel, listeners, teardownTimer: null };
  }
  const held = entry;
  held.listeners.add(listener);
  return () => {
    held.listeners.delete(listener);
    if (held.listeners.size > 0) return;
    held.teardownTimer = setTimeout(() => {
      if (entry === held) entry = null;
      void supabase.removeChannel(held.channel);
    }, 250);
  };
}

// 큐를 움직인 쪽이 부른다(승인·반려·취소·202 적재 성공 직후). 이 채널은 mc-master의 훅들이
// 열어 두므로 실사용 경로에선 항상 열려 있고, 안 열려 있으면 조용히 스킵된다 — 상대 세션은
// focus 재조회/폴링이 그물이다. 자기 자신에게는 에코되지 않는다(broadcast 기본 self:false —
// 로컬 갱신은 모듈 pub/sub 몫).
export function broadcastCatalogQueueChanged(): void {
  void entry?.channel.send({ type: "broadcast", event: "queue-changed", payload: {} });
}
