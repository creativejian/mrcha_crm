import { useEffect, useRef } from "react";
import { parseChatTimestamp, type ChatMessage } from "@/lib/chat";

const BUBBLE_CLASS: Record<ChatMessage["senderKind"], string> = {
  customer: "customer",
  ai: "ai",
  staff: "advisor",
  system: "system",
};
const SENDER_LABEL: Record<ChatMessage["senderKind"], string> = {
  customer: "고객",
  ai: "AI",
  staff: "상담원",
  system: "",
};

function timeLabel(iso: string): string {
  const d = parseChatTimestamp(iso); // REST/Realtime 직렬화 편차 + JSC(Safari) NaN 안전 파싱
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

type ChatThreadProps = {
  messages: ChatMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
};

export function ChatThread({ messages, hasMore, loadingOlder, onLoadOlder }: ChatThreadProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | null>(null);
  const prevHeightRef = useRef(0);

  // 새 메시지(마지막 id 변경) → 최하단 이동. 위쪽 prepend(더 보기) → 기존 읽던 위치 유지(높이 증가분 보정).
  useEffect(() => {
    const el = listRef.current;
    if (!el || messages.length === 0) return;
    const lastId = messages[messages.length - 1].id;
    if (lastIdRef.current !== lastId) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTop += el.scrollHeight - prevHeightRef.current;
    }
    lastIdRef.current = lastId;
    prevHeightRef.current = el.scrollHeight;
  }, [messages]);

  return (
    <div className="chat-messages" ref={listRef}>
      {hasMore && (
        <button className="chat-load-more" disabled={loadingOlder} onClick={onLoadOlder} type="button">
          {loadingOlder ? "불러오는 중…" : "이전 메시지 더 보기"}
        </button>
      )}
      {messages.map((message) => (
        <div className={`message ${BUBBLE_CLASS[message.senderKind]}`} key={message.id}>
          {message.attachmentUrl && (
            <a className="message-attachment" href={message.attachmentUrl} rel="noreferrer" target="_blank">
              <img
                alt="첨부 이미지"
                src={message.attachmentUrl}
                style={message.attachmentWidth && message.attachmentHeight ? { aspectRatio: `${message.attachmentWidth} / ${message.attachmentHeight}` } : undefined}
              />
            </a>
          )}
          {message.message}
          {message.senderKind !== "system" && <small>{SENDER_LABEL[message.senderKind]} · {timeLabel(message.createdAt)}</small>}
        </div>
      ))}
    </div>
  );
}
