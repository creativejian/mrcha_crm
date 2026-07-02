import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHAT_PAGE_SIZE,
  fetchChatMessages,
  mergeMessages,
  sendStaffMessage,
  toChatMessage,
  type ChatMessage,
} from "@/lib/chat";
import { subscribeChatMessages } from "@/lib/chat-realtime";

// 열린 스레드: user_id 기준 히스토리 + Realtime 수신 병합 + 낙관 전송.
export function useChatThread(userId: string | null, onToast: (message: string) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const seq = useRef(0); // 스레드 전환 race 가드

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- userId(스레드) 전환 시 이전 스레드 메시지를 즉시 비워 동기화하는 의도된 effect
    setMessages([]);
    setHasMore(false);
    if (!userId) return;
    const mySeq = ++seq.current;
    fetchChatMessages(userId)
      .then((batch) => {
        if (seq.current !== mySeq) return;
        setMessages(batch);
        setHasMore(batch.length === CHAT_PAGE_SIZE);
      })
      .catch(() => onToast("메시지를 불러오지 못했습니다."));
    return subscribeChatMessages(
      userId,
      (row) => {
        if (seq.current !== mySeq) return;
        setMessages((current) => mergeMessages(current, [toChatMessage(row)]));
      },
      // 드롭 후 재구독: 끊긴 사이 놓친 메시지를 최신 페이지 refetch+병합으로 보정(best-effort, 실패는 무시).
      () => {
        if (seq.current !== mySeq) return;
        fetchChatMessages(userId)
          .then((batch) => {
            if (seq.current !== mySeq) return;
            setMessages((current) => mergeMessages(current, batch));
          })
          .catch(() => undefined);
      },
    );
  }, [userId, onToast]);

  const loadOlder = useCallback(() => {
    const oldest = messages[0];
    if (!userId || !oldest || loadingOlder) return;
    setLoadingOlder(true);
    fetchChatMessages(userId, { createdAt: oldest.createdAt, id: oldest.id })
      .then((batch) => {
        setMessages((current) => mergeMessages(current, batch));
        setHasMore(batch.length === CHAT_PAGE_SIZE);
      })
      .catch(() => onToast("이전 메시지를 불러오지 못했습니다."))
      .finally(() => setLoadingOlder(false));
  }, [userId, messages, loadingOlder, onToast]);

  // 낙관 전송: temp 즉시 표시 → insert 성공 시 실제 row로 교체(Realtime echo는 id dedupe).
  // 실패 시 temp 제거 + false 반환(호출부가 입력창 원문 복원).
  const send = useCallback(
    async (input: { sessionId: string; staffId: string; message: string }): Promise<boolean> => {
      if (!userId) return false;
      const temp: ChatMessage = {
        id: `temp-${Date.now()}`,
        userId,
        message: input.message,
        senderKind: "staff",
        staffId: input.staffId,
        sessionId: input.sessionId,
        attachmentUrl: null,
        attachmentWidth: null,
        attachmentHeight: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, temp]);
      try {
        const saved = await sendStaffMessage({ userId, ...input });
        setMessages((current) => mergeMessages(current.filter((m) => m.id !== temp.id), [saved]));
        return true;
      } catch {
        setMessages((current) => current.filter((m) => m.id !== temp.id));
        onToast("메시지 전송에 실패했습니다.");
        return false;
      }
    },
    [userId, onToast],
  );

  return { messages, hasMore, loadingOlder, loadOlder, send };
}
