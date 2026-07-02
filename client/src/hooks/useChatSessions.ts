import { useCallback, useEffect, useState } from "react";
import { fetchChatSessions, type ChatSession } from "@/lib/chat";
import { subscribeChatSessions } from "@/lib/chat-realtime";

// 세션 큐: 초기 로드 + 아무 세션 전이든 재조회(세션 수 적음 — spec §6).
// 드롭 후 재구독(onResync) 시에도 재조회해 끊긴 사이 놓친 전이를 보정한다.
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
