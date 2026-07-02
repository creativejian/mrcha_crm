import { useCallback, useEffect, useState } from "react";
import { fetchChatSessions, type ChatSession } from "@/lib/chat";
import { subscribeChatSessions } from "@/lib/chat-realtime";

// 세션 큐: 초기 로드 + 아무 세션 전이든 재조회(세션 수 적음 — spec §6).
// 구독 성립(onResync — 최초 join·드롭 후 재구독)마다 재조회해 스냅샷/끊긴 사이 놓친 전이를 보정한다.
// (mount 시 초기 로드+최초 join resync로 reload 2회 — 세션 수가 적어 수용, 의도된 동작.)
export function useChatSessions(onToast: (message: string) => void) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    fetchChatSessions()
      .then(setSessions)
      .catch(() => onToast("상담 목록을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [onToast]);
  useEffect(() => {
    reload();
    return subscribeChatSessions(() => reload(), reload);
  }, [reload]);
  return { sessions, loading, reload };
}
