import type { ChatMessage } from "@/lib/chat";

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

// timestamptz 직렬화 편차 흡수(chat.ts toEpoch와 동일 사유): REST(PostgREST)='T'+'+00:00',
// Realtime(wal2json)=' '+'+00' 케이스가 섞여 들어온다.
function timeLabel(iso: string): string {
  const d = new Date(iso.replace(" ", "T"));
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
  return (
    <div className="chat-messages">
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
